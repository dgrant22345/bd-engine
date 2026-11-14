import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

// Today and People count the roles in the workspace's saved search focus and
// rank people at those companies first. A workspace that has not chosen a
// focus (the built-in starting one) sees all open roles, as before.
const plan = { displayName: 'Unlimited', limits: { jobBoards: -1 } };
const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
const greenhouse = (board, roles) => ({ jobs: roles.map(([id, title, daysAgo]) => ({ id, title, location: { name: 'Toronto, ON' }, absolute_url: `https://job-boards.greenhouse.io/${board}/jobs/${id}`, first_published: iso(daysAgo) })) });

async function workspace(id) {
  const store = createStore();
  store.ensureTenant({ id, name: id }, { id: `${id}-owner` });
  await store.patchSettings(id, { geographyFocus: 'Global' });
  const boards = {
    northwind: [[1, 'Senior Software Engineer', 2], [2, 'Account Executive', 40], [3, 'Software Engineer II', 30]],
    quill: [[4, 'Account Executive', 1], [5, 'Sales Development Representative', 3]],
  };
  const accounts = {};
  for (const [board, name] of [['northwind', 'Northwind'], ['quill', 'Quill'], ['calm', 'Calm']]) {
    accounts[board] = await store.addAccount(id, { displayName: name });
    if (boards[board]) store.addConfig(id, { companyName: name, accountId: accounts[board].id, atsType: 'greenhouse', boardId: board, discoveryStatus: 'resolved', reviewStatus: 'approved', active: true });
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const board = String(url).match(/boards\/([^/]+)\/jobs/)?.[1];
    return new Response(JSON.stringify(greenhouse(board, boards[board] || [])), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { await store.importLiveJobs(id, { plan, autoDiscover: false }); } finally { globalThis.fetch = originalFetch; }
  const people = {};
  for (const [board, fullName, title] of [['northwind', 'Nia North', 'Talent Coordinator'], ['quill', 'Quinn Quill', 'VP Talent Acquisition'], ['calm', 'Cal Calm', 'Head of Talent']]) {
    people[board] = await store.addContact(id, { fullName, title, companyName: accounts[board].displayName, accountId: accounts[board].id });
  }
  return { store, accounts, people };
}

test('without a chosen focus, People and Today count every open role', async () => {
  const id = 'tenant-focus-none';
  const { store, people } = await workspace(id);
  const context = await store.getPeopleContext(id, Object.values(people));
  assert.deepEqual(context[people.northwind.id], { linked: true, openRoles: 3, newRoles7d: 1, lastOutreachAt: '' });
  assert.equal((await store.getDashboard(id)).summary.focusSet, false);
});

test('with a chosen focus, the roles in it are counted and lead the ranking', async () => {
  const id = 'tenant-focus-engineering';
  const { store, accounts, people } = await workspace(id);
  await store.patchSettings(id, { searchFocus: { targetRoles: 'Software Engineer', excludedRoles: '', targetIndustries: '', workStyle: 'any', minimumRelevanceScore: 45 } });

  const context = await store.getPeopleContext(id, Object.values(people));
  // The first import found these roles already open, so none is new unless it
  // was posted this week (Northwind's role posted two days ago).
  assert.equal(context[people.northwind.id].openRoles, 3);
  assert.equal(context[people.northwind.id].focusRoles, 2);
  assert.equal(context[people.northwind.id].newFocusRoles7d, 1);
  assert.equal(context[people.quill.id].openRoles, 2);
  assert.equal(context[people.quill.id].focusRoles, 0);
  assert.equal(context[people.calm.id].focusRoles, 0);

  // Northwind's person ranks first, then the company with other open roles,
  // then the quiet one (names alone would put Cal Calm first).
  const ranked = (await store.findContacts(id, { sortBy: 'call', pageSize: 10 })).items.map((person) => person.accountId);
  assert.deepEqual(ranked, [accounts.northwind.id, accounts.quill.id, accounts.calm.id]);

  const { summary } = await store.getDashboard(id);
  assert.equal(summary.focusSet, true);
  assert.equal(summary.focusJobCount, 2);
  assert.equal(summary.focusAccountCount, 1);
  assert.equal(summary.activeJobCount, 5);
});
