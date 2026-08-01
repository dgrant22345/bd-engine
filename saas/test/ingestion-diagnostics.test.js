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

test('ingestion coverage excludes network companies and deduplicates company readiness', async () => {
  const store = createStore();
  const tenantId = 'tenant-focused-coverage';
  store.ensureTenant({ id: tenantId, name: 'Focused coverage' }, { id: `${tenantId}-owner` });

  const tracked = await store.addAccount(tenantId, { displayName: 'Tracked Company' });
  const network = await store.addAccount(tenantId, { displayName: 'Network Company' });
  await store.patchAccount(tenantId, network.id, { tracked: false });

  for (const boardId of ['tracked-primary', 'tracked-secondary']) {
    store.addConfig(tenantId, {
      accountId: tracked.id,
      companyName: tracked.displayName,
      atsType: 'greenhouse',
      boardId,
      lastImportStatus: 'success',
    });
  }
  store.addConfig(tenantId, {
    accountId: network.id,
    companyName: network.displayName,
    atsType: 'lever',
    boardId: 'network-board',
    lastImportStatus: 'failed',
  });

  const diagnostics = await store.getIngestionDiagnostics(tenantId);
  assert.equal(diagnostics.counts.configs, 3);
  assert.equal(diagnostics.counts.operationalConfigs, 2);
  assert.equal(diagnostics.counts.networkConfigsExcluded, 1);
  assert.equal(diagnostics.coverageSummary.importReady, 2);
  assert.equal(diagnostics.coverageSummary.companiesReady, 1);
  assert.equal(diagnostics.coverageSummary.readyCoveragePercent, 100);
  assert.equal(diagnostics.coverageSummary.networkSourcesExcluded, 1);
  assert.equal(diagnostics.coverageCategories.failed || 0, 0);
});

test('resolver headline and review queues exclude network-only company history', async () => {
  const store = createStore();
  const tenantId = 'tenant-focused-resolver';
  store.ensureTenant({ id: tenantId, name: 'Focused resolver' }, { id: `${tenantId}-owner` });

  const tracked = await store.addAccount(tenantId, { displayName: 'Tracked Company' });
  const network = await store.addAccount(tenantId, { displayName: 'Network Company' });
  await store.patchAccount(tenantId, network.id, { tracked: false });

  store.addConfig(tenantId, {
    accountId: tracked.id,
    companyName: tracked.displayName,
    atsType: 'greenhouse',
    boardId: 'tracked-company',
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    active: true,
  });
  store.addConfig(tenantId, {
    accountId: network.id,
    companyName: network.displayName,
    discoveryStatus: 'unresolved',
    confidenceBand: 'medium',
    active: false,
  });

  const report = store.getResolverReport(tenantId);
  assert.equal(report.summary.totalCompanies, 2);
  assert.equal(report.summary.coveragePercent, 50);
  assert.equal(report.summary.operationalTotalCompanies, 1);
  assert.equal(report.summary.operationalResolvedCount, 1);
  assert.equal(report.summary.operationalCoveragePercent, 100);
  assert.equal(report.summary.networkSourcesExcluded, 1);
  assert.equal(report.summary.mediumReviewQueueCount, 0);
  assert.equal(report.summary.unresolvedReviewQueueCount, 0);

  assert.equal(store.getResolverQueue(tenantId, 'medium').total, 0);
  assert.equal(store.getResolverQueue(tenantId, 'unresolved').total, 0);
});
