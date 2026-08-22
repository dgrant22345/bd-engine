import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('LinkedIn connections match to company jobs and enable network and local/remote filtering', async () => {
  const store = createStore();
  const tenantId = 'tenant-network-match-test';
  store.ensureTenant({ id: tenantId, name: 'Network Test Workspace' }, { id: `${tenantId}-owner` });

  // 1. Import LinkedIn Connections CSV
  const csvContent = [
    'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
    'Sarah,Connor,https://www.linkedin.com/in/sarah-connor,sarah@cyberdyne.io,Cyberdyne Systems,VP of Engineering,12 Jan 2024',
    'John,Connor,https://www.linkedin.com/in/john-connor,john@cyberdyne.io,Cyberdyne Systems,Staff Software Engineer,15 Feb 2024',
    'Miles,Dyson,https://www.linkedin.com/in/miles-dyson,miles@cyberdyne.io,Cyberdyne Systems,Head of AI Research,20 Mar 2024',
    'Alex,Murphy,https://www.linkedin.com/in/alex-murphy,alex@omnicorp.com,Omni Consumer Products,Security Director,01 Apr 2024',
    'Arthur,Dent,https://www.linkedin.com/in/arthur-dent,arthur@hitchhiker.org,Megadodo Publications,Technical Writer,05 May 2024',
  ].join('\n');

  const importResult = await store.importLinkedInCSV(tenantId, csvContent, { plan: { limits: {} } });
  assert.equal(importResult.ok, true);
  assert.ok(importResult.stats.contactsCreated >= 4);

  // Verify accounts were created with connection counts
  const cyberdyneAccount = (await store.findAccounts(tenantId, { q: 'Cyberdyne', page: 1, pageSize: 10 })).items[0];
  assert.ok(cyberdyneAccount, 'Cyberdyne account should be created');
  assert.equal(cyberdyneAccount.connectionCount, 3);

  const omniAccount = (await store.findAccounts(tenantId, { q: 'Omni', page: 1, pageSize: 10 })).items[0];
  assert.ok(omniAccount, 'Omni account should be created');
  assert.equal(omniAccount.connectionCount, 1);

  // 2. Track target accounts and add board configs to import jobs
  await store.patchAccount(tenantId, cyberdyneAccount.id, { tracked: true });
  await store.patchAccount(tenantId, omniAccount.id, { tracked: true });

  store.addConfig(tenantId, {
    accountId: cyberdyneAccount.id,
    companyName: cyberdyneAccount.displayName,
    atsType: 'greenhouse',
    boardId: 'cyberdyne',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  store.addConfig(tenantId, {
    accountId: omniAccount.id,
    companyName: omniAccount.displayName,
    atsType: 'greenhouse',
    boardId: 'omni',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const acmeAccount = await store.addAccount(tenantId, { displayName: 'Acme Unknown Global' });
  store.addConfig(tenantId, {
    accountId: acmeAccount.id,
    companyName: acmeAccount.displayName,
    atsType: 'greenhouse',
    boardId: 'acme',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('cyberdyne')) {
      return Response.json({ jobs: [
        { id: 'cyber-1', title: 'Senior AI Platform Engineer', location: { name: 'Toronto, ON' }, absolute_url: 'https://careers.cyberdyne.io/jobs/1', updated_at: '2026-08-01T12:00:00Z' },
        { id: 'cyber-2', title: 'Remote Distributed Systems Lead', location: { name: 'Remote - Canada' }, absolute_url: 'https://careers.cyberdyne.io/jobs/2', updated_at: '2026-08-02T12:00:00Z' },
      ] });
    }
    if (urlStr.includes('omni')) {
      return Response.json({ jobs: [
        { id: 'omni-1', title: 'Security Operations Specialist', location: { name: 'Detroit, MI' }, absolute_url: 'https://careers.omnicorp.com/jobs/1', updated_at: '2026-07-01T12:00:00Z' },
      ] });
    }
    if (urlStr.includes('acme')) {
      return Response.json({ jobs: [
        { id: 'acme-1', title: 'Frontend React Developer', location: { name: 'Remote - Worldwide' }, absolute_url: 'https://acme.io/jobs/10', updated_at: '2026-08-03T12:00:00Z' },
      ] });
    }
    return Response.json({ jobs: [] });
  };

  try {
    const imported = await store.importLiveJobs(tenantId, { plan: { limits: { jobBoards: -1 } }, autoDiscover: false });
    assert.equal(imported.stats.newJobs, 4);

    // 3. Test findJobs enriches jobs with connections and contacts
    const allJobs = await store.findJobs(tenantId, { page: 1, pageSize: 20 });
    assert.equal(allJobs.total, 4);

    const cyberJob1 = allJobs.items.find((j) => j.title === 'Senior AI Platform Engineer');
    assert.ok(cyberJob1);
    assert.equal(cyberJob1.connectionCount, 3);
    assert.equal(cyberJob1.hasConnections, true);
    assert.equal(cyberJob1.topContactName, 'Sarah Connor');
    assert.ok(Array.isArray(cyberJob1.contacts) && cyberJob1.contacts.length === 3);
    assert.equal(cyberJob1.isLocal, true);
    assert.equal(cyberJob1.isRemote, false);

    const cyberJob2 = allJobs.items.find((j) => j.title === 'Remote Distributed Systems Lead');
    assert.ok(cyberJob2);
    assert.equal(cyberJob2.connectionCount, 3);
    assert.equal(cyberJob2.workStyle, 'remote');
    assert.equal(cyberJob2.isRemote, true);

    const acmeJob = allJobs.items.find((j) => j.title === 'Frontend React Developer');
    assert.ok(acmeJob);
    assert.equal(acmeJob.connectionCount, 0);
    assert.equal(acmeJob.hasConnections, false);
    assert.equal(acmeJob.workStyle, 'remote');

    // 4. Test filtering by Network Contacts (hasContacts = 'true')
    const networkJobs = await store.findJobs(tenantId, { hasContacts: 'true', page: 1, pageSize: 20 });
    assert.equal(networkJobs.total, 3, 'Should only return jobs with connections');
    assert.ok(networkJobs.items.every((j) => j.connectionCount > 0));
    assert.ok(!networkJobs.items.some((j) => j.companyName === 'Acme Unknown Global'));

    // 5. Test filtering by minConnections = 2
    const multiConnectionJobs = await store.findJobs(tenantId, { minConnections: '2', page: 1, pageSize: 20 });
    assert.equal(multiConnectionJobs.total, 2, 'Should only return Cyberdyne jobs');
    assert.ok(multiConnectionJobs.items.every((j) => j.companyName === 'Cyberdyne Systems'));

    // 6. Test filtering by Local or Remote (workStyle = 'local_remote')
    const localRemoteJobs = await store.findJobs(tenantId, { workStyle: 'local_remote', page: 1, pageSize: 20 });
    assert.equal(localRemoteJobs.total, 3, 'Should match Toronto, Remote-Canada, and Remote-Worldwide');
    assert.ok(!localRemoteJobs.items.some((j) => j.companyName === 'Omni Consumer Products'));

    // 7. Test sorting by most connections (sortBy = 'connections')
    const sortedJobs = await store.findJobs(tenantId, { sortBy: 'connections', page: 1, pageSize: 20 });
    assert.equal(sortedJobs.items[0].connectionCount, 3);
    assert.equal(sortedJobs.items[1].connectionCount, 3);
    assert.equal(sortedJobs.items[2].connectionCount, 1);
    assert.equal(sortedJobs.items[3].connectionCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
