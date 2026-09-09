# 0.1.2.8 recovery codes and checkout separation

User explicitly approved allowing purchases before transactional email is
configured and requested one-time recovery codes as the fallback.

## Behavior

- Signed-in non-demo users can generate eight 128-bit random recovery codes after
  entering their current password, including when their trial has expired.
- Codes are displayed once, never stored in browser storage or application logs,
  and only user-bound SHA-256 digests are persisted. Save them outside the app.
- Generating a replacement set invalidates the old set. Each saved code changes
  the password once; it does not mark an email address verified.
- PostgreSQL locks the user row and commits code consumption, password update,
  session deletion and pending email-reset-token deletion together. A failed
  transaction must preserve the old password and unused code.
- Existing process-local auth/reset caches are cleared after successful recovery.
  The current deployment has one replica. The app's existing cached-auth model
  still needs a separate cross-replica revocation design before scaling replicas.
- Code responses are no-store. Generation requires a password and is rate limited;
  unauthenticated recovery is rate limited and uses one generic invalid-code error.
- The new table is additive. Standard backups exclude recovery codes, like other
  recovery tokens, so restoring a backup must not resurrect a consumed secret.
  After disaster recovery users must generate a fresh set while signed in.
- A signed-in reminder links to code generation; Forgot password offers recovery
  by a previously saved code. No codes are generated for existing users silently.

## Payment gate

Only RESEND_API_KEY, BD_EMAIL_FROM and BD_REQUIRE_EMAIL_VERIFICATION are excluded
from checkout readiness. Stripe live keys/prices/webhooks, durable storage,
session secret, backup key and operational checks remain required. The complete
commercial-readiness audit still reports missing email as NOT READY; that is
distinct from the narrower checkout decision. No email-verification flag is
enabled without delivery. This does not prove a real charge/webhook/entitlement
journey; that remains a separate controlled purchase test.

## Validation in progress

391 unit tests passed; lint, syntax and schema-contract checks passed. Fresh-server
Chromium recovery, signup, mobile setup and paused-billing checks passed. One test
rerun correctly hit the existing rate limiter on a reused server; fresh isolated
server passed. The earlier UI request-serialization defect was fixed before release.

CI includes a disposable PostgreSQL test for hashed durable storage, rotation,
forced transaction rollback, concurrent single-use, session/token revocation and
reconnect behavior. Deployment is gated on those results.

Rollback: 0.1.2.7 deployment db0a6af3-be2f-4d3d-ac2e-1abc9e14e198. Retain the
additive table when rolling back; do not delete user data. An old runtime cannot
offer code redemption and retains the old email-dependent checkout gate.
