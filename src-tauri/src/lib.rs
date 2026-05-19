//! lib.rs — Tauri 应用入口（由 main.rs 调用）
//!
//! 在此文件中完成：
//! - 插件注册
//! - Tauri 命令注册（`invoke_handler`）
//! - 应用启动配置

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── 注册插件 ────────────────────────────────────────────────────────
        .plugin(tauri_plugin_shell::init())
        // ── 注册所有前端可调用的 Tauri 命令 ─────────────────────────────────
        // 每个命令对应前端 `invoke('command_name', args)` 的一次调用
        .invoke_handler(tauri::generate_handler![
            commands::check_model_status,
            commands::download_model,
            commands::check_ffmpeg_status,
            commands::download_ffmpeg,
            commands::compress_video,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 应用运行失败");
}
