# Project Rules

- Always add timing around performance-sensitive paths before and after meaningful changes.
- Report bottlenecks by exact file path and function name first, before broader summaries or proposed fixes.
- Prefer incremental updates, partial upserts, and dirty-flag refreshes over full rebuilds.
- Avoid full-state reloads after single-entity changes whenever a scoped read or targeted query is possible.
- Trace the full call chain for slow paths instead of assuming the slow step from a label like `snapshot` or `sync`.
- When optimizing, measure live timings on the real path you changed and report before/after numbers.
- Preserve existing API contracts and UI behavior unless a change is required to fix correctness or performance.
