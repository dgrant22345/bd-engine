import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dbPath = new URL('../src/db.js', import.meta.url);
const serverPath = new URL('../src/server.js', import.meta.url);

test('scheduled cleanup covers expiring security and bounded operational records', async () => {
  const [db, server] = await Promise.all([
    readFile(dbPath, 'utf8'),
    readFile(serverPath, 'utf8'),
  ]);
  for (const table of [
    'sessions',
    'password_reset_tokens',
    'email_verification_tokens',
    'background_jobs',
    'rate_limit_buckets',
    'import_runs',
    'analytics_events',
    'audit_log',
    'stripe_webhook_events',
  ]) {
    assert.match(db, new RegExp(`DELETE FROM ${table}`), `${table} has no scheduled retention cleanup`);
  }
  assert.match(server, /setInterval\(runOperationalCleanup, 60 \* 60 \* 1000\)/);
  assert.match(server, /BD_IMPORT_HISTORY_RETENTION_DAYS/);
  assert.match(server, /BD_ANALYTICS_RETENTION_DAYS/);
  assert.match(server, /BD_AUDIT_RETENTION_DAYS/);
  assert.match(server, /BD_STRIPE_WEBHOOK_RETENTION_DAYS/);
});

test('retention cleanup preserves active Stripe webhook claims', async () => {
  const db = await readFile(dbPath, 'utf8');
  assert.match(db, /stripe_webhook_events WHERE status IN \('completed', 'failed'\)/);
  assert.doesNotMatch(db, /stripe_webhook_events WHERE updated_at < \$1/);
});
