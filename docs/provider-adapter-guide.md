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

## Adding A Provider

1. Add provider identification and URL parsing near the existing adapters in `saas/src/store.js` and the local equivalent in `server/Modules/BdEngine.JobImport.psm1` when local support is intended.
2. Normalize into the existing job shape. Do not leak raw provider payloads into the UI.
3. Add saved synthetic fixtures or mocked fetch responses. Do not use customer data.
4. Test success, pagination, malformed responses, transient retry, permanent failure, duplicate boards, and lifecycle closure.
5. Update product coverage copy only after the adapter and tests exist.

## Discovery Rules

Prefer evidence from a careers URL or exact public board match. Name-only matches require review. Do not probe unrelated slugs for generic company names or personal email domains. A normal company homepage is not a valid job feed merely because it returns HTTP 200.
