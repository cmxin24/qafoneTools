//! # video_compressor.rs
//!
//! 负责 FFmpeg 的 **状态检测**、**下载** 以及 **视频小版本压制**。
//!
//! ## 压制流程
//! 1. **黑边检测（cropdetect）**：对视频前 5 分钟运行 `ffmpeg -vf cropdetect`，
//!    解析 stderr 取最终稳定的 `crop=w:h:x:y` 参数。
//! 2. **编码**：使用 x264（CRF 22，preset fast，profile high）和 AAC 256kbps
//!    输出 MP4，缩放到目标高度同时保持宽高比，宽度自动补齐为 2 的倍数（`scale=-2:height`）。
//! 3. **进度追踪**：解析 FFmpeg stderr 中的 `time=HH:MM:SS.ms` 字段，
//!    结合视频总时长计算百分比，通过 `video-compress-progress` 事件推送前端。

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Instant;

use anyhow::{Context, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{fs, io::AsyncWriteExt};

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
    /// 当前阶段："crop_detect" | "encoding" | "done" | "error"
    pub phase: String,
    /// 当前阶段完成百分比（0.0 ~ 100.0）
    pub progress_pct: f64,
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
/// 1. 运行 `ffmpeg -vf cropdetect` 检测黑边，发送 `video-compress-progress { phase: "crop_detect" }` 事件
/// 2. 解析 cropdetect 输出，取最终稳定的 crop 参数
/// 3. 运行编码：`-vf "crop=w:h:x:y,scale=-2:target_height" -c:v libx264 -crf 22 -preset fast -profile:v high ...`
///    解析 stderr 中的 `time=` 字段推算进度，发送 `video-compress-progress { phase: "encoding" }` 事件
/// 4. 完成后返回输出文件路径
///
/// # 参数
/// - `input_path`: 输入视频绝对路径
/// - `target_height`: 目标高度（360/480/540/720）
/// - `auto_crop`: 是否自动检测并去除黑边
///
/// # 返回
/// 输出文件的绝对路径字符串
#[tauri::command]
pub async fn compress_video(
    app: AppHandle,
    input_path: String,
    output_path: String,
    target_height: u32,
    auto_crop: bool,
) -> Result<String, String> {
    let ffmpeg = resolve_ffmpeg_executable(&app)
        .ok_or_else(|| "FFmpeg 未找到，请先下载".to_string())?;

    let input = PathBuf::from(&input_path);
    if !input.exists() {
        return Err(format!("输入文件不存在: {input_path}"));
    }

    // ── 1. 构造输出路径（优先使用前端传入的路径，否则默认加 _小版本 后缀）──────
    let resolved_output = if output_path.trim().is_empty() {
        let stem = input.file_stem().unwrap_or_default().to_string_lossy();
        let ext  = input.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_else(|| ".mp4".to_string());
        input
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join(format!("{stem}_小版本{ext}"))
    } else {
        PathBuf::from(&output_path)
    };

    // ── 2. 阶段一：黑边检测 ───────────────────────────────────────────────
    let _ = app.emit(
        "video-compress-progress",
        VideoCompressProgressPayload { phase: "crop_detect".into(), progress_pct: 0.0 },
    );

    let crop_filter = if auto_crop {
        detect_crop(&ffmpeg, &input, &app).await?
    } else {
        None
    };

    // ── 3. 构造视频滤镜链 ─────────────────────────────────────────────────
    // scale=-2:height 确保宽度自动计算并对齐为 2 的倍数（ffmpeg 内建语义）
    let vf = match crop_filter {
        Some(crop) => format!("{crop},scale=-2:{target_height}"),
        None       => format!("scale=-2:{target_height}"),
    };

    // ── 4. 阶段二：编码 ───────────────────────────────────────────────────
    // x264opts 参考 HandBrake 预设：高质量、兼容性强的参数组合
    let x264_opts = concat!(
        "ref=4:bframes=3:me=umh:keyint=600:min-keyint=1:",
        "deblock=1,1:scenecut=60:qcomp=0.5:psy-rd=0.3,0:",
        "aq-mode=2:aq-strength=0.8"
    );

    let status = tokio::process::Command::new(&ffmpeg)
        .args([
            "-y",
            "-i", &input_path,
            // 视频
            "-vf", &vf,
            "-c:v", "libx264",
            "-crf", "22",
            "-profile:v", "high",
            "-preset", "fast",
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
        .map_err(|e| format!("启动 FFmpeg 失败: {e}"))?
        .wait_with_output()
        .await
        .map_err(|e| format!("FFmpeg 执行出错: {e}"))?;

    // TODO: 在 spawn 后实时读取 stderr 流并解析 `time=` 字段推送编码进度
    // 当前骨架直接等待完成后发送 100%

    let _ = app.emit(
        "video-compress-progress",
        VideoCompressProgressPayload { phase: "encoding".into(), progress_pct: 100.0 },
    );

    if !status.status.success() {
        let stderr = String::from_utf8_lossy(&status.stderr);
        return Err(format!("FFmpeg 编码失败:\n{}", &stderr[stderr.len().saturating_sub(500)..],));
    }

    let _ = app.emit(
        "video-compress-progress",
        VideoCompressProgressPayload { phase: "done".into(), progress_pct: 100.0 },
    );

    Ok(resolved_output.to_string_lossy().into_owned())
}

// ─── 内部函数 ──────────────────────────────────────────────────────────────────

/// 运行 `ffmpeg -vf cropdetect` 并解析黑边参数。
///
/// 分析输入视频前 300 秒（最多 5 分钟），从 stderr 逐行读取 cropdetect 输出，
/// 取最后稳定出现的 `crop=w:h:x:y` 字符串。
///
/// 返回 `Some("crop=w:h:x:y")` 或 `None`（无黑边时返回 None 避免不必要的 crop 滤镜）。
async fn detect_crop(
    ffmpeg: &PathBuf,
    input: &PathBuf,
    app: &AppHandle,
) -> Result<Option<String>, String> {
    let output = tokio::process::Command::new(ffmpeg)
        .args([
            "-i", input.to_str().unwrap_or(""),
            "-vf", "cropdetect=24:16:0",
            "-an",               // 忽略音频
            "-f", "null",        // 不写输出
            "-t", "300",         // 分析前 300 秒
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("cropdetect 运行失败: {e}"))?;

    let _ = app.emit(
        "video-compress-progress",
        VideoCompressProgressPayload { phase: "crop_detect".into(), progress_pct: 100.0 },
    );

    let stderr = String::from_utf8_lossy(&output.stderr);

    // cropdetect 输出形如：
    //   [Parsed_cropdetect_0 @ ...] x1:0 x2:1919 y1:140 y2:937 w:1920 h:800 x:0 y:140 pts:... crop=1920:800:0:140
    // 取最后一条稳定值
    let crop_str = stderr
        .lines()
        .filter_map(|line| {
            // 找到 "crop=" 标记
            line.split_whitespace()
                .find(|token| token.starts_with("crop="))
                .map(|s| s.to_owned())
        })
        .last();

    // 如果检测到的 crop 与原始尺寸相同（无黑边），返回 None 跳过 crop 滤镜
    // 简单判断：若 crop 参数包含 "x:0 y:0" 且宽高与原视频一致，则视为无黑边
    // 实际生产中应对比 stream 信息；此处骨架直接返回检测结果
    Ok(crop_str)
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
