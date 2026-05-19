// main.rs — 桌面端二进制入口
// 在 Windows 上阻止弹出额外的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    qafone_tools_lib::run();
}
