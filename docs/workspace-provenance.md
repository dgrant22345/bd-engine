# Workspace provenance — the duplicate large dataset (CG-010)

Audit finding P0.6: two workspaces each hold ~12,317 accounts / 20,509
contacts. Traced 2026-07-12 with read-only queries.

## tenant-60abe43f — the real workspace (KEEP)
- Slug `derek-5f34`, owner dgrant22@gmail.com (user-9c265f34), plan `owner`.
- Created 2026-04-26 22:28 UTC; actively used and updated since.
- Relational-primary storage; 12,317 accounts / 20,509 contacts / 373 jobs.

## tenant-9f1ef16e — abandoned launch-day test signup (DECISION NEEDED)
- Slug `searchy-loo-user-03b4d28b`, name "searchy loo", owner
  joeybob@hotmail.com (user-03b4d28b), plan `trial`, persona `jobseeker`,
  storage `legacy`.
- Created 2026-04-26 22:46 UTC — 18 minutes after the real workspace, during
  the same first-launch session.
- The SAME LinkedIn CSV was imported into it (identical 12,317 / 20,509
  counts); last write 22:52 the same evening; no activity since (2.5 months).
- Contains no job/board data.

## Assessment
This is a throwaway test account from launch day that holds a full duplicate
copy of the owner's real LinkedIn network (20,509 real people — personal
data). Retaining it serves no product purpose and is a privacy liability: the
data sits under an unmonitored trial identity.

## Recommendation
Delete the workspace (tenant_data row, tenant, membership, user) after owner
approval. Preconditions already met:
- Verified full backup including this workspace exists:
  `bd-engine-backup-2026-07-12T22-37-45-134Z.json.gz`,
  SHA-256 `bdf7c1f055dd44e79c74d431093b37b6dafef1ff54b2ef5013c3381b03dff082`
  (taken for CG-008; includes tenant_data and all relational tables).

**No deletion has been performed.** Owner approval is required first (per the
plan's rule: no destructive production operation without explicit approval,
recorded in the audit log when executed).

Related: eleven other empty trial workspaces older than 30 days are separate
cleanup candidates (TRUST-414 retention policy).
