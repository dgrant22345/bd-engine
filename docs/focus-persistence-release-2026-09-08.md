# 0.1.2.4 focus persistence maintenance

## Scope

`saas/src/store.js`, `patchSettings` previously returned success after scheduling a debounced save. The updated `patchSettings` and `switchPersona` await `persistScoredFocus`, including relational score persistence, before returning their unchanged success payloads. Storage failures produce a retryable 503 rather than success. Because writes may partially commit, current in-memory focus is retained and scheduled for retry rather than falsely rolled back.

`saveTenantNow` now orders snapshot writes per tenant. `flushPendingSaves` includes writes whose debounce has already fired, and resident eviction excludes tenants with active saves. Existing incremental relational upserts are retained. No dependencies, UI styling, migrations, bulk rescoring, historical deletion or customer preferences were changed as part of deployment.

## Validation

- 381/381 unit tests passed, including isolated synthetic database/mirror fixtures for legacy and relational-primary storage.
- Fixtures explicitly block database and mirror completion, simulate database refusal and mirror failure, exercise successful retry and persona switching, and verify shutdown waits for active saves with no overlapping workspace writes.
- Lint, syntax checks and diff whitespace checks passed.
- Four Chromium workflow tests passed in 12.6 seconds: focus save/shortlist, failed-save retry and duplicate-submit prevention, missing-focus guidance, and pipeline save/reload/recovery.
- The first browser run passed its four cases but stalled during Windows cleanup. The identified local test processes were targeted for cleanup and the rerun completed with exit code zero.
- Pre-deployment deep relational parity passed for three production workspaces.
- Synthetic blocked-save timings were approximately 30–40 ms with an intentional 25 ms storage gate. This is correctness coverage, not a production performance improvement claim. The old path scheduled persistence after 500 ms without waiting; the new path intentionally waits and logs storage durations above 250 ms.

## Deployment

- Source: `c39ce07`, branch `agent/paid-product-quality-audit`.
- Railway deployment: `0dd934c9-e37f-4051-8473-34825027cd70`, created 2026-09-08 23:24:58 UTC.
- Verification status: SUCCESS. Railway production build and `/readyz` passed. Eight non-mutating live smoke checks passed; account and other mutation checks stayed disabled. Post-deployment deep relational parity passed for all three workspaces. Immediate error-level log review returned no entries. Deployed `src/store.js` matched the tested local source by LF-normalized SHA-256.
- Rollback: `1874abcb-197f-40d7-a819-1b09b141095e` (0.1.2.3). No migration accompanies this release.

## Remaining limits

- This is durable completion feedback, not a new atomic cross-table transaction or a cross-process lock. Concurrent imports and snapshot mutation/cursor behavior deserve a separate concurrency review.
- Large workspaces may remain in the existing Saving state longer. Live save latency has not been measured by changing production focus in this release.
- Historical false-positive cleanup and Canadian source coverage remain separate tasks.
- Paid-launch email configuration remains unresolved; this maintenance release does not certify commercial readiness.
- Unrelated marketing and naming drafts were preserved.
