# Disaster Recovery

BD Engine stores live cloud data in Postgres. The app now has a logical backup
and restore path for the tenant, user, workspace, and analytics tables.

## Create a Backup

From the `saas` folder:

```powershell
npm run backup
```

The backup is written to `saas/backups/` by default as a compressed `.json.gz`
file. You can override the destination:

```powershell
npm run backup -- --out C:\secure-backups\bd-engine-nightly.json.gz
```

Useful options:

- `--skip-analytics` creates a smaller backup without visit analytics.
- `--include-volatile` includes sessions and password-reset tokens. Leave this
  off for normal scheduled backups.
- `--url postgres://...` uses a specific Postgres connection instead of
  `DATABASE_URL`.

Backups include password hashes and workspace data. Store them somewhere private
and encrypted.

## Verify a Backup

Before depending on a file, run the restore tool in dry-run mode:

```powershell
npm run restore -- --file .\backups\bd-engine-backup-2026-07-07T00-00-00-000Z.json.gz --dry-run
```

This checks that the file can be decompressed, parsed, and recognized as a BD
Engine backup without touching the database.

## Restore

Use a fresh database when possible. Start the app once against that database so
the tables exist, then run:

```powershell
$env:BD_RESTORE_CONFIRM = "RESTORE"
npm run restore -- --file .\backups\bd-engine-backup-2026-07-07T00-00-00-000Z.json.gz
```

The restore runs in a transaction and upserts rows in dependency order:

1. users
2. tenants
3. memberships
4. tenant_data
5. analytics_events
6. sessions, if present
7. password_reset_tokens, if present

## Operating Target

For production, schedule this at least nightly and copy the resulting file to
encrypted object storage with a 30-day retention window. Test a dry-run restore
after each backup job and do a full restore drill before relying on the app for
paid customers.
