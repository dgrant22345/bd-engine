import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

test('ingestion diagnostics group coverage gaps into actionable customer states', async () => {
  const store = createStore();
  const tenantId = 'tenant-coverage-diagnostics';
  store.ensureTenant({ id: tenantId, name: 'Coverage diagnostics' }, { id: `${tenantId}-owner` });

  const healthy = store.addConfig(tenantId, {
    companyName: 'Healthy Board',
    atsType: 'greenhouse',
    boardId: 'healthy-board',
    careersUrl: 'https://job-boards.greenhouse.io/healthy-board',
    lastImportStatus: 'success',
  });
  store.addConfig(tenantId, {
    companyName: 'Failed Board',
    atsType: 'greenhouse',
    boardId: 'failed-board',
    careersUrl: 'https://job-boards.greenhouse.io/failed-board',
    lastImportStatus: 'failed',
    lastImportError: 'HTTP 404',
  });
  store.addConfig(tenantId, {
    companyName: 'Empty Board',
    atsType: 'lever',
    boardId: 'empty-board',
    careersUrl: 'https://jobs.lever.co/empty-board',
    lastImportStatus: 'empty',
  });
  store.addConfig(tenantId, {
    companyName: 'Review Board',
    atsType: 'lever',
    boardId: 'review-board',
    discoveryStatus: 'needs_review',
    reviewStatus: 'pending',
    active: false,
  });
  store.addConfig(tenantId, {
    companyName: 'Tracking Only',
    atsType: 'icims',
    careersUrl: 'https://careers.example.com/icims',
  });
  store.addConfig(tenantId, {
    companyName: 'Careers Page Only',
    careersUrl: 'https://careers.example.com/jobs',
  });
  store.addConfig(tenantId, {
    companyName: 'Domain Ready',
    domain: 'domain-ready.example',
  });
  store.addConfig(tenantId, { companyName: 'Missing Details' });
  store.addConfig(tenantId, {
    companyName: 'Bad Legacy Guess',
    careersUrl: 'https://gmail.com/careers',
  });

  const diagnostics = await store.getIngestionDiagnostics(tenantId);
  assert.equal(diagnostics.coverageCategories.healthy, 1);
  assert.equal(diagnostics.coverageCategories.failed, 1);
  assert.equal(diagnostics.coverageCategories.empty, 1);
  assert.equal(diagnostics.coverageCategories.needs_review, 1);
  assert.equal(diagnostics.coverageCategories.tracking_only, 1);
  assert.equal(diagnostics.coverageCategories.careers_page_only, 1);
  assert.equal(diagnostics.coverageCategories.discovery_needed, 1);
  assert.equal(diagnostics.coverageCategories.missing_identity, 2);
  assert.equal(diagnostics.coverageSummary.totalIssues, 8);
  assert.equal(diagnostics.coverageSummary.importReady, 3);
  assert.equal(diagnostics.coverageIssues.find((item) => item.category === 'failed').detail, 'The saved job board is no longer available.');

  const exact = await store.getConfig(tenantId, healthy.id);
  assert.equal(exact.companyName, 'Healthy Board');
});

test('exact job-source lookup cannot cross workspaces', async () => {
  const store = createStore();
  const ownerTenantId = 'tenant-config-detail-owner';
  const otherTenantId = 'tenant-config-detail-other';
  store.ensureTenant({ id: ownerTenantId, name: 'Owner' }, { id: `${ownerTenantId}-user` });
  store.ensureTenant({ id: otherTenantId, name: 'Other' }, { id: `${otherTenantId}-user` });
  const config = store.addConfig(ownerTenantId, {
    companyName: 'Private Board',
    atsType: 'ashby',
    boardId: 'private-board',
    careersUrl: 'https://jobs.ashbyhq.com/private-board',
  });

  assert.equal((await store.getConfig(ownerTenantId, config.id)).id, config.id);
  assert.equal(await store.getConfig(otherTenantId, config.id), null);
});
