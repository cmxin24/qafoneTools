//! commands/updater.rs — GitHub release update checker

use serde::{Deserialize, Serialize};

const GITHUB_REPO: &str = "cmxin24/qafoneTools";

#[derive(Serialize, Deserialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub latest_version: String,
    pub current_version: String,
    pub release_url: String,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
}

/// Compare two version strings (ignoring leading "v").
/// Returns true if `latest` is strictly greater than `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> (u64, u64, u64) {
        let v = v.trim_start_matches('v');
        let mut parts = v.split('.').map(|p| p.parse::<u64>().unwrap_or(0));
        (
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
        )
    };
    parse(latest) > parse(current)
}

/// Fetch the latest GitHub release and compare it against the running version.
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();

    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "qafoneTools-updater")
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API returned {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    let has_update = is_newer(&release.tag_name, &current_version);

    Ok(UpdateInfo {
        has_update,
        latest_version: release.tag_name,
        current_version,
        release_url: release.html_url,
    })
}
