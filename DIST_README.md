# BD Engine for Windows

BD Engine runs locally on your Windows PC. The installer places the app files in your user profile and stores your working data separately in:

`%LOCALAPPDATA%\BD Engine\Data`

That data folder is preserved when you update or uninstall unless you explicitly choose to remove it during uninstall.

## Install

1. Run `BD-Engine-Setup.exe`.
2. Keep the desktop shortcut selected unless you do not want one.
3. Finish the installer.

No Git, Node.js, npm, SQLite tools, or manual PowerShell commands are required.

## Launch

Use either shortcut:

- Desktop: `BD Engine`
- Start Menu: `BD Engine`

The launcher starts the local BD Engine server on `http://localhost:8173`, waits for it to become ready, and opens your default browser.

If BD Engine is already running, the launcher reuses the existing local server instead of starting another one.

## Update

Run the newer `BD-Engine-Setup.exe`. Your database, settings, logs, and import history remain in `%LOCALAPPDATA%\BD Engine\Data`.

## Uninstall

Use Windows Settings > Apps > Installed apps > BD Engine > Uninstall.

The uninstaller asks whether to remove local BD Engine user data. Choose `No` if you want to keep your data for a future install.

## Troubleshooting

Logs are stored in:

`%LOCALAPPDATA%\BD Engine\Logs`

If the app does not open, check:

- `launcher.log`
- `server.out.log`
- `server.err.log`

BD Engine uses port `8173`. If another app is using that port, close the other app and launch BD Engine again.
