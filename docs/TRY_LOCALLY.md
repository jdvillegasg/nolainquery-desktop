# Try the desktop app from source

This is the shortest path for running the Linux desktop app from this
repository while using the hosted Cloud API at
[https://nolainquery.com](https://nolainquery.com). It starts the user interface
and the local Python execution engine. You do not need Cloud API source code or
operator credentials.

## Before you begin

This setup script targets Debian or Ubuntu. You need:

- a Linux desktop with `apt`, internet access, and permission to use `sudo`
- Git, because the setup script does not install it
- a nolainquery account and API key — see [Getting started](./GETTING_STARTED.md)

The script installs the Tauri system libraries, Rust when absent, Node.js 20
when `npm` is absent, Python dependencies in `.venv`, and frontend packages.
On another Linux distribution, install the equivalent Tauri prerequisites
manually before continuing. Windows installers are a separate distribution
path; macOS support is planned and is not available from these scripts.

After setup, you must build the Python sidecar once before the Tauri dev window
can compile. PyInstaller bundling can take several minutes. Development still
runs the live engine from `launch.sh` on port 8001; the sidecar binary is
required only to satisfy Tauri's compile-time check.

## Clone and prepare the repository

Run these commands in a terminal:

```bash
git clone https://github.com/jdvillegasg/nolainquery-desktop.git
cd nolainquery-desktop
./setup.sh
./desktop_app/python_engine/build-sidecar.sh
```

Setup is complete when the script prints `Setup complete.`. The command
downloads packages and may ask for your system password while `apt` installs
dependencies.

The sidecar build writes a gitignored binary under
`desktop_app/frontend/src-tauri/bin/`. Re-run
`./desktop_app/python_engine/build-sidecar.sh` when you change the Python
engine in a way that affects the packaged sidecar.

## Start the desktop against the hosted API

From the repository root, run:

```bash
VITE_CLOUD_API_URL=https://nolainquery.com ./launch.sh
```

The launcher activates `.venv`, starts the local Python engine on port 8001,
waits for its health check, and then starts the Tauri development window. The
terminal prints `Local execution engine is ready.` before the desktop UI
starts.

The explicit `VITE_CLOUD_API_URL` matters: a development build otherwise
defaults to a Cloud API on `http://127.0.0.1:8000`. Leave this terminal running
while using the app; `Ctrl+C` stops the UI and local engine.

Alternatively, copy `desktop_app/frontend/.env.example` to
`desktop_app/frontend/.env` and set `VITE_CLOUD_API_URL` there.

## Verify the first run

1. Open **Settings**, paste your nolainquery API key, and choose **Save API Key**.
2. If you use BYOK, choose **Bring your own key** and save your OpenRouter key.
3. Confirm that the status badge shows your account tier.
4. Open **Home**, choose an Excel, CSV, or Parquet file, and confirm that the
   preview and insights load. For multi-sheet Excel, see
   [Excel and workbooks](./EXCEL_AND_WORKBOOKS.md).
5. Open **Ask Queries** and ask a descriptive question about a real column.

The run is successful when an answer card appears and **Code** shows the Pandas
calculation executed against your local file.

## If startup fails

- `resource path bin/python-sidecar-... doesn't exist`: run
  `./desktop_app/python_engine/build-sidecar.sh` from the repository root, then
  retry `./launch.sh`.
- `.venv not found`: rerun `./setup.sh` from the repository root.
- A required command is missing: rerun setup and resolve the first dependency
  error it reports.
- Port 8001 is already in use: stop the other local engine, then rerun the
  launcher.
- The engine exits or never becomes ready: use the terminal’s first Python
  error as the cause; the desktop cannot execute files until the engine starts.

For user-facing query failures, use [Troubleshooting](./TROUBLESHOOTING.md).

With the desktop and local engine running, continue with
[Desktop workflows](./DESKTOP_WORKFLOWS.md).
