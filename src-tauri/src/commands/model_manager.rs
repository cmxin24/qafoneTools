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

    /// Build a HuggingFace URL for a csukuangfj sherpa-onnx Parakeet INT8 model file.
    ///
    /// Repo: `csukuangfj/sherpa-onnx-nemo-<model_id>-int8`
    fn huggingface_parakeet(model_id: &str, filename: &str) -> Self {
        let repo = format!("sherpa-onnx-nemo-{model_id}-int8");
        Self {
            name: "huggingface",
            url: format!("https://huggingface.co/csukuangfj/{repo}/resolve/main/{filename}"),
        }
    }

    /// Build a hf-mirror.com URL (China-friendly HuggingFace mirror) for the Parakeet model.
    /// ModelScope does not host this model; hf-mirror.com serves as the China fallback.
    fn modelscope_parakeet(model_id: &str, filename: &str) -> Self {
        let repo = format!("sherpa-onnx-nemo-{model_id}-int8");
        Self {
            name: "hf-mirror",
            url: format!("https://hf-mirror.com/csukuangfj/{repo}/resolve/main/{filename}"),
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
async fn select_fastest_cdn(client: &Client, model_id: &str, filename: &str) -> CdnSource {
    let (hf, ms) = if model_id.starts_with("parakeet") {
        (
            CdnSource::huggingface_parakeet(model_id, filename),
            CdnSource::modelscope_parakeet(model_id, filename),
        )
    } else {
        (
            CdnSource::huggingface(filename),
            CdnSource::modelscope(filename),
        )
    };

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
                if model_id.starts_with("parakeet") { CdnSource::modelscope_parakeet(model_id, filename) } else { CdnSource::modelscope(filename) }
            } else {
                tracing::info!("HuggingFace faster ({hf_ms}ms <= {ms_ms}ms), using HuggingFace");
                if model_id.starts_with("parakeet") { CdnSource::huggingface_parakeet(model_id, filename) } else { CdnSource::huggingface(filename) }
            }
        }
        // HuggingFace 失败 → 用 ModelScope
        (Err(e), Ok(_)) => {
            tracing::warn!("HuggingFace unreachable ({e}), falling back to ModelScope");
            if model_id.starts_with("parakeet") { CdnSource::modelscope_parakeet(model_id, filename) } else { CdnSource::modelscope(filename) }
        }
        // ModelScope 失败或两者均失败 → 用 HuggingFace
        (Ok(_), Err(_)) | (Err(_), Err(_)) => {
            tracing::warn!("ModelScope unreachable, using HuggingFace");
            if model_id.starts_with("parakeet") { CdnSource::huggingface_parakeet(model_id, filename) } else { CdnSource::huggingface(filename) }
        }
    }
}

// ─── Parakeet 吞吐量测速 ───────────────────────────────────────────────────────

/// Measure actual download throughput by fetching the first 256 KB of a URL
/// via an HTTP Range request. Returns bytes per second, or 0 on any error.
async fn measure_throughput_bps(client: &Client, url: &str) -> u64 {
    let start = Instant::now();
    let result = client
        .get(url)
        .header("Range", "bytes=0-262143") // 256 KB probe
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await;

    match result {
        Ok(resp) if resp.status().is_success() || resp.status().as_u16() == 206 => {
            match resp.bytes().await {
                Ok(bytes) if !bytes.is_empty() => {
                    let elapsed = start.elapsed().as_secs_f64().max(f64::EPSILON);
                    (bytes.len() as f64 / elapsed) as u64
                }
                _ => 0,
            }
        }
        _ => 0,
    }
}

