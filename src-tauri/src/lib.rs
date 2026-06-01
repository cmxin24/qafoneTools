//! lib.rs — Tauri 应用入口（由 main.rs 调用）
//!
//! 在此文件中完成：
//! - 插件注册
//! - Tauri 命令注册（`invoke_handler`）
//! - 应用启动配置

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::{atomic::AtomicBool, Arc};
    use tauri::Manager;

    tauri::Builder::default()
        // ── 注册插件 ──────────────────────────────────────────────────────────────
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        // ── 全局管理状态 ──────────────────────────────────────────────────────────────
        .manage(commands::asr::CancellationFlag(Arc::new(AtomicBool::new(false))))
        // ── 注册所有前端可调用的 Tauri 命令 ─────────────────────────────────
        // 每个命令对应前端 `invoke('command_name', args)` 的一次调用
        .invoke_handler(tauri::generate_handler![
            commands::model_manager::check_model_status,
            commands::model_manager::download_model,
            commands::model_manager::delete_model,
            commands::model_manager::get_model_dir_path,
            commands::video_compressor::check_ffmpeg_status,
            commands::video_compressor::download_ffmpeg,
            commands::video_compressor::compress_video,
            commands::video_compressor::open_path,
            commands::video_compressor::get_file_size,
            commands::video_compressor::save_text_file,
            commands::video_compressor::read_text_file,
            commands::video_compressor::get_video_resolution,
            commands::waveform::extract_waveform,
            commands::asr::extract_subtitles,
            commands::asr::cancel_extraction,
            commands::audio_extractor::get_audio_tracks,
            commands::audio_extractor::preview_audio_track,
            commands::audio_extractor::extract_audio_track,
            commands::font_manager::check_font_installed,
            commands::font_manager::download_and_install_font,
            commands::font_manager::open_fonts_directory,
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 应用运行失败");
}
