// Run with explicit DATABASE_URL. Uses a TEMP table and rolls back every write.
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const supplied = process.env.BD_SAVED_WORK_TEST_BUNDLE ? JSON.parse(Buffer.from(process.env.BD_SAVED_WORK_TEST_BUNDLE, 'base64').toString()) : null;
const source = supplied?.source || await readFile(new URL('../src/saved-work.js', import.meta.url), 'utf8');
const dbSource = supplied?.dbSource || await readFile(new URL('../src/db.js', import.meta.url), 'utf8');
const tableDefinition = dbSource.match(/CREATE TABLE IF NOT EXISTS saved_work \([\s\S]*?\n {8}\);/)?.[0];
assert.ok(tableDefinition, 'Saved-work migration must exist.');
const { createSavedWorkStore } = await import(`data:text/javascript;base64,${Buffer.from(source.replace("import { dbQuery, isDbEnabled } from './db.js';", 'const dbQuery = null; const isDbEnabled = () => false;')).toString('base64')}`);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '5s'");
  await client.query("SET LOCAL lock_timeout = '2s'");
  await client.query('CREATE TEMP TABLE tenants (id TEXT PRIMARY KEY) ON COMMIT DROP');
  await client.query('CREATE TEMP TABLE users (id TEXT PRIMARY KEY) ON COMMIT DROP');
  await client.query("INSERT INTO tenants VALUES ('temporary-tenant')");
  await client.query("INSERT INTO users VALUES ('temporary-user')");
  await client.query(tableDefinition.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE').replace(/\);$/, ') ON COMMIT DROP;'));
  const tenantId = 'temporary-tenant';
  const userId = 'temporary-user';
  const store = createSavedWorkStore({ enabled: () => true, query: (sql, params) => client.query(sql, params) });
  const first = await store.put(tenantId, userId, 'draft', 'temporary-verification', { title: 'Temporary verification', body: { text: 'Temporary fixture only.' }, version: 0 });
  assert.equal((await store.list(tenantId, userId, 'draft')).total, 1);
  assert.equal((await store.list(tenantId, userId, 'draft', { summary: '1' })).total, 1);
  assert.equal(await store.get('unrelated-workspace', userId, 'draft', first.id), null);
  assert.equal(await store.get(tenantId, 'unrelated-user', 'draft', first.id), null);
  const attempts = await Promise.allSettled([store.put(tenantId, userId, 'draft', first.id, first), store.put(tenantId, userId, 'draft', first.id, first)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
  const latest = await store.get(tenantId, userId, 'draft', first.id);
  await assert.rejects(store.remove(tenantId, userId, 'draft', first.id, 1), { status: 409 });
  await store.remove(tenantId, userId, 'draft', first.id, latest.version);
  assert.equal((await store.export(tenantId, userId)).length, 0);
  console.log('PASS: PostgreSQL migration, scoped reads, durable writes, conflicts and deletion in a temporary table.');
} finally {
  await client.query('ROLLBACK');
  await client.end();
  console.log('Rolled back; no customer records or persistent schema changed.');
}
