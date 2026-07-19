# Disaster Recovery

BD Engine stores live cloud data in Postgres. The app now has a logical backup
and restore path for the tenant, user, workspace, and analytics tables.

## Create a Backup

From the `saas` folder:

Set `BD_BACKUP_ENCRYPTION_KEY` to a dedicated 32-byte random key encoded as
`base64:...` or 64 hexadecimal characters. Store the key separately from the
archives, then run:

```powershell
npm run backup -- --require-encryption
```

The backup is written to `saas/backups/` by default as an authenticated,
encrypted `.json.gz.enc` file. You can override the destination:

```powershell
npm run backup -- --out C:\secure-backups\bd-engine-nightly.json.gz.enc --require-encryption
```

Useful options:

- `--skip-analytics` creates a smaller backup without visit analytics.
- `--include-volatile` includes sessions, password-reset and email-verification
  tokens, and rate-limit buckets. Leave this off for normal scheduled backups.
- `--url postgres://...` uses a specific Postgres connection instead of
  `DATABASE_URL`.

Backups include password hashes and workspace data. AES-256-GCM protects both
confidentiality and integrity, but operators must still restrict archive access
and keep the encryption key in a separate secret manager. Production backups
refuse to run without a valid key. A repeatable-read transaction keeps every
table in the archive on the same database snapshot while customers continue to
use the application.

## Verify a Backup

Before depending on a file, run the restore tool in dry-run mode:

```powershell
npm run restore -- --file .\backups\bd-engine-backup-2026-07-19T00-00-00-000Z.json.gz.enc --dry-run
```

This authenticates and decrypts the file, checks that it can be decompressed and
parsed, and recognizes it as a BD Engine backup without touching the database.
It fails if the key is wrong or the archive was modified.

## Restore

Use a fresh database when possible. Start the app once against that database so
the tables exist, then run:

```powershell
$env:BD_RESTORE_CONFIRM = "RESTORE"
npm run restore -- --file .\backups\bd-engine-backup-2026-07-19T00-00-00-000Z.json.gz.enc --apply --url $env:DISPOSABLE_DATABASE_URL
Remove-Item Env:BD_RESTORE_CONFIRM
```

The restore runs in a transaction and upserts rows in dependency order:

1. users
2. tenants
3. memberships
4. tenant_data
5. relational workspace entities and import/audit/support records
6. the pseudonymous account-closure recovery ledger
7. Stripe webhook and schema migration records
8. analytics events
9. sessions, verification/reset tokens, and rate-limit buckets, only when
   explicitly included

The command refuses a target that already contains customer or workspace rows.
Use a fresh disposable database for drills. `--allow-nonempty` is an emergency
override for an approved recovery plan, not a normal restore option.
Restore locks the destination tables inside its transaction before checking or
writing them; keep the application stopped against that destination until the
restore and verification are complete.

## Operating Target

For production, schedule this at least nightly and copy the resulting file to
private offsite object storage with an approved retention window. Test a dry-run
restore after each backup job and do a full restore drill against disposable
Postgres before relying on the app for paid customers. Record the archive hash,
restore result, operator, date, and recovery time in the launch checklist.
