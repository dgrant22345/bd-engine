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

## BLOCKER before enabling `BD_RELATIONAL_READS` — mirror drift
Testing surfaced that codex's dual-write is **not keeping the mirror current**:
- **Accounts: 3,623 / 12,317 (29%) stale** — updated in the blob today
  (2026-07-10, one bulk timestamp) but still at the 2026-07-05 state in the
  mirror (`raw_content_drift = 3623`; `target_score` unaffected, so order is
  fine, but other fields are stale). **Contacts: 0 drift.**
- `BD_RELATIONAL_MIRROR` is unset (mirror enabled), and `saveTenantNow` does sync
  the mirror — so the stale rows came from a path that bypassed that choke-point
  (a maintenance/scoring script writing `tenant_data` directly, most likely).
- Until dual-write reliably captures **every** write, SQL reads would serve a
  stale snapshot for ~29% of accounts. **Do not flip the flag on** until the
  dual-write gap is closed (and a fresh backfill re-syncs the drifted rows).

## Remaining
1. Fix the dual-write drift (find the bypass path; ensure all account mutations
   sync the mirror) + re-backfill, then the flag is safe per tenant.
2. More reads: `findJobs` (ats/active/isNew/recency/sortBy), `getAccountDetail`,
   dashboard aggregates.
3. Decide the tie-order question (accept `updated_at` tiebreak vs add `ord`).
