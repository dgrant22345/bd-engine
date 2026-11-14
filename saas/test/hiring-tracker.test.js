import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, createHiringTrackerStore, renderHiringTrackerPage, roleKey, TRACKER_EMPLOYERS, trackerWeek } from '../src/hiring-tracker.js';
import { buildHiringTrackerSnapshot } from '../scripts/hiring-tracker-snapshot.mjs';

test('the tracker week starts Monday at 6 a.m. in Toronto', () => {
  assert.equal(trackerWeek(new Date('2026-11-16T10:59:00Z')), '2026-11-09', 'Monday 5:59 a.m. EST is still last week');
  assert.equal(trackerWeek(new Date('2026-11-16T11:00:00Z')), '2026-11-16');
  assert.equal(trackerWeek(new Date('2026-11-14T15:00:00Z')), '2026-11-09', 'Saturday');
  assert.equal(trackerWeek(new Date('2026-11-23T04:30:00Z')), '2026-11-16', 'Sunday night in Toronto, Monday in UTC');
  assert.equal(trackerWeek(new Date('2026-07-06T10:00:00Z')), '2026-07-06', 'Monday 6 a.m. EDT');
});

const employer = (name, sector, openKeys, status = 'complete') => ({ name, sector, site: `https://jobs.${name.toLowerCase()}.example`, status, openRoles: status === 'complete' ? openKeys.length : null, keys: status === 'complete' ? openKeys : [] });

test('this week against last week: new roles, change, and employers that could not be read', () => {
  const previous = { week: '2026-11-09', takenAt: '2026-11-09T11:05:00Z', employers: [employer('Northwind', 'Banking', ['a', 'b', 'c']), employer('Quill', 'Technology', ['q1']), employer('Calm', 'Technology', ['z'])] };
  const current = { week: '2026-11-16', takenAt: '2026-11-16T11:04:00Z', employers: [employer('Northwind', 'Banking', ['b', 'c', 'd', 'e']), employer('Quill', 'Technology', ['q1']), employer('Calm', 'Technology', [], 'unavailable'), employer('Lumen', 'Banking', ['l1', 'l2'])] };
  const view = compareSnapshots(current, previous);
  const row = (name) => view.employers.find((item) => item.name === name);
  assert.deepEqual([row('Northwind').openRoles, row('Northwind').change, row('Northwind').newRoles], [4, 1, 2]);
  assert.deepEqual([row('Quill').change, row('Quill').newRoles], [0, 0]);
  assert.deepEqual([row('Calm').readable, row('Calm').openRoles, row('Calm').change], [false, null, null]);
  assert.deepEqual([row('Lumen').openRoles, row('Lumen').change, row('Lumen').newRoles], [2, null, null], 'a newly added employer has no comparison yet');
  assert.deepEqual(view.employers.map((item) => item.name), ['Northwind', 'Lumen', 'Quill', 'Calm']);
  assert.deepEqual(view.totals, { employers: 4, readable: 3, openRoles: 7, compared: 2, newRoles: 2, growing: 1 });
  assert.deepEqual(view.sectors, [{ sector: 'Banking', employers: 2, openRoles: 6 }, { sector: 'Technology', employers: 1, openRoles: 1 }]);

  const first = compareSnapshots(current, null);
  assert.deepEqual([first.totals.newRoles, first.totals.growing, first.previousWeek], [null, null, '']);
  assert.equal(roleKey('td/TD_Bank_Careers', '/job/R1').length, 12);
  assert.notEqual(roleKey('a', 'b'), roleKey('a', 'c'));
});

