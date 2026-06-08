use std::process::Stdio;

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::time::{timeout, Duration};

use super::model_manager::get_model_dir;

const TRANSLATION_TIMEOUT_SECS: u64 = 180;
const LOCAL_NLLB_ENDPOINT: &str = "qafone://local-nllb";
const NLLB_MODEL_ID: &str = "nllb-200-distilled-600M";
const LOCAL_NLLB_TIMEOUT_SECS: u64 = 900;
const NLLB_PYTHON_VERSION: &str = "3.11";
const NLLB_RUNTIME_PACKAGES: [&str; 3] = ["torch", "transformers", "sentencepiece"];
const POLISH_TIMEOUT_SECS: u64 = 180;
const NLLB_TRANSLATE_SCRIPT: &str = r#"
import json
import sys

payload = json.loads(sys.stdin.read())
model_dir = payload["model_dir"]
texts = payload["texts"]
source_lang = payload["source_lang"]
target_lang = payload["target_lang"]

def progress(phase, message):
    print(json.dumps({"phase": phase, "message": message}, ensure_ascii=False), file=sys.stderr, flush=True)

try:
    progress("import", "正在导入 torch / transformers…")
    import torch
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
except Exception as exc:
    print(json.dumps({
        "error": "Python dependencies missing. Install torch, transformers and sentencepiece to use local NLLB translation.",
        "detail": str(exc),
    }, ensure_ascii=False))
    sys.exit(2)

try:
    progress("tokenizer", "正在加载 NLLB tokenizer…")
    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
    progress("model", "正在加载 NLLB 模型权重…")
    model = AutoModelForSeq2SeqLM.from_pretrained(model_dir, local_files_only=True)
    tokenizer.src_lang = source_lang

    if torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"

    progress("device", f"正在使用 {device} 准备模型…")
    model.to(device)
    progress("tokenize", f"正在编码 {len(texts)} 条字幕…")
    inputs = tokenizer(texts, return_tensors="pt", padding=True, truncation=True).to(device)
    forced_bos_token_id = tokenizer.convert_tokens_to_ids(target_lang)

    progress("generate", f"正在生成 {len(texts)} 条译文…")
    with torch.inference_mode():
        outputs = model.generate(
            **inputs,
            forced_bos_token_id=forced_bos_token_id,
            max_new_tokens=256,
            num_beams=4,
        )

    progress("decode", "正在解码译文…")
    translations = tokenizer.batch_decode(outputs, skip_special_tokens=True)
    progress("done", "本批翻译完成。")
    print(json.dumps({"translations": translations}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"error": "Local NLLB translation failed.", "detail": str(exc)}, ensure_ascii=False))
    sys.exit(1)
"#;

