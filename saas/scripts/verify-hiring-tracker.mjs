// Hiring tracker snapshots on PostgreSQL: one claim per week across servers,
// running weeks unpublished, stalled runs retried, failures given back.
import assert from 'node:assert/strict';
import { initDb, closeDb, dbQuery, isDbEnabled } from '../src/db.js';
import { createHiringTrackerStore } from '../src/hiring-tracker.js';

const target = new URL(process.env.DATABASE_URL || 'postgres://missing');
if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(target.hostname) || !['/bd_workflow_fixture', '/bd_engine_recovery_source'].includes(target.pathname)) throw new Error('Hiring tracker verification requires an isolated local fixture database in NODE_ENV=test.');
if (!await initDb()) throw new Error('Fixture database unavailable');
const weeks = ['2999-01-04', '2999-01-11'];
try {
  let clock = new Date('2999-01-11T11:00:00Z');
  const store = createHiringTrackerStore({ query: (...args) => dbQuery(...args), enabled: isDbEnabled, now: () => clock });
  const other = createHiringTrackerStore({ query: (...args) => dbQuery(...args), enabled: isDbEnabled, now: () => clock });
  const claims = await Promise.all([store.claim(weeks[1]), other.claim(weeks[1])]);
  assert.deepEqual(claims.sort(), [false, true], 'two servers: one claim');
  assert.ok(!(await store.latest(5)).some((row) => weeks.includes(row.week)), 'a running week is not published');
  await store.release(weeks[1]);
  assert.equal(await other.claim(weeks[1]), true, 'a released week can be claimed again');
  clock = new Date('2999-01-11T11:40:00Z');
  assert.equal(await store.claim(weeks[1]), true, 'a run stalled for 30 minutes is retried');
  await store.save({ week: weeks[0], takenAt: '2999-01-04T11:05:00Z', employers: [{ name: 'Northwind', status: 'complete', openRoles: 1, keys: ['a'] }] });
  await store.save({ week: weeks[1], takenAt: clock.toISOString(), employers: [{ name: 'Northwind', status: 'complete', openRoles: 2, keys: ['a', 'b'] }] });
  assert.equal(await other.claim(weeks[1]), false, 'a published week is final');
  const latest = await store.latest(2);
  assert.deepEqual(latest.map((row) => row.week), [weeks[1], weeks[0]]);
  assert.equal(latest[0].status, 'complete');
  assert.deepEqual(latest[0].employers[0].keys, ['a', 'b']);
  console.log('Hiring tracker verified on PostgreSQL: single claim, unpublished runs, stalled retry, release, latest two weeks.');
} finally {
  await dbQuery('DELETE FROM hiring_tracker_snapshots WHERE week = ANY($1::text[])', [weeks]);
  await closeDb();
}
