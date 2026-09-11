<p align="center">
  <a href="https://nolain.tech">
    <img src="docs/images/nolain-brand.png" alt="nolain" width="420" />
  </a>
</p>

<h1 align="center">nolainquery</h1>

<p align="center">
  Open-source desktop client from
  <a href="https://nolain.tech">nolain</a>
  for
  <a href="https://nolainquery.com">nolainquery</a>.
</p>

---

<p align="center">
  <a href="#purpose">🎯 Purpose</a>
  &nbsp;·&nbsp;
  <a href="#keys">🔑 Keys</a>
  &nbsp;·&nbsp;
  <a href="#downloads">📦 Downloads</a>
  &nbsp;·&nbsp;
  <a href="#first-run">▶️ First run</a>
  &nbsp;·&nbsp;
  <a href="#build-from-source">🛠️ Build</a>
  &nbsp;·&nbsp;
  <a href="#repository-layout">📁 Layout</a>
  &nbsp;·&nbsp;
  <a href="#documentation">📚 Docs</a>
  &nbsp;·&nbsp;
  <a href="#license">⚖️ License</a>
</p>

---

<p align="center">
  <a href="https://github.com/jdvillegasg/nolainquery-desktop/releases"><img src="https://img.shields.io/github/v/release/jdvillegasg/nolainquery-desktop?display_name=tag&label=release&color=111111" alt="GitHub release" /></a>
  <a href="#downloads"><img src="https://img.shields.io/badge/Linux-AppImage-0A0A0A?logo=linux&logoColor=white" alt="Linux AppImage" /></a>
  <a href="#downloads"><img src="https://img.shields.io/badge/Windows-NSIS%20%2F%20MSI-0078D6?logo=windows&logoColor=white" alt="Windows installers" /></a>
  <a href="#build-from-source"><img src="https://img.shields.io/badge/macOS-source-000000?logo=apple&logoColor=white" alt="macOS from source" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2ecc71" alt="MIT license" /></a>
  <a href="https://jdvillegasg.github.io/nolain-query-docs/"><img src="https://img.shields.io/badge/docs-nolainquery-16a34a" alt="Documentation" /></a>
</p>

## Purpose

nolainquery answers **natural-language queries** about a file that already lives on your computer — for example, “What is total revenue by country?” — and returns **auditable artifacts** so you can inspect the computation that produced the answer: generated Pandas code (runnable as notebook cells), an optional computation graph, and an optional chart.

Your file never leaves the machine. A hosted reasoning service sees only a **sketch** of the data (column names, types, a few samples) and returns a **recipe**. The desktop runs that recipe locally against the real rows.

