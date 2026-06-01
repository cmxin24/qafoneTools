//! # sherpa_runner.rs
//!
//! Drives the `sherpa-onnx-offline` sidecar binary for NVIDIA Parakeet TDT
//! INT8 ONNX inference.
//!
//! ## Pipeline
//! 1. Extract the input video / audio to a temporary 16 kHz mono WAV via FFmpeg.
//! 2. Invoke the `sherpa` sidecar with model file paths as CLI arguments.
//! 3. Stream stdout line-by-line; parse each JSON record emitted by the decoder.
//! 4. Group decoded tokens into SRT-friendly segments (max chars + pause rules).
//! 5. Return `Vec<AsrSegment>` identical to the Whisper path.
//!
//! ## Model files (stored under `<app_data>/models/<model_id>/`)
//! - `encoder.int8.onnx`
//! - `decoder.int8.onnx`
//! - `joiner.int8.onnx`
//! - `tokens.txt`

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use super::asr::AsrSegment;
use super::model_manager::get_model_dir;
use super::video_compressor::resolve_ffmpeg_executable;

// ─── Constants ────────────────────────────────────────────────────────────────

/// The four files that constitute a Parakeet INT8 ONNX model bundle.
pub const PARAKEET_MODEL_FILES: &[&str] = &[
    "encoder.int8.onnx",
    "decoder.int8.onnx",
    "joiner.int8.onnx",
    "tokens.txt",
];

/// Maximum character count for a single SRT subtitle line.
const MAX_SEGMENT_CHARS: usize = 60;

/// Inter-token gap (seconds) that triggers a segment boundary.
const PAUSE_BREAK_SECS: f32 = 0.5;

// ─── Public helpers ───────────────────────────────────────────────────────────

/// Returns `true` when all required Parakeet model files exist locally.
pub fn parakeet_model_ready(app: &AppHandle, model_id: &str) -> bool {
    let Ok(models_dir) = get_model_dir(app) else {
        return false;
    };
    let model_dir = models_dir.join(model_id);
    PARAKEET_MODEL_FILES
        .iter()
        .all(|f| model_dir.join(f).exists())
}

// ─── Stdout record format ─────────────────────────────────────────────────────

/// Represents one JSON record written to stdout by `sherpa-onnx-offline`.
///
/// NeMo TDT offline format (one record per input WAV file in batch mode):
/// ```json
/// {"lang":"","emotion":"","event":"","text":"Hello.",
///  "timestamps":[0.72,0.88],"durations":[0.08,0.32],
///  "tokens":[" H","ello","."],"words":[]}
/// ```
/// Icefall transducer format:
/// ```json
/// {"text":" Hello.","tokens":[...],"timestamps":[...],
///  "start_time":0.0,"duration":2.5}
/// ```
#[derive(Debug, Deserialize)]
struct SherpaRecord {
    /// Transcribed text.
    text: String,
    /// Per-token text pieces.
    #[serde(default)]
    tokens: Vec<String>,
    /// Per-token timestamps in seconds relative to this chunk's start.
    #[serde(default)]
    timestamps: Vec<f32>,
    /// Per-token durations in seconds (NeMo TDT output).
    #[serde(default)]
    durations: Vec<f32>,
    /// Utterance start offset already applied from chunk offset (icefall format).
    #[serde(default, rename = "start_time")]
    start_time: f32,
    /// Total utterance duration (icefall format; 0.0 when absent).
    #[serde(default)]
    duration: f32,
}

// ─── SRT segment builder ──────────────────────────────────────────────────────

