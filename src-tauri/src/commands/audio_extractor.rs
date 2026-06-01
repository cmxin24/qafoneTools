//! audio_extractor.rs
//!
//! FFmpeg-based audio track extraction from video/audio container files.
//!
//! ## Commands
//! - `get_audio_tracks`    — probe the file and return all audio stream metadata
//! - `preview_audio_track` — extract a 30-second clip to a temp file for audition
//! - `extract_audio_track` — full extraction with real-time progress events

use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::commands::video_compressor::resolve_ffmpeg_executable;

// ─── Data types ────────────────────────────────────────────────────────────────

/// Metadata for a single audio stream inside a container file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioTrackInfo {
    /// 0-based index among audio streams (used as `0:a:<index>` map argument)
    pub index: u32,
    /// Codec name, e.g. "aac", "ac3", "flac", "dts"
    pub codec: String,
    /// Number of audio channels
    pub channels: u32,
    /// Channel layout string, e.g. "stereo", "5.1(side)"
    pub channel_layout: String,
    /// Sample rate in Hz, e.g. 48000
    pub sample_rate: u32,
    /// Approximate bitrate in kbps (0 if unknown)
    pub bit_rate_kbps: u32,
    /// BCP-47 language tag from container metadata, e.g. "jpn", "eng" (empty if unknown)
    pub language: String,
    /// Optional track title from container metadata
    pub title: String,
    /// Total media duration in seconds (same for all tracks in a file)
    pub duration_secs: f64,
}

/// Payload for the `audio-extract-progress` Tauri event.
#[derive(Clone, Serialize, Deserialize)]
pub struct AudioExtractProgressPayload {
    /// "extracting" | "done" | "error"
    pub phase: String,
    /// Progress percentage 0.0 – 100.0
    pub progress_pct: f64,
    pub message: String,
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/// Parse the total duration from ffmpeg -i stderr output.
///
/// Looks for a line matching `Duration: HH:MM:SS.ss, ...`
fn parse_duration_secs(stderr: &str) -> f64 {
    for line in stderr.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Duration:") {
            let time_str = rest.split(',').next().unwrap_or("").trim();
            if time_str == "N/A" {
                return 0.0;
            }
            let parts: Vec<&str> = time_str.split(':').collect();
            if parts.len() == 3 {
                let h: f64 = parts[0].parse().unwrap_or(0.0);
                let m: f64 = parts[1].parse().unwrap_or(0.0);
                let s: f64 = parts[2].parse().unwrap_or(0.0);
                return h * 3600.0 + m * 60.0 + s;
            }
        }
    }
    0.0
}

/// Parse `time=HH:MM:SS.ss` from an ffmpeg progress line into seconds.
fn parse_ffmpeg_time_secs(line: &str) -> Option<f64> {
    let idx = line.find("time=")?;
    let rest = &line[idx + 5..];
    let time_str = rest.split_whitespace().next()?.trim();
    if time_str == "N/A" {
        return None;
    }
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().ok()?;
        let m: f64 = parts[1].parse().ok()?;
        let s: f64 = parts[2].parse().ok()?;
        Some(h * 3600.0 + m * 60.0 + s)
    } else {
        None
    }
}

