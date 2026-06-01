//! # waveform.rs
//!
//! 负责使用 FFmpeg 从视频文件提取音频波形峰值数据，供前端波形图渲染使用。
//!
//! ## 流程
//! 1. 定位本地 FFmpeg 二进制（与 video_compressor.rs 相同路径）
//! 2. 运行 `ffmpeg -i <video> -ac 1 -ar <rate> -vn -f f32le pipe:1`
//! 3. 将 stdout 字节流解析为 f32 样本序列
//! 4. 对每个采样窗口取绝对值最大值（峰值）
//! 5. 归一化到 0.0..1.0 返回

use tauri::AppHandle;
use super::video_compressor::resolve_ffmpeg_executable;

/// 从视频文件提取归一化音频波形峰值。
///
/// * `video_path`    - 视频文件的绝对路径
/// * `samples_per_second` - 每秒输出的波形采样点数（建议 100）
///
/// 返回值：归一化到 \[0, 1\] 的 f32 数组，长度约为 `duration × samples_per_second`。
#[tauri::command]
pub async fn extract_waveform(
    app: AppHandle,
    video_path: String,
    samples_per_second: u32,
) -> Result<Vec<f32>, String> {
    // 定位 FFmpeg
    let ffmpeg_path = resolve_ffmpeg_executable(&app)
        .ok_or_else(|| "FFmpeg 未找到，请先下载 FFmpeg".to_string())?;

    // 限制采样率范围，防止数据量过大
    let rate = samples_per_second.clamp(10, 500);

    // Extract at 8 kHz — high enough to capture envelope, low enough for fast I/O.
    // We then compute the peak amplitude per output window (1/rate seconds wide).
    let pcm_rate: u32 = 8000;
    let samples_per_peak = (pcm_rate as usize) / (rate as usize).max(1);

    let output = tokio::process::Command::new(ffmpeg_path)
        .args([
            "-i", &video_path,
            "-ac", "1",
            "-ar", &pcm_rate.to_string(),
            "-vn",
            "-f", "f32le",
            "pipe:1",
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg 启动失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg 返回错误: {}", &stderr[stderr.len().saturating_sub(400)..]))
    }

    let bytes = &output.stdout;
    if bytes.is_empty() {
        return Err("FFmpeg 未输出任何音频数据".to_string());
    }

    // Parse raw PCM bytes into f32 samples
    let pcm: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();

    // Compute peak amplitude per output window
    let peaks: Vec<f32> = pcm
        .chunks(samples_per_peak.max(1))
        .map(|chunk| chunk.iter().cloned().map(f32::abs).fold(0.0_f32, f32::max))
        .collect();

    // Normalise to [0, 1]
    let max_peak = peaks.iter().cloned().fold(0.0_f32, f32::max);
    if max_peak < 1e-10 {
        return Ok(vec![0.0; peaks.len()]);
    }

    Ok(peaks.iter().map(|&v| v / max_peak).collect())
}