/// Group token-level timestamps from a `SherpaRecord` into `AsrSegment`s.
///
/// Segment boundaries are inserted when any of the following is true:
/// - The accumulated text would exceed `MAX_SEGMENT_CHARS`.
/// - The gap between consecutive token timestamps exceeds `PAUSE_BREAK_SECS`.
/// - The previous token ends with a sentence-ending punctuation character.
fn build_segments(records: Vec<SherpaRecord>, start_index: usize) -> Vec<AsrSegment> {
    let mut segments: Vec<AsrSegment> = Vec::new();
    let mut idx = start_index;

    for rec in records {
        let tokens = if rec.tokens.is_empty() {
            // Fall back to whitespace splitting when token list is absent.
            rec.text
                .split_ascii_whitespace()
                .map(|w| format!(" {w}"))
                .collect::<Vec<_>>()
        } else {
            rec.tokens.clone()
        };

        if tokens.is_empty() {
            continue;
        }

        // If timestamps are missing or mismatched, emit the whole utterance as one segment.
        if rec.timestamps.is_empty() || rec.timestamps.len() != tokens.len() {
            let text = rec.text.trim().to_string();
            if !text.is_empty() {
                segments.push(AsrSegment {
                    index: idx,
                    start_ms: (rec.start_time * 1000.0) as i64,
                    end_ms: ((rec.start_time + rec.duration) * 1000.0) as i64,
                    text,
                });
                idx += 1;
            }
            continue;
        }

        // Token-level grouping pass.
        let mut seg_start_ms: i64 =
            ((rec.start_time + rec.timestamps[0]) * 1000.0) as i64;
        let mut seg_buf = String::new();
        let mut prev_ts: f32 = rec.timestamps[0];

        let flush = |buf: &str, start: i64, end: i64, idx: usize| -> Option<AsrSegment> {
            let text = buf.trim().to_string();
            if text.is_empty() {
                None
            } else {
                Some(AsrSegment {
                    index: idx,
                    start_ms: start,
                    end_ms: end,
                    text,
                })
            }
        };

        for (i, (token, &ts)) in tokens.iter().zip(rec.timestamps.iter()).enumerate() {
            let abs_ts_ms = ((rec.start_time + ts) * 1000.0) as i64;

            if i > 0 {
                let pause = ts - prev_ts;
                let would_overflow = seg_buf.len() + token.trim().len() + 1 > MAX_SEGMENT_CHARS;
                let sentence_end = seg_buf
                    .trim_end()
                    .ends_with(['.', '!', '?']);
                let long_pause = pause > PAUSE_BREAK_SECS;

                if (would_overflow || sentence_end || long_pause) && !seg_buf.trim().is_empty() {
                    if let Some(seg) = flush(&seg_buf, seg_start_ms, abs_ts_ms, idx) {
                        segments.push(seg);
                        idx += 1;
                    }
                    seg_buf.clear();
                    seg_start_ms = abs_ts_ms;
                }
            }

            seg_buf.push_str(token);
            prev_ts = ts;
        }

        // Flush remaining buffer for this utterance.
        // Prefer icefall `duration` field; fall back to last timestamp + last token duration
        // (NeMo TDT format uses `durations` instead of `duration`).
        let end_ms = if rec.duration > 0.0 {
            ((rec.start_time + rec.duration) * 1000.0) as i64
        } else if let Some(&last_ts) = rec.timestamps.last() {
            let last_dur = rec.durations.last().copied().unwrap_or(0.08);
            ((rec.start_time + last_ts + last_dur) * 1000.0) as i64
        } else {
            seg_start_ms + 500 // fallback: 500 ms after the last segment start
        };
        if let Some(seg) = flush(&seg_buf, seg_start_ms, end_ms, idx) {
            segments.push(seg);
            idx += 1;
        }
    }

    segments
}

// ─── Sidecar helpers ──────────────────────────────────────────────────────────

/// Return the duration of `wav_path` in seconds by querying `ffprobe`.
/// Returns 0.0 on any error (chunking will be skipped, single-pass used instead).
async fn get_audio_duration_secs(ffmpeg: &std::path::Path, wav_path: &str) -> f64 {
    let ffprobe = ffmpeg
        .parent()
        .map(|p| p.join("ffprobe"))
        .unwrap_or_else(|| std::path::PathBuf::from("ffprobe"));
    tokio::process::Command::new(&ffprobe)
        .args([
            "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "csv=p=0",
            wav_path,
        ])
        .output()
        .await
        .ok()
        .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<f64>().ok())
        .unwrap_or(0.0)
}

