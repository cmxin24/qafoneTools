//! # model_manager.rs
//!
//! 负责 Whisper 本地模型的 **状态检测** 与 **智能下载**。
//!
//! ## 核心设计
//! 1. **并发 CDN 测速**：同时向 HuggingFace 和 ModelScope 发送轻量 HEAD 请求，
//!    比较响应延迟，自动选择最快节点。
//! 2. **流式下载 + 进度推送**：使用 `reqwest` 的 `bytes_stream()` 逐块写入本地文件，
//!    每块写入后通过 Tauri 事件系统将进度百分比、下载速度、CDN 来源推送到前端。
//! 3. **平台无关路径**：通过 `tauri::Manager::path().app_data_dir()` 获取平台对应的
//!    数据目录（macOS: ~/Library/Application Support/<bundleId>/，
//!      Windows: %APPDATA%\<bundleId>\，Linux: ~/.local/share/<bundleId>/）。

use std::time::Instant;

use anyhow::{Context, Result};
use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{fs, io::AsyncWriteExt};

// ─── 数据类型 ──────────────────────────────────────────────────────────────────

/// 通过 Tauri 事件 `model-download-progress` 推送到前端的进度 payload。
///
/// 对应前端 TypeScript 接口 `DownloadProgressPayload`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressPayload {
    /// 对应当前下载的模型 ID，例如 `"large-v3-turbo"`
    pub model_id: String,
    /// 已下载字节数
    pub downloaded: u64,
    /// 文件总字节数（来自 Content-Length 响应头）
    pub total: u64,
    /// 下载完成百分比（0.0 ~ 100.0）
    pub percentage: f64,
    /// 实时下载速度（字节/秒）
    pub speed_bps: f64,
    /// 当前使用的 CDN 节点名称："huggingface" 或 "modelscope"
    pub cdn_source: String,
}

// ─── CDN 源定义 ────────────────────────────────────────────────────────────────

/// 单个 CDN 源的描述信息。
struct CdnSource {
    /// 供事件 payload 使用的简短名称
    name: &'static str,
    /// 该模型文件在此 CDN 上的完整下载 URL
    url: String,
}

impl CdnSource {
    /// 构建 HuggingFace 的 ggml-whisper.cpp 模型 URL。
    fn huggingface(filename: &str) -> Self {
        Self {
            name: "huggingface",
            url: format!(
                "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{filename}"
            ),
        }
    }

    /// 构建 ModelScope 的镜像模型 URL（对国内用户延迟更低）。
    fn modelscope(filename: &str) -> Self {
        Self {
            name: "modelscope",
            url: format!(
                "https://modelscope.cn/models/manycore-research/whisper.cpp-models/resolve/master/{filename}"
            ),
        }
    }
}

// ─── CDN 测速 ──────────────────────────────────────────────────────────────────

/// 对单个 CDN 发送 HEAD 请求并计时，返回 `(cdn_name, latency_ms)`。
///
/// 使用 HEAD 而非 GET，因为它只获取响应头，不下载 body，网络开销极小。
/// 超时设为 8 秒，避免阻塞整体流程。
async fn measure_latency(client: &Client, cdn: &CdnSource) -> Result<(&'static str, u128)> {
    let start = Instant::now();

    let resp = client
        .head(&cdn.url)
        .timeout(std::time::Duration::from_secs(8))
        .send()
        .await
        .with_context(|| format!("HEAD request to {} failed", cdn.name))?;

    // 2xx 或 302 重定向均视为节点可达
    if resp.status().is_success() || resp.status().as_u16() == 302 {
        Ok((cdn.name, start.elapsed().as_millis()))
    } else {
        anyhow::bail!("CDN {} returned HTTP {}", cdn.name, resp.status())
    }
}

/// **并发**测速两个 CDN，选择延迟更低的一方。
///
/// 使用 `tokio::join!` 同时发起两个 HEAD 请求，两个任务共享同一 tokio 线程池，
/// 总等待时间约等于 max(两者延迟) 而非 sum(两者延迟)。
///
/// 降级策略：
/// - 两者均可达 → 选延迟低者
/// - 一方超时/失败 → 选另一方
/// - 两者均失败 → 回退到 HuggingFace（国际通用）
async fn select_fastest_cdn(client: &Client, filename: &str) -> CdnSource {
    let hf = CdnSource::huggingface(filename);
    let ms = CdnSource::modelscope(filename);

    // 并发发起两个 HEAD 请求
    let (hf_result, ms_result) =
        tokio::join!(measure_latency(client, &hf), measure_latency(client, &ms));

    tracing::info!(
        "CDN speed test — HuggingFace: {:?}, ModelScope: {:?}",
        hf_result,
        ms_result
    );

    match (hf_result, ms_result) {
        // 两者均成功：选延迟更低的
        (Ok((_, hf_ms)), Ok((_, ms_ms))) => {
            if ms_ms < hf_ms {
                tracing::info!("ModelScope faster ({ms_ms}ms < {hf_ms}ms), using ModelScope");
                CdnSource::modelscope(filename)
            } else {
                tracing::info!("HuggingFace faster ({hf_ms}ms <= {ms_ms}ms), using HuggingFace");
                CdnSource::huggingface(filename)
            }
        }
        // HuggingFace 失败 → 用 ModelScope
        (Err(e), Ok(_)) => {
            tracing::warn!("HuggingFace unreachable ({e}), falling back to ModelScope");
            CdnSource::modelscope(filename)
        }
        // ModelScope 失败或两者均失败 → 用 HuggingFace
        (Ok(_), Err(_)) | (Err(_), Err(_)) => {
            tracing::warn!("ModelScope unreachable, using HuggingFace");
            CdnSource::huggingface(filename)
        }
    }
}