/// Select the best Parakeet CDN by concurrently downloading a 256 KB range probe
/// from `encoder.int8.onnx` on both nodes and comparing real throughput.
///
/// Returns `true` when hf-mirror.com wins (better for mainland China),
/// `false` when HuggingFace wins.
async fn select_parakeet_cdn_by_throughput(client: &Client, model_id: &str) -> bool {
    let hf_url = CdnSource::huggingface_parakeet(model_id, "encoder.int8.onnx").url;
    let hfm_url = CdnSource::modelscope_parakeet(model_id, "encoder.int8.onnx").url;

    let (hf_bps, hfm_bps) = tokio::join!(
        measure_throughput_bps(client, &hf_url),
        measure_throughput_bps(client, &hfm_url),
    );

    tracing::info!(
        "Parakeet CDN throughput — HuggingFace: {} KB/s, hf-mirror: {} KB/s",
        hf_bps / 1024,
        hfm_bps / 1024
    );

    if hfm_bps > hf_bps {
        tracing::info!("hf-mirror faster, using hf-mirror for all Parakeet files");
        true
    } else {
        tracing::info!("HuggingFace faster or both failed, using HuggingFace for all Parakeet files");
        false
    }
}

// ─── 应用数据目录工具 ──────────────────────────────────────────────────────────

/// 获取应用专属的模型存储目录（平台自适应）。
///
/// - macOS: `~/Library/Application Support/<bundle_id>/models/`
/// - Windows: `%APPDATA%\<bundle_id>\models\`
/// - Linux: `~/.local/share/<bundle_id>/models/`
pub(crate) fn get_model_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .context("无法解析应用数据目录，请检查 tauri.conf.json 中的 bundle identifier")?;
    Ok(data_dir.join("models"))
}

/// Build the local filename for a Whisper ggml model.
/// e.g. `"large-v3-turbo"` → `"ggml-large-v3-turbo.bin"`
pub(crate) fn model_filename(model_id: &str) -> String {
    format!("ggml-{model_id}.bin")
}

/// Return the local path for a Whisper ggml model file (may not exist yet).
pub(crate) fn get_model_path(app: &AppHandle, model_id: &str) -> Result<std::path::PathBuf> {
    Ok(get_model_dir(app)?.join(model_filename(model_id)))
}

/// Return the local subdirectory for a Parakeet ONNX model bundle.
/// e.g. `<app_data>/models/parakeet-tdt-0.6b-v3/`
pub(crate) fn get_parakeet_dir(
    app: &AppHandle,
    model_id: &str,
) -> Result<std::path::PathBuf> {
    Ok(get_model_dir(app)?.join(model_id))
}

// ─── Tauri 命令 ────────────────────────────────────────────────────────────────

/// **检测本地模型是否就绪**
///
/// - Whisper：检查 `ggml-<id>.bin` 是否存在
/// - Parakeet：检查子目录内 4 个 ONNX 文件是否全部存在
#[tauri::command]
pub async fn check_model_status(app: AppHandle, model_id: String) -> Result<bool, String> {
    if model_id.starts_with("parakeet") {
        use super::sherpa_runner::parakeet_model_ready;
        Ok(parakeet_model_ready(&app, &model_id))
    } else {
        let model_path = get_model_dir(&app)
            .map_err(|e| e.to_string())?
            .join(model_filename(&model_id));
        Ok(model_path.exists())
    }
}

/// **下载指定模型**
///
/// - **Whisper 模型**：单文件流式下载，持续推送 `model-download-progress` 事件。
/// - **Parakeet 模型**：依次下载 4 个 ONNX 文件到 `<models>/<model_id>/` 子目录，
///   使用全局累计字节推送合并进度，与 Whisper 路径行为一致。
///
/// # 参数
/// - `model_id`   : 模型短名（`"large-v3-turbo"` 或 `"parakeet-tdt-0.6b-v3"`）
/// - `total_size` : 前端预估的总字节数，作为 Content-Length 缺失时的兜底值
#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    model_id: String,
    total_size: u64,
) -> Result<(), String> {
    if model_id.starts_with("parakeet") {
        return download_parakeet_files(&app, &model_id, total_size).await;
    }
    download_whisper_file(&app, &model_id, total_size).await
}

// ─── Parakeet multi-file download ────────────────────────────────────────────