/// Run the sherpa sidecar on multiple WAV files in one batch invocation.
///
/// `wav_paths[i]` is processed with timestamp offset `offsets[i]`.
/// sherpa-onnx outputs one JSON record per input file (in input order);
/// each record's `start_time` is shifted by the corresponding offset so that
/// callers can stitch all chunks into a single contiguous transcript.
///
/// Returns `(records, stdout_raw, stderr_raw)` on success, or `Err(message)`.
async fn run_sidecar_batch(
    app: &AppHandle,
    encoder_path: &str,
    decoder_path: &str,
    joiner_path: &str,
    tokens_path: &str,
    wav_paths: &[String],
    offsets: &[f64],
) -> Result<(Vec<SherpaRecord>, String, String), String> {
    let mut args: Vec<String> = vec![
        format!("--encoder={encoder_path}"),
        format!("--decoder={decoder_path}"),
        format!("--joiner={joiner_path}"),
        format!("--tokens={tokens_path}"),
        "--decoding-method=greedy_search".to_string(),
        "--num-threads=4".to_string(),
    ];
    args.extend_from_slice(wav_paths);

    let sidecar_cmd = app
        .shell()
        .sidecar("sherpa")
        .map_err(|e| format!("sherpa sidecar 未找到: {e}"))?
        .args(args);

    let (mut rx, _child) = sidecar_cmd
        .spawn()
        .map_err(|e| format!("sherpa 启动失败: {e}"))?;

    let mut records: Vec<SherpaRecord> = Vec::new();
    let mut all_stderr = String::new();
    let mut all_stdout_raw = String::new();
    let mut record_idx: usize = 0;
    let mut exit_code: i32 = -1;

    loop {
        let Some(event) = rx.recv().await else { break };
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes);
                let line_trim = line.trim().to_owned();
                all_stdout_raw.push_str(&line_trim);
                all_stdout_raw.push('\n');
                if line_trim.starts_with('{') {
                    let offset = offsets.get(record_idx).copied().unwrap_or(0.0);
                    if let Ok(mut rec) = serde_json::from_str::<SherpaRecord>(&line_trim) {
                        rec.start_time += offset as f32;
                        records.push(rec);
                    }
                    record_idx += 1;
                }
            }
            CommandEvent::Stderr(bytes) => {
                all_stderr.push_str(String::from_utf8_lossy(&bytes).trim());
                all_stderr.push('\n');
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code.unwrap_or(-1);
                break;
            }
            _ => {}
        }
    }

    if exit_code != 0 {
        Err(format!("exit_code={exit_code}\nstderr={all_stderr}"))
    } else {
        Ok((records, all_stdout_raw, all_stderr))
    }
}

// ─── Public entry point ───────────────────────────────────────────────────────

