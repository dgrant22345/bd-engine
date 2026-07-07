# Relational data migration (in progress — branch `feature/relational-migration`)

## Why
Today every tenant's whole workspace (accounts, contacts, jobs, configs,
activities, tasks) is one `tenant_data` JSONB row, loaded fully into process
memory and rewritten in full (~30MB for the flagship tenant) on every mutation.
That caps the product at a handful of real customers: whole-blob write
amplification, no indexes (in-memory linear scans), unbounded per-process
memory, and no path to a second instance.

## Target design: "indexed columns + JSONB payload"
Each entity gets its own table (`rel_accounts`, `rel_contacts`, `rel_jobs`,
`rel_board_configs`, `rel_activities`, `rel_tasks`) with **typed, indexed columns
for the fields we actually filter/sort/search on**, plus a `data JSONB` column
holding the full object. Accounts have 45+ evolving scoring/enrichment fields, so
full column-mapping would be brittle; this hybrid gets indexed queries + per-row
writes without pinning down every field.

Primary key is **composite `(tenant_id, id)`** — the legacy 4-char id factory
produced ids that collide within and across tenants, so a global `id` PK would
silently drop rows. Composite keys also fix the old cross-tenant `accountById`
bug (lookups become tenant-scoped by construction).

## Status — step 1 done (foundation, zero prod impact)
- `saas/migrations/001_relational.sql` — schema (tables + indexes).
- `saas/scripts/migrate-to-relational.mjs` — idempotent backfill from
  `tenant_data`; de-dupes within-tenant id collisions; per-tenant transaction.
- `saas/scripts/bench-relational.mjs` — correctness + read benchmark.

The `rel_*` tables live ALONGSIDE `tenant_data`. Nothing reads them yet, so
creating/backfilling them does not affect the running app.

### Proven against the real 12k/20k tenant
- Backfill: exact count match (12,317 / 20,509 / 373 / 12,317), no id collisions,
  ~20s.
- Reads (indexed SQL) ~130ms over the public proxy — paginated list, ILIKE
  search, count, contacts-by-account, account-by-id — vs ~1,776ms just to
  fetch+parse the 30MB blob the app loads today. From inside Railway (private
  network) the SQL side is single-digit ms.

## Status — step 2 done (read adapter for lists, flag-gated, default OFF)
- `saas/src/relational-reads.js` — SQL `findAccounts` + `findContacts`, matching
  the blob semantics exactly (text search across indexed columns + JSONB fields,
  sort by score with `ord` tie-break, pagination). Same `{items,page,pageSize,
  total}` shape; `items` are the full objects (from the `data` JSONB).
- `rel_*` gained an `ord` column (original array index) so tie-order matches the
  in-memory stable sort byte-for-byte.
- `store.js` delegates `findAccounts`/`findContacts` to the SQL adapter when
  `BD_USE_RELATIONAL=true`; default OFF keeps the in-memory path untouched.
- `db.js` exports `dbQuery` for the adapters.
- Proven: `eqtest-reads.mjs` shows byte-identical pages vs the blob across 12
  queries (empty, pagination, text search, no-match) on the real tenant;
  `test-integration.mjs` runs the full store→adapter→pool path (flag ON) returning
  the real 12,317 accounts in ~190ms with no 30MB memory load; flag-OFF verified
  unchanged.

**Still NOT safe to flip on in prod** until writes also update `rel_*` — the SQL
path would otherwise read a stale snapshot. That's the next step.

## Remaining steps (future sessions)
1. **Write adapter / dual-write**: on each mutation, upsert the affected row(s)
   into `rel_*` (and update `ord` as needed) so the SQL reads are never stale.
   Then `BD_USE_RELATIONAL` becomes safe to flip per tenant.
2. **Remaining reads**: `findJobs` (has ats/active/isNew/recency/sortBy filters),
   `getAccountDetail`, and the dashboard aggregates.
3. **Cutover per tenant**: re-run backfill fresh, flip the flag for that tenant,
   monitor. `rel_migration_state` tracks who's migrated.
4. **Decommission** the in-memory global arrays + `tenant_data` writes once all
   tenants are on relational; LRU/eviction is no longer needed (reads are SQL).
   Unblocks a second instance.
5. **Follow-up**: the backfill de-dupes colliding ids by suffixing; a real
   cutover should also remap references (contact.accountId) for any re-ided
   accounts. (No collisions were found in the current real data, so this is
   latent, not urgent.)

## Safety
- All work is additive (`rel_*` tables). The app is untouched until step 1/2 ship
  behind a flag defaulting OFF.
- The backfill is idempotent (per-tenant DELETE + INSERT in a transaction).
- Cutover is per-tenant and reversible (flip the flag back to the blob store).