/// Download the 4 Parakeet ONNX model files from k2-fsa HuggingFace / ModelScope.
/// All files go to `<models_dir>/<model_id>/`.  Combined progress is emitted so
/// the frontend progress bar works identically to the Whisper path.
async fn download_parakeet_files(
    app: &AppHandle,
    model_id: &str,
    total_size: u64,
) -> Result<(), String> {
    use super::sherpa_runner::PARAKEET_MODEL_FILES;

    let dest_dir = get_parakeet_dir(app, model_id).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dest_dir)
        .await
        .map_err(|e| format!("创建 Parakeet 模型目录失败: {e}"))?;

    let client = Client::builder()
        .user_agent("qafone-tools/1.0 (model-downloader)")
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;

    // Per-file estimated sizes based on actual v3 INT8 model weights:
    // encoder.int8.onnx ~652 MB (97.2%), decoder.int8.onnx ~11.8 MB (1.8%),
    // joiner.int8.onnx ~6.36 MB (0.9%), tokens.txt ~93 kB (0.1%).
    let est_sizes: [u64; 4] = [
        (total_size as f64 * 0.972) as u64,
        (total_size as f64 * 0.018) as u64,
        (total_size as f64 * 0.009) as u64,
        (total_size as f64 * 0.001) as u64,
    ];

    // Probe both CDNs concurrently with a 256 KB range request on the encoder
    // to measure real throughput before committing to one node for all 4 files.
    // HEAD-latency based selection is unreliable because HuggingFace Cloudflare
    // edges respond quickly but LFS downloads can be throttled in mainland China.
    let use_hf_mirror = select_parakeet_cdn_by_throughput(&client, model_id).await;
    let chosen_cdn_label = if use_hf_mirror { "hf-mirror" } else { "huggingface" };
    tracing::info!("Parakeet: all files will be fetched from {chosen_cdn_label}");

    let mut global_downloaded: u64 = 0;
    let download_start = Instant::now();

    for (file_name, &est_size) in PARAKEET_MODEL_FILES.iter().zip(est_sizes.iter()) {
        let cdn = if use_hf_mirror {
            CdnSource::modelscope_parakeet(model_id, file_name) // hf-mirror.com
        } else {
            CdnSource::huggingface_parakeet(model_id, file_name)
        };
        let cdn_name = cdn.name.to_owned();
        tracing::info!("Parakeet: downloading {file_name} from {cdn_name}");

        let response = client
            .get(&cdn.url)
            .send()
            .await
            .map_err(|e| format!("请求 {file_name} 失败: {e}"))?
            .error_for_status()
            .map_err(|e| format!("下载 {file_name} 服务器返回错误（模型文件可能尚未发布）: {e}"))?;

        let _file_total = response.content_length().unwrap_or(est_size);
        let dest_path = dest_dir.join(file_name);

        let mut out_file = fs::File::create(&dest_path)
            .await
            .map_err(|e| format!("创建文件 {dest_path:?} 失败: {e}"))?;

        let mut stream = response.bytes_stream();

        while let Some(chunk_result) = stream.next().await {
            let chunk =
                chunk_result.map_err(|e| format!("读取 {file_name} 数据流失败: {e}"))?;
            out_file
                .write_all(&chunk)
                .await
                .map_err(|e| format!("写入 {file_name} 失败: {e}"))?;

            global_downloaded += chunk.len() as u64;
            let elapsed = download_start.elapsed().as_secs_f64().max(f64::EPSILON);
            let _ = app.emit(
                "model-download-progress",
                DownloadProgressPayload {
                    model_id: model_id.to_string(),
                    downloaded: global_downloaded,
                    total: total_size,
                    percentage: (global_downloaded as f64 / total_size as f64 * 100.0)
                        .min(100.0),
                    speed_bps: global_downloaded as f64 / elapsed,
                    cdn_source: cdn_name.clone(),
                },
            );
        }

        out_file
            .flush()
            .await
            .map_err(|e| format!("刷新 {file_name} 缓冲区失败: {e}"))?;

        tracing::info!("Parakeet: {file_name} complete");
    }

    // Emit a definitive 100% completion event. The per-chunk events may have
    // stopped at ~99.9% when actual file sizes are slightly less than total_size,
    // leaving the frontend stuck at the download screen forever.
    let final_elapsed = download_start.elapsed().as_secs_f64().max(f64::EPSILON);
    let _ = app.emit(
        "model-download-progress",
        DownloadProgressPayload {
            model_id: model_id.to_string(),
            downloaded: total_size,
            total: total_size,
            percentage: 100.0,
            speed_bps: global_downloaded as f64 / final_elapsed,
            cdn_source: chosen_cdn_label.to_string(),
        },
    );

    Ok(())
}

