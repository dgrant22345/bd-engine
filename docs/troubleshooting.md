# Troubleshooting

## Hosted App

- **Cannot sign in:** use password recovery. If email delivery is unavailable, contact `support@bdengine.io` from the account email.
- **Import has warnings:** open the import result before retrying. Upload the unzipped LinkedIn `Connections.csv`, not the archive.
- **Jobs are missing:** check the authenticated ingestion diagnostics. A source may need a careers URL, manual review, or may not expose a public feed.
- **A scan is still running:** check background status. Refreshing the page does not cancel a durable import.
- **Payment issue:** open Billing from the account menu. The app reports the current grace period and next action.

## Windows App

Logs are in `%LOCALAPPDATA%\BD Engine\Logs`. Data is in `%LOCALAPPDATA%\BD Engine\Data`.

- If launch fails, read `launcher.log`, then `server.err.log`.
- The launcher reuses an existing healthy process and waits up to 60 seconds for startup.
- Port `8173` must be available. The current installer does not yet provide an automatic port-conflict chooser.
- Reinstalling preserves data. Uninstall removes data only when the user explicitly confirms removal.

## Support Report

Include application version, approximate failure time, affected feature, whether a retry changed the result, and the safe error/request identifier shown by the app. Never attach a production database, complete LinkedIn export, backup, password, token, or payment details to a routine support ticket.
