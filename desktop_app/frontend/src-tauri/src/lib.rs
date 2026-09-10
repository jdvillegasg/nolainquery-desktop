// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(not(debug_assertions))]
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::{process::CommandChild, ShellExt};

#[cfg(not(debug_assertions))]
struct SidecarProcess(Mutex<Option<CommandChild>>);

/// Stop the bundled Python executor and wait until its process tree is gone.
///
/// PyInstaller --onefile spawns a bootloader parent plus the real uvicorn child.
/// Killing only the tracked PID leaves the child running, which keeps the Linux
/// AppImage FUSE mount busy (`Text file busy` on the next overwrite).
#[cfg(not(debug_assertions))]
fn stop_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarProcess>() {
        if let Ok(mut sidecar) = state.0.lock() {
            if let Some(child) = sidecar.take() {
                terminate_process_tree(child.pid());
                let _ = child.kill();
            }
        }
    }
}

#[cfg(not(debug_assertions))]
fn terminate_process_tree(root_pid: u32) {
    if root_pid == 0 || root_pid == std::process::id() {
        return;
    }

    let pids = process_tree(root_pid);
    for pid in &pids {
        signal_pid(*pid, Signal::Term);
    }

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        if pids.iter().all(|pid| !pid_is_alive(*pid)) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    for pid in &pids {
        signal_pid(*pid, Signal::Kill);
    }
    std::thread::sleep(std::time::Duration::from_millis(200));
}

#[cfg(not(debug_assertions))]
enum Signal {
    Term,
    Kill,
}

#[cfg(all(not(debug_assertions), unix))]
fn process_tree(root_pid: u32) -> Vec<u32> {
    let mut tree = vec![root_pid];
    let mut index = 0;
    while index < tree.len() {
        let parent = tree[index];
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let pid = match entry.file_name().to_string_lossy().parse::<u32>() {
                    Ok(pid) => pid,
                    Err(_) => continue,
                };
                if tree.contains(&pid) {
                    continue;
                }
                if ppid_of(pid) == Some(parent) {
                    tree.push(pid);
                }
            }
        }
        index += 1;
    }
    tree
}

#[cfg(all(not(debug_assertions), unix))]
fn ppid_of(pid: u32) -> Option<u32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rparen = stat.rfind(')')?;
    let mut fields = stat[rparen + 2..].split_whitespace();
    let _state = fields.next()?;
    fields.next()?.parse().ok()
}

#[cfg(all(not(debug_assertions), unix))]
fn pid_is_alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}

#[cfg(all(not(debug_assertions), unix))]
fn signal_pid(pid: u32, signal: Signal) {
    let sig = match signal {
        Signal::Term => libc::SIGTERM,
        Signal::Kill => libc::SIGKILL,
    };
    unsafe {
        libc::kill(pid as i32, sig);
    }
}

#[cfg(all(not(debug_assertions), windows))]
fn process_tree(root_pid: u32) -> Vec<u32> {
    vec![root_pid]
}

#[cfg(all(not(debug_assertions), windows))]
fn pid_is_alive(pid: u32) -> bool {
    std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

#[cfg(all(not(debug_assertions), windows))]
fn signal_pid(pid: u32, signal: Signal) {
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T"]);
    if matches!(signal, Signal::Kill) {
        cmd.arg("/F");
    }
    let _ = cmd.status();
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| {
            // Development uses the interpreter started by the root launch.sh.
            // Packaged release builds own the bundled sidecar process.
            #[cfg(not(debug_assertions))]
            {
                let shell = _app.shell();
                let sidecar = shell
                    .sidecar("python-sidecar")
                    .map_err(|e| format!("Failed to create sidecar: {}", e))?;

                let (_rx, child) = sidecar
                    .spawn()
                    .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;
                _app.manage(SidecarProcess(Mutex::new(Some(child))));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(not(debug_assertions))]
        {
            match event {
                tauri::RunEvent::WindowEvent {
                    event: tauri::WindowEvent::CloseRequested { .. },
                    ..
                } => {
                    stop_sidecar(app_handle);
                    app_handle.exit(0);
                }
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    stop_sidecar(app_handle);
                }
                _ => {}
            }
        }
        #[cfg(debug_assertions)]
        let _ = (app_handle, event);
    });
}
