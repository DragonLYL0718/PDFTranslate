//! Where Engine B lives, and the environment that keeps it there.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Everything Engine B installs sits under one directory, so uninstalling is a
/// single removal and the user's own uv / Python installs are never touched.
pub fn engine_b_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("engineb"))
        .map_err(|e| format!("no app data directory: {e}"))
}

/// Where `uv tool install` links the executables it produces.
pub fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(engine_b_dir(app)?.join("bin"))
}

/// Records what was installed, and doubles as the "is it provisioned" flag.
pub fn marker(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(engine_b_dir(app)?.join("provision.json"))
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub fn backend_exe(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(bin_dir(app)?.join(exe("pdftranslate-backend")))
}

pub fn babeldoc_exe(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(bin_dir(app)?.join(exe("babeldoc")))
}

/// The staged backend source, bundled as an app resource (see scripts/stage-backend.mjs).
pub fn backend_source(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("backend", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("bundled backend source missing: {e}"))
}

/// Environment that confines uv to our directory instead of the user's home.
pub fn uv_env(app: &AppHandle) -> Result<Vec<(String, String)>, String> {
    let root = engine_b_dir(app)?;
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    Ok(vec![
        ("UV_CACHE_DIR".into(), s(root.join("uv-cache"))),
        ("UV_PYTHON_INSTALL_DIR".into(), s(root.join("python"))),
        ("UV_TOOL_DIR".into(), s(root.join("tools"))),
        ("UV_TOOL_BIN_DIR".into(), s(bin_dir(app)?)),
        // Never touch the user's shell profile — this install is ours to remove.
        ("UV_NO_MODIFY_PATH".into(), "1".into()),
    ])
}
