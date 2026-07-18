# Provider Adapter Guide

## Contract

Every automatic job provider must return normalized jobs and a structured board result. A job should include an employer, title, source URL, provider, stable external identifier or natural key, location when available, first/last seen timestamps, and active state. Optional fields must degrade to empty values rather than invented facts.

## Required Behavior

- Apply a request timeout.
- Retry only transient failures with bounded backoff.
- Respect provider pagination and rate-limit signals.
- Validate status codes and response shape before normalization.
- Isolate failures to the affected board.
- Record a safe failure category and useful diagnostic detail.
- Deduplicate with provider ID first, then a stable normalized natural key.
- Mark missing jobs inactive only after a successful complete board refresh.
- Reactivate a returning job without creating a second record.

## Coverage Benchmark

Run the deterministic adapter benchmark before releasing importer changes:

```powershell
npm.cmd --prefix saas run benchmark:ats
```

It sends synthetic fixtures through every supported hosted adapter and fails if any provider does not produce exactly one job with the required normalized identity, URL, source, timestamps, and active state. It does not call live provider services or use customer data. Live endpoint checks remain a separate operational smoke test because provider availability and anti-bot behavior are not deterministic.

Run the current public-board compatibility canary separately:

```powershell
npm.cmd --prefix saas run benchmark:ats:live
```

The canary imports public listings from one representative board per provider. It runs automatically every Monday and Thursday in GitHub Actions. A failure may indicate an adapter regression, provider migration, renamed public board, rate limit, or temporary outage and must be triaged before changing product coverage claims.

## Rendered Pages

Discovery first checks redirects, regular HTML, embedded JSON, escaped JavaScript URLs, and static job markup. If those checks find nothing, one high-confidence careers URL per company can be sent to an optional rendering service configured with `BD_ATS_RENDER_SERVICE_URL` and `BD_ATS_RENDER_SERVICE_TOKEN`. The service must accept a JSON `POST` containing `url`, `waitUntil`, and `timeoutMs`, then return either HTML or JSON with an `html`/`content` field and optional `finalUrl`.

Only public careers URLs are eligible. Rendering is bounded to one attempt per company and is not used for normal imports from an already resolved provider. Keep the renderer isolated from the web service, enforce its own egress and concurrency limits, and never send contact, account-note, outreach, or applicant data to it.

## Adding A Provider

1. Add provider identification and URL parsing near the existing adapters in `saas/src/store.js` and the local equivalent in `server/Modules/BdEngine.JobImport.psm1` when local support is intended.
2. Normalize into the existing job shape. Do not leak raw provider payloads into the UI.
3. Add saved synthetic fixtures or mocked fetch responses. Do not use customer data.
4. Add the provider to `saas/scripts/ats-benchmark.mjs`, then test success, pagination, malformed responses, transient retry, permanent failure, duplicate boards, and lifecycle closure.
5. Update product coverage copy only after the adapter and tests exist.

## Discovery Rules

Prefer evidence from a careers URL or exact public board match. Name-only matches require review. Do not probe unrelated slugs for generic company names or personal email domains. A normal company homepage is not a valid job feed merely because it returns HTTP 200.