const NLLB_RUNTIME_CHECK_SCRIPT: &str = r#"
import importlib.util
import json
packages = ["torch", "transformers", "sentencepiece"]
missing = [package for package in packages if importlib.util.find_spec(package) is None]
print(json.dumps({"missing": missing}, ensure_ascii=False))
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NllbRuntimeStatus {
    pub ready: bool,
    pub runtime_dir: String,
    pub python_path: Option<String>,
    pub missing_packages: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NllbRuntimeInstallProgress {
    pub phase: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NllbTranslationProgress {
    pub phase: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishContextItem {
    pub source_text: String,
    pub draft_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolishRequestItem {
    pub index: usize,
    pub source_text: String,
    pub draft_text: String,
    pub previous: Vec<PolishContextItem>,
    pub next: Vec<PolishContextItem>,
}

fn string_from_value(value: &Value) -> Option<String> {
    value.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned)
}

fn string_from_object(value: &Value) -> Option<String> {
    const TEXT_KEYS: [&str; 7] = [
        "translation_text",
        "translated_text",
        "translatedText",
        "translation",
        "text",
        "output",
        "result",
    ];

    TEXT_KEYS
        .iter()
        .find_map(|key| value.get(key).and_then(string_from_value))
}

fn strings_from_array(value: &Value) -> Option<Vec<String>> {
    let array = value.as_array()?;
    let translations: Vec<String> = array
        .iter()
        .filter_map(|item| string_from_value(item).or_else(|| string_from_object(item)))
        .collect();
    (!translations.is_empty()).then_some(translations)
}

fn extract_translations(value: &Value, expected: usize) -> Result<Vec<String>, String> {
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        let detail = value.get("detail").and_then(Value::as_str).unwrap_or("");
        return Err(if detail.is_empty() {
            error.to_string()
        } else {
            format!("{error} {detail}")
        });
    }

    if let Some(translations) = strings_from_array(value) {
        return Ok(translations);
    }

    const ARRAY_KEYS: [&str; 8] = [
        "translations",
        "translated_texts",
        "translatedTexts",
        "outputs",
        "results",
        "data",
        "items",
        "texts",
    ];

    for key in ARRAY_KEYS {
        if let Some(translations) = value.get(key).and_then(strings_from_array) {
            return Ok(translations);
        }
    }

    if expected == 1 {
        if let Some(translation) = string_from_object(value).or_else(|| string_from_value(value)) {
            return Ok(vec![translation]);
        }
    }

    Err("翻译服务响应里没有找到译文数组".to_string())
}

fn strip_code_fence(content: &str) -> String {
    let trimmed = content.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    let without_start = trimmed
        .lines()
        .skip(1)
        .collect::<Vec<_>>()
        .join("\n");
    without_start
        .trim_end()
        .strip_suffix("```")
        .unwrap_or(without_start.trim_end())
        .trim()
        .to_string()
}

fn clean_polish_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Ok(Value::String(inner)) = serde_json::from_str::<Value>(trimmed) {
        return clean_polish_text(&inner);
    }

    let quote_pairs = [('"', '"'), ('“', '”'), ('‘', '’')];
    for (open, close) in quote_pairs {
        if trimmed.starts_with(open) && trimmed.ends_with(close) && trimmed.len() >= 2 {
            let inner = trimmed
                .trim_start_matches(open)
                .trim_end_matches(close)
                .trim();
            if !inner.is_empty() {
                return inner.to_string();
            }
        }
    }

    trimmed.to_string()
}

fn looks_like_index(text: &str, expected_indexes: &[usize]) -> bool {
    let trimmed = text.trim().trim_matches('"');
    let Ok(index) = trimmed.parse::<usize>() else { return false };
    expected_indexes.contains(&index)
}

fn looks_like_json_container(text: &str) -> bool {
    let trimmed = text.trim();
    (trimmed.starts_with('[') && trimmed.ends_with(']')) || (trimmed.starts_with('{') && trimmed.ends_with('}'))
}

fn parse_polish_content(content: &str, expected_indexes: &[usize]) -> Result<Vec<String>, String> {
    let cleaned = strip_code_fence(content);
    let mut value = match serde_json::from_str::<Value>(&cleaned) {
        Ok(value) => value,
        Err(error) => {
            let lines = cleaned
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(|line| {
                    clean_polish_text(
                        line.trim_start_matches(|ch: char| ch.is_ascii_digit() || ch == '.' || ch == '、' || ch == ')' || ch.is_whitespace())
                    )
                })
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>();
            if lines.len() == expected_indexes.len() {
                return Ok(lines);
            }
            if expected_indexes.len() == 1 && !cleaned.trim().is_empty() {
                return Ok(vec![clean_polish_text(&cleaned)]);
            }
            return Err(format!("无法解析润色模型输出，请确认模型输出 JSON 或每行一条字幕：{error}\n{cleaned}"));
        }
    };

    if let Some(text) = value.as_str() {
        let cleaned_text = clean_polish_text(text);
        if looks_like_json_container(&cleaned_text) {
            if let Ok(nested_value) = serde_json::from_str::<Value>(&cleaned_text) {
                value = nested_value;
            } else if expected_indexes.len() == 1 {
                return Ok(vec![cleaned_text]);
            }
        } else if expected_indexes.len() == 1 {
            return Ok(vec![cleaned_text]);
        }
    }

    if expected_indexes.len() == 1 {
        if let Some(text) = string_from_object(&value) {
            return Ok(vec![clean_polish_text(&text)]);
        }
    }

    if let Some(array) = value.as_array() {
        let mut values = Vec::new();
        for item in array {
            if let Some(text) = item.as_str() {
                values.push(clean_polish_text(text));
            } else if let Some(text) = string_from_object(item) {
                values.push(clean_polish_text(&text));
            }
        }
        if expected_indexes.len() == 1 && values.len() == 2 && looks_like_index(&values[0], expected_indexes) {
            return Ok(vec![clean_polish_text(&values[1])]);
        }
        if values.len() == expected_indexes.len() {
            return Ok(values);
        }

        let mut by_index = std::collections::HashMap::new();
        for item in array {
            let Some(object) = item.as_object() else { continue };
            let index = object.get("index").and_then(Value::as_u64).map(|v| v as usize);
            let text = object
                .get("text")
                .or_else(|| object.get("translation"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(clean_polish_text);
            if let (Some(index), Some(text)) = (index, text) {
                by_index.insert(index, text);
            }
        }
        let ordered = expected_indexes
            .iter()
            .filter_map(|index| by_index.get(index).cloned())
            .collect::<Vec<_>>();
        if ordered.len() == expected_indexes.len() {
            return Ok(ordered);
        }
    }

    Err("润色模型返回数量与请求数量不一致。".to_string())
}

fn is_loopback_url(url: &Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<std::net::IpAddr>().map(|addr| addr.is_loopback()).unwrap_or(false)
}

fn alternate_loopback_endpoint(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    let alternate_host = if host == "127.0.0.1" {
        "localhost"
    } else if host.eq_ignore_ascii_case("localhost") {
        "127.0.0.1"
    } else {
        return None;
    };

    let mut alternate = url.clone();
    alternate.set_host(Some(alternate_host)).ok()?;
    Some(alternate.to_string())
}

fn ollama_api_chat_endpoint(url: &Url) -> Option<String> {
    if !is_loopback_url(url) || url.path().trim_end_matches('/') != "/v1/chat/completions" {
        return None;
    }

    let mut alternate = url.clone();
    alternate.set_path("/api/chat");
    Some(alternate.to_string())
}

fn polish_endpoint_candidates(endpoint: &str) -> Result<Vec<String>, String> {
    let url = Url::parse(endpoint).map_err(|error| format!("LLM 润色服务地址格式不正确：{error}"))?;
    let mut candidates = vec![url.to_string()];

    if let Some(api_chat) = ollama_api_chat_endpoint(&url) {
        candidates.push(api_chat.clone());
        if let Ok(api_url) = Url::parse(&api_chat) {
            if let Some(alternate) = alternate_loopback_endpoint(&api_url) {
                candidates.push(alternate);
            }
        }
    }
    if let Some(alternate) = alternate_loopback_endpoint(&url) {
        candidates.push(alternate);
    }

    candidates.dedup();
    Ok(candidates)
}

fn build_polish_client(endpoint: &str) -> Result<Client, String> {
    let url = Url::parse(endpoint).map_err(|error| format!("LLM 润色服务地址格式不正确：{error}"))?;
    let mut builder = Client::builder().timeout(std::time::Duration::from_secs(POLISH_TIMEOUT_SECS));
    if is_loopback_url(&url) {
        // Local Ollama requests should never be sent through system HTTP proxies.
        builder = builder.no_proxy();
    }
    builder.build().map_err(|error| format!("无法创建 LLM 润色请求客户端：{error}"))
}

fn model_prefers_no_think(model: &str) -> bool {
    let model = model.to_ascii_lowercase();
    model.contains("qwen3")
}

fn non_empty_str(value: &Value) -> Option<&str> {
    value.as_str().map(str::trim).filter(|text| !text.is_empty())
}

fn build_polish_request(endpoint: &str, model: &str, prompt: &str, user_content: &str) -> Value {
    let system_prompt = format!(
        "{}\n\n不要输出思考过程，不要输出 <think> 标签。上下文只用于理解代词、语气和省略，严禁输出上下文里的任何句子。不要合并多条字幕。只输出请求中的目标字幕。",
        prompt.trim()
    );
    let user_content = if model_prefers_no_think(model) {
        format!("/no_think\n\n{user_content}")
    } else {
        user_content.to_string()
    };
    let messages = json!([
        { "role": "system", "content": system_prompt },
        { "role": "user", "content": user_content }
    ]);

    let is_ollama_api_chat = Url::parse(endpoint)
        .map(|url| url.path().trim_end_matches('/') == "/api/chat")
        .unwrap_or(false);

    if is_ollama_api_chat {
        json!({
            "model": model,
            "messages": messages,
            "stream": false,
            "think": false,
            "options": {
                "temperature": 0.3,
                "num_predict": 512
            },
        })
    } else {
        json!({
            "model": model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 512,
            "stream": false,
        })
    }
}

fn extract_polish_content(value: &Value) -> Option<String> {
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(non_empty_str)
        .or_else(|| {
            value
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(non_empty_str)
        })
        .or_else(|| value.get("response").and_then(non_empty_str))
        .or_else(|| value.get("content").and_then(non_empty_str))
        .map(str::to_string)
}

fn has_polish_reasoning_without_content(value: &Value) -> bool {
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .and_then(|message| {
            message
                .get("reasoning_content")
                .or_else(|| message.get("thinking"))
                .or_else(|| message.get("reasoning"))
        })
        .and_then(non_empty_str)
        .is_some()
        || value
            .get("message")
            .and_then(|message| {
                message
                    .get("thinking")
                    .or_else(|| message.get("reasoning_content"))
                    .or_else(|| message.get("reasoning"))
            })
            .and_then(non_empty_str)
            .is_some()
}

async fn send_polish_request(
    endpoint: &str,
    model: &str,
    prompt: &str,
    user_content: &str,
) -> Result<(String, Value), String> {
    let client = build_polish_client(endpoint)?;
    let candidates = polish_endpoint_candidates(endpoint)?;
    let mut errors = Vec::new();

    for candidate in &candidates {
        let request = build_polish_request(candidate, model, prompt, user_content);
        let response = match client.post(candidate).json(&request).send().await {
            Ok(response) => response,
            Err(error) => {
                if error.is_timeout() {
                    return Err(format!(
                        "LLM 润色模型生成超时：{candidate}\n这通常表示本次字幕内容或上下文对本地模型太重，不是 Ollama 端口未连接。请降低上下文数量，或换更快/更大的模型后重试。"
                    ));
                }
                errors.push(format!("{candidate}: {error}"));
                continue;
            }
        };

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            errors.push(format!("{candidate}: HTTP {status}: {body}"));
            continue;
        }

        let value = response
            .json::<Value>()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    format!(
                        "LLM 润色模型生成超时：{candidate}\n这通常表示本次字幕内容或上下文对本地模型太重，不是 Ollama 端口未连接。请降低上下文数量，或换更快/更大的模型后重试。"
                    )
                } else {
                    format!("无法解析 LLM 润色服务响应：{error}")
                }
            })?;
        if extract_polish_content(&value).is_none() {
            let reason = if has_polish_reasoning_without_content(&value) {
                "模型只返回了思考内容，没有返回最终字幕。"
            } else {
                "模型返回了空 content。"
            };
            errors.push(format!(
                "{candidate}: {reason}请确认模型支持非思考模式，或把 Prompt 改短后重试。"
            ));
            continue;
        }
        return Ok((candidate.to_string(), value));
    }

    Err(format!(
        "LLM 润色请求未完成。已尝试：{}\n{}",
        candidates.join("、"),
        errors.join("\n")
    ))
}

