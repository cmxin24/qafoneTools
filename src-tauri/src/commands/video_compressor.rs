//! # video_compressor.rs
//!
//! 负责 FFmpeg 的 **状态检测**、**下载** 以及 **视频小版本压制**。
//!
//! ## 压制流程
//! 1. **读取时长**：通过 FFmpeg 探测输入视频总时长，用于计算转码进度。
//! 2. **编码**：使用 x264（CRF 22，preset slow，profile high）和 AAC 256kbps
//!    输出 MP4，缩放到目标高度同时保持宽高比，宽度自动补齐为 2 的倍数（`scale=-2:height`）。
//! 3. **进度追踪**：解析 FFmpeg progress 输出中的 `out_time` / `time` 字段，
//!    结合视频总时长计算百分比，通过 `video-compress-progress` 事件推送前端。

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;

use anyhow::{Context, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};

// ─── CDN 配置 ──────────────────────────────────────────────────────────────────

/// 支持的操作系统 + 架构组合，对应不同的静态构建下载地址。
#[derive(Debug)]
enum FfmpegBuild {
    MacOsArm64,
    MacOsX86_64,
    WindowsX86_64,
    LinuxX86_64,
}

impl FfmpegBuild {
    fn detect() -> Self {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => Self::MacOsArm64,
            ("macos", _)         => Self::MacOsX86_64,
            ("windows", _)       => Self::WindowsX86_64,
            _                    => Self::LinuxX86_64,
        }
    }

    /// 返回静态构建的下载 URL 及解压后二进制文件名。
    ///
    /// * macOS: <https://evermeet.cx/ffmpeg/>（预编译静态包，无需 libssl）
    /// * Windows: <https://www.gyan.dev/ffmpeg/builds/>
    /// * Linux: John Van Sickle 静态构建
    fn download_url(&self) -> (&'static str, &'static str) {
        match self {
            Self::MacOsArm64    => ("https://evermeet.cx/pub/ffmpeg/ffmpeg-7.1.1.zip",                                         "ffmpeg"),
            Self::MacOsX86_64   => ("https://evermeet.cx/pub/ffmpeg/ffmpeg-7.1.1.zip",                                         "ffmpeg"),
            Self::WindowsX86_64 => ("https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",                        "ffmpeg.exe"),
            Self::LinuxX86_64   => ("https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz",            "ffmpeg"),
        }
    }
}

// ─── 事件 payload ──────────────────────────────────────────────────────────────

/// FFmpeg 下载进度事件 payload（前端监听 `ffmpeg-download-progress`）。
#[derive(Clone, Serialize, Deserialize)]
pub struct FfmpegDownloadProgressPayload {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
    pub speed_bps: f64,
    pub cdn_source: String,
}

/// 视频压制进度事件 payload（前端监听 `video-compress-progress`）。
#[derive(Clone, Serialize, Deserialize)]
pub struct VideoCompressProgressPayload {
    /// 当前阶段："preparing" | "encoding" | "done" | "canceled" | "error"
    pub phase: String,
    /// 当前阶段完成百分比（0.0 ~ 100.0）
    pub progress_pct: f64,
}

#[derive(Debug)]
struct ActiveVideoCompression {
    pid: u32,
    paused: bool,
    cancel_requested: bool,
}

/// 当前小版本压制任务状态，用于暂停、继续和取消正在运行的 FFmpeg 子进程。
#[derive(Default)]
pub struct VideoCompressionState {
    active: Arc<Mutex<Option<ActiveVideoCompression>>>,
}

impl VideoCompressionState {
    async fn start(&self, pid: u32) -> Result<(), String> {
        let mut active = self.active.lock().await;
        if active.is_some() {
            return Err("已有小版本压制任务正在运行".to_string());
        }
        *active = Some(ActiveVideoCompression {
            pid,
            paused: false,
            cancel_requested: false,
        });
        Ok(())
    }

