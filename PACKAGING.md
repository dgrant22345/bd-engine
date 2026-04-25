# Windows Packaging

BD Engine Phase 1 Windows packaging uses Inno Setup. The customer installer is built from a clean staged runtime tree and does not include repo data, demo exports, credentials, or development helper folders.

## Requirements

- Windows
- PowerShell 5.1 or newer
- Inno Setup 6 with `ISCC.exe` available on `PATH`, or pass `-InnoSetupPath`

## Build

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows.ps1
```

Output:

`dist\BD-Engine-Setup.exe`

To validate staging without compiling the installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows.ps1 -SkipInstaller
```

The staged app is written to:

`dist\windows\app`

## Version

The default package version comes from `VERSION`. Override it when needed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\package-windows.ps1 -Version 0.1.1
```

The Inno installer receives the same version for installer metadata.

## What Is Packaged

Included:

- `app`
- `server\Server.ps1`
- `server\BackgroundJobWorker.ps1`
- `server\schema.sql`
- `server\Modules`
- `server\vendor\sqlite`
- runtime-required `scripts\Sync-LiveJobBoardsConfig.ps1`
- `BD-Engine-Launcher.ps1`
- `data-template` with empty JSON/template files
- `DIST_README.md`, `PACKAGING.md`, `README.md`, and `VERSION`

Excluded:

- `data`
- `BD-Engine\data`
- historical backups
- generated distribution files
- credentials and service-account files
- outreach/Gmail/helper folders
- development tools and packaging scripts
- vendor-only license-generation tools

## Runtime Data

Development still defaults to the repository `data` folder.

The packaged launcher sets:

`BD_ENGINE_DATA_ROOT=%LOCALAPPDATA%\BD Engine\Data`

The backend modules use that environment variable for JSON state, SQLite state, background-job logs, PID files, and resolver mapping overrides. If the variable is absent, existing development behavior is preserved.

## Validation Checklist

1. Run `scripts\package-windows.ps1`.
2. Confirm `dist\BD-Engine-Setup.exe` exists.
3. Install on a clean Windows profile or VM.
4. Launch from the desktop shortcut.
5. Confirm the browser opens to `http://localhost:8173`.
6. Confirm `http://localhost:8173/api/runtime/status` responds.
7. Add or import a small test record.
8. Close and relaunch BD Engine; confirm the data remains.
9. Install the same or newer version over the existing install; confirm data remains.
10. Uninstall and choose `No` when asked to remove user data; confirm `%LOCALAPPDATA%\BD Engine\Data` remains.
11. Inspect `dist\windows\app` and confirm no personal/demo data or credentials are present.

## Deferred To Phase 2

- First-run setup wizard polish
- LinkedIn Connections CSV guided import flow
- Optional launch-at-startup support
- Signed installer and signed launcher executable
- Rich installer branding/icon assets
- Port fallback UI if `8173` is occupied by another service
