# BD Engine Operations Runbook

## Release gate

Run these before pushing a production change:

```powershell
npm.cmd --prefix saas run check
npm.cmd --prefix saas test
npm.cmd --prefix saas run test:browser
$env:BD_CLOUD_SMOKE_URL='http://127.0.0.1:8787'
npm.cmd --prefix saas run smoke
```

Production smoke checks are read-only unless
`BD_CLOUD_SMOKE_ALLOW_MUTATIONS=true` is explicitly set. Never enable mutation
smoke checks against customer production data.

After deployment, verify `/health`, relational parity, recent application
errors, and HTTP 5xx logs. A healthy release has a connected database, zero
mirror mismatches, zero deep-content mismatches, and the expected relational
primary count.

## Backup and restore

Create a compressed, checksummed application backup before migrations or bulk
data changes:

```powershell
npm.cmd --prefix saas run backup -- --output backups/<change-name>
```

The command verifies the archive after writing it and prints its SHA-256 hash.
Keep at least one copy outside the application workspace. Railway database
snapshots or another encrypted offsite destination should run daily; this is an
infrastructure setting and is not replaced by repository code.

Test a restore into a disposable database before relying on a backup:

```powershell
npm.cmd --prefix saas run restore -- --file <backup.json.gz> --dry-run
npm.cmd --prefix saas run restore -- --file <backup.json.gz> --apply
```

Never point an apply restore at production unless recovery has been approved
and a current production backup exists.

## Relational storage

- `BD_RELATIONAL_WRITE_TENANTS` holds explicit relational-primary canaries.
- `BD_RELATIONAL_WRITE_NEW_TENANTS=true` makes newly created workspaces
  relational-primary and persists that choice in `tenants.storage_mode`.
- Existing legacy workspaces are not migrated by the new-workspace flag.

Verify legacy mirrors:

```powershell
npm.cmd --prefix saas run check:relational -- --deep
```

Create or refresh a legacy rollback snapshot from relational data:

```powershell
npm.cmd --prefix saas run snapshot:legacy -- --tenant <tenant-id> --dry-run
npm.cmd --prefix saas run snapshot:legacy -- --tenant <tenant-id>
```

Before reverting a relational-primary workspace to legacy reads, create the
snapshot and verify exact content parity. Then change its storage mode or
remove its explicit canary flag and redeploy.

## Test-data cleanup

The cleanup command only targets old accounts on reserved `example.com` and
`bd-engine.invalid` smoke patterns. It refuses billed workspaces, defaults to a
dry run, and requires an exact confirmation phrase to apply:

```powershell
npm.cmd --prefix saas run cleanup:test-data -- --before 2026-01-01
npm.cmd --prefix saas run cleanup:test-data -- --before 2026-01-01 --apply --confirm DELETE_TEST_DATA
```

Review the complete dry-run manifest and create a verified backup first.

## External production services

The app reports these in the authenticated status screen:

- `BD_INTERNAL_OWNER_EMAILS` grants internal owner entitlements; keep this in
  deployment configuration and never hardcode privileged identities.
- `BD_ANALYTICS_ADMIN_EMAILS` controls access to site analytics.
- `BD_SUPPORT_ADMIN_EMAILS` controls access to customer support conversations;
  internal owners also retain access. Keep this list narrower than general
  workspace administration and review it when support staff change.
- `RESEND_API_KEY` and `BD_EMAIL_FROM` enable password reset, email verification,
  and support notifications. New customer messages go to support admins;
  customer-facing replies go to the requester. Internal notes are never emailed.
  Confirm these flows against real inboxes after changing either setting.
- `BD_ERROR_WEBHOOK` enables immediate server-error alerts.
- An external uptime monitor should poll `/health` and alert on non-200 results.
- Privacy and Terms copy requires legal review before broad commercial launch.

Do not mark these ready based only on code presence; verify the live provider
configuration and an end-to-end test.