fn runtime_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?
        .join("nllb-runtime"))
}

fn venv_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(runtime_dir(app)?.join("venv"))
}

fn venv_python_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = venv_dir(app)?;
    #[cfg(target_os = "windows")]
    {
        Ok(dir.join("Scripts").join("python.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(dir.join("bin").join("python"))
    }
}

fn uv_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let bin_dir = runtime_dir(app)?.join("bin");
    #[cfg(target_os = "windows")]
    {
        Ok(bin_dir.join("uv.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(bin_dir.join("uv"))
    }
}

fn emit_runtime_progress(app: &AppHandle, phase: &str, message: impl Into<String>) {
    let _ = app.emit(
        "nllb-runtime-install-progress",
        NllbRuntimeInstallProgress {
            phase: phase.to_string(),
            message: message.into(),
        },
    );
}

fn emit_translation_progress(app: &AppHandle, phase: &str, message: impl Into<String>) {
    let _ = app.emit(
        "nllb-translation-progress",
        NllbTranslationProgress {
            phase: phase.to_string(),
            message: message.into(),
        },
    );
}

async fn run_command(mut command: tokio::process::Command, action: &str) -> Result<String, String> {
    let output = command
        .output()
        .await
        .map_err(|e| format!("{action} 启动失败: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("{action} 失败:\n{stderr}\n{stdout}"));
    }
    Ok(stdout)
}

async fn find_system_python() -> Option<String> {
    let candidates = [
        "python3",
        "python",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
    ];

    for candidate in candidates {
        let ok = tokio::process::Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false);
        if ok {
            return Some(candidate.to_string());
        }
    }

    None
}

async fn check_python_packages(python: &std::path::Path) -> Result<Vec<String>, String> {
    let output = tokio::process::Command::new(python)
        .arg("-c")
        .arg(NLLB_RUNTIME_CHECK_SCRIPT)
        .output()
        .await
        .map_err(|e| format!("运行 Python 环境检查失败: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let value = serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|e| format!("无法解析 Python 环境检查结果: {e}"))?;
    let missing = value
        .get("missing")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| NLLB_RUNTIME_PACKAGES.iter().map(|item| item.to_string()).collect());
    Ok(missing)
}

async fn ensure_uv(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let uv = uv_path(app)?;
    if uv.exists() {
        return Ok(uv);
    }

    let bin_dir = runtime_dir(app)?.join("bin");
    tokio::fs::create_dir_all(&bin_dir)
        .await
        .map_err(|e| format!("创建运行环境目录失败: {e}"))?;
    let install_dir = bin_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        let mut command = tokio::process::Command::new("powershell");
        command.args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &format!(
                "$env:UV_INSTALL_DIR={}; irm https://astral.sh/uv/install.ps1 | iex",
                serde_json::to_string(&install_dir).unwrap_or_else(|_| format!("\"{install_dir}\""))
            ),
        ]);
        run_command(command, "安装 uv").await?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut command = tokio::process::Command::new("sh");
        command.args([
            "-c",
            &format!(
                "curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR={} sh",
                shell_quote(&install_dir)
            ),
        ]);
        run_command(command, "安装 uv").await?;
    }

    if uv.exists() {
        Ok(uv)
    } else {
        Err("uv 安装完成后未找到可执行文件。".to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

async fn ensure_nllb_runtime(app: &AppHandle) -> Result<NllbRuntimeStatus, String> {
    let uv = ensure_uv(app).await?;
    let venv = venv_dir(app)?;
    let python = venv_python_path(app)?;

    if !python.exists() {
        let mut python_install = tokio::process::Command::new(&uv);
        python_install.args(["python", "install", NLLB_PYTHON_VERSION]);
        run_command(python_install, "下载 Python").await?;

        let mut venv_command = tokio::process::Command::new(&uv);
        venv_command
            .arg("venv")
            .arg(&venv)
            .arg("--python")
            .arg(NLLB_PYTHON_VERSION);
        run_command(venv_command, "创建 NLLB Python 虚拟环境").await?;
    }

    let mut install_command = tokio::process::Command::new(&uv);
    install_command
        .arg("pip")
        .arg("install")
        .arg("--python")
        .arg(&python)
        .args(NLLB_RUNTIME_PACKAGES);
    run_command(install_command, "安装 NLLB Python 依赖").await?;

    check_nllb_runtime(app.clone()).await
}

#[tauri::command]
pub async fn check_nllb_runtime(app: AppHandle) -> Result<NllbRuntimeStatus, String> {
    let runtime = runtime_dir(&app)?;
    let venv_python = venv_python_path(&app)?;

    let python_path = if venv_python.exists() {
        Some(venv_python.clone())
    } else {
        find_system_python().await.map(std::path::PathBuf::from)
    };

    let Some(python) = python_path else {
        return Ok(NllbRuntimeStatus {
            ready: false,
            runtime_dir: runtime.to_string_lossy().to_string(),
            python_path: None,
            missing_packages: NLLB_RUNTIME_PACKAGES.iter().map(|item| item.to_string()).collect(),
            message: "未检测到可用 Python，将使用 uv 自动下载托管 Python。".to_string(),
        });
    };

    let missing = check_python_packages(&python).await.unwrap_or_else(|_| {
        NLLB_RUNTIME_PACKAGES
            .iter()
            .map(|item| item.to_string())
            .collect()
    });
    let ready = missing.is_empty() && venv_python.exists();

    Ok(NllbRuntimeStatus {
        ready,
        runtime_dir: runtime.to_string_lossy().to_string(),
        python_path: Some(python.to_string_lossy().to_string()),
        missing_packages: missing.clone(),
        message: if ready {
            "NLLB 运行环境已就绪。".to_string()
        } else if venv_python.exists() {
            format!("NLLB 运行环境缺少依赖: {}", missing.join(", "))
        } else {
            "将创建独立 NLLB Python 环境并安装依赖。".to_string()
        },
    })
}

#[tauri::command]
pub async fn install_nllb_runtime(app: AppHandle) -> Result<NllbRuntimeStatus, String> {
    emit_runtime_progress(&app, "uv", "正在准备 Python 环境管理器 uv…");
    ensure_uv(&app).await?;
    emit_runtime_progress(&app, "python", "正在下载或检查托管 Python…");
    let uv = uv_path(&app)?;
    let mut python_install = tokio::process::Command::new(&uv);
    python_install.args(["python", "install", NLLB_PYTHON_VERSION]);
    run_command(python_install, "下载 Python").await?;

    emit_runtime_progress(&app, "venv", "正在创建 NLLB 独立虚拟环境…");
    let venv = venv_dir(&app)?;
    let python = venv_python_path(&app)?;
    if !python.exists() {
        let mut venv_command = tokio::process::Command::new(&uv);
        venv_command
            .arg("venv")
            .arg(&venv)
            .arg("--python")
            .arg(NLLB_PYTHON_VERSION);
        run_command(venv_command, "创建 NLLB Python 虚拟环境").await?;
    }

    emit_runtime_progress(&app, "packages", "正在安装 torch / transformers / sentencepiece…");
    let status = ensure_nllb_runtime(&app).await?;
    emit_runtime_progress(&app, "done", "NLLB 运行环境已就绪。");
    Ok(status)
}

async fn translate_with_local_nllb(
    app: &AppHandle,
    source_lang: String,
    target_lang: String,
    texts: Vec<String>,
) -> Result<Vec<String>, String> {
    let model_dir = get_model_dir(app)
        .map_err(|e| e.to_string())?
        .join(NLLB_MODEL_ID);
    if !model_dir.exists() {
        return Err("NLLB 模型尚未下载，请先下载模型。".to_string());
    }

    let runtime = check_nllb_runtime(app.clone()).await?;
    if !runtime.ready {
        return Err(format!("NLLB 运行环境尚未就绪。{}", runtime.message));
    }
    let python = runtime
        .python_path
        .ok_or_else(|| "未找到 NLLB Python 运行环境。".to_string())?;

    let payload = json!({
        "model_dir": model_dir.to_string_lossy(),
        "texts": texts,
        "source_lang": source_lang,
        "target_lang": target_lang,
    });
    let expected = payload["texts"].as_array().map_or(0, Vec::len);
    let log_path = runtime_dir(app)?.join("nllb-translate.log");

    let mut child = tokio::process::Command::new(python)
        .arg("-c")
        .arg(NLLB_TRANSLATE_SCRIPT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("启动本地 NLLB 翻译进程失败: {e}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取本地 NLLB stdout。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取本地 NLLB stderr。".to_string())?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .await
            .map_err(|e| format!("写入翻译请求失败: {e}"))?;
    }

    emit_translation_progress(app, "start", format!("已启动本地 NLLB 进程，日志: {}", log_path.to_string_lossy()));

    let app_for_stderr = app.clone();
    let stderr_task = tokio::spawn(async move {
        let mut stderr_log = String::new();
        let mut log_file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .await
            .ok();
        let mut lines = BufReader::new(stderr).lines();

        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| format!("读取本地 NLLB stderr 失败: {e}"))?
        {
            stderr_log.push_str(&line);
            stderr_log.push('\n');

            if let Some(file) = log_file.as_mut() {
                let _ = file.write_all(line.as_bytes()).await;
                let _ = file.write_all(b"\n").await;
            }

            if let Ok(value) = serde_json::from_str::<NllbTranslationProgress>(&line) {
                emit_translation_progress(&app_for_stderr, &value.phase, value.message);
            } else if !line.trim().is_empty() {
                emit_translation_progress(&app_for_stderr, "stderr", line);
            }
        }

        Ok::<String, String>(stderr_log)
    });

    let stdout_task = tokio::spawn(async move {
        let mut stdout_text = String::new();
        stdout
            .read_to_string(&mut stdout_text)
            .await
            .map_err(|e| format!("读取本地 NLLB stdout 失败: {e}"))?;
        Ok::<String, String>(stdout_text)
    });

    let result = timeout(Duration::from_secs(LOCAL_NLLB_TIMEOUT_SECS), async {
        let status = child
            .wait()
            .await
            .map_err(|e| format!("等待本地 NLLB 进程失败: {e}"))?;
        let stdout = stdout_task
            .await
            .map_err(|e| format!("本地 NLLB stdout 任务失败: {e}"))??;
        let stderr = stderr_task
            .await
            .map_err(|e| format!("本地 NLLB stderr 任务失败: {e}"))??;
        Ok::<_, String>((status, stdout, stderr))
    })
        .await
        .map_err(|_| "本地 NLLB 翻译超时。".to_string())?
        .map_err(|e| format!("读取本地 NLLB 翻译输出失败: {e}"))?;

    let (status, stdout, stderr) = result;
    let value = serde_json::from_str::<Value>(stdout.trim())
        .map_err(|e| format!("无法解析本地 NLLB 输出：{e}\n{stderr}"))?;

    if !status.success() {
        return extract_translations(&value, 0).or_else(|error| {
            Err(if stderr.trim().is_empty() {
                error
            } else {
                format!("{error}\n{stderr}")
            })
        });
    }

    extract_translations(&value, expected)
}

#[tauri::command]
pub async fn translate_texts(
    app: AppHandle,
    endpoint: String,
    source_lang: String,
    target_lang: String,
    texts: Vec<String>,
) -> Result<Vec<String>, String> {
    let endpoint = endpoint.trim();
    if endpoint == LOCAL_NLLB_ENDPOINT {
        return translate_with_local_nllb(&app, source_lang, target_lang, texts).await;
    }

    if endpoint.is_empty() {
        return Err("请先填写翻译服务地址".to_string());
    }
    if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
        return Err("翻译服务地址需要以 http:// 或 https:// 开头".to_string());
    }
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let expected = texts.len();

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(TRANSLATION_TIMEOUT_SECS))
        .build()
        .map_err(|error| error.to_string())?;

    let payload = json!({
        "texts": texts,
        "source_lang": source_lang.clone(),
        "target_lang": target_lang.clone(),
        "source": source_lang,
        "target": target_lang,
    });

    let response = client
        .post(endpoint)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("无法连接翻译服务：{error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("翻译服务返回 HTTP {status}: {body}"));
    }

    let value = response
        .json::<Value>()
        .await
        .map_err(|error| format!("无法解析翻译服务响应：{error}"))?;
    let translations = extract_translations(&value, expected)?;

    if translations.len() != expected {
        return Err(format!(
            "翻译服务返回了 {} 条译文，但请求了 {} 条",
            translations.len(),
            expected
        ));
    }

    Ok(translations)
}

