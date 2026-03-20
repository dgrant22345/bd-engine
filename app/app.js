const appState = {
  bootstrap: null,
  localData: null,
  localOverlays: null,
  activeView: 'dashboard',
  accountQuery: { page: 1, pageSize: 20, q: '', hiring: '', ats: '', recencyDays: '', minContacts: '', minTargetScore: '', priority: '', status: '', owner: '', outreachStatus: '', industry: '', geography: '', sortBy: '' },
  contactQuery: { page: 1, pageSize: 20, q: '', minScore: '', outreachStatus: '' },
  jobQuery: { page: 1, pageSize: 20, q: '', ats: '', recencyDays: '', active: 'true', isNew: '', sortBy: '' },
  configQuery: { page: 1, pageSize: 20, q: '', ats: '', active: '', discoveryStatus: '', confidenceBand: '', reviewStatus: '' },
  enrichmentQuery: { page: 1, pageSize: 20, confidence: '', missingDomain: '', missingCareersUrl: '', hasConnections: '', minTargetScore: '', topN: '' },
  accountDetail: null,
  searchTimer: null,
  configEditingId: '',
  runtimeStatus: null,
  runtimePollTimer: null,
};

const viewTitle = document.getElementById('view-title');
const appRoot = document.getElementById('app');
const workspaceName = document.getElementById('workspace-name');
const searchInput = document.getElementById('global-search-input');
const searchResults = document.getElementById('search-results');
const appAlert = document.getElementById('app-alert');
const refreshBootstrapButton = document.getElementById('refresh-bootstrap');

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  window.bdLocalApi.handleError(event.reason, appAlert);
});

window.addEventListener('error', (event) => {
  window.bdLocalApi.handleError(event.error || event.message, appAlert);
});

init();

async function init() {
  bindEvents();
  window.bdLocalApi.setAlert('', appAlert);
  renderLoadingState('Dashboard', 'Loading your operating view...');
  try {
    const initialRoot = getRouteRoot();
    if (routeNeedsBootstrapFilters(initialRoot)) {
      await loadBootstrap(true, { includeFilters: true });
      await renderRoute();
    } else {
      await renderRoute();
      loadBootstrap(false).catch((error) => {
        console.warn('Bootstrap hydration failed in background.', error);
        return null;
      });
    }
  } catch (error) {
    window.bdLocalApi.handleError(error, appAlert);
    appRoot.innerHTML = `<div class="empty-state">Unable to load the BD Engine data. ${escapeHtml(error.message || String(error))}</div>`;
  }
}

