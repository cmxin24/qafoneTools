//! commands/mod.rs — 统一导出所有 Tauri 命令模块

pub mod model_manager;
pub mod video_compressor;

// 将各模块的命令函数重新导出到 crate 根，方便在 lib.rs 中统一注册
pub use model_manager::{check_model_status, download_model};
pub use video_compressor::{check_ffmpeg_status, download_ffmpeg, compress_video};
