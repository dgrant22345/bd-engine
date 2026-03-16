const appState = {
  bootstrap: null,
  localData: null,
  localOverlays: null,
  activeView: 'dashboard',
  accountQuery: { page: 1, pageSize: 20, q: '', hiring: '', ats: '', recencyDays: '', minContacts: '', priority: '', status: '', owner: '', outreachStatus: '', sortBy: '' },
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
    <div class="status-matrix">
      <div class="status-item"><span class="small muted">Server</span><strong>${summary.warmed ? 'Warm' : 'Starting'}</strong></div>
      <div class="status-item"><span class="small muted">Worker</span><strong>${summary.workerRunning ? 'Online' : 'Idle'}</strong></div>
      <div class="status-item"><span class="small muted">Running jobs</span><strong>${formatNumber(summary.runningJobs || 0)}</strong></div>
      <div class="status-item"><span class="small muted">Queued jobs</span><strong>${formatNumber(summary.queuedJobs || 0)}</strong></div>
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
  renderLoadingState('Dashboard', 'Building today’s hiring radar...');
  setViewTitle('Dashboard');
  const dashboard = await api('/api/dashboard');
  const topCompany = dashboard.todayQueue[0];
  const maxNetwork = Math.max(1, ...(dashboard.networkLeaders || []).map((item) => item.connectionCount || 0));

  appRoot.innerHTML = `
    <section class="hero-card hero-card--dashboard">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Daily operating view</p>
          <h3>${topCompany ? escapeHtml(topCompany.displayName) : 'No companies match today\'s thresholds yet'}</h3>
          <p class="subtitle">${topCompany ? escapeHtml(topCompany.recommendedAction) : 'Run ATS discovery, import fresh jobs, or relax the filters to generate a new priority lane.'}</p>
          <div class="button-row">
            ${topCompany ? `<button class="primary-button" data-action="open-account" data-id="${topCompany.id}">Open best account</button>` : '<a class="primary-button" href="#/admin">Open admin</a>'}
            <a class="ghost-button" href="#/jobs">Review fresh jobs</a>
            <a class="ghost-button" href="#/accounts">Open accounts</a>
          </div>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Daily score', topCompany ? formatNumber(topCompany.dailyScore) : '0')}
          ${renderMetricTile('Open roles', topCompany ? formatNumber(topCompany.openRoleCount || topCompany.jobCount) : '0')}
          ${renderMetricTile('New roles 7d', topCompany ? formatNumber(topCompany.newRoleCount7d || 0) : '0')}
          ${renderMetricTile('Network', topCompany ? renderInlineBadge(topCompany.networkStrength) : 'Cold')}
        </div>
      </div>
      ${topCompany ? `
        <div class="spotlight-card">
          <div class="panel-header">
            <div>
              <h3>Why this account is leading</h3>
              <p class="muted small">Hiring heat, relationship strength, and follow-up timing all point here first.</p>
            </div>
            ${renderStatusPill(topCompany.hiringStatus || 'No active jobs', topCompany.jobCount > 0 ? 'success' : 'neutral')}
          </div>
          <div class="empty-state empty-state--compact">${escapeHtml(topCompany.outreachDraft)}</div>
        </div>
      ` : ''}
    </section>

    <section class="metrics-grid">
      ${renderMetricCard('Accounts tracked', dashboard.summary.accountCount, 'Target accounts with contacts, configs, or imported jobs')}
      ${renderMetricCard('Hiring accounts', dashboard.summary.hiringAccountCount, 'Companies with active normalized roles')}
      ${renderMetricCard('New jobs, 24h', dashboard.summary.newJobsLast24h, 'Freshly imported postings in the last day')}
      ${renderMetricCard('ATS boards found', dashboard.summary.discoveredBoardCount || 0, 'Mapped or discovered supported job boards')}
    </section>

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
              <h3>Network overlap leaders</h3>
              <p class="muted small">Where your relationship graph is deepest right now.</p>
            </div>
          </div>
          <div class="spark-list">
            ${dashboard.networkLeaders.map((item) => `
              <div class="spark-row">
                <strong>${escapeHtml(item.displayName)}</strong>
                <div class="spark-bar"><span style="width:${Math.max(6, (item.connectionCount / maxNetwork) * 100)}%"></span></div>
                <span class="small">${formatNumber(item.connectionCount)}</span>
              </div>
            `).join('')}
          </div>
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
  const filters = stateBootstrap.filters || { atsTypes: [], owners: [] };
  const result = await api(`/api/accounts${buildQuery(appState.accountQuery)}`);
  const ownerOptions = filters.owners || [];
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
          ${renderField('Owner', `<input name="owner" list="owner-filter-options" value="${escapeAttr(appState.accountQuery.owner)}" placeholder="Filter by owner">`)}
          ${renderField('Recency', `<select name="recencyDays"><option value="">Any</option><option value="7" ${selected(appState.accountQuery.recencyDays, '7')}>Last 7 days</option><option value="14" ${selected(appState.accountQuery.recencyDays, '14')}>Last 14 days</option><option value="30" ${selected(appState.accountQuery.recencyDays, '30')}>Last 30 days</option></select>`)}
          ${renderField('Min contacts', `<input name="minContacts" type="number" min="0" value="${escapeAttr(appState.accountQuery.minContacts)}">`)}
          ${renderField('Outreach', `<select name="outreachStatus"><option value="">Any stage</option>${renderOutreachStageOptions(appState.accountQuery.outreachStatus, true)}</select>`)}
          ${renderField('Sort by', renderAccountSortSelect(appState.accountQuery.sortBy))}
          <div class="field field--action"><label>Refresh queue</label><button class="primary-button" type="submit">Apply filters</button></div>
        </form>
        <datalist id="owner-filter-options">${ownerOptions.map((value) => `<option value="${escapeAttr(value)}"></option>`).join('')}</datalist>
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
            ${renderField('Owner', `<input name="owner" list="owner-options" placeholder="Your name or territory">`)}
            ${renderField('Priority', renderPrioritySelect('priority', 'medium'))}
            ${renderField('Status', renderAccountStatusSelect('status', 'new'))}
            ${renderField('Next action', '<input name="nextAction" placeholder="Message VP Talent or verify ATS">')}
            ${renderField('Next action date', '<input name="nextActionAt" type="date">')}
            ${renderField('Tags', '<input name="tags" placeholder="fintech, warm intro, Toronto">')}
            <div class="field field--wide"><label>Notes</label><textarea name="notes" rows="4" placeholder="Why this account matters, what team is hiring, who might introduce you"></textarea></div>
            <div><button class="primary-button" type="submit">Add account</button></div>
          </form>
          <datalist id="owner-options">${ownerOptions.map((value) => `<option value="${escapeAttr(value)}"></option>`).join('')}</datalist>
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
  const scoreBreakdown = detail.account.scoreBreakdown || {};

  appRoot.innerHTML = `
    <section class="hero-card hero-card--dashboard">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Account detail</p>
          <h3>${escapeHtml(detail.account.displayName)}</h3>
          <p class="subtitle">${escapeHtml(detail.account.recommendedAction)}</p>
          <div class="button-row">
            ${detail.account.careersUrl ? `<a class="ghost-button" href="${escapeAttr(detail.account.careersUrl)}" target="_blank" rel="noreferrer">Open careers page</a>` : ''}
            ${detail.jobs[0]?.jobUrl || detail.jobs[0]?.url ? `<a class="ghost-button" href="${escapeAttr(detail.jobs[0].jobUrl || detail.jobs[0].url)}" target="_blank" rel="noreferrer">Open newest job</a>` : ''}
          </div>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Daily score', formatNumber(detail.account.dailyScore))}
          ${renderMetricTile('Open roles', formatNumber(detail.account.openRoleCount || detail.account.jobCount))}
          ${renderMetricTile('New roles 7d', formatNumber(detail.account.newRoleCount7d || 0))}
          ${renderMetricTile('Connections', formatNumber(detail.account.connectionCount))}
          ${renderMetricTile('Top department', detail.account.departmentFocus ? escapeHtml(detail.account.departmentFocus) : 'Unknown')}
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
      ${renderMetricCard('Contacts in graph', detail.stats?.contactCount || detail.account.connectionCount || 0, 'Imported LinkedIn overlap tied to this company')}
      ${renderMetricCard('Tracked ATS configs', detail.stats?.configCount || detail.configs.length, 'Discovery results and manual board records')}
      ${renderMetricCard('Follow-up pressure', detail.account.followUpScore || 0, 'Higher means this account needs a next move')}
      ${renderMetricCard('Stale roles 30d+', detail.account.staleRoleCount30d || 0, 'Older roles can signal harder-to-fill demand')}
    </section>

    <section class="detail-grid detail-grid--workspace">
      <div class="panel-stack">
        <div class="detail-card">
          <div class="panel-header">
            <div>
              <h3>Account controls</h3>
              <p class="muted small">Manage ownership, outreach motion, and next steps from one place.</p>
            </div>
            <button class="ghost-button" data-action="archive-account" data-id="${detail.account.id}">Pause account</button>
          </div>
          <form id="account-edit-form" class="detail-form" data-account-id="${detail.account.id}">
            ${renderField('Status', renderAccountStatusSelect('status', detail.account.status))}
            ${renderField('Outreach stage', `<select name="outreachStatus">${renderOutreachStageOptions(detail.account.outreachStatus)}</select>`)}
            ${renderField('Priority', renderPrioritySelect('priority', detail.account.priority || 'medium'))}
            ${renderField('Owner', `<input name="owner" value="${escapeAttr(detail.account.owner || '')}" placeholder="Owner or territory">`)}
            ${renderField('Domain', `<input name="domain" value="${escapeAttr(detail.account.domain || '')}" placeholder="company.com">`)}
            ${renderField('Careers URL', `<input name="careersUrl" value="${escapeAttr(detail.account.careersUrl || '')}" placeholder="https://company.com/careers">`)}
            ${renderField('Next action', `<input name="nextAction" value="${escapeAttr(detail.account.nextAction || '')}" placeholder="Reach out to VP Talent">`)}
            ${renderField('Next action date', `<input name="nextActionAt" type="date" value="${formatDateInput(detail.account.nextActionAt)}">`)}
            ${renderField('Location', `<input name="location" value="${escapeAttr(detail.account.location || '')}">`)}
            ${renderField('Industry', `<input name="industry" value="${escapeAttr(detail.account.industry || '')}">`)}
            ${renderField('Tags', `<input name="tags" value="${escapeAttr((detail.account.tags || []).join(', '))}" placeholder="fintech, warm intro, canada">`)}
            <div class="field field--wide"><label>Notes</label><textarea name="notes" rows="5">${escapeHtml(detail.account.notes || '')}</textarea></div>
            <div><button class="primary-button" type="submit">Save account updates</button></div>
          </form>
        </div>

        <div class="detail-card">
          <div class="panel-header"><div><h3>Hiring radar</h3><p class="muted small">Why this account is ranked where it is right now.</p></div></div>
          <div class="kpi-ribbon">
            ${renderMetricTile('Open roles', formatNumber(detail.account.openRoleCount || detail.account.jobCount))}
            ${renderMetricTile('Roles older than 30d', formatNumber(detail.account.staleRoleCount30d || 0))}
            ${renderMetricTile('Dept focus', detail.account.departmentFocus ? escapeHtml(detail.account.departmentFocus) : '—')}
            ${renderMetricTile('Follow-up score', formatNumber(detail.account.followUpScore || 0))}
          </div>
          <div class="timeline">
            ${Object.entries(scoreBreakdown).map(([key, value]) => `<article class="timeline-item"><div class="inline-header"><strong>${escapeHtml(humanize(key))}</strong><span class="small muted">${formatNumber(value)}</span></div></article>`).join('') || '<div class="empty-state">No score breakdown available yet.</div>'}
          </div>
        </div>

        <div class="detail-card">
          <div class="panel-header"><div><h3>Outreach prompt</h3><p class="muted small">A quick note to anchor your next conversation.</p></div></div>
          <div class="empty-state empty-state--compact">${escapeHtml(detail.account.outreachDraft)}</div>
        </div>

        <div class="detail-card">
          <div class="panel-header"><div><h3>Add activity</h3><p class="muted small">Log outreach, notes, and pipeline updates without leaving the account.</p></div></div>
          <form id="activity-form" class="detail-form">
            <input type="hidden" name="accountId" value="${detail.account.id}">
            <input type="hidden" name="normalizedCompanyName" value="${escapeAttr(detail.account.normalizedName)}">
            ${renderField('Summary', '<input name="summary" placeholder="Reached out to recruiting lead">')}
            ${renderField('Type', `<select name="type"><option value="note">Note</option><option value="outreach">Outreach</option><option value="pipeline">Pipeline update</option></select>`)}
            ${renderField('Pipeline stage', `<select name="pipelineStage"><option value="">No stage change</option>${renderOutreachStageOptions('')}</select>`)}
            <div class="field field--wide"><label>Notes</label><textarea name="notes" rows="4" placeholder="Context, follow-up timing, objections, decision makers"></textarea></div>
            <div><button class="secondary-button" type="submit">Add activity</button></div>
          </form>
        </div>
      </div>

      <div class="panel-stack">
        <div class="table-card">
          <div class="panel-header"><div><h3>ATS configs</h3><p class="muted small">Discovery results and import sources tied to this account.</p></div></div>
          ${detail.configs.length ? renderAccountConfigsTable(detail.configs) : '<div class="empty-state">No ATS config rows for this account yet.</div>'}
        </div>

        <div class="table-card">
          <div class="panel-header"><div><h3>Imported jobs</h3><p class="muted small">Recent hiring context tied directly to this company.</p></div></div>
          ${detail.jobs.length ? renderAccountJobsTable(detail.jobs) : '<div class="empty-state">No jobs connected to this account yet.</div>'}
        </div>

        <div class="table-card">
          <div class="panel-header"><div><h3>Top contacts</h3><p class="muted small">Best people to route outreach through at this account.</p></div></div>
          ${detail.contacts.length ? renderAccountContactsTable(detail.contacts) : '<div class="empty-state">No contacts imported for this company yet.</div>'}
        </div>

        <div class="detail-card">
          <div class="panel-header"><div><h3>Activity timeline</h3><p class="muted small">Recent outreach, notes, and stage changes for this company.</p></div></div>
          ${detail.activity.length ? `<div class="timeline">${detail.activity.map(renderTimelineItem).join('')}</div>` : '<div class="empty-state">No activity yet.</div>'}
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
  const stateBootstrap = await loadBootstrap(false, { includeFilters: true });
  const [configs, runtime, resolverReport, enrichmentReport, unresolvedQueue, mediumQueue, enrichmentQueue] = await Promise.all([
    api(`/api/configs${buildQuery(appState.configQuery)}`),
    loadRuntimeStatus(true),
    api('/api/configs/report'),
    api('/api/enrichment/report'),
    api(`/api/configs${buildQuery({ page: 1, pageSize: 8, confidenceBand: 'unresolved', reviewStatus: 'pending' })}`),
    api(`/api/configs${buildQuery({ page: 1, pageSize: 8, confidenceBand: 'medium', reviewStatus: 'pending' })}`),
    api(`/api/enrichment/queue${buildQuery(appState.enrichmentQuery)}`),
  ]);
  const summary = resolverReport.summary || {};
  const enrichmentSummary = enrichmentReport.summary || {};

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Pipeline operations</p>
          <h3>Admin and automation controls</h3>
          <p class="subtitle">Run discovery, import jobs, manage ATS resolution quality, and keep the outreach engine moving without falling back to the spreadsheet.</p>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Coverage', `${formatNumber(summary.coveragePercent || 0)}%`)}
          ${renderMetricTile('Resolved', formatNumber(summary.resolvedCount || 0))}
          ${renderMetricTile('Enriched', `${formatNumber(enrichmentSummary.enrichmentCoveragePercent || 0)}%`)}
          ${renderMetricTile('Needs review', formatNumber((summary.mediumReviewQueueCount || 0) + (summary.unresolvedReviewQueueCount || 0)))}
          ${renderMetricTile('Jobs running', formatNumber(runtime.runningJobs || 0))}
        </div>
      </div>
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
          <div class="panel-header"><div><h3>Enrichment review queue</h3><p class="muted small">Sorted by target score → connections → open roles. ${formatNumber(enrichmentQueue.total || 0)} companies in queue.</p></div></div>
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
          <div id="background-jobs-panel" class="timeline"></div>
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
                <input id="connections-csv-path" value="${escapeAttr(stateBootstrap.defaults.connectionsCsvPath || '')}" placeholder="C:\\Users\\...\\Connections.csv">
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
    <div class="table-scroll"><table class="table"><thead><tr><th>Company</th><th>Score</th><th>Hiring</th><th>Contacts</th><th>Network</th><th>Next move</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td><a class="row-link" href="#/accounts/${item.id}">${escapeHtml(item.displayName)}</a><div class="small muted">${escapeHtml(item.topContactName || item.domain || '')}</div></td>
          <td>${formatNumber(item.dailyScore)}<div class="small muted">${escapeHtml(humanize(item.priority || 'medium'))}</div></td>
          <td>${formatNumber(item.openRoleCount || item.jobCount)}<div class="small muted">${formatNumber(item.newRoleCount7d || 0)} new / 7d</div></td>
          <td>${formatNumber(item.connectionCount)}</td>
          <td>${renderStatusPill(item.networkStrength, toneForNetwork(item.networkStrength))}</td>
          <td>${escapeHtml(item.nextAction || item.recommendedAction || '')}</td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderRecentJobsTable(items) {
  return renderJobsTable(items.slice(0, 12), true);
}

function renderAccountsTable(items) {
  return `
    <div class="table-scroll"><table class="table"><thead><tr><th>Company</th><th>Score</th><th>Hiring radar</th><th>Owner / next step</th><th>Network</th><th>Status</th><th>ATS</th><th>Actions</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td><a class="row-link" href="#/accounts/${item.id}">${escapeHtml(item.displayName)}</a><div class="small muted">${escapeHtml(item.domain || item.topContactName || item.recommendedAction || '')}</div></td>
          <td>${formatNumber(item.dailyScore)}<div class="small muted">${escapeHtml(humanize(item.priority || 'medium'))}</div></td>
          <td>${formatNumber(item.openRoleCount || item.jobCount)} open<div class="small muted">${formatNumber(item.newRoleCount7d || 0)} new / 7d · ${escapeHtml(item.departmentFocus || 'No clear cluster')}</div></td>
          <td>${escapeHtml(item.owner || 'Unassigned')}<div class="small muted">${escapeHtml(item.nextAction || 'No next action set')}</div></td>
          <td>${renderStatusPill(item.networkStrength, toneForNetwork(item.networkStrength))}</td>
          <td>${renderStatusPill(item.status || 'new', 'neutral')}<div class="small muted">${escapeHtml(humanize(item.outreachStatus || 'not_started'))}</div></td>
          <td>${(item.atsTypes || []).map((type) => renderStatusPill(type, 'neutral')).join(' ') || '<span class="small muted">None</span>'}</td>
          <td><div class="button-row"><button class="ghost-button" data-action="open-account" data-id="${item.id}">Open</button><button class="ghost-button" data-action="archive-account" data-id="${item.id}">Pause</button></div></td>
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
        <option value="" ${selected(q.minTargetScore, '')}>All scores</option>
        <option value="50" ${selected(q.minTargetScore, '50')}>Score ≥ 50</option>
        <option value="100" ${selected(q.minTargetScore, '100')}>Score ≥ 100</option>
        <option value="200" ${selected(q.minTargetScore, '200')}>Score ≥ 200</option>
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
            <td>${escapeHtml(item.reviewReason || item.enrichmentFailureReason || '')}<div class="small muted">${safeJoin(item.aliases)}</div></td>
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
    <div class="panel-header"><div><h3>Enrichment review queue</h3><p class="muted small">Sorted by target score → connections → open roles. ${formatNumber(result.total || 0)} companies in queue.</p></div></div>
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
      <div class="inline-header">
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

function renderBackgroundJobItem(job) {
  const tone = job.status === 'completed'
    ? 'success'
    : (job.status === 'failed' ? 'danger' : 'neutral');

  return `
    <article class="timeline-item">
      <div class="inline-header">
        <strong>${escapeHtml(humanize(job.type || 'job'))}</strong>
        ${renderStatusPill(job.status || 'queued', tone)}
      </div>
      <p>${escapeHtml(job.progressMessage || job.summary || 'Waiting for work to start.')}</p>
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
      <option value="" ${selected(currentValue, '')}>Daily score</option>
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
      ? `Imported ${formatNumber(stats.imported || 0)} jobs with ${formatNumber(stats.errors || 0)} errors.`
      : `Imported ${formatNumber(stats.imported || 0)} jobs from ${formatNumber(stats.configs || 0)} ATS configs.`;
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
    const csvPath = getConnectionsCsvPath();
    const run = await api('/api/import/connections-csv', {
      method: 'POST',
      body: JSON.stringify({
        csvPath,
        dryRun,
        useEmptyState: dryRun,
      }),
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
    const message = dryRun
      ? `Dry run succeeded: ${formatNumber(stats.contacts || 0)} contacts across ${formatNumber(stats.companies || 0)} companies.`
      : `Imported ${formatNumber(stats.contacts || 0)} contacts across ${formatNumber(stats.companies || 0)} companies.`;
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
    ${renderSearchGroup('Accounts', results.accounts, (item) => `#/accounts/${item.id}`, (item) => escapeHtml(item.displayName), (item) => `${formatNumber(item.dailyScore)} score · ${formatNumber(item.jobCount)} jobs`)}
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