function bindEvents() {
  window.addEventListener('hashchange', () => renderRoute());
  refreshBootstrapButton.addEventListener('click', async () => {
    refreshBootstrapButton.disabled = true;
    refreshBootstrapButton.textContent = 'Refreshing...';
    try {
      invalidateAppData();
      await loadBootstrap(true, { includeFilters: routeNeedsBootstrapFilters(getRouteRoot()) });
      await renderRoute();
    } finally {
      refreshBootstrapButton.disabled = false;
      refreshBootstrapButton.textContent = 'Refresh snapshot';
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(appState.searchTimer);
    const value = searchInput.value.trim();
    if (value.length < 2) {
      searchResults.classList.add('hidden');
      searchResults.innerHTML = '';
      return;
    }
    appState.searchTimer = setTimeout(() => runSearch(value), 220);
  });

  document.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]');
    if (!action) {
      if (!event.target.closest('#search-results') && event.target !== searchInput) {
        searchResults.classList.add('hidden');
      }
      return;
    }

    const actionName = action.dataset.action;
    if (actionName === 'paginate') {
      const view = action.dataset.view;
      const page = Number(action.dataset.page);
      if (view === 'accounts') appState.accountQuery.page = page;
      if (view === 'contacts') appState.contactQuery.page = page;
      if (view === 'jobs') appState.jobQuery.page = page;
      if (view === 'configs') appState.configQuery.page = page;
      if (view === 'enrichmentQueue') {
        appState.enrichmentQuery.page = page;
        await refreshEnrichmentPanel();
        return;
      }
      await renderRoute();
      return;
    }
    if (actionName === 'apply-enrichment-filter') {
      applyEnrichmentFilters();
      return;
    }
    if (actionName === 'enrichment-top-n') {
      const topN = action.dataset.topn;
      appState.enrichmentQuery.topN = topN;
      appState.enrichmentQuery.page = 1;
      await refreshEnrichmentPanel();
      return;
    }

    if (actionName === 'edit-config') {
      populateConfigForm(action.dataset.id);
      return;
    }

    if (actionName === 'config-review') {
      await reviewConfig(action.dataset.id, action.dataset.decision);
      return;
    }

    if (actionName === 'retry-config-resolution') {
      await retryConfigResolution(action.dataset.id);
      return;
    }

    if (actionName === 'new-config') {
      resetConfigForm();
      return;
    }

    if (actionName === 'open-account') {
      location.hash = `#/accounts/${action.dataset.id}`;
      return;
    }

    if (actionName === 'reseed-workbook') {
      await reseedWorkbook(action.dataset.path || '');
      return;
    }

    if (actionName === 'run-live-import') {
      await runLiveImport();
      return;
    }

    if (actionName === 'sync-configs') {
      await syncConfigs();
      return;
    }

    if (actionName === 'run-discovery') {
      await runDiscovery();
      return;
    }

    if (actionName === 'run-enrichment') {
      await runEnrichment();
      return;
    }

    if (actionName === 'run-target-score-rollout') {
      await runTargetScoreRollout();
      return;
    }

    if (actionName === 'sync-google-sheets') {
      await runGoogleSheetSync();
      return;
    }

    if (actionName === 'run-full-engine') {
      await runFullBdEngine();
      return;
    }

    if (actionName === 'dry-run-connections-csv') {
      await runConnectionsCsvImport(true);
      return;
    }

    if (actionName === 'import-connections-csv') {
      await runConnectionsCsvImport(false);
      return;
    }

    if (actionName === 'cancel-background-job') {
      await cancelBackgroundJob(action.dataset.id);
      return;
    }

    if (actionName === 'expand-enrichment-row') {
      const row = document.getElementById(`enrichment-edit-${action.dataset.id}`);
      if (row) row.classList.toggle('hidden');
      return;
    }

    if (actionName === 'archive-account') {
      await archiveAccount(action.dataset.id);
      return;
    }

    if (actionName === 'generate-outreach') {
      await generateSmartOutreach(action.dataset.id, action);
      return;
    }

    if (actionName === 'quick-log-inline') {
      const row = document.getElementById('quick-log-' + action.dataset.id);
      if (row) {
        document.querySelectorAll('.quick-log-row').forEach(r => { if (r !== row) r.classList.add('hidden'); });
        row.classList.toggle('hidden');
      }
      return;
    }

    if (actionName === 'close-quick-log') {
      const row = document.getElementById('quick-log-' + action.dataset.id);
      if (row) row.classList.add('hidden');
      return;
    }

    if (actionName === 'apply-bulk-update') {
      await applyBulkUpdate();
      return;
    }

    if (actionName === 'rerun-enrichment-resolution') {
      await rerunEnrichmentResolution(action.dataset.id);
      return;
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();

    if (form.id === 'accounts-filter-form') {
      appState.accountQuery = { ...appState.accountQuery, page: 1, ...getFormValues(form) };
      await renderAccountsView();
      return;
    }

    if (form.id === 'account-create-form') {
      const payload = getFormValues(form);
      payload.tags = splitTags(payload.tags);
      const created = await api('/api/accounts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      window.bdLocalApi.setAlert(`Added ${created.displayName} to target accounts.`, appAlert);
      location.hash = `#/accounts/${created.id}`;
      return;
    }

    if (form.id === 'account-import-form') {
      const payload = getFormValues(form);
      const result = await api('/api/accounts/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      await renderAccountsView();
      window.bdLocalApi.setAlert(`Imported ${formatNumber(result.count || 0)} target accounts.`, appAlert);
      return;
    }

    if (form.id === 'contacts-filter-form') {
      appState.contactQuery = { ...appState.contactQuery, page: 1, ...getFormValues(form) };
      await renderContactsView();
      return;
    }

    if (form.id === 'jobs-filter-form') {
      appState.jobQuery = { ...appState.jobQuery, page: 1, ...getFormValues(form) };
      await renderJobsView();
      return;
    }

    if (form.id === 'configs-filter-form') {
      appState.configQuery = { ...appState.configQuery, page: 1, ...getFormValues(form) };
      await renderAdminView();
      return;
    }

    if (form.id === 'account-edit-form') {
      const accountId = form.dataset.accountId;
      const payload = getFormValues(form);
      payload.tags = splitTags(payload.tags);
      await api(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      await renderAccountDetail(accountId);
      window.bdLocalApi.setAlert('Account updated.', appAlert);
      return;
    }

    if (form.id === 'next-action-form') {
      const accountId = form.dataset.accountId;
      const payload = getFormValues(form);
      await api(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      await renderAccountDetail(accountId);
      window.bdLocalApi.setAlert('Next action updated.', appAlert);
      return;
    }

    if (form.classList.contains('quick-log-form')) {
      const accountId = form.dataset.accountId;
      const payload = getFormValues(form);
      await api('/api/accounts/' + accountId + '/quick-update', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      const row = document.getElementById('quick-log-' + accountId);
      if (row) row.classList.add('hidden');
      window.bdLocalApi.setAlert('Quick update saved.', appAlert);
      return;
    }

    if (form.id === 'activity-form') {
      const payload = getFormValues(form);
      await api('/api/activity', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      await renderAccountDetail(payload.accountId);
      window.bdLocalApi.setAlert('Activity logged.', appAlert);
      return;
    }

    if (form.id === 'contact-inline-form') {
      const payload = getFormValues(form);
      await api(`/api/contacts/${form.dataset.contactId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      await renderContactsView();
      return;
    }

    if (form.id === 'settings-form') {
      const payload = getFormValues(form);
      payload.gtaPriority = payload.gtaPriority === 'true';
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      await renderAdminView();
      window.bdLocalApi.setAlert('Scoring settings saved.', appAlert);
      return;
    }

    if (form.id === 'config-form') {
      const payload = getFormValues(form);
      payload.active = payload.active === 'true';
      const isEditing = Boolean(appState.configEditingId);
      const method = isEditing ? 'PATCH' : 'POST';
      const path = isEditing ? `/api/configs/${appState.configEditingId}` : '/api/configs';
      await api(path, {
        method,
        body: JSON.stringify(payload),
      });
      resetConfigForm();
      invalidateAppData();
      await renderAdminView();
      window.bdLocalApi.setAlert(`${isEditing ? 'Updated' : 'Added'} ATS config for ${payload.companyName || 'the selected company'}.`, appAlert);
      return;
    }

    if (form.id === 'enrichment-inline-form') {
      const accountId = form.dataset.accountId;
      const payload = getFormValues(form);
      payload.aliases = splitTags(payload.aliases);
      if (payload.canonicalDomain && !payload.canonicalDomain.includes('://')) {
        payload.canonicalDomain = payload.canonicalDomain.trim();
      }
      await api(`/api/accounts/${accountId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          canonicalDomain: payload.canonicalDomain || '',
          careersUrl: payload.careersUrl || '',
          aliases: payload.aliases,
          linkedinCompanySlug: payload.linkedinCompanySlug || '',
          enrichmentStatus: (payload.canonicalDomain || payload.careersUrl) ? 'manual' : 'missing_inputs',
          enrichmentSource: 'manual_review',
          enrichmentConfidence: (payload.canonicalDomain && payload.careersUrl) ? 'high' : 'medium',
          enrichmentConfidenceScore: (payload.canonicalDomain && payload.careersUrl) ? 94 : 78,
          enrichmentNotes: payload.enrichmentNotes || '',
        }),
      });
      invalidateAppData();
      if (event.submitter && event.submitter.value === 'save_rerun') {
        const accepted = await api(`/api/enrichment/${accountId}/rerun-resolution`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        window.bdLocalApi.setAlert('Enrichment saved and ATS resolution queued.', appAlert);
        await renderAdminView();
        hydrateAdminRuntimePanels(await loadRuntimeStatus(true));
        void watchBackgroundJob(accepted.jobId, { label: 'ATS resolution', refreshRoute: false }).catch(() => {});
        return;
      }
      await renderAdminView();
      window.bdLocalApi.setAlert('Enrichment saved.', appAlert);
    }
  });
}

async function loadBootstrap(force, options = {}) {
  appState.bootstrap = await window.bdLocalApi.loadBootstrap(appState, force, options);
  workspaceName.textContent = appState.bootstrap?.workspace?.name || 'BD Engine Workspace';
  window.bdLocalApi.setAlert('', appAlert);
  return appState.bootstrap;
}

async function api(path, options = {}) {
  return window.bdLocalApi.api(appState, path, options);
}

function getFormValues(form) {
  const data = new FormData(form);
  const output = {};
  for (const [key, value] of data.entries()) {
    output[key] = value;
  }
  return output;
}

function getContactLinkedInHref(contact, companyName = '') {
  const directUrl = String(contact?.linkedinUrl || '').trim();
  if (directUrl) {
    return directUrl;
  }

  const searchTerms = [
    String(contact?.fullName || '').trim(),
    String(contact?.title || '').trim(),
    String(companyName || contact?.companyName || '').trim(),
  ].filter(Boolean).join(' ');
  if (!searchTerms) {
    return '';
  }

  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchTerms)}`;
}

function splitTags(value) {
  if (!value) return [];
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, value);
    }
  });
  const string = query.toString();
  return string ? `?${string}` : '';
}

function getRouteRoot(hashValue = location.hash) {
  const hash = hashValue || '#/dashboard';
  return hash.replace(/^#\/?/, '').split('/')[0] || 'dashboard';
}

function routeNeedsBootstrapFilters(routeRoot) {
  return routeRoot === 'accounts' || routeRoot === 'admin';
}

function invalidateAppData() {
  appState.bootstrap = null;
  appState.accountDetail = null;
  window.bdLocalApi.invalidate();
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function loadRuntimeStatus(force = false) {
  appState.runtimeStatus = await api('/api/runtime/status', { skipCache: true });
  return appState.runtimeStatus;
}

function clearRuntimePoll() {
  if (appState.runtimePollTimer) {
    window.clearTimeout(appState.runtimePollTimer);
    appState.runtimePollTimer = null;
  }
}

function hydrateAdminRuntimePanels(runtime) {
  const summary = runtime || appState.runtimeStatus;
  const summaryTarget = document.getElementById('runtime-status-panel');
  const jobsTarget = document.getElementById('background-jobs-panel');
  if (!summaryTarget || !jobsTarget || !summary) {
    return;
  }

  summaryTarget.innerHTML = `
    <div class="runtime-status-shell">
      <div class="runtime-status-head">
        <div>
          <p class="eyebrow">Live runtime</p>
          <h4>${summary.warmed ? 'Server warm' : 'Server starting'}</h4>
          <p class="small muted">${summary.workerRunning ? `Worker PID ${summary.workerPid || 'unknown'} is draining the queue.` : 'No worker is active right now.'}</p>
        </div>
        <div class="runtime-banner-flags">
          ${renderStatusPill(summary.warmed ? 'Warm' : 'Starting', summary.warmed ? 'success' : 'warning')}
          ${renderStatusPill(summary.workerRunning ? 'Online' : 'Idle', summary.workerRunning ? 'hot' : 'neutral')}
        </div>
      </div>
      <div class="status-matrix status-matrix--premium">
        <div class="status-item"><span class="small muted">Server</span><strong>${summary.warmed ? 'Warm' : 'Starting'}</strong><span class="small muted">${summary.serverStartedAt ? formatDate(summary.serverStartedAt) : 'Just now'}</span></div>
        <div class="status-item"><span class="small muted">Worker</span><strong>${summary.workerRunning ? 'Online' : 'Idle'}</strong><span class="small muted">${summary.workerPid ? `PID ${summary.workerPid}` : 'No active process'}</span></div>
        <div class="status-item"><span class="small muted">Running jobs</span><strong>${formatNumber(summary.runningJobs || 0)}</strong><span class="small muted">Currently executing</span></div>
        <div class="status-item"><span class="small muted">Queued jobs</span><strong>${formatNumber(summary.queuedJobs || 0)}</strong><span class="small muted">${summary.queuedJobs ? 'Waiting for worker time' : 'Queue clear'}</span></div>
      </div>
    </div>
  `;

  const jobs = (summary.activeJobs && summary.activeJobs.length ? summary.activeJobs : summary.recentJobs) || [];
  jobsTarget.innerHTML = jobs.length
    ? jobs.map((job) => renderBackgroundJobItem(job)).join('')
    : '<div class="empty-state compact">No background jobs are running right now.</div>';
}

function scheduleRuntimePoll() {
  clearRuntimePoll();
  if (appState.activeView !== 'admin') {
    return;
  }

  appState.runtimePollTimer = window.setTimeout(async () => {
    try {
      const runtime = await loadRuntimeStatus(true);
      hydrateAdminRuntimePanels(runtime);
    } catch (_error) {
      // Keep the current admin screen stable if polling fails.
    } finally {
      scheduleRuntimePoll();
    }
  }, 3000);
}

async function watchBackgroundJob(jobId, options = {}) {
  const label = options.label || 'Background job';
  while (true) {
    const job = await api(`/api/background-jobs/${jobId}`, { skipCache: true });
    try {
      const runtime = await loadRuntimeStatus(true);
      hydrateAdminRuntimePanels(runtime);
    } catch (_error) {
      // Background status polling should not fail the main job watcher.
    }

    if (job.status === 'completed') {
      invalidateAppData();
      if (options.refreshRoute !== false) {
        await renderRoute();
      }
      return job;
    }

    if (job.status === 'failed') {
      if (options.refreshRoute !== false) {
        await renderRoute();
      }
      throw new Error(job.errorMessage || `${label} failed.`);
    }

    if (job.status === 'cancelled') {
      if (options.refreshRoute !== false) {
        await renderRoute();
      }
      throw new Error(`${label} was cancelled.`);
    }

    window.bdLocalApi.setAlert(`${label}: ${job.progressMessage || humanize(job.status)}`, appAlert);
    await sleep(2000);
  }
}

function renderLoadingState(title, subtitle) {
  setViewTitle(title);
  appRoot.innerHTML = `
    <section class="hero-card loading-shell">
      <div class="loading-copy">
        <p class="eyebrow">Loading view</p>
        <h3>${escapeHtml(title)}</h3>
        <p class="subtitle small">${escapeHtml(subtitle || 'Fetching the latest hiring and account signals...')}</p>
      </div>
      <div class="loading-grid">
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-pill"></span>
      </div>
    </section>
    <section class="metrics-grid">
      <article class="metric-card"><span class="skeleton skeleton-line short"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line"></span></article>
      <article class="metric-card"><span class="skeleton skeleton-line short"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line"></span></article>
      <article class="metric-card"><span class="skeleton skeleton-line short"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line"></span></article>
      <article class="metric-card"><span class="skeleton skeleton-line short"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line"></span></article>
    </section>
  `;
}

function countAppliedFilters(query) {
  return Object.entries(query || {}).filter(([key, value]) => key !== 'page' && key !== 'pageSize' && value !== '' && value !== null && value !== undefined).length;
}

function setViewTitle(title) {
  viewTitle.textContent = title;
}

function activateNav(routeKey) {
  document.querySelectorAll('.nav a').forEach((anchor) => {
    anchor.classList.toggle('active', anchor.dataset.route === routeKey);
  });
}

async function renderRoute() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace(/^#\/?/, '').split('/');
  const root = parts[0] || 'dashboard';
  appState.activeView = root;
  clearRuntimePoll();

  if (root === 'accounts' && parts[1]) {
    activateNav('accounts');
    await renderAccountDetail(parts[1]);
    return;
  }

  if (root === 'accounts') {
    activateNav('accounts');
    await renderAccountsView();
    return;
  }

  if (root === 'contacts') {
    activateNav('contacts');
    await renderContactsView();
    return;
  }

  if (root === 'jobs') {
    activateNav('jobs');
    await renderJobsView();
    return;
  }

  if (root === 'admin') {
    activateNav('admin');
    await renderAdminView();
    scheduleRuntimePoll();
    return;
  }

  activateNav('dashboard');
  await renderDashboardView();
}
async function renderDashboardView() {
  renderLoadingState('Dashboard', "Building today's hiring radar...");
  setViewTitle('Dashboard');
  const dashboard = await api('/api/dashboard');
  let extended = { playbook: [], overdueFollowUps: [], staleAccounts: [], activityFeed: [], enrichmentFunnel: {}, alertQueue: [], sequenceQueue: [], introQueue: [] };
  try { extended = await api('/api/dashboard/extended'); } catch(e) { /* non-critical */ }
  const topCompany = dashboard.todayQueue[0];
  const maxNetwork = Math.max(1, ...(dashboard.networkLeaders || []).map((item) => item.connectionCount || 0));
  const coverageEvents = (extended.activityFeed || []).length + (dashboard.recentlyDiscoveredBoards || []).length;
  const queuePressure = (extended.overdueFollowUps || []).length + (extended.staleAccounts || []).length;
  const dashboardStory = [
    {
      label: 'Priority lane',
      value: topCompany ? `${formatNumber(getTargetScore(topCompany))}/100` : 'No company yet',
      description: topCompany ? (getTargetScoreExplanation(topCompany) || topCompany.displayName) : 'Relax filters or run discovery to populate the lead lane.',
      tone: 'accent',
    },
    {
      label: 'Market motion',
      value: `${formatNumber(dashboard.summary.newJobsLast24h || 0)} fresh jobs`,
      description: `${formatNumber(dashboard.summary.discoveredBoardCount || 0)} ATS boards and ${formatNumber(coverageEvents)} visible events keep the feed current.`,
      tone: 'success',
    },
    {
      label: 'Attention needed',
      value: `${formatNumber(queuePressure)} accounts`,
      description: queuePressure ? 'These accounts are overdue, stale, or ready for the next touch.' : 'No follow-up pressure is active right now.',
      tone: 'warning',
    },
  ];

  appRoot.innerHTML = `
    <section class="hero-card hero-card--dashboard">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Daily operating view</p>
          <h3>${topCompany ? escapeHtml(topCompany.displayName) : 'No companies match today\'s target-score thresholds yet'}</h3>
          <p class="subtitle">${topCompany ? escapeHtml(getTargetScoreExplanation(topCompany) || topCompany.recommendedAction || '') : 'Run ATS discovery, import fresh jobs, or relax the filters to populate a new target-score lane.'}</p>
          <div class="button-row">
            ${topCompany ? `<button class="primary-button" data-action="open-account" data-id="${topCompany.id}">Open best account</button>` : '<a class="primary-button" href="#/admin">Open admin</a>'}
            <a class="ghost-button" href="#/jobs">Review fresh jobs</a>
            <a class="ghost-button" href="#/accounts">Open accounts</a>
          </div>
          <div class="hero-signal-strip">
            ${renderSignalChip('Today queue', formatNumber(dashboard.todayQueue.length), 'accent')}
            ${renderSignalChip('Fresh jobs', formatNumber(dashboard.summary.newJobsLast24h || 0), 'success')}
            ${renderSignalChip('Follow-ups', formatNumber((extended.overdueFollowUps.length || 0) + (extended.staleAccounts.length || 0)), 'warning')}
            ${renderSignalChip('ATS boards', formatNumber(dashboard.summary.discoveredBoardCount || 0), 'neutral')}
          </div>
          <div class="story-strip">
            ${dashboardStory.map((item) => renderStoryCard(item.label, item.value, item.description, item.tone)).join('')}
          </div>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Target score', topCompany ? formatNumber(getTargetScore(topCompany)) : '0')}
          ${renderMetricTile('Open roles', topCompany ? formatNumber(topCompany.openRoleCount || topCompany.jobCount) : '0')}
          ${renderMetricTile('Hiring velocity', topCompany ? formatNumber(topCompany.hiringVelocity || 0) : '0')}
          ${renderMetricTile('Engagement', topCompany ? formatNumber(topCompany.engagementScore || 0) : '0')}
        </div>
      </div>
      ${topCompany ? `
        <div class="spotlight-card">
          <div class="panel-header">
            <div>
              <h3>Why this account is leading</h3>
              <p class="muted small">Target score, hiring velocity, and engagement all point here first.</p>
            </div>
            ${renderStatusPill(topCompany.hiringStatus || 'No active jobs', topCompany.jobCount > 0 ? 'success' : 'neutral')}
          </div>
          <div class="spotlight-copy">
            <div class="spotlight-quote">${escapeHtml(getTargetScoreExplanation(topCompany) || topCompany.outreachDraft || 'Open the account for a deeper view.')}</div>
            <div class="spotlight-metrics">
              ${renderSignalChip('Target score', `${formatNumber(getTargetScore(topCompany))}/100`, 'accent')}
              ${renderSignalChip('Hiring velocity', formatNumber(topCompany.hiringVelocity || 0), 'success')}
              ${renderSignalChip('Engagement', formatNumber(topCompany.engagementScore || 0), 'neutral')}
              ${renderSignalChip('Next action', topCompany.nextAction || 'Review account', 'accent')}
              ${renderSignalChip('Open roles', formatNumber(topCompany.openRoleCount || topCompany.jobCount), 'success')}
            </div>
          </div>
        </div>
      ` : ''}
    </section>

    <section class="trust-strip">
      ${renderTrustCard('Launch in 3 moves', 'Import, resolve, work', 'Seed accounts, run ATS discovery, then work the ranked queue.', 'Workbook, CSV, or manual entry', 'accent')}
      ${renderTrustCard('Coverage snapshot', `${formatNumber(dashboard.summary.accountCount || 0)} tracked accounts`, 'Contacts, configs, and imported jobs stay visible in one model.', `${formatNumber(dashboard.summary.discoveredBoardCount || 0)} ATS boards found`, 'success')}
      ${renderTrustCard('Audit trail', `${formatNumber(coverageEvents)} visible events`, 'Recent actions, imports, and board discovery remain reviewable.', `${formatNumber(dashboard.summary.newJobsLast24h || 0)} new jobs in 24h`, 'warning')}
    </section>

    <section class="metrics-grid">
      ${renderMetricCard('Accounts tracked', dashboard.summary.accountCount, 'Target accounts with contacts, configs, or imported jobs')}
      ${renderMetricCard('Hiring accounts', dashboard.summary.hiringAccountCount, 'Companies with active normalized roles')}
      ${renderMetricCard('New jobs, 24h', dashboard.summary.newJobsLast24h, 'Freshly imported postings in the last day')}
      ${renderMetricCard('ATS boards found', dashboard.summary.discoveredBoardCount || 0, 'Mapped or discovered supported job boards')}
    </section>

    ${extended.playbook.length ? `
    <section class="detail-card playbook-section">
      <div class="panel-header">
        <div><h3>Today's playbook</h3><p class="muted small">Your top 5 accounts to work right now, ranked by target score.</p></div>
      </div>
      <div class="playbook-grid">
        ${extended.playbook.map((item) => `
          <div class="playbook-card ${item.isOverdue ? 'playbook-card--overdue' : ''} ${item.staleFlag === 'STALE' ? 'playbook-card--stale' : ''}">
            <div class="inline-header">
              <strong>${escapeHtml(item.displayName)}</strong>
              <span class="small muted">${formatNumber(getTargetScore(item))} / 100</span>
            </div>
            <p class="small">${escapeHtml(getTargetScoreExplanation(item) || item.recommendedAction || 'Review account')}</p>
            <div class="small muted">${item.topContactName ? 'Contact: ' + escapeHtml(item.topContactName) : ''}${item.openRoleCount ? ' \u00b7 ' + formatNumber(item.openRoleCount) + ' roles' : ''}</div>
            ${item.isOverdue ? '<span class="status-pill danger">Overdue</span>' : ''}
            ${item.staleFlag === 'STALE' ? '<span class="status-pill warning">Stale</span>' : ''}
            <div class="button-row" style="margin-top:8px;">
              <button class="ghost-button" data-action="open-account" data-id="${item.id}">Open</button>
            </div>
          </div>
        `).join('')}
      </div>
    </section>
    ` : ''}

    ${extended.overdueFollowUps.length || extended.staleAccounts.length ? `
    <section class="alert-bar">
      ${extended.overdueFollowUps.length ? `<div class="alert-item alert-item--danger"><strong>${extended.overdueFollowUps.length} overdue follow-up${extended.overdueFollowUps.length > 1 ? 's' : ''}</strong> \u2014 ${extended.overdueFollowUps.slice(0,3).map(a => escapeHtml(a.displayName)).join(', ')}${extended.overdueFollowUps.length > 3 ? '...' : ''}</div>` : ''}
      ${extended.staleAccounts.length ? `<div class="alert-item alert-item--warning"><strong>${extended.staleAccounts.length} stale account${extended.staleAccounts.length > 1 ? 's' : ''}</strong> \u2014 haven't been touched in 14+ days</div>` : ''}
    </section>
    ` : ''}

    ${extended.alertQueue.length || extended.sequenceQueue.length || extended.introQueue.length ? `
    <section class="dashboard-grid">
      <div class="list-card detail-card">
        <div class="panel-header">
          <div>
            <h3>Hiring trigger board</h3>
            <p class="muted small">Live account alerts ranked by hiring urgency and commercial upside.</p>
          </div>
        </div>
        ${extended.alertQueue.length ? `<div class="timeline">${extended.alertQueue.map((item) => `
          <article class="timeline-item">
            <div class="inline-header">
              <strong>${escapeHtml(item.displayName)}</strong>
              ${renderStatusPill(item.title || item.type || 'alert', item.alertPriorityScore >= 80 ? 'danger' : 'warning')}
            </div>
            <p>${escapeHtml(item.summary || item.recommendedAction || 'Review live hiring signals.')}</p>
            <div class="small muted">${formatNumber(item.alertPriorityScore || 0)} priority · ${formatNumber(item.targetScore || 0)}/100 target score · ${formatNumber(item.hiringVelocity || 0)} velocity</div>
            <div class="button-row" style="margin-top:8px;">
              <button class="ghost-button" data-action="open-account" data-id="${item.accountId}">Open</button>
            </div>
          </article>
        `).join('')}</div>` : '<div class="empty-state">No trigger alerts are active right now.</div>'}
      </div>
      <div class="list-card detail-card">
        <div class="panel-header">
          <div>
            <h3>Sequence next steps</h3>
            <p class="muted small">The outreach steps that should happen next, ordered by due time.</p>
          </div>
        </div>
        ${extended.sequenceQueue.length ? `<div class="timeline">${extended.sequenceQueue.map((item) => `
          <article class="timeline-item">
            <div class="inline-header">
              <strong>${escapeHtml(item.displayName)}</strong>
              ${renderStatusPill(item.isOverdue ? 'overdue' : (item.status || 'active'), item.isOverdue ? 'danger' : 'accent')}
            </div>
            <p>${escapeHtml(item.nextStepLabel || humanize(item.nextStep || 'next step'))} ${item.nextStepAt ? '· ' + escapeHtml(formatDate(item.nextStepAt)) : ''}</p>
            <div class="small muted">${formatNumber(item.targetScore || 0)}/100 target score · ${formatNumber(item.relationshipStrengthScore || 0)} relationship strength</div>
            ${item.adaptiveTimingReason ? `<div class="small muted">${escapeHtml(item.adaptiveTimingReason)}</div>` : ''}
            <div class="button-row" style="margin-top:8px;">
              <button class="ghost-button" data-action="open-account" data-id="${item.accountId}">Open</button>
            </div>
          </article>
        `).join('')}</div>` : '<div class="empty-state">No active sequence steps are queued yet.</div>'}
      </div>
      <div class="list-card detail-card">
        <div class="panel-header">
          <div>
            <h3>Warm intro board</h3>
            <p class="muted small">The strongest relationship paths into active hiring accounts.</p>
          </div>
        </div>
        ${extended.introQueue.length ? `<div class="timeline">${extended.introQueue.map((item) => `
          <article class="timeline-item">
            <div class="inline-header">
              <strong>${escapeHtml(item.displayName)}</strong>
              ${renderStatusPill(`${formatNumber(item.relationshipStrengthScore || 0)} strength`, item.relationshipStrengthScore >= 80 ? 'success' : 'accent')}
            </div>
            <p>${escapeHtml(item.introSummary || `Best path is through ${item.contactName || 'a mapped contact'}.`)}</p>
            <div class="small muted">${escapeHtml(item.contactName || 'Mapped contact')}${item.contactTitle ? ' · ' + escapeHtml(item.contactTitle) : ''}${item.pathLength ? ' · path ' + formatNumber(item.pathLength) : ''}</div>
            ${item.contactWhy ? `<div class="small muted">${escapeHtml(item.contactWhy)}</div>` : ''}
            <div class="button-row" style="margin-top:8px;">
              <button class="ghost-button" data-action="open-account" data-id="${item.accountId}">Open</button>
            </div>
          </article>
        `).join('')}</div>` : '<div class="empty-state">No warm intro opportunities are mapped yet.</div>'}
      </div>
    </section>
    ` : ''}

    <section class="dashboard-grid">
      <div class="table-card emphasis-card">
        <div class="panel-header">
          <div>
            <h3>Today queue</h3>
            <p class="muted small">The companies most worth touching today, ranked for immediate action.</p>
          </div>
          <a class="ghost-button" href="#/accounts">See all accounts</a>
        </div>
        ${dashboard.todayQueue.length ? renderTodayQueueTable(dashboard.todayQueue) : '<div class="empty-state">No companies match the current settings thresholds.</div>'}
      </div>
      <div class="panel-stack">
        <div class="list-card detail-card">
          <div class="panel-header">
            <div>
              <h3>Follow-up queue</h3>
              <p class="muted small">Accounts due for outreach, stale for too long, or ready for a next move.</p>
            </div>
          </div>
          ${dashboard.followUpAccounts.length ? `<div class="timeline">${dashboard.followUpAccounts.map((item) => renderFollowUpItem(item)).join('')}</div>` : '<div class="empty-state">No follow-up pressure right now.</div>'}
        </div>
        <div class="list-card detail-card">
          <div class="panel-header">
            <div>
              <h3>Recommended actions</h3>
              <p class="muted small">Suggested next moves generated from current hiring and network context.</p>
            </div>
          </div>
          ${dashboard.recommendedActions.length ? `<div class="timeline">${dashboard.recommendedActions.map((item) => `
            <article class="timeline-item">
              <div class="inline-header">
                <strong>${escapeHtml(item.company)}</strong>
                ${renderStatusPill(item.outreachStatus || 'not_started', 'neutral')}
              </div>
              <p>${escapeHtml(item.text)}</p>
              <button class="ghost-button" data-action="open-account" data-id="${item.accountId}">Open</button>
            </article>
          `).join('')}</div>` : '<div class="empty-state">No actions available yet.</div>'}
        </div>
      </div>
    </section>

    ${extended.enrichmentFunnel && extended.enrichmentFunnel.total ? `
    <section class="detail-card" style="margin-bottom:20px;">
      <div class="panel-header"><div><h3>Enrichment pipeline</h3><p class="muted small">Account data completeness at a glance.</p></div></div>
      <div class="funnel-bar-container">
        ${(() => {
          const ef = extended.enrichmentFunnel;
          const total = ef.total || 1;
          const stages = [
            { label: 'Total', count: ef.total || 0, cls: 'funnel-total' },
            { label: 'Enriched', count: ef.enriched || 0, cls: 'funnel-enriched' },
            { label: 'Verified', count: ef.verified || 0, cls: 'funnel-verified' },
            { label: 'Importing', count: ef.importing || 0, cls: 'funnel-importing' },
            { label: 'Pending', count: ef.pending || 0, cls: 'funnel-pending' },
            { label: 'Unresolved', count: ef.unresolved || 0, cls: 'funnel-unresolved' },
          ];
          return stages.map(s => '<div class="funnel-stage ' + s.cls + '"><span class="funnel-stage-count">' + s.count + '</span><span class="funnel-stage-label small">' + s.label + '</span><div class="funnel-fill" style="width:' + Math.round((s.count / total) * 100) + '%"></div></div>').join('');
        })()}
      </div>
    </section>
    ` : ''}

    <section class="dashboard-grid">
      <div class="table-card">
        <div class="panel-header">
          <div>
            <h3>New jobs today</h3>
            <p class="muted small">Fresh roles worth using in outreach while the signal is still hot.</p>
          </div>
          <a class="ghost-button" href="#/jobs">Open jobs</a>
        </div>
        ${dashboard.newJobsToday.length ? renderRecentJobsTable(dashboard.newJobsToday) : '<div class="empty-state">No fresh jobs have landed in the last 24 hours.</div>'}
      </div>
      <div class="panel-stack">
        <div class="chart-card">
          <div class="panel-header">
            <div>
              <h3>Recent activity</h3>
              <p class="muted small">Latest outreach, notes, and pipeline changes across all accounts.</p>
            </div>
          </div>
          ${extended.activityFeed.length ? `<div class="timeline">${extended.activityFeed.map((item) => `
            <article class="timeline-item">
              <div class="inline-header">
                <strong>${escapeHtml(item.companyName || item.summary || 'Activity')}</strong>
                <span class="small muted">${formatDate(item.occurredAt)}</span>
              </div>
              <p class="small">${escapeHtml(item.summary || '')}</p>
            </article>
          `).join('')}</div>` : '<div class="empty-state">No activity logged yet.</div>'}
        </div>
        <div class="list-card detail-card">
          <div class="panel-header">
            <div>
              <h3>Recently discovered ATS boards</h3>
              <p class="muted small">The newest supported sources available for automated job ingestion.</p>
            </div>
            <a class="ghost-button" href="#/admin">Open admin</a>
          </div>
          ${dashboard.recentlyDiscoveredBoards.length ? renderDiscoveryList(dashboard.recentlyDiscoveredBoards) : '<div class="empty-state">Run ATS discovery to populate supported boards.</div>'}
        </div>
      </div>
    </section>
  `;
}

async function renderAccountsView() {
  renderLoadingState('Accounts', 'Loading ranked target accounts...');
  setViewTitle('Accounts');
  const stateBootstrap = await loadBootstrap(false, { includeFilters: true });
  const filters = stateBootstrap.filters || { atsTypes: [], industries: [] };
  const result = await api(`/api/accounts${buildQuery(appState.accountQuery)}`);
  const activeFilterCount = countAppliedFilters(appState.accountQuery);
  const hiringRows = result.items.filter((item) => (item.jobCount || 0) > 0).length;

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Account command center</p>
          <h3>Ranked target accounts</h3>
          <p class="subtitle">Focus the day on companies with the strongest combination of hiring motion, relationship access, and follow-up urgency.</p>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Results', formatNumber(result.total))}
          ${renderMetricTile('Filters', formatNumber(activeFilterCount))}
          ${renderMetricTile('Hiring on page', formatNumber(hiringRows))}
          ${renderMetricTile('Page size', formatNumber(result.pageSize))}
        </div>
      </div>
    </section>

    <section class="detail-grid detail-grid--workspace">
      <div class="table-card">
        <div class="panel-header">
          <div>
            <h3>Account queue</h3>
            <p class="muted small">This is the working list. Use filters to narrow it to the accounts you can act on right now.</p>
          </div>
          <span class="table-meta">${formatNumber(result.total)} tracked accounts</span>
        </div>
        <form id="accounts-filter-form" class="filter-grid filter-grid--dense">
          ${renderField('Search', '<input name="q" placeholder="Company, owner, note, domain" value="' + escapeAttr(appState.accountQuery.q) + '">')}
          ${renderField('Hiring', `<select name="hiring"><option value="">All</option><option value="true" ${selected(appState.accountQuery.hiring, 'true')}>Active hiring</option></select>`)}
          ${renderField('ATS', `<select name="ats"><option value="">All ATS</option>${filters.atsTypes.map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.accountQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
          ${renderField('Priority', renderPrioritySelect('priority', appState.accountQuery.priority, true))}
          ${renderField('Status', renderAccountStatusSelect('status', appState.accountQuery.status, true))}
          ${renderField('Owner', renderOwnerSelect('owner', appState.accountQuery.owner, true))}
          ${renderField('Geography', `<select name="geography"><option value="">Any location</option><option value="canada" ${selected(appState.accountQuery.geography, 'canada')}>Canada only</option><option value="canada_us" ${selected(appState.accountQuery.geography, 'canada_us')}>Canada + US</option><option value="us" ${selected(appState.accountQuery.geography, 'us')}>US only</option></select>`)}
          ${renderField('Industry', `<input name="industry" list="industry-filter-options" placeholder="Any industry" value="${escapeAttr(appState.accountQuery.industry)}">`)}
          ${renderField('Recency', `<select name="recencyDays"><option value="">Any</option><option value="7" ${selected(appState.accountQuery.recencyDays, '7')}>Last 7 days</option><option value="14" ${selected(appState.accountQuery.recencyDays, '14')}>Last 14 days</option><option value="30" ${selected(appState.accountQuery.recencyDays, '30')}>Last 30 days</option></select>`)}
          ${renderField('Min contacts', `<input name="minContacts" type="number" min="0" value="${escapeAttr(appState.accountQuery.minContacts)}">`)}
          ${renderField('Min target score', `<input name="minTargetScore" type="number" min="0" max="100" value="${escapeAttr(appState.accountQuery.minTargetScore)}">`)}
          ${renderField('Outreach', `<select name="outreachStatus"><option value="">Any stage</option>${renderOutreachStageOptions(appState.accountQuery.outreachStatus, true)}</select>`)}
          ${renderField('Sort by', renderAccountSortSelect(appState.accountQuery.sortBy))}
          <div class="field field--action"><label>Refresh queue</label><button class="primary-button" type="submit">Apply filters</button></div>
        </form>
        <datalist id="industry-filter-options">${(filters.industries || []).map((value) => `<option value="${escapeAttr(value)}"></option>`).join('')}</datalist>
        ${result.items.length ? renderAccountsTable(result.items) : '<div class="empty-state">No accounts match the current filter set.</div>'}
        ${renderPagination('accounts', result.page, result.pageSize, result.total)}
      </div>

      <div class="panel-stack">
        <div class="form-card">
          <div class="panel-header">
            <div>
              <h3>Add target account</h3>
              <p class="muted small">Create a company record without leaving the ranked queue.</p>
            </div>
          </div>
          <form id="account-create-form" class="detail-form">
            ${renderField('Company', '<input name="company" required placeholder="Stripe">')}
            ${renderField('Domain', '<input name="domain" placeholder="stripe.com">')}
            ${renderField('Careers URL', '<input name="careersUrl" placeholder="https://stripe.com/jobs">')}
            ${renderField('Owner', renderOwnerSelect('owner', ''))}
            ${renderField('Priority', renderPrioritySelect('priority', 'medium'))}
            ${renderField('Status', renderAccountStatusSelect('status', 'new'))}
            ${renderField('Next action', '<input name="nextAction" placeholder="Message VP Talent or verify ATS">')}
            ${renderField('Next action date', '<input name="nextActionAt" type="date">')}
            ${renderField('Tags', '<input name="tags" placeholder="fintech, warm intro, Toronto">')}
            <div class="field field--wide"><label>Notes</label><textarea name="notes" rows="4" placeholder="Why this account matters, what team is hiring, who might introduce you"></textarea></div>
            <div><button class="primary-button" type="submit">Add account</button></div>
          </form>
        </div>

        <div class="form-card">
          <div class="panel-header">
            <div>
              <h3>Bulk import target list</h3>
              <p class="muted small">Paste one company per line, or paste CSV with headers like company, domain, careers_url, priority, owner, notes, status.</p>
            </div>
          </div>
          <form id="account-import-form" class="detail-form">
            <div class="field field--wide"><label>Paste list</label><textarea name="text" rows="11" placeholder="Stripe&#10;Databricks&#10;Samsara&#10;&#10;or CSV headers: company,domain,careers_url,priority,owner"></textarea></div>
            <div><button class="secondary-button" type="submit">Import accounts</button></div>
          </form>
        </div>
      </div>
    </section>
  `;
}

async function renderAccountDetail(accountId) {
  renderLoadingState('Account detail', 'Loading account context...');
  const detail = await api(`/api/accounts/${accountId}`);
  appState.accountDetail = detail;
  setViewTitle(detail.account.displayName);
  const targetScore = getTargetScore(detail.account);
  const targetScoreExplanation = getTargetScoreExplanation(detail.account) || detail.account.recommendedAction || 'No target-score explanation available yet.';
  const connectionGraph = detail.account.connectionGraph || { shortestPathToDecisionMaker: { summary: 'No warm intro path mapped yet.', pathLength: 0 }, warmIntroCandidates: [], relationshipStrengthScore: 0 };
  const shortestPath = connectionGraph.shortestPathToDecisionMaker || { summary: 'No warm intro path mapped yet.', pathLength: 0 };
  const warmIntroCandidates = connectionGraph.warmIntroCandidates || [];
  const triggerAlerts = detail.account.triggerAlerts || [];
  const sequenceState = detail.account.sequenceState || { status: 'idle', nextStepLabel: 'Email', nextStepAt: null, adaptiveTimingReason: '', steps: [] };

  // Fetch hiring velocity in background (non-blocking)
  let hiringVelocity = [];
  try {
    const vData = await api(`/api/accounts/${accountId}/hiring-velocity`);
    if (vData.weeks) {
      hiringVelocity = Object.entries(vData.weeks).map(([label, count]) => ({ label, count }));
    }
  } catch(e) { /* non-critical */ }

  appRoot.innerHTML = `
    <section class="hero-card hero-card--dashboard">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Account detail</p>
          <h3>${escapeHtml(detail.account.displayName)}</h3>
          <p class="subtitle">${escapeHtml(targetScoreExplanation)}</p>
          <div class="button-row">
            ${detail.account.careersUrl ? `<a class="ghost-button" href="${escapeAttr(detail.account.careersUrl)}" target="_blank" rel="noreferrer">Open careers page</a>` : ''}
            ${detail.jobs[0]?.jobUrl || detail.jobs[0]?.url ? `<a class="ghost-button" href="${escapeAttr(detail.jobs[0].jobUrl || detail.jobs[0].url)}" target="_blank" rel="noreferrer">Open newest job</a>` : ''}
          </div>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Target score', formatNumber(targetScore))}
          ${renderMetricTile('Hiring velocity', formatNumber(detail.account.hiringVelocity || 0))}
          ${renderMetricTile('Engagement', formatNumber(detail.account.engagementScore || 0))}
          ${renderMetricTile('Jobs 30d', formatNumber(detail.account.jobsLast30Days || 0))}
          ${renderMetricTile('Jobs 90d', formatNumber(detail.account.jobsLast90Days || 0))}
        </div>
      </div>
      <div class="kpi-ribbon">
        ${renderStatusPill(detail.account.networkStrength, toneForNetwork(detail.account.networkStrength))}
        ${renderStatusPill(detail.account.hiringStatus, detail.account.jobCount > 0 ? 'success' : 'neutral')}
        ${renderStatusPill(detail.account.priority || 'medium', 'warm')}
        ${renderStatusPill(detail.account.status || 'new', 'neutral')}
        ${renderStatusPill(detail.account.outreachStatus || 'not_started', 'neutral')}
        ${detail.account.staleFlag ? renderStatusPill(detail.account.staleFlag, 'danger') : ''}
        ${(detail.account.atsTypes || []).map((item) => renderStatusPill(item, 'neutral')).join('')}
      </div>
    </section>

    <section class="metrics-grid metrics-grid--compact">
      ${renderMetricCard('Hiring spike', detail.account.hiringSpikeRatio || 0, `${formatNumber(detail.account.jobsLast30Days || 0)} jobs in 30d`)}
      ${renderMetricCard('External recruiter likelihood', detail.account.externalRecruiterLikelihoodScore || 0, 'Higher suggests more outsourced hiring motion')}
      ${renderMetricCard('Company growth signal', detail.account.companyGrowthSignalScore || 0, 'Momentum feeding the target score')}
      ${renderMetricCard('Avg role seniority', detail.account.avgRoleSeniorityScore || 0, 'Typical level of the current openings')}
    </section>

    <section class="action-zone">
      <div class="action-zone-col">
        <div class="detail-card" id="outreach-prompt-card">
          <div class="panel-header"><div><h3>Outreach & next moves</h3><p class="muted small">Generate a message, pick a contact, and take action.</p></div></div>
          <div class="outreach-controls outreach-controls--stacked">
            <select id="outreach-contact-select" class="inline-select">
              ${detail.contacts.length
                ? detail.contacts.map((c, i) => `<option value="${escapeAttr(c.fullName)}" data-title="${escapeAttr(c.title || '')}"${i === 0 ? ' selected' : ''}>${escapeHtml(c.fullName)}${c.title ? ' \u2014 ' + escapeHtml(c.title) : ''}</option>`).join('')
                : '<option value="">No contacts</option>'}
            </select>
            <select id="outreach-template-select" class="inline-select">
              <option value="cold" selected>Cold outreach</option>
              <option value="follow_up">Follow-up</option>
              <option value="re_engage">Re-engage</option>
              <option value="warm_intro">Warm intro</option>
            </select>
            <button class="secondary-button" data-action="generate-outreach" data-id="${detail.account.id}">Generate outreach</button>
          </div>
          <div id="outreach-prompt-body" class="empty-state empty-state--compact">${escapeHtml(detail.account.outreachDraft)}</div>
          <div class="next-action-bar">
            <div class="next-action-display">
              <strong>Next:</strong> <span>${escapeHtml(detail.account.nextAction || 'No next action set')}</span>
              ${detail.account.nextActionAt ? '<span class="small muted" style="margin-left:8px">' + formatDate(detail.account.nextActionAt) + '</span>' : ''}
            </div>
          </div>
          <form id="next-action-form" class="compact-activity-form" data-account-id="${detail.account.id}">
            <input name="nextAction" placeholder="Set the next move..." class="compact-input" value="${escapeAttr(detail.account.nextAction || '')}">
            <input name="nextActionAt" type="date" class="compact-input" value="${formatDateInput(detail.account.nextActionAt)}">
            <button class="secondary-button compact-btn" type="submit">Save next action</button>
          </form>
          <p class="small muted">You can update it here, or in Account controls further down the page.</p>
        </div>
      </div>

      <div class="action-zone-col">
        <div class="table-card">
          <div class="panel-header"><div><h3>Top contacts</h3><p class="muted small">Click a name to open LinkedIn, or click anywhere else on the row to select for outreach.</p></div></div>
          ${detail.contacts.length ? '<div class="table-scroll"><table class="table"><thead><tr><th>Contact</th><th>Title</th><th>Score</th><th>Connected</th></tr></thead><tbody>' +
            detail.contacts.map((c) => '<tr class="contact-row-selectable" data-contact-name="' + escapeAttr(c.fullName) + '" data-contact-title="' + escapeAttr(c.title || '') + '"><td>' + (() => { const linkedinHref = getContactLinkedInHref(c, detail.account.displayName); return linkedinHref ? '<a class="row-link" href="' + escapeAttr(linkedinHref) + '" target="_blank" rel="noreferrer"><strong>' + escapeHtml(c.fullName || '') + '</strong></a>' : '<strong>' + escapeHtml(c.fullName || '') + '</strong>'; })() + '</td><td>' + escapeHtml(c.title || '') + '</td><td>' + formatNumber(c.priorityScore) + '</td><td>' + formatDate(c.connectedOn) + '</td></tr>').join('') +
            '</tbody></table></div>' : '<div class="empty-state">No contacts imported yet.</div>'}
        </div>
      </div>

      <div class="action-zone-col">
        <div class="detail-card">
          <div class="panel-header"><div><h3>Activity & pipeline</h3><p class="muted small">Log outreach and track the conversation.</p></div></div>
          <form id="activity-form" class="compact-activity-form">
            <input type="hidden" name="accountId" value="${detail.account.id}">
            <input type="hidden" name="normalizedCompanyName" value="${escapeAttr(detail.account.normalizedName)}">
            <input name="summary" placeholder="Quick note..." class="compact-input">
            <select name="type" class="compact-select"><option value="note">Note</option><option value="outreach">Outreach</option><option value="pipeline">Pipeline</option></select>
            <select name="pipelineStage" class="compact-select"><option value="">No stage change</option>${renderOutreachStageOptions('')}</select>
            <button class="secondary-button compact-btn" type="submit">Log</button>
          </form>
          <div class="timeline" style="max-height:400px;overflow-y:auto;">
            ${detail.activity.length ? detail.activity.map(renderTimelineItem).join('') : '<div class="empty-state">No activity yet.</div>'}
          </div>
        </div>
      </div>
    </section>

    <section class="detail-grid detail-grid--workspace">
      <div class="panel-stack">
        <div class="detail-card">
          <div class="panel-header">
            <div><h3>Account controls</h3><p class="muted small">Manage ownership, outreach motion, and next steps.</p></div>
            <button class="ghost-button" data-action="archive-account" data-id="${detail.account.id}">Pause account</button>
          </div>
          <form id="account-edit-form" class="detail-form" data-account-id="${detail.account.id}">
            <div class="field-row-4">
              ${renderField('Status', renderAccountStatusSelect('status', detail.account.status))}
              ${renderField('Outreach stage', '<select name="outreachStatus">' + renderOutreachStageOptions(detail.account.outreachStatus) + '</select>')}
              ${renderField('Priority', renderPrioritySelect('priority', detail.account.priority || 'medium'))}
              ${renderField('Owner', renderOwnerSelect('owner', detail.account.owner || ''))}
            </div>
            ${renderField('Next action', '<input name="nextAction" value="' + escapeAttr(detail.account.nextAction || '') + '" placeholder="Reach out to VP Talent">')}
            ${renderField('Next action date', '<input name="nextActionAt" type="date" value="' + formatDateInput(detail.account.nextActionAt) + '">')}
            ${renderField('Domain', '<input name="domain" value="' + escapeAttr(detail.account.domain || '') + '" placeholder="company.com">')}
            ${renderField('Careers URL', '<input name="careersUrl" value="' + escapeAttr(detail.account.careersUrl || '') + '" placeholder="https://company.com/careers">')}
            ${renderField('Location', '<input name="location" value="' + escapeAttr(detail.account.location || '') + '">')}
            ${renderField('Industry', '<input name="industry" value="' + escapeAttr(detail.account.industry || '') + '">')}
            ${renderField('Tags', '<input name="tags" value="' + escapeAttr((detail.account.tags || []).join(', ')) + '" placeholder="fintech, warm intro, canada">')}
            <div class="field field--wide"><label>Notes</label><textarea name="notes" rows="4">${escapeHtml(detail.account.notes || '')}</textarea></div>
            <div><button class="primary-button" type="submit">Save account updates</button></div>
          </form>
        </div>
      </div>

      <div class="panel-stack">
        <div class="detail-card">
          <div class="panel-header"><div><h3>Target score drivers</h3><p class="muted small">Why this company is ranked where it is.</p></div></div>
          <div class="empty-state empty-state--compact" style="margin-bottom:12px;">${escapeHtml(targetScoreExplanation)}</div>
          <div class="kpi-ribbon">
            ${renderMetricTile('Target score', formatNumber(targetScore))}
            ${renderMetricTile('Open roles', formatNumber(detail.account.openRoleCount || detail.account.jobCount))}
            ${renderMetricTile('Hiring velocity', formatNumber(detail.account.hiringVelocity || 0))}
            ${renderMetricTile('Engagement', formatNumber(detail.account.engagementScore || 0))}
          </div>
          ${hiringVelocity.length ? `
          <div class="velocity-chart">
            <p class="small muted" style="margin:8px 0 4px;">Hiring velocity (4-week trend)</p>
            <div class="velocity-bars">
              ${(() => {
                const maxCount = Math.max(1, ...hiringVelocity.map(b => b.count || 0));
                return hiringVelocity.map(v => {
                  const pct = Math.round(((v.count || 0) / maxCount) * 100);
                  return '<div class="velocity-bar-group"><div class="velocity-bar" style="height:' + Math.max(pct, 5) + '%"><span class="velocity-count">' + (v.count || 0) + '</span></div><span class="velocity-label small muted">' + escapeHtml(v.label || '') + '</span></div>';
                }).join('');
              })()}
            </div>
          </div>` : ''}
          <div class="timeline">
            ${[
              ['Jobs 30d', detail.account.jobsLast30Days || 0, `${formatNumber(detail.account.jobsLast90Days || 0)} jobs / 90d`],
              ['Hiring spike', detail.account.hiringSpikeRatio || 0, `External recruiter ${formatNumber(detail.account.externalRecruiterLikelihoodScore || 0)}`],
              ['Growth signal', detail.account.companyGrowthSignalScore || 0, `Avg role seniority ${formatNumber(detail.account.avgRoleSeniorityScore || 0)}`],
            ].map(([label, value, meta]) => '<article class="timeline-item"><div class="inline-header"><strong>' + escapeHtml(label) + '</strong><span class="small muted">' + formatNumber(value) + '</span></div><p class="small muted">' + escapeHtml(meta) + '</p></article>').join('')}
          </div>
        </div>

        <div class="detail-card">
          <div class="panel-header"><div><h3>Connection graph & triggers</h3><p class="muted small">Warm paths, live alerts, and the next sequence move for this account.</p></div></div>
          <div class="timeline">
            <article class="timeline-item">
              <div class="inline-header"><strong>Shortest path to decision maker</strong><span class="small muted">${formatNumber(shortestPath.pathLength || 0)} hop${(shortestPath.pathLength || 0) === 1 ? '' : 's'}</span></div>
              <p class="small muted">${escapeHtml(shortestPath.summary || 'No warm intro path mapped yet.')}</p>
            </article>
            <article class="timeline-item">
              <div class="inline-header"><strong>Sequence status</strong><span class="small muted">${escapeHtml(humanize(sequenceState.status || 'idle'))}</span></div>
              <p class="small muted">${escapeHtml(sequenceState.nextStepLabel ? `${sequenceState.nextStepLabel}${sequenceState.nextStepAt ? ` due ${formatDate(sequenceState.nextStepAt)}` : ''}` : 'Sequence is paused until the account moves again.')}</p>
              ${sequenceState.adaptiveTimingReason ? `<p class="small muted">${escapeHtml(sequenceState.adaptiveTimingReason)}</p>` : ''}
            </article>
            ${triggerAlerts.length ? triggerAlerts.slice(0, 3).map((alert) => `
              <article class="timeline-item">
                <div class="inline-header"><strong>${escapeHtml(alert.title || humanize(alert.type || 'Alert'))}</strong><span class="small muted">${formatNumber(alert.priorityScore || 0)}</span></div>
                <p class="small muted">${escapeHtml(alert.summary || '')}</p>
                ${alert.recommendedAction ? `<p>${escapeHtml(alert.recommendedAction)}</p>` : ''}
              </article>
            `).join('') : '<div class="empty-state empty-state--compact">No live trigger alerts on this account yet.</div>'}
          </div>
          ${warmIntroCandidates.length ? `
            <div class="table-scroll" style="margin-top:12px;">
              <table class="table">
                <thead><tr><th>Warm intro</th><th>Title</th><th>Relationship</th><th>Path</th></tr></thead>
                <tbody>
                  ${warmIntroCandidates.slice(0, 5).map((candidate) => `
                    <tr>
                      <td><strong>${escapeHtml(candidate.fullName || '')}</strong><div class="small muted">${escapeHtml(candidate.why || '')}</div></td>
                      <td>${escapeHtml(candidate.title || '')}</td>
                      <td>${formatNumber(candidate.relationshipStrengthScore || 0)}</td>
                      <td>${escapeHtml(candidate.introPath || '')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}
        </div>

        <div class="table-card">
          <div class="panel-header"><div><h3>Imported jobs</h3><p class="muted small">Recent hiring context tied directly to this company.</p></div></div>
          ${detail.jobs.length ? renderAccountJobsTable(detail.jobs) : '<div class="empty-state">No jobs connected to this account yet.</div>'}
        </div>

        <div class="table-card">
          <div class="panel-header"><div><h3>ATS configs</h3><p class="muted small">Discovery results and import sources.</p></div></div>
          ${detail.configs.length ? renderAccountConfigsTable(detail.configs) : '<div class="empty-state">No ATS config rows for this account yet.</div>'}
        </div>
      </div>
    </section>
  `;
}
async function renderContactsView() {
  renderLoadingState('Contacts', 'Loading relationship intelligence...');
  setViewTitle('Contacts');
  const result = await api(`/api/contacts${buildQuery(appState.contactQuery)}`);

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Relationship intelligence</p>
          <h3>Prioritized contacts</h3>
          <p class="subtitle">Your network ranked by relevance, title strength, and company overlap so you can route outreach through the best people first.</p>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Results', formatNumber(result.total))}
          ${renderMetricTile('Page', formatNumber(result.page))}
          ${renderMetricTile('Page size', formatNumber(result.pageSize))}
        </div>
      </div>
    </section>

    <section class="table-card">
      <div class="panel-header"><div><h3>Contact intelligence</h3><p class="muted small">Your network ranked by company overlap and title relevance.</p></div></div>
      <form id="contacts-filter-form" class="filter-grid filter-grid--compact">
        ${renderField('Search', `<input name="q" value="${escapeAttr(appState.contactQuery.q)}" placeholder="Name, company, title">`)}
        ${renderField('Min score', `<input name="minScore" type="number" min="0" value="${escapeAttr(appState.contactQuery.minScore)}">`)}
        ${renderField('Outreach', `<select name="outreachStatus"><option value="">Any stage</option><option value="not_started" ${selected(appState.contactQuery.outreachStatus, 'not_started')}>Not started</option><option value="researching" ${selected(appState.contactQuery.outreachStatus, 'researching')}>Researching</option><option value="ready_to_contact" ${selected(appState.contactQuery.outreachStatus, 'ready_to_contact')}>Ready to contact</option><option value="contacted" ${selected(appState.contactQuery.outreachStatus, 'contacted')}>Contacted</option><option value="replied" ${selected(appState.contactQuery.outreachStatus, 'replied')}>Replied</option><option value="opportunity" ${selected(appState.contactQuery.outreachStatus, 'opportunity')}>Opportunity</option></select>`)}
        <div class="field field--action"><label>Refresh queue</label><button class="primary-button" type="submit">Apply filters</button></div>
      </form>
      ${result.items.length ? renderContactsTable(result.items) : '<div class="empty-state">No contacts match the current filters.</div>'}
      ${renderPagination('contacts', result.page, result.pageSize, result.total)}
    </section>
  `;
}

async function renderJobsView() {
  renderLoadingState('Jobs', 'Loading job activity...');
  setViewTitle('Jobs');
  const stateBootstrap = await loadBootstrap(false, { includeFilters: true });
  const result = await api(`/api/jobs${buildQuery(appState.jobQuery)}`);
  const atsOptions = stateBootstrap.filters?.atsTypes || [];

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Hiring feed</p>
          <h3>Imported job activity</h3>
          <p class="subtitle">Normalized open roles from supported ATS boards, deduped and ready to use as outreach context.</p>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Results', formatNumber(result.total))}
          ${renderMetricTile('New this sync', formatNumber(result.items.filter((item) => item.isNew).length))}
          ${renderMetricTile('Page size', formatNumber(result.pageSize))}
        </div>
      </div>
    </section>

    <section class="table-card">
      <div class="panel-header"><div><h3>Imported jobs</h3><p class="muted small">Use filters to isolate the freshest demand signals by company, ATS, and recency.</p></div></div>
      <form id="jobs-filter-form" class="filter-grid filter-grid--compact">
        ${renderField('Search', `<input name="q" value="${escapeAttr(appState.jobQuery.q)}" placeholder="Role, company, location">`)}
        ${renderField('ATS', `<select name="ats"><option value="">All ATS</option>${atsOptions.map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.jobQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
        ${renderField('Recency', `<select name="recencyDays"><option value="">Any</option><option value="7" ${selected(appState.jobQuery.recencyDays, '7')}>Last 7 days</option><option value="14" ${selected(appState.jobQuery.recencyDays, '14')}>Last 14 days</option><option value="30" ${selected(appState.jobQuery.recencyDays, '30')}>Last 30 days</option></select>`)}
        ${renderField('Active', `<select name="active"><option value="">All</option><option value="true" ${selected(appState.jobQuery.active, 'true')}>Active only</option><option value="false" ${selected(appState.jobQuery.active, 'false')}>Inactive only</option></select>`)}
        ${renderField('New jobs', `<select name="isNew"><option value="">All</option><option value="true" ${selected(appState.jobQuery.isNew, 'true')}>New this sync</option><option value="false" ${selected(appState.jobQuery.isNew, 'false')}>Existing</option></select>`)}
        ${renderField('Sort by', `<select name="sortBy"><option value="">Posted date</option><option value="retrieved" ${selected(appState.jobQuery.sortBy, 'retrieved')}>Retrieved date</option></select>`)}
        <div class="field field--action"><label>Refresh queue</label><button class="primary-button" type="submit">Apply filters</button></div>
      </form>
      ${result.items.length ? renderJobsTable(result.items) : '<div class="empty-state">No jobs match the current filter set.</div>'}
      ${renderPagination('jobs', result.page, result.pageSize, result.total)}
    </section>
  `;
}

async function renderAdminView() {
  renderLoadingState('Admin', 'Loading pipeline controls...');
  setViewTitle('Admin');
  const batchQuery = {};
  const cq = appState.configQuery;
  if (cq.page) batchQuery.configPage = cq.page;
  if (cq.pageSize) batchQuery.configPageSize = cq.pageSize;
  if (cq.q) batchQuery.configQ = cq.q;
  if (cq.ats) batchQuery.configAts = cq.ats;
  if (cq.active) batchQuery.configActive = cq.active;
  if (cq.discoveryStatus) batchQuery.configDiscoveryStatus = cq.discoveryStatus;
  if (cq.confidenceBand) batchQuery.configConfidenceBand = cq.confidenceBand;
  if (cq.reviewStatus) batchQuery.configReviewStatus = cq.reviewStatus;
  const eq = appState.enrichmentQuery;
  if (eq.page) batchQuery.enrichmentPage = eq.page;
  if (eq.pageSize) batchQuery.enrichmentPageSize = eq.pageSize;
  if (eq.confidence) batchQuery.enrichmentConfidence = eq.confidence;
  if (eq.missingDomain) batchQuery.enrichmentMissingDomain = eq.missingDomain;
  if (eq.missingCareersUrl) batchQuery.enrichmentMissingCareersUrl = eq.missingCareersUrl;
  if (eq.hasConnections) batchQuery.enrichmentHasConnections = eq.hasConnections;
  if (eq.minTargetScore) batchQuery.enrichmentMinTargetScore = eq.minTargetScore;
  if (eq.topN) batchQuery.enrichmentTopN = eq.topN;
  const batch = await api(`/api/admin/bootstrap${buildQuery(batchQuery)}`);
  const stateBootstrap = batch.bootstrap;
  appState.bootstrap = { ...(appState.bootstrap || {}), ...stateBootstrap };
  workspaceName.textContent = stateBootstrap?.workspace?.name || 'BD Engine Workspace';
  window.bdLocalApi.setAlert('', appAlert);
  const configs = batch.configs;
  const runtime = batch.runtime;
  appState.runtimeStatus = runtime;
  const targetScoreRollout = batch.targetScoreRollout || {};
  appState.targetScoreRollout = targetScoreRollout;
  const resolverReport = batch.resolverReport;
  const enrichmentReport = batch.enrichmentReport;
  const unresolvedQueue = batch.unresolvedQueue;
  const mediumQueue = batch.mediumQueue;
  const enrichmentQueue = batch.enrichmentQueue;
  const rolloutRemainingCount = Number(targetScoreRollout.remainingCount || 0);
  const rolloutActive = Boolean(targetScoreRollout.hasActiveJob);
  const rolloutButtonLabel = rolloutActive ? 'Monitor rollout' : (rolloutRemainingCount > 0 ? 'Run rollout' : 'No rollout needed');
  const rolloutHint = rolloutActive
    ? (targetScoreRollout.activeJobProgressMessage || 'A rollout job is already draining the backlog in the background worker.')
    : (rolloutRemainingCount > 0
      ? 'Run partial batches through the worker so the remaining intelligence backfill does not block startup.'
      : 'The target-score intelligence backlog is fully caught up.');
  const summary = resolverReport.summary || {};
  const enrichmentSummary = enrichmentReport.summary || {};
  const reviewQueueCount = (summary.mediumReviewQueueCount || 0) + (summary.unresolvedReviewQueueCount || 0);
  const adminStory = [
    {
      label: 'Coverage',
      value: `${formatNumber(summary.coveragePercent || 0)}%`,
      description: `${formatNumber(summary.resolvedCount || 0)} resolved boards out of ${formatNumber(summary.totalCompanies || 0)} tracked companies.`,
      tone: 'success',
    },
    {
      label: 'Review queue',
      value: `${formatNumber(reviewQueueCount)} items`,
      description: 'Medium-confidence results and unresolved companies stay visible for operator review.',
      tone: 'warning',
    },
    {
      label: 'Runtime pulse',
      value: `${formatNumber(runtime.runningJobs || 0)} running`,
      description: `${formatNumber(runtime.queuedJobs || 0)} queued jobs are waiting for the worker.`,
      tone: 'accent',
    },
    {
      label: 'Score rollout',
      value: rolloutActive ? 'Worker active' : `${formatNumber(rolloutRemainingCount)} pending`,
      description: rolloutHint,
      tone: rolloutActive ? 'accent' : (rolloutRemainingCount > 0 ? 'warning' : 'success'),
    },
  ];

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Pipeline operations</p>
          <h3>Admin and automation controls</h3>
          <p class="subtitle">Run discovery, import jobs, manage ATS resolution quality, and keep the outreach engine moving without falling back to the spreadsheet.</p>
          <div class="hero-signal-strip">
            ${renderSignalChip('Coverage', `${formatNumber(summary.coveragePercent || 0)}%`, 'success')}
            ${renderSignalChip('Needs review', formatNumber((summary.mediumReviewQueueCount || 0) + (summary.unresolvedReviewQueueCount || 0)), 'warning')}
            ${renderSignalChip('Jobs running', formatNumber(runtime.runningJobs || 0), 'accent')}
            ${renderSignalChip('Jobs queued', formatNumber(runtime.queuedJobs || 0), 'neutral')}
            ${renderSignalChip('Score backlog', rolloutActive ? 'Worker active' : formatNumber(rolloutRemainingCount), rolloutActive ? 'accent' : (rolloutRemainingCount > 0 ? 'warning' : 'success'))}
          </div>
          <div class="story-strip">
            ${adminStory.map((item) => renderStoryCard(item.label, item.value, item.description, item.tone)).join('')}
          </div>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Coverage', `${formatNumber(summary.coveragePercent || 0)}%`)}
          ${renderMetricTile('Resolved', formatNumber(summary.resolvedCount || 0))}
          ${renderMetricTile('Enriched', `${formatNumber(enrichmentSummary.enrichmentCoveragePercent || 0)}%`)}
          ${renderMetricTile('Needs review', formatNumber((summary.mediumReviewQueueCount || 0) + (summary.unresolvedReviewQueueCount || 0)))}
          ${renderMetricTile('Jobs running', formatNumber(runtime.runningJobs || 0))}
        </div>
      </div>
      <div class="runtime-banner">
        <div class="runtime-banner-copy">
          <p class="eyebrow">Live pulse</p>
          <h4>${runtime.workerRunning ? 'Worker online and draining the queue' : 'Worker idle and waiting for new work'}</h4>
          <p class="small muted">${runtime.workerRunning ? `Worker PID ${runtime.workerPid || 'unknown'} is handling ${formatNumber(runtime.runningJobs || 0)} running job${(runtime.runningJobs || 0) === 1 ? '' : 's'} and ${formatNumber(runtime.queuedJobs || 0)} queued job${(runtime.queuedJobs || 0) === 1 ? '' : 's'}.` : 'No job processor is active yet. Queue a task to wake it up.'}</p>
        </div>
        <div class="runtime-banner-flags">
          ${renderStatusPill(runtime.warmed ? 'Server warm' : 'Server starting', runtime.warmed ? 'success' : 'warning')}
          ${renderStatusPill(runtime.workerRunning ? 'Queue draining' : 'Queue idle', runtime.workerRunning ? 'hot' : 'neutral')}
          ${renderStatusPill(runtime.runningJobs > 0 ? `${formatNumber(runtime.runningJobs)} active` : 'No active jobs', runtime.runningJobs > 0 ? 'warm' : 'neutral')}
        </div>
      </div>
    </section>

    <section class="trust-strip trust-strip--admin">
      ${renderTrustCard('Operator guide', 'One control surface', 'Run discovery, import, and review coverage without falling back to the spreadsheet.', `${formatNumber(runtime.queuedJobs || 0)} jobs queued`, 'accent')}
      ${renderTrustCard('Coverage report', `${formatNumber(summary.coveragePercent || 0)}% board coverage`, 'See how much of the tracked universe is resolved and where review is still needed.', `${formatNumber(summary.resolvedCount || 0)} resolved boards`, 'success')}
      ${renderTrustCard('Review queue', `${formatNumber(reviewQueueCount)} items to inspect`, 'Medium-confidence and unresolved configs stay visible instead of disappearing into logs.', `${formatNumber(enrichmentQueue.total || 0)} enrichment candidates`, 'warning')}
    </section>

    <section class="admin-grid">
      <div class="two-column">
        <div class="form-card">
          <div class="panel-header"><div><h3>Company enrichment coverage</h3><p class="muted small">Canonical domains, careers pages, aliases, and identity confidence feeding the resolver.</p></div></div>
          <div class="metrics-grid metrics-grid--compact">
            ${renderMetricCard('Canonical domains', enrichmentSummary.canonicalDomainCount || 0, 'Companies with an official domain stored')}
            ${renderMetricCard('Careers URLs', enrichmentSummary.careersUrlCount || 0, 'Companies with a verified careers endpoint')}
            ${renderMetricCard('Aliases', enrichmentSummary.aliasesCount || 0, 'Companies with stored brand variants')}
            ${renderMetricCard('Enriched companies', enrichmentSummary.enrichedCount || 0, `${formatNumber(enrichmentSummary.enrichmentCoveragePercent || 0)}% coverage`) }
          </div>
          <div class="inline-split">
            <div>
              <p class="eyebrow">Confidence mix</p>
              ${renderMiniStatList((enrichmentReport.byConfidence || []).map((item) => ({ label: humanize(item.confidence), value: formatNumber(item.count) })))}
            </div>
            <div>
              <p class="eyebrow">Top unresolved reasons</p>
              ${renderMiniStatList((enrichmentReport.topUnresolvedReasons || []).map((item) => ({ label: item.reason, value: formatNumber(item.count) })))}
            </div>
          </div>
          <div class="inline-split">
            <div>
              <p class="eyebrow">Resolution coverage by enrichment</p>
              ${renderMiniStatList((enrichmentReport.resolutionByEnrichmentPresence || []).map((item) => ({ label: `${humanize(item.enrichmentPresence)} (${formatNumber(item.totalCompanies)})`, value: `${formatNumber(item.coveragePercent)}%` })))}
            </div>
            <div>
              <p class="eyebrow">Enrichment sources</p>
              ${renderMiniStatList((enrichmentReport.bySource || []).slice(0, 6).map((item) => ({ label: humanize(item.source), value: formatNumber(item.count) })))}
            </div>
          </div>
        </div>

        <div class="form-card" id="enrichment-queue-panel">
          <div class="panel-header"><div><h3>Enrichment review queue</h3><p class="muted small">Sorted by target score, then hiring velocity, then engagement. ${formatNumber(enrichmentQueue.total || 0)} companies in queue.</p></div></div>
          ${renderEnrichmentFilters()}
          ${renderEnrichmentQueuePanel(enrichmentQueue)}
        </div>
      </div>

      <div class="two-column">
        <div class="form-card">
          <div class="panel-header"><div><h3>Resolver coverage</h3><p class="muted small">Coverage, confidence mix, and failure reasons for ATS resolution across the tracked company set.</p></div></div>
          <div class="metrics-grid metrics-grid--compact">
            ${renderMetricCard('Tracked companies', summary.totalCompanies || 0, 'Board config rows in the resolver')}
            ${renderMetricCard('Resolved boards', summary.resolvedCount || 0, `${formatNumber(summary.coveragePercent || 0)}% of total coverage`)}
            ${renderMetricCard('Active imports', summary.activeCount || 0, 'High-confidence boards auto-enabled')}
            ${renderMetricCard('Unresolved', summary.unresolvedCount || 0, 'Still missing strong ATS evidence')}
          </div>
          <div class="inline-split">
            <div>
              <p class="eyebrow">Confidence mix</p>
              ${renderMiniStatList((resolverReport.byConfidenceBand || []).map((item) => ({ label: humanize(item.confidenceBand), value: formatNumber(item.count) })))}
            </div>
            <div>
              <p class="eyebrow">Top failure reasons</p>
              ${renderMiniStatList((resolverReport.topFailureReasons || []).map((item) => ({ label: item.failureReason, value: formatNumber(item.count) })))}
            </div>
          </div>
        </div>

        <div class="form-card">
          <div class="panel-header"><div><h3>Review queues</h3><p class="muted small">Only high-confidence boards auto-activate. Medium-confidence results and unresolved companies land here for fast review.</p></div></div>
          <div class="panel-stack">
            <div>
              <div class="inline-header"><strong>Medium-confidence queue</strong><span class="small muted">${formatNumber(summary.mediumReviewQueueCount || 0)} pending</span></div>
              ${mediumQueue.items.length ? renderResolverQueue(mediumQueue.items, 'medium') : '<div class="empty-state empty-state--compact">No medium-confidence configs need review right now.</div>'}
            </div>
            <div>
              <div class="inline-header"><strong>Unresolved queue</strong><span class="small muted">${formatNumber(summary.unresolvedReviewQueueCount || 0)} pending</span></div>
              ${unresolvedQueue.items.length ? renderResolverQueue(unresolvedQueue.items, 'unresolved') : '<div class="empty-state empty-state--compact">No unresolved configs are waiting in the queue.</div>'}
            </div>
          </div>
        </div>
      </div>

      <div class="two-column">
        <div class="form-card">
          <div class="panel-header"><div><h3>Runtime status</h3><p class="muted small">See whether the server is warm and whether background jobs are queued or running.</p></div></div>
          <div id="runtime-status-panel"></div>
        </div>
        <div class="form-card">
          <div class="panel-header"><div><h3>Background jobs</h3><p class="muted small">Long-running imports, discovery, and sheet syncs now run out of band.</p></div></div>
          <div id="background-jobs-panel" class="timeline timeline--jobs"></div>
        </div>
      </div>

      <div class="two-column">
        <div class="form-card">
          <div class="panel-header"><div><h3>Pipeline operations</h3><p class="muted small">Run discovery, import jobs, or reseed the app without touching the spreadsheet manually.</p></div></div>
          <div class="actions-grid">
            <div class="action-card">
              <p class="eyebrow">Full pipeline</p>
              <h4>Run BD Engine</h4>
              <p class="small muted">Runs connections import, config sync, job fetch, scoring, and Google Sheet export in one pass.</p>
              <button class="primary-button" data-action="run-full-engine">Run Full Engine</button>
            </div>
            <div class="action-card">
              <p class="eyebrow">Identity enrichment</p>
              <h4>Enrich company inputs</h4>
              <p class="small muted">Find canonical domains, careers URLs, aliases, and verified company identity evidence before ATS resolution runs.</p>
              <div class="inline-field-stack">
                <input id="enrichment-limit" type="number" min="1" value="50" placeholder="Companies to enrich">
                <label class="field"><span class="small muted">Force refresh</span><select id="enrichment-force-refresh"><option value="false" selected>No</option><option value="true">Yes</option></select></label>
                <div class="button-row">
                  <button class="secondary-button" type="button" data-action="run-enrichment">Run enrichment</button>
                </div>
              </div>
            </div>
            <div class="action-card">
              <p class="eyebrow">Intelligence rollout</p>
              <h4>Repair target scoring backlog</h4>
              <p class="small muted">${formatNumber(rolloutRemainingCount)} accounts still need the new target score, trigger, sequence, or connection-graph intelligence fields. ${rolloutHint}</p>
              <div class="inline-field-stack">
                <input id="target-score-rollout-limit" type="number" min="1" max="500" value="${escapeAttr(String(targetScoreRollout.defaultLimit || 150))}" placeholder="Accounts per batch">
                <label class="field"><span class="small muted">Batches</span><input id="target-score-rollout-batches" type="number" min="1" max="25" value="${escapeAttr(String(targetScoreRollout.defaultMaxBatches || 6))}"></label>
                <div class="button-row">
                  <button class="primary-button" type="button" data-action="run-target-score-rollout"${(!rolloutActive && rolloutRemainingCount <= 0) ? ' disabled' : ''}>${rolloutButtonLabel}</button>
                </div>
              </div>
            </div>
            <div class="action-card">
              <p class="eyebrow">ATS discovery</p>
              <h4>Discover supported boards</h4>
              <p class="small muted">Runs the staged resolver: known mappings, hosted ATS probes, and careers-page detection with diagnostics and confidence bands.</p>
              <div class="inline-field-stack">
                <input id="discovery-limit" type="number" min="1" value="75" placeholder="Rows to check">
                <label class="field"><span class="small muted">Only unresolved configs</span><select id="discovery-only-missing"><option value="true" selected>Yes</option><option value="false">No</option></select></label>
                <label class="field"><span class="small muted">Force refresh</span><select id="discovery-force-refresh"><option value="false" selected>No</option><option value="true">Yes</option></select></label>
                <div class="button-row">
                  <button class="secondary-button" type="button" data-action="run-discovery">Run discovery</button>
                </div>
              </div>
            </div>
            <div class="action-card">
              <p class="eyebrow">Live ATS sync</p>
              <h4>Run job import</h4>
              <p class="small muted">Fetches jobs from active ATS configs, upserts them, and marks closed roles inactive on repeat runs.</p>
              <button class="secondary-button" data-action="run-live-import">Run live import</button>
            </div>
            <div class="action-card">
              <p class="eyebrow">Config generation</p>
              <h4>Rebuild job board configs</h4>
              <p class="small muted">Seeds config rows from target accounts and preserves manual edits instead of guessing blindly.</p>
              <button class="secondary-button" data-action="sync-configs">Rebuild configs</button>
            </div>
            <div class="action-card">
              <p class="eyebrow">Spreadsheet seed</p>
              <h4>Reimport workbook</h4>
              <p class="small muted">Reads setup, contacts, jobs, configs, and history from the legacy workbook when you need a reseed.</p>
              <button class="primary-button" data-action="reseed-workbook" data-path="${escapeAttr(stateBootstrap.defaults.workbookPath)}">Reimport workbook</button>
            </div>
            <div class="action-card">
              <p class="eyebrow">Google Sheets</p>
              <h4>Sync to live sheet</h4>
              <p class="small muted">Pushes the current app state back to the live Google Sheet while you transition off the spreadsheet workflow.</p>
              <div class="inline-field-stack">
                <input id="google-sheet-id" value="${escapeAttr(stateBootstrap.defaults.spreadsheetId || '')}" placeholder="Spreadsheet ID">
                <div class="button-row">
                  <button class="primary-button" type="button" data-action="sync-google-sheets">Sync Google Sheet</button>
                </div>
              </div>
            </div>
            <div class="action-card">
              <p class="eyebrow">LinkedIn import</p>
              <h4>Connections CSV</h4>
              <p class="small muted">Validate or import a LinkedIn Connections.csv file. Dry run stays in memory and does not modify local state.</p>
              <div class="inline-field-stack">
                <input type="hidden" id="connections-csv-path" value="${escapeAttr(stateBootstrap.defaults.connectionsCsvPath || '')}">
                <input type="file" id="connections-csv-file" accept=".csv">
                <div class="button-row">
                  <button class="secondary-button" type="button" data-action="dry-run-connections-csv">Dry run CSV</button>
                  <button class="ghost-button" type="button" data-action="import-connections-csv">Import CSV</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="form-card">
          <div class="panel-header"><div><h3>Scoring settings</h3><p class="muted small">These map directly to the old Setup controls.</p></div></div>
          <form id="settings-form" class="settings-grid">
            ${renderField('Min company connections', `<input name="minCompanyConnections" type="number" min="0" value="${escapeAttr(stateBootstrap.settings.minCompanyConnections)}">`)}
            ${renderField('Min jobs posted', `<input name="minJobsPosted" type="number" min="0" value="${escapeAttr(stateBootstrap.settings.minJobsPosted)}">`)}
            ${renderField('Contact priority threshold', `<input name="contactPriorityThreshold" type="number" min="0" value="${escapeAttr(stateBootstrap.settings.contactPriorityThreshold)}">`)}
            ${renderField('Max companies to review', `<input name="maxCompaniesToReview" type="number" min="1" value="${escapeAttr(stateBootstrap.settings.maxCompaniesToReview)}">`)}
            ${renderField('Geography focus', `<input name="geographyFocus" value="${escapeAttr(stateBootstrap.settings.geographyFocus)}">`)}
            ${renderField('GTA priority', `<select name="gtaPriority"><option value="true" ${selected(String(stateBootstrap.settings.gtaPriority), 'true')}>Enabled</option><option value="false" ${selected(String(stateBootstrap.settings.gtaPriority), 'false')}>Disabled</option></select>`)}
            <div><button class="primary-button" type="submit">Save settings</button></div>
          </form>
        </div>
      </div>

      <div class="two-column">
        <div class="form-card">
          <div class="panel-header"><div><h3>${appState.configEditingId ? 'Edit ATS config' : 'Add ATS config'}</h3><p class="muted small">Admin-managed job board records replace hardcoded spreadsheet helpers.</p></div>${appState.configEditingId ? '<button class="ghost-button" data-action="new-config">Clear form</button>' : ''}</div>
          <form id="config-form" class="detail-form">
            ${renderField('Company', '<input name="companyName" required>')}
            ${renderField('ATS type', '<select name="atsType"><option value="">Unknown</option><option value="greenhouse">greenhouse</option><option value="lever">lever</option><option value="ashby">ashby</option><option value="smartrecruiters">smartrecruiters</option><option value="workday">workday</option><option value="jobvite">jobvite</option><option value="icims">icims</option><option value="taleo">taleo</option></select>')}
            ${renderField('Board ID', '<input name="boardId">')}
            ${renderField('Domain', '<input name="domain">')}
            ${renderField('Careers URL', '<input name="careersUrl">')}
            ${renderField('Source', '<input name="source">')}
            ${renderField('Active', '<select name="active"><option value="true">Active</option><option value="false">Inactive</option></select>')}
            <div class="field" style="grid-column: 1 / -1;"><label>Notes</label><textarea name="notes" rows="4"></textarea></div>
            <div><button class="primary-button" type="submit">${appState.configEditingId ? 'Save config' : 'Create config'}</button></div>
          </form>
        </div>

        <div class="table-card">
          <div class="panel-header"><div><h3>ATS config records</h3><p class="muted small">Discovery results, manual overrides, and live import status for every tracked company.</p></div></div>
          <form id="configs-filter-form" class="filter-grid filter-grid--compact">
            ${renderField('Search', `<input name="q" value="${escapeAttr(appState.configQuery.q)}" placeholder="Company, board ID, URL">`)}
            ${renderField('ATS', `<select name="ats"><option value="">All</option>${(stateBootstrap.filters.atsTypes || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
            ${renderField('Discovery', `<select name="discoveryStatus"><option value="">All</option>${(stateBootstrap.filters.configDiscoveryStatuses || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.discoveryStatus, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Confidence', `<select name="confidenceBand"><option value="">All</option>${(stateBootstrap.filters.configConfidenceBands || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.confidenceBand, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Review', `<select name="reviewStatus"><option value="">All</option>${(stateBootstrap.filters.configReviewStatuses || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.reviewStatus, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Active', `<select name="active"><option value="">All</option><option value="true" ${selected(appState.configQuery.active, 'true')}>Active</option><option value="false" ${selected(appState.configQuery.active, 'false')}>Inactive</option></select>`)}
            <div class="field field--action"><label>Refresh queue</label><button class="primary-button" type="submit">Apply filters</button></div>
          </form>
          ${configs.items.length ? renderConfigsTable(configs.items) : '<div class="empty-state">No config rows match the current filters.</div>'}
          ${renderPagination('configs', configs.page, configs.pageSize, configs.total)}
        </div>
      </div>
    </section>
  `;

  if (appState.configEditingId) {
    populateConfigForm(appState.configEditingId);
  } else {
    resetConfigForm();
  }

  hydrateAdminRuntimePanels(runtime);
}
function renderTodayQueueTable(items) {
  return `
    <div class="table-scroll"><table class="table"><thead><tr><th>Company</th><th>Target score</th><th>Hiring velocity</th><th>Engagement</th><th>Network</th><th>Next move</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td><a class="row-link" href="#/accounts/${item.id}">${escapeHtml(item.displayName)}</a><div class="small muted">${escapeHtml(item.topContactName || item.domain || '')}</div><div class="small muted">${escapeHtml(renderTargetScoreSignalSummary(item))}</div></td>
          <td>${formatNumber(getTargetScore(item))}<div class="small muted">${escapeHtml(getTargetScoreExplanation(item) || humanize(item.priority || 'medium'))}</div></td>
          <td>${formatNumber(item.hiringVelocity || 0)}<div class="small muted">${formatNumber(item.jobsLast30Days || 0)} jobs / 30d</div></td>
          <td>${formatNumber(item.engagementScore || 0)}<div class="small muted">${formatNumber(item.jobsLast90Days || 0)} jobs / 90d</div></td>
          <td>${renderStatusPill(item.networkStrength, toneForNetwork(item.networkStrength))}<div class="small muted">${formatNumber(item.companyGrowthSignalScore || 0)} growth</div></td>
          <td>${escapeHtml(item.nextAction || item.recommendedAction || '')}</td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderRecentJobsTable(items) {
  return renderJobsTable(items.slice(0, 12), true);
}

function renderAccountsTable(items) {
  return `
    <div id="bulk-action-bar" class="bulk-action-bar hidden">
      <span id="bulk-count">0 selected</span>
      <select id="bulk-status"><option value="">Change status...</option><option value="new">New</option><option value="researching">Researching</option><option value="outreach">Outreach</option><option value="engaged">Engaged</option><option value="client">Client</option><option value="paused">Paused</option></select>
      <select id="bulk-priority"><option value="">Change priority...</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      <button class="secondary-button" data-action="apply-bulk-update">Apply</button>
    </div>
    <div class="table-scroll"><table class="table"><thead><tr><th><input type="checkbox" id="bulk-select-all"></th><th>Company</th><th>Target score</th><th>Signal mix</th><th>Owner / next step</th><th>Network</th><th>Status</th><th>ATS</th><th>Actions</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr class="${item.staleFlag === 'STALE' ? 'row--stale' : ''}">
          <td><input type="checkbox" class="bulk-checkbox" value="${item.id}"></td>
          <td><a class="row-link" href="#/accounts/${item.id}">${escapeHtml(item.displayName)}</a><div class="small muted">${escapeHtml(item.domain || item.topContactName || item.recommendedAction || '')}</div><div class="small muted">${escapeHtml(renderTargetScoreSignalSummary(item))}</div></td>
          <td>${formatNumber(getTargetScore(item))}<div class="small muted">${escapeHtml(getTargetScoreExplanation(item) || humanize(item.priority || 'medium'))}</div></td>
          <td>${formatNumber(item.hiringVelocity || 0)} velocity<div class="small muted">${formatNumber(item.jobsLast30Days || 0)} jobs / 30d \u00b7 ${formatNumber(item.jobsLast90Days || 0)} / 90d</div></td>
          <td>${escapeHtml(item.owner || 'Unassigned')}<div class="small muted">${escapeHtml(item.nextAction || 'No next action set')}</div></td>
          <td>${renderStatusPill(item.networkStrength, toneForNetwork(item.networkStrength))}<div class="small muted">${formatNumber(item.engagementScore || 0)} engagement</div></td>
          <td>${renderStatusPill(item.status || 'new', 'neutral')}<div class="small muted">${escapeHtml(humanize(item.outreachStatus || 'not_started'))}</div></td>
          <td>${(item.atsTypes || []).map((type) => renderStatusPill(type, 'neutral')).join(' ') || '<span class="small muted">None</span>'}</td>
          <td><div class="button-row"><button class="ghost-button" data-action="open-account" data-id="${item.id}">Open</button><button class="ghost-button" data-action="quick-log-inline" data-id="${item.id}" data-name="${escapeAttr(item.displayName)}">Log</button></div></td>
        </tr>
        <tr id="quick-log-${item.id}" class="quick-log-row hidden">
          <td colspan="9">
            <form class="quick-log-form" data-account-id="${item.id}">
              <input name="quickNote" placeholder="Quick note..." class="compact-input">
              <select name="outreachStatus" class="compact-select"><option value="">No stage change</option>${renderOutreachStageOptions('')}</select>
              <button class="secondary-button compact-btn" type="submit">Save</button>
              <button type="button" class="ghost-button compact-btn" data-action="close-quick-log" data-id="${item.id}">Cancel</button>
            </form>
          </td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderContactsTable(items) {
  return `
    <div class="table-scroll"><table class="table"><thead><tr><th>Contact</th><th>Company</th><th>Title</th><th>Score</th><th>Connected</th><th>Status</th><th>Quick update</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.fullName)}</strong><div class="small muted">${item.linkedinUrl ? `<a class="row-link" href="${escapeAttr(item.linkedinUrl)}" target="_blank" rel="noreferrer">LinkedIn</a>` : 'No URL'}</div></td>
          <td>${item.accountId ? `<a class="row-link" href="#/accounts/${item.accountId}">${escapeHtml(item.companyName || '')}</a>` : escapeHtml(item.companyName || '')}</td>
          <td>${escapeHtml(item.title || '')}</td>
          <td>${formatNumber(item.priorityScore)}</td>
          <td>${formatDate(item.connectedOn)}</td>
          <td>${renderStatusPill(item.outreachStatus || 'not_started', 'neutral')}</td>
          <td><form id="contact-inline-form" data-contact-id="${item.id}" class="detail-form"><div class="inline-field"><label>Stage</label><select name="outreachStatus"><option value="not_started" ${selected(item.outreachStatus, 'not_started')}>Not started</option><option value="researching" ${selected(item.outreachStatus, 'researching')}>Researching</option><option value="ready_to_contact" ${selected(item.outreachStatus, 'ready_to_contact')}>Ready</option><option value="contacted" ${selected(item.outreachStatus, 'contacted')}>Contacted</option><option value="replied" ${selected(item.outreachStatus, 'replied')}>Replied</option><option value="opportunity" ${selected(item.outreachStatus, 'opportunity')}>Opportunity</option></select></div><div class="inline-field"><label>Notes</label><input name="notes" value="${escapeAttr(item.notes || '')}" placeholder="Short note"></div><button class="ghost-button" type="submit">Save</button></form></td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderJobsTable(items, compact) {
  return `
    <div class="table-scroll"><table class="table"><thead><tr><th>Role</th><th>Company</th><th>Location</th><th>ATS</th><th>Posted</th><th>Retrieved</th><th>Status</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td>${(item.jobUrl || item.url) ? `<a class="row-link" href="${escapeAttr(item.jobUrl || item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || '')}</a>` : escapeHtml(item.title || '')}${compact ? '' : `<div class="small muted">${escapeHtml(item.department || '')}</div>`}</td>
          <td>${item.accountId ? `<a class="row-link" href="#/accounts/${item.accountId}">${escapeHtml(item.companyName || '')}</a>` : escapeHtml(item.companyName || '')}</td>
          <td>${escapeHtml(item.location || '')}${item.isGta ? `<div class="small muted">GTA priority</div>` : ''}</td>
          <td>${renderStatusPill(item.atsType || 'unknown', 'neutral')}</td>
          <td>${formatDate(item.postedAt)}</td>
          <td>${formatDate(item.retrievedAt || item.importedAt)}<div class="small muted">${escapeHtml(item.jobId || '')}</div></td>
          <td>${renderStatusPill(item.active === false ? 'inactive' : 'active', item.active === false ? 'neutral' : 'success')}${item.isNew ? '<div class="small muted">New this sync</div>' : ''}</td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderMiniStatList(items) {
  if (!items || !items.length) {
    return '<div class="empty-state empty-state--compact">No resolver data yet.</div>';
  }

  return `
    <div class="timeline timeline--compact">
      ${items.map((item) => `
        <article class="timeline-item timeline-item--compact">
          <div class="inline-header">
            <span class="small">${escapeHtml(item.label || '')}</span>
            <strong>${escapeHtml(String(item.value || '0'))}</strong>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderResolverQueue(items, tone) {
  return `
    <div class="timeline">
      ${items.map((item) => `
        <article class="timeline-item">
          <div class="inline-header">
            <strong>${escapeHtml(item.companyName || '')}</strong>
            ${renderStatusPill(item.confidenceBand || 'unresolved', tone === 'medium' ? 'warning' : 'neutral')}
          </div>
          <p>${escapeHtml(item.evidenceSummary || item.failureReason || item.notes || 'Resolver evidence not available yet.')}</p>
          <div class="small muted">${escapeHtml(item.atsType || 'unknown')} · ${escapeHtml(item.discoveryMethod || 'n/a')} · ${escapeHtml(item.domain || item.careersUrl || '')}</div>
          <div class="button-row button-row--wrap">
            <button class="ghost-button" data-action="retry-config-resolution" data-id="${item.id}">Retry</button>
            <button class="ghost-button" data-action="config-review" data-id="${item.id}" data-decision="approve">Approve</button>
            <button class="ghost-button" data-action="config-review" data-id="${item.id}" data-decision="reject">Reject</button>
            ${item.atsType ? `<button class="ghost-button" data-action="config-review" data-id="${item.id}" data-decision="promote">Promote map</button>` : ''}
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderEnrichmentFilters() {
  const q = appState.enrichmentQuery;
  return `
    <div class="filter-bar filter-bar--compact" id="enrichment-filter-bar">
      <select id="eq-confidence">
        <option value="" ${selected(q.confidence, '')}>All confidence</option>
        <option value="unresolved" ${selected(q.confidence, 'unresolved')}>Unresolved only</option>
        <option value="medium" ${selected(q.confidence, 'medium')}>Medium only</option>
        <option value="low" ${selected(q.confidence, 'low')}>Low only</option>
      </select>
      <label class="checkbox-label"><input type="checkbox" id="eq-missing-domain" ${q.missingDomain === 'true' ? 'checked' : ''}> Missing domain</label>
      <label class="checkbox-label"><input type="checkbox" id="eq-missing-careers" ${q.missingCareersUrl === 'true' ? 'checked' : ''}> Missing careers URL</label>
      <label class="checkbox-label"><input type="checkbox" id="eq-has-connections" ${q.hasConnections === 'true' ? 'checked' : ''}> Has connections</label>
      <select id="eq-min-score">
        <option value="" ${selected(q.minTargetScore, '')}>All target scores</option>
        <option value="60" ${selected(q.minTargetScore, '60')}>Target score >= 60</option>
        <option value="75" ${selected(q.minTargetScore, '75')}>Target score >= 75</option>
        <option value="90" ${selected(q.minTargetScore, '90')}>Target score >= 90</option>
      </select>
      <button class="ghost-button" data-action="apply-enrichment-filter">Apply</button>
      <span class="small muted">Quick:</span>
      <button class="ghost-button ghost-button--xs" data-action="enrichment-top-n" data-topn="100">Top 100</button>
      <button class="ghost-button ghost-button--xs" data-action="enrichment-top-n" data-topn="250">Top 250</button>
      <button class="ghost-button ghost-button--xs" data-action="enrichment-top-n" data-topn="">All</button>
    </div>
  `;
}

function renderEnrichmentQueuePanel(result) {
  if (!result.items || !result.items.length) {
    return '<div class="empty-state empty-state--compact">No companies match the current filters.</div>';
  }
  return `
    <div class="table-scroll"><table class="table">
      <thead><tr>
        <th>Company</th>
        <th>Target score</th>
        <th>Connections</th>
        <th>Open roles</th>
        <th>Confidence</th>
        <th>Review reason</th>
        <th>Actions</th>
      </tr></thead>
      <tbody>
        ${result.items.map((item) => `
          <tr>
            <td><strong>${escapeHtml(item.displayName || '')}</strong><div class="small muted">${escapeHtml(item.canonicalDomain || item.domain || 'No domain')} · ${escapeHtml(item.careersUrl || 'No careers URL')}</div></td>
            <td>${formatNumber(item.targetScore || 0)}</td>
            <td>${formatNumber(item.connectionCount || 0)}</td>
            <td>${formatNumber(item.openRoleCount || 0)}</td>
            <td>${renderStatusPill(item.enrichmentConfidence || 'unresolved', item.enrichmentConfidence === 'high' ? 'success' : (item.enrichmentConfidence === 'medium' ? 'warning' : 'neutral'))}</td>
            <td>${escapeHtml(item.reviewReason || getTargetScoreExplanation(item) || item.enrichmentFailureReason || '')}<div class="small muted">${safeJoin(item.aliases)}</div></td>
            <td><button class="ghost-button ghost-button--xs" data-action="expand-enrichment-row" data-id="${item.id}">Edit</button></td>
          </tr>
          <tr class="enrichment-edit-row hidden" id="enrichment-edit-${item.id}">
            <td colspan="7">
              <form id="enrichment-inline-form" data-account-id="${item.id}" class="detail-form detail-form--compact">
                <div class="inline-field"><label>Canonical domain</label><input name="canonicalDomain" value="${escapeAttr(item.canonicalDomain || item.domain || '')}" placeholder="company.com"></div>
                <div class="inline-field"><label>Careers URL</label><input name="careersUrl" value="${escapeAttr(item.careersUrl || '')}" placeholder="https://company.com/careers"></div>
                <div class="inline-field"><label>Aliases</label><input name="aliases" value="${escapeAttr(safeJoin(item.aliases))}" placeholder="brand, acronym, parent company"></div>
                <div class="inline-field"><label>LinkedIn slug</label><input name="linkedinCompanySlug" value="${escapeAttr(item.linkedinCompanySlug || '')}" placeholder="company-slug"></div>
                <div class="inline-field inline-field--wide"><label>Notes</label><input name="enrichmentNotes" value="${escapeAttr(item.enrichmentNotes || '')}" placeholder="Why this looks correct"></div>
                <div class="button-row button-row--wrap">
                  <button class="ghost-button" type="submit" value="save">Save enrichment</button>
                  ${item.primaryConfigId ? '<button class="primary-button" type="submit" value="save_rerun">Save + rerun ATS resolution</button>' : ''}
                  ${item.primaryConfigId ? `<button class="ghost-button" type="button" data-action="rerun-enrichment-resolution" data-id="${item.id}">Rerun only</button>` : ''}
                </div>
              </form>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>
    ${renderPagination('enrichmentQueue', result.page, result.pageSize, result.total)}
  `;
}

async function refreshEnrichmentPanel() {
  const panel = document.getElementById('enrichment-queue-panel');
  if (!panel) return;
  const result = await api(`/api/enrichment/queue${buildQuery(appState.enrichmentQuery)}`);
  panel.innerHTML = `
    <div class="panel-header"><div><h3>Enrichment review queue</h3><p class="muted small">Sorted by target score, then hiring velocity, then engagement. ${formatNumber(result.total || 0)} companies in queue.</p></div></div>
    ${renderEnrichmentFilters()}
    ${renderEnrichmentQueuePanel(result)}
  `;
}

function applyEnrichmentFilters() {
  const q = appState.enrichmentQuery;
  q.confidence = document.getElementById('eq-confidence')?.value || '';
  q.missingDomain = document.getElementById('eq-missing-domain')?.checked ? 'true' : '';
  q.missingCareersUrl = document.getElementById('eq-missing-careers')?.checked ? 'true' : '';
  q.hasConnections = document.getElementById('eq-has-connections')?.checked ? 'true' : '';
  q.minTargetScore = document.getElementById('eq-min-score')?.value || '';
  q.topN = '';
  q.page = 1;
  refreshEnrichmentPanel();
}

function renderConfigsTable(items) {
  return `
    <div class="table-scroll"><table class="table"><thead><tr><th>Company</th><th>ATS</th><th>Confidence</th><th>Discovery</th><th>Evidence</th><th>Status</th><th>Last checked</th><th>Actions</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.companyName || '')}</strong><div class="small muted">${escapeHtml(item.domain || item.careersUrl || '')}</div></td>
          <td>${renderStatusPill(item.atsType || 'unknown', 'neutral')}<div class="small muted">${escapeHtml(item.boardId || item.resolvedBoardUrl || '')}</div></td>
          <td>${renderStatusPill(item.confidenceBand || 'unresolved', item.confidenceBand === 'high' ? 'success' : (item.confidenceBand === 'medium' ? 'warning' : 'neutral'))}<div class="small muted">${formatNumber(item.confidenceScore || 0)} / 100</div></td>
          <td>${renderStatusPill(item.discoveryStatus || 'manual', 'neutral')}<div class="small muted">${escapeHtml(item.discoveryMethod || '')}</div></td>
          <td>${escapeHtml(item.evidenceSummary || item.failureReason || item.notes || '')}<div class="small muted">${escapeHtml(asArray(item.matchedSignatures).join(', '))}</div></td>
          <td>${renderStatusPill(item.active ? 'active' : 'inactive', item.active ? 'success' : 'neutral')}<div class="small muted">${escapeHtml(item.reviewStatus || 'pending')}</div></td>
          <td>${formatDate(item.lastCheckedAt || item.lastResolutionAttemptAt)}<div class="small muted">${escapeHtml(item.lastImportStatus || '')}</div></td>
          <td><div class="button-row button-row--wrap"><button class="ghost-button" data-action="edit-config" data-id="${item.id}">Edit</button><button class="ghost-button" data-action="retry-config-resolution" data-id="${item.id}">Retry</button>${item.atsType ? `<button class="ghost-button" data-action="config-review" data-id="${item.id}" data-decision="promote">Promote</button>` : ''}</div></td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderAccountJobsTable(items) {
  return renderJobsTable(items.slice(0, 15), false);
}

function renderAccountContactsTable(items) {
  return `
    <div class="table-scroll"><table class="table"><thead><tr><th>Contact</th><th>Title</th><th>Score</th><th>Connected</th></tr></thead><tbody>
      ${items.map((item) => `<tr><td>${escapeHtml(item.fullName || '')}</td><td>${escapeHtml(item.title || '')}</td><td>${formatNumber(item.priorityScore)}</td><td>${formatDate(item.connectedOn)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function renderAccountConfigsTable(items) {
  return `
    <div class="table-scroll"><table class="table"><thead><tr><th>ATS</th><th>Board</th><th>Discovery</th><th>Import</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td>${renderStatusPill(item.atsType || 'unknown', 'neutral')}</td>
          <td>${escapeHtml(item.boardId || item.careersUrl || '')}</td>
          <td>${renderStatusPill(item.discoveryStatus || 'unknown', 'neutral')}<div class="small muted">${escapeHtml(item.discoveryMethod || '')}</div></td>
          <td>${formatDate(item.lastImportAt)}<div class="small muted">${escapeHtml(item.lastImportStatus || 'not run')}</div></td>
        </tr>
      `).join('')}
    </tbody></table></div>`;
}

function renderFollowUpItem(item) {
  return `
    <article class="timeline-item">
      <div class="job-card__footer">
        <strong>${escapeHtml(item.displayName)}</strong>
        ${renderStatusPill(item.status || 'new', 'neutral')}
      </div>
      <p>${escapeHtml(item.nextAction || item.recommendedAction || 'Review this account and set a next step.')}</p>
      <div class="inline-header">
        <span class="small muted">${item.nextActionAt ? `Due ${formatDate(item.nextActionAt)}` : (item.daysSinceContact !== null && item.daysSinceContact !== undefined ? `${formatNumber(item.daysSinceContact)} days since last touch` : 'No outreach logged')}</span>
        <button class="ghost-button" data-action="open-account" data-id="${item.id}">Open</button>
      </div>
    </article>
  `;
}

function renderDiscoveryList(items) {
  return `
    <div class="timeline">
      ${items.map((item) => `
        <article class="timeline-item">
          <div class="inline-header">
            <strong>${escapeHtml(item.companyName || '')}</strong>
            ${renderStatusPill(item.atsType || 'unknown', 'neutral')}
          </div>
          <p>${escapeHtml(humanize(item.discoveryStatus || 'unknown'))} via ${escapeHtml(item.discoveryMethod || 'n/a')}</p>
          <span class="small muted">${escapeHtml(item.careersUrl || item.domain || item.source || '')}</span>
        </article>
      `).join('')}
    </div>
  `;
}

function parseJobProgress(msg) {
  if (!msg) return null;
  const match = msg.match(/(\d+)\/(\d+)/);
  if (!match) return null;
  const current = parseInt(match[1], 10);
  const total = parseInt(match[2], 10);
  if (!total) return null;
  return { current, total, pct: Math.min(100, Math.round((current / total) * 100)) };
}

function renderBackgroundJobItem(job) {
  const tone = job.status === 'completed'
    ? 'success'
    : (job.status === 'failed' ? 'danger' : 'neutral');

  const progress = job.status === 'running' ? parseJobProgress(job.progressMessage) : null;

  return `
    <article class="timeline-item job-card job-card--${escapeAttr(job.status || 'queued')}">
      <div class="job-card__header">
        <div class="job-card__title">
          <p class="eyebrow">${escapeHtml(humanize(job.type || 'job'))}</p>
          <strong>${escapeHtml(job.summary || humanize(job.type || 'job'))}</strong>
        </div>
        <div class="job-status-cluster">
          ${progress ? `<span class="job-pct">${progress.pct}%</span>` : ''}
          ${renderStatusPill(job.status || 'queued', tone)}
        </div>
      </div>
      ${progress ? `<div class="spark-bar job-progress-bar"><span style="width:${progress.pct}%"></span></div>` : ''}
      <p class="job-card__body">${escapeHtml(job.progressMessage || job.summary || 'Waiting for work to start.')}</p>
      <div class="inline-header">
        <span class="small muted">${job.startedAt ? `Started ${formatDate(job.startedAt)}` : `Queued ${formatDate(job.queuedAt)}`}${job.recordsAffected ? ` · ${formatNumber(job.recordsAffected)} records` : ''}</span>
        ${job.status === 'queued' ? `<button class="ghost-button" data-action="cancel-background-job" data-id="${job.id}">Cancel</button>` : ''}
      </div>
      ${job.errorMessage ? `<p class="small muted">${escapeHtml(job.errorMessage)}</p>` : ''}
    </article>
  `;
}

function renderTimelineItem(item) {
  return `<article class="timeline-item"><div class="inline-header"><strong>${escapeHtml(item.summary || item.type || 'Activity')}</strong><span class="small muted">${formatDate(item.occurredAt)}</span></div>${item.pipelineStage ? renderStatusPill(item.pipelineStage, 'neutral') : ''}<p>${escapeHtml(item.notes || '')}</p></article>`;
}

function renderMetricCard(label, value, subtitle) {
  return `<article class="metric-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${formatNumber(value)}</strong><span class="small muted">${escapeHtml(subtitle)}</span></article>`;
}

function renderMetricTile(label, value) {
  return `<div class="kpi-tile"><span class="small muted">${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}

function renderTrustCard(label, value, description, meta, tone = 'neutral') {
  return `
    <article class="trust-card trust-card--${tone}">
      <span class="trust-card__eyebrow">${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value || ''))}</strong>
      <p>${escapeHtml(description || '')}</p>
      ${meta ? `<span class="trust-card__meta">${escapeHtml(meta)}</span>` : ''}
    </article>
  `;
}

function renderSignalChip(label, value, tone = 'neutral') {
  return `
    <div class="signal-chip signal-chip--${tone}">
      <span class="signal-chip__label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value || ''))}</strong>
    </div>
  `;
}

function renderStoryCard(label, value, description, tone = 'neutral') {
  return `
    <article class="story-card story-card--${tone}">
      <span class="story-card__label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value || ''))}</strong>
      <p>${escapeHtml(description || '')}</p>
    </article>
  `;
}

function renderField(label, control) {
  return `<div class="field"><label>${escapeHtml(label)}</label>${control}</div>`;
}

function renderStatusPill(value, tone) {
  return `<span class="status-pill ${tone}">${escapeHtml(humanize(value))}</span>`;
}

function renderInlineBadge(value) {
  return `<span>${escapeHtml(humanize(value))}</span>`;
}

function renderPagination(view, page, pageSize, total) {
  if (!total || total <= pageSize) return '';
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const firstRecord = ((page - 1) * pageSize) + 1;
  const lastRecord = Math.min(total, page * pageSize);
  return `<div class="pagination"><span class="small muted">Showing ${formatNumber(firstRecord)}-${formatNumber(lastRecord)} of ${formatNumber(total)} records · Page ${page} of ${lastPage}</span><div class="pagination-controls"><button class="ghost-button" data-action="paginate" data-view="${view}" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''}>Previous</button><button class="ghost-button" data-action="paginate" data-view="${view}" data-page="${Math.min(lastPage, page + 1)}" ${page >= lastPage ? 'disabled' : ''}>Next</button></div></div>`;
}

function renderPrioritySelect(name, currentValue, includeAll = false) {
  const options = [
    includeAll ? `<option value="">All priorities</option>` : '',
    `<option value="strategic" ${selected(currentValue, 'strategic')}>Strategic</option>`,
    `<option value="high" ${selected(currentValue, 'high')}>High</option>`,
    `<option value="medium" ${selected(currentValue, 'medium')}>Medium</option>`,
    `<option value="low" ${selected(currentValue, 'low')}>Low</option>`,
  ].join('');
  return `<select name="${escapeAttr(name)}">${options}</select>`;
}

function renderOwnerSelect(name, currentValue, includeAll = false) {
  const roster = (appState.bootstrap && appState.bootstrap.ownerRoster) || [];
  const allOption = includeAll ? '<option value="">All owners</option>' : '<option value="">Unassigned</option>';
  const rosterOptions = roster.map((o) =>
    `<option value="${escapeAttr(o.displayName)}" ${selected(currentValue, o.displayName)}>${escapeHtml(o.displayName)}</option>`
  ).join('');
  return `<select name="${escapeAttr(name)}">${allOption}${rosterOptions}</select>`;
}

function renderAccountStatusSelect(name, currentValue, includeAll = false) {
  const options = [
    includeAll ? `<option value="">All statuses</option>` : '',
    `<option value="new" ${selected(currentValue, 'new')}>New</option>`,
    `<option value="researching" ${selected(currentValue, 'researching')}>Researching</option>`,
    `<option value="contacted" ${selected(currentValue, 'contacted')}>Contacted</option>`,
    `<option value="in_conversation" ${selected(currentValue, 'in_conversation')}>In conversation</option>`,
    `<option value="client" ${selected(currentValue, 'client')}>Client</option>`,
    `<option value="paused" ${selected(currentValue, 'paused')}>Paused</option>`,
  ].join('');
  return `<select name="${escapeAttr(name)}">${options}</select>`;
}

function renderOutreachStageOptions(currentValue, includeBlank = false) {
  return [
    includeBlank ? '<option value="">Any stage</option>' : '',
    `<option value="not_started" ${selected(currentValue, 'not_started')}>Not started</option>`,
    `<option value="researching" ${selected(currentValue, 'researching')}>Researching</option>`,
    `<option value="ready_to_contact" ${selected(currentValue, 'ready_to_contact')}>Ready to contact</option>`,
    `<option value="contacted" ${selected(currentValue, 'contacted')}>Contacted</option>`,
    `<option value="replied" ${selected(currentValue, 'replied')}>Replied</option>`,
    `<option value="opportunity" ${selected(currentValue, 'opportunity')}>Opportunity</option>`,
  ].join('');
}

function renderAccountSortSelect(currentValue) {
  return `
    <select name="sortBy">
      <option value="" ${selected(currentValue, '')}>Target score</option>
      <option value="new_roles" ${selected(currentValue, 'new_roles')}>New roles</option>
      <option value="connections" ${selected(currentValue, 'connections')}>Connections</option>
      <option value="follow_up" ${selected(currentValue, 'follow_up')}>Follow-up urgency</option>
      <option value="recent_jobs" ${selected(currentValue, 'recent_jobs')}>Recent jobs</option>
    </select>
  `;
}

function populateConfigForm(id) {
  appState.configEditingId = id;
  api(`/api/configs${buildQuery({ page: 1, pageSize: 200 })}`).then((result) => {
    const config = result.items.find((item) => item.id === id);
    if (!config) return;
    const form = document.getElementById('config-form');
    if (!form) return;
    form.companyName.value = config.companyName || '';
    form.atsType.value = config.atsType || '';
    form.boardId.value = config.boardId || '';
    form.domain.value = config.domain || '';
    form.careersUrl.value = config.careersUrl || '';
    form.source.value = config.source || '';
    form.active.value = String(Boolean(config.active));
    form.notes.value = config.notes || '';
  });
}

function resetConfigForm() {
  appState.configEditingId = '';
  const form = document.getElementById('config-form');
  if (!form) return;
  form.reset();
  if (form.active) form.active.value = 'true';
}

async function reseedWorkbook(path) {
  const button = document.querySelector('[data-action="reseed-workbook"]');
  if (button) { button.disabled = true; button.textContent = 'Importing workbook...'; }
  try {
    const accepted = await api('/api/import/workbook', { method: 'POST', body: JSON.stringify({ workbookPath: path || appState.bootstrap.defaults.workbookPath }) });
    window.bdLocalApi.setAlert('Workbook import queued.', appAlert);
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Workbook import' });
    const stats = job?.result?.stats || job?.result?.importRun?.stats || {};
    window.bdLocalApi.setAlert(`Workbook import finished: ${formatNumber(stats.companies || 0)} companies, ${formatNumber(stats.contacts || 0)} contacts, ${formatNumber(stats.jobs || 0)} jobs.`, appAlert);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Reimport workbook'; }
  }
}

async function runLiveImport() {
  const button = document.querySelector('[data-action="run-live-import"]');
  if (button) { button.disabled = true; button.textContent = 'Running import...'; }
  try {
    const accepted = await api('/api/import/jobs', { method: 'POST', body: JSON.stringify({}) });
    window.bdLocalApi.setAlert('Live ATS import queued.', appAlert);
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Live ATS import' });
    const run = job?.result?.importRun || {};
    const stats = run?.stats || {};
    const status = run?.status === 'completed_with_errors'
      ? `Fetched ${formatNumber(stats.fetched || 0)} jobs across ${formatNumber(stats.configs || 0)} ATS configs; kept ${formatNumber(stats.canadaKept || 0)} Canada jobs, filtered ${formatNumber(stats.filteredOutNonCanada || 0)} non-Canada, and ended with ${formatNumber(stats.imported || 0)} active tracked jobs. ${formatNumber(stats.errors || 0)} configs errored.`
      : `Fetched ${formatNumber(stats.fetched || 0)} jobs across ${formatNumber(stats.configs || 0)} ATS configs; kept ${formatNumber(stats.canadaKept || 0)} Canada jobs, filtered ${formatNumber(stats.filteredOutNonCanada || 0)} non-Canada, and ended with ${formatNumber(stats.imported || 0)} active tracked jobs.`;
    window.bdLocalApi.setAlert(status, appAlert);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Run live import'; }
  }
}

async function runDiscovery() {
  const button = document.querySelector('[data-action="run-discovery"]');
  if (button) { button.disabled = true; button.textContent = 'Discovering...'; }
  try {
    const limit = Number(document.getElementById('discovery-limit')?.value || 75);
    const onlyMissing = (document.getElementById('discovery-only-missing')?.value || 'true') === 'true';
    const forceRefresh = (document.getElementById('discovery-force-refresh')?.value || 'false') === 'true';
    const accepted = await api('/api/discovery/run', {
      method: 'POST',
      body: JSON.stringify({ limit, onlyMissing, forceRefresh }),
    });
    window.bdLocalApi.setAlert('ATS discovery queued.', appAlert);
    const job = await watchBackgroundJob(accepted.jobId, { label: 'ATS discovery' });
    const stats = job?.result?.stats || {};
    window.bdLocalApi.setAlert(
      `Discovery checked ${formatNumber(stats.checked || 0)} configs. Mapped ${formatNumber(stats.mapped || 0)}, discovered ${formatNumber(stats.discovered || 0)}, high confidence ${formatNumber(stats.highConfidence || 0)}, unresolved ${formatNumber(stats.unresolved || 0)}.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Run discovery'; }
  }
}

async function runEnrichment() {
  const button = document.querySelector('[data-action="run-enrichment"]');
  if (button) { button.disabled = true; button.textContent = 'Enriching...'; }
  try {
    const limit = Number(document.getElementById('enrichment-limit')?.value || 50);
    const forceRefresh = (document.getElementById('enrichment-force-refresh')?.value || 'false') === 'true';
    const accepted = await api('/api/enrichment/run', {
      method: 'POST',
      body: JSON.stringify({ limit, forceRefresh }),
    });
    window.bdLocalApi.setAlert('Company enrichment queued.', appAlert);
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Company enrichment' });
    const stats = job?.result?.stats || {};
    window.bdLocalApi.setAlert(
      `Enriched ${formatNumber(stats.checked || 0)} companies. Verified ${formatNumber(stats.verified || 0)}, enriched ${formatNumber(stats.enriched || 0)}, unresolved ${formatNumber(stats.unresolved || 0)}.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Run enrichment'; }
  }
}

async function runTargetScoreRollout() {
  const button = document.querySelector('[data-action="run-target-score-rollout"]');
  if (button) { button.disabled = true; button.textContent = 'Queueing rollout...'; }
  try {
    const limit = Number(document.getElementById('target-score-rollout-limit')?.value || appState.targetScoreRollout?.defaultLimit || 150);
    const maxBatches = Number(document.getElementById('target-score-rollout-batches')?.value || appState.targetScoreRollout?.defaultMaxBatches || 6);
    const accepted = await api('/api/admin/target-score-rollout', {
      method: 'POST',
      body: JSON.stringify({ limit, maxBatches }),
    });
    window.bdLocalApi.setAlert('Target-score rollout queued.', appAlert);
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Target-score rollout' });
    const result = job?.result || {};
    const timings = result.timings || {};
    window.bdLocalApi.setAlert(
      `Target-score rollout refreshed ${formatNumber(result.accountCount || result.count || 0)} accounts across ${formatNumber(result.batchCount || 0)} batches. ${formatNumber(result.remainingCount || 0)} remain. Derive ${formatNumber(timings.deriveMs || 0)}ms, scope ${formatNumber(timings.scopeLoadMs || 0)}ms, persist ${formatNumber(timings.persistMs || 0)}ms.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Run rollout'; }
  }
}

async function syncConfigs() {
  const button = document.querySelector('[data-action="sync-configs"]');
  if (button) { button.disabled = true; button.textContent = 'Rebuilding...'; }
  try {
    const accepted = await api('/api/configs/sync', { method: 'POST', body: JSON.stringify({}) });
    resetConfigForm();
    window.bdLocalApi.setAlert('Config rebuild queued.', appAlert);
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Config rebuild' });
    window.bdLocalApi.setAlert(`Rebuilt ${formatNumber(job?.result?.count || 0)} job board config rows.`, appAlert);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Rebuild configs'; }
  }
}

async function rerunEnrichmentResolution(accountId) {
  const accepted = await api(`/api/enrichment/${accountId}/rerun-resolution`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  window.bdLocalApi.setAlert('ATS resolution queued for this company.', appAlert);
  hydrateAdminRuntimePanels(await loadRuntimeStatus(true));
  void watchBackgroundJob(accepted.jobId, { label: 'ATS resolution', refreshRoute: false }).catch(() => {});
}

function getSpreadsheetId() {
  const input = document.getElementById('google-sheet-id');
  return (input?.value || appState.bootstrap?.defaults?.spreadsheetId || '').trim();
}

async function runGoogleSheetSync() {
  const button = document.querySelector('[data-action="sync-google-sheets"]');
  if (button) { button.disabled = true; button.textContent = 'Syncing...'; }
  try {
    const spreadsheetId = getSpreadsheetId();
    const accepted = await api('/api/google-sheets/sync-configs', {
      method: 'POST',
      body: JSON.stringify({ spreadsheetId }),
    });
    window.bdLocalApi.setAlert('Google Sheet sync queued.', appAlert);
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Google Sheet sync', refreshRoute: false });
    window.bdLocalApi.setAlert(`Live sheet sync complete: ${formatNumber(job?.result?.writtenRows || 0)} rows written for ${formatNumber(job?.result?.targetCompanies || 0)} companies.`, appAlert);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Sync Google Sheet'; }
  }
}

async function runFullBdEngine() {
  const button = document.querySelector('[data-action="run-full-engine"]');
  if (button) { button.disabled = true; button.textContent = 'Running full pipeline...'; }
  try {
    const spreadsheetId = getSpreadsheetId();
    const connectionsCsvPath = getConnectionsCsvPath();
    const accepted = await api('/api/google-sheets/run-engine', {
      method: 'POST',
      body: JSON.stringify({
        spreadsheetId,
        connectionsCsvPath,
        skipJobImport: false,
      }),
    });
    window.bdLocalApi.setAlert('Full BD engine run queued.', appAlert);
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Full BD engine run' });
    const result = job?.result || {};
    const tabs = result?.tabsWritten || {};
    window.bdLocalApi.setAlert(
      `Full BD run complete. Companies: ${formatNumber(result?.companies || 0)}, Contacts: ${formatNumber(result?.contacts || 0)}, Jobs: ${formatNumber(result?.jobs || 0)}. Tabs updated: Connections ${formatNumber(tabs.Connections || 0)}, Target_Accounts ${formatNumber(tabs.Target_Accounts || 0)}, Hiring_Import ${formatNumber(tabs.Hiring_Import || 0)}, Daily_Hot_List ${formatNumber(tabs.Daily_Hot_List || 0)}, Today_View ${formatNumber(tabs.Today_View || 0)}, Top_Contacts ${formatNumber(tabs.Top_Contacts || 0)}, Job_Boards_Config ${formatNumber(tabs.Job_Boards_Config || 0)}.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Run Full Engine'; }
  }
}

function getConnectionsCsvPath() {
  const input = document.getElementById('connections-csv-path');
  return (input?.value || appState.bootstrap?.defaults?.connectionsCsvPath || '').trim();
}

async function runConnectionsCsvImport(dryRun) {
  const action = dryRun ? 'dry-run-connections-csv' : 'import-connections-csv';
  const button = document.querySelector(`[data-action="${action}"]`);
  const originalLabel = dryRun ? 'Dry run CSV' : 'Import CSV';
  if (button) { button.disabled = true; button.textContent = dryRun ? 'Dry running...' : 'Importing...'; }

  try {
    const fileInput = document.getElementById('connections-csv-file');
    const file = fileInput?.files?.[0];

    let requestBody;
    if (file) {
      const csvContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });
      requestBody = JSON.stringify({ csvContent, dryRun, useEmptyState: dryRun });
    } else {
      const csvPath = getConnectionsCsvPath();
      if (!csvPath) {
        window.bdLocalApi.setAlert('Please select a CSV file using the Browse button.', appAlert);
        return;
      }
      requestBody = JSON.stringify({ csvPath, dryRun, useEmptyState: dryRun });
    }

    const run = await api('/api/import/connections-csv', {
      method: 'POST',
      body: requestBody,
    });
    if (!dryRun) {
      window.bdLocalApi.setAlert('Connections import queued.', appAlert);
      const job = await watchBackgroundJob(run.jobId, { label: 'Connections import' });
      const stats = job?.result?.stats || job?.result?.importRun?.stats || {};
      const message = `Imported ${formatNumber(stats.contacts || 0)} contacts across ${formatNumber(stats.companies || 0)} companies.`;
      window.bdLocalApi.setAlert(message, appAlert);
      return;
    }
    const stats = run?.stats || {};
    const message = `Dry run succeeded: ${formatNumber(stats.contacts || 0)} contacts across ${formatNumber(stats.companies || 0)} companies.`;
    window.bdLocalApi.setAlert(message, appAlert);
  } finally {
    if (button) { button.disabled = false; button.textContent = originalLabel; }
  }
}

async function retryConfigResolution(configId) {
  if (!configId) return;
  const accepted = await api(`/api/configs/${configId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ forceRefresh: true }),
  });
  window.bdLocalApi.setAlert('Config resolution queued.', appAlert);
  await watchBackgroundJob(accepted.jobId, { label: 'Config resolution' });
  window.bdLocalApi.setAlert('Config resolution finished.', appAlert);
}

async function reviewConfig(configId, decision) {
  if (!configId || !decision) return;
  await api(`/api/configs/${configId}/review`, {
    method: 'POST',
    body: JSON.stringify({ action: decision }),
  });
  invalidateAppData();
  await renderAdminView();
  window.bdLocalApi.setAlert(`Config ${decision}d.`, appAlert);
}

async function cancelBackgroundJob(jobId) {
  if (!jobId) return;
  await api(`/api/background-jobs/${jobId}/cancel`, { method: 'POST', body: JSON.stringify({}) });
  const runtime = await loadRuntimeStatus(true);
  hydrateAdminRuntimePanels(runtime);
  window.bdLocalApi.setAlert('Queued background job cancelled.', appAlert);
}

document.addEventListener('change', (event) => {
  if (event.target.id === 'bulk-select-all') {
    const checked = event.target.checked;
    document.querySelectorAll('.bulk-checkbox').forEach(cb => { cb.checked = checked; });
    updateBulkBar();
    return;
  }
  if (event.target.classList.contains('bulk-checkbox')) {
    updateBulkBar();
    return;
  }
});

document.addEventListener('click', (event) => {
  const contactRow = event.target.closest('.contact-row-selectable');
  if (contactRow) {
    if (event.target.closest('a')) {
      return;
    }
    const name = contactRow.dataset.contactName;
    const sel = document.getElementById('outreach-contact-select');
    if (sel) {
      sel.value = name;
      document.querySelectorAll('.contact-row-selectable').forEach(r => r.classList.remove('selected'));
      contactRow.classList.add('selected');
    }
  }
});

function updateBulkBar() {
  const checked = document.querySelectorAll('.bulk-checkbox:checked');
  const bar = document.getElementById('bulk-action-bar');
  const count = document.getElementById('bulk-count');
  if (bar) {
    if (checked.length > 0) {
      bar.classList.remove('hidden');
      if (count) count.textContent = checked.length + ' selected';
    } else {
      bar.classList.add('hidden');
    }
  }
}

async function applyBulkUpdate() {
  const checked = document.querySelectorAll('.bulk-checkbox:checked');
  const ids = Array.from(checked).map(cb => cb.value);
  if (!ids.length) return;
  const status = document.getElementById('bulk-status')?.value || '';
  const priority = document.getElementById('bulk-priority')?.value || '';
  const patch = {};
  if (status) patch.status = status;
  if (priority) patch.priority = priority;
  if (!Object.keys(patch).length) {
    window.bdLocalApi.setAlert('Select a status or priority to apply.', appAlert);
    return;
  }
  await api('/api/accounts/bulk', {
    method: 'PATCH',
    body: JSON.stringify({ ids, ...patch }),
  });
  invalidateAppData();
  await renderAccountsView();
  window.bdLocalApi.setAlert('Updated ' + ids.length + ' accounts.', appAlert);
}

async function generateSmartOutreach(accountId, buttonEl) {
  if (!accountId) return;
  const origText = buttonEl.textContent;
  buttonEl.textContent = 'Generating...';
  buttonEl.disabled = true;

  try {
    // Get selected contact from dropdown
    const contactSelect = document.getElementById('outreach-contact-select');
    const selectedOption = contactSelect?.selectedOptions?.[0];
    const contactName = selectedOption?.value || '';
    const contactTitle = selectedOption?.dataset?.title || '';

    const result = await api(`/api/accounts/${accountId}/generate-outreach`, {
      method: 'POST',
      body: JSON.stringify({ bookingLink: 'https://tinyurl.com/ysdep7cn', contactName, contactTitle, template: document.getElementById('outreach-template-select')?.value || 'cold' }),
    });

    const subjectLine = result.subject_line || result.subjectLine || `Hiring signal at ${appState.accountDetail?.account?.displayName || 'this company'}`;
    const messageBody = result.message_body || result.messageBody || result.outreach || '';
    const copyText = `Subject: ${subjectLine}\n\n${messageBody}`.trim();

    // Update the outreach prompt card with the generated message
    const body = document.getElementById('outreach-prompt-body');
    if (body && messageBody) {
      body.className = 'outreach-generated';
      if (subjectLine) {
        const gmailSubjectStructured = encodeURIComponent(subjectLine);
        const gmailBodyStructured = encodeURIComponent(messageBody);
        body.innerHTML = `
          <div class="outreach-generated__field">
            <div class="outreach-generated__label">Subject</div>
            <pre class="outreach-subject">${escapeHtml(subjectLine)}</pre>
          </div>
          <div class="outreach-generated__field">
            <div class="outreach-generated__label">Message</div>
            <pre class="outreach-text">${escapeHtml(messageBody)}</pre>
          </div>
          <div class="button-row" style="margin-top:12px;">
            <button class="secondary-button" onclick="const subject=document.querySelector('.outreach-subject')?.textContent||'';const message=document.querySelector('.outreach-text')?.textContent||'';navigator.clipboard.writeText((subject ? 'Subject: ' + subject + '\\n\\n' : '') + message);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy to clipboard',1500)">Copy to clipboard</button>
            <a class="secondary-button" href="https://mail.google.com/mail/?view=cm&su=${gmailSubjectStructured}&body=${gmailBodyStructured}" target="_blank" rel="noreferrer">Draft in Gmail</a>
          </div>
        `;
      }
      const gmailSubject = encodeURIComponent('Quick intro — ' + (appState.accountDetail?.account?.displayName || ''));
      // Scroll the outreach card into view
      const card = document.getElementById('outreach-prompt-card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    window.bdLocalApi.setAlert('Outreach message generated! Check the Outreach prompt section.', appAlert);
  } catch (err) {
    window.bdLocalApi.setAlert('Failed to generate outreach: ' + (err.message || err), appAlert);
  } finally {
    buttonEl.textContent = origText;
    buttonEl.disabled = false;
  }
}

async function archiveAccount(accountId) {
  if (!accountId) return;
  const confirmed = window.confirm('Pause this account? It will remain stored but stop surfacing in the active daily queue.');
  if (!confirmed) return;

  await api(`/api/accounts/${accountId}`, { method: 'DELETE' });
  invalidateAppData();

  if ((location.hash || '').endsWith(`/accounts/${accountId}`)) {
    location.hash = '#/accounts';
  } else {
    await renderRoute();
  }

  window.bdLocalApi.setAlert('Account paused. You can reactivate it later by editing its status.', appAlert);
}

async function runSearch(value) {
  const results = await api(`/api/search${buildQuery({ q: value })}`);
  searchResults.classList.remove('hidden');
  searchResults.innerHTML = `
    ${renderSearchGroup('Accounts', results.accounts, (item) => `#/accounts/${item.id}`, (item) => escapeHtml(item.displayName), (item) => `${formatNumber(getTargetScore(item))} target score · ${formatNumber(item.hiringVelocity || 0)} hiring velocity · ${formatNumber(item.engagementScore || 0)} engagement`)}
    ${renderSearchGroup('Contacts', results.contacts, (item) => item.accountId ? `#/accounts/${item.accountId}` : '#/contacts', (item) => escapeHtml(item.fullName), (item) => `${escapeHtml(item.companyName || '')} · ${formatNumber(item.priorityScore)} score`)}
    ${renderSearchGroup('Jobs', results.jobs, (item) => item.accountId ? `#/accounts/${item.accountId}` : '#/jobs', (item) => escapeHtml(item.title), (item) => `${escapeHtml(item.companyName || '')} · ${formatDate(item.postedAt)}`)}
  `;
}

function renderSearchGroup(label, items, hrefBuilder, titleBuilder, metaBuilder) {
  if (!items || !items.length) return '';
  return `<section class="search-group"><p class="eyebrow">${escapeHtml(label)}</p>${items.map((item) => `<a class="search-item" href="${hrefBuilder(item)}"><strong>${titleBuilder(item)}</strong><span class="small muted">${metaBuilder(item)}</span></a>`).join('')}</section>`;
}

function toneForNetwork(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'hot') return 'hot';
  if (normalized === 'warm') return 'warm';
  return 'cold';
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'object') return [];
  return [String(value)];
}

function safeJoin(value, sep) {
  return asArray(value).map((v) => String(v)).filter(Boolean).join(sep || ', ');
}

function getTargetScore(item) {
  const value = item && item.targetScore !== undefined && item.targetScore !== null
    ? item.targetScore
    : item?.dailyScore;
  return Number(value || 0);
}

function getTargetScoreExplanation(item) {
  const explanation = item?.targetScoreExplanation;
  if (typeof explanation === 'string') {
    return explanation;
  }
  if (explanation && typeof explanation === 'object') {
    if (typeof explanation.summary === 'string' && explanation.summary) {
      return explanation.summary;
    }
    if (Array.isArray(explanation.topDrivers) && explanation.topDrivers.length) {
      return explanation.topDrivers.map((driver) => driver?.summary || driver?.label || '').filter(Boolean).join('; ');
    }
  }
  return item?.recommendedAction || item?.nextAction || '';
}

function renderTargetScoreSignalSummary(item) {
  const parts = [];
  if (item?.hiringVelocity !== undefined && item?.hiringVelocity !== null) {
    parts.push(`${formatNumber(item.hiringVelocity)} hiring velocity`);
  }
  if (item?.engagementScore !== undefined && item?.engagementScore !== null) {
    parts.push(`${formatNumber(item.engagementScore)} engagement`);
  }
  if (item?.jobsLast30Days !== undefined && item?.jobsLast30Days !== null) {
    parts.push(`${formatNumber(item.jobsLast30Days)} jobs / 30d`);
  }
  if (item?.jobsLast90Days !== undefined && item?.jobsLast90Days !== null) {
    parts.push(`${formatNumber(item.jobsLast90Days)} jobs / 90d`);
  }
  if (!parts.length) {
    return 'No target-score signals yet';
  }
  return parts.join(' · ');
}

function humanize(value) {
  return String(value || '').replace(/_/g, ' ');
}

function formatNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return String(value || '');
  return numeric.toLocaleString();
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function selected(currentValue, expectedValue) {
  return String(currentValue || '') === String(expectedValue) ? 'selected' : '';
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