// ─── 应用数据目录工具 ──────────────────────────────────────────────────────────

/// 获取应用专属的模型存储目录（平台自适应）。
///
/// - macOS: `~/Library/Application Support/<bundle_id>/models/`
/// - Windows: `%APPDATA%\<bundle_id>\models\`
/// - Linux: `~/.local/share/<bundle_id>/models/`
fn get_model_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .context("无法解析应用数据目录，请检查 tauri.conf.json 中的 bundle identifier")?;
    Ok(data_dir.join("models"))
}

/// 根据模型 ID 构造 ggml bin 文件名，例如 `"large-v3-turbo"` → `"ggml-large-v3-turbo.bin"`。
fn model_filename(model_id: &str) -> String {
    format!("ggml-{model_id}.bin")
}

// ─── Tauri 命令 ────────────────────────────────────────────────────────────────

/// **检测本地模型是否存在**
///
/// 前端在模型下拉菜单切换时调用，用于决定显示"开始提取"还是"下载模型"按钮。
///
/// # 参数
/// - `model_id`: 模型短名，例如 `"tiny"` / `"base"` / `"medium"` / `"large-v3-turbo"`
///
/// # 返回
/// - `true`：本地已有该模型文件
/// - `false`：文件不存在，需要下载
#[tauri::command]
pub async fn check_model_status(app: AppHandle, model_id: String) -> Result<bool, String> {
    let model_path = get_model_dir(&app)
        .map_err(|e| e.to_string())?
        .join(model_filename(&model_id));

    Ok(model_path.exists())
}

/// **下载指定 Whisper 模型**
///
/// 执行流程：
/// 1. 创建目标目录（如不存在）
/// 2. 并发测速 HuggingFace / ModelScope，选最快 CDN
/// 3. 发起 GET 请求，流式读取响应体
/// 4. 每接收一个 chunk，立即写入本地文件，并通过 `model-download-progress` 事件推送进度
/// 5. 写完后 flush，下载完成
///
/// # 参数
/// - `model_id`: 模型短名
/// - `total_size`: 前端预估的文件总字节数（作为 Content-Length 缺失时的备用值）
///
/// # 错误
/// 返回 `Err(String)` 时，前端应展示错误提示并允许重试。
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model_id: String,
    total_size: u64,
) -> Result<(), String> {
    // ── 1. 准备目标路径 ────────────────────────────────────────────────────
    let model_dir = get_model_dir(&app).map_err(|e| e.to_string())?;
    fs::create_dir_all(&model_dir)
        .await
        .map_err(|e| format!("创建模型目录失败: {e}"))?;

    let filename = model_filename(&model_id);
    let dest_path = model_dir.join(&filename);

    // ── 2. 构建 HTTP 客户端 ────────────────────────────────────────────────
    let client = Client::builder()
        .user_agent("qafone-tools/1.0 (model-downloader)")
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;

    // ── 3. 并发测速，选最快 CDN ────────────────────────────────────────────
    //      注意：前端已在 `downloadState.phase = 'speed-testing'` 时显示测速 UI
    let cdn = select_fastest_cdn(&client, &filename).await;
    let cdn_name = cdn.name.to_owned();

    tracing::info!("开始从 {cdn_name} 下载 {filename}");

    // ── 4. 发起流式 GET 请求 ───────────────────────────────────────────────
    let response = client
        .get(&cdn.url)
        .send()
        .await
        .map_err(|e| format!("请求 {cdn_name} 失败: {e}"))?;

    // 优先使用服务器返回的 Content-Length，否则使用前端传入的估算值
    let content_length = response.content_length().unwrap_or(total_size);

    // ── 5. 打开目标文件（覆盖写入） ────────────────────────────────────────
    let mut file = fs::File::create(&dest_path)
        .await
        .map_err(|e| format!("创建文件 {dest_path:?} 失败: {e}"))?;

    // ── 6. 流式读取并写入，逐 chunk 发送进度事件 ───────────────────────────
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let download_start = Instant::now();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取响应流失败: {e}"))?;

        // 写入本地文件
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;

        downloaded += chunk.len() as u64;

        // 计算实时速度（避免除以 0）
        let elapsed_secs = download_start.elapsed().as_secs_f64().max(f64::EPSILON);
        let speed_bps = downloaded as f64 / elapsed_secs;

        // 百分比（钳位到 100.0 防止 Content-Length 不准确时溢出）
        let percentage = (downloaded as f64 / content_length as f64 * 100.0).min(100.0);

        // 通过 Tauri 事件将进度实时推送到前端
        // 前端使用 `listen('model-download-progress', handler)` 接收
        let _ = app.emit(
            "model-download-progress",
            DownloadProgressPayload {
                model_id: model_id.clone(),
                downloaded,
                total: content_length,
                percentage,
                speed_bps,
                cdn_source: cdn_name.clone(),
            },
        );
    }

    // ── 7. 确保所有数据落盘 ────────────────────────────────────────────────
    file.flush()
        .await
        .map_err(|e| format!("刷新文件缓冲区失败: {e}"))?;

    tracing::info!("{filename} 下载完成，共 {downloaded} 字节");
    Ok(())
}