// ─── Whisper single-file download ────────────────────────────────────────────

async fn download_whisper_file(
    app: &AppHandle,
    model_id: &str,
    total_size: u64,
) -> Result<(), String> {
    // ── 1. 准备目标路径 ────────────────────────────────────────────────────
    let model_dir = get_model_dir(app).map_err(|e| e.to_string())?;
    fs::create_dir_all(&model_dir)
        .await
        .map_err(|e| format!("创建模型目录失败: {e}"))?;

    let filename = model_filename(model_id);
    let dest_path = model_dir.join(&filename);

    // ── 2. 构建 HTTP 客户端 ────────────────────────────────────────────────
    let client = Client::builder()
        .user_agent("qafone-tools/1.0 (model-downloader)")
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))?;

    // ── 3. 并发测速，选最快 CDN ────────────────────────────────────────────
    let cdn = select_fastest_cdn(&client, model_id, &filename).await;
    let cdn_name = cdn.name.to_owned();

    tracing::info!("开始从 {cdn_name} 下载 {filename}");

    // ── 4. 发起流式 GET 请求 ───────────────────────────────────────────────
    let response = client
        .get(&cdn.url)
        .send()
        .await
        .map_err(|e| format!("请求 {cdn_name} 失败: {e}"))?;

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

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;

        downloaded += chunk.len() as u64;

        let elapsed_secs = download_start.elapsed().as_secs_f64().max(f64::EPSILON);
        let speed_bps = downloaded as f64 / elapsed_secs;
        let percentage = (downloaded as f64 / content_length as f64 * 100.0).min(100.0);

        let _ = app.emit(
            "model-download-progress",
            DownloadProgressPayload {
                model_id: model_id.to_string(),
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

/// **删除已下载的模型文件 / 目录**
///
/// - Whisper：删除单个 `ggml-*.bin` 文件（幂等）。
/// - Parakeet：删除 `<model_id>/` 整个子目录（幂等）。
#[tauri::command]
pub async fn delete_model(app: AppHandle, model_id: String) -> Result<(), String> {
    if model_id.starts_with("parakeet") {
        let dir = get_parakeet_dir(&app, &model_id).map_err(|e| e.to_string())?;
        if dir.exists() {
            fs::remove_dir_all(&dir)
                .await
                .map_err(|e| format!("删除 Parakeet 模型目录失败: {e}"))?;
            tracing::info!("已删除 Parakeet 模型目录: {:?}", dir);
        }
    } else {
        let path = get_model_dir(&app)
            .map_err(|e| e.to_string())?
            .join(model_filename(&model_id));
        if path.exists() {
            fs::remove_file(&path)
                .await
                .map_err(|e| format!("删除模型文件失败: {e}"))?;
            tracing::info!("已删除模型文件: {:?}", path);
        }
    }
    Ok(())
}

/// **返回模型存储目录的绝对路径**
///
/// 前端可通过 `open_path` 命令在系统文件管理器中打开该目录。
#[tauri::command]
pub fn get_model_dir_path(app: AppHandle) -> Result<String, String> {
    get_model_dir(&app)
        .map_err(|e| e.to_string())
        .map(|p| p.to_string_lossy().to_string())
}
