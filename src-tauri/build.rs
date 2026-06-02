// build.rs — Tauri 要求的构建脚本，勿删
fn main() {
    link_macos_clang_runtime();
    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn link_macos_clang_runtime() {
    use std::{path::PathBuf, process::Command};

    let Ok(output) = Command::new("clang")
        .args(["-print-file-name=libclang_rt.osx.a"])
        .output()
    else {
        return;
    };

    if !output.status.success() {
        return;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let runtime = PathBuf::from(path);
    if runtime.is_file() {
        println!("cargo:rustc-link-arg={}", runtime.display());
    }
}

#[cfg(not(target_os = "macos"))]
fn link_macos_clang_runtime() {}
