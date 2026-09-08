import assert from 'node:assert/strict';
import { mock } from 'node:test';
import * as db from '../../src/db.js';
import * as mirror from '../../src/relational-writes.js';

const mode = process.argv[2];
const tenantId = 'focus-persistence';
let enabled = false;
let failDatabase = false;
let failMirror = false;
let block;
let entered;
let calls = 0;
let concurrent = 0;
let maxConcurrent = 0;
let stored;
let mirrorBlock;
let mirrorEntered;
const gate = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
};

await mock.module('../../src/db.js', { namedExports: {
  ...db,
  isDbEnabled: () => enabled,
  dbLoadTenantSettings: async () => ({}),
  dbLoadTenantData: async () => ({ accounts: [], jobs: [{ id: 'job-fixture', tenantId,
    title: 'Talent Acquisition Specialist', active: true }], configs: [], activities: [], tasks: [], settings: {} }),
  dbSaveTenantData: async (_id, data) => {
    calls += 1;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    entered?.release();
    try {
      await block?.promise;
      if (failDatabase) return { saved: false, reason: 'database_not_ready' };
      stored = structuredClone(data);
      return { saved: true };
    } finally { concurrent -= 1; }
  },
} });
await mock.module('../../src/relational-writes.js', { namedExports: {
  ...mirror,
  syncTenantRelationalMirror: async () => {
    mirrorEntered?.release();
    await mirrorBlock?.promise;
    if (failMirror) throw new Error('synthetic mirror failure');
    return { ok: true };
  },
} });
const { createStore } = await import('../../src/store.js');
const store = createStore();
store.ensureTenant({ id: tenantId, name: 'Synthetic fixture', persona: 'jobseeker' }, { id: 'owner-fixture' });
enabled = true;

block = gate();
entered = gate();
let completed = false;
const startedAt = performance.now();
const saving = store.patchSettings(tenantId, { searchFocus: { targetRoles: 'talent acquisition specialist' } })
  .then((result) => { completed = true; return result; });
await entered.promise;
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(completed, false, 'must not report success while the database save is blocked');
block.release();
assert.equal((await saving).rescoredJobs, 1);
assert.equal(stored.settings.searchFocusByPersona.jobseeker.targetRoles, 'talent acquisition specialist');
console.log(`${mode} blocked-save fixture: ${(performance.now() - startedAt).toFixed(1)}ms; completion waited for storage`);

mirrorBlock = gate();
mirrorEntered = gate();
let mirrorCompleted = false;
const mirrorSaving = store.patchSettings(tenantId, { searchFocus: { targetRoles: 'recruiter' } })
  .then(() => { mirrorCompleted = true; });
await mirrorEntered.promise;
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(mirrorCompleted, false, 'success must also wait for relational scores');
mirrorBlock.release();
await mirrorSaving;

failDatabase = true;
await assert.rejects(store.patchSettings(tenantId, { searchFocus: { targetRoles: 'recruiter' } }),
  (error) => error.status === 503 && error.code === 'focus_save_incomplete');
failDatabase = false;
assert.equal((await store.patchSettings(tenantId, { searchFocus: { targetRoles: 'recruiter' } })).ok, true);

failMirror = true;
await assert.rejects(store.patchSettings(tenantId, { searchFocus: { targetRoles: 'recruiter' } }),
  (error) => error.status === 503);
failMirror = false;
await store.patchSettings(tenantId, { searchFocus: { targetRoles: 'recruiter' } });

// A debounce that has already fired still needs draining on shutdown.
block = gate();
entered = gate();
store.setPersona(tenantId, 'jobseeker');
await entered.promise;
let flushed = false;
const before = calls;
const flushing = store.flushPendingSaves().then(() => { flushed = true; });
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(flushed, false);
assert.equal(calls, before, 'flush must queue behind the active save');
block.release();
await flushing;
assert.equal(maxConcurrent, 1, 'workspace writes must be serialized');
assert.equal((await store.switchPersona(tenantId, 'bd')).ok, true);
await store.flushPendingSaves();
console.log(`${mode}: database failure, mirror failure, retry, persona save and active-write shutdown checks passed`);
