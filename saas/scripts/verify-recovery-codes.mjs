// Disposable loopback test database only. Never run against a customer database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initDb, closeDb, dbQuery, dbSaveUser } from '../src/db.js';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { generateUserRecoveryCodes, recoverUserWithCode } from '../src/recovery-codes.js';

const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  || !url.pathname.endsWith('/bd_engine_recovery_source')) throw new Error('Requires the disposable loopback recovery database.');
const user = { id: `recovery-code-ci-${randomUUID()}`, email: `recovery-${randomUUID()}@example.test`, name: 'Recovery fixture', status: 'active',
  passwordHash: hashPassword('original-password'), emailVerifiedAt: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const started = performance.now();
try {
  assert.equal(await initDb(), true);
  await dbSaveUser(user);
  const old = await generateUserRecoveryCodes(user, 'original-password');
  const codes = await generateUserRecoveryCodes(user, 'original-password');
  assert.equal(await recoverUserWithCode(user, old[0], 'replacement-password'), false);
  const stored = await dbQuery('SELECT code_hash FROM account_recovery_codes WHERE user_id = $1', [user.id]);
  assert.equal(stored.rowCount, 8);
  assert.equal(JSON.stringify(stored.rows).includes(codes[0]), false);
  // Force the password write to fail after code deletion; transaction must roll back.
  await dbQuery("ALTER TABLE users ADD CONSTRAINT recovery_fixture_rollback CHECK (name <> 'Recovery fixture' OR updated_at = '2026-01-01T00:00:00.000Z')");
  await assert.rejects(recoverUserWithCode(user, codes[0], 'replacement-password'));
  assert.equal((await dbQuery('SELECT count(*)::int n FROM account_recovery_codes WHERE user_id = $1', [user.id])).rows[0].n, 8);
  assert.equal(verifyPassword('original-password', user.passwordHash), true);
  await dbQuery('ALTER TABLE users DROP CONSTRAINT recovery_fixture_rollback');
  await dbQuery('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)', [`session-${user.id}`, user.id, '2099-01-01T00:00:00.000Z', user.createdAt]);
  await dbQuery('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)', [`reset-${user.id}`, user.id, '2099-01-01T00:00:00.000Z', user.createdAt]);
  const outcomes = await Promise.all([recoverUserWithCode(user, codes[0], 'replacement-password'), recoverUserWithCode(user, codes[0], 'replacement-password')]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal((await dbQuery('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [user.id])).rows[0].n, 0);
  assert.equal((await dbQuery('SELECT count(*)::int n FROM password_reset_tokens WHERE user_id = $1', [user.id])).rows[0].n, 0);
  assert.equal((await dbQuery('SELECT count(*)::int n FROM account_recovery_codes WHERE user_id = $1', [user.id])).rows[0].n, 7);
  const persisted = (await dbQuery('SELECT password_hash FROM users WHERE id = $1', [user.id])).rows[0].password_hash;
  assert.equal(verifyPassword('replacement-password', persisted), true);
  await closeDb();
  assert.equal(await initDb(), true);
  assert.equal(await recoverUserWithCode(user, codes[0], 'third-password'), false);
  assert.equal(await recoverUserWithCode(user, codes[1], 'third-password'), true);
  console.log(`PASS recovery codes: durable issuance, rotation, rollback, concurrent single-use and reconnect (${Math.round(performance.now() - started)}ms)`);
} finally {
  await dbQuery('ALTER TABLE users DROP CONSTRAINT IF EXISTS recovery_fixture_rollback');
  await dbQuery('DELETE FROM users WHERE id = $1', [user.id]);
  await closeDb();
}
