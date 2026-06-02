//! # asr.rs
//!
//! Automatic Speech Recognition — orchestrates FFmpeg audio extraction followed
//! by whisper.cpp inference (via the `whisper-rs` Rust bindings).
//!
//! ## Build requirements
//! - **cmake** (>=3.16) and a C++14-capable compiler must be present on the build
//!   machine so that whisper.cpp can be compiled from source during `cargo build`.
//!   - macOS : `xcode-select --install` or `brew install cmake`
//!   - Windows: Visual Studio Build Tools (MSVC, includes cmake)
//!   - Linux  : `sudo apt install cmake build-essential`
//!
//! ## Supported models
//! Only ggml-format Whisper models are supported (e.g. `tiny`, `base`, `large-v3-turbo`).
//! NVIDIA Parakeet models use a different architecture and are NOT compatible.

use std::sync::{atomic::{AtomicBool, Ordering}, Arc};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

// ─── Managed state ────────────────────────────────────────────────────────────

/// Global cancellation flag for the currently running ASR extraction.
/// Shared between the Tauri command thread and the whisper inference thread.
pub struct CancellationFlag(pub Arc<AtomicBool>);

use super::model_manager::get_model_path;
use super::video_compressor::resolve_ffmpeg_executable;

trait WhisperStateSegmentCompat {
    fn full_get_segment_text(&self, segment: i32) -> Result<String, String>;
    fn full_get_segment_t0(&self, segment: i32) -> Result<i64, String>;
    fn full_get_segment_t1(&self, segment: i32) -> Result<i64, String>;
}

impl WhisperStateSegmentCompat for whisper_rs::WhisperState {
    fn full_get_segment_text(&self, segment: i32) -> Result<String, String> {
        self.get_segment(segment)
            .ok_or_else(|| format!("segment {segment} out of bounds"))?
            .to_str()
            .map(str::to_owned)
            .map_err(|e| e.to_string())
    }

    fn full_get_segment_t0(&self, segment: i32) -> Result<i64, String> {
        Ok(self
            .get_segment(segment)
            .ok_or_else(|| format!("segment {segment} out of bounds"))?
            .start_timestamp())
    }

    fn full_get_segment_t1(&self, segment: i32) -> Result<i64, String> {
        Ok(self
            .get_segment(segment)
            .ok_or_else(|| format!("segment {segment} out of bounds"))?
            .end_timestamp())
    }
}

trait InfallibleI32MapErr {
    fn map_err<F, E>(self, _op: F) -> Result<i32, E>
    where
        F: FnOnce(String) -> E;
}

impl InfallibleI32MapErr for i32 {
    fn map_err<F, E>(self, _op: F) -> Result<i32, E>
    where
        F: FnOnce(String) -> E,
    {
        Ok(self)
    }
}

// ─── Public types ─────────────────────────────────────────────────────────────

/// A single transcribed segment, mirroring the SRT block structure.
///
/// Timestamps are in **milliseconds** (matching the `SrtEntry` type used by
/// WaveformDisplay and the translation page).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AsrSegment {
    /// 1-based sequential index (matches SRT block number).
    pub index: usize,
    /// Segment start time in milliseconds.
    pub start_ms: i64,
    /// Segment end time in milliseconds.
    pub end_ms: i64,
    /// Transcribed text (already trimmed).
    pub text: String,
}

