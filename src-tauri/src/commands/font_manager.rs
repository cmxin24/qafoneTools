//! # font_manager.rs
//!
//! 字体管理：检测系统字体安装状态、下载字体至用户字体目录、打开字体目录。
//!
//! ## 支持平台
//! - macOS: ~/Library/Fonts/
//! - Windows: %LOCALAPPDATA%\Microsoft\Windows\Fonts\（无需管理员权限）

use std::path::PathBuf;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::{fs, io::AsyncWriteExt};

// ─── 字体定义 ──────────────────────────────────────────────────────────────────

/// 单个字体的元数据。
struct FontDef {
    /// 唯一 ID，前端用于标识字体。
    id: &'static str,
    /// 在系统字体目录中可能存在的文件名（区分大小写的匹配顺序）。
    filenames: &'static [&'static str],
    /// 下载后保存到系统字体目录时使用的文件名。
    install_filename: &'static str,
    /// GitHub 仓库 fonts/ 目录下的文件名（用于拼接下载 URL）。
    github_filename: &'static str,
}

/// GitHub raw 下载基础 URL（指向 fonts/ 目录）。
const GITHUB_RAW_BASE: &str =
    "https://raw.githubusercontent.com/cmxin24/qafoneTools/main/fonts";

const FONT_DEFS: &[FontDef] = &[
    FontDef {
        id: "fz-zhun-yuan",
        filenames: &[
            "FZY3K.TTF",
            "FZZhunYuan-M02.ttf",
            "FZZHUNYUAN_M02S.TTF",
            "FZZHUNYUAN_M02.TTF",
            "FZZhunYuan-M02S.TTF",
        ],
        install_filename: "FZZhunYuan-M02.ttf",
        github_filename: "FZZhunYuan-M02.ttf",
    },
    FontDef {
        id: "noto-sans-sc",
        filenames: &[
            "NotoSansSC-Medium.ttf",
            "NotoSansSC-Medium.otf",
            "Noto Sans SC Medium.otf",
            "NotoSansSC[wght].ttf",
        ],
        install_filename: "NotoSansSC-Medium.ttf",
        github_filename: "NotoSansSC-Medium.ttf",
    },
    FontDef {
        id: "microsoft-yahei",
        filenames: &[
            "msyh.ttc",
            "Microsoft YaHei.ttf",
            "Microsoft-YaHei.ttf",
            "Microsoft YaHei.ttc",
        ],
        install_filename: "Microsoft-YaHei.ttf",
        github_filename: "Microsoft-YaHei.ttf",
    },
];

// ─── 系统字体目录 ───────────────────────────────────────────────────────────────

/// 返回系统字体搜索目录列表（用于检测是否已安装）。
fn system_font_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(&home).join("Library/Fonts"));
        }
        dirs.push(PathBuf::from("/Library/Fonts"));
        dirs.push(PathBuf::from("/System/Library/Fonts"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(&local).join("Microsoft/Windows/Fonts"));
        }
        if let Ok(windir) = std::env::var("WINDIR") {
            dirs.push(PathBuf::from(&windir).join("Fonts"));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(&home).join(".local/share/fonts"));
            dirs.push(PathBuf::from(&home).join(".fonts"));
        }
        dirs.push(PathBuf::from("/usr/share/fonts"));
        dirs.push(PathBuf::from("/usr/local/share/fonts"));
    }

    dirs
}

/// 返回安装字体时使用的目标目录（用户级，无需管理员权限）。
fn user_font_install_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(|h| PathBuf::from(h).join("Library/Fonts"))
    }

    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|local| PathBuf::from(local).join("Microsoft/Windows/Fonts"))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".local/share/fonts"))
    }
}

// ─── Tauri 命令 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FontStatus {
    Installed,
    NotInstalled,
}

/// 检测指定字体是否已安装到系统字体目录。
#[tauri::command]
pub fn check_font_installed(font_id: String) -> FontStatus {
    let Some(def) = FONT_DEFS.iter().find(|d| d.id == font_id) else {
        return FontStatus::NotInstalled;
    };
    let dirs = system_font_search_dirs();
    for dir in &dirs {
        for name in def.filenames {
            if dir.join(name).exists() {
                return FontStatus::Installed;
            }
        }
    }
    FontStatus::NotInstalled
}

/// 从 GitHub 下载字体文件并安装到用户字体目录。
/// 安装进度通过 `font-install-progress` 事件推送（0.0–1.0），完成后推送 1.0。
#[tauri::command]
pub async fn download_and_install_font(
    font_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let def = FONT_DEFS
        .iter()
        .find(|d| d.id == font_id)
        .ok_or_else(|| format!("Unknown font id: {font_id}"))?;

    let install_dir = user_font_install_dir()
        .ok_or_else(|| "Cannot determine user fonts directory".to_string())?;

    fs::create_dir_all(&install_dir)
        .await
        .map_err(|e| format!("Failed to create fonts directory: {e}"))?;

    let url = format!("{}/{}", GITHUB_RAW_BASE, def.github_filename);
    let dest = install_dir.join(def.install_filename);

    let client = Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}: {}", response.status(), url));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut file = fs::File::create(&dest)
        .await
        .map_err(|e| format!("Failed to create file: {e}"))?;

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("Stream error: {e}"))?;
        downloaded += bytes.len() as u64;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("Write error: {e}"))?;

        if total > 0 {
            let progress = downloaded as f64 / total as f64;
            let _ = app.emit("font-install-progress", (font_id.clone(), progress));
        }
    }

    let _ = app.emit("font-install-progress", (font_id.clone(), 1.0_f64));
    Ok(())
}

/// 在系统文件管理器中打开用户字体安装目录。
#[tauri::command]
pub fn open_fonts_directory() -> Result<(), String> {
    let dir = user_font_install_dir()
        .ok_or_else(|| "Cannot determine fonts directory".to_string())?;

    // 确保目录存在
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create directory: {e}"))?;

    let dir_str = dir
        .to_str()
        .ok_or_else(|| "Invalid path encoding".to_string())?
        .to_owned();

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {e}"))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {e}"))?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir_str)
            .spawn()
            .map_err(|e| format!("Failed to open directory: {e}"))?;
    }

    Ok(())
}