test('the page shows the figures, explains them, and escapes employer names', () => {
  const view = compareSnapshots(
    { week: '2026-11-16', takenAt: '2026-11-16T11:04:00Z', employers: [employer('Northwind <Bank>', 'Banking', ['b', 'c', 'd', 'e']), employer('Quill', 'Technology', ['q1', 'q2'])] },
    { week: '2026-11-09', takenAt: '2026-11-09T11:05:00Z', employers: [employer('Northwind <Bank>', 'Banking', ['a', 'b', 'c']), employer('Quill', 'Technology', ['q1', 'q2', 'q3'])] },
  );
  const html = renderHiringTrackerPage(view, { origin: 'https://bd.example' });
  assert.match(html, /<link rel="canonical" href="https:\/\/bd\.example\/canada-hiring">/);
  assert.match(html, /<h1 id="tracker-title">Who is hiring in Canada this week<\/h1>/);
  assert.match(html, /Week of Monday, November 16, 2026\. Read Monday, November 16 at 6:04 a\.m\. EST\./);
  assert.match(html, /<th scope="row">Northwind &lt;Bank&gt;<\/th>/);
  assert.doesNotMatch(html, /Northwind <Bank>/);
  assert.match(html, /<td class="num up">\+1<\/td>/);
  assert.match(html, /<td class="num down">−1<\/td>/);
  assert.match(html, /<dt>New since last week<\/dt><dd>2<\/dd>/);
  assert.match(html, /How this is counted/);
  assert.match(html, /No job boards, aggregators or customer data are used/);
  assert.match(html, /utm_source=hiring_tracker/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);

  const pending = renderHiringTrackerPage(null, { origin: 'https://bd.example' });
  assert.match(pending, /The first weekly snapshot is being prepared/);
  assert.doesNotMatch(pending, /<table/);
});

test('a week is claimed once, published when complete, and given back when a run fails', async () => {
  let clock = new Date('2026-11-16T11:00:00Z');
  const store = createHiringTrackerStore({ now: () => clock });
  assert.equal(await store.claim('2026-11-16'), true);
  assert.equal(await store.claim('2026-11-16'), false, 'a running week is not claimed twice');
  assert.deepEqual(await store.latest(), [], 'a running week is not published');
  await store.release('2026-11-16');
  assert.equal(await store.claim('2026-11-16'), true);
  clock = new Date('2026-11-16T11:45:00Z');
  assert.equal(await store.claim('2026-11-16'), true, 'a run that stalled for 30 minutes can be retried');
  await store.save({ week: '2026-11-16', takenAt: clock.toISOString(), employers: [] });
  assert.equal(await store.claim('2026-11-16'), false, 'a published week is final');
  await store.save({ week: '2026-11-09', takenAt: '2026-11-09T11:00:00Z', employers: [] });
  assert.deepEqual((await store.latest()).map((item) => item.week), ['2026-11-16', '2026-11-09']);
});

test('a snapshot reads each employer in an isolated workspace and publishes only full reads', async () => {
  const employers = [
    { name: 'Northwind', sector: 'Technology', atsType: 'greenhouse', boardId: 'northwind', resolvedBoardUrl: 'https://job-boards.greenhouse.io/northwind', site: 'https://job-boards.greenhouse.io/northwind' },
    { name: 'Quill', sector: 'Technology', atsType: 'greenhouse', boardId: 'quill', resolvedBoardUrl: 'https://job-boards.greenhouse.io/quill', site: 'https://job-boards.greenhouse.io/quill' },
  ];
  const originalFetch = globalThis.fetch;
  const savedUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('/boards/northwind/')) {
      return new Response(JSON.stringify({ jobs: [
        { id: 1, title: 'Analyst', location: { name: 'Toronto, ON' }, absolute_url: 'https://job-boards.greenhouse.io/northwind/jobs/1', first_published: '2026-11-10T00:00:00Z' },
        { id: 2, title: 'Engineer', location: { name: 'London, United Kingdom' }, absolute_url: 'https://job-boards.greenhouse.io/northwind/jobs/2', first_published: '2026-11-10T00:00:00Z' },
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('unavailable', { status: 503 });
  };
  try {
    const snapshot = await buildHiringTrackerSnapshot({ now: new Date('2026-11-16T11:05:00Z'), employers });
    assert.equal(snapshot.week, '2026-11-16');
    const [northwind, quill] = snapshot.employers;
    assert.deepEqual([northwind.status, northwind.openRoles, northwind.keys.length], ['complete', 1, 1], 'only the role in Canada counts');
    assert.deepEqual([quill.status, quill.openRoles, quill.keys], ['unavailable', null, []]);
  } finally {
    globalThis.fetch = originalFetch;
    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl;
  }
  assert.ok(TRACKER_EMPLOYERS.every((item) => item.name && item.sector && /^https:\/\//.test(item.site) && item.atsType && item.boardId));
});