/// Payload emitted on the `asr-progress` event channel.
#[derive(Debug, Clone, Serialize)]
pub struct AsrProgressPayload {
    /// Current processing phase.
    /// One of: `"audio_extract"` | `"transcribing"` | `"done"` | `"error"`.
    pub phase: String,
    /// Completion fraction for this phase, `0.0` – `1.0`.
    pub progress: f64,
    /// Human-readable status message.
    pub message: String,
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn emit_progress(app: &AppHandle, phase: &str, progress: f64, message: impl Into<String>) {
    let _ = app.emit(
        "asr-progress",
        AsrProgressPayload {
            phase: phase.to_string(),
            progress,
            message: message.into(),
        },
    );
}

// ─── Tauri command ────────────────────────────────────────────────────────────

/// **Extract subtitles from a video / audio file.**
///
/// Routes to the appropriate backend based on model type:
/// - **Whisper models** (`large-v3-turbo`, etc.): whisper.cpp via `whisper-rs`.
/// - **Parakeet models** (`parakeet-tdt-*`): `sherpa-onnx-offline` sidecar.
///
/// # Parameters
/// - `video_path`: Absolute path to the video / audio file.
/// - `model_id`  : Short model identifier, e.g. `"large-v3-turbo"` or
///                 `"parakeet-tdt-0.6b-v3"`.
/// - `language`  : BCP-47 language code or `None` for auto-detect (Whisper only).
/// Cancel any in-progress ASR extraction.
/// Sets the shared flag; the whisper thread checks it between chunks and
/// returns early with an `Err("已取消")` if set.
#[tauri::command]
pub async fn cancel_extraction(flag: tauri::State<'_, CancellationFlag>) -> Result<(), String> {
    flag.0.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn extract_subtitles(
    app: AppHandle,
    cancel_flag: tauri::State<'_, CancellationFlag>,
    video_path: String,
    model_id: String,
    language: Option<String>,
) -> Result<Vec<AsrSegment>, String> {
    // Reset cancellation flag before starting a new extraction.
    cancel_flag.0.store(false, Ordering::SeqCst);
    let cancel_arc = cancel_flag.0.clone();
    // ── Route: Parakeet → sherpa sidecar ──────────────────────────────────
    if model_id.starts_with("parakeet") {
        emit_progress(&app, "audio_extract", 0.0, "正在提取音频（WAV）…");
        let segments = super::sherpa_runner::run_sherpa(&app, &model_id, &video_path).await?;
        emit_progress(
            &app,
            "done",
            1.0,
            format!("Parakeet 转录完成，共识别 {} 条字幕。", segments.len()),
        );
        return Ok(segments);
    }

    // ── 1. Resolve paths ──────────────────────────────────────────────────
    let model_path = get_model_path(&app, &model_id).map_err(|e| e.to_string())?;

    if !model_path.exists() {
        return Err(format!(
            "模型文件不存在: {:?}\n请先在[模型管理]区域下载该模型。",
            model_path
        ));
    }

    let ffmpeg = resolve_ffmpeg_executable(&app)
        .ok_or_else(|| "FFmpeg 未找到，请先在翻译页面下载 FFmpeg 工具。".to_string())?;

    // ── 2. Extract audio (16 kHz, mono, f32le) via FFmpeg ─────────────────
    emit_progress(&app, "audio_extract", 0.0, "正在从视频中提取音频…");

    let ffmpeg_output = tokio::process::Command::new(&ffmpeg)
        .args([
            "-i",
            &video_path,
            "-ac",
            "1",      // mono
            "-ar",
            "16000",  // 16 kHz
            "-vn",    // skip video stream
            "-f",
            "f32le",  // 32-bit little-endian float PCM
            "pipe:1", // write to stdout
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg 启动失败: {e}"))?;

    if !ffmpeg_output.status.success() {
        let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
        // Show only the last 400 chars of stderr to keep the error message short.
        let tail = if stderr.len() > 400 {
            &stderr[stderr.len() - 400..]
        } else {
            &stderr
        };
        return Err(format!("FFmpeg 音频提取失败:\n{tail}"));
    }

    // Convert raw bytes → Vec<f32>
    let raw = &ffmpeg_output.stdout;
    if raw.len() < 4 {
        return Err("未能从文件中提取到有效音频数据，请确认文件包含音频流。".to_string());
    }

    let samples: Vec<f32> = raw
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();

    emit_progress(
        &app,
        "audio_extract",
        1.0,
        format!("音频提取完成（{:.1} 秒）", samples.len() as f64 / 16000.0),
    );

    // ── 3. Run whisper inference on a dedicated thread with large stack ──────
    // whisper.cpp's encoder/decoder passes use >8 MB of stack space, which
    // causes a stack overflow when run on the default Tokio/OS thread stack.
    // We spawn an explicit thread with a 64 MB stack as the workaround.
    //
    // Performance design (matching VoiceInk's approach):
    //   • best_of=1  — single decoder pass per 30-second window (vs. best_of=5 = 5×)
    //   • Single state.full() call on full audio — whisper handles internal 30s windows
    //   • temperature=0.2, temperature_inc=0 — no fallback retry passes
    // Combined speedup: typically 5-10× over the previous chunk-loop approach.
    emit_progress(&app, "transcribing", 0.0, "正在加载模型并开始转录…");

    let model_path_str = model_path.to_string_lossy().to_string();
    let lang_opt = language.clone();
    let app_for_thread = app.clone();

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<AsrSegment>, String>>();

    std::thread::Builder::new()
        .name("whisper-inference".to_string())
        .stack_size(64 * 1024 * 1024) // 64 MB — avoids stack overflow in whisper encoder
        .spawn(move || {
            use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

            let result = (|| -> Result<Vec<AsrSegment>, String> {
                // Check cancellation before starting the (potentially long) inference.
                if cancel_arc.load(Ordering::SeqCst) {
                    return Err("已取消".to_string());
                }

                // Load the ggml model.
                // On macOS, enable Metal GPU acceleration (Flash Attention) —
                // this is the same flag VoiceInk uses and gives a 10-20x
                // speedup over CPU-only inference on Apple Silicon.
                let ctx_params = WhisperContextParameters::default();
                #[cfg(target_os = "macos")]
                {
                    ctx_params.use_gpu = true;
                    ctx_params.flash_attn = true;
                }

                let ctx = WhisperContext::new_with_params(&model_path_str, ctx_params)
                    .map_err(|e| format!("模型加载失败: {e}"))?;

                let mut state = ctx
                    .create_state()
                    .map_err(|e| format!("推理状态初始化失败: {e}"))?;

                // Configure inference parameters (mirrors VoiceInk's LibWhisper.swift).
                //
                // Key performance choices:
                //   best_of=1      — one decoder pass per window (VoiceInk default)
                //   temperature=0.2 — fixed, no temperature fallback retries
                //   temperature_inc=0 — disables the fallback retry mechanism entirely
                //   no_speech_thold — whisper's own filter for silent/noise windows
                //
                // We no longer pre-split the audio with a custom Rust VAD. Instead we
                // pass the full audio buffer and let whisper handle its own internal
                // 30-second windowing. This eliminates repeated encoder initializations
                // and matches how VoiceInk (whisper_full one-shot) works.
                let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
                params.set_print_special(false);
                params.set_print_progress(false);
                params.set_print_realtime(false);
                params.set_print_timestamps(true);
                params.set_single_segment(false);
                params.set_token_timestamps(false);
                params.set_suppress_blank(true);
                params.set_no_context(true);
                params.set_temperature(0.2f32);
                params.set_temperature_inc(0.0f32);      // no fallback retry
                params.set_no_speech_thold(0.6f32);
                params.set_suppress_nst(true);

                // Mirror VoiceInk's thread formula: max(1, min(8, cpu_count - 2)).
                let n_threads = std::thread::available_parallelism()
                    .map(|n| n.get())
                    .unwrap_or(4)
                    .min(8)
                    .saturating_sub(2)
                    .max(1) as i32;
                params.set_n_threads(n_threads);

                // Language: None / "auto" / empty → whisper auto-detects
                match lang_opt.as_deref() {
                    Some(l) if !l.is_empty() && !l.eq_ignore_ascii_case("auto") => {
                        params.set_language(Some(l));
                    }
                    _ => {
                        params.set_language(None); // auto-detect
                    }
                }

                // NOTE: Do NOT use set_progress_callback_safe here.
                // whisper-rs stores the callback as a raw pointer to a field inside
                // FullParams. When params is moved into state.full(), that pointer
                // becomes dangling, causing a PAC (Pointer Authentication Code)
                // failure on Apple Silicon → SIGSEGV.

                let _ = app_for_thread.emit(
                    "asr-progress",
                    AsrProgressPayload {
                        phase: "transcribing".to_string(),
                        progress: 0.1,
                        message: "正在转录音频，请稍候…".to_string(),
                    },
                );

                // ── Single-pass inference on full audio ───────────────────────
                // whisper.cpp internally processes the audio in sequential 30-second
                // windows with cross-attention context carried between windows.
                state
                    .full(params, &samples)
                    .map_err(|e| format!("转录推理失败: {e}"))?;

                let _ = app_for_thread.emit(
                    "asr-progress",
                    AsrProgressPayload {
                        phase: "transcribing".to_string(),
                        progress: 0.95,
                        message: "转录完成，正在整理结果…".to_string(),
                    },
                );

                // Collect raw segments from whisper output.
                let n_segs = state
                    .full_n_segments()
                    .map_err(|e| format!("读取片段数量失败: {e}"))?;

                let mut raw: Vec<(i64, i64, String)> = Vec::with_capacity(n_segs as usize);
                for i in 0..n_segs {
                    let raw_text = state
                        .full_get_segment_text(i)
                        .map_err(|e| format!("读取片段 {i} 文本失败: {e}"))?;
                    let start_ms = state
                        .full_get_segment_t0(i)
                        .map_err(|e| format!("读取片段 {i} 开始时间失败: {e}"))?
                        * 10;
                    let end_ms = state
                        .full_get_segment_t1(i)
                        .map_err(|e| format!("读取片段 {i} 结束时间失败: {e}"))?
                        * 10;

                    if let Some(cleaned) = clean_segment_text(&raw_text) {
                        raw.push((start_ms, end_ms, cleaned));
                    }
                }

                // Remove duplicate and repetitive segments.
                //
                // Step 1: Remove consecutive exact duplicates.
                // Step 2: Remove cyclic repetition loops — if the last N distinct
                //         segments form a repeating pattern (same set of texts
                //         cycling), the entire loop is dropped.
                let mut result: Vec<AsrSegment> = Vec::with_capacity(raw.len());
                let mut last_text = String::new();
                for (start_ms, end_ms, text) in raw {
                    let normalized = text.to_lowercase();

                    // Step 1: skip consecutive exact duplicate
                    if normalized == last_text {
                        continue;
                    }
                    last_text = normalized;
                    result.push(AsrSegment {
                        index: result.len() + 1,
                        start_ms,
                        end_ms,
                        text,
                    });
                }

                // Step 2: detect and strip a cyclic repetition suffix.
                // Check whether the tail of `result` is a repeated cycle of period
                // 1..=MAX_PERIOD. If found, keep only one full cycle.
                const MAX_PERIOD: usize = 8;
                let n = result.len();
                'outer: for period in 1..=MAX_PERIOD.min(n / 2) {
                    // Need at least 3 full cycles to be confident it is a loop.
                    let min_reps = 3;
                    if n < period * min_reps {
                        continue;
                    }
                    let cycle_start = n - period * min_reps;
                    let mut is_cycle = true;
                    for i in cycle_start..n {
                        let a = result[i].text.to_lowercase();
                        let b = result[cycle_start + (i - cycle_start) % period]
                            .text
                            .to_lowercase();
                        if a != b {
                            is_cycle = false;
                            break;
                        }
                    }
                    if is_cycle {
                        // Keep only up to the start of the repeating section.
                        result.truncate(cycle_start);
                        break 'outer;
                    }
                }

                // Re-index after potential truncation.
                for (i, seg) in result.iter_mut().enumerate() {
                    seg.index = i + 1;
                }

                Ok(result)
            })();

            let _ = tx.send(result);
        })
        .map_err(|e| format!("无法创建推理线程: {e}"))?;

    let segments = rx
        .await
        .map_err(|_| "推理线程意外退出".to_string())??;

    emit_progress(
        &app,
        "done",
        1.0,
        format!("转录完成，共识别 {} 条字幕。", segments.len()),
    );

    Ok(segments)
}

// ─── Post-processing helpers ──────────────────────────────────────────────────

/// Clean a raw whisper segment text.
///
/// Returns `None` if the segment should be discarded entirely (empty, music,
/// sound-effect notation, etc.).  Returns `Some(cleaned)` otherwise.
fn clean_segment_text(raw: &str) -> Option<String> {
    // 1. Trim surrounding whitespace
    let t = raw.trim();

    // 2. Strip leading dash / em-dash / en-dash markers (e.g. "- Text", "– Text")
    let t = t
        .trim_start_matches(|c: char| c == '-' || c == '\u{2013}' || c == '\u{2014}')
        .trim_start();

    // 3. Strip surrounding asterisks used for sound/music cues ("* Music *")
    let t = t.trim_matches('*').trim();

    // 4. Strip surrounding brackets / parens ("(Music)", "[Music]")
    let t = if t.starts_with('[') && t.ends_with(']') {
        t[1..t.len() - 1].trim()
    } else if t.starts_with('(') && t.ends_with(')') {
        t[1..t.len() - 1].trim()
    } else {
        t
    };

    // 5. Discard if empty after stripping
    if t.is_empty() {
        return None;
    }

    // 6. Discard if every character is non-alphanumeric (pure symbols)
    if !t.chars().any(|c| c.is_alphanumeric()) {
        return None;
    }

    // 7. Discard music / sound-effect segments
    let lower = t.to_lowercase();
    let noise_patterns = [
        "music", "musik", "musique", "música", "muziek", "musiikki", "música",
        "♪", "♫", "🎵", "🎶",
        "[music]", "[applause]", "[laughter]", "[noise]",
        "(music)", "(applause)", "(laughter)",
    ];
    if noise_patterns.iter().any(|p| lower.contains(p)) {
        return None;
    }

    // 8. Discard if it's only a single special token remnant like "[_TT_xxx]"
    if t.starts_with("[_") && t.ends_with(']') {
        return None;
    }

    Some(t.to_string())
}