    async fn finish(&self) -> bool {
        let mut active = self.active.lock().await;
        active
            .take()
            .map(|task| task.cancel_requested)
            .unwrap_or(false)
    }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

/// 获取 FFmpeg 二进制在应用数据目录中的存放路径。
fn ffmpeg_bin_path(app: &AppHandle) -> Result<PathBuf> {
    let bin_name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let path = app
        .path()
        .app_data_dir()
        .context("无法获取应用数据目录")?
        .join("bin")
        .join(bin_name);
    Ok(path)
}

/// 检查系统 PATH 或应用数据目录中是否存在可用的 ffmpeg 二进制。
///
/// 检测顺序：
/// 1. 应用数据目录中的自带静态包（由 `download_ffmpeg` 命令写入）
/// 2. 常见系统安装路径（Homebrew / apt / snap 等）
///    macOS 的 GUI 应用不继承 shell 的 $PATH，必须显式检查
/// 3. 通过 `which` / `where` 查询当前进程的 PATH 环境变量
pub(crate) fn resolve_ffmpeg_executable(app: &AppHandle) -> Option<PathBuf> {
    // 1. 先检查应用自带的 ffmpeg
    if let Ok(bundled) = ffmpeg_bin_path(app) {
        if bundled.exists() {
            return Some(bundled);
        }
    }

    // 2. 检查常见系统路径（macOS GUI 应用无法继承完整 shell PATH）
    #[cfg(not(windows))]
    {
        let common: &[&str] = &[
            "/opt/homebrew/bin/ffmpeg",   // Apple Silicon — Homebrew
            "/usr/local/bin/ffmpeg",      // Intel macOS — Homebrew / 手动编译
            "/usr/bin/ffmpeg",            // Linux — apt / dnf
            "/snap/bin/ffmpeg",           // Linux — snap
            "/nix/var/nix/profiles/default/bin/ffmpeg", // Nix
        ];
        for &p in common {
            let path = PathBuf::from(p);
            if path.exists() {
                return Some(path);
            }
        }
    }

    // 3. 通过 which / where 查询进程 PATH
    let which_cmd = if cfg!(windows) { "where" } else { "which" };
    if let Ok(output) = std::process::Command::new(which_cmd).arg("ffmpeg").output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path_str.is_empty() {
                return Some(PathBuf::from(path_str));
            }
        }
    }

    None
}

// ─── Tauri 命令 ────────────────────────────────────────────────────────────────

/// **检测 FFmpeg 是否可用**
///
/// 优先检查应用数据目录中的静态构建，其次检查系统 PATH。
#[tauri::command]
pub async fn check_ffmpeg_status(app: AppHandle) -> Result<bool, String> {
    Ok(resolve_ffmpeg_executable(&app).is_some())
}

/// **下载 FFmpeg 静态构建**
///
/// 根据当前平台（macOS arm64/x86、Windows、Linux）选择对应的静态包下载并解压。
/// 下载进度通过 `ffmpeg-download-progress` 事件实时推送前端。
#[tauri::command]
pub async fn download_ffmpeg(app: AppHandle) -> Result<(), String> {
    let build = FfmpegBuild::detect();
    let (url, _bin_name) = build.download_url();

    // 准备目标目录
    let bin_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bin");
    fs::create_dir_all(&bin_dir)
        .await
        .map_err(|e| format!("创建 bin 目录失败: {e}"))?;

    // HTTP 客户端
    let client = Client::builder()
        .user_agent("qafone-tools/1.0 (ffmpeg-downloader)")
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;

    // 发起流式下载
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求 FFmpeg 下载失败: {e}"))?;
    let content_length = response.content_length().unwrap_or(80 * 1024 * 1024);

    // 将压缩包写入临时文件
    let archive_path = bin_dir.join("ffmpeg_download.tmp");
    let mut file = fs::File::create(&archive_path)
        .await
        .map_err(|e| format!("创建临时文件失败: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let start = Instant::now();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取下载流失败: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入临时文件失败: {e}"))?;
        downloaded += chunk.len() as u64;

        let elapsed = start.elapsed().as_secs_f64().max(f64::EPSILON);
        let speed_bps = downloaded as f64 / elapsed;
        let percentage = (downloaded as f64 / content_length as f64 * 100.0).min(100.0);

        let _ = app.emit(
            "ffmpeg-download-progress",
            FfmpegDownloadProgressPayload {
                downloaded,
                total: content_length,
                percentage,
                speed_bps,
                cdn_source: "evermeet".to_string(),
            },
        );
    }
    file.flush().await.map_err(|e| format!("刷新文件失败: {e}"))?;

    // TODO: 解压 archive_path（zip/tar.xz），将 ffmpeg 二进制移到 bin_dir/ffmpeg
    // 此处保留为骨架，具体解压逻辑需依赖 zip / flate2 + tar crate
    tracing::info!("FFmpeg 下载完成，待解压: {:?}", archive_path);

    Ok(())
}

