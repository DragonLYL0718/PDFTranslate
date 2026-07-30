//! Running the installed backend as a managed child process.

use serde::Serialize;
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::paths;

#[derive(Default)]
pub struct BackendState {
    running: Mutex<Option<Child>>,
    url: Mutex<Option<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendStatus {
    pub running: bool,
    pub url: Option<String>,
}

/// A port nothing else holds right now.
///
/// Binding then dropping leaves a window where something else could take it, so
/// callers retry. The alternative — letting uvicorn take port 0 and scraping the
/// assignment out of its log — is more fragile than this race is likely.
fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

/// Wait for the backend to actually accept connections. uvicorn binds only once
/// the app has imported, so this is also a check that it started at all.
fn wait_until_listening(port: u16, deadline: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < deadline {
        if let Ok(stream) = TcpStream::connect(("127.0.0.1", port)) {
            let _ = stream.shutdown(Shutdown::Both);
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

impl BackendState {
    pub fn status(&self) -> BackendStatus {
        let url = self.url.lock().unwrap().clone();
        BackendStatus {
            running: url.is_some(),
            url,
        }
    }

    pub fn stop(&self) {
        let mut guard = self.running.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            #[cfg(unix)]
            // SIGTERM rather than kill(): it lets the backend run its own
            // cleanup, which is what takes a running babeldoc down with it.
            unsafe {
                libc::kill(child.id() as i32, libc::SIGTERM);
            }
            // On Windows there is no signal to send, and TerminateProcess would
            // skip that cleanup and strand babeldoc. The backend's parent
            // watchdog notices we are gone within ~5s and takes the pair down.
            #[cfg(windows)]
            let _ = child.id();
        }
        *guard = None;
        *self.url.lock().unwrap() = None;
    }
}

#[tauri::command]
pub fn engine_b_backend_status(state: tauri::State<'_, BackendState>) -> BackendStatus {
    state.status()
}

#[tauri::command]
pub fn engine_b_stop(app: AppHandle, state: tauri::State<'_, BackendState>) -> Result<(), String> {
    state.stop();
    let _ = app.emit("backend://status", state.status());
    Ok(())
}

#[tauri::command]
pub fn engine_b_start(
    app: AppHandle,
    state: tauri::State<'_, BackendState>,
) -> Result<BackendStatus, String> {
    if state.status().running {
        return Ok(state.status());
    }

    let exe = paths::backend_exe(&app)?;
    if !exe.exists() {
        return Err("Engine B is not installed".into());
    }

    let port = free_port()?;
    let mut cmd = Command::new(&exe);
    cmd.env("PORT", port.to_string())
        // An explicit path beats hoping the child inherited a usable PATH.
        .env("BABELDOC_BIN", paths::babeldoc_exe(&app)?)
        // The shell reaches providers through Rust, so the relay route is dead
        // weight — and it forwards to any URL for any local caller.
        .env("PDFT_DISABLE_PROXY", "1")
        .env("PDFT_PARENT_PID", std::process::id().to_string())
        .env("PYTHONUNBUFFERED", "1")
        // A Windows console defaulting to cp936 would otherwise raise on the
        // backend's own non-ASCII output.
        .env("PYTHONIOENCODING", "utf-8")
        .env("PDFT_EXTRA_ORIGINS", webview_origin())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    // Its own process group, so the backend can signal itself and babeldoc
    // together without the shell being caught in it.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let child = cmd.spawn().map_err(|e| format!("cannot start backend: {e}"))?;
    *state.running.lock().unwrap() = Some(child);

    if !wait_until_listening(port, Duration::from_secs(30)) {
        state.stop();
        let _ = app.emit("backend://status", state.status());
        return Err("backend did not start listening within 30s".into());
    }

    *state.url.lock().unwrap() = Some(format!("http://127.0.0.1:{port}"));
    let status = state.status();
    let _ = app.emit("backend://status", status.clone());
    Ok(status)
}

/// The origin the webview runs on, for the backend's CORS allowlist.
fn webview_origin() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}