This repository is the desktop app and the local Python execution engine. The hosted API at [nolainquery.com](https://nolainquery.com) is a separate service. For the privacy split, capabilities, and end-to-end flow, see the [documentation](https://jdvillegasg.github.io/nolain-query-docs/).

Today the product covers descriptive analysis of **one active table** (CSV, Parquet, or one Excel sheet): aggregations, comparisons, rankings, trends, quality checks, transformations, and optional charts.

## Keys

Every run — download or source — needs two keys, entered in **Settings**. They stay on this device.

1. A **nolainquery API key** from [nolainquery.com/account](https://nolainquery.com/account) (sign in with Google → **Account → API Keys** → **Create key**).
2. An **OpenRouter API key** from [openrouter.ai/keys](https://openrouter.ai/keys). Model calls bill your OpenRouter account directly.

**Upgrading from an older build:** the desktop is OpenRouter-only. Open **Settings → Model inference**, paste your OpenRouter key, and choose **Save inference settings** before asking queries.

## Downloads

Prefer a prebuilt binary? Use [GitHub Releases](https://github.com/jdvillegasg/nolainquery-desktop/releases). Maintainers: [docs/RELEASING.md](docs/RELEASING.md).

| Platform | Artifact | Status |
| --- | --- | --- |
| Linux | `Nolain-Data-Query.AppImage` | Published from `v*` tags |
| Windows | NSIS `.exe` and `.msi` | Published from `v*` tags |
| macOS | — | Not packaged yet; [build from source](#build-from-source) |

> **Windows:** Defender and other antivirus tools may interrupt the unsigned installer. **Turn antivirus off while you install**, then turn it back on before you start the app.

## First run

1. Open **Settings**. Paste the nolainquery key into **API Key** → **Save API Key**. Wait for the active-key badge.

   ![Settings: paste and save the nolainquery API key](docs/images/settings-api-key.png)

2. Under **Model inference**, paste your OpenRouter key → **Save inference settings**.

   ![Settings: bring-your-own OpenRouter key](docs/images/settings-byok.png)

3. Open **Home** → **Choose dataset**. Pick a local `.xlsx`, `.xls`, `.csv`, or `.parquet` file. For Excel, pick the active table if several sheets appear.

   ![Home: choose a local dataset](docs/images/home-choose-dataset.png)

4. Open **Ask Queries**, type a question about a real column, press `Ctrl+Enter` (Linux/Windows) or `Command+Enter` (macOS). Inspect **Code**, and optionally **Graph** or **Dashboard**, to audit how the answer was computed.

   ![Ask Queries: question and answer](docs/images/ask-queries.png)

More detail: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

## Build from source

### Linux

You need [Git](https://git-scm.com/downloads) and `sudo` (Debian/Ubuntu).

Run the app:

```bash
git clone https://github.com/jdvillegasg/nolainquery-desktop.git
cd nolainquery-desktop
./setup.sh
./desktop_app/python_engine/build-sidecar.sh
./launch.sh
```

Or build a double-click AppImage:

```bash
git clone https://github.com/jdvillegasg/nolainquery-desktop.git
cd nolainquery-desktop
./setup.sh
./distribute.sh
chmod +x Nolain-Data-Query.AppImage
./Nolain-Data-Query.AppImage
```

If the AppImage build hangs: `sudo apt install libfuse2`, then run `./distribute.sh` again.

Other Linux distros — install [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/), then:

```bash
git clone https://github.com/jdvillegasg/nolainquery-desktop.git
cd nolainquery-desktop
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
pip install pyinstaller
(cd desktop_app/frontend && npm install)
./desktop_app/python_engine/build-sidecar.sh
./launch.sh
```

### Windows

1. Install [Git](https://git-scm.com/download/win).
2. Install [Python 3.11+](https://www.python.org/downloads/) and tick **Add python.exe to PATH**.
3. Install [Node.js 20+](https://nodejs.org/).
4. Install [Rust](https://rustup.rs/).
5. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload.
6. Open PowerShell and run the app:

```powershell
git clone https://github.com/jdvillegasg/nolainquery-desktop.git
cd nolainquery-desktop
.\setup-windows.ps1
.\desktop_app\python_engine\build-sidecar.ps1
.\launch.ps1
```

Or build an installer:

```powershell
git clone https://github.com/jdvillegasg/nolainquery-desktop.git
cd nolainquery-desktop
.\distribute-windows.ps1
```

Then run the `.exe` or `.msi` in `dist\windows\` (antivirus off during install — see [Downloads](#downloads)) and start **nolainquery** from the Start menu.

### macOS

1. `xcode-select --install`
2. Install [Homebrew](https://brew.sh/).
3. In Terminal:

```bash
brew install python@3.11 node rust git
git clone https://github.com/jdvillegasg/nolainquery-desktop.git
cd nolainquery-desktop
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
pip install pyinstaller
(cd desktop_app/frontend && npm install)
./desktop_app/python_engine/build-sidecar.sh
./launch.sh
```

---

When the app window opens, continue at [First run](#first-run). Leave the terminal open while you use the app; `Ctrl+C` (Linux/macOS) or close the PowerShell window (Windows) stops it.

## Repository layout

| Path | Purpose |
| --- | --- |
| `desktop_app/frontend/` | Tauri + React UI |
| `desktop_app/python_engine/` | Local sidecar that reads files and executes generated code |
| `packages/query_execution/` | Restricted Pandas execution sandbox |
| `packages/query_operations/` | Shared computation-graph operation registry |
| `setup.sh` / `launch.sh` | Linux source setup and dev launch |
| `setup-windows.ps1` / `launch.ps1` | Windows source setup and dev launch |
| `distribute.sh` | Linux AppImage |
| `distribute-windows.ps1` | Windows installers |

## Documentation

The full product book is at **[jdvillegasg.github.io/nolain-query-docs](https://jdvillegasg.github.io/nolain-query-docs/)**.

In this repository:

- [Getting started](docs/GETTING_STARTED.md)
- [Try locally](docs/TRY_LOCALLY.md)
- [Desktop workflows](docs/DESKTOP_WORKFLOWS.md)
- [Excel and workbooks](docs/EXCEL_AND_WORKBOOKS.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## License

[MIT](LICENSE).