/// Run the `sherpa-onnx-offline` sidecar on `video_path` and return ASR segments.
///
/// Caller is responsible for emitting phase-progress events around this call.
pub async fn run_sherpa(
    app: &AppHandle,
    model_id: &str,
    video_path: &str,
) -> Result<Vec<AsrSegment>, String> {
    // ── 1. Resolve model file paths ───────────────────────────────────────
    let models_dir = get_model_dir(app).map_err(|e| e.to_string())?;
    let model_dir = models_dir.join(model_id);

    for file in PARAKEET_MODEL_FILES {
        let path = model_dir.join(file);
        if !path.exists() {
            return Err(format!(
                "模型文件缺失: {:?}\n请先下载 Parakeet 模型。",
                path
            ));
        }
    }

    let encoder_path = model_dir.join("encoder.int8.onnx").to_string_lossy().to_string();
    let decoder_path = model_dir.join("decoder.int8.onnx").to_string_lossy().to_string();
    let joiner_path  = model_dir.join("joiner.int8.onnx").to_string_lossy().to_string();
    let tokens_path  = model_dir.join("tokens.txt").to_string_lossy().to_string();

    // ── 2. Prepare log file ───────────────────────────────────────────────
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let log_dir = app
        .path()
        .app_data_dir()
        .map(|d| d.join("logs"))
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = tokio::fs::create_dir_all(&log_dir).await;
    let log_path = log_dir.join(format!("sherpa_debug_{ts}.log"));

    // Helper: append a line to the in-memory log buffer (flushed on completion).
    let mut log_buf = String::new();
    macro_rules! log_line {
        ($($arg:tt)*) => {{
            let s = format!($($arg)*);
            tracing::info!("[sherpa_log] {}", s);
            log_buf.push_str(&s);
            log_buf.push('\n');
        }};
    }

    log_line!("=== QafoneTools sherpa-onnx Debug Log ===");
    log_line!("Timestamp   : {ts}");
    log_line!("Model ID    : {model_id}");
    log_line!("Video path  : {video_path}");
    log_line!("Encoder     : {encoder_path}");
    log_line!("Decoder     : {decoder_path}");
    log_line!("Joiner      : {joiner_path}");
    log_line!("Tokens      : {tokens_path}");

    // Log file sizes for integrity check.
    for file in PARAKEET_MODEL_FILES {
        let path = model_dir.join(file);
        let size = tokio::fs::metadata(&path).await.map(|m| m.len()).unwrap_or(0);
        log_line!("File size   : {} = {} bytes", file, size);
    }

    // ── 3. Extract audio to temp WAV (16 kHz, mono) ───────────────────────
    let ffmpeg = resolve_ffmpeg_executable(app)
        .ok_or_else(|| "FFmpeg 未找到，请先在翻译页面下载 FFmpeg 工具。".to_string())?;

    let wav_path = std::env::temp_dir().join(format!("qafone_sherpa_{ts}.wav"));
    let wav_str = wav_path.to_string_lossy().to_string();

    log_line!("FFmpeg path : {:?}", ffmpeg);
    log_line!("WAV output  : {wav_str}");

    let ffmpeg_output = tokio::process::Command::new(&ffmpeg)
        .args([
            "-y",
            "-i", video_path,
            "-ac", "1",
            "-ar", "16000",
            "-vn",
            "-f", "wav",
            &wav_str,
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg 启动失败: {e}"))?;

    if !ffmpeg_output.status.success() {
        let ffmpeg_stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
        log_line!("FFmpeg exit : {}", ffmpeg_output.status);
        log_line!("FFmpeg stderr:\n{ffmpeg_stderr}");
        let _ = tokio::fs::write(&log_path, &log_buf).await;
        return Err(format!(
            "音频提取为 WAV 失败，请确认文件包含音频流。\n日志: {}",
            log_path.display()
        ));
    }
    log_line!("FFmpeg exit : success");

    // ── 4. Determine audio duration and split into chunks ────────────────
    // The INT8-quantized Parakeet TDT ONNX encoder was exported with a fixed
    // maximum relative-position embedding table of 251 entries, which at
    // 8× subsampling × 10 ms hop = 80 ms per encoder frame corresponds to
    // ~20 seconds of audio.  20 s is therefore the hard upper limit per chunk.
    // We use 18 s to stay comfortably under that ceiling.
    const CHUNK_SECS: f64 = 18.0;

    let duration_secs = get_audio_duration_secs(&ffmpeg, &wav_str).await;
    log_line!("Audio dur   : {:.1}s", duration_secs);

    let n_chunks = ((duration_secs / CHUNK_SECS).ceil() as usize).max(1);
    log_line!("Chunks      : {} (max {CHUNK_SECS}s each)", n_chunks);

    // ── 5. Extract all chunk WAVs, then run ONE sherpa batch call ─────────
    // Passing all chunk paths to a single sherpa invocation means the model
    // (encoder 652 MB) is loaded only once regardless of the number of chunks.
    let mut chunk_wav_paths: Vec<String> = Vec::new();
    let mut chunk_offsets: Vec<f64> = Vec::new();

    if n_chunks == 1 {
        // No chunking needed: use the full WAV directly.
        chunk_wav_paths.push(wav_str.clone());
        chunk_offsets.push(0.0);
    } else {
        for chunk_idx in 0..n_chunks {
            let chunk_start = chunk_idx as f64 * CHUNK_SECS;
            let chunk_dur = (duration_secs - chunk_start).min(CHUNK_SECS);
            let chunk_path = std::env::temp_dir()
                .join(format!("qafone_chunk_{ts}_{chunk_idx}.wav"));
            let chunk_str = chunk_path.to_string_lossy().to_string();

            log_line!(
                "Extracting chunk {}/{}: start={:.1}s len={:.1}s",
                chunk_idx + 1, n_chunks, chunk_start, chunk_dur
            );

            let chunk_out = tokio::process::Command::new(&ffmpeg)
                .args([
                    "-y",
                    "-i", &wav_str,
                    "-ss", &format!("{chunk_start:.3}"),
                    "-t",  &format!("{chunk_dur:.3}"),
                    "-c", "copy",
                    &chunk_str,
                ])
                .output()
                .await
                .map_err(|e| format!("FFmpeg 分块提取失败: {e}"))?;

            if chunk_out.status.success() {
                chunk_wav_paths.push(chunk_str);
                chunk_offsets.push(chunk_start);
            } else {
                log_line!(
                    "Chunk {}/{}: FFmpeg failed — skipping",
                    chunk_idx + 1, n_chunks
                );
            }
        }
    }

    log_line!(
        "Running sherpa batch: {} chunk(s)",
        chunk_wav_paths.len()
    );

    let batch_result = run_sidecar_batch(
        app,
        &encoder_path,
        &decoder_path,
        &joiner_path,
        &tokens_path,
        &chunk_wav_paths,
        &chunk_offsets,
    )
    .await;

    // Clean up all chunk WAVs and the full WAV.
    for p in &chunk_wav_paths {
        if p != &wav_str {
            let _ = tokio::fs::remove_file(p).await;
        }
    }
    let _ = tokio::fs::remove_file(&wav_path).await;

    let (all_records, combined_stdout, combined_stderr) = match batch_result {
        Ok(v) => v,
        Err(e) => {
            log_line!("Sherpa batch error: {}", e);
            let _ = tokio::fs::write(&log_path, &log_buf).await;
            let preview = if e.len() > 600 {
                format!("…{}", &e[e.len() - 600..])
            } else {
                e
            };
            return Err(format!(
                "sherpa-onnx 推理失败\n\
                 详细日志已写入:\n{}\n\n\
                 错误信息:\n{preview}",
                log_path.display()
            ));
        }
    };

    log_line!("--- stdout ---\n{combined_stdout}");
    let stderr_tail = if combined_stderr.len() > 2000 {
        &combined_stderr[combined_stderr.len() - 2000..]
    } else {
        &combined_stderr
    };
    log_line!("--- stderr (tail) ---\n{stderr_tail}");
    log_line!("Total records: {}", all_records.len());
    let _ = tokio::fs::write(&log_path, &log_buf).await;

    // ── 6. Build and return segments ──────────────────────────────────────
    if all_records.is_empty() {
        return Err(format!(
            "sherpa-onnx 未输出任何转录结果，请确认音频包含英文语音。\n日志: {}",
            log_path.display()
        ));
    }

    // If every record has empty text and no tokens, the audio is likely not in English.
    let non_empty_count = all_records.iter().filter(|r| !r.text.trim().is_empty()).count();
    if non_empty_count == 0 {
        return Err(format!(
            "Parakeet TDT 未识别到任何内容。该模型仅支持英语音频，请确认音频语言。\n日志: {}",
            log_path.display()
        ));
    }

    Ok(build_segments(all_records, 1))
}
