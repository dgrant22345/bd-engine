# SQL-pushdown list reads (branch `feature/relational-sql-reads`)

Builds on codex's relational mirror (`accounts`/`contacts`/… tables with a `raw`
JSONB column, dual-written from `saveTenantNow`). Adds the piece codex hadn't
done: serve the account/contact **list** reads straight from Postgres — filter,
sort, and paginate pushed into SQL — so a large tenant's list views no longer
require loading its whole ~30MB `tenant_data` blob into process memory.

## What shipped here
- `saas/src/relational-queries.js` — `findAccounts` / `findContacts` against the
  mirror. Text search over `raw->>'field'` (byte-identical to the in-memory
  `filterText`), ordered `<score> DESC, updated_at DESC, id ASC` (codex's own
  `loadTenantRelationalData` canonical order), `LIMIT/OFFSET` pagination. Returns
  the same `{items, page, pageSize, total}` shape; `items` are the full `raw`
  objects. Gated by `relationalReadsEnabled()` = `BD_RELATIONAL_READS === 'true'`
  && `isDbReady()`.
- `saas/src/store.js` — `findAccounts` / `findContacts` try the SQL path first
  when the flag is on, and **fall back to the in-memory scan on any error**.
  Default OFF → in-memory path unchanged.
- `saas/scripts/eqtest-queries.mjs` — equivalence test vs a faithful replica of
  the in-memory `sort → filterText → paginate`, run against the real
  12,317-account / 20,509-contact tenant.

## Verified (read-only, real prod data)
- **Filter semantics byte-identical**: every `total` matches the blob filter
  exactly (accounts 12,317 / bank 124 / inc 1,455 / toronto 91 / capital 78 / 0;
  contacts 20,509 / director 2,007 / cfa 46 / vp 210 / toronto 214 / 0).
- **Ordering correct & deterministic**: score sequence monotonic and identical to
  the in-memory score order; `targetScore`/`priorityScore` drift = 0.
- **Contacts: exact full-list order match** (mirror is fully in sync there).
- The adapter reads whatever the mirror holds; correctness of the *read* is
  proven wherever mirror == blob.

## Behavior change to note (ordering)
Scores are coarse — only **18 distinct account scores** over 12k rows, **13
contact scores** over 20k. Within a score tie, today's in-memory order is blob
array order; the mirror/SQL order is `updated_at DESC, id ASC`. So enabling SQL
reads reorders ~almost every row **within its score bucket** (score order itself
is unchanged). This matches codex's own relational read model, and "most-recently
updated first within equal priority" is arguably better — but it is a visible
change. If exact current order must be preserved, add an `ord` (array-index)
column to the mirror + writer and order by that instead.

## Mirror drift — diagnosed & healed
Testing surfaced the mirror lagging the blob. Full diagnosis:
- **Only `updatedAt` differed** on 3,623 / 12,317 accounts (07-05 → 07-10),
  sequential-ms timestamps = a one-by-one loop. **No real content stale** (scores,
  status, notes identical); **contacts 0 drift**.
- **The app's dual-write is sound**: both blob writers mirror correctly —
  `saveTenantNow` (store.js:923 → `syncTenantRelationalMirror`) and
  `clearTenantWorkspaceData` (store.js:1160 → `wipeTenantRelationalMirror`).
  `BD_RELATIONAL_MIRROR` is unset (enabled).
- **Root cause: an out-of-band bulk write to `tenant_data`** (a normalization
  pass re-stamping `updatedAt` during other work) that did NOT go through the app,
  so the mirror never saw it. Not a recurring code bug.
- **Healed** by re-running codex's `backfill-relational.mjs --tenant …` (a fresh
  process has an empty cursor, so it re-upserts everything blob → mirror).

### Cutover safety rule (the durable fix)
The in-memory `updatedAt` cursor means any write that bypasses the app
choke-point (scripts, direct DB edits) can leave the mirror stale until the next
cold load or backfill. So: **run `backfill-relational.mjs --tenant <id>`
immediately before enabling `BD_RELATIONAL_READS` for a tenant**, and after any
out-of-band `tenant_data` mutation. Track migrated tenants in
`rel_migration_state`.

### Recommended (not done here — codex's file, avoid collision)
`relational-writes.js` upserts **one row per query** (~45k round-trips to
backfill this tenant, slow over the proxy and a wide partial-failure window).
Batching into multi-row `INSERT … ON CONFLICT` would make dual-write and backfill
fast and more robust. Flag for codex.

## Read paths converted (all flag-gated, fallback to in-memory)
- **Lists**: `findAccounts`, `findContacts` (indexed SQL: filter/sort/paginate).
- **`findJobs`**: hybrid — SQL sources the tenant's jobs, store applies the exact
  in-memory filters (ats/active/isNew/recency/sortBy).
- **`findConfigs`**: full SQL pushdown (12k configs).
- **`getAccountDetail`**: account + related records by index; store keeps the
  `buildPersonaActionPlan` shaping.
- **`getDashboard`**: hybrid — `getDashboardArrays` fetches the four tenant arrays
  from SQL, the existing builders run verbatim. Aggregates (incl. the fuzzy
  `needsResolutionCount`) proven byte-identical; slices differ by tie-order only.
- Verified on the real tenant: `eqtest-queries` (34/0), `eqtest-queries2` (12/0),
  `eqtest-dashboard` (10/0).

## Dashboard latency tradeoff (measured)
The hybrid dashboard re-fetches the whole tenant per request: **~2.4s over the
public proxy vs ~1.5s cold blob load**. It removes *resident* memory (the
multi-tenant ceiling) but adds repeated I/O, so it's best paired with a short-TTL
cache or a move to pure SQL-aggregate counts (the counts are all
`COUNT(*) FILTER` expressible; only the fuzzy resolution count is awkward). In
prod's internal network the fetch is faster than over the proxy.

## Remaining
1. `getDashboardExtended` still on the in-memory path (uses `accountById` +
   `followups` globals) — convert (build an id→account map from the fetched
   array) so a tenant is fully memory-free.
2. Decide the tie-order question (accept `updated_at` tiebreak vs add `ord`).
3. Dashboard perf: short-TTL cache or SQL-aggregate counts.
4. Per-tenant cutover via `rel_migration_state` (+ the backfill-before-flip rule).
