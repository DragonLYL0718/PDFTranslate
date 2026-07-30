mod backend;
mod paths;
mod provision;

use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// Hand a PDF the OS asked us to open over to the webview.
///
/// Filtered to .pdf because the association can be invoked with anything, and
/// the import path only knows what to do with a PDF.
fn emit_open_files(app: &AppHandle, paths: Vec<PathBuf>) {
    let pdfs: Vec<String> = paths
        .into_iter()
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")))
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if !pdfs.is_empty() {
        let _ = app.emit("app://open-files", pdfs);
    }
}

/// Read a file the OS handed us.
///
/// Returns raw bytes rather than a JSON array: a PDF goes through this whole
/// and number-array encoding would cost several copies of it.
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("cannot read {path}: {e}"))
}

pub fn run() {
    tauri::Builder::default()
        // Must be registered first, per the plugin's contract.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch — "Open with", or just double-clicking the app
            // again — hands its arguments here instead of starting a rival
            // process. Surface the existing window and take its files.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            emit_open_files(app, argv.iter().skip(1).map(PathBuf::from).collect());
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(backend::BackendState::default())
        .invoke_handler(tauri::generate_handler![
            provision::engine_b_status,
            provision::engine_b_install,
            provision::engine_b_uninstall,
            backend::engine_b_start,
            backend::engine_b_stop,
            backend::engine_b_backend_status,
            read_file_bytes,
        ])
        .setup(|app| {
            // Windows and Linux deliver an "open with" target as argv on the
            // very first launch, where the single-instance hook never fires.
            #[cfg(not(target_os = "macos"))]
            emit_open_files(
                app.handle(),
                std::env::args_os().skip(1).map(PathBuf::from).collect(),
            );

            // Start the backend if it's already provisioned, off the critical
            // path: waiting on it would delay first paint by up to 30s, and the
            // frontend re-probes when the status event lands anyway.
            let handle = app.handle().clone();
            if provision::engine_b_status(handle.clone())
                .map(|s| s.installed)
                .unwrap_or(false)
            {
                tauri::async_runtime::spawn_blocking(move || {
                    let state = handle.state::<backend::BackendState>();
                    if let Err(e) = backend::engine_b_start(handle.clone(), state) {
                        eprintln!("engine B autostart failed: {e}");
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Both fire on a normal quit; stop() is idempotent. Without this the
            // backend outlives the window it belongs to.
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                app.state::<backend::BackendState>().stop();
            }
            // macOS routes "open with" through an Apple event, not argv.
            #[cfg(target_os = "macos")]
            RunEvent::Opened { ref urls } => {
                let paths = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
                emit_open_files(app, paths);
            }
            _ => {}
        });
}
