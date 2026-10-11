# Project Rules

- Always add timing around performance-sensitive paths before and after meaningful changes.
- Report bottlenecks by exact file path and function name first, before broader summaries or proposed fixes.
- Prefer incremental updates, partial upserts, and dirty-flag refreshes over full rebuilds.
- Avoid full-state reloads after single-entity changes whenever a scoped read or targeted query is possible.
- Trace the full call chain for slow paths instead of assuming the slow step from a label like `snapshot` or `sync`.
- When optimizing, measure live timings on the real path you changed and report before/after numbers.
- Preserve existing API contracts and UI behavior unless a change is required to fix correctness or performance.

## Marketing and distribution

- Use BD Engine's LinkedIn company Page for LinkedIn promotion. The owner explicitly excluded their personal LinkedIn profile on October 11, 2026. Do not publish, reshare, comment, message, or invite personal contacts as that profile for this campaign.
- Write LinkedIn campaign copy in the company's voice. The current campaign is in `docs/ADVERTISING-LAUNCH-KIT.md`; older founder-profile recommendations are superseded by this preference.