/// **压制视频为小版本**
///
/// 流程：
/// 1. 探测输入视频总时长，发送 `video-compress-progress { phase: "preparing" }` 事件
/// 2. 运行编码：`-vf "scale=-2:target_height" -c:v libx264 -crf 22 -preset slow -profile:v high ...`
///    实时解析 FFmpeg progress 输出推算进度，发送 `video-compress-progress { phase: "encoding" }` 事件
/// 3. 完成后返回输出文件路径
///
/// # 参数
/// - `input_path`: 输入视频绝对路径
/// - `target_height`: 目标高度（360/480/540/720）
///
/// # 返回
/// 输出文件的绝对路径字符串
#[tauri::command]
pub async fn compress_video(
    app: AppHandle,
    state: tauri::State<'_, VideoCompressionState>,
    input_path: String,
    output_path: String,
    target_height: u32,
) -> Result<String, String> {
    let ffmpeg = resolve_ffmpeg_executable(&app)
        .ok_or_else(|| "FFmpeg 未找到，请先下载".to_string())?;

    let input = PathBuf::from(&input_path);
    if !input.exists() {
        return Err(format!("输入文件不存在: {input_path}"));
    }

    // ── 1. 构造输出路径（优先使用前端传入的路径，否则默认加 _小版本 后缀；固定 MP4）────
    let mut resolved_output = if output_path.trim().is_empty() {
        let stem = input.file_stem().unwrap_or_default().to_string_lossy();
        input
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join(format!("{stem}_小版本.mp4"))
    } else {
        PathBuf::from(&output_path)
    };
    resolved_output.set_extension("mp4");

    // ── 2. 读取视频信息 ───────────────────────────────────────────────────
    emit_compress_progress(&app, "preparing", 0.0);
    let duration_secs = probe_duration_secs(&ffmpeg, &input_path).await.unwrap_or(0.0);

    // ── 3. 构造视频滤镜链 ─────────────────────────────────────────────────
    // scale=-2:height 确保宽度自动计算并对齐为 2 的倍数（ffmpeg 内建语义）
    let vf = format!("scale=-2:{target_height}");

    // ── 4. 阶段二：编码 ───────────────────────────────────────────────────
    // x264opts 参考 HandBrake 预设：高质量、兼容性强的参数组合
    let x264_opts = concat!(
        "ref=4:bframes=3:me=umh:keyint=600:min-keyint=1:",
        "deblock=1,1:scenecut=60:qcomp=0.5:psy-rd=0.3,0:",
        "aq-mode=2:aq-strength=0.8"
    );

    emit_compress_progress(&app, "encoding", 0.0);
    let mut child = tokio::process::Command::new(&ffmpeg)
        .args([
            "-y",
            "-i", &input_path,
            "-progress", "pipe:2",
            "-nostats",
            // 视频
            "-vf", &vf,
            "-c:v", "libx264",
            "-crf", "22",
            "-profile:v", "high",
            "-preset", "slow",
            "-x264opts", x264_opts,
            // 音频
            "-c:a", "aac",
            "-b:a", "256k",
            "-ac", "2",
            // 容器优化
            "-movflags", "+faststart",
            resolved_output.to_str().unwrap_or("output.mp4"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动 FFmpeg 失败: {e}"))?;

    let pid = child
        .id()
        .ok_or_else(|| "无法获取 FFmpeg 进程 ID".to_string())?;
    if let Err(err) = state.start(pid).await {
        let _ = child.kill().await;
        return Err(err);
    }

    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = child.kill().await;
            let _ = state.finish().await;
            return Err("无法读取 FFmpeg 进度输出".to_string());
        }
    };
    let progress_app = app.clone();
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    let stderr_tail_reader = Arc::clone(&stderr_tail);
    let progress_task = tokio::spawn(async move {
        read_ffmpeg_progress(stderr, duration_secs, progress_app, stderr_tail_reader).await;
    });

    let status = match child.wait().await {
        Ok(status) => status,
        Err(err) => {
            let _ = progress_task.await;
            let _ = state.finish().await;
            return Err(format!("FFmpeg 执行出错: {err}"));
        }
    };
    let _ = progress_task.await;
    let was_canceled = state.finish().await;

    if was_canceled {
        emit_compress_progress(&app, "canceled", 0.0);
        return Err("压制已取消".to_string());
    }

    if !status.success() {
        let stderr = stderr_tail.lock().await.clone();
        let chars: Vec<char> = stderr.chars().rev().take(500).collect();
        let tail: String = chars.into_iter().rev().collect();
        emit_compress_progress(&app, "error", 0.0);
        return Err(format!("FFmpeg 编码失败:\n{tail}"));
    }

    emit_compress_progress(&app, "done", 100.0);

    Ok(resolved_output.to_string_lossy().into_owned())
}

/// 暂停当前小版本压制任务。
#[tauri::command]
pub async fn pause_video_compression(
    state: tauri::State<'_, VideoCompressionState>,
) -> Result<(), String> {
    let pid = {
        let active = state.active.lock().await;
        active
            .as_ref()
            .map(|task| task.pid)
            .ok_or_else(|| "当前没有正在压制的任务".to_string())?
    };

    send_pause_signal(pid).await?;

    let mut active = state.active.lock().await;
    if let Some(task) = active.as_mut() {
        if task.pid == pid {
            task.paused = true;
        }
    }
    Ok(())
}

/// 继续当前小版本压制任务。
#[tauri::command]
pub async fn resume_video_compression(
    state: tauri::State<'_, VideoCompressionState>,
) -> Result<(), String> {
    let pid = {
        let active = state.active.lock().await;
        active
            .as_ref()
            .map(|task| task.pid)
            .ok_or_else(|| "当前没有正在压制的任务".to_string())?
    };

    send_resume_signal(pid).await?;

    let mut active = state.active.lock().await;
    if let Some(task) = active.as_mut() {
        if task.pid == pid {
            task.paused = false;
        }
    }
    Ok(())
}

/// 取消当前小版本压制任务。
#[tauri::command]
pub async fn cancel_video_compression(
    state: tauri::State<'_, VideoCompressionState>,
) -> Result<(), String> {
    let pid = {
        let mut active = state.active.lock().await;
        let Some(task) = active.as_mut() else {
            return Ok(());
        };
        task.cancel_requested = true;
        task.paused = false;
        task.pid
    };

    send_cancel_signal(pid).await
}

// ─── 内部函数 ──────────────────────────────────────────────────────────────────

#[cfg(unix)]
async fn send_process_signal(pid: u32, signal: &str) -> Result<(), String> {
    let pid_arg = pid.to_string();
    let status = tokio::process::Command::new("kill")
        .args([signal, &pid_arg])
        .status()
        .await
        .map_err(|e| format!("发送进程信号失败: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("发送进程信号失败: {signal} {pid}"))
    }
}

#[cfg(unix)]
async fn send_pause_signal(pid: u32) -> Result<(), String> {
    send_process_signal(pid, "-STOP").await
}

#[cfg(unix)]
async fn send_resume_signal(pid: u32) -> Result<(), String> {
    send_process_signal(pid, "-CONT").await
}

#[cfg(unix)]
async fn send_cancel_signal(pid: u32) -> Result<(), String> {
    let result = send_process_signal(pid, "-TERM").await;
    let _ = send_process_signal(pid, "-CONT").await;
    result
}

#[cfg(windows)]
async fn send_pause_signal(_pid: u32) -> Result<(), String> {
    Err("当前平台暂不支持暂停压制".to_string())
}

#[cfg(windows)]
async fn send_resume_signal(_pid: u32) -> Result<(), String> {
    Err("当前平台暂不支持继续压制".to_string())
}

#[cfg(windows)]
async fn send_cancel_signal(pid: u32) -> Result<(), String> {
    let pid_arg = pid.to_string();
    let status = tokio::process::Command::new("taskkill")
        .args(["/PID", &pid_arg, "/T", "/F"])
        .status()
        .await
        .map_err(|e| format!("取消压制失败: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("取消压制失败: {pid}"))
    }
}

fn emit_compress_progress(app: &AppHandle, phase: &str, progress_pct: f64) {
    let _ = app.emit(
        "video-compress-progress",
        VideoCompressProgressPayload {
            phase: phase.to_string(),
            progress_pct: progress_pct.clamp(0.0, 100.0),
        },
    );
}

async fn probe_duration_secs(ffmpeg: &PathBuf, input_path: &str) -> Result<f64, String> {
    let output = tokio::process::Command::new(ffmpeg)
        .args(["-i", input_path])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("读取视频信息失败: {e}"))?;

    parse_duration_secs(&String::from_utf8_lossy(&output.stderr))
        .ok_or_else(|| "无法读取视频时长".to_string())
}

async fn read_ffmpeg_progress<R>(
    mut stderr: R,
    duration_secs: f64,
    app: AppHandle,
    stderr_tail: Arc<Mutex<String>>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = [0_u8; 4096];
    let mut parse_tail = String::new();

    loop {
        let n = match stderr.read(&mut buf).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };

        let chunk = String::from_utf8_lossy(&buf[..n]);
        {
            let mut tail = stderr_tail.lock().await;
            tail.push_str(&chunk);
            trim_to_last_chars(&mut tail, 4000);
        }

        let combined = format!("{parse_tail}{chunk}");
        if let Some(seconds) = parse_progress_secs(&combined) {
            let progress_pct = if duration_secs > 0.0 {
                (seconds / duration_secs * 100.0).clamp(0.0, 99.9)
            } else {
                0.0
            };
            emit_compress_progress(&app, "encoding", progress_pct);
        }

        let tail_chars: Vec<char> = combined.chars().rev().take(128).collect();
        parse_tail = tail_chars.into_iter().rev().collect();
    }
}

fn trim_to_last_chars(value: &mut String, max_chars: usize) {
    if value.chars().count() <= max_chars {
        return;
    }
    let trimmed: String = value.chars().rev().take(max_chars).collect();
    *value = trimmed.chars().rev().collect();
}

fn parse_duration_secs(stderr: &str) -> Option<f64> {
    let start = stderr.find("Duration: ")? + "Duration: ".len();
    let token = stderr[start..].split(',').next()?.trim();
    parse_timestamp_secs(token)
}

fn parse_progress_secs(text: &str) -> Option<f64> {
    if let Some((idx, _)) = text.rmatch_indices("out_time_ms=").next() {
        let value = text[idx + "out_time_ms=".len()..]
            .split_whitespace()
            .next()?
            .trim();
        if let Ok(micros) = value.parse::<f64>() {
            return Some(micros / 1_000_000.0);
        }
    }

    if let Some((idx, _)) = text.rmatch_indices("out_time=").next() {
        let value = text[idx + "out_time=".len()..]
            .split_whitespace()
            .next()?
            .trim();
        if let Some(seconds) = parse_timestamp_secs(value) {
            return Some(seconds);
        }
    }

    if let Some((idx, _)) = text.rmatch_indices("time=").next() {
        let value = text[idx + "time=".len()..]
            .split_whitespace()
            .next()?
            .trim();
        if let Some(seconds) = parse_timestamp_secs(value) {
            return Some(seconds);
        }
    }

    None
}

fn parse_timestamp_secs(value: &str) -> Option<f64> {
    let mut parts = value.split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

// ─── 系统文件打开 ──────────────────────────────────────────────────────────────

/// 用系统默认应用打开文件或目录（相当于 Finder 的"显示简介"或双击）。
///
/// * macOS / Linux：调用 `open` / `xdg-open`
/// * Windows：调用 `explorer`
///
/// 使用 spawn 而不等待退出码，避免阻塞前端调用。
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open path: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open path: {e}"))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open path: {e}"))?;
    }
    Ok(())
}