#[tauri::command]
pub async fn polish_translations(
    endpoint: String,
    model: String,
    prompt: String,
    items: Vec<PolishRequestItem>,
) -> Result<Vec<String>, String> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Err("请先填写 LLM 润色服务地址。".to_string());
    }
    if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
        return Err("LLM 润色服务地址需要以 http:// 或 https:// 开头。".to_string());
    }
    if model.trim().is_empty() {
        return Err("请先填写润色模型名称。".to_string());
    }
    if items.is_empty() {
        return Ok(Vec::new());
    }

    let expected_indexes = items.iter().map(|item| item.index).collect::<Vec<_>>();
    let user_payload = if items.len() == 1 {
        let item = &items[0];
        json!({
            "task": "polish_single_subtitle_translation",
            "target_index": item.index,
            "output_format": "Return ONLY one JSON object: {\"index\": target_index, \"text\": string}. The text must polish target.draft_text only. Do not output context.previous or context.next. Do not combine subtitle lines.",
            "target": {
                "index": item.index,
                "source_text": item.source_text,
                "draft_text": item.draft_text,
            },
            "context": {
                "previous": item.previous,
                "next": item.next,
            },
        })
    } else {
        json!({
            "task": "polish_subtitle_translations",
            "target_indexes": expected_indexes,
            "output_format": "Return ONLY the target_indexes items as a JSON array. Each item must be {\"index\": number, \"text\": string}. Do not output previous or next context items. Do not combine subtitle lines.",
            "items": items,
        })
    };
    let user_content = serde_json::to_string_pretty(&user_payload)
        .map_err(|error| format!("无法构建润色请求: {error}"))?;

    let (used_endpoint, value) = send_polish_request(endpoint, model.trim(), &prompt, &user_content).await?;
    let content = extract_polish_content(&value)
        .ok_or_else(|| "LLM 润色响应里没有找到 content。".to_string())?;

    parse_polish_content(&content, &expected_indexes)
        .map_err(|error| format!("{error}\n实际调用地址：{used_endpoint}"))
}

#[tauri::command]
pub async fn check_polish_service(
    endpoint: String,
    model: String,
) -> Result<String, String> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Err("请先填写 LLM 润色服务地址。".to_string());
    }
    if !(endpoint.starts_with("http://") || endpoint.starts_with("https://")) {
        return Err("LLM 润色服务地址需要以 http:// 或 https:// 开头。".to_string());
    }
    if model.trim().is_empty() {
        return Err("请先填写润色模型名称。".to_string());
    }

    let user_content = "请只回复：连接正常";
    let prompt = "你是连接测试助手。只输出最短测试结果，不要解释。";
    let (used_endpoint, value) = send_polish_request(endpoint, model.trim(), prompt, user_content).await?;
    let _content = extract_polish_content(&value)
        .ok_or_else(|| format!("服务已响应，但响应里没有找到 content。实际调用地址：{used_endpoint}"))?;

    Ok(format!("连接正常：{}（{}）", model.trim(), used_endpoint))
}
