# Cutting a GitHub Release

The public repo publishes installers from **git tags**. Do not copy images or
secrets from the private monorepo.

## What users download

A tag `v0.1.0` starts [`.github/workflows/release.yml`](../.github/workflows/release.yml), which builds:

- Linux AppImage (`Nolain-Data-Query.AppImage`)
- Windows NSIS installer (`.exe`) and MSI (`.msi`)

macOS packages are not produced yet. macOS users build from source.

## How to publish

1. Confirm `desktop_app/frontend/src-tauri/tauri.conf.json` `version` matches
   the tag you will create (for example `0.1.0`).
2. Commit any README or code changes on `main`.
3. Create and push an annotated tag:

```bash
git tag -a v0.1.0 -m "nolainquery desktop 0.1.0"
git push origin v0.1.0
```

4. Wait for **Release** to finish on GitHub Actions.
5. Open the generated GitHub Release, attach nothing extra, and check the
   notes. Do not upload `.env` files or AppImages built on a machine that had
   a local Cloud API URL baked in.

To rebuild the same version, delete the GitHub Release **and** the tag, then
push the tag again. Prefer a new patch version (`v0.1.1`) instead.

## Manual fallback

If Actions cannot run:

```bash
# Linux
./setup.sh
./distribute.sh

# Windows (PowerShell)
.\distribute-windows.ps1
```

Then create a Release in the GitHub UI and attach:

- `Nolain-Data-Query.AppImage`
- files under `dist/windows/`