/// Return the byte-length of a file at the given path.
/// Used by the frontend to display accurate file sizes for Tauri drag-drop files.
#[tauri::command]
pub fn get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("Failed to read file metadata: {e}"))
}

/// Write UTF-8 text content to a file at the given absolute path.
///
/// The frontend first calls `@tauri-apps/plugin-dialog` `save()` to obtain the
/// user-chosen path, then calls this command to perform the actual write.
#[tauri::command]
pub fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content.as_bytes())
        .map_err(|e| format!("写入文件失败: {e}"))
}

/// Read a UTF-8 text file and return its contents.
///
/// Used by the AssFormatter tool to load SRT/ASS subtitle files that were
/// selected via the native drag-drop listener (which returns a path, not a
/// File object with content).
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))
}

// ─── Video resolution probe ────────────────────────────────────────────────────

/// Resolution returned by `get_video_resolution`.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct VideoResolution {
    pub width: u32,
    pub height: u32,
}

/// Parse `WxH` from the Video stream line emitted by `ffmpeg -i`.
///
/// Example line (trimmed):
/// `Stream #0:0(und): Video: h264 (High), yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], …`
fn parse_video_res(stderr: &str) -> Option<VideoResolution> {
    for line in stderr.lines() {
        if !line.contains(": Video:") {
            continue;
        }
        for word in line.split_whitespace() {
            let clean = word.trim_end_matches(',').trim_end_matches(';');
            if let Some((w_str, rest)) = clean.split_once('x') {
                // The height token may be followed by extra chars like "[SAR…"
                let h_str: &str = rest
                    .split(|c: char| !c.is_ascii_digit())
                    .next()
                    .unwrap_or("");
                if let (Ok(w), Ok(h)) = (w_str.parse::<u32>(), h_str.parse::<u32>()) {
                    // Sanity bounds: reject bogus matches like "1x1" or "9999x9999"
                    if w >= 120 && h >= 120 && w <= 8192 && h <= 8192 {
                        return Some(VideoResolution { width: w, height: h });
                    }
                }
            }
        }
    }
    None
}

/// Probe a video file with FFmpeg and return its resolution.
#[tauri::command]
pub async fn get_video_resolution(app: AppHandle, path: String) -> Result<VideoResolution, String> {
    let ffmpeg =
        resolve_ffmpeg_executable(&app).ok_or_else(|| "FFmpeg 未找到".to_string())?;

    let output = tokio::process::Command::new(&ffmpeg)
        .args(["-i", &path])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("FFmpeg 运行失败: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_video_res(&stderr).ok_or_else(|| "未找到视频流信息".to_string())
}
