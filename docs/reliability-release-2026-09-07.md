# 0.1.2.1 maintenance release — deployed

- Production: https://bd-engine-production.up.railway.app
- Source: `645e1b7decfc6819a04ebafd1317180b825740cf`, pushed to `agent/paid-product-quality-audit`.
- Railway deployment: `345f3ad0-0ee4-4cbb-ba63-ea5c283d73ab`, created 2026-09-07 22:22:37 UTC; SUCCESS.
- Production Docker build completed on Railway; local Docker remains unavailable.
- Browser asset version updated to `20260907-reliability-01` in the index and service worker.

## Verification

- 376 unit tests; 12/12 ATS provider contracts; renderer syntax and 4 renderer tests passed.
- SaaS syntax and lint passed. Production dependency audit: zero vulnerabilities.
- Prior full browser run: all 79 Chromium cases passed. Release validation outside the restricted sandbox: 42 People/compatibility cases passed across Chromium, Firefox and WebKit, with normal runner exit. Earlier Firefox/teardown limitations did not recur in that run.
- Read-only deep relational parity passed for all three legacy workspaces before and after deployment.
- All four changed runtime frontend files matched deployed LF-normalized SHA-256 values: index, service worker, API wrapper and People controller.
- Eight live non-mutating HTTP checks passed. Mutation smoke checks remained disabled. Immediate deployment error-level log query returned no records.
- Live synthetic demo passed People sorting, person review and outer-page reload context. Desktop 1440 and phone 390 layouts passed tested axe A/AA checks, no horizontal overflow and no uncaught page errors. Screenshots stored as ignored local artifacts under `artifacts/reliability-release/`.
- No customer records edited, new migrations, production variable changes, renderer deployment or Windows publication.

## Rollback

Restore prior healthy Railway deployment `7ddd4a83-29b8-4953-af3a-7c3b4f9a9c5f`, release 0.1.2.0 / source `a06dfd5189c2ca16f57a6d9db82845660a7b90fe`. This frontend-only maintenance release does not require data rollback. No new backup was required because there are no migrations or bulk data changes; the previous verified backup is documented in the 0.1.2.0 release record.

## Separate paid-launch gates

The production configuration checker still reports missing `RESEND_API_KEY`, missing verified `BD_EMAIL_FROM`, and disabled `BD_REQUIRE_EMAIL_VERIFICATION`. This release does not bypass paid-launch controls or imply transactional email/password reset is operational. Same-field concurrent edits still need a backend conflict-handling pass. These remain separate from the deployed maintenance fixes.