/// Parse audio stream lines from `ffmpeg -i <file>` stderr output.
///
/// Example lines (indented in real output):
/// ```text
///     Stream #0:1(jpn): Audio: aac, 48000 Hz, stereo, fltp, 128 kb/s
///       Metadata:
///         title           : Japanese 2.0
/// ```
fn parse_audio_tracks(stderr: &str) -> Vec<AudioTrackInfo> {
    let mut tracks: Vec<AudioTrackInfo> = Vec::new();
    let mut audio_index = 0u32;
    let lines: Vec<&str> = stderr.lines().collect();
    let n = lines.len();
    let mut i = 0;

    while i < n {
        let raw_line = lines[i];
        let trimmed = raw_line.trim();

        if trimmed.contains(": Audio:") {
            // Extract language tag from "(tag)" in stream header, e.g. "Stream #0:1(jpn):"
            let audio_marker_pos = trimmed.find(": Audio:").unwrap_or(trimmed.len());
            let header = &trimmed[..audio_marker_pos];
            let language = if let (Some(start), Some(end)) = (header.rfind('('), header.rfind(')')) {
                if start < end {
                    header[start + 1..end].to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            };

            // Parse codec, sample_rate, channel_layout, sample_fmt?, bitrate
            let audio_part = match trimmed.find(": Audio: ") {
                Some(idx) => &trimmed[idx + 9..],
                None => {
                    i += 1;
                    continue;
                }
            };
            // Split by ", " — use splitn to keep the last part intact for bitrate
            let parts: Vec<&str> = audio_part.splitn(6, ", ").collect();

            let codec = parts.first().map(|s| {
                // Strip parenthetical profile info: "aac (LC)" → "aac"
                s.split('(').next().unwrap_or(s).trim().to_string()
            }).unwrap_or_default();

            let sample_rate = parts.get(1).and_then(|s| {
                s.split_whitespace().next()?.parse::<u32>().ok()
            }).unwrap_or(0);

            let channel_layout = parts.get(2).map(|s| s.trim().to_string()).unwrap_or_default();

            let channels: u32 = match channel_layout.as_str() {
                "mono"                      => 1,
                "stereo"                    => 2,
                l if l.starts_with("5.1")   => 6,
                l if l.starts_with("7.1")   => 8,
                l if l.starts_with("4.0")   => 4,
                l if l.starts_with("6.1")   => 7,
                _ => channel_layout
                    .chars()
                    .next()
                    .and_then(|c| c.to_digit(10))
                    .unwrap_or(2),
            };

            // Bitrate may be in any position from index 3 onwards
            let bit_rate_kbps = parts.iter().skip(3).find_map(|s| {
                if s.contains("kb/s") {
                    s.split_whitespace().next()?.parse::<u32>().ok()
                } else {
                    None
                }
            }).unwrap_or(0);

            // Look ahead for a Metadata: block belonging to this stream
            let mut title = String::new();
            let mut j = i + 1;
            while j < n {
                let next_raw = lines[j];
                let next_t = next_raw.trim();

                if next_t.is_empty() {
                    j += 1;
                    continue;
                }
                // Metadata block must be indented (belongs to a stream)
                if next_t == "Metadata:"
                    && (next_raw.starts_with("    ") || next_raw.starts_with('\t'))
                {
                    j += 1;
                    while j < n {
                        let meta_raw = lines[j];
                        let meta_t = meta_raw.trim();
                        // Stop when indentation decreases back to stream level
                        if !meta_raw.starts_with("      ") && !meta_raw.starts_with('\t') {
                            break;
                        }
                        if let Some(colon) = meta_t.find(':') {
                            let key = meta_t[..colon].trim().to_lowercase();
                            let val = meta_t[colon + 1..].trim().to_string();
                            if key == "title" && !val.is_empty() {
                                title = val;
                                break;
                            }
                        }
                        j += 1;
                    }
                    break;
                } else if next_t.starts_with("Stream #") {
                    break;
                } else {
                    // Non-stream, non-metadata line → stop looking
                    break;
                }
            }

            tracks.push(AudioTrackInfo {
                index: audio_index,
                codec,
                channels,
                channel_layout,
                sample_rate,
                bit_rate_kbps,
                language,
                title,
                duration_secs: 0.0, // filled by caller after parse_duration_secs
            });
            audio_index += 1;
        }

        i += 1;
    }

    tracks
}

// ─── Tauri commands ────────────────────────────────────────────────────────────

/// Probe the given file with `ffmpeg -i` and return all audio stream metadata.
#[tauri::command]
pub async fn get_audio_tracks(
    app: AppHandle,
    input_path: String,
) -> Result<Vec<AudioTrackInfo>, String> {
    let ffmpeg =
        resolve_ffmpeg_executable(&app).ok_or_else(|| "FFmpeg 未找到".to_string())?;

    // `ffmpeg -i <file>` exits with code 1 but writes full stream info to stderr
    let output = tokio::process::Command::new(&ffmpeg)
        .args(["-i", &input_path])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("FFmpeg 运行失败: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let duration = parse_duration_secs(&stderr);
    let mut tracks = parse_audio_tracks(&stderr);

    for track in &mut tracks {
        track.duration_secs = duration;
    }

    Ok(tracks)
}

/// Extract a 30-second preview clip of the given audio track to a temp file.
///
/// - `start_secs`: Starting position within the source file (default 0.0).
///   Allows the user to seek to a later part of the audio before previewing.
///
/// Returns the absolute path to the generated M4A file, which the frontend
/// can convert to a playable URL with `convertFileSrc` from `@tauri-apps/api`.
#[tauri::command]
pub async fn preview_audio_track(
    app: AppHandle,
    input_path: String,
    audio_index: u32,
    start_secs: f64,
) -> Result<String, String> {
    let ffmpeg =
        resolve_ffmpeg_executable(&app).ok_or_else(|| "FFmpeg 未找到".to_string())?;

    let temp_dir = std::env::temp_dir();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let preview_file = temp_dir.join(format!("qafone_prev_{audio_index}_{ts}.m4a"));
    let preview_path = preview_file.to_string_lossy().to_string();

    // Use input-side seeking (-ss before -i) for fast keyframe-level seek,
    // then re-encode from there so the M4A starts at exactly `start_secs`.
    let start_str = format!("{:.3}", start_secs.max(0.0));

    let status = tokio::process::Command::new(&ffmpeg)
        .args([
            "-ss",
            &start_str,
            "-i",
            &input_path,
            "-map",
            &format!("0:a:{audio_index}"),
            "-t",
            "30",
            "-c:a",
            "aac",
            "-ar",
            "44100",
            "-y",
            &preview_path,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("FFmpeg 运行失败: {e}"))?;

    if !status.success() {
        return Err("预览音轨提取失败，请确认文件格式受支持".to_string());
    }

    Ok(preview_path)
}

/// Extract the selected audio track to the specified output file.
///
/// `format`        — one of "mp3" | "aac" | "flac" | "wav"  
/// `bit_rate_kbps` — target bitrate for mp3/aac (e.g. 192); ignored for flac/wav  
/// `duration_secs` — total media duration (used for progress percentage)
///
/// Emits `audio-extract-progress` events during encoding.
#[tauri::command]
pub async fn extract_audio_track(
    app: AppHandle,
    input_path: String,
    audio_index: u32,
    output_path: String,
    format: String,
    bit_rate_kbps: u32,
    duration_secs: f64,
) -> Result<(), String> {
    let ffmpeg =
        resolve_ffmpeg_executable(&app).ok_or_else(|| "FFmpeg 未找到".to_string())?;

    // Build codec-specific args
    let codec_args: Vec<String> = match format.as_str() {
        "mp3"  => vec!["-c:a".into(), "libmp3lame".into(), "-b:a".into(), format!("{bit_rate_kbps}k")],
        "aac"  => vec!["-c:a".into(), "aac".into(),        "-b:a".into(), format!("{bit_rate_kbps}k")],
        "flac" => vec!["-c:a".into(), "flac".into()],
        "wav"  => vec!["-c:a".into(), "pcm_s16le".into()],
        other  => return Err(format!("不支持的输出格式: {other}")),
    };

    let emit = |pct: f64, msg: String| {
        let _ = app.emit(
            "audio-extract-progress",
            AudioExtractProgressPayload {
                phase: if pct >= 100.0 { "done".into() } else { "extracting".into() },
                progress_pct: pct,
                message: msg,
            },
        );
    };

    emit(0.0, "正在提取音频…".into());

    // Build full argument list
    let mut args: Vec<String> = vec![
        "-i".into(), input_path,
        "-map".into(), format!("0:a:{audio_index}"),
        "-vn".into(),
    ];
    args.extend(codec_args);
    args.extend(["-progress".into(), "pipe:1".into(), "-y".into(), output_path]);

    let mut child = tokio::process::Command::new(&ffmpeg)
        .args(&args)
        .stdout(Stdio::piped()) // progress goes to stdout via "-progress pipe:1"
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("FFmpeg 启动失败: {e}"))?;

    // Read stdout for progress key=value pairs emitted by "-progress pipe:1"
    if let Some(stdout) = child.stdout.take() {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(secs) = parse_ffmpeg_time_secs(&line) {
                if duration_secs > 0.0 {
                    let pct = (secs / duration_secs * 100.0).min(99.0);
                    emit(pct, "正在提取音频…".into());
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("FFmpeg 等待失败: {e}"))?;

    if !status.success() {
        return Err("音频提取失败，请检查输入文件格式".to_string());
    }

    emit(100.0, "提取完成".into());
    Ok(())
}
