//! Installing Engine B without a terminal.
//!
//! The bundled `uv` sidecar downloads a private Python, then installs BabelDOC
//! and the backend into the app's own data directory. This is a multi-minute,
//! ~1-2 GB operation whose two sources (python-build-standalone on GitHub, then
//! the wheels on PyPI) are the ones most likely to be unreachable for this app's
//! main audience — hence the mirror overrides and the streamed log.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::paths;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProvisionEvent {
    /// `key` is an i18n key, resolved in the webview — never a display string.
    Stage { index: u8, total: u8, key: String },
    /// One raw line of uv output, for the detail pane.
    Log { line: String },
    Done { babeldoc: Option<String> },
    Failed { message: String },
}

/// Mirrors are supplied by the frontend so the URLs stay editable in one place.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mirrors {
    pub python_install: Option<String>,
    pub pypi_index: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineBStatus {
    pub installed: bool,
    pub babeldoc: Option<String>,
    pub dir: String,
}

const TOTAL_STAGES: u8 = 5;

fn read_marker(app: &AppHandle) -> Option<serde_json::Value> {
    let path = paths::marker(app).ok()?;
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

#[tauri::command]
pub fn engine_b_status(app: AppHandle) -> Result<EngineBStatus, String> {
    let marker = read_marker(&app);
    Ok(EngineBStatus {
        // The marker alone isn't enough: the user may have deleted the
        // directory out from under us.
        installed: marker.is_some() && paths::backend_exe(&app).map(|p| p.exists()).unwrap_or(false),
        babeldoc: marker
            .and_then(|m| m.get("babeldoc").and_then(|v| v.as_str().map(str::to_string))),
        dir: paths::engine_b_dir(&app)?.to_string_lossy().into_owned(),
    })
}

/// Run one uv step, streaming every output line to the webview.
///
/// Returns the collected stdout so a step can be used as a probe. uv's output
/// is written for humans, so no attempt is made to parse a percentage out of
/// it — the stage counter carries the progress and the log carries the detail,
/// which is what keeps a multi-minute wait from looking like a hang.
async fn uv(
    app: &AppHandle,
    args: &[&str],
    mirrors: &Mirrors,
    ch: &Channel<ProvisionEvent>,
) -> Result<String, String> {
    let mut cmd = app
        .shell()
        .sidecar("uv")
        .map_err(|e| format!("uv sidecar missing: {e}"))?
        .args(args)
        .envs(paths::uv_env(app)?.into_iter().collect::<std::collections::HashMap<_, _>>());

    if let Some(m) = &mirrors.python_install {
        cmd = cmd.env("UV_PYTHON_INSTALL_MIRROR", m);
    }
    if let Some(m) = &mirrors.pypi_index {
        cmd = cmd.env("UV_DEFAULT_INDEX", m);
    }
    // A slow mirror shouldn't look like a failure.
    cmd = cmd.env("UV_HTTP_TIMEOUT", "120");

    let (mut rx, _child) = cmd.spawn().map_err(|e| format!("cannot run uv: {e}"))?;

    let mut out = String::new();
    let mut tail: Vec<String> = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                if line.is_empty() {
                    continue;
                }
                out.push_str(&line);
                out.push('\n');
                tail.push(line.clone());
                if tail.len() > 40 {
                    tail.remove(0);
                }
                let _ = ch.send(ProvisionEvent::Log { line });
            }
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    return Err(format!(
                        "uv {} exited with {:?}\n{}",
                        args.first().copied().unwrap_or(""),
                        payload.code,
                        tail.join("\n")
                    ));
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn engine_b_install(
    app: AppHandle,
    mirrors: Mirrors,
    ch: Channel<ProvisionEvent>,
) -> Result<(), String> {
    match install_inner(&app, &mirrors, &ch).await {
        Ok(version) => {
            let _ = ch.send(ProvisionEvent::Done {
                babeldoc: version.clone(),
            });
            Ok(())
        }
        Err(message) => {
            let _ = ch.send(ProvisionEvent::Failed {
                message: message.clone(),
            });
            Err(message)
        }
    }
}

async fn install_inner(
    app: &AppHandle,
    mirrors: &Mirrors,
    ch: &Channel<ProvisionEvent>,
) -> Result<Option<String>, String> {
    let stage = |index: u8, key: &str| {
        let _ = ch.send(ProvisionEvent::Stage {
            index,
            total: TOTAL_STAGES,
            key: key.to_string(),
        });
    };

    fs::create_dir_all(paths::engine_b_dir(app)?).map_err(|e| e.to_string())?;

    // Also proves the sidecar is executable at all, which is where a macOS
    // quarantine attribute on the bundle would show up first.
    stage(1, "engineB.stage.check");
    uv(app, &["--version"], mirrors, ch).await?;

    stage(2, "engineB.stage.python");
    uv(app, &["python", "install", "3.12"], mirrors, ch).await?;

    stage(3, "engineB.stage.babeldoc");
    uv(app, &["tool", "install", "--python", "3.12", "BabelDOC"], mirrors, ch).await?;

    stage(4, "engineB.stage.backend");
    let source = paths::backend_source(app)?;
    let source = source.to_string_lossy().into_owned();
    uv(app, &["tool", "install", "--python", "3.12", &source], mirrors, ch).await?;

    // Proves the tool bin directory really has a runnable babeldoc, rather than
    // trusting that the install step's exit code meant what it said.
    stage(5, "engineB.stage.verify");
    let babeldoc = paths::babeldoc_exe(app)?;
    if !babeldoc.exists() {
        return Err(format!("babeldoc was not installed at {}", babeldoc.display()));
    }
    let version = std::process::Command::new(&babeldoc)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    fs::write(
        paths::marker(app)?,
        serde_json::json!({
            "babeldoc": version,
            "installedAt": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        })
        .to_string(),
    )
    .map_err(|e| e.to_string())?;

    Ok(version)
}

#[tauri::command]
pub fn engine_b_uninstall(app: AppHandle) -> Result<(), String> {
    let dir = paths::engine_b_dir(&app)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
