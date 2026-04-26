const defaultAdminCollapsed = {
  'enrichment-coverage': true,
  'enrichment-queue': true,
  'resolver-coverage': true,
  'runtime-status': true,
  'background-jobs': true,
  'pipeline-ops': true,
  'scoring-settings': true,
  'automation-rules': true,
  'alert-thresholds': true,
  'ats-config-form': true,
  'ats-config-records': true,
};

function readJsonSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

const savedAdminCollapsed = readJsonSetting('bd_admin_collapsed', null);

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
  generatedOutreach: null,
  searchTimer: null,
  configEditingId: '',
  runtimeStatus: null,
  runtimePollTimer: null,
  savedFilters: JSON.parse(localStorage.getItem('bd_saved_filters') || '[]'),
  adminCollapsed: savedAdminCollapsed && typeof savedAdminCollapsed === 'object'
    ? { ...defaultAdminCollapsed, ...savedAdminCollapsed }
    : { ...defaultAdminCollapsed },
  showAdvancedFilters: false,
  outreachModalOpen: false,
  pendingOutreachContact: null,
  statusPillsExpanded: false,
  previousScores: {},
  theme: localStorage.getItem('bd_theme') || 'system',
  cmdPaletteOpen: false,
  lastKeyTime: 0,
  lastKey: '',
  mobileNavOpen: false,
  // Phase 5: Elite features
  columnPrefs: JSON.parse(localStorage.getItem('bd_col_prefs') || '{}'),
  kanbanMode: localStorage.getItem('bd_kanban') === 'true',
  automationRules: JSON.parse(localStorage.getItem('bd_auto_rules') || '[]'),
  scoreHistory: JSON.parse(localStorage.getItem('bd_score_history') || '{}'),
  smartAlerts: [],
  inlineEditCell: null,
  pwaInstallPrompt: null,
  accountNotes: JSON.parse(localStorage.getItem('bd_notes') || '{}'),
  stageTimestamps: JSON.parse(localStorage.getItem('bd_stage_ts') || '{}'),
  // Phase 6: Commercial-grade features
  onboardingDone: localStorage.getItem('bd_onboarding_done') === 'true',
  dashboardLayout: JSON.parse(localStorage.getItem('bd_dash_layout') || 'null'),
  dashboardCollapsed: JSON.parse(localStorage.getItem('bd_dash_collapsed') || '{}'),
  customFields: JSON.parse(localStorage.getItem('bd_custom_fields') || '[]'),
  outreachSequences: JSON.parse(localStorage.getItem('bd_sequences') || '[]'),
  activityLog: JSON.parse(localStorage.getItem('bd_activity_log') || '[]'),
  alertThresholds: JSON.parse(localStorage.getItem('bd_alert_thresholds') || '{"staleDays":14,"scoreDropMin":10,"hiringSpikeFactor":3,"hiringSpikMinJobs":5,"highScoreNoContacts":80,"highValueStaleMin":70}'),
  bulkLastClickIdx: null,
  duplicateCache: null,
  setupStatus: null,
  setupStep: 1,
  setupBusy: false,
  setupCsvContent: '',
  setupCsvFileName: '',
  setupPreview: null,
  setupResult: null,
  setupImportJobId: '',
  setupProgressMessage: '',
  setupDraft: {
    workspaceName: '',
    userName: '',
    userEmail: '',
    ownersText: '',
    licenseKey: '',
  },
};

const viewTitle = document.getElementById('view-title');
const appRoot = document.getElementById('app');
const workspaceName = document.getElementById('workspace-name');
const searchInput = document.getElementById('global-search-input');
const searchResults = document.getElementById('search-results');
const appAlert = document.getElementById('app-alert');
const refreshBootstrapButton = document.getElementById('refresh-bootstrap');
const breadcrumbsEl = document.getElementById('breadcrumbs');
const toastContainer = document.getElementById('toast-container');
const cmdPaletteBackdrop = document.getElementById('cmd-palette-backdrop');
const mobileNavBackdrop = document.getElementById('mobile-nav-backdrop');
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
const themeLabel = document.getElementById('theme-label');
const hamburgerBtn = document.getElementById('mobile-hamburger');

const defaultQueries = {
  accounts: { page: 1, pageSize: 20, q: '', hiring: '', ats: '', recencyDays: '', minContacts: '', minTargetScore: '', priority: '', status: '', owner: '', outreachStatus: '', industry: '', geography: '', sortBy: '' },
  contacts: { page: 1, pageSize: 20, q: '', minScore: '', outreachStatus: '' },
  jobs: { page: 1, pageSize: 20, q: '', ats: '', recencyDays: '', active: 'true', isNew: '', sortBy: '' },
  configs: { page: 1, pageSize: 20, q: '', ats: '', active: '', discoveryStatus: '', confidenceBand: '', reviewStatus: '' },
  enrichment: { page: 1, pageSize: 20, confidence: '', missingDomain: '', missingCareersUrl: '', hasConnections: '', minTargetScore: '', topN: '' },
};

function resetViewFilters(view) {
  if (view === 'accounts') {
    appState.accountQuery = { ...defaultQueries.accounts };
    appState.showAdvancedFilters = false;
    return renderAccountsView();
  }
  if (view === 'contacts') {
    appState.contactQuery = { ...defaultQueries.contacts };
    return renderContactsView();
  }
  if (view === 'jobs') {
    appState.jobQuery = { ...defaultQueries.jobs };
    return renderJobsView();
  }
  if (view === 'configs') {
    appState.configQuery = { ...defaultQueries.configs };
    return renderAdminView();
  }
  if (view === 'enrichment') {
    appState.enrichmentQuery = { ...defaultQueries.enrichment };
    return refreshEnrichmentPanel();
  }
  return Promise.resolve();
}

/* ── Theme system ── */
function applyTheme(mode) {
  appState.theme = mode;
  localStorage.setItem('bd_theme', mode);
  let effective = mode;
  if (mode === 'system') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effective);
  if (themeIcon) themeIcon.innerHTML = effective === 'dark' ? '&#9728;' : '&#9789;';
  if (themeLabel) themeLabel.textContent = effective === 'dark' ? 'Light' : 'Dark';
}

function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(appState.theme) + 1) % order.length];
  applyTheme(next);
  showToast(`Theme: ${next === 'system' ? 'System' : next.charAt(0).toUpperCase() + next.slice(1)}`, 'info');
}

applyTheme(appState.theme);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (appState.theme === 'system') applyTheme('system');
});

if (themeToggle) themeToggle.addEventListener('click', cycleTheme);

/* ── Toast notification system ── */
let toastId = 0;
function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '&#10003;', error: '&#10007;', warning: '&#9888;', info: '&#8505;' };
  const id = ++toastId;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-close" data-toast-id="${id}" aria-label="Dismiss">&times;</button>
  `;
  el.querySelector('.toast-close').addEventListener('click', () => dismissToast(el));
  toastContainer.appendChild(el);
  if (duration > 0) {
    setTimeout(() => dismissToast(el), duration);
  }
  return el;
}

function dismissToast(el) {
  if (!el || !el.parentNode) return;
  el.classList.add('toast-exit');
  setTimeout(() => el.remove(), 300);
}

function showUndoToast(message, undoFn, duration = 6000) {
  const el = document.createElement('div');
  el.className = 'toast toast--info toast--undo';
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <span class="toast-icon">&#8617;</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-undo-btn">Undo</button>
    <button class="toast-close" aria-label="Dismiss">&times;</button>
  `;
  let undone = false;
  el.querySelector('.toast-undo-btn').addEventListener('click', () => {
    if (!undone) { undone = true; undoFn(); dismissToast(el); showToast('Action undone.', 'success'); }
  });
  el.querySelector('.toast-close').addEventListener('click', () => dismissToast(el));
  toastContainer.appendChild(el);
  if (duration > 0) setTimeout(() => { if (!undone) dismissToast(el); }, duration);
  return el;
}

/* ── Mobile navigation ── */
function openMobileNav() {
  appState.mobileNavOpen = true;
  document.querySelector('.sidebar')?.classList.add('mobile-open');
  mobileNavBackdrop?.classList.add('open');
}

function closeMobileNav() {
  appState.mobileNavOpen = false;
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  mobileNavBackdrop?.classList.remove('open');
}

if (hamburgerBtn) hamburgerBtn.addEventListener('click', openMobileNav);
if (mobileNavBackdrop) mobileNavBackdrop.addEventListener('click', closeMobileNav);
document.querySelectorAll('.nav a').forEach(a => {
  a.addEventListener('click', () => closeMobileNav());
});

/* ── Command palette ── */
const cmdActions = [
  { id: 'nav-dashboard', label: 'Go to Dashboard', icon: '&#9632;', key: 'G D', action: () => { location.hash = '#/dashboard'; } },
  { id: 'nav-accounts', label: 'Go to Accounts', icon: '&#9632;', key: 'G A', action: () => { location.hash = '#/accounts'; } },
  { id: 'nav-contacts', label: 'Go to Contacts', icon: '&#9632;', key: 'G C', action: () => { location.hash = '#/contacts'; } },
  { id: 'nav-jobs', label: 'Go to Jobs', icon: '&#9632;', key: 'G J', action: () => { location.hash = '#/jobs'; } },
  { id: 'nav-admin', label: 'Go to Admin', icon: '&#9632;', key: 'G X', action: () => { location.hash = '#/admin'; } },
  { id: 'toggle-theme', label: 'Toggle theme', icon: '&#9789;', key: '', action: cycleTheme },
  { id: 'refresh', label: 'Refresh data', icon: '&#8635;', key: '', action: () => refreshBootstrapButton?.click() },
  { id: 'export-csv', label: 'Export current view as CSV', icon: '&#8615;', key: '', action: () => {
    const v = appState.activeView;
    if (v === 'accounts') document.querySelector('[data-action="exportAccountsCsv"]')?.click();
    else if (v === 'contacts') document.querySelector('[data-action="exportContactsCsv"]')?.click();
    else if (v === 'jobs') document.querySelector('[data-action="exportJobsCsv"]')?.click();
    else showToast('Export not available for this view', 'warning');
  }},
  { id: 'focus-search', label: 'Focus search', icon: '&#128269;', key: '/', action: () => { searchInput?.focus(); } },
];

let cmdPaletteIndex = 0;
let cmdFiltered = [...cmdActions];

function openCmdPalette() {
  appState.cmdPaletteOpen = true;
  cmdPaletteIndex = 0;
  cmdFiltered = [...cmdActions];
  cmdPaletteBackdrop.classList.remove('hidden');
  cmdPaletteBackdrop.innerHTML = `
    <div class="cmd-palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input class="cmd-palette-input" id="cmd-input" type="text" placeholder="Type a command..." autocomplete="off" />
      <div class="cmd-palette-list" id="cmd-list"></div>
    </div>
  `;
  renderCmdList();
  const input = document.getElementById('cmd-input');
  input?.focus();
  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    cmdFiltered = cmdActions.filter(a => a.label.toLowerCase().includes(q));
    cmdPaletteIndex = 0;
    renderCmdList();
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdPaletteIndex = Math.min(cmdPaletteIndex + 1, cmdFiltered.length - 1); renderCmdList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdPaletteIndex = Math.max(cmdPaletteIndex - 1, 0); renderCmdList(); }
    else if (e.key === 'Enter' && cmdFiltered[cmdPaletteIndex]) { e.preventDefault(); closeCmdPalette(); cmdFiltered[cmdPaletteIndex].action(); }
    else if (e.key === 'Escape') { closeCmdPalette(); }
  });
}

function closeCmdPalette() {
  appState.cmdPaletteOpen = false;
  cmdPaletteBackdrop.classList.add('hidden');
  cmdPaletteBackdrop.innerHTML = '';
}

function renderCmdList() {
  const list = document.getElementById('cmd-list');
  if (!list) return;
  if (!cmdFiltered.length) {
    list.innerHTML = '<div class="cmd-palette-empty">No matching commands</div>';
    return;
  }
  list.innerHTML = cmdFiltered.map((item, i) => `
    <div class="cmd-palette-item ${i === cmdPaletteIndex ? 'active' : ''}" data-cmd-idx="${i}">
      <span class="cmd-icon">${item.icon}</span>
      <span>${escapeHtml(item.label)}</span>
      ${item.key ? `<span class="cmd-key">${escapeHtml(item.key)}</span>` : ''}
    </div>
  `).join('');
  list.querySelectorAll('.cmd-palette-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.cmdIdx);
      closeCmdPalette();
      cmdFiltered[idx]?.action();
    });
    el.addEventListener('mouseenter', () => {
      cmdPaletteIndex = Number(el.dataset.cmdIdx);
      renderCmdList();
    });
  });
}

/* ── Breadcrumbs ── */
function renderBreadcrumbs(crumbs) {
  if (!breadcrumbsEl) return;
  if (!crumbs || crumbs.length <= 1) {
    breadcrumbsEl.innerHTML = '';
    return;
  }
  breadcrumbsEl.innerHTML = crumbs.map((c, i) => {
    if (i === crumbs.length - 1) return `<span class="bc-current">${escapeHtml(c.label)}</span>`;
    return `<a href="${escapeAttr(c.href)}">${escapeHtml(c.label)}</a><span class="bc-sep">&#8250;</span>`;
  }).join('');
}

/* ── Account health score helpers ── */
function computeHealthScore(account) {
  let score = 0;
  let max = 0;

  // Has contacts (20pts)
  max += 20;
  if ((account.contactCount || 0) > 0) score += Math.min(20, (account.contactCount || 0) * 5);

  // Active jobs (25pts)
  max += 25;
  if ((account.activeJobCount || 0) > 0) score += Math.min(25, (account.activeJobCount || 0) * 8);

  // Recent activity (20pts)
  max += 20;
  if (account.lastActivityDate) {
    const days = (Date.now() - new Date(account.lastActivityDate).getTime()) / 86400000;
    if (days < 7) score += 20;
    else if (days < 30) score += 12;
    else if (days < 90) score += 5;
  }

  // Target score (20pts)
  max += 20;
  const ts = account.targetScore || account.target_score || 0;
  score += Math.min(20, Math.round(ts * 2));

  // Has domain & enrichment (15pts)
  max += 15;
  if (account.domain) score += 8;
  if (account.careersUrl || account.careers_url) score += 7;

  return max > 0 ? Math.round((score / max) * 100) : 0;
}

function healthColor(score) {
  if (score >= 75) return 'var(--success)';
  if (score >= 45) return 'var(--warning)';
  return 'var(--danger)';
}

function renderHealthRing(score) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const pct = score / 100;
  const color = healthColor(score);
  return `<span class="health-ring" title="Health: ${score}%">
    <svg width="44" height="44"><circle cx="22" cy="22" r="${r}" fill="none" stroke="var(--bg-soft)" stroke-width="4"/>
    <circle cx="22" cy="22" r="${r}" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" stroke-linecap="round"/></svg>
    <span class="health-ring-label" style="color:${color}">${score}</span>
  </span>`;
}

/* ── Pipeline heatmap ── */
function renderPipelineHeatmap(accounts) {
  if (!accounts || !accounts.length) return '';

  const statuses = ['prospect', 'qualifying', 'active', 'nurture', 'closed_won', 'closed_lost'];
  const priorities = ['high', 'medium', 'low'];
  const grid = {};
  statuses.forEach(s => { grid[s] = {}; priorities.forEach(p => { grid[s][p] = 0; }); });

  accounts.forEach(a => {
    const s = (a.status || 'prospect').toLowerCase();
    const p = (a.priority || 'medium').toLowerCase();
    if (grid[s] && grid[s][p] !== undefined) grid[s][p]++;
  });

  const maxVal = Math.max(1, ...Object.values(grid).flatMap(row => Object.values(row)));

  function cellColor(count) {
    if (count === 0) return 'var(--bg-soft)';
    const intensity = Math.max(0.15, count / maxVal);
    return `rgba(31, 99, 216, ${intensity.toFixed(2)})`;
  }

  const cols = statuses.length + 1;
  let cells = `<div class="heatmap-label"></div>`;
  statuses.forEach(s => { cells += `<div class="heatmap-label">${escapeHtml(humanize(s))}</div>`; });

  priorities.forEach(p => {
    cells += `<div class="heatmap-label" style="text-align:right;padding-right:6px;">${escapeHtml(humanize(p))}</div>`;
    statuses.forEach(s => {
      const v = grid[s][p];
      const bg = cellColor(v);
      const textColor = v / maxVal > 0.5 ? '#fff' : 'var(--text)';
      cells += `<div class="heatmap-cell" style="background:${bg};color:${textColor}" title="${humanize(p)} / ${humanize(s)}: ${v}">${v || ''}</div>`;
    });
  });

  return `
    <div class="chart-card">
      <div class="card-header"><h3>Pipeline Heatmap</h3><p class="small muted">Accounts by status &times; priority</p></div>
      <div class="heatmap-grid" style="grid-template-columns: 70px repeat(${statuses.length}, 1fr);">${cells}</div>
      <div class="heatmap-legend">
        <span>Less</span>
        <span class="heatmap-swatch" style="background:rgba(31,99,216,0.15)"></span>
        <span class="heatmap-swatch" style="background:rgba(31,99,216,0.4)"></span>
        <span class="heatmap-swatch" style="background:rgba(31,99,216,0.7)"></span>
        <span class="heatmap-swatch" style="background:rgba(31,99,216,1)"></span>
        <span>More</span>
      </div>
    </div>
  `;
}

/* ── Sparkline mini-charts ── */
function recordScoreHistory(accountId, score) {
  if (!accountId || score === undefined) return;
  const history = appState.scoreHistory;
  if (!history[accountId]) history[accountId] = [];
  const today = new Date().toISOString().slice(0, 10);
  const last = history[accountId][history[accountId].length - 1];
  if (last && last.d === today) { last.v = score; }
  else { history[accountId].push({ d: today, v: score }); }
  if (history[accountId].length > 14) history[accountId] = history[accountId].slice(-14);
  try { localStorage.setItem('bd_score_history', JSON.stringify(history)); } catch(e) { /* quota */ }
}

function renderSparkline(accountId, width = 60, height = 20) {
  const points = (appState.scoreHistory[accountId] || []).map(p => p.v);
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points, min + 1);
  const step = width / (points.length - 1);
  const coords = points.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / (max - min)) * height).toFixed(1)}`).join(' ');
  const trend = points[points.length - 1] >= points[0] ? 'var(--success)' : 'var(--danger)';
  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><polyline points="${coords}" fill="none" stroke="${trend}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

/* ── Kanban board ── */
function renderKanbanBoard(items) {
  const columns = [
    { key: 'new', label: 'New', tone: 'neutral' },
    { key: 'researching', label: 'Researching', tone: 'accent' },
    { key: 'contacted', label: 'Contacted', tone: 'warning' },
    { key: 'in_conversation', label: 'In Conversation', tone: 'success' },
    { key: 'client', label: 'Client', tone: 'hot' },
    { key: 'paused', label: 'Paused', tone: 'neutral' },
  ];
  const grouped = {};
  columns.forEach(c => { grouped[c.key] = []; });
  items.forEach(item => {
    const status = (item.status || 'new').toLowerCase();
    if (grouped[status]) grouped[status].push(item);
    else grouped['new'].push(item);
  });

  return `
    <div class="kanban-board" id="kanban-board">
      ${columns.map(col => `
        <div class="kanban-column" data-status="${col.key}">
          <div class="kanban-column-header">
            <span class="kanban-column-title">${col.label}</span>
            <span class="kanban-column-count">${grouped[col.key].length}</span>
          </div>
          <div class="kanban-column-body" data-status="${col.key}">
            ${grouped[col.key].map(item => `
              <div class="kanban-card" draggable="true" data-id="${item.id}" data-status="${col.key}">
                <div class="kanban-card-header">
                  <a class="kanban-card-title" href="#/accounts/${item.id}">${escapeHtml(item.displayName)}</a>
                  ${renderHealthRing(computeHealthScore(item))}
                </div>
                <div class="kanban-card-score">${formatNumber(getTargetScore(item))} pts ${renderSparkline(item.id, 48, 16)}</div>
                <div class="kanban-card-meta">${escapeHtml(item.owner || 'Unassigned')} · ${formatNumber(item.hiringVelocity || 0)} velocity</div>
                ${item.nextAction ? `<div class="kanban-card-action small muted">${escapeHtml(item.nextAction)}</div>` : ''}
                <div class="kanban-card-pills">
                  ${renderStatusPill(item.priority || 'medium', 'warm')}
                  ${renderStatusPill(item.outreachStatus || 'not_started', 'neutral')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function wireKanbanDragDrop() {
  const board = document.getElementById('kanban-board');
  if (!board) return;
  let dragEl = null;
  board.addEventListener('dragstart', (e) => {
    dragEl = e.target.closest('.kanban-card');
    if (dragEl) { dragEl.classList.add('kanban-card--dragging'); e.dataTransfer.effectAllowed = 'move'; }
  });
  board.addEventListener('dragend', () => {
    if (dragEl) dragEl.classList.remove('kanban-card--dragging');
    document.querySelectorAll('.kanban-column-body--over').forEach(el => el.classList.remove('kanban-column-body--over'));
    dragEl = null;
  });
  board.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const col = e.target.closest('.kanban-column-body');
    if (col) col.classList.add('kanban-column-body--over');
  });
  board.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.kanban-column-body');
    if (col) col.classList.remove('kanban-column-body--over');
  });
  board.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.querySelectorAll('.kanban-column-body--over').forEach(el => el.classList.remove('kanban-column-body--over'));
    if (!dragEl) return;
    const col = e.target.closest('.kanban-column-body');
    if (!col) return;
    const newStatus = col.dataset.status;
    const accountId = dragEl.dataset.id;
    const oldStatus = dragEl.dataset.status;
    if (newStatus === oldStatus) return;
    col.appendChild(dragEl);
    dragEl.dataset.status = newStatus;
    // Update counts
    document.querySelectorAll('.kanban-column').forEach(c => {
      const body = c.querySelector('.kanban-column-body');
      const count = c.querySelector('.kanban-column-count');
      if (body && count) count.textContent = body.children.length;
    });
    // Persist
    try {
      await api(`/api/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
      invalidateAppData();
      trackStageChange(accountId, newStatus);
      showUndoToast(`Moved to ${humanize(newStatus)}`, async () => {
        await api(`/api/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify({ status: oldStatus }) });
        invalidateAppData();
        await renderAccountsView();
      });
    } catch (err) {
      showToast('Failed to update status: ' + (err.message || err), 'error');
    }
  });
}

/* ── Column customization ── */
const defaultAccountCols = ['company', 'health', 'targetScore', 'signalMix', 'owner', 'network', 'status', 'ats', 'actions'];
function getVisibleCols(viewKey) {
  return appState.columnPrefs[viewKey] || defaultAccountCols;
}
function setVisibleCols(viewKey, cols) {
  appState.columnPrefs[viewKey] = cols;
  localStorage.setItem('bd_col_prefs', JSON.stringify(appState.columnPrefs));
}
function renderColumnCustomizer(viewKey, allCols) {
  const visible = getVisibleCols(viewKey);
  return `
    <div class="col-customizer">
      <button class="ghost-button col-customizer-toggle" id="col-customizer-toggle" aria-label="Customize columns">&#9881; Columns</button>
      <div class="col-customizer-dropdown hidden" id="col-customizer-dropdown">
        ${allCols.map(col => `
          <label class="col-customizer-item">
            <input type="checkbox" data-col="${col.key}" ${visible.includes(col.key) ? 'checked' : ''}>
            ${escapeHtml(col.label)}
          </label>
        `).join('')}
        <button class="ghost-button ghost-button--xs col-customizer-reset" id="col-customizer-reset">Reset to default</button>
      </div>
    </div>
  `;
}
function wireColumnCustomizer(viewKey, allCols, rerenderFn) {
  const toggle = document.getElementById('col-customizer-toggle');
  const dropdown = document.getElementById('col-customizer-dropdown');
  if (!toggle || !dropdown) return;
  toggle.addEventListener('click', () => dropdown.classList.toggle('hidden'));
  dropdown.addEventListener('change', (e) => {
    if (!e.target.dataset.col) return;
    const visible = [];
    dropdown.querySelectorAll('input[data-col]').forEach(cb => { if (cb.checked) visible.push(cb.dataset.col); });
    setVisibleCols(viewKey, visible);
    rerenderFn();
  });
  const reset = document.getElementById('col-customizer-reset');
  if (reset) reset.addEventListener('click', () => { setVisibleCols(viewKey, defaultAccountCols); rerenderFn(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.col-customizer')) dropdown.classList.add('hidden');
  }, { once: false });
}

/* ── Inline editing ── */
function wireInlineEditing() {
  document.querySelectorAll('[data-inline-edit]').forEach(cell => {
    cell.addEventListener('dblclick', () => {
      if (cell.querySelector('input, select')) return;
      const field = cell.dataset.inlineEdit;
      const accountId = cell.dataset.accountId;
      const currentVal = cell.dataset.currentValue || cell.textContent.trim();
      const original = cell.innerHTML;
      cell.innerHTML = `<input class="inline-edit-input" value="${escapeAttr(currentVal)}" data-field="${field}" data-account-id="${accountId}" autofocus>`;
      const input = cell.querySelector('input');
      input.focus();
      input.select();
      const save = async () => {
        const newVal = input.value.trim();
        if (newVal === currentVal) { cell.innerHTML = original; return; }
        cell.innerHTML = `<span class="inline-edit-saving">Saving...</span>`;
        try {
          await api(`/api/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify({ [field]: newVal }) });
          invalidateAppData();
          cell.textContent = newVal;
          cell.dataset.currentValue = newVal;
          showToast(`${humanize(field)} updated.`, 'success');
        } catch(err) {
          cell.innerHTML = original;
          showToast('Save failed: ' + (err.message || err), 'error');
        }
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { cell.innerHTML = original; } });
      input.addEventListener('blur', save);
    });
  });
}

/* ── Smart alerts / anomaly detection ── */
function detectSmartAlerts(accounts) {
  const alerts = [];
  accounts.forEach(a => {
    const prev = appState.previousScores[a.id];
    const current = getTargetScore(a);
    // Score drop > 10
    if (prev !== undefined && current < prev - 10) {
      alerts.push({ type: 'score_drop', accountId: a.id, name: a.displayName, message: `Score dropped ${prev - current} points (${prev} → ${current})`, severity: 'warning' });
    }
    // Stale + high score
    if (a.staleFlag === 'STALE' && current >= 70) {
      alerts.push({ type: 'stale_high_value', accountId: a.id, name: a.displayName, message: `High-value account (${current} pts) hasn't been touched in 14+ days`, severity: 'danger' });
    }
    // Sudden hiring spike
    if ((a.hiringSpikeRatio || 0) > 3 && (a.jobsLast30Days || 0) >= 5) {
      alerts.push({ type: 'hiring_spike', accountId: a.id, name: a.displayName, message: `Hiring spike: ${a.jobsLast30Days} jobs in 30d (${a.hiringSpikeRatio}x normal)`, severity: 'success' });
    }
    // No contact on high-score account
    if (current >= 80 && (a.contactCount || 0) === 0) {
      alerts.push({ type: 'no_contacts', accountId: a.id, name: a.displayName, message: `${current}-point account has no mapped contacts`, severity: 'warning' });
    }
  });
  appState.smartAlerts = alerts;
  return alerts;
}

function renderSmartAlerts(alerts) {
  if (!alerts || !alerts.length) return '';
  const icons = { warning: '&#9888;', danger: '&#10071;', success: '&#9889;', info: '&#8505;' };
  return `
    <section class="smart-alerts-panel">
      <div class="panel-header"><div><h3>&#9889; Smart Alerts</h3><p class="muted small">Anomalies and opportunities detected from your pipeline signals.</p></div><span class="smart-alerts-badge">${alerts.length}</span></div>
      <div class="smart-alerts-list">
        ${alerts.slice(0, 8).map(a => `
          <div class="smart-alert smart-alert--${a.severity}">
            <span class="smart-alert-icon">${icons[a.severity] || icons.info}</span>
            <div class="smart-alert-body">
              <strong>${escapeHtml(a.name)}</strong>
              <p>${escapeHtml(a.message)}</p>
            </div>
            <button class="ghost-button ghost-button--xs" data-action="open-account" data-id="${a.accountId}">View</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

/* ── Deal velocity / stage tracking ── */
function trackStageChange(accountId, newStage) {
  const timestamps = appState.stageTimestamps;
  if (!timestamps[accountId]) timestamps[accountId] = [];
  timestamps[accountId].push({ stage: newStage, at: new Date().toISOString() });
  if (timestamps[accountId].length > 20) timestamps[accountId] = timestamps[accountId].slice(-20);
  try { localStorage.setItem('bd_stage_ts', JSON.stringify(timestamps)); } catch(e) { /* quota */ }
}

function computeStageVelocity(accountId) {
  const history = appState.stageTimestamps[accountId] || [];
  if (history.length < 2) return null;
  const first = new Date(history[0].at).getTime();
  const last = new Date(history[history.length - 1].at).getTime();
  const stages = history.length - 1;
  const avgDays = Math.round((last - first) / (stages * 86400000));
  return { stages, avgDaysPerStage: avgDays, currentStage: history[history.length - 1].stage };
}

function renderDealVelocity(accounts) {
  if (!Array.isArray(accounts)) return '';
  const velocities = accounts.map(a => {
    const v = computeStageVelocity(a.id);
    return v ? { ...v, name: a.displayName, id: a.id, score: getTargetScore(a) } : null;
  }).filter(Boolean);
  const stuck = velocities.filter(v => v.avgDaysPerStage > 14);
  if (!velocities.length) return '';
  return `
    <div class="chart-card">
      <div class="card-header"><h3>Deal Velocity</h3><p class="small muted">${stuck.length ? `${stuck.length} deals stuck (>14 days avg per stage)` : 'All deals moving at healthy pace'}</p></div>
      <div class="velocity-stats">
        ${velocities.slice(0, 6).map(v => `
          <div class="velocity-stat ${v.avgDaysPerStage > 14 ? 'velocity-stat--stuck' : ''}">
            <a href="#/accounts/${v.id}" class="row-link"><strong>${escapeHtml(v.name)}</strong></a>
            <span>${v.avgDaysPerStage}d avg</span>
            <span class="small muted">${v.stages} stage moves</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* ── Account notes / comments ── */
function addAccountNote(accountId, text) {
  if (!text || !text.trim()) return;
  const notes = appState.accountNotes;
  if (!notes[accountId]) notes[accountId] = [];
  notes[accountId].unshift({ text: text.trim(), at: new Date().toISOString(), id: Date.now() });
  if (notes[accountId].length > 50) notes[accountId] = notes[accountId].slice(0, 50);
  try { localStorage.setItem('bd_notes', JSON.stringify(notes)); } catch(e) { /* quota */ }
}

function deleteAccountNote(accountId, noteId) {
  const notes = appState.accountNotes;
  if (!notes[accountId]) return;
  notes[accountId] = notes[accountId].filter(n => n.id !== noteId);
  try { localStorage.setItem('bd_notes', JSON.stringify(notes)); } catch(e) { /* quota */ }
}

function renderAccountNotesPanel(accountId) {
  const notes = appState.accountNotes[accountId] || [];
  return `
    <div class="detail-card notes-panel">
      <div class="panel-header"><div><h3>Quick Notes</h3><p class="muted small">Team-visible notes saved locally.</p></div></div>
      <div class="notes-input-row">
        <input id="note-input" class="compact-input" placeholder="Add a note..." maxlength="500">
        <button class="secondary-button compact-btn" id="add-note-btn" data-account-id="${accountId}">Add</button>
      </div>
      <div class="notes-list">
        ${notes.length ? notes.map(n => `
          <div class="note-item">
            <p>${escapeHtml(n.text)}</p>
            <div class="note-meta"><span class="small muted">${formatDate(n.at)}</span><button class="note-delete" data-account-id="${accountId}" data-note-id="${n.id}" aria-label="Delete note">&times;</button></div>
          </div>
        `).join('') : '<div class="empty-state empty-state--compact">No notes yet.</div>'}
      </div>
    </div>
  `;
}

/* ── Automation rules engine ── */
function addAutomationRule(rule) {
  appState.automationRules.push({ ...rule, id: Date.now(), enabled: true });
  try { localStorage.setItem('bd_auto_rules', JSON.stringify(appState.automationRules)); } catch(e) { /* quota */ }
}

function deleteAutomationRule(ruleId) {
  appState.automationRules = appState.automationRules.filter(r => r.id !== ruleId);
  try { localStorage.setItem('bd_auto_rules', JSON.stringify(appState.automationRules)); } catch(e) { /* quota */ }
}

function toggleAutomationRule(ruleId) {
  const rule = appState.automationRules.find(r => r.id === ruleId);
  if (rule) rule.enabled = !rule.enabled;
  try { localStorage.setItem('bd_auto_rules', JSON.stringify(appState.automationRules)); } catch(e) { /* quota */ }
}

function evaluateAutomationRules(account) {
  const triggered = [];
  appState.automationRules.filter(r => r.enabled).forEach(rule => {
    let match = true;
    if (rule.trigger === 'status_change' && rule.triggerValue && account.status !== rule.triggerValue) match = false;
    if (rule.trigger === 'score_above' && getTargetScore(account) < Number(rule.triggerValue)) match = false;
    if (rule.trigger === 'score_below' && getTargetScore(account) > Number(rule.triggerValue)) match = false;
    if (rule.trigger === 'stale' && account.staleFlag !== 'STALE') match = false;
    if (match) triggered.push(rule);
  });
  return triggered;
}

function renderAutomationRulesPanel() {
  return `
    <div class="detail-card automation-panel">
      <div class="panel-header"><div><h3>Automation Rules</h3><p class="muted small">When conditions are met, auto-apply actions.</p></div></div>
      <div class="automation-form" id="automation-form">
        <select id="auto-trigger">
          <option value="status_change">When status changes to...</option>
          <option value="score_above">When score rises above...</option>
          <option value="score_below">When score drops below...</option>
          <option value="stale">When account goes stale</option>
        </select>
        <input id="auto-trigger-value" placeholder="Value (e.g. qualified, 80)" class="compact-input">
        <select id="auto-action">
          <option value="assign_owner">Assign owner</option>
          <option value="set_priority">Set priority</option>
          <option value="notify">Show notification</option>
        </select>
        <input id="auto-action-value" placeholder="Owner name / priority / message" class="compact-input">
        <button class="secondary-button compact-btn" id="add-auto-rule">Add Rule</button>
      </div>
      <div class="automation-rules-list">
        ${appState.automationRules.length ? appState.automationRules.map(r => `
          <div class="automation-rule ${r.enabled ? '' : 'automation-rule--disabled'}">
            <div class="automation-rule-text">When <strong>${escapeHtml(humanize(r.trigger))}</strong> ${r.triggerValue ? `= "${escapeHtml(r.triggerValue)}"` : ''} → <strong>${escapeHtml(humanize(r.action))}</strong>: "${escapeHtml(r.actionValue)}"</div>
            <div class="automation-rule-actions">
              <button class="ghost-button ghost-button--xs" data-toggle-rule="${r.id}">${r.enabled ? 'Disable' : 'Enable'}</button>
              <button class="ghost-button ghost-button--xs" data-delete-rule="${r.id}">&times;</button>
            </div>
          </div>
        `).join('') : '<div class="empty-state empty-state--compact">No automation rules configured.</div>'}
      </div>
    </div>
  `;
}

/* ── PWA support ── */
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  appState.pwaInstallPrompt = e;
  const btn = document.getElementById('pwa-install-btn');
  if (btn) btn.classList.remove('hidden');
});

function promptPwaInstall() {
  if (!appState.pwaInstallPrompt) return;
  appState.pwaInstallPrompt.prompt();
  appState.pwaInstallPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted') showToast('BD Engine installed!', 'success');
    appState.pwaInstallPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.classList.add('hidden');
  });
}

/* ── Notification API ── */
async function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') return true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function sendDesktopNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' }); } catch(e) { /* mobile */ }
}

/* ── Phase 6: Interactive SVG charts ── */
function renderSvgLineChart(data, width = 320, height = 120, label = '') {
  if (!data || data.length < 2) return '';
  const pad = { t: 20, r: 10, b: 30, l: 40 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const maxVal = Math.max(1, ...data.map(d => d.value));
  const minVal = Math.min(0, ...data.map(d => d.value));
  const range = maxVal - minVal || 1;
  const points = data.map((d, i) => ({
    x: pad.l + (i / (data.length - 1)) * w,
    y: pad.t + h - ((d.value - minVal) / range) * h,
    label: d.label,
    value: d.value,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaD = pathD + ` L${points[points.length-1].x},${pad.t+h} L${points[0].x},${pad.t+h} Z`;
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = pad.t + h - f * h;
    const val = Math.round(minVal + f * range);
    return `<line x1="${pad.l}" y1="${y}" x2="${pad.l+w}" y2="${y}" stroke="var(--line)" stroke-dasharray="3"/>
      <text x="${pad.l-4}" y="${y+3}" text-anchor="end" fill="var(--muted)" font-size="9">${val}</text>`;
  }).join('');
  const xLabels = data.length <= 8 ? points.map(p => `<text x="${p.x}" y="${pad.t+h+14}" text-anchor="middle" fill="var(--muted)" font-size="8">${escapeHtml(p.label)}</text>`).join('')
    : [points[0], points[Math.floor(points.length/2)], points[points.length-1]].map(p => `<text x="${p.x}" y="${pad.t+h+14}" text-anchor="middle" fill="var(--muted)" font-size="8">${escapeHtml(p.label)}</text>`).join('');
  const dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"><title>${escapeHtml(p.label)}: ${p.value}</title></circle>`).join('');
  return `<div class="svg-chart"><svg width="${width}" height="${height}" class="chart-svg">
    ${gridLines}${xLabels}
    <path d="${areaD}" fill="var(--accent-soft)" opacity="0.3"/>
    <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
    ${dots}
    ${label ? `<text x="${pad.l}" y="12" fill="var(--text)" font-size="11" font-weight="600">${escapeHtml(label)}</text>` : ''}
  </svg></div>`;
}

function renderSvgBarChart(data, width = 320, height = 140, label = '') {
  if (!data || !data.length) return '';
  const pad = { t: 22, r: 10, b: 34, l: 44 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const maxVal = Math.max(1, ...data.map(d => d.value));
  const barW = Math.min(30, (w / data.length) * 0.65);
  const gap = (w - barW * data.length) / (data.length + 1);
  const bars = data.map((d, i) => {
    const x = pad.l + gap + i * (barW + gap);
    const barH = (d.value / maxVal) * h;
    const y = pad.t + h - barH;
    const color = d.color || 'var(--accent)';
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${color}" opacity="0.85"><title>${escapeHtml(d.label)}: ${d.value}</title></rect>
      <text x="${x + barW/2}" y="${y - 4}" text-anchor="middle" fill="var(--text)" font-size="9" font-weight="600">${d.value}</text>
      <text x="${x + barW/2}" y="${pad.t+h+12}" text-anchor="middle" fill="var(--muted)" font-size="8">${escapeHtml(d.label.slice(0, 8))}</text>`;
  }).join('');
  return `<div class="svg-chart"><svg width="${width}" height="${height}" class="chart-svg">
    <line x1="${pad.l}" y1="${pad.t+h}" x2="${pad.l+w}" y2="${pad.t+h}" stroke="var(--line)"/>
    ${bars}
    ${label ? `<text x="${pad.l}" y="14" fill="var(--text)" font-size="11" font-weight="600">${escapeHtml(label)}</text>` : ''}
  </svg></div>`;
}

function renderConversionFunnel(stages, width = 320, height = 160) {
  if (!stages || !stages.length) return '';
  const maxVal = Math.max(1, stages[0].value);
  const pad = 14;
  const stageH = (height - pad * 2) / stages.length;
  const shapes = stages.map((s, i) => {
    const wPct = Math.max(0.15, s.value / maxVal);
    const nextPct = i < stages.length - 1 ? Math.max(0.15, stages[i + 1].value / maxVal) : wPct * 0.85;
    const x1 = (width / 2) - (wPct * width * 0.4);
    const x2 = (width / 2) + (wPct * width * 0.4);
    const x3 = (width / 2) + (nextPct * width * 0.4);
    const x4 = (width / 2) - (nextPct * width * 0.4);
    const y1 = pad + i * stageH;
    const y2 = pad + (i + 1) * stageH;
    const colors = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--muted)'];
    const color = s.color || colors[i % colors.length];
    const convRate = i > 0 ? Math.round((s.value / stages[i - 1].value) * 100) : 100;
    return `<path d="M${x1},${y1} L${x2},${y1} L${x3},${y2} L${x4},${y2} Z" fill="${color}" opacity="0.7"/>
      <text x="${width/2}" y="${y1 + stageH/2 + 4}" text-anchor="middle" fill="var(--surface-strong)" font-size="10" font-weight="600">${escapeHtml(s.label)} (${s.value})</text>
      ${i > 0 ? `<text x="${width - 8}" y="${y1 + stageH/2 + 3}" text-anchor="end" fill="var(--muted)" font-size="8">${convRate}%</text>` : ''}`;
  }).join('');
  return `<div class="svg-chart"><svg width="${width}" height="${height}" class="chart-svg">${shapes}</svg></div>`;
}

/* ── Phase 6: Team performance leaderboard ── */
function renderTeamLeaderboard(accounts) {
  if (!Array.isArray(accounts)) return '';
  const owners = {};
  accounts.forEach(a => {
    const o = a.owner || 'Unassigned';
    if (!owners[o]) owners[o] = { name: o, count: 0, totalScore: 0, hiring: 0, outreach: 0, engaged: 0 };
    owners[o].count++;
    owners[o].totalScore += getTargetScore(a);
    if ((a.jobCount || 0) > 0) owners[o].hiring++;
    if (a.outreachStatus === 'contacted' || a.outreachStatus === 'replied') owners[o].outreach++;
    if (a.status === 'engaged' || a.status === 'client') owners[o].engaged++;
  });
  const ranked = Object.values(owners).sort((a, b) => b.totalScore - a.totalScore);
  if (ranked.length < 2) return '';
  return `
    <section class="detail-card team-leaderboard">
      <div class="panel-header"><div><h3>Team leaderboard</h3><p class="muted small">Owner performance ranked by aggregate pipeline score.</p></div></div>
      <div class="table-scroll"><table class="table"><thead><tr><th>#</th><th>Owner</th><th>Accounts</th><th>Avg score</th><th>Hiring</th><th>Outreach</th><th>Engaged</th></tr></thead><tbody>
        ${ranked.map((o, i) => `<tr${i === 0 ? ' class="row--highlight"' : ''}>
          <td><span class="leaderboard-rank">${i + 1}</span></td>
          <td><strong>${escapeHtml(o.name)}</strong></td>
          <td>${o.count}</td>
          <td>${Math.round(o.totalScore / o.count)}</td>
          <td>${o.hiring}</td>
          <td>${o.outreach}</td>
          <td>${o.engaged}</td>
        </tr>`).join('')}
      </tbody></table></div>
    </section>`;
}

/* ── Phase 6: Data quality scoring ── */
function computeDataQuality(account) {
  const checks = [
    { label: 'Domain', ok: Boolean(account.domain) },
    { label: 'Careers URL', ok: Boolean(account.careersUrl || account.careers_url) },
    { label: 'Contacts', ok: (account.contactCount || 0) > 0 },
    { label: 'Active jobs', ok: (account.activeJobCount || account.jobCount || 0) > 0 },
    { label: 'Owner', ok: Boolean(account.owner) },
    { label: 'Industry', ok: Boolean(account.industry) },
    { label: 'Next action', ok: Boolean(account.nextAction) },
    { label: 'Notes', ok: Boolean(account.notes) },
  ];
  const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
  return { score, checks };
}

function renderDataQualityBadge(account) {
  const { score } = computeDataQuality(account);
  const color = score >= 75 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
  return `<span class="dq-badge" style="color:${color}" title="Data quality: ${score}%">${score}%</span>`;
}

function renderDataQualityPanel(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return '';
  const scores = accounts.map(a => computeDataQuality(a).score);
  const avg = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
  const dist = { excellent: scores.filter(s => s >= 75).length, good: scores.filter(s => s >= 50 && s < 75).length, poor: scores.filter(s => s < 50).length };
  const fieldGaps = {};
  accounts.forEach(a => {
    const { checks } = computeDataQuality(a);
    checks.forEach(c => { if (!c.ok) { fieldGaps[c.label] = (fieldGaps[c.label] || 0) + 1; } });
  });
  const topGaps = Object.entries(fieldGaps).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `
    <section class="detail-card data-quality-panel">
      <div class="panel-header"><div><h3>Data quality</h3><p class="muted small">Completeness of your pipeline data across ${accounts.length} accounts.</p></div></div>
      <div class="dq-summary">
        <div class="dq-score-big" style="color:${avg >= 75 ? 'var(--success)' : avg >= 50 ? 'var(--warning)' : 'var(--danger)'}">${avg}%</div>
        <div class="dq-distribution">
          ${renderSignalChip('Excellent', dist.excellent, 'success')}
          ${renderSignalChip('Good', dist.good, 'accent')}
          ${renderSignalChip('Poor', dist.poor, 'warning')}
        </div>
      </div>
      ${topGaps.length ? `<div class="dq-gaps"><p class="small muted">Top missing fields:</p>${topGaps.map(([f, c]) => `<span class="dq-gap-chip">${escapeHtml(f)} <strong>${c}</strong></span>`).join('')}</div>` : ''}
    </section>`;
}

/* ── Phase 6: Duplicate detection ── */
function normalizeForDupeCheck(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(inc|corp|ltd|llc|co|company|technologies|tech|group|holdings|solutions)$/g, '');
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

function detectDuplicates(accounts) {
  if (!Array.isArray(accounts)) return [];
  const groups = [];
  const used = new Set();
  for (let i = 0; i < accounts.length; i++) {
    if (used.has(accounts[i].id)) continue;
    const normI = normalizeForDupeCheck(accounts[i].displayName);
    if (!normI) continue;
    const dupes = [];
    for (let j = i + 1; j < accounts.length; j++) {
      if (used.has(accounts[j].id)) continue;
      const normJ = normalizeForDupeCheck(accounts[j].displayName);
      if (!normJ) continue;
      const dist = levenshtein(normI, normJ);
      const maxLen = Math.max(normI.length, normJ.length, 1);
      const similarity = 1 - dist / maxLen;
      if (similarity >= 0.75 || normI.includes(normJ) || normJ.includes(normI)) {
        dupes.push(accounts[j]);
        used.add(accounts[j].id);
      }
    }
    if (dupes.length) {
      used.add(accounts[i].id);
      groups.push({ primary: accounts[i], duplicates: dupes });
    }
  }
  appState.duplicateCache = groups;
  return groups;
}

function renderDuplicatePanel(dupeGroups) {
  if (!dupeGroups || !dupeGroups.length) return '';
  return `
    <section class="detail-card duplicate-panel">
      <div class="panel-header"><div><h3>Possible duplicates</h3><p class="muted small">${dupeGroups.length} potential duplicate group${dupeGroups.length > 1 ? 's' : ''} found.</p></div></div>
      <div class="duplicate-groups">
        ${dupeGroups.slice(0, 10).map(g => `
          <div class="duplicate-group">
            <div class="dupe-primary">
              <a href="#/accounts/${g.primary.id}" class="row-link"><strong>${escapeHtml(g.primary.displayName)}</strong></a>
              <span class="small muted">${escapeHtml(g.primary.domain || '')} · Score: ${getTargetScore(g.primary)}</span>
            </div>
            <div class="dupe-matches">
              ${g.duplicates.map(d => `
                <div class="dupe-match">
                  <a href="#/accounts/${d.id}" class="row-link">${escapeHtml(d.displayName)}</a>
                  <span class="small muted">${escapeHtml(d.domain || '')} · Score: ${getTargetScore(d)}</span>
                  <button class="ghost-button ghost-button--xs" data-action="merge-duplicate" data-keep="${g.primary.id}" data-remove="${d.id}">Merge into primary</button>
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>
    </section>`;
}

/* ── Phase 6: Guided onboarding tour ── */
function renderOnboardingTour() {
  if (appState.onboardingDone) return '';
  return `
    <div class="onboarding-overlay" id="onboarding-overlay">
      <div class="onboarding-modal">
        <div class="onboarding-header">
          <h2>Welcome to BD Engine</h2>
          <p>Let's get you set up in 3 steps.</p>
        </div>
        <div class="onboarding-steps">
          <div class="onboarding-step" data-step="1">
            <div class="onboarding-step-number">1</div>
            <div class="onboarding-step-content">
              <h4>Import your target accounts</h4>
              <p>Go to <strong>Accounts</strong> and paste a list of companies or import a CSV. You can also add them one at a time.</p>
            </div>
          </div>
          <div class="onboarding-step" data-step="2">
            <div class="onboarding-step-number">2</div>
            <div class="onboarding-step-content">
              <h4>Run ATS discovery</h4>
              <p>Head to <strong>Admin</strong> and click "Run ATS discovery" to automatically find job boards for your accounts.</p>
            </div>
          </div>
          <div class="onboarding-step" data-step="3">
            <div class="onboarding-step-number">3</div>
            <div class="onboarding-step-content">
              <h4>Work the ranked queue</h4>
              <p>Your <strong>Dashboard</strong> will now show prioritized accounts with hiring signals, ready for outreach.</p>
            </div>
          </div>
        </div>
        <div class="onboarding-actions">
          <button class="primary-button" id="onboarding-dismiss">Get started</button>
          <button class="ghost-button" id="onboarding-skip">Skip tour</button>
        </div>
      </div>
    </div>`;
}

function wireOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  const dismiss = () => {
    appState.onboardingDone = true;
    localStorage.setItem('bd_onboarding_done', 'true');
    overlay.remove();
  };
  document.getElementById('onboarding-dismiss')?.addEventListener('click', dismiss);
  document.getElementById('onboarding-skip')?.addEventListener('click', dismiss);
}

/* ── Phase 6: Outreach sequences ── */
function renderOutreachSequencePanel(accountId) {
  const seqs = appState.outreachSequences.filter(s => s.accountId === accountId);
  return `
    <div class="detail-card sequence-panel">
      <div class="panel-header"><div><h3>Outreach sequence</h3><p class="muted small">Multi-step cadence for this account.</p></div></div>
      <form class="sequence-form" data-account-id="${accountId}">
        <select name="channel" class="compact-select"><option value="email">Email</option><option value="linkedin">LinkedIn</option><option value="call">Call</option></select>
        <input name="note" placeholder="Step description..." class="compact-input">
        <input name="dueIn" type="number" min="0" value="3" class="compact-input" style="max-width:60px" title="Days from now">
        <span class="small muted">days</span>
        <button type="submit" class="secondary-button compact-btn">Add step</button>
      </form>
      <div class="sequence-timeline">
        ${seqs.length ? seqs.sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt)).map((s, i) => `
          <div class="sequence-step ${s.done ? 'sequence-step--done' : ''} ${!s.done && new Date(s.dueAt) < Date.now() ? 'sequence-step--overdue' : ''}">
            <span class="sequence-step-num">${i + 1}</span>
            <div class="sequence-step-body">
              <strong>${escapeHtml(s.channel)}</strong>: ${escapeHtml(s.note)}
              <div class="small muted">${s.done ? 'Completed' : 'Due ' + formatDate(s.dueAt)}</div>
            </div>
            ${!s.done ? `<button class="ghost-button ghost-button--xs" data-action="complete-sequence-step" data-seq-id="${s.id}">Done</button>` : ''}
          </div>`).join('') : '<div class="empty-state empty-state--compact">No sequence steps defined yet.</div>'}
      </div>
    </div>`;
}

/* ── Phase 6: Activity timeline (client-side) ── */
function logActivity(type, detail) {
  const entry = { id: Date.now(), type, ...detail, at: new Date().toISOString() };
  appState.activityLog.unshift(entry);
  if (appState.activityLog.length > 500) appState.activityLog = appState.activityLog.slice(0, 500);
  try { localStorage.setItem('bd_activity_log', JSON.stringify(appState.activityLog)); } catch(e) { /* quota */ }
}

function renderActivityTimeline(accountId) {
  const items = appState.activityLog.filter(a => a.accountId === accountId).slice(0, 30);
  if (!items.length) return '';
  return `
    <div class="detail-card">
      <div class="panel-header"><div><h3>Activity timeline</h3><p class="muted small">Recent local actions on this account.</p></div></div>
      <div class="timeline">
        ${items.map(a => `
          <article class="timeline-item">
            <div class="inline-header">
              <strong>${escapeHtml(humanize(a.type))}</strong>
              <span class="small muted">${formatDate(a.at)}</span>
            </div>
            <p class="small">${escapeHtml(a.summary || a.note || '')}</p>
          </article>`).join('')}
      </div>
    </div>`;
}

/* ── Phase 6: Sales cycle analytics ── */
function renderSalesCycleAnalytics(accounts) {
  if (!Array.isArray(accounts)) return '';
  const stageOrder = ['new', 'researching', 'outreach', 'engaged', 'client'];
  const stageCounts = {};
  const stageAvgDays = {};
  stageOrder.forEach(s => { stageCounts[s] = 0; stageAvgDays[s] = []; });
  accounts.forEach(a => {
    const stage = a.status || 'new';
    if (stageCounts[stage] !== undefined) stageCounts[stage]++;
    const history = appState.stageTimestamps[a.id] || [];
    for (let i = 1; i < history.length; i++) {
      const days = (new Date(history[i].at) - new Date(history[i - 1].at)) / 86400000;
      const prevStage = history[i - 1].stage;
      if (stageAvgDays[prevStage]) stageAvgDays[prevStage].push(days);
    }
  });
  const avgByStage = {};
  stageOrder.forEach(s => {
    const arr = stageAvgDays[s];
    avgByStage[s] = arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  });
  const funnelData = stageOrder.map(s => ({ label: humanize(s), value: stageCounts[s] }));
  const velocityData = stageOrder.filter(s => avgByStage[s] !== null).map(s => ({ label: humanize(s), value: avgByStage[s] }));
  return `
    <section class="detail-card sales-cycle-panel">
      <div class="panel-header"><div><h3>Sales cycle analytics</h3><p class="muted small">Pipeline funnel and average time per stage.</p></div></div>
      <div class="sales-cycle-grid">
        ${renderConversionFunnel(funnelData)}
        ${velocityData.length ? renderSvgBarChart(velocityData, 280, 130, 'Avg days per stage') : '<div class="empty-state empty-state--compact">Not enough stage transitions tracked yet.</div>'}
      </div>
    </section>`;
}

/* ── Phase 6: Configurable alert thresholds ── */
function renderAlertThresholdsPanel() {
  const t = appState.alertThresholds;
  return `
    <div class="detail-card alert-thresholds-panel">
      <div class="panel-header"><div><h3>Alert thresholds</h3><p class="muted small">Customize when smart alerts fire.</p></div></div>
      <form id="alert-thresholds-form" class="detail-form">
        ${renderField('Stale days', `<input name="staleDays" type="number" min="1" value="${t.staleDays}">`)}
        ${renderField('Min score drop', `<input name="scoreDropMin" type="number" min="1" value="${t.scoreDropMin}">`)}
        ${renderField('Hiring spike factor', `<input name="hiringSpikeFactor" type="number" min="1" step="0.5" value="${t.hiringSpikeFactor}">`)}
        ${renderField('Spike min jobs', `<input name="hiringSpikMinJobs" type="number" min="1" value="${t.hiringSpikMinJobs}">`)}
        ${renderField('High score no contacts', `<input name="highScoreNoContacts" type="number" min="1" value="${t.highScoreNoContacts}">`)}
        ${renderField('High value stale min', `<input name="highValueStaleMin" type="number" min="1" value="${t.highValueStaleMin}">`)}
        <div><button class="secondary-button" type="submit">Save thresholds</button></div>
      </form>
    </div>`;
}

/* ── Phase 6: Override detectSmartAlerts to use configurable thresholds ── */
const _origDetectSmartAlerts = detectSmartAlerts;
detectSmartAlerts = function(accounts) {
  if (!Array.isArray(accounts)) { appState.smartAlerts = []; return []; }
  const t = appState.alertThresholds;
  const alerts = [];
  accounts.forEach(a => {
    const prev = appState.previousScores[a.id];
    const current = getTargetScore(a);
    if (prev !== undefined && current < prev - t.scoreDropMin) {
      alerts.push({ type: 'score_drop', accountId: a.id, name: a.displayName, message: `Score dropped ${prev - current} points (${prev} \u2192 ${current})`, severity: 'warning' });
    }
    if (a.staleFlag === 'STALE' && current >= t.highValueStaleMin) {
      alerts.push({ type: 'stale_high_value', accountId: a.id, name: a.displayName, message: `High-value account (${current} pts) hasn't been touched in ${t.staleDays}+ days`, severity: 'danger' });
    }
    if ((a.hiringSpikeRatio || 0) > t.hiringSpikeFactor && (a.jobsLast30Days || 0) >= t.hiringSpikMinJobs) {
      alerts.push({ type: 'hiring_spike', accountId: a.id, name: a.displayName, message: `Hiring spike: ${a.jobsLast30Days} jobs in 30d (${a.hiringSpikeRatio}x normal)`, severity: 'success' });
    }
    if (current >= t.highScoreNoContacts && (a.contactCount || 0) === 0) {
      alerts.push({ type: 'no_contacts', accountId: a.id, name: a.displayName, message: `${current}-point account has no mapped contacts`, severity: 'warning' });
    }
  });
  appState.smartAlerts = alerts;
  return alerts;
};

/* ── Phase 6: Bulk keyboard operations ── */
function wireBulkKeyboard() {
  const table = document.querySelector('.table');
  if (!table) return;
  table.addEventListener('click', (e) => {
    const checkbox = e.target.closest('.bulk-checkbox');
    if (!checkbox) return;
    const allBoxes = Array.from(document.querySelectorAll('.bulk-checkbox'));
    const idx = allBoxes.indexOf(checkbox);
    if (e.shiftKey && appState.bulkLastClickIdx !== null) {
      const start = Math.min(appState.bulkLastClickIdx, idx);
      const end = Math.max(appState.bulkLastClickIdx, idx);
      for (let i = start; i <= end; i++) {
        allBoxes[i].checked = true;
      }
    }
    appState.bulkLastClickIdx = idx;
    updateBulkBar();
  });
  // Ctrl+A to select all visible
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      const boxes = document.querySelectorAll('.bulk-checkbox');
      if (boxes.length && document.querySelector('.table')) {
        e.preventDefault();
        const allChecked = Array.from(boxes).every(b => b.checked);
        boxes.forEach(b => b.checked = !allChecked);
        updateBulkBar();
      }
    }
  });
}

/* ── Phase 6: Dashboard layout customization ── */
function getDashboardSections() {
  return [
    { id: 'hero', label: 'Hero card', required: true },
    { id: 'trust', label: 'Trust strip' },
    { id: 'metrics', label: 'Metrics grid' },
    { id: 'playbook', label: "Today's playbook" },
    { id: 'alerts-bar', label: 'Alert bar' },
    { id: 'boards', label: 'Trigger boards' },
    { id: 'queue', label: 'Today queue & panels' },
    { id: 'enrichment', label: 'Enrichment pipeline' },
    { id: 'jobs-activity', label: 'New jobs & activity' },
    { id: 'heatmap', label: 'Pipeline heatmap' },
    { id: 'smart-alerts', label: 'Smart alerts' },
    { id: 'velocity', label: 'Deal velocity' },
    { id: 'leaderboard', label: 'Team leaderboard' },
    { id: 'data-quality', label: 'Data quality' },
    { id: 'duplicates', label: 'Duplicate detection' },
    { id: 'sales-cycle', label: 'Sales cycle analytics' },
    { id: 'charts', label: 'Pipeline charts' },
  ];
}

function renderDashboardCustomizer() {
  const sections = getDashboardSections();
  const collapsed = appState.dashboardCollapsed;
  return `
    <div class="dash-customizer">
      <button class="ghost-button ghost-button--xs" id="dash-customize-toggle">Customize dashboard</button>
      <div class="dash-customizer-dropdown hidden" id="dash-customizer-dropdown">
        <p class="small muted" style="margin-bottom:8px">Show/hide dashboard sections:</p>
        ${sections.map(s => `
          <label class="dash-customizer-item">
            <input type="checkbox" ${s.required ? 'checked disabled' : (collapsed[s.id] ? '' : 'checked')} data-section-id="${s.id}">
            ${escapeHtml(s.label)}
          </label>`).join('')}
      </div>
    </div>`;
}

function wireDashboardCustomizer() {
  const toggle = document.getElementById('dash-customize-toggle');
  const dropdown = document.getElementById('dash-customizer-dropdown');
  if (!toggle || !dropdown) return;
  toggle.addEventListener('click', () => dropdown.classList.toggle('hidden'));
  dropdown.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-section-id]');
    if (!cb) return;
    const id = cb.dataset.sectionId;
    if (cb.checked) {
      delete appState.dashboardCollapsed[id];
    } else {
      appState.dashboardCollapsed[id] = true;
    }
    localStorage.setItem('bd_dash_collapsed', JSON.stringify(appState.dashboardCollapsed));
    // Toggle visibility
    const section = document.querySelector(`[data-dash-section="${id}"]`);
    if (section) section.style.display = cb.checked ? '' : 'none';
  });
}

function dashSection(id, html) {
  const hidden = appState.dashboardCollapsed[id];
  return `<div data-dash-section="${id}" style="${hidden ? 'display:none' : ''}">${html}</div>`;
}

/* ── Phase 6: PDF export (client-side) ── */
function exportToPdf() {
  // Use print-optimized styles and browser print dialog
  document.body.classList.add('print-mode');
  showToast('Print dialog opening... use "Save as PDF" to export.', 'info');
  setTimeout(() => {
    window.print();
    document.body.classList.remove('print-mode');
  }, 300);
}

/* ── Phase 6: Custom fields ── */
function renderCustomFieldsPanel(accountId) {
  const fields = appState.customFields;
  const values = JSON.parse(localStorage.getItem(`bd_cf_${accountId}`) || '{}');
  if (!fields.length) {
    return `
      <div class="detail-card custom-fields-panel">
        <div class="panel-header"><div><h3>Custom fields</h3><p class="muted small">Define your own fields to track per account.</p></div></div>
        <form class="custom-field-def-form" id="custom-field-def-form">
          <input name="fieldName" placeholder="Field name..." class="compact-input">
          <select name="fieldType" class="compact-select"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Select (comma-separated)</option></select>
          <input name="fieldOptions" placeholder="Options (for select)" class="compact-input">
          <button type="submit" class="secondary-button compact-btn">Add field</button>
        </form>
      </div>`;
  }
  return `
    <div class="detail-card custom-fields-panel">
      <div class="panel-header">
        <div><h3>Custom fields</h3><p class="muted small">${fields.length} custom field${fields.length > 1 ? 's' : ''} defined.</p></div>
        <button class="ghost-button ghost-button--xs" id="add-custom-field-toggle">+ Add field</button>
      </div>
      <form class="custom-field-def-form hidden" id="custom-field-def-form">
        <input name="fieldName" placeholder="Field name..." class="compact-input">
        <select name="fieldType" class="compact-select"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Select</option></select>
        <input name="fieldOptions" placeholder="Options (for select)" class="compact-input">
        <button type="submit" class="secondary-button compact-btn">Add field</button>
      </form>
      <form class="custom-fields-values-form" data-account-id="${accountId}">
        ${fields.map(f => {
          const val = values[f.name] || '';
          if (f.type === 'select') {
            const opts = (f.options || '').split(',').map(o => o.trim());
            return renderField(f.name, `<select name="cf_${escapeAttr(f.name)}"><option value="">—</option>${opts.map(o => `<option value="${escapeAttr(o)}" ${val === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select>`);
          }
          return renderField(f.name, `<input name="cf_${escapeAttr(f.name)}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" value="${escapeAttr(val)}">`);
        }).join('')}
        <div><button type="submit" class="secondary-button compact-btn">Save custom fields</button></div>
      </form>
    </div>`;
}

/* ── Phase 6: Dashboard charts builder ── */
function renderDashboardCharts(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return '';
  // Pipeline by status
  const statusCounts = {};
  accounts.forEach(a => {
    const s = a.status || 'new';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  const statusData = Object.entries(statusCounts).map(([label, value]) => ({ label: humanize(label), value }));

  // Pipeline by owner
  const ownerCounts = {};
  accounts.forEach(a => {
    const o = a.owner || 'Unassigned';
    ownerCounts[o] = (ownerCounts[o] || 0) + 1;
  });
  const ownerData = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }));

  // Score distribution over time (using score history)
  const avgScores = [];
  const historyKeys = Object.keys(appState.scoreHistory);
  if (historyKeys.length > 0) {
    // Group by date
    const byDate = {};
    historyKeys.forEach(id => {
      (appState.scoreHistory[id] || []).forEach(entry => {
        const d = entry.date?.slice(0, 10) || '';
        if (!d) return;
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(entry.score);
      });
    });
    Object.entries(byDate).sort().slice(-14).forEach(([date, scores]) => {
      avgScores.push({ label: date.slice(5), value: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) });
    });
  }

  return `
    <section class="detail-card dashboard-charts">
      <div class="panel-header"><div><h3>Pipeline charts</h3><p class="muted small">Visual breakdown of your pipeline distribution.</p></div></div>
      <div class="charts-grid">
        ${renderSvgBarChart(statusData, 300, 140, 'Accounts by status')}
        ${renderSvgBarChart(ownerData, 300, 140, 'Accounts by owner')}
        ${avgScores.length >= 2 ? renderSvgLineChart(avgScores, 300, 140, 'Avg score trend') : '<div class="svg-chart"><p class="small muted" style="padding:20px">Score trend needs 2+ days of data</p></div>'}
      </div>
    </section>`;
}

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
    const setupStatus = await loadSetupStatus(true);
    const initialRoot = getRouteRoot();
    if (setupStatus?.requiresSetup && initialRoot !== 'setup') {
      location.hash = '#/setup';
      await renderRoute();
      return;
    }
    if (routeNeedsBootstrapFilters(initialRoot)) {
      await loadBootstrap(true, { includeFilters: true });
      await renderRoute();
    } else {
      await renderRoute();
      loadBootstrap(false).catch((error) => {
        console.warn('Bootstrap hydration failed in background.', error);
        window.bdLocalApi.setAlert('Background data refresh failed. Some filters may be stale.', appAlert);
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
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable;

    // Escape: close modals/palette/mobile nav
    if (e.key === 'Escape') {
      if (appState.cmdPaletteOpen) { closeCmdPalette(); return; }
      if (appState.mobileNavOpen) { closeMobileNav(); return; }
      const backdrop = document.getElementById('outreach-modal-backdrop');
      if (backdrop && !backdrop.classList.contains('hidden')) {
        setOutreachModalOpen(false);
      }
      return;
    }

    // Command palette: Ctrl+K / Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (appState.cmdPaletteOpen) closeCmdPalette();
      else openCmdPalette();
      return;
    }

    // Focus trap for modal
    if (e.key === 'Tab') {
      const backdrop = document.getElementById('outreach-modal-backdrop');
      if (!backdrop || backdrop.classList.contains('hidden')) return;
      const panel = backdrop.querySelector('.modal-panel');
      if (!panel) return;
      const focusable = panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }

    // Skip shortcuts when typing in an input
    if (isInput || appState.cmdPaletteOpen) return;

    // "/" to focus search
    if (e.key === '/') { e.preventDefault(); searchInput?.focus(); return; }

    // "?" to open command palette
    if (e.key === '?') { e.preventDefault(); openCmdPalette(); return; }

    // G + <key> navigation (two-key chord)
    const now = Date.now();
    if (appState.lastKey === 'g' && now - appState.lastKeyTime < 800) {
      appState.lastKey = '';
      const navMap = { d: '#/dashboard', a: '#/accounts', c: '#/contacts', j: '#/jobs', x: '#/admin' };
      if (navMap[e.key]) { e.preventDefault(); location.hash = navMap[e.key]; return; }
    }
    appState.lastKey = e.key;
    appState.lastKeyTime = now;

    // J/K for table row navigation
    if (e.key === 'j' || e.key === 'k') {
      const rows = Array.from(document.querySelectorAll('.table tbody tr'));
      if (!rows.length) return;
      const current = document.querySelector('.table tbody tr.kb-focus');
      let idx = current ? rows.indexOf(current) : -1;
      if (current) current.classList.remove('kb-focus');
      idx = e.key === 'j' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
      rows[idx].classList.add('kb-focus');
      rows[idx].scrollIntoView({ block: 'nearest' });
      rows[idx].style.outline = '2px solid var(--accent)';
      rows[idx].style.outlineOffset = '-2px';
      if (current && current !== rows[idx]) { current.style.outline = ''; current.style.outlineOffset = ''; }
    }

    // Enter on focused row: navigate to detail
    if (e.key === 'Enter') {
      const focused = document.querySelector('.table tbody tr.kb-focus');
      if (focused) {
        const link = focused.querySelector('a[href]');
        if (link) { link.click(); return; }
      }
    }
  });
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
    // Open outreach modal
    if (event.target.id === 'open-outreach-modal') {
      setOutreachModalOpen(true);
      syncOutreachComposerState();
      return;
    }
    // Advanced filter toggle
    if (event.target.id === 'toggle-advanced-filters') {
      appState.showAdvancedFilters = !appState.showAdvancedFilters;
      const fields = document.getElementById('advanced-filter-fields');
      if (fields) fields.classList.toggle('hidden', !appState.showAdvancedFilters);
      event.target.textContent = appState.showAdvancedFilters ? '\u25B2 Fewer filters' : '\u25BC More filters';
      return;
    }
    // Outreach modal close
    if (event.target.closest('.modal-close') || (event.target.classList.contains('modal-backdrop') && !event.target.closest('.modal-panel'))) {
      setOutreachModalOpen(false);
      return;
    }
    // Status pills expand
    if (event.target.closest('.status-pills-overflow')) {
      appState.statusPillsExpanded = true;
      if (appState.accountDetail) renderAccountDetail(appState.accountDetail.account.id);
      return;
    }

    const action = event.target.closest('[data-action]');
    if (!action) {
      if (!event.target.closest('#search-results') && event.target !== searchInput) {
        searchResults.classList.add('hidden');
      }
      return;
    }

    const actionName = action.dataset.action;
    if (actionName === 'setup-browse-csv') {
      document.getElementById('setup-csv-file')?.click();
      return;
    }
    if (actionName === 'setup-back') {
      persistSetupDraftFromDom();
      appState.setupStep = Math.max(1, appState.setupStep - 1);
      await renderSetupWizard();
      return;
    }
    if (actionName === 'setup-skip-import') {
      appState.setupCsvContent = '';
      appState.setupCsvFileName = '';
      appState.setupPreview = null;
      await completeSetupWizard();
      return;
    }
    if (actionName === 'setup-preview-csv') {
      await previewSetupCsv();
      return;
    }
    if (actionName === 'setup-complete') {
      await completeSetupWizard();
      return;
    }
    if (actionName === 'setup-open-dashboard') {
      invalidateAppData();
      await loadBootstrap(true, { includeFilters: true });
      location.hash = '#/dashboard';
      await renderRoute();
      return;
    }
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
    if (actionName === 'save-current-filter') {
      const name = prompt('Name for this filter set:');
      if (name) { saveFilter(name.trim()); await renderAccountsView(); }
      return;
    }
    if (actionName === 'reset-filters') {
      await resetViewFilters(action.dataset.view);
      showToast('Filters reset.', 'info');
      return;
    }
    if (actionName === 'apply-account-preset') {
      await applyAccountPreset(action.dataset.preset, { navigate: action.dataset.navigate === 'accounts' });
      return;
    }
    if (actionName === 'open-admin-section') {
      openAdminSection(action.dataset.sectionId);
      return;
    }
    if (actionName === 'load-saved-filter') {
      applySavedFilter(action.dataset.name);
      await renderAccountsView();
      return;
    }
    if (actionName === 'delete-saved-filter') {
      deleteSavedFilter(action.dataset.name);
      await renderAccountsView();
      return;
    }
    if (actionName === 'export-csv') {
      const view = action.dataset.view;
      if (view === 'accounts') await exportAccountsCsv();
      if (view === 'contacts') await exportContactsCsv();
      if (view === 'jobs') await exportJobsCsv();
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

    if (actionName === 'open-contact-outreach' || actionName === 'select-contact-outreach') {
      openOutreachForContact({
        accountId: action.dataset.accountId || appState.accountDetail?.account?.id || '',
        contactId: action.dataset.contactId || '',
        contactName: action.dataset.contactName || '',
      });
      return;
    }

    if (actionName === 'reseed-workbook') {
      await reseedWorkbook(action.dataset.path || '');
      return;
    }

    if (actionName === 'run-live-import') {
      await runLiveImport(action);
      return;
    }

    if (actionName === 'sync-configs') {
      await syncConfigs();
      return;
    }

    if (actionName === 'run-discovery') {
      await runDiscovery(action);
      return;
    }

    if (actionName === 'run-local-enrichment') {
      await runLocalEnrichment();
      return;
    }

    if (actionName === 'run-enrichment') {
      await runEnrichment();
      return;
    }

    if (actionName === 'run-target-score-rollout') {
      await runTargetScoreRollout(action);
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

    if (actionName === 'billing-checkout') {
      const planId = document.getElementById('billing-plan-select')?.value;
      if (!planId) return;
      action.disabled = true;
      action.textContent = 'Redirecting...';
      try {
        const result = await api('/api/billing/checkout', {
          method: 'POST',
          body: JSON.stringify({ planId }),
        });
        if (result.url) {
          window.location.href = result.url;
        } else {
          showToast(result.error || 'Failed to initialize checkout', 'error');
          action.disabled = false;
          action.textContent = 'Subscribe via Stripe';
        }
      } catch (err) {
        showToast(err.message, 'error');
        action.disabled = false;
        action.textContent = 'Subscribe via Stripe';
      }
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

    if (actionName === 'generate-outreach-bundle') {
      await generateSmartOutreach(action.dataset.id, action, { includeVariants: true });
      return;
    }

    if (actionName === 'generate-outreach-template') {
      const templateSelect = document.getElementById('outreach-template-select');
      if (templateSelect && action.dataset.template) {
        templateSelect.value = action.dataset.template;
      }
      syncOutreachComposerState();
      await generateSmartOutreach(action.dataset.id, action);
      return;
    }

    if (actionName === 'copy-generated-outreach') {
      await copyGeneratedOutreach(action.dataset.kind || 'email', action);
      return;
    }

    if (actionName === 'copy-generated-outreach-variant') {
      await copyGeneratedOutreach(action.dataset.kind || 'email', action, Number(action.dataset.index));
      return;
    }

    if (actionName === 'copy-outreach-subject') {
      await copyGeneratedSubject(action.dataset.index, action);
      return;
    }

    if (actionName === 'open-generated-linkedin') {
      await openGeneratedLinkedIn(action);
      return;
    }

    if (actionName === 'log-generated-outreach') {
      await logGeneratedOutreach(action);
      return;
    }

    if (actionName === 'apply-generated-outreach-variant') {
      applyGeneratedOutreachVariant(Number(action.dataset.index), action);
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

    if (actionName === 'account-quick-enrich') {
      await quickEnrichAccount(action.dataset.id);
      return;
    }

    if (actionName === 'account-resolve-now') {
      await resolveAccountNow(action.dataset.id);
      return;
    }

    if (actionName === 'account-deep-verify') {
      await deepVerifyAccount(action.dataset.id);
      return;
    }

    if (actionName === 'export-pdf') {
      exportToPdf();
      return;
    }

    if (actionName === 'complete-sequence-step') {
      const seqId = Number(action.dataset.seqId);
      const seq = appState.outreachSequences.find(s => s.id === seqId);
      if (seq) {
        seq.done = true;
        localStorage.setItem('bd_sequences', JSON.stringify(appState.outreachSequences));
        logActivity('sequence_complete', { accountId: seq.accountId, summary: `Completed ${seq.channel}: ${seq.note}` });
        showToast('Sequence step completed.', 'success');
        if (appState.accountDetail) renderAccountDetail(appState.accountDetail.account.id);
      }
      return;
    }

    if (actionName === 'merge-duplicate') {
      const keepId = action.dataset.keep;
      const removeId = action.dataset.remove;
      if (confirm('Merge duplicate into primary account? This will archive the duplicate.')) {
        try {
          await api(`/api/accounts/${removeId}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused', notes: `Merged into account ${keepId}` }) });
          showToast('Duplicate archived.', 'success');
          logActivity('merge_duplicate', { accountId: keepId, summary: `Merged duplicate ${removeId}` });
          invalidateAppData();
          await renderRoute();
        } catch(e) { showToast('Merge failed: ' + (e.message || e), 'error'); }
      }
      return;
    }
  });

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();

    if (form.id === 'setup-profile-form') {
      persistSetupDraftFromDom();
      const { workspaceName: workspace, userName: name, userEmail: email } = appState.setupDraft;
      if (!workspace.trim() || !name.trim() || !email.trim()) {
        showToast('Workspace, name, and email are required.', 'warning');
        return;
      }
      appState.setupStep = Math.min(getSetupSteps().length, appState.setupStep + 1);
      await renderSetupWizard();
      return;
    }

    if (form.id === 'setup-team-form' || form.id === 'setup-license-form') {
      persistSetupDraftFromDom();
      appState.setupStep = Math.min(getSetupSteps().length, appState.setupStep + 1);
      await renderSetupWizard();
      return;
    }

    if (form.id === 'accounts-filter-form') {
      appState.accountQuery = { ...appState.accountQuery, page: 1, ...getFormValues(form) };
      await renderAccountsView();
      return;
    }

    if (form.id === 'account-create-form') {
      const payload = getFormValues(form);
      if (!payload.company || !payload.company.trim()) {
        window.bdLocalApi.setAlert('Company name is required.', appAlert);
        return;
      }
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

    // Phase 6: Sequence step form
    if (form.classList.contains('sequence-form')) {
      const accountId = form.dataset.accountId;
      const values = getFormValues(form);
      const dueIn = Number(values.dueIn || 3);
      const dueAt = new Date(Date.now() + dueIn * 86400000).toISOString();
      appState.outreachSequences.push({ id: Date.now(), accountId, channel: values.channel, note: values.note, dueAt, done: false });
      localStorage.setItem('bd_sequences', JSON.stringify(appState.outreachSequences));
      logActivity('sequence_add', { accountId, summary: `Added ${values.channel} step: ${values.note}` });
      showToast('Sequence step added.', 'success');
      if (appState.accountDetail) renderAccountDetail(accountId);
      return;
    }

    // Phase 6: Custom field definition
    if (form.id === 'custom-field-def-form') {
      const values = getFormValues(form);
      if (!values.fieldName?.trim()) { showToast('Field name required.', 'warning'); return; }
      appState.customFields.push({ name: values.fieldName.trim(), type: values.fieldType || 'text', options: values.fieldOptions || '' });
      localStorage.setItem('bd_custom_fields', JSON.stringify(appState.customFields));
      showToast('Custom field added.', 'success');
      if (appState.accountDetail) renderAccountDetail(appState.accountDetail.account.id);
      return;
    }

    // Phase 6: Custom field values
    if (form.classList.contains('custom-fields-values-form')) {
      const accountId = form.dataset.accountId;
      const values = getFormValues(form);
      const cfValues = {};
      Object.entries(values).forEach(([k, v]) => {
        if (k.startsWith('cf_')) cfValues[k.slice(3)] = v;
      });
      localStorage.setItem(`bd_cf_${accountId}`, JSON.stringify(cfValues));
      showToast('Custom fields saved.', 'success');
      return;
    }

    // Phase 6: Alert thresholds
    if (form.id === 'alert-thresholds-form') {
      const values = getFormValues(form);
      appState.alertThresholds = {
        staleDays: Number(values.staleDays) || 14,
        scoreDropMin: Number(values.scoreDropMin) || 10,
        hiringSpikeFactor: Number(values.hiringSpikeFactor) || 3,
        hiringSpikMinJobs: Number(values.hiringSpikMinJobs) || 5,
        highScoreNoContacts: Number(values.highScoreNoContacts) || 80,
        highValueStaleMin: Number(values.highValueStaleMin) || 70,
      };
      localStorage.setItem('bd_alert_thresholds', JSON.stringify(appState.alertThresholds));
      showToast('Alert thresholds saved.', 'success');
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
      logActivity('account_update', { accountId, summary: `Updated account fields` });
      await renderAccountDetail(accountId);
      showToast('Account updated.', 'success');
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
      showToast('Next action updated.', 'success');
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
      showToast('Quick update saved.', 'success');
      return;
    }

    if (form.id === 'activity-form') {
      const payload = getFormValues(form);
      await api('/api/activity', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      logActivity(payload.type || 'note', { accountId: payload.accountId, summary: payload.summary || 'Activity logged' });
      await renderAccountDetail(payload.accountId);
      showToast('Activity logged.', 'success');
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
      showToast('Scoring settings saved.', 'success');
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
        showToast('Enrichment saved and ATS resolution queued.', 'success');
        await renderAdminView();
        hydrateAdminRuntimePanels(await loadRuntimeStatus(true));
        void watchBackgroundJob(accepted.jobId, { label: 'ATS resolution', refreshRoute: false }).catch((err) => { window.bdLocalApi.setAlert(`ATS resolution failed: ${err.message || err}`, appAlert); });
        return;
      }
      await renderAdminView();
      showToast('Enrichment saved.', 'success');
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

async function loadSetupStatus(force = false) {
  if (appState.setupStatus && !force) {
    return appState.setupStatus;
  }
  appState.setupStatus = await api('/api/setup/status', { skipCache: true });
  if (!appState.setupDraft.workspaceName && appState.setupStatus?.workspace?.name) {
    const existingName = appState.setupStatus.workspace.name;
    appState.setupDraft.workspaceName = existingName === 'BD Engine Workspace' ? '' : existingName;
  }
  return appState.setupStatus;
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

function exportToCsv(filename, headers, rows) {
  const csvContent = [
    headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(','),
    ...rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
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
  // Snapshot current scores so we can show deltas after refresh
  Object.keys(appState.previousScores).forEach(id => {
    appState.previousScores[id] = appState.previousScores[id];
  });
  window.bdLocalApi.invalidate();
}

function saveFilter(name) {
  const entry = { name, query: { ...appState.accountQuery }, savedAt: new Date().toISOString() };
  appState.savedFilters = appState.savedFilters.filter(f => f.name !== name);
  appState.savedFilters.unshift(entry);
  localStorage.setItem('bd_saved_filters', JSON.stringify(appState.savedFilters));
}

function deleteSavedFilter(name) {
  appState.savedFilters = appState.savedFilters.filter(f => f.name !== name);
  localStorage.setItem('bd_saved_filters', JSON.stringify(appState.savedFilters));
}

function applySavedFilter(name) {
  const filter = appState.savedFilters.find(f => f.name === name);
  if (filter) {
    appState.accountQuery = { ...filter.query, page: 1 };
  }
}

const accountPresets = [
  {
    id: 'hot-hiring',
    label: 'Hot hiring',
    description: 'Active roles and target score 70+',
    query: { hiring: 'true', minTargetScore: '70', sortBy: '' },
  },
  {
    id: 'fresh-roles',
    label: 'Recent roles',
    description: 'Hiring movement in the last 30 days',
    query: { hiring: 'true', recencyDays: '30', sortBy: 'new_roles' },
  },
  {
    id: 'warm-network',
    label: 'Warm network',
    description: 'Accounts with mapped relationships first',
    query: { minContacts: '1', sortBy: 'connections' },
  },
  {
    id: 'follow-up',
    label: 'Follow-up lane',
    description: 'Work the accounts most due for action',
    query: { sortBy: 'follow_up' },
  },
  {
    id: 'strategic',
    label: 'Strategic targets',
    description: 'Highest-priority named accounts',
    query: { priority: 'strategic', sortBy: '' },
  },
];

const accountFilterLabels = {
  q: 'Search',
  hiring: 'Hiring',
  ats: 'ATS',
  recencyDays: 'Recency',
  minContacts: 'Contacts',
  minTargetScore: 'Score',
  priority: 'Priority',
  status: 'Status',
  owner: 'Owner',
  outreachStatus: 'Outreach',
  industry: 'Industry',
  geography: 'Geography',
  sortBy: 'Sort',
};

function getAccountPreset(id) {
  return accountPresets.find((preset) => preset.id === id);
}

function normalizedFilterEntries(query) {
  return Object.entries(query || {})
    .filter(([key, value]) => key !== 'page' && key !== 'pageSize' && value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => [key, String(value)]);
}

function isAccountPresetActive(preset) {
  const activeEntries = normalizedFilterEntries(appState.accountQuery);
  const presetEntries = normalizedFilterEntries(preset.query);
  return activeEntries.length === presetEntries.length
    && presetEntries.every(([key, value]) => String(appState.accountQuery[key] || '') === value);
}

async function applyAccountPreset(presetId, options = {}) {
  const preset = getAccountPreset(presetId);
  if (!preset) return;
  const alreadyOnAccounts = getRouteRoot() === 'accounts';
  appState.accountQuery = {
    ...defaultQueries.accounts,
    pageSize: appState.accountQuery.pageSize || defaultQueries.accounts.pageSize,
    ...preset.query,
    page: 1,
  };
  appState.showAdvancedFilters = false;
  showToast(`${preset.label} lane applied.`, 'info');
  if (options.navigate || !alreadyOnAccounts) {
    location.hash = '#/accounts';
    if (alreadyOnAccounts) await renderAccountsView();
    return;
  }
  await renderAccountsView();
}

function renderSavedFilters() {
  if (!appState.savedFilters.length) return '';
  return `<div class="saved-filters-bar">${appState.savedFilters.map(f =>
    `<span class="saved-filter-chip"><button class="ghost-button ghost-button--xs" data-action="load-saved-filter" data-name="${escapeAttr(f.name)}">${escapeHtml(f.name)}</button><button class="saved-filter-delete" data-action="delete-saved-filter" data-name="${escapeAttr(f.name)}" aria-label="Delete filter ${escapeAttr(f.name)}">&times;</button></span>`
  ).join('')}</div>`;
}

function renderActiveFilterStrip(query, labels = accountFilterLabels) {
  const entries = normalizedFilterEntries(query);
  if (!entries.length) {
    return '<div class="active-filter-strip active-filter-strip--empty"><span>All accounts visible</span></div>';
  }
  return `
    <div class="active-filter-strip">
      <span>${formatNumber(entries.length)} active filter${entries.length === 1 ? '' : 's'}</span>
      ${entries.map(([key, value]) => `<span class="filter-chip"><strong>${escapeHtml(labels[key] || humanize(key))}</strong>${escapeHtml(humanize(value))}</span>`).join('')}
      <button class="ghost-button ghost-button--xs" type="button" data-action="reset-filters" data-view="accounts">Clear</button>
    </div>
  `;
}

function renderAccountPresetStrip() {
  return `
    <section class="account-preset-strip" aria-label="Account working lanes">
      <div class="preset-strip-copy">
        <p class="eyebrow">Working lanes</p>
        <strong>Jump to the queue that matches the moment.</strong>
      </div>
      <div class="preset-button-row">
        ${accountPresets.map((preset) => `
          <button class="preset-button${isAccountPresetActive(preset) ? ' active' : ''}" type="button" data-action="apply-account-preset" data-preset="${escapeAttr(preset.id)}">
            <span>${escapeHtml(preset.label)}</span>
            <small>${escapeHtml(preset.description)}</small>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderDashboardWorkflowStrip({ dashboard, extended, topCompany, resolutionPressure }) {
  const freshJobs = dashboard.summary?.newJobsLast24h || 0;
  const followUps = (extended.overdueFollowUps?.length || 0) + (extended.staleAccounts?.length || 0);
  const boardsFound = dashboard.summary?.discoveredBoardCount || 0;
  return `
    <section class="workflow-strip" aria-label="Daily BD workflow">
      <article class="workflow-card workflow-card--primary">
        <span class="workflow-card__step">1</span>
        <div class="workflow-card__copy">
          <strong>${topCompany ? escapeHtml(topCompany.displayName) : 'Find the lead account'}</strong>
          <span>${topCompany ? `${formatNumber(getTargetScore(topCompany))}/100 target score` : 'No top account yet'}</span>
        </div>
        ${topCompany ? `<button class="primary-button ghost-button--xs" type="button" data-action="open-account" data-id="${topCompany.id}">Open</button>` : '<a class="primary-button ghost-button--xs" href="#/admin">Seed</a>'}
      </article>
      <article class="workflow-card">
        <span class="workflow-card__step">2</span>
        <div class="workflow-card__copy">
          <strong>Recent role triggers</strong>
          <span>${formatNumber(freshJobs)} jobs in 24h</span>
        </div>
        <button class="ghost-button ghost-button--xs" type="button" data-action="apply-account-preset" data-preset="fresh-roles" data-navigate="accounts">Open lane</button>
      </article>
      <article class="workflow-card">
        <span class="workflow-card__step">3</span>
        <div class="workflow-card__copy">
          <strong>Follow-up lane</strong>
          <span>${formatNumber(followUps)} accounts need attention</span>
        </div>
        <button class="ghost-button ghost-button--xs" type="button" data-action="apply-account-preset" data-preset="follow-up" data-navigate="accounts">Open lane</button>
      </article>
      <article class="workflow-card">
        <span class="workflow-card__step">4</span>
        <div class="workflow-card__copy">
          <strong>Coverage backlog</strong>
          <span>${formatNumber(resolutionPressure)} identity gaps</span>
        </div>
        <a class="ghost-button ghost-button--xs" href="#/admin">${boardsFound ? 'Review' : 'Discover'}</a>
      </article>
    </section>
  `;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withButtonState(selector, busyLabel, fn) {
  const button = typeof selector === 'string' ? document.querySelector(selector) : selector;
  const originalLabel = button?.textContent || busyLabel;
  if (button) { button.disabled = true; button.textContent = busyLabel; }
  try {
    return await fn();
  } finally {
    if (button) { button.disabled = false; button.textContent = originalLabel; }
  }
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
      ${renderIngestionHealthPanel(summary)}
    </div>
  `;

  const activeJobs = Array.isArray(summary.activeJobs) ? summary.activeJobs : [];
  const activeIds = new Set(activeJobs.map((job) => job.id).filter(Boolean));
  const recentJobs = (Array.isArray(summary.recentJobs) ? summary.recentJobs : []).filter((job) => !activeIds.has(job.id));
  jobsTarget.innerHTML = `
    ${activeJobs.length
      ? activeJobs.map((job) => renderBackgroundJobItem(job)).join('')
      : '<div class="empty-state compact">No jobs are active right now.</div>'}
    ${recentJobs.length
      ? `<div class="inline-header"><strong>Recent jobs</strong><span class="small muted">Completed and failed work</span></div>${recentJobs.map((job) => renderBackgroundJobItem(job)).join('')}`
      : ''}
  `;
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
  closeMobileNav();

  if (!appState.setupStatus) {
    await loadSetupStatus(false);
  }

  if (root === 'setup') {
    if (appState.setupStatus && !appState.setupStatus.requiresSetup && !appState.setupResult) {
      location.hash = '#/dashboard';
      await renderDashboardView();
      return;
    }
    activateNav('');
    renderBreadcrumbs(null);
    await renderSetupWizard();
    return;
  }

  if (appState.setupStatus?.requiresSetup) {
    location.hash = '#/setup';
    activateNav('');
    renderBreadcrumbs(null);
    await renderSetupWizard();
    return;
  }

  if (root === 'accounts' && parts[1]) {
    activateNav('accounts');
    renderBreadcrumbs([
      { label: 'Dashboard', href: '#/dashboard' },
      { label: 'Accounts', href: '#/accounts' },
      { label: decodeURIComponent(parts[1]) },
    ]);
    await renderAccountDetail(parts[1]);
    return;
  }

  if (root === 'accounts') {
    activateNav('accounts');
    renderBreadcrumbs([{ label: 'Dashboard', href: '#/dashboard' }, { label: 'Accounts' }]);
    await renderAccountsView();
    return;
  }

  if (root === 'contacts') {
    activateNav('contacts');
    renderBreadcrumbs([{ label: 'Dashboard', href: '#/dashboard' }, { label: 'Contacts' }]);
    await renderContactsView();
    return;
  }

  if (root === 'jobs') {
    activateNav('jobs');
    renderBreadcrumbs([{ label: 'Dashboard', href: '#/dashboard' }, { label: 'Jobs' }]);
    await renderJobsView();
    return;
  }

  if (root === 'admin') {
    activateNav('admin');
    renderBreadcrumbs([{ label: 'Dashboard', href: '#/dashboard' }, { label: 'Admin' }]);
    await renderAdminView();
    scheduleRuntimePoll();
    return;
  }

  activateNav('dashboard');
  renderBreadcrumbs(null);
  await renderDashboardView();
}

function getSetupSteps() {
  const steps = [
    { key: 'profile', label: 'Profile' },
    { key: 'team', label: 'Team' },
  ];
  if (appState.setupStatus?.licensingEnabled) {
    steps.push({ key: 'license', label: 'License' });
  }
  steps.push({ key: 'import', label: 'Import' });
  steps.push({ key: 'launch', label: 'Launch' });
  return steps;
}

function getCurrentSetupStep() {
  const steps = getSetupSteps();
  const index = Math.min(Math.max(appState.setupStep, 1), steps.length) - 1;
  return steps[index] || steps[0];
}

function persistSetupDraftFromDom() {
  const workspaceInput = document.getElementById('setup-workspace-name');
  const userNameInput = document.getElementById('setup-user-name');
  const userEmailInput = document.getElementById('setup-user-email');
  const ownersInput = document.getElementById('setup-owners-text');
  const licenseInput = document.getElementById('setup-license-key');
  if (workspaceInput) appState.setupDraft.workspaceName = workspaceInput.value.trim();
  if (userNameInput) appState.setupDraft.userName = userNameInput.value.trim();
  if (userEmailInput) appState.setupDraft.userEmail = userEmailInput.value.trim();
  if (ownersInput) appState.setupDraft.ownersText = ownersInput.value;
  if (licenseInput) appState.setupDraft.licenseKey = licenseInput.value.trim();
}

function parseSetupOwners(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      let displayName = line;
      let email = '';
      const emailMatch = line.match(/<([^>]+)>/);
      if (emailMatch) {
        email = emailMatch[1].trim();
        displayName = line.replace(/<[^>]+>/g, '').trim();
      } else if (line.includes(',')) {
        const parts = line.split(',');
        displayName = parts[0].trim();
        email = parts.slice(1).join(',').trim();
      }
      return { displayName, email };
    });
}

async function renderSetupWizard() {
  await loadSetupStatus(false);
  if (appState.setupResult) {
    appState.setupStep = getSetupSteps().length;
  }

  const steps = getSetupSteps();
  const current = getCurrentSetupStep();
  const draft = appState.setupDraft;
  const setupTitle = current.key === 'launch' ? 'Setup complete' : 'First-run setup';
  setViewTitle(setupTitle);
  workspaceName.textContent = draft.workspaceName || appState.setupStatus?.workspace?.name || 'BD Engine';
  window.bdLocalApi.setAlert('', appAlert);

  appRoot.innerHTML = `
    <section class="setup-shell" aria-labelledby="setup-title">
      <div class="setup-card">
        <div class="setup-header">
          <div>
            <p class="eyebrow">BD Engine local setup</p>
            <h2 id="setup-title">${escapeHtml(setupTitle)}</h2>
            <p class="muted">Create your workspace, bring in your LinkedIn connections, and start from your own data.</p>
          </div>
          <ol class="setup-steps" aria-label="Setup progress">
            ${steps.map((step, index) => `
              <li class="setup-step ${index + 1 === appState.setupStep ? 'active' : ''} ${index + 1 < appState.setupStep ? 'complete' : ''}">
                <span>${index + 1}</span>
                <strong>${escapeHtml(step.label)}</strong>
              </li>
            `).join('')}
          </ol>
        </div>
        ${renderSetupStepContent(current.key)}
      </div>
    </section>
  `;

  wireSetupDropZone();
}

function renderSetupStepContent(stepKey) {
  const draft = appState.setupDraft;
  if (stepKey === 'profile') {
    const defaultName = draft.userName || appState.user?.name || '';
    const defaultEmail = draft.userEmail || appState.user?.email || '';
    return `
      <form id="setup-profile-form" class="setup-form">
        <div class="setup-grid">
          <label>Workspace or company name
            <input id="setup-workspace-name" name="workspaceName" required autocomplete="organization" value="${escapeHtml(draft.workspaceName)}" placeholder="Your company or team" />
          </label>
          <label>Your name
            <input id="setup-user-name" name="userName" required autocomplete="name" value="${escapeHtml(defaultName)}" placeholder="Full name" />
          </label>
          <label>Your email
            <input id="setup-user-email" name="userEmail" type="email" required autocomplete="email" value="${escapeHtml(defaultEmail)}" placeholder="you@example.com" />
          </label>
        </div>
        <div class="button-row">
          <button class="primary-button" type="submit">Continue</button>
        </div>
      </form>
    `;
  }

  if (stepKey === 'team') {
    return `
      <form id="setup-team-form" class="setup-form">
        <label>Optional team or owner roster
          <textarea id="setup-owners-text" name="ownersText" rows="7" placeholder="One person per line, for example: Name, email@example.com">${escapeHtml(draft.ownersText)}</textarea>
        </label>
        <p class="muted small">Leave this blank if you are the only owner. You can add or edit owners later.</p>
        <div class="button-row">
          <button class="secondary-button" type="button" data-action="setup-back">Back</button>
          <button class="primary-button" type="submit">Continue</button>
        </div>
      </form>
    `;
  }

  if (stepKey === 'license') {
    return `
      <form id="setup-license-form" class="setup-form">
        <label>License key
          <input id="setup-license-key" name="licenseKey" autocomplete="off" value="${escapeHtml(draft.licenseKey)}" placeholder="Paste your license key" />
        </label>
        <p class="muted small">This step appears only when licensing is enabled for this build.</p>
        <div class="button-row">
          <button class="secondary-button" type="button" data-action="setup-back">Back</button>
          <button class="primary-button" type="submit">Continue</button>
        </div>
      </form>
    `;
  }

  if (stepKey === 'import') {
    const hasCsv = Boolean(appState.setupCsvContent);
    return `
      <div class="setup-form">
        <div class="setup-import-copy">
          <h3>Import LinkedIn Connections.csv</h3>
          <p class="muted">From LinkedIn, request a copy of your data and choose Connections. When the archive is ready, upload the included <code>Connections.csv</code> file here.</p>
        </div>
        <input id="setup-csv-file" class="hidden" type="file" accept=".csv,text/csv" />
        <div id="setup-drop-zone" class="setup-drop-zone" tabindex="0" role="button" aria-label="Upload LinkedIn Connections CSV">
          <strong>${hasCsv ? escapeHtml(appState.setupCsvFileName || 'Connections.csv') : 'Drop Connections.csv here'}</strong>
          <span>${hasCsv ? 'Ready to preview or import.' : 'or choose the file from your computer'}</span>
          <button class="secondary-button" type="button" data-action="setup-browse-csv">Choose CSV</button>
        </div>
        ${renderSetupPreview()}
        ${appState.setupBusy ? renderSetupProgress('Starting setup', appState.setupProgressMessage || 'Saving your setup and preparing the import...') : ''}
        <div class="button-row">
          <button class="secondary-button" type="button" data-action="setup-back">Back</button>
          <button class="secondary-button" type="button" data-action="setup-preview-csv" ${hasCsv && !appState.setupBusy ? '' : 'disabled'}>${appState.setupBusy ? 'Working...' : 'Preview CSV'}</button>
          <button class="ghost-button" type="button" data-action="setup-skip-import" ${appState.setupBusy ? 'disabled' : ''}>Skip import</button>
          <button class="primary-button" type="button" data-action="setup-complete" ${appState.setupBusy ? 'disabled' : ''}>${appState.setupBusy ? 'Starting...' : 'Finish setup'}</button>
        </div>
      </div>
    `;
  }

  const result = appState.setupResult || {};
  const stats = result.stats || {};
  if (appState.setupBusy && appState.setupImportJobId) {
    return `
      <div class="setup-success">
        ${renderSetupProgress('Importing LinkedIn connections', appState.setupProgressMessage || 'This can take a few minutes for a large LinkedIn export.')}
        <p class="muted">You can leave this window open. BD Engine is saving contacts, deriving accounts, and avoiding duplicates.</p>
      </div>
    `;
  }

  return `
    <div class="setup-success">
      <div class="setup-success-mark" aria-hidden="true">OK</div>
      <h3>Your workspace is ready</h3>
      <p class="muted">BD Engine will now open your dashboard using the local data stored on this computer.</p>
      <div class="setup-summary-grid">
        <div><strong>${formatNumber(stats.imported || 0)}</strong><span>Imported</span></div>
        <div><strong>${formatNumber(stats.updated || 0)}</strong><span>Updated</span></div>
        <div><strong>${formatNumber(stats.skipped || 0)}</strong><span>Skipped</span></div>
        <div><strong>${formatNumber(stats.failed || 0)}</strong><span>Failed</span></div>
      </div>
      <div class="button-row center">
        <button class="primary-button" type="button" data-action="setup-open-dashboard">Open dashboard</button>
      </div>
    </div>
  `;
}

function renderSetupProgress(title, message) {
  return `
    <div class="setup-progress" role="status" aria-live="polite">
      <div class="setup-progress-spinner" aria-hidden="true"></div>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(message || 'Working...')}</p>
      </div>
    </div>
  `;
}

function renderSetupPreview() {
  const preview = appState.setupPreview;
  if (!preview) {
    return `<p class="muted small">Preview checks the file before anything is saved.</p>`;
  }

  const stats = preview.stats || {};
  const rows = Array.isArray(preview.preview) ? preview.preview : [];
  return `
    <div class="setup-preview">
      <div class="setup-summary-grid">
        <div><strong>${formatNumber(stats.imported || 0)}</strong><span>New</span></div>
        <div><strong>${formatNumber(stats.updated || 0)}</strong><span>Updates</span></div>
        <div><strong>${formatNumber(stats.skipped || 0)}</strong><span>Skipped</span></div>
        <div><strong>${formatNumber(stats.failed || 0)}</strong><span>Failed</span></div>
      </div>
      <div class="table-scroll">
        <table class="table setup-preview-table">
          <thead><tr><th>Action</th><th>Name</th><th>Company</th><th>Title</th><th>Email</th><th>Connected</th></tr></thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                <td><span class="status-pill">${escapeHtml(row.action || '')}</span></td>
                <td>${escapeHtml(row.fullName || '')}</td>
                <td>${escapeHtml(row.companyName || '')}</td>
                <td>${escapeHtml(row.title || '')}</td>
                <td>${escapeHtml(row.email || '')}</td>
                <td>${escapeHtml(row.connectedOn || '')}</td>
              </tr>
              ${row.message ? `<tr class="setup-preview-message"><td></td><td colspan="5">${escapeHtml(row.message)}</td></tr>` : ''}
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function wireSetupDropZone() {
  const zone = document.getElementById('setup-drop-zone');
  if (!zone) return;
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      document.getElementById('setup-csv-file')?.click();
    }
  });
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragover');
    void handleSetupCsvFile(event.dataTransfer?.files?.[0]);
  });
}

async function readTextFile(file) {
  if (!file) return '';
  if (typeof file.text === 'function') {
    return await file.text();
  }
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result || '');
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

function formatFileSize(bytes = 0) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 KB';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024)).toLocaleString()} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function estimateCsvDataRows(csvContent = '') {
  const lines = String(csvContent || '').split(/\r\n|\r|\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /first\s*name/i.test(line) && /(last\s*name|company|position|email|url)/i.test(line));
  if (headerIndex >= 0) {
    return Math.max(0, lines.length - headerIndex - 1);
  }
  return Math.max(0, lines.length - 1);
}

function formatCsvUploadSummary(file, csvContent = '') {
  const rows = estimateCsvDataRows(csvContent);
  const sizeLabel = formatFileSize(file?.size || csvContent.length || 0);
  return `${formatNumber(rows)} data row${rows === 1 ? '' : 's'}, ${sizeLabel}`;
}

async function handleSetupCsvFile(file) {
  if (!file) return;
  persistSetupDraftFromDom();
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('Please choose the Connections.csv file from LinkedIn.', 'warning');
  }
  appState.setupCsvContent = await readTextFile(file);
  appState.setupCsvFileName = file.name;
  appState.setupPreview = null;
  await renderSetupWizard();
}

async function previewSetupCsv() {
  persistSetupDraftFromDom();
  if (!appState.setupCsvContent) {
    showToast('Choose your LinkedIn Connections.csv file first.', 'warning');
    return;
  }

  appState.setupBusy = true;
  try {
    appState.setupPreview = await api('/api/import/connections-csv/preview', {
      method: 'POST',
      body: JSON.stringify({ csvContent: appState.setupCsvContent, useEmptyState: false }),
    });
    showToast('CSV preview is ready.', 'success');
  } finally {
    appState.setupBusy = false;
    await renderSetupWizard();
  }
}

async function completeSetupWizard() {
  persistSetupDraftFromDom();
  const draft = appState.setupDraft;
  if (!draft.workspaceName.trim() || !draft.userName.trim() || !draft.userEmail.trim()) {
    appState.setupStep = 1;
    await renderSetupWizard();
    showToast('Workspace, name, and email are required.', 'warning');
    return;
  }

  appState.setupBusy = true;
  appState.setupProgressMessage = appState.setupCsvContent
    ? 'Saving setup and queuing your LinkedIn connections import...'
    : 'Saving setup...';
  try {
    const result = await api('/api/setup/complete', {
      method: 'POST',
      body: JSON.stringify({
        workspaceName: draft.workspaceName,
        userName: draft.userName,
        userEmail: draft.userEmail,
        owners: parseSetupOwners(draft.ownersText),
        licenseKey: draft.licenseKey,
        csvContent: appState.setupCsvContent,
        csvFileName: appState.setupCsvFileName,
      }),
    });
    appState.setupResult = result;
    appState.setupStatus = result.status;
    appState.setupStep = getSetupSteps().length;
    invalidateAppData();

    if (result.jobId) {
      appState.setupImportJobId = result.jobId;
      appState.setupProgressMessage = 'Import queued. Starting the background worker...';
      await renderSetupWizard();
      const job = await watchSetupImportJob(result.jobId);
      const stats = job?.result?.stats || job?.result?.importRun?.stats || {};
      appState.setupResult = {
        ...result,
        stats: {
          ...stats,
          imported: stats.imported || 0,
          updated: stats.updated || 0,
          skipped: stats.skipped || 0,
          failed: stats.failed || 0,
        },
      };
      appState.setupProgressMessage = 'Import complete.';
      showToast('Setup complete. LinkedIn connections imported.', 'success');
    } else {
      appState.setupProgressMessage = '';
      showToast('Setup complete.', 'success');
    }
  } catch (error) {
    appState.setupProgressMessage = error.message || String(error || 'Setup failed.');
    showToast(`Setup failed: ${error.message || error}`, 'error', 8000);
    throw error;
  } finally {
    appState.setupBusy = false;
    appState.setupImportJobId = '';
    await renderSetupWizard();
  }
}

async function watchSetupImportJob(jobId) {
  while (true) {
    const job = await api(`/api/background-jobs/${jobId}`, { skipCache: true });
    const message = job.progressMessage || humanize(job.status || 'running');
    appState.setupProgressMessage = message;
    await renderSetupWizard();

    if (job.status === 'completed') {
      invalidateAppData();
      return job;
    }
    if (job.status === 'failed') {
      throw new Error(job.errorMessage || 'LinkedIn connections import failed.');
    }
    if (job.status === 'cancelled') {
      throw new Error('LinkedIn connections import was cancelled.');
    }

    await sleep(1500);
  }
}

async function renderDashboardView() {
  renderLoadingState('Dashboard', "Building today's hiring radar...");
  setViewTitle('Dashboard');
  const dashboard = await api('/api/dashboard');
  if (!dashboard.todayQueue) dashboard.todayQueue = [];
  if (!dashboard.followUpAccounts) dashboard.followUpAccounts = [];
  if (!dashboard.newJobsToday) dashboard.newJobsToday = [];
  if (!dashboard.recommendedActions) dashboard.recommendedActions = [];
  if (!dashboard.recentlyDiscoveredBoards) dashboard.recentlyDiscoveredBoards = [];
  if (!dashboard.summary) dashboard.summary = {};
  let extended = { playbook: [], overdueFollowUps: [], staleAccounts: [], activityFeed: [], enrichmentFunnel: {}, alertQueue: [], sequenceQueue: [], introQueue: [] };
  try { extended = await api('/api/dashboard/extended'); } catch(e) { console.warn('Extended dashboard data unavailable:', e); }
  const topCompany = dashboard.todayQueue[0];
  const networkLeadersList = Array.isArray(dashboard.networkLeaders) ? dashboard.networkLeaders : [];
  const maxNetwork = Math.max(1, ...networkLeadersList.map((item) => item.connectionCount || 0));
  const coverageEvents = (extended.activityFeed || []).length + (dashboard.recentlyDiscoveredBoards || []).length;
  const queuePressure = (extended.overdueFollowUps || []).length + (extended.staleAccounts || []).length;
  const resolutionQueue = (dashboard.needsResolution && dashboard.needsResolution.length)
    ? dashboard.needsResolution
    : (extended.resolutionQueue || []);
  const resolutionPressure = dashboard.summary.needsResolutionCount || resolutionQueue.length || 0;
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
    {
      label: 'Resolution backlog',
      value: `${formatNumber(resolutionPressure)} accounts`,
      description: resolutionPressure ? 'These accounts still need cleaner domain, careers, or ATS identity before they become reliable hiring signals.' : 'Resolver backlog is under control right now.',
      tone: 'neutral',
    },
  ];

  const dupeGroups = detectDuplicates(dashboard.todayQueue);

  appRoot.innerHTML = `
    ${renderOnboardingTour()}
    <div class="dash-toolbar">${renderDashboardCustomizer()}<button class="ghost-button ghost-button--xs" data-action="export-pdf">Export PDF</button></div>
    ${dashSection('hero', `<section class="hero-card hero-card--dashboard">
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
            ${renderSignalChip('Needs resolution', formatNumber(resolutionPressure), 'neutral')}
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
    </section>`)}

    ${dashSection('trust', `<section class="trust-strip">
      ${renderTrustCard('Launch in 3 moves', 'Import, resolve, work', 'Seed accounts, run ATS discovery, then work the ranked queue.', 'Workbook, CSV, or manual entry', 'accent')}
      ${renderTrustCard('Coverage snapshot', `${formatNumber(dashboard.summary.accountCount || 0)} tracked accounts`, 'Contacts, configs, and imported jobs stay visible in one model.', `${formatNumber(dashboard.summary.discoveredBoardCount || 0)} ATS boards found`, 'success')}
      ${renderTrustCard('Audit trail', `${formatNumber(coverageEvents)} visible events`, 'Recent actions, imports, and board discovery remain reviewable.', `${formatNumber(dashboard.summary.newJobsLast24h || 0)} new jobs in 24h`, 'warning')}
    </section>`)}

    ${dashSection('workflow', renderDashboardWorkflowStrip({ dashboard, extended, topCompany, resolutionPressure }))}

    ${dashSection('metrics', `<section class="metrics-grid">
      ${renderMetricCard('Accounts tracked', dashboard.summary.accountCount, 'Target accounts with contacts, configs, or imported jobs')}
      ${renderMetricCard('Hiring accounts', dashboard.summary.hiringAccountCount, 'Companies with active normalized roles')}
      ${renderMetricCard('New jobs, 24h', dashboard.summary.newJobsLast24h, 'Freshly imported postings in the last day')}
      ${renderMetricCard('ATS boards found', dashboard.summary.discoveredBoardCount || 0, 'Mapped or discovered supported job boards')}
      ${renderMetricCard('Needs resolution', resolutionPressure, 'Accounts still missing trusted company identity or ATS resolution')}
    </section>`)}

    ${dashSection('playbook', extended.playbook.length ? `
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
    ` : '')}

    ${dashSection('alerts-bar', (extended.overdueFollowUps.length || extended.staleAccounts.length) ? `
    <section class="alert-bar">
      ${extended.overdueFollowUps.length ? `<div class="alert-item alert-item--danger"><strong>${extended.overdueFollowUps.length} overdue follow-up${extended.overdueFollowUps.length > 1 ? 's' : ''}</strong> \u2014 ${extended.overdueFollowUps.slice(0,3).map(a => escapeHtml(a.displayName)).join(', ')}${extended.overdueFollowUps.length > 3 ? '...' : ''}</div>` : ''}
      ${extended.staleAccounts.length ? `<div class="alert-item alert-item--warning"><strong>${extended.staleAccounts.length} stale account${extended.staleAccounts.length > 1 ? 's' : ''}</strong> \u2014 haven't been touched in 14+ days</div>` : ''}
    </section>
    ` : '')}

    ${dashSection('boards', (extended.alertQueue.length || extended.sequenceQueue.length || extended.introQueue.length) ? `
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
    ` : '')}

    ${dashSection('queue', `<section class="dashboard-grid">
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
              <h3>Needs resolution</h3>
              <p class="muted small">High-value accounts still missing domain, careers, or ATS identity signals.</p>
            </div>
            <a class="ghost-button" href="#/admin">Open review queue</a>
          </div>
          ${resolutionQueue.length ? `<div class="timeline">${resolutionQueue.map((item) => renderResolutionQueueItem(item)).join('')}</div>` : '<div class="empty-state">Identity resolution is in a healthy state right now.</div>'}
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
    </section>`)}

    ${dashSection('enrichment', (extended.enrichmentFunnel && extended.enrichmentFunnel.total) ? `
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
    ` : '')}

    ${dashSection('jobs-activity', `<section class="dashboard-grid">
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
    </section>`)}
    ${dashSection('heatmap', renderPipelineHeatmap(dashboard.todayQueue))}
    ${dashSection('smart-alerts', renderSmartAlerts(detectSmartAlerts(dashboard.todayQueue)))}
    ${dashSection('velocity', renderDealVelocity(dashboard.todayQueue))}
    ${dashSection('leaderboard', renderTeamLeaderboard(dashboard.todayQueue))}
    ${dashSection('data-quality', renderDataQualityPanel(dashboard.todayQueue))}
    ${dashSection('duplicates', renderDuplicatePanel(dupeGroups))}
    ${dashSection('sales-cycle', renderSalesCycleAnalytics(dashboard.todayQueue))}
    ${dashSection('charts', renderDashboardCharts(dashboard.todayQueue))}
  `;
  // Record score history for sparklines
  (dashboard.todayQueue || []).forEach(a => recordScoreHistory(a.id, getTargetScore(a)));
  // Desktop notifications for critical alerts
  if (appState.smartAlerts.filter(a => a.severity === 'danger').length > 0) {
    sendDesktopNotification('BD Engine Alert', `${appState.smartAlerts.filter(a => a.severity === 'danger').length} critical pipeline alerts detected`);
  }
  // Wire dashboard customizer
  wireDashboardCustomizer();
  // Wire onboarding
  wireOnboarding();
}

async function renderAccountsView() {
  renderLoadingState('Accounts', 'Loading ranked target accounts...');
  setViewTitle('Accounts');
  const stateBootstrap = await loadBootstrap(false, { includeFilters: true });
  const filters = stateBootstrap.filters || { atsTypes: [], industries: [] };
  const result = await api(`/api/accounts${buildQuery(appState.accountQuery)}`);
  result.items.forEach(a => {
    const score = getTargetScore(a);
    if (appState.previousScores[a.id] === undefined) appState.previousScores[a.id] = score;
  });
  const activeFilterCount = countAppliedFilters(appState.accountQuery);
  const hiringRows = result.items.filter((item) => (item.jobCount || 0) > 0).length;
  const industryOptions = filters.industries || [];
  const industryField = industryOptions.length
    ? `<select name="industry"><option value="">All industries</option>${industryOptions.map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.accountQuery.industry, value)}>${escapeHtml(value)}</option>`).join('')}</select>`
    : `<input name="industry" placeholder="Any industry" value="${escapeAttr(appState.accountQuery.industry)}">`;

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

    ${renderAccountPresetStrip()}

    <section class="detail-grid detail-grid--workspace">
      <div class="table-card">
        <div class="panel-header">
          <div>
            <h3>Account queue</h3>
            <p class="muted small">This is the working list. Use filters to narrow it to the accounts you can act on right now.</p>
          </div>
          <div class="panel-header-actions">
            <div class="view-toggle">
              <button class="view-toggle-btn ${!appState.kanbanMode ? 'active' : ''}" id="view-mode-table" aria-label="Table view">&#9776; Table</button>
              <button class="view-toggle-btn ${appState.kanbanMode ? 'active' : ''}" id="view-mode-kanban" aria-label="Kanban view">&#9638; Board</button>
            </div>
            <button class="ghost-button" data-action="export-csv" data-view="accounts" aria-label="Export accounts to CSV">Export CSV</button>
            <button class="ghost-button ${appState.pwaInstallPrompt ? '' : 'hidden'}" id="pwa-install-btn" aria-label="Install app">&#10515; Install</button>
            <span class="table-meta">${formatNumber(result.total)} tracked accounts</span>
          </div>
        </div>
        <form id="accounts-filter-form" class="filter-grid filter-grid--dense">
          ${renderField('Search', '<input name="q" placeholder="Company, owner, note, domain" value="' + escapeAttr(appState.accountQuery.q) + '">')}
          ${renderField('Hiring', `<select name="hiring"><option value="">All</option><option value="true" ${selected(appState.accountQuery.hiring, 'true')}>Active hiring</option></select>`)}
          ${renderField('Priority', renderPrioritySelect('priority', appState.accountQuery.priority, true))}
          ${renderField('Sort by', renderAccountSortSelect(appState.accountQuery.sortBy))}
          <div class="field field--action">
            <button class="filter-toggle-btn" type="button" id="toggle-advanced-filters">${appState.showAdvancedFilters ? '\u25B2 Fewer filters' : '\u25BC More filters'}</button>
            <button class="primary-button" type="submit">Apply</button>
            <button class="ghost-button" type="button" data-action="reset-filters" data-view="accounts">Reset</button>
            <button class="ghost-button" type="button" data-action="save-current-filter" aria-label="Save current filter">Save filter</button>
          </div>
          ${renderSavedFilters()}
          <div class="filter-advanced-fields${appState.showAdvancedFilters ? '' : ' hidden'}" id="advanced-filter-fields">
          ${renderField('ATS', `<select name="ats"><option value="">All ATS</option>${filters.atsTypes.map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.accountQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
          ${renderField('Status', renderAccountStatusSelect('status', appState.accountQuery.status, true))}
          ${renderField('Owner', renderOwnerSelect('owner', appState.accountQuery.owner, true))}
          ${renderField('Geography', `<select name="geography"><option value="">Any location</option><option value="canada" ${selected(appState.accountQuery.geography, 'canada')}>Canada only</option><option value="canada_us" ${selected(appState.accountQuery.geography, 'canada_us')}>Include US</option><option value="us" ${selected(appState.accountQuery.geography, 'us')}>US only</option></select>`)}
          ${renderField('Industry', industryField)}
          ${renderField('Recency', `<select name="recencyDays"><option value="">Any</option><option value="7" ${selected(appState.accountQuery.recencyDays, '7')}>Last 7 days</option><option value="14" ${selected(appState.accountQuery.recencyDays, '14')}>Last 14 days</option><option value="30" ${selected(appState.accountQuery.recencyDays, '30')}>Last 30 days</option></select>`)}
          ${renderField('Min contacts', `<input name="minContacts" type="number" min="0" value="${escapeAttr(appState.accountQuery.minContacts)}">`)}
          ${renderField('Min target score', `<input name="minTargetScore" type="number" min="0" max="100" value="${escapeAttr(appState.accountQuery.minTargetScore)}">`)}
          ${renderField('Outreach', `<select name="outreachStatus"><option value="">Any stage</option>${renderOutreachStageOptions(appState.accountQuery.outreachStatus, true)}</select>`)}
          </div>
        </form>
        ${renderActiveFilterStrip(appState.accountQuery)}
        ${appState.kanbanMode
          ? (result.items.length ? renderKanbanBoard(result.items) : '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDD0D</div>No accounts to show on the board.</div>')
          : (result.items.length ? renderAccountsTable(result.items) : '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDD0D</div>No accounts match the current filters.<div class="empty-state-suggestion">Try broadening your search, or <strong>reset a filter</strong> to see more results.</div></div>')}
        ${!appState.kanbanMode ? renderPagination('accounts', result.page, result.pageSize, result.total) : ''}
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
  // Record score history for sparklines
  result.items.forEach(a => recordScoreHistory(a.id, getTargetScore(a)));
  // Wire kanban drag-and-drop
  if (appState.kanbanMode) wireKanbanDragDrop();
  // Wire inline editing
  wireInlineEditing();
  // Wire bulk keyboard operations
  wireBulkKeyboard();
  // Wire custom field toggle
  document.getElementById('add-custom-field-toggle')?.addEventListener('click', () => {
    document.getElementById('custom-field-def-form')?.classList.toggle('hidden');
  });
  // View toggle handlers
  document.getElementById('view-mode-table')?.addEventListener('click', () => {
    appState.kanbanMode = false;
    localStorage.setItem('bd_kanban', 'false');
    renderAccountsView();
  });
  document.getElementById('view-mode-kanban')?.addEventListener('click', () => {
    appState.kanbanMode = true;
    localStorage.setItem('bd_kanban', 'true');
    renderAccountsView();
  });
  document.getElementById('pwa-install-btn')?.addEventListener('click', promptPwaInstall);
}

async function renderAccountDetail(accountId) {
  renderLoadingState('Account detail', 'Loading account context...');
  const detail = await api(`/api/accounts/${accountId}`);
  appState.accountDetail = detail;
  appState.generatedOutreach = null;
  setViewTitle(detail.account.displayName);
  const targetScore = getTargetScore(detail.account);
  const targetScoreExplanation = getTargetScoreExplanation(detail.account) || detail.account.recommendedAction || 'No target-score explanation available yet.';
  const connectionGraph = detail.account.connectionGraph || { shortestPathToDecisionMaker: { summary: 'No warm intro path mapped yet.', pathLength: 0 }, warmIntroCandidates: [], relationshipStrengthScore: 0 };
  const shortestPath = connectionGraph.shortestPathToDecisionMaker || { summary: 'No warm intro path mapped yet.', pathLength: 0 };
  const warmIntroCandidates = connectionGraph.warmIntroCandidates || [];
  const triggerAlerts = detail.account.triggerAlerts || [];
  const sequenceState = detail.account.sequenceState || { status: 'idle', nextStepLabel: 'Email', nextStepAt: null, adaptiveTimingReason: '', steps: [] };
  const suggestedOutreachTemplate = getSuggestedOutreachTemplate(detail);

  // Fetch hiring velocity in background (non-blocking)
  let hiringVelocity = [];
  try {
    const vData = await api(`/api/accounts/${accountId}/hiring-velocity`);
    if (vData.weeks) {
      hiringVelocity = Object.entries(vData.weeks).map(([label, count]) => ({ label, count }));
    }
  } catch(e) { console.warn('Hiring velocity data unavailable:', e); }

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
      <div class="status-pills-compact">
        ${renderStatusPill(detail.account.priority || 'medium', 'warm')}
        ${renderStatusPill(detail.account.status || 'new', 'neutral')}
        ${renderStatusPill(detail.account.outreachStatus || 'not_started', 'neutral')}
        ${renderStatusPill(detail.account.networkStrength, toneForNetwork(detail.account.networkStrength))}
        ${appState.statusPillsExpanded ? `
          ${renderStatusPill(detail.account.hiringStatus, detail.account.jobCount > 0 ? 'success' : 'neutral')}
          ${renderStatusPill(detail.account.enrichmentStatus || 'missing_inputs', toneForEnrichmentStatus(detail.account.enrichmentStatus || 'missing_inputs'))}
          ${renderStatusPill(detail.account.enrichmentConfidence || 'unresolved', toneForEnrichmentConfidence(detail.account.enrichmentConfidence || 'unresolved'))}
          ${detail.account.staleFlag ? renderStatusPill(detail.account.staleFlag, 'danger') : ''}
          ${(detail.account.atsTypes || []).map((item) => renderStatusPill(item, 'neutral')).join('')}
        ` : `<span class="status-pills-overflow">+${3 + (detail.account.staleFlag ? 1 : 0) + (detail.account.atsTypes || []).length} more</span>`}
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
        <div class="detail-card">
          <div class="panel-header"><div><h3>Next moves</h3><p class="muted small">Quick actions for this account.</p></div></div>
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
          <div class="button-row" style="margin-top:10px">
            <button class="primary-button" type="button" id="open-outreach-modal">Compose outreach</button>
          </div>
        </div>
      </div>

    <!-- Outreach composer modal -->
    <div id="outreach-modal-backdrop" class="modal-backdrop${appState.outreachModalOpen ? '' : ' hidden'}" role="dialog" aria-modal="true" aria-label="Outreach composer">
      <div class="modal-panel">
        <div class="panel-header">
          <div><h3>Outreach composer</h3><p class="muted small">Generate a message, pick a contact, and take action.</p></div>
          <button class="modal-close" type="button" aria-label="Close modal">&times;</button>
        </div>
        <div class="outreach-controls outreach-controls--stacked">
          <select id="outreach-contact-select" class="inline-select">
            ${detail.contacts.length
              ? detail.contacts.map((c, i) => `<option value="${escapeAttr(c.id || c.fullName || '')}" data-name="${escapeAttr(c.fullName || '')}" data-title="${escapeAttr(c.title || '')}" data-contact-id="${escapeAttr(c.id || '')}" data-email="${escapeAttr(c.email || '')}" data-linkedin-url="${escapeAttr(c.linkedinUrl || '')}" data-company="${escapeAttr(c.companyName || detail.account.displayName || '')}" data-notes="${escapeAttr(c.notes || '')}"${i === 0 ? ' selected' : ''}>${escapeHtml(c.fullName)}${c.title ? ' \u2014 ' + escapeHtml(c.title) : ''}</option>`).join('')
              : '<option value="">No contacts</option>'}
          </select>
          <select id="outreach-template-select" class="inline-select">
            <option value="cold" ${selected(suggestedOutreachTemplate, 'cold')}>Balanced hiring note</option>
            <option value="talent_partner" ${selected(suggestedOutreachTemplate, 'talent_partner')}>Talent / recruiter note</option>
            <option value="hiring_manager" ${selected(suggestedOutreachTemplate, 'hiring_manager')}>Hiring manager note</option>
            <option value="executive" ${selected(suggestedOutreachTemplate, 'executive')}>Executive note</option>
            <option value="warm_intro" ${selected(suggestedOutreachTemplate, 'warm_intro')}>Warm intro</option>
            <option value="follow_up" ${selected(suggestedOutreachTemplate, 'follow_up')}>Follow-up</option>
            <option value="re_engage" ${selected(suggestedOutreachTemplate, 're_engage')}>Re-open thread</option>
          </select>
          <div class="button-row">
            <button id="generate-outreach-button" class="secondary-button" data-action="generate-outreach" data-id="${detail.account.id}">Generate tailored note</button>
            <button id="generate-outreach-bundle-button" class="ghost-button" data-action="generate-outreach-bundle" data-id="${detail.account.id}" type="button">Generate 3 angles</button>
          </div>
        </div>
        <div class="micro-button-row">
          <button class="micro-button micro-button--primary" data-action="generate-outreach-template" data-id="${detail.account.id}" data-template="cold" type="button">Balanced</button>
          <button class="micro-button" data-action="generate-outreach-template" data-id="${detail.account.id}" data-template="talent_partner" type="button">Recruiter</button>
          <button class="micro-button" data-action="generate-outreach-template" data-id="${detail.account.id}" data-template="hiring_manager" type="button">Hiring manager</button>
          <button class="micro-button" data-action="generate-outreach-template" data-id="${detail.account.id}" data-template="executive" type="button">Executive</button>
          <button class="micro-button" data-action="generate-outreach-template" data-id="${detail.account.id}" data-template="follow_up" type="button">Follow-up</button>
        </div>
        <div id="outreach-prompt-body" class="empty-state empty-state--compact">${detail.account.outreachDraft ? escapeHtml(detail.account.outreachDraft) : 'Pick the contact and angle you want, then generate a note built from live hiring signals, the likely pain point, and the best route into the account.'}</div>
      </div>
    </div>

      <div class="action-zone-col">
        <div class="table-card">
          <div class="panel-header"><div><h3>Top contacts</h3><p class="muted small">Click a name to open LinkedIn, or click anywhere else on the row to select for outreach.</p></div></div>
          ${detail.contacts.length ? '<div class="table-scroll"><table class="table"><thead><tr><th>Contact</th><th>Title</th><th>Score</th><th>Connected</th><th>Action</th></tr></thead><tbody>' +
            detail.contacts.map((c) => '<tr class="contact-row-selectable" data-contact-id="' + escapeAttr(c.id || '') + '" data-contact-name="' + escapeAttr(c.fullName) + '" data-contact-title="' + escapeAttr(c.title || '') + '"><td>' + (() => { const linkedinHref = getContactLinkedInHref(c, detail.account.displayName); return linkedinHref ? '<a class="row-link" href="' + escapeAttr(linkedinHref) + '" target="_blank" rel="noreferrer"><strong>' + escapeHtml(c.fullName || '') + '</strong></a>' : '<strong>' + escapeHtml(c.fullName || '') + '</strong>'; })() + '</td><td>' + escapeHtml(c.title || '') + '</td><td>' + formatNumber(c.priorityScore) + '</td><td>' + formatDate(c.connectedOn) + '</td><td><button class="ghost-button ghost-button--xs" type="button" data-action="select-contact-outreach" data-account-id="' + escapeAttr(detail.account.id) + '" data-contact-id="' + escapeAttr(c.id || '') + '" data-contact-name="' + escapeAttr(c.fullName || '') + '">Outreach</button></td></tr>').join('') +
            '</tbody></table></div>' : '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDC64</div>No contacts imported yet.<div class="empty-state-suggestion">Import a <strong>LinkedIn Connections CSV</strong> from the Admin view to populate contacts.</div></div>'}
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
            ${detail.activity.length ? detail.activity.map(renderTimelineItem).join('') : '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDCDD</div>No activity yet.<div class="empty-state-suggestion">Log your first outreach or note using the form above.</div></div>'}
          </div>
        </div>
      </div>
    </section>

    <section class="detail-grid detail-grid--workspace">
      <div class="panel-stack">
        ${renderAccountNotesPanel(detail.account.id)}
        ${renderOutreachSequencePanel(detail.account.id)}
        ${renderActivityTimeline(detail.account.id)}
        ${renderCustomFieldsPanel(detail.account.id)}
        ${renderIdentityResolutionCard(detail)}
        ${renderResolutionHistoryCard(detail)}
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
          ${detail.jobs.length ? renderAccountJobsTable(detail.jobs) : '<div class="empty-state"><div class="empty-state-icon">\uD83D\uDCBC</div>No jobs connected to this account yet.<div class="empty-state-suggestion">Run <strong>ATS discovery</strong> or <strong>live import</strong> from Admin to pull in open roles.</div></div>'}
        </div>

        <div class="table-card">
          <div class="panel-header"><div><h3>ATS configs</h3><p class="muted small">Discovery results and import sources.</p></div></div>
          ${detail.configs.length ? renderAccountConfigsTable(detail.configs) : '<div class="empty-state">No ATS config rows for this account yet.</div>'}
        </div>
      </div>
    </section>
  `;
  applyPendingOutreachContact(detail.account.id);
  syncOutreachComposerState();
  // Wire notes
  document.getElementById('add-note-btn')?.addEventListener('click', () => {
    const input = document.getElementById('note-input');
    if (input?.value.trim()) {
      addAccountNote(accountId, input.value);
      const panel = document.querySelector('.notes-panel');
      if (panel) panel.outerHTML = renderAccountNotesPanel(accountId);
      // Re-wire after re-render
      document.getElementById('add-note-btn')?.addEventListener('click', arguments.callee);
    }
  });
  document.querySelectorAll('.note-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteAccountNote(btn.dataset.accountId, Number(btn.dataset.noteId));
      const panel = document.querySelector('.notes-panel');
      if (panel) panel.outerHTML = renderAccountNotesPanel(btn.dataset.accountId);
    });
  });
  // Request notification permission on first detail view
  requestNotificationPermission();
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
      <div class="panel-header"><div><h3>Contact intelligence</h3><p class="muted small">Your network ranked by company overlap and title relevance.</p></div><button class="ghost-button" data-action="export-csv" data-view="contacts" aria-label="Export contacts to CSV">Export CSV</button></div>
      <form id="contacts-filter-form" class="filter-grid filter-grid--compact">
        ${renderField('Search', `<input name="q" value="${escapeAttr(appState.contactQuery.q)}" placeholder="Name, company, title">`)}
        ${renderField('Min score', `<input name="minScore" type="number" min="0" value="${escapeAttr(appState.contactQuery.minScore)}">`)}
        ${renderField('Outreach', `<select name="outreachStatus"><option value="">Any stage</option><option value="not_started" ${selected(appState.contactQuery.outreachStatus, 'not_started')}>Not started</option><option value="researching" ${selected(appState.contactQuery.outreachStatus, 'researching')}>Researching</option><option value="ready_to_contact" ${selected(appState.contactQuery.outreachStatus, 'ready_to_contact')}>Ready to contact</option><option value="contacted" ${selected(appState.contactQuery.outreachStatus, 'contacted')}>Contacted</option><option value="replied" ${selected(appState.contactQuery.outreachStatus, 'replied')}>Replied</option><option value="opportunity" ${selected(appState.contactQuery.outreachStatus, 'opportunity')}>Opportunity</option></select>`)}
        <div class="field field--action"><label>Refresh queue</label><button class="primary-button" type="submit">Apply filters</button><button class="ghost-button" type="button" data-action="reset-filters" data-view="contacts">Reset</button></div>
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
      <div class="panel-header"><div><h3>Imported jobs</h3><p class="muted small">Use filters to isolate the freshest demand signals by company, ATS, and recency.</p></div><button class="ghost-button" data-action="export-csv" data-view="jobs" aria-label="Export jobs to CSV">Export CSV</button></div>
      <form id="jobs-filter-form" class="filter-grid filter-grid--compact">
        ${renderField('Search', `<input name="q" value="${escapeAttr(appState.jobQuery.q)}" placeholder="Role, company, location">`)}
        ${renderField('ATS', `<select name="ats"><option value="">All ATS</option>${atsOptions.map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.jobQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
        ${renderField('Recency', `<select name="recencyDays"><option value="">Any</option><option value="7" ${selected(appState.jobQuery.recencyDays, '7')}>Last 7 days</option><option value="14" ${selected(appState.jobQuery.recencyDays, '14')}>Last 14 days</option><option value="30" ${selected(appState.jobQuery.recencyDays, '30')}>Last 30 days</option></select>`)}
        ${renderField('Active', `<select name="active"><option value="">All</option><option value="true" ${selected(appState.jobQuery.active, 'true')}>Active only</option><option value="false" ${selected(appState.jobQuery.active, 'false')}>Inactive only</option></select>`)}
        ${renderField('New jobs', `<select name="isNew"><option value="">All</option><option value="true" ${selected(appState.jobQuery.isNew, 'true')}>New this sync</option><option value="false" ${selected(appState.jobQuery.isNew, 'false')}>Existing</option></select>`)}
        ${renderField('Sort by', `<select name="sortBy"><option value="">Posted date</option><option value="retrieved" ${selected(appState.jobQuery.sortBy, 'retrieved')}>Retrieved date</option></select>`)}
        <div class="field field--action"><label>Refresh queue</label><button class="primary-button" type="submit">Apply filters</button><button class="ghost-button" type="button" data-action="reset-filters" data-view="jobs">Reset</button></div>
      </form>
      ${result.items.length ? renderJobsTable(result.items) : '<div class="empty-state">No jobs match the current filter set.</div>'}
      ${renderPagination('jobs', result.page, result.pageSize, result.total)}
    </section>
  `;
}

function renderCollapsibleStart(sectionId, title, subtitle) {
  const collapsed = appState.adminCollapsed[sectionId];
  return `<div class="form-card admin-section" id="admin-section-${escapeAttr(sectionId)}">
    <div class="collapsible-header${collapsed ? ' collapsed' : ''}" data-collapse-id="${escapeAttr(sectionId)}">
      <div class="panel-header" style="margin:0;flex:1"><div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p class="muted small">${subtitle}</p>` : ''}</div></div>
      <span class="chevron">\u25BC</span>
    </div>
    <div class="collapsible-body${collapsed ? ' collapsed' : ''}">`;
}

function renderCollapsibleEnd() {
  return `</div></div>`;
}

function persistAdminCollapsed() {
  localStorage.setItem('bd_admin_collapsed', JSON.stringify(appState.adminCollapsed));
}

function setCollapsibleState(header, isCollapsed) {
  const id = header.dataset.collapseId;
  const body = header.nextElementSibling;
  header.classList.toggle('collapsed', isCollapsed);
  body?.classList.toggle('collapsed', isCollapsed);
  header.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  appState.adminCollapsed[id] = isCollapsed;
  persistAdminCollapsed();
}

function wireCollapsibleSections() {
  document.querySelectorAll('.collapsible-header[data-collapse-id]').forEach((header) => {
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', header.classList.contains('collapsed') ? 'false' : 'true');
    const toggleCollapse = () => {
      setCollapsibleState(header, !header.classList.contains('collapsed'));
    };
    header.addEventListener('click', toggleCollapse);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(); }
    });
  });
}

function openAdminSection(sectionId) {
  const section = document.getElementById(`admin-section-${sectionId}`);
  const header = section?.querySelector('.collapsible-header[data-collapse-id]');
  if (header) {
    setCollapsibleState(header, false);
    window.requestAnimationFrame(() => {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function renderAdminCommandStrip({ summary, runtime, reviewQueueCount, enrichmentQueue, rolloutRemainingCount, rolloutActive }) {
  const unresolvedCount = summary.unresolvedCount || 0;
  const activeConfigs = summary.activeCount || 0;
  const enrichmentCount = enrichmentQueue?.total || 0;
  return `
    <section class="admin-command-strip" aria-label="Admin command strip">
      <article class="command-card command-card--warning">
        <span class="command-card__step">1</span>
        <div class="command-card__copy">
          <strong>Review queue</strong>
          <span>${formatNumber(reviewQueueCount)} config items</span>
          <small>${formatNumber(enrichmentCount)} enrichment candidates</small>
        </div>
        <button class="ghost-button ghost-button--xs" type="button" data-action="open-admin-section" data-section-id="review-queues">Open</button>
      </article>
      <article class="command-card command-card--accent">
        <span class="command-card__step">2</span>
        <div class="command-card__copy">
          <strong>Discover boards</strong>
          <span>${formatNumber(unresolvedCount)} unresolved</span>
          <small>Unresolved configs only</small>
        </div>
        <button class="secondary-button ghost-button--xs" type="button" data-action="run-discovery">Run</button>
      </article>
      <article class="command-card command-card--success">
        <span class="command-card__step">3</span>
        <div class="command-card__copy">
          <strong>Import live jobs</strong>
          <span>${formatNumber(activeConfigs)} active boards</span>
          <small>${formatNumber(runtime.queuedJobs || 0)} jobs queued</small>
        </div>
        <button class="secondary-button ghost-button--xs" type="button" data-action="run-live-import">Import</button>
      </article>
      <article class="command-card ${rolloutActive ? 'command-card--accent' : (rolloutRemainingCount > 0 ? 'command-card--warning' : 'command-card--success')}">
        <span class="command-card__step">4</span>
        <div class="command-card__copy">
          <strong>Score rollout</strong>
          <span>${rolloutActive ? 'Worker active' : `${formatNumber(rolloutRemainingCount)} pending`}</span>
          <small>Target intelligence fields</small>
        </div>
        <button class="primary-button ghost-button--xs" type="button" data-action="run-target-score-rollout"${(!rolloutActive && rolloutRemainingCount <= 0) ? ' disabled' : ''}>${rolloutActive ? 'Monitor' : (rolloutRemainingCount > 0 ? 'Run' : 'Done')}</button>
      </article>
      <article class="command-card">
        <span class="command-card__step">Ops</span>
        <div class="command-card__copy">
          <strong>Pipeline panel</strong>
          <span>Advanced controls</span>
          <small>Discovery, enrichment, sheets</small>
        </div>
        <button class="ghost-button ghost-button--xs" type="button" data-action="open-admin-section" data-section-id="pipeline-ops">Open</button>
      </article>
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
  const stateBootstrap = batch.bootstrap || {};
  if (!stateBootstrap.settings) stateBootstrap.settings = {};
  if (!stateBootstrap.defaults) stateBootstrap.defaults = {};
  if (!stateBootstrap.workspace) stateBootstrap.workspace = {};
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

    ${renderAdminCommandStrip({ summary, runtime, reviewQueueCount, enrichmentQueue, rolloutRemainingCount, rolloutActive })}

    <section class="admin-grid">
      <div class="two-column">
        ${renderCollapsibleStart('enrichment-coverage', 'Company enrichment coverage', 'Canonical domains, careers pages, aliases, and identity confidence feeding the resolver.')}
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
        ${renderCollapsibleEnd()}

        ${renderCollapsibleStart('enrichment-queue', 'Enrichment review queue', `Sorted by target score, then hiring velocity, then engagement. ${formatNumber(enrichmentQueue.total || 0)} companies in queue.`)}
          ${renderEnrichmentFilters()}
          ${renderEnrichmentQueuePanel(enrichmentQueue)}
        ${renderCollapsibleEnd()}
      </div>

      <div class="two-column">
        ${renderCollapsibleStart('resolver-coverage', 'Resolver coverage', 'Coverage, confidence mix, and failure reasons for ATS resolution across the tracked company set.')}
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
        ${renderCollapsibleEnd()}

        ${renderCollapsibleStart('review-queues', 'Review queues', 'Only high-confidence boards auto-activate. Medium-confidence results and unresolved companies land here for fast review.')}
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
        ${renderCollapsibleEnd()}
      </div>

      <div class="two-column">
        ${renderCollapsibleStart('runtime-status', 'Runtime status', 'See whether the server is warm and whether background jobs are queued or running.')}
          <div id="runtime-status-panel"></div>
        ${renderCollapsibleEnd()}
        ${renderCollapsibleStart('background-jobs', 'Background jobs', 'Long-running imports, discovery, and sheet syncs now run out of band.')}
          <div id="background-jobs-panel" class="timeline timeline--jobs"></div>
        ${renderCollapsibleEnd()}
      </div>

      <div class="two-column">
        ${renderCollapsibleStart('pipeline-ops', 'Pipeline operations', 'Run discovery, import jobs, or reseed the app without touching the spreadsheet manually.')}
          <div class="actions-grid">
            <div class="action-card">
              <p class="eyebrow">Full pipeline</p>
              <h4>Run BD Engine</h4>
              <p class="small muted">Runs the legacy Google Sheets pipeline in one pass. Requires a Spreadsheet ID in the Google Sheets card.</p>
              <button class="primary-button" data-action="run-full-engine">Run Full Engine</button>
            </div>
            <div class="action-card">
              <p class="eyebrow">Identity enrichment</p>
              <h4>Enrich company inputs</h4>
              <p class="small muted">Use the cheap local pass first, then run the deeper web verifier only for the accounts that still need stronger evidence.</p>
              <div class="inline-field-stack">
                <input id="enrichment-limit" type="number" min="1" value="50" placeholder="Companies to enrich">
                <label class="field"><span class="small muted">Force refresh</span><select id="enrichment-force-refresh"><option value="false" selected>No</option><option value="true">Yes</option></select></label>
                <div class="button-row button-row--wrap">
                  <button class="ghost-button" type="button" data-action="run-local-enrichment">Fast local enrich</button>
                  <button class="secondary-button" type="button" data-action="run-enrichment">Deep verify</button>
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
        ${renderCollapsibleEnd()}

        ${renderCollapsibleStart('billing-subscription', 'Billing & Subscription', 'Manage your plan and checkout.')}
          <div class="settings-grid">
            <div class="action-card">
              <p class="eyebrow">Current Plan: ${escapeHtml(batch.billing?.plan?.name || 'Trial')}</p>
              <h4>Upgrade your workspace</h4>
              <p class="small muted">You are currently on the ${escapeHtml(batch.billing?.plan?.displayName || 'Trial')} plan. Select a new plan to upgrade via Stripe.</p>
              <div class="inline-field-stack">
                <select id="billing-plan-select">
                  <option value="jobseeker">Job Seeker ($5/mo)</option>
                  <option value="sales">Sales Professional ($10/mo)</option>
                </select>
                <div class="button-row">
                  <button class="primary-button" type="button" data-action="billing-checkout">Subscribe via Stripe</button>
                </div>
              </div>
            </div>
          </div>
        ${renderCollapsibleEnd()}

        ${renderCollapsibleStart('scoring-settings', 'Scoring settings', 'These map directly to the old Setup controls.')}
          <form id="settings-form" class="settings-grid">
            ${renderField('Min company connections', `<input name="minCompanyConnections" type="number" min="0" value="${escapeAttr(stateBootstrap.settings.minCompanyConnections)}">`)}
            ${renderField('Min jobs posted', `<input name="minJobsPosted" type="number" min="0" value="${escapeAttr(stateBootstrap.settings.minJobsPosted)}">`)}
            ${renderField('Contact priority threshold', `<input name="contactPriorityThreshold" type="number" min="0" value="${escapeAttr(stateBootstrap.settings.contactPriorityThreshold)}">`)}
            ${renderField('Max companies to review', `<input name="maxCompaniesToReview" type="number" min="1" value="${escapeAttr(stateBootstrap.settings.maxCompaniesToReview)}">`)}
            ${renderField('Geography focus', `<input name="geographyFocus" value="${escapeAttr(stateBootstrap.settings.geographyFocus)}">`)}
            ${renderField('GTA priority', `<select name="gtaPriority"><option value="true" ${selected(String(stateBootstrap.settings.gtaPriority), 'true')}>Enabled</option><option value="false" ${selected(String(stateBootstrap.settings.gtaPriority), 'false')}>Disabled</option></select>`)}
            <div><button class="primary-button" type="submit">Save settings</button></div>
          </form>
        ${renderCollapsibleEnd()}

        ${renderCollapsibleStart('automation-rules', 'Automation Rules', 'Define rules that auto-apply when pipeline conditions are met.')}
          ${renderAutomationRulesPanel()}
        ${renderCollapsibleEnd()}

        ${renderCollapsibleStart('alert-thresholds', 'Alert Thresholds', 'Customize when smart alerts trigger on your pipeline.')}
          ${renderAlertThresholdsPanel()}
        ${renderCollapsibleEnd()}
      </div>

      <div class="two-column">
        ${renderCollapsibleStart('ats-config-form', `${appState.configEditingId ? 'Edit ATS config' : 'Add ATS config'}`, 'Admin-managed job board records replace hardcoded spreadsheet helpers.')}
          ${appState.configEditingId ? '<div style="text-align:right;margin-bottom:8px"><button class="ghost-button" data-action="new-config">Clear form</button></div>' : ''}
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
        ${renderCollapsibleEnd()}

        ${renderCollapsibleStart('ats-config-records', 'ATS config records', 'Discovery results, manual overrides, and live import status for every tracked company.')}
          <form id="configs-filter-form" class="filter-grid filter-grid--compact">
            ${renderField('Search', `<input name="q" value="${escapeAttr(appState.configQuery.q)}" placeholder="Company, board ID, URL">`)}
            ${renderField('ATS', `<select name="ats"><option value="">All</option>${(stateBootstrap.filters.atsTypes || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
            ${renderField('Discovery', `<select name="discoveryStatus"><option value="">All</option>${(stateBootstrap.filters.configDiscoveryStatuses || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.discoveryStatus, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Confidence', `<select name="confidenceBand"><option value="">All</option>${(stateBootstrap.filters.configConfidenceBands || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.confidenceBand, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Review', `<select name="reviewStatus"><option value="">All</option>${(stateBootstrap.filters.configReviewStatuses || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.reviewStatus, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Active', `<select name="active"><option value="">All</option><option value="true" ${selected(appState.configQuery.active, 'true')}>Active</option><option value="false" ${selected(appState.configQuery.active, 'false')}>Inactive</option></select>`)}
            <div class="field field--action"><label>Refresh queue</label><button class="primary-button" type="submit">Apply filters</button><button class="ghost-button" type="button" data-action="reset-filters" data-view="configs">Reset</button></div>
          </form>
          ${configs.items.length ? renderConfigsTable(configs.items) : '<div class="empty-state">No config rows match the current filters.</div>'}
          ${renderPagination('configs', configs.page, configs.pageSize, configs.total)}
        ${renderCollapsibleEnd()}
      </div>
    </section>
  `;

  if (appState.configEditingId) {
    populateConfigForm(appState.configEditingId);
  } else {
    resetConfigForm();
  }

  hydrateAdminRuntimePanels(runtime);
  wireCollapsibleSections();
  // Wire automation rules
  document.getElementById('add-auto-rule')?.addEventListener('click', () => {
    const trigger = document.getElementById('auto-trigger')?.value;
    const triggerValue = document.getElementById('auto-trigger-value')?.value || '';
    const action = document.getElementById('auto-action')?.value;
    const actionValue = document.getElementById('auto-action-value')?.value || '';
    if (!trigger || !action || !actionValue) { showToast('Fill in all rule fields.', 'warning'); return; }
    addAutomationRule({ trigger, triggerValue, action, actionValue });
    showToast('Automation rule added.', 'success');
    renderAdminView();
  });
  document.querySelectorAll('[data-toggle-rule]').forEach(btn => {
    btn.addEventListener('click', () => { toggleAutomationRule(Number(btn.dataset.toggleRule)); renderAdminView(); });
  });
  document.querySelectorAll('[data-delete-rule]').forEach(btn => {
    btn.addEventListener('click', () => { deleteAutomationRule(Number(btn.dataset.deleteRule)); renderAdminView(); });
  });
}
async function exportAccountsCsv() {
  const result = await api(`/api/accounts${buildQuery({ ...appState.accountQuery, page: 1, pageSize: 10000 })}`);
  exportToCsv('accounts.csv',
    ['Company', 'Domain', 'Target Score', 'Priority', 'Status', 'Owner', 'Outreach Status', 'Hiring Velocity', 'Jobs 30d', 'Next Action', 'Tags'],
    result.items.map(a => [a.displayName, a.domain, getTargetScore(a), a.priority, a.status, a.owner, a.outreachStatus, a.hiringVelocity, a.jobsLast30Days, a.nextAction, (a.tags || []).join('; ')])
  );
}

async function exportContactsCsv() {
  const result = await api(`/api/contacts${buildQuery({ ...appState.contactQuery, page: 1, pageSize: 10000 })}`);
  exportToCsv('contacts.csv',
    ['Name', 'Company', 'Title', 'Score', 'Connected On', 'LinkedIn', 'Outreach Status'],
    result.items.map(c => [c.fullName, c.companyName, c.title, c.priorityScore, c.connectedOn, c.linkedinUrl, c.outreachStatus])
  );
}

async function exportJobsCsv() {
  const result = await api(`/api/jobs${buildQuery({ ...appState.jobQuery, page: 1, pageSize: 10000 })}`);
  exportToCsv('jobs.csv',
    ['Title', 'Company', 'Location', 'ATS', 'Posted', 'Active', 'URL'],
    result.items.map(j => [j.title, j.companyName, j.location, j.atsType, j.postedAt, j.active !== false ? 'Yes' : 'No', j.jobUrl || j.url])
  );
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
    <div id="bulk-action-bar" class="bulk-action-bar hidden" role="toolbar" aria-label="Bulk actions">
      <span id="bulk-count">0 selected</span>
      <select id="bulk-status" aria-label="Bulk status change"><option value="">Change status...</option><option value="new">New</option><option value="researching">Researching</option><option value="outreach">Outreach</option><option value="engaged">Engaged</option><option value="client">Client</option><option value="paused">Paused</option></select>
      <select id="bulk-priority" aria-label="Bulk priority change"><option value="">Change priority...</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      ${renderOwnerSelect('bulk-owner', '', true).replace('name="bulk-owner"', 'id="bulk-owner" aria-label="Bulk owner change"')}
      <input id="bulk-tags" placeholder="Add tags..." class="compact-input" aria-label="Bulk add tags">
      <button class="secondary-button" data-action="apply-bulk-update">Apply</button>
    </div>
    <div class="table-scroll"><table class="table"><thead><tr><th><input type="checkbox" id="bulk-select-all"></th><th>Company</th><th>Health</th><th>Target score</th><th>Signal mix</th><th>Owner / next step</th><th>Network</th><th>Status</th><th>ATS</th><th>Actions</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr class="${item.staleFlag === 'STALE' ? 'row--stale' : ''}">
          <td><input type="checkbox" class="bulk-checkbox" value="${item.id}"></td>
          <td><a class="row-link" href="#/accounts/${item.id}">${escapeHtml(item.displayName)}</a><div class="small muted">${escapeHtml(item.domain || item.topContactName || item.recommendedAction || '')}</div><div class="small muted">${escapeHtml(renderTargetScoreSignalSummary(item))}</div></td>
          <td>${renderHealthRing(computeHealthScore(item))}</td>
          <td>${formatNumber(getTargetScore(item))}${renderScoreDelta(item.id, getTargetScore(item))}${renderSparkline(item.id)}<div class="small muted">${escapeHtml(getTargetScoreExplanation(item) || humanize(item.priority || 'medium'))}</div></td>
          <td>${formatNumber(item.hiringVelocity || 0)} velocity<div class="small muted">${formatNumber(item.jobsLast30Days || 0)} jobs / 30d \u00b7 ${formatNumber(item.jobsLast90Days || 0)} / 90d</div></td>
          <td data-inline-edit="owner" data-account-id="${item.id}" data-current-value="${escapeAttr(item.owner || '')}" title="Double-click to edit">${escapeHtml(item.owner || 'Unassigned')}<div class="small muted">${escapeHtml(item.nextAction || 'No next action set')}</div></td>
          <td>${renderStatusPill(item.networkStrength, toneForNetwork(item.networkStrength))}<div class="small muted">${formatNumber(item.engagementScore || 0)} engagement</div></td>
          <td>${renderStatusPill(item.status || 'new', 'neutral')}<div class="small muted">${escapeHtml(humanize(item.outreachStatus || 'not_started'))}</div></td>
          <td>${renderAccountResolutionSummary(item)}</td>
          <td><div class="button-row"><button class="ghost-button" data-action="open-account" data-id="${item.id}">Open</button><button class="ghost-button" data-action="quick-log-inline" data-id="${item.id}" data-name="${escapeAttr(item.displayName)}">Log</button></div></td>
        </tr>
        <tr id="quick-log-${item.id}" class="quick-log-row hidden">
          <td colspan="10">
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
    <div class="table-scroll"><table class="table"><thead><tr><th>Contact</th><th>Company</th><th>Title</th><th>Score</th><th>Connected</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.fullName)}</strong><div class="small muted">${item.linkedinUrl ? `<a class="row-link" href="${escapeAttr(item.linkedinUrl)}" target="_blank" rel="noreferrer">LinkedIn</a>` : 'No URL'}</div></td>
          <td>${item.accountId ? `<a class="row-link" href="#/accounts/${item.accountId}">${escapeHtml(item.companyName || '')}</a>` : escapeHtml(item.companyName || '')}</td>
          <td>${escapeHtml(item.title || '')}</td>
          <td>${formatNumber(item.priorityScore)}</td>
          <td>${formatDate(item.connectedOn)}</td>
          <td>${renderStatusPill(item.outreachStatus || 'not_started', 'neutral')}</td>
          <td>
            <div class="button-row button-row--wrap">
              <button class="ghost-button ghost-button--xs" type="button" data-action="open-contact-outreach" data-account-id="${escapeAttr(item.accountId || '')}" data-contact-id="${escapeAttr(item.id || '')}" data-contact-name="${escapeAttr(item.fullName || '')}" ${item.accountId ? '' : 'disabled'}>Outreach</button>
            </div>
            <form id="contact-inline-form" data-contact-id="${item.id}" class="detail-form"><div class="inline-field"><label>Stage</label><select name="outreachStatus"><option value="not_started" ${selected(item.outreachStatus, 'not_started')}>Not started</option><option value="researching" ${selected(item.outreachStatus, 'researching')}>Researching</option><option value="ready_to_contact" ${selected(item.outreachStatus, 'ready_to_contact')}>Ready</option><option value="contacted" ${selected(item.outreachStatus, 'contacted')}>Contacted</option><option value="replied" ${selected(item.outreachStatus, 'replied')}>Replied</option><option value="opportunity" ${selected(item.outreachStatus, 'opportunity')}>Opportunity</option></select></div><div class="inline-field"><label>Notes</label><input name="notes" value="${escapeAttr(item.notes || '')}" placeholder="Short note"></div><button class="ghost-button" type="submit">Save</button></form>
          </td>
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
      <button class="ghost-button" type="button" data-action="apply-enrichment-filter">Apply</button>
      <button class="ghost-button" type="button" data-action="reset-filters" data-view="enrichment">Reset</button>
      <span class="small muted">Quick:</span>
      <button class="ghost-button ghost-button--xs" type="button" data-action="enrichment-top-n" data-topn="100">Top 100</button>
      <button class="ghost-button ghost-button--xs" type="button" data-action="enrichment-top-n" data-topn="250">Top 250</button>
      <button class="ghost-button ghost-button--xs" type="button" data-action="enrichment-top-n" data-topn="">All</button>
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
            <td>${escapeHtml(item.reviewReason || getTargetScoreExplanation(item) || item.enrichmentFailureReason || '')}${renderEnrichmentSignalPills(item, { compact: true })}<div class="small muted">${safeJoin(item.aliases)}</div></td>
            <td><div class="button-row button-row--wrap"><button class="ghost-button ghost-button--xs" data-action="account-quick-enrich" data-id="${item.id}">Quick</button><button class="secondary-button ghost-button--xs" data-action="account-resolve-now" data-id="${item.id}">Resolve</button><button class="ghost-button ghost-button--xs" data-action="expand-enrichment-row" data-id="${item.id}">Edit</button></div></td>
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
  const header = document.querySelector('[data-collapse-id="enrichment-queue"]');
  const panel = header ? header.nextElementSibling : document.getElementById('enrichment-queue-panel');
  if (!panel) return;
  const result = await api(`/api/enrichment/queue${buildQuery(appState.enrichmentQuery)}`);
  panel.innerHTML = `
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

function toneForEnrichmentStatus(status) {
  if (status === 'verified' || status === 'manual') return 'success';
  if (status === 'enriched') return 'accent';
  if (status === 'unresolved' || status === 'failed') return 'warning';
  if (status === 'missing_inputs') return 'danger';
  return 'neutral';
}

function toneForEnrichmentConfidence(confidence) {
  if (confidence === 'high') return 'success';
  if (confidence === 'medium') return 'warning';
  if (confidence === 'low') return 'accent';
  return 'neutral';
}

function isFutureIsoDate(value) {
  if (!value) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > Date.now();
}

function getEnrichmentReasonSignals(item = {}) {
  const seen = new Set();
  const signals = [];
  const addSignal = (label, tone) => {
    const key = `${label}|${tone}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    signals.push({ label, tone });
  };

  const canonicalDomain = (item.canonicalDomain || item.domain || '').trim();
  const careersUrl = (item.careersUrl || '').trim();
  const status = String(item.enrichmentStatus || '').toLowerCase();
  const confidence = String(item.enrichmentConfidence || '').toLowerCase();
  const failureReason = `${item.enrichmentFailureReason || ''} ${item.reviewReason || ''}`.toLowerCase();

  if (!canonicalDomain) addSignal('No domain', 'warning');
  if (!careersUrl) addSignal('No careers page', 'warning');
  if (status === 'missing_inputs') addSignal('Missing inputs', 'danger');
  if (status === 'unresolved' || confidence === 'unresolved') addSignal('Needs review', 'warning');
  if (isFutureIsoDate(item.nextEnrichmentAttemptAt)) addSignal('Cooldown', 'neutral');
  if (failureReason.includes('unsupported')) addSignal('Unsupported ATS', 'neutral');
  if (failureReason.includes('custom careers')) addSignal('Custom careers', 'accent');
  if (failureReason.includes('timeout') || failureReason.includes('blocked')) addSignal('Blocked / timeout', 'warning');
  if (failureReason.includes('ambiguous')) addSignal('Ambiguous', 'warning');
  if (failureReason.includes('unable to verify') || failureReason.includes('probe')) addSignal('Probe failed', 'warning');
  if ((item.primaryConfigId || item.configCount || 0) === 0) addSignal('No ATS config', 'neutral');

  return signals;
}

function renderEnrichmentSignalPills(item, options = {}) {
  const signals = getEnrichmentReasonSignals(item);
  if (!signals.length) return '';
  const cls = options.compact ? 'inline-badge-row inline-badge-row--compact' : 'inline-badge-row';
  return `<div class="${cls}">${signals.map((signal) => renderStatusPill(signal.label, signal.tone)).join('')}</div>`;
}

function renderIdentityResolutionCard(detail) {
  const account = detail.account || {};
  const primaryConfig = (detail.configs || [])[0] || null;
  const summarySignals = [
    renderStatusPill(account.enrichmentStatus || 'missing_inputs', toneForEnrichmentStatus(account.enrichmentStatus || 'missing_inputs')),
    renderStatusPill(account.enrichmentConfidence || 'unresolved', toneForEnrichmentConfidence(account.enrichmentConfidence || 'unresolved')),
    primaryConfig ? renderStatusPill(primaryConfig.discoveryStatus || 'unknown', 'neutral') : '',
  ].filter(Boolean).join('');

  const evidenceText = account.enrichmentEvidence || account.enrichmentNotes || account.enrichmentFailureReason || 'No enrichment evidence stored yet.';
  return `
    <div class="detail-card">
      <div class="panel-header">
        <div><h3>Identity resolution</h3><p class="muted small">Company identity inputs feeding ATS discovery and job import.</p></div>
      </div>
      <div class="kpi-ribbon">${summarySignals}</div>
      ${renderEnrichmentSignalPills({
        ...account,
        primaryConfigId: primaryConfig?.id || '',
        configCount: (detail.configs || []).length,
      })}
      <div class="definition-grid" style="margin-top:14px;">
        <div><span class="small muted">Canonical domain</span><strong>${escapeHtml(account.canonicalDomain || account.domain || 'Not set')}</strong></div>
        <div><span class="small muted">Careers URL</span><strong>${account.careersUrl ? `<a class="row-link" href="${escapeAttr(account.careersUrl)}" target="_blank" rel="noreferrer">${escapeHtml(account.careersUrl)}</a>` : 'Not set'}</strong></div>
        <div><span class="small muted">Source</span><strong>${escapeHtml(humanize(account.enrichmentSource || 'unknown'))}</strong></div>
        <div><span class="small muted">Last enriched</span><strong>${escapeHtml(formatDate(account.lastEnrichedAt) || 'Never')}</strong></div>
      </div>
      <div class="empty-state empty-state--compact" style="margin-top:14px;">${escapeHtml(evidenceText)}</div>
      <div class="button-row button-row--wrap" style="margin-top:14px;">
        <button class="secondary-button" data-action="account-quick-enrich" data-id="${account.id}">Quick enrich</button>
        <button class="primary-button" data-action="account-resolve-now" data-id="${account.id}">Resolve now</button>
        <button class="ghost-button" data-action="account-deep-verify" data-id="${account.id}">Deep verify</button>
        ${primaryConfig ? `<button class="ghost-button" data-action="rerun-enrichment-resolution" data-id="${account.id}">Rerun ATS</button>` : ''}
      </div>
      <p class="small muted" style="margin-top:10px;">Quick enrich only uses local signals already in the app. Resolve now uses the balanced web verifier. Deep verify spends more time probing the public web when a high-value account still looks unresolved.</p>
    </div>
  `;
}

function renderResolutionAttemptItem(attempt = {}, sourceLabel = '') {
  const ok = Boolean(attempt.ok);
  const tone = ok ? 'success' : ((attempt.statusCode || 0) >= 400 || attempt.error ? 'warning' : 'neutral');
  const label = `${sourceLabel ? `${sourceLabel} · ` : ''}${humanize(attempt.stage || 'attempt')}`;
  const statusText = ok
    ? `${attempt.statusCode || 200}${attempt.elapsedMs ? ` · ${formatNumber(attempt.elapsedMs)}ms` : ''}`
    : `${attempt.statusCode || 'No response'}${attempt.error ? ` · ${attempt.error}` : ''}`;
  const location = attempt.finalUrl || attempt.url || '';
  return `
    <article class="timeline-item">
      <div class="inline-header">
        <strong>${escapeHtml(label)}</strong>
        ${renderStatusPill(ok ? 'ok' : 'issue', tone)}
      </div>
      <p>${escapeHtml(statusText)}</p>
      ${location ? `<div class="small muted">${escapeHtml(location)}</div>` : ''}
    </article>
  `;
}

function renderResolutionHistoryCard(detail) {
  const account = detail.account || {};
  const primaryConfig = (detail.configs || [])[0] || null;
  const attemptedUrls = [
    ...(Array.isArray(account.enrichmentAttemptedUrls) ? account.enrichmentAttemptedUrls : []),
    ...(Array.isArray(primaryConfig?.attemptedUrls) ? primaryConfig.attemptedUrls : []),
  ].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index).slice(0, 8);
  const attempts = [
    ...(Array.isArray(account.enrichmentHttpSummary) ? account.enrichmentHttpSummary.slice(0, 4).map((item) => ({ ...item, sourceLabel: 'Identity' })) : []),
    ...(Array.isArray(primaryConfig?.httpSummary) ? primaryConfig.httpSummary.slice(0, 4).map((item) => ({ ...item, sourceLabel: 'ATS' })) : []),
  ].slice(0, 6);

  return `
    <div class="detail-card">
      <div class="panel-header">
        <div><h3>Resolution history</h3><p class="muted small">Recent resolver attempts, cooldown context, and the URLs we last tested.</p></div>
      </div>
      <div class="inline-badge-row inline-badge-row--compact">
        ${isFutureIsoDate(account.nextEnrichmentAttemptAt) ? renderStatusPill('Identity cooldown', 'neutral') : ''}
        ${primaryConfig?.nextResolutionAttemptAt && isFutureIsoDate(primaryConfig.nextResolutionAttemptAt) ? renderStatusPill('ATS cooldown', 'neutral') : ''}
        ${attemptedUrls.length ? renderStatusPill(`${attemptedUrls.length} URLs tested`, 'accent') : renderStatusPill('No recent attempts', 'neutral')}
      </div>
      ${attemptedUrls.length ? `<div class="small muted" style="margin-top:12px;">${attemptedUrls.map((url) => escapeHtml(url)).join('<br>')}</div>` : '<div class="empty-state empty-state--compact" style="margin-top:12px;">No attempted URLs stored yet.</div>'}
      <div class="timeline" style="margin-top:14px;">
        ${attempts.length ? attempts.map((attempt) => renderResolutionAttemptItem(attempt, attempt.sourceLabel)).join('') : '<div class="empty-state empty-state--compact">No HTTP attempt history stored yet.</div>'}
      </div>
    </div>
  `;
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

function renderResolutionQueueItem(item) {
  return `
    <article class="timeline-item">
      <div class="inline-header">
        <strong>${escapeHtml(item.displayName)}</strong>
        ${renderStatusPill(item.enrichmentConfidence || 'unresolved', toneForEnrichmentConfidence(item.enrichmentConfidence || 'unresolved'))}
      </div>
      ${renderEnrichmentSignalPills(item, { compact: true })}
      <p>${escapeHtml(item.reviewReason || item.recommendedAction || 'Strengthen company identity signals before deeper ATS discovery.')}</p>
      <div class="small muted">${escapeHtml(item.canonicalDomain || item.domain || 'No canonical domain')}${item.careersUrl ? ` · ${escapeHtml(item.careersUrl)}` : ''}</div>
      <div class="button-row button-row--wrap">
        <button class="ghost-button" data-action="open-account" data-id="${item.id}">Open</button>
        <button class="ghost-button" data-action="account-quick-enrich" data-id="${item.id}">Quick enrich</button>
        <button class="secondary-button" data-action="account-resolve-now" data-id="${item.id}">Resolve now</button>
        <button class="ghost-button" data-action="account-deep-verify" data-id="${item.id}">Deep verify</button>
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

function getRuntimeJobs(runtime) {
  const seen = new Set();
  return [...(runtime?.activeJobs || []), ...(runtime?.recentJobs || [])].filter((job) => {
    if (!job || !job.id || seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

function getRuntimeJobDuration(job) {
  if (!job) return '';
  const started = Date.parse(job.startedAt || job.queuedAt || '');
  if (!Number.isFinite(started)) return '';
  const finished = Date.parse(job.finishedAt || '');
  const end = Number.isFinite(finished) ? finished : Date.now();
  const ms = Math.max(0, end - started);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest}m`;
}

function getJobPhaseLabel(job) {
  const message = job?.progressMessage || '';
  if (!message || message === 'Completed') return humanize(job?.status || 'idle');
  return message.split(' - ')[0] || message;
}

function renderIngestionHealthPanel(runtime) {
  const jobs = getRuntimeJobs(runtime);
  const liveImports = jobs.filter((job) => job.type === 'live-job-import');
  const activeImport = liveImports.find((job) => ['queued', 'running'].includes(job.status));
  const lastImport = liveImports.find((job) => job.status === 'completed') || liveImports[0];
  const lastFailed = liveImports.find((job) => ['failed', 'cancelled'].includes(job.status));
  const progress = activeImport ? parseJobProgress(activeImport.progressMessage) : null;
  const activeLabel = activeImport
    ? (progress ? `${formatNumber(progress.current)} / ${formatNumber(progress.total)}` : humanize(activeImport.status))
    : 'Idle';
  const activeMeta = activeImport
    ? `${getJobPhaseLabel(activeImport)} · ${getRuntimeJobDuration(activeImport)} elapsed`
    : 'No live import is currently active';
  const lastDuration = lastImport && lastImport.status === 'completed' ? getRuntimeJobDuration(lastImport) : '';
  const lastRecords = lastImport?.recordsAffected ? `${formatNumber(lastImport.recordsAffected)} records` : 'No records yet';
  const lastMeta = lastImport
    ? `${lastDuration || humanize(lastImport.status)} · ${lastRecords}`
    : 'No completed imports found';
  const failureMeta = lastFailed
    ? `${humanize(lastFailed.status)} · ${formatDate(lastFailed.finishedAt || lastFailed.updatedAt || lastFailed.queuedAt)}`
    : 'No recent live import failures';

  return `
    <div class="ingestion-health">
      <div class="ingestion-health__head">
        <div>
          <p class="eyebrow">Ingestion health</p>
          <strong>${activeImport ? 'Live import in progress' : 'Live import ready'}</strong>
        </div>
        ${activeImport ? renderStatusPill(activeImport.status || 'running', activeImport.status === 'running' ? 'warm' : 'neutral') : renderStatusPill('Ready', 'success')}
      </div>
      <div class="ingestion-health__grid">
        <div class="ingestion-health__metric">
          <span class="small muted">Active import</span>
          <strong>${escapeHtml(activeLabel)}</strong>
          <span class="small muted">${escapeHtml(activeMeta)}</span>
        </div>
        <div class="ingestion-health__metric">
          <span class="small muted">Last import</span>
          <strong>${escapeHtml(lastDuration || humanize(lastImport?.status || 'none'))}</strong>
          <span class="small muted">${escapeHtml(lastMeta)}</span>
        </div>
        <div class="ingestion-health__metric">
          <span class="small muted">Queue load</span>
          <strong>${formatNumber((runtime?.runningJobs || 0) + (runtime?.queuedJobs || 0))}</strong>
          <span class="small muted">${formatNumber(runtime?.runningJobs || 0)} running · ${formatNumber(runtime?.queuedJobs || 0)} queued</span>
        </div>
        <div class="ingestion-health__metric">
          <span class="small muted">Recent failures</span>
          <strong>${lastFailed ? 'Review' : 'Clear'}</strong>
          <span class="small muted">${escapeHtml(failureMeta)}</span>
        </div>
      </div>
      ${progress ? `<div class="spark-bar job-progress-bar ingestion-health__bar"><span style="width:${progress.pct}%"></span></div>` : ''}
    </div>
  `;
}

function renderBackgroundJobItem(job) {
  const tone = job.status === 'completed'
    ? 'success'
    : (job.status === 'failed' ? 'danger' : 'neutral');

  const progress = job.status === 'running' ? parseJobProgress(job.progressMessage) : null;
  const hasRecordsAffected = job.recordsAffected !== undefined && job.recordsAffected !== null && job.recordsAffected !== '';

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
        <span class="small muted">${job.startedAt ? `Started ${formatDate(job.startedAt)}` : `Queued ${formatDate(job.queuedAt)}`}${hasRecordsAffected ? ` · ${formatNumber(job.recordsAffected)} records` : ''}</span>
        ${job.status === 'queued' ? `<button class="ghost-button" data-action="cancel-background-job" data-id="${job.id}">Cancel</button>` : ''}
      </div>
      ${job.errorMessage ? `<p class="small muted">${escapeHtml(job.errorMessage)}</p>` : ''}
    </article>
  `;
}

function formatConnectionsImportStats(stats = {}) {
  return `${formatNumber(stats.imported || 0)} imported, ${formatNumber(stats.updated || 0)} updated, ${formatNumber(stats.skipped || 0)} skipped, ${formatNumber(stats.failed || 0)} failed`;
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

let fieldIdCounter = 0;
function renderField(label, control) {
  const id = `field-${++fieldIdCounter}`;
  const controlWithId = control.replace(/<(input|select|textarea)(\s)/, `<$1 id="${id}"$2`);
  return `<div class="field"><label for="${id}">${escapeHtml(label)}</label>${controlWithId}</div>`;
}

function renderStatusPill(value, tone) {
  return `<span class="status-pill ${tone}" role="status" aria-label="${escapeAttr(humanize(value))}">${escapeHtml(humanize(value))}</span>`;
}

function renderInlineBadge(value) {
  return `<span>${escapeHtml(humanize(value))}</span>`;
}

function renderPagination(view, page, pageSize, total) {
  if (!total || total <= pageSize) return '';
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const firstRecord = ((page - 1) * pageSize) + 1;
  const lastRecord = Math.min(total, page * pageSize);
  return `<nav class="pagination" aria-label="Page navigation"><span class="small muted">Showing ${formatNumber(firstRecord)}-${formatNumber(lastRecord)} of ${formatNumber(total)} records · Page ${page} of ${lastPage}</span><div class="pagination-controls"><button class="ghost-button" data-action="paginate" data-view="${view}" data-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">Previous</button><button class="ghost-button" data-action="paginate" data-view="${view}" data-page="${Math.min(lastPage, page + 1)}" ${page >= lastPage ? 'disabled' : ''} aria-label="Next page">Next</button></div></nav>`;
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
  await withButtonState('[data-action="reseed-workbook"]', 'Importing workbook...', async () => {
    const accepted = await api('/api/import/workbook', { method: 'POST', body: JSON.stringify({ workbookPath: path || appState.bootstrap.defaults.workbookPath }) });
    showToast('Workbook import queued.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Workbook import' });
    const stats = job?.result?.stats || job?.result?.importRun?.stats || {};
    window.bdLocalApi.setAlert(`Workbook import finished: ${formatNumber(stats.companies || 0)} companies, ${formatNumber(stats.contacts || 0)} contacts, ${formatNumber(stats.jobs || 0)} jobs.`, appAlert);
  });
}

async function runLiveImport(buttonEl) {
  await withButtonState(buttonEl || '[data-action="run-live-import"]', 'Running import...', async () => {
    const accepted = await api('/api/import/jobs', { method: 'POST', body: JSON.stringify({}) });
    showToast('Live ATS import queued.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Live ATS import' });
    const run = job?.result?.importRun || {};
    const stats = run?.stats || {};
    const status = run?.status === 'completed_with_errors'
      ? `Fetched ${formatNumber(stats.fetched || 0)} jobs across ${formatNumber(stats.configs || 0)} ATS configs; kept ${formatNumber(stats.canadaKept || 0)} Canada jobs, filtered ${formatNumber(stats.filteredOutNonCanada || 0)} non-Canada, and ended with ${formatNumber(stats.imported || 0)} active tracked jobs. ${formatNumber(stats.errors || 0)} configs errored.`
      : `Fetched ${formatNumber(stats.fetched || 0)} jobs across ${formatNumber(stats.configs || 0)} ATS configs; kept ${formatNumber(stats.canadaKept || 0)} Canada jobs, filtered ${formatNumber(stats.filteredOutNonCanada || 0)} non-Canada, and ended with ${formatNumber(stats.imported || 0)} active tracked jobs.`;
    window.bdLocalApi.setAlert(status, appAlert);
  });
}

async function runDiscovery(buttonEl) {
  await withButtonState(buttonEl || '[data-action="run-discovery"]', 'Discovering...', async () => {
    const limit = Number(document.getElementById('discovery-limit')?.value || 75);
    const onlyMissing = (document.getElementById('discovery-only-missing')?.value || 'true') === 'true';
    const forceRefresh = (document.getElementById('discovery-force-refresh')?.value || 'false') === 'true';
    const accepted = await api('/api/discovery/run', {
      method: 'POST',
      body: JSON.stringify({ limit, onlyMissing, forceRefresh }),
    });
    showToast('ATS discovery queued.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'ATS discovery' });
    const stats = job?.result?.stats || {};
    window.bdLocalApi.setAlert(
      `Discovery checked ${formatNumber(stats.checked || 0)} configs. Mapped ${formatNumber(stats.mapped || 0)}, discovered ${formatNumber(stats.discovered || 0)}, high confidence ${formatNumber(stats.highConfidence || 0)}, unresolved ${formatNumber(stats.unresolved || 0)}.`,
      appAlert
    );
  });
}

async function runLocalEnrichment() {
  const button = document.querySelector('[data-action="run-local-enrichment"]');
  if (button) { button.disabled = true; button.textContent = 'Queueing...'; }
  try {
    const limit = Number(document.getElementById('enrichment-limit')?.value || 5000);
    const forceRefresh = (document.getElementById('enrichment-force-refresh')?.value || 'false') === 'true';
    const accepted = await api('/api/enrichment/run-local', {
      method: 'POST',
      body: JSON.stringify({ limit, forceRefresh }),
    });
    showToast('Fast local enrich queued.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Fast local enrichment' });
    const result = job?.result || {};
    const stats = result?.stats || {};
    const timings = result?.timings || {};
    const totalDuration = Number(timings.localMs || 0) + Number(timings.snapshotMs || 0);
    window.bdLocalApi.setAlert(
      `Fast local enrich updated ${formatNumber(stats.totalUpdated || 0)} rows in ${formatNumber(totalDuration)}ms. Domains from contacts: ${formatNumber(stats.contactEmailDomainApplied || 0)}, config domains: ${formatNumber(stats.boardConfigDomainApplied || 0)}, careers URLs: ${formatNumber(stats.boardConfigCareersApplied || 0)}, sibling lifts: ${formatNumber(stats.siblingPropagationApplied || 0)}, config lifts: ${formatNumber(stats.boardConfigSiblingApplied || 0)}.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Fast local enrich'; }
  }
}

async function runEnrichment() {
  const button = document.querySelector('[data-action="run-enrichment"]');
  if (button) { button.disabled = true; button.textContent = 'Queueing...'; }
  try {
    const limit = Number(document.getElementById('enrichment-limit')?.value || 50);
    const forceRefresh = (document.getElementById('enrichment-force-refresh')?.value || 'false') === 'true';
    const accepted = await api('/api/enrichment/run', {
      method: 'POST',
      body: JSON.stringify({ limit, forceRefresh }),
    });
    showToast('Deep verification queued.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Deep verification' });
    const stats = job?.result?.stats || {};
    const timings = job?.result?.timings || {};
    window.bdLocalApi.setAlert(
      `Deep verification checked ${formatNumber(stats.checked || 0)} companies. Verified ${formatNumber(stats.verified || 0)}, enriched ${formatNumber(stats.enriched || 0)}, unresolved ${formatNumber(stats.unresolved || 0)}. Probe work took ${formatNumber(timings.enrichmentMs || 0)}ms.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Deep verify'; }
  }
}

async function runTargetScoreRollout(buttonEl) {
  const button = buttonEl || document.querySelector('[data-action="run-target-score-rollout"]');
  if (button) { button.disabled = true; button.textContent = 'Queueing rollout...'; }
  try {
    const limit = Number(document.getElementById('target-score-rollout-limit')?.value || appState.targetScoreRollout?.defaultLimit || 150);
    const maxBatches = Number(document.getElementById('target-score-rollout-batches')?.value || appState.targetScoreRollout?.defaultMaxBatches || 6);
    const accepted = await api('/api/admin/target-score-rollout', {
      method: 'POST',
      body: JSON.stringify({ limit, maxBatches }),
    });
    showToast('Target-score rollout queued.', 'success');
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
  await withButtonState('[data-action="sync-configs"]', 'Rebuilding...', async () => {
    const accepted = await api('/api/configs/sync', { method: 'POST', body: JSON.stringify({}) });
    resetConfigForm();
    showToast('Config rebuild queued.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Config rebuild' });
    window.bdLocalApi.setAlert(`Rebuilt ${formatNumber(job?.result?.count || 0)} job board config rows.`, appAlert);
  });
}

async function rerunEnrichmentResolution(accountId, options = {}) {
  const accepted = await api(`/api/enrichment/${accountId}/rerun-resolution`, {
    method: 'POST',
    body: JSON.stringify({ deepVerify: Boolean(options.deepVerify) }),
  });
  window.bdLocalApi.setAlert(options.deepVerify ? 'Deep ATS resolution queued for this company.' : 'ATS resolution queued for this company.', appAlert);
  hydrateAdminRuntimePanels(await loadRuntimeStatus(true));
  void watchBackgroundJob(accepted.jobId, { label: options.deepVerify ? 'Deep ATS resolution' : 'ATS resolution', refreshRoute: false }).catch((err) => { window.bdLocalApi.setAlert(`ATS resolution failed: ${err.message || err}`, appAlert); });
}

async function quickEnrichAccount(accountId) {
  const button = document.querySelector(`[data-action="account-quick-enrich"][data-id="${accountId}"]`);
  if (button) { button.disabled = true; button.textContent = 'Refreshing...'; }
  try {
    const result = await api(`/api/accounts/${accountId}/quick-enrich`, {
      method: 'POST',
      body: JSON.stringify({ forceRefresh: false }),
    });
    invalidateAppData();
    await renderRoute();
    const stats = result?.stats || {};
    window.bdLocalApi.setAlert(
      `Quick enrich refreshed ${formatNumber(stats.totalUpdated || 0)} local signals in ${formatNumber(result.durationMs || 0)}ms.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Quick enrich'; }
  }
}

async function resolveAccountNow(accountId) {
  const button = document.querySelector(`[data-action="account-resolve-now"][data-id="${accountId}"]`);
  if (button) { button.disabled = true; button.textContent = 'Queueing...'; }
  try {
    const accepted = await api(`/api/accounts/${accountId}/resolve-now`, {
      method: 'POST',
      body: JSON.stringify({ forceRefresh: true }),
    });
    showToast('Balanced verification queued for this account.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Balanced verification' });
    let resolutionQueued = false;
    if (accepted.canRerunResolution) {
      resolutionQueued = true;
      const resolution = await api(`/api/enrichment/${accountId}/rerun-resolution`, {
        method: 'POST',
        body: JSON.stringify({ deepVerify: false }),
      });
      showToast('Balanced verification finished. ATS resolution queued next.', 'success');
      await watchBackgroundJob(resolution.jobId, { label: 'ATS resolution' });
    }
    const timings = job?.result?.timings || {};
    window.bdLocalApi.setAlert(
      resolutionQueued
        ? `Resolve now finished. Balanced verification used ${formatNumber(timings.enrichmentMs || 0)}ms of probe time, then reran ATS resolution.`
        : `Resolve now finished. Balanced verification used ${formatNumber(timings.enrichmentMs || 0)}ms of probe time.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Resolve now'; }
  }
}

async function deepVerifyAccount(accountId) {
  const button = document.querySelector(`[data-action="account-deep-verify"][data-id="${accountId}"]`);
  if (button) { button.disabled = true; button.textContent = 'Queueing...'; }
  try {
    const accepted = await api(`/api/accounts/${accountId}/deep-verify`, {
      method: 'POST',
      body: JSON.stringify({ forceRefresh: true }),
    });
    showToast('Deep verification queued for this account.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Deep verification' });
    let resolutionQueued = false;
    if (accepted.canRerunResolution) {
      resolutionQueued = true;
      const resolution = await api(`/api/enrichment/${accountId}/rerun-resolution`, {
        method: 'POST',
        body: JSON.stringify({ deepVerify: true }),
      });
      showToast('Deep verification finished. ATS resolution queued next.', 'success');
      await watchBackgroundJob(resolution.jobId, { label: 'Deep ATS resolution' });
    }
    const timings = job?.result?.timings || {};
    window.bdLocalApi.setAlert(
      resolutionQueued
        ? `Deep verify finished. Extended verification used ${formatNumber(timings.enrichmentMs || 0)}ms of probe time, then reran ATS resolution.`
        : `Deep verify finished. Extended verification used ${formatNumber(timings.enrichmentMs || 0)}ms of probe time.`,
      appAlert
    );
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Deep verify'; }
  }
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
    showToast('Google Sheet sync queued.', 'success');
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
    if (!spreadsheetId) {
      const message = 'Run Full Engine is the legacy Google Sheets pipeline. Enter a Spreadsheet ID in the Google Sheets card before running it.';
      showToast(message, 'warning', 8000);
      window.bdLocalApi.setAlert(message, appAlert);
      document.getElementById('google-sheet-id')?.focus();
      return;
    }
    const connectionsCsvPath = getConnectionsCsvPath();
    const accepted = await api('/api/google-sheets/run-engine', {
      method: 'POST',
      body: JSON.stringify({
        spreadsheetId,
        connectionsCsvPath,
        skipJobImport: false,
      }),
    });
    showToast('Full BD engine run queued.', 'success');
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
  if (button) { button.disabled = true; button.textContent = dryRun ? 'Dry running...' : 'Queueing...'; }

  try {
    const fileInput = document.getElementById('connections-csv-file');
    const file = fileInput?.files?.[0];

    if (!file) {
      showToast('Choose your LinkedIn Connections.csv file first.', 'warning');
      return;
    }

    const csvContent = await readTextFile(file);
    const requestPayload = { csvContent, fileName: file.name, dryRun, useEmptyState: dryRun };
    const uploadSummary = formatCsvUploadSummary(file, csvContent);

    const run = await api('/api/import/linkedin-csv', {
      method: 'POST',
      body: JSON.stringify(requestPayload),
    });
    if (!dryRun) {
      const queuedMessage = `Connections import queued (${uploadSummary}). Large exports can take several minutes; keep this tab open to watch progress.`;
      showToast(queuedMessage, 'success', 9000);
      window.bdLocalApi.setAlert(queuedMessage, appAlert);
      const job = await watchBackgroundJob(run.jobId, { label: 'Connections import' });
      const stats = job?.result?.stats || job?.result?.importRun?.stats || {};
      const message = `Connections import complete: ${formatConnectionsImportStats(stats)}. Contacts now ${formatNumber(stats.contacts || 0)} across ${formatNumber(stats.companies || 0)} companies.`;
      window.bdLocalApi.setAlert(message, appAlert);
      return;
    }
    const stats = run?.stats || {};
    const message = `Dry run succeeded (${uploadSummary}): ${formatConnectionsImportStats(stats)}. Contacts would total ${formatNumber(stats.contacts || 0)} across ${formatNumber(stats.companies || 0)} companies.`;
    window.bdLocalApi.setAlert(message, appAlert);
  } catch (error) {
    const message = `Connections import failed: ${error.message || error}`;
    showToast(message, 'error', 9000);
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
  showToast('Config resolution queued.', 'success');
  await watchBackgroundJob(accepted.jobId, { label: 'Config resolution' });
  showToast('Config resolution finished.', 'success');
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
  showToast('Queued background job cancelled.', 'info');
}

document.addEventListener('change', (event) => {
  if (event.target.id === 'setup-csv-file') {
    void handleSetupCsvFile(event.target.files?.[0]);
    return;
  }
  if (event.target.id === 'bulk-select-all') {
    const checked = event.target.checked;
    document.querySelectorAll('.bulk-checkbox').forEach(cb => { cb.checked = checked; });
    updateBulkBar();
    return;
  }
  if (event.target.id === 'outreach-template-select' || event.target.id === 'outreach-contact-select') {
    clearGeneratedOutreachDraft('Generate a fresh note for the selected contact and angle.');
    syncOutreachComposerState();
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
    selectOutreachContact({ contactId: contactRow.dataset.contactId || '', contactName: name });
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
  const owner = document.getElementById('bulk-owner')?.value || '';
  const tagsRaw = document.getElementById('bulk-tags')?.value || '';
  const patch = {};
  if (status) patch.status = status;
  if (priority) patch.priority = priority;
  if (owner) patch.owner = owner;
  if (tagsRaw.trim()) patch.addTags = splitTags(tagsRaw);
  if (!Object.keys(patch).length) {
    showToast('Select a status, priority, owner, or tags to apply.', 'warning');
    return;
  }
  await api('/api/accounts/bulk', {
    method: 'PATCH',
    body: JSON.stringify({ ids, ...patch }),
  });
  invalidateAppData();
  await renderAccountsView();
  showToast('Updated ' + ids.length + ' accounts.', 'success');
}

async function generateSmartOutreachLegacy(accountId, buttonEl) {
  if (!accountId) return;
  const origText = buttonEl.textContent;
  buttonEl.textContent = 'Generating...';
  buttonEl.disabled = true;

  try {
    // Get selected contact from dropdown
    const contactSelect = document.getElementById('outreach-contact-select');
    const selectedOption = contactSelect?.selectedOptions?.[0];
    const contactName = selectedOption?.dataset?.name || selectedOption?.value || '';
    const contactTitle = selectedOption?.dataset?.title || '';

    const result = await api(`/api/accounts/${accountId}/generate-outreach`, {
      method: 'POST',
      body: JSON.stringify({ bookingLink: 'https://tinyurl.com/ysdep7cn', contactName, contactTitle, template: document.getElementById('outreach-template-select')?.value || 'cold' }),
    });

    const subjectLine = result.subject_line || result.subjectLine || `Hiring signal at ${appState.accountDetail?.account?.displayName || 'this company'}`;
    const messageBody = result.message_body || result.messageBody || result.outreach || '';
    const linkedinMsg = result.linkedin_message || result.linkedinMessage || '';
    appState.generatedOutreach = normalizeGeneratedOutreachItem({ ...result, subject_line: subjectLine, message_body: messageBody, linkedin_message: linkedinMsg });

    // Update the outreach prompt card with the generated message
    const body = document.getElementById('outreach-prompt-body');
    if (body && messageBody) {
      body.className = 'outreach-generated';
      if (subjectLine) {
        const gmailSubjectStructured = encodeURIComponent(subjectLine);
        const gmailBodyStructured = encodeURIComponent(messageBody);
        body.innerHTML = `
          <div style="display: grid; gap: 16px;">
            <div style="border: 1px solid var(--line); border-radius: var(--radius-md); padding: 16px; background: var(--surface-muted);">
              <strong>Email Message</strong>
              <div style="margin-top: 10px; font-family: monospace; white-space: pre-wrap; font-size: 0.85rem; color: var(--text-muted);">
                Subject: ${escapeHtml(subjectLine)}<br><br>${escapeHtml(messageBody)}
              </div>
              <div class="button-row" style="margin-top:12px;">
                <button class="secondary-button" data-action="copy-generated-outreach" data-kind="email" type="button">Copy Email</button>
                <a class="primary-button" href="mailto:?subject=${gmailSubjectStructured}&body=${gmailBodyStructured}" target="_blank" rel="noreferrer">Open in Default Mail</a>
                <a class="secondary-button" href="https://mail.google.com/mail/?view=cm&su=${gmailSubjectStructured}&body=${gmailBodyStructured}" target="_blank" rel="noreferrer">Draft in Gmail</a>
              </div>
            </div>
            
            <div style="border: 1px solid var(--line); border-radius: var(--radius-md); padding: 16px; background: var(--surface-muted);">
              <strong>LinkedIn DM</strong>
              <div style="margin-top: 10px; font-family: monospace; white-space: pre-wrap; font-size: 0.85rem; color: var(--text-muted);">
                ${escapeHtml(linkedinMsg)}
              </div>
              <div class="button-row" style="margin-top:12px;">
                <button class="primary-button" data-action="open-generated-linkedin" type="button">Copy & Open LinkedIn</button>
              </div>
            </div>
          </div>
        `;
      }
      const gmailSubject = encodeURIComponent('Quick intro — ' + (appState.accountDetail?.account?.displayName || ''));
      // Scroll the outreach card into view
      const card = document.getElementById('outreach-prompt-card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    showToast('Outreach message generated!', 'success');
  } catch (err) {
    showToast('Failed to generate outreach: ' + (err.message || err), 'error');
  } finally {
    buttonEl.textContent = origText;
    buttonEl.disabled = false;
  }
}

function getOutreachTemplateMeta(template) {
  switch ((template || 'cold').toLowerCase()) {
    case 'talent_partner':
      return { label: 'Talent / recruiter note', buttonLabel: 'Generate recruiter note' };
    case 'hiring_manager':
      return { label: 'Hiring manager note', buttonLabel: 'Generate hiring-manager note' };
    case 'executive':
      return { label: 'Executive note', buttonLabel: 'Generate executive note' };
    case 'warm_intro':
      return { label: 'Warm intro note', buttonLabel: 'Generate warm intro' };
    case 'follow_up':
      return { label: 'Follow-up note', buttonLabel: 'Generate follow-up' };
    case 're_engage':
      return { label: 'Re-engagement note', buttonLabel: 'Generate re-engagement note' };
    default:
      return { label: 'Hiring signal note', buttonLabel: 'Generate tailored note' };
  }
}

function getSuggestedOutreachTemplate(detail) {
  const account = detail?.account || {};
  const contact = detail?.contacts?.[0] || {};
  const title = String(contact.title || account.topContactTitle || '').toLowerCase();
  const outreachStatus = String(account.outreachStatus || '').toLowerCase();
  const daysSinceContact = Number(account.daysSinceContact || 0);

  if ((outreachStatus === 'contacted' || outreachStatus === 'ready_to_contact' || outreachStatus === 'researching') && daysSinceContact >= 10) {
    return 'follow_up';
  }
  if (outreachStatus === 'contacted' && daysSinceContact >= 21) {
    return 're_engage';
  }
  if (/\b(recruit|talent|people|staffing|sourc|hr)\b/.test(title)) {
    return 'talent_partner';
  }
  if (/\b(founder|chief|ceo|coo|cto|cfo|cio|president|svp|evp|vp)\b/.test(title)) {
    return 'executive';
  }
  if (/\b(head|director|lead|manager)\b/.test(title)) {
    return 'hiring_manager';
  }
  return 'cold';
}

function getSelectedOutreachContact() {
  const contactSelect = document.getElementById('outreach-contact-select');
  const selectedOption = contactSelect?.selectedOptions?.[0];
  if (!selectedOption) {
    return { id: '', name: '', title: '', email: '', linkedinUrl: '', companyName: '', notes: '' };
  }

  return {
    id: selectedOption.dataset.contactId || '',
    name: selectedOption.dataset.name || selectedOption.value || '',
    title: selectedOption.dataset.title || '',
    email: selectedOption.dataset.email || '',
    linkedinUrl: selectedOption.dataset.linkedinUrl || '',
    companyName: selectedOption.dataset.company || appState.accountDetail?.account?.displayName || '',
    notes: selectedOption.dataset.notes || '',
  };
}

function selectOutreachContact({ contactId = '', contactName = '' } = {}) {
  const contactSelect = document.getElementById('outreach-contact-select');
  if (!contactSelect) return false;

  const normalizedName = String(contactName || '').trim().toLowerCase();
  const option = Array.from(contactSelect.options).find((item) => {
    const optionId = item.dataset.contactId || '';
    const optionName = String(item.dataset.name || item.value || '').trim().toLowerCase();
    return (contactId && optionId === contactId) || (normalizedName && optionName === normalizedName);
  });
  if (!option) return false;

  const previousValue = contactSelect.value;
  contactSelect.value = option.value;
  if (previousValue !== option.value) {
    clearGeneratedOutreachDraft('Generate a fresh note for the selected contact.');
  }
  document.querySelectorAll('.contact-row-selectable').forEach((row) => {
    row.classList.toggle('selected', Boolean(
      (contactId && row.dataset.contactId === contactId) ||
      (normalizedName && String(row.dataset.contactName || '').trim().toLowerCase() === normalizedName)
    ));
  });
  syncOutreachComposerState();
  return true;
}

function clearGeneratedOutreachDraft(message = '') {
  if (!appState.generatedOutreach) return;
  appState.generatedOutreach = null;
  const body = document.getElementById('outreach-prompt-body');
  if (body) {
    body.className = 'empty-state empty-state--compact';
    body.textContent = message || 'Generate a fresh outreach draft for this contact.';
  }
}

function setOutreachModalOpen(isOpen) {
  appState.outreachModalOpen = Boolean(isOpen);
  const backdrop = document.getElementById('outreach-modal-backdrop');
  if (backdrop) {
    backdrop.classList.toggle('hidden', !appState.outreachModalOpen);
    if (appState.outreachModalOpen) {
      window.requestAnimationFrame(() => {
        backdrop.querySelector('#outreach-contact-select, button, a, input, select, textarea')?.focus();
      });
    }
  }
}

function applyPendingOutreachContact(accountId) {
  const pending = appState.pendingOutreachContact;
  if (!pending || String(pending.accountId || '') !== String(accountId || '')) return;
  selectOutreachContact({ contactId: pending.contactId, contactName: pending.contactName });
  setOutreachModalOpen(true);
  appState.pendingOutreachContact = null;
}

function openOutreachForContact({ accountId = '', contactId = '', contactName = '' } = {}) {
  if (!accountId) {
    showToast('This contact is not attached to an account yet.', 'warning');
    return;
  }

  appState.pendingOutreachContact = { accountId, contactId, contactName };
  appState.outreachModalOpen = true;
  if (appState.accountDetail?.account?.id === accountId && getRouteRoot() === 'accounts') {
    applyPendingOutreachContact(accountId);
    return;
  }
  location.hash = `#/accounts/${accountId}`;
}

function getFutureDateInput(days = 7) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function buildOutreachLogNotes(outreach, contact, followUpAt) {
  const lines = [
    `Channels: email + LinkedIn`,
    contact.email ? `Email: ${contact.email}` : '',
    contact.linkedinUrl ? `LinkedIn: ${contact.linkedinUrl}` : '',
    outreach.subjectLine ? `Subject: ${outreach.subjectLine}` : '',
    outreach.messageBody ? `Email draft:\n${outreach.messageBody}` : '',
    outreach.linkedinMessage ? `LinkedIn draft:\n${outreach.linkedinMessage}` : '',
    `Follow-up reminder: ${followUpAt}`,
  ];
  return lines.filter(Boolean).join('\n\n');
}

async function logGeneratedOutreach(buttonEl) {
  const outreach = appState.generatedOutreach;
  const detail = appState.accountDetail;
  if (!outreach || !detail?.account) {
    showToast('Generate an outreach draft first.', 'warning');
    return;
  }

  const account = detail.account;
  const contact = getSelectedOutreachContact();
  const contactLabel = contact.name || 'selected contact';
  const followUpAt = getFutureDateInput(7);
  const today = getFutureDateInput(0);
  const summary = `Sent email + LinkedIn outreach to ${contactLabel}`;
  const notes = buildOutreachLogNotes(outreach, contact, followUpAt);
  const originalText = buttonEl?.textContent || '';
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = 'Logging...';
  }

  try {
    await api('/api/activity', {
      method: 'POST',
      body: JSON.stringify({
        accountId: account.id,
        contactId: contact.id,
        normalizedCompanyName: account.normalizedName,
        type: 'outreach',
        summary,
        notes,
        pipelineStage: 'contacted',
        metadata: {
          channels: ['email', 'linkedin'],
          subjectLine: outreach.subjectLine || '',
          contactName: contact.name || '',
          contactEmail: contact.email || '',
          linkedinUrl: contact.linkedinUrl || '',
          followUpAt,
        },
      }),
    });

    const accountPatch = {
      outreachStatus: 'contacted',
      nextAction: `Follow up with ${contactLabel}`,
      nextActionAt: followUpAt,
    };
    if (!['client', 'in_conversation'].includes(String(account.status || '').toLowerCase())) {
      accountPatch.status = 'contacted';
    }
    await api(`/api/accounts/${account.id}`, {
      method: 'PATCH',
      body: JSON.stringify(accountPatch),
    });

    if (contact.id) {
      const contactNote = `Outreach sent ${today}: email + LinkedIn. Follow up ${followUpAt}.`;
      const mergedNotes = [contact.notes, contactNote].filter(Boolean).join('\n');
      await api(`/api/contacts/${contact.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ outreachStatus: 'contacted', notes: mergedNotes }),
      });
    }

    appState.outreachSequences.push({
      id: Date.now(),
      accountId: account.id,
      channel: 'follow_up',
      note: `Follow up with ${contactLabel} after email + LinkedIn outreach`,
      dueAt: new Date(`${followUpAt}T09:00:00`).toISOString(),
      done: false,
    });
    localStorage.setItem('bd_sequences', JSON.stringify(appState.outreachSequences));
    logActivity('outreach_logged', { accountId: account.id, summary });
    invalidateAppData();
    showToast(`Outreach logged. Follow-up set for ${formatDate(followUpAt)}.`, 'success', 7000);
    await renderAccountDetail(account.id);
  } catch (error) {
    showToast(`Could not log outreach: ${error.message || error}`, 'error', 7000);
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = originalText;
    }
  }
}

function syncOutreachComposerState() {
  const templateSelect = document.getElementById('outreach-template-select');
  const contactSelect = document.getElementById('outreach-contact-select');
  const button = document.getElementById('generate-outreach-button');
  const bundleButton = document.getElementById('generate-outreach-bundle-button');
  if (!button || !templateSelect) return;
  const meta = getOutreachTemplateMeta(templateSelect.value || 'cold');
  const selectedContact = contactSelect?.selectedOptions?.[0]?.dataset?.name || contactSelect?.selectedOptions?.[0]?.value || '';
  button.textContent = selectedContact ? `${meta.buttonLabel} for ${selectedContact}` : meta.buttonLabel;
  if (bundleButton) {
    bundleButton.textContent = selectedContact ? `Generate 3 angles for ${selectedContact}` : 'Generate 3 angles';
  }
}

function normalizeGeneratedOutreachItem(result, fallbackTemplateKey = '') {
  result = result || {};
  const subjectOptionsRaw = result.subject_options || result.subjectOptions || [];
  const subjectOptions = Array.isArray(subjectOptionsRaw) ? subjectOptionsRaw.filter(Boolean) : [];
  const templateKey = result.template_key || result.templateKey || fallbackTemplateKey || document.getElementById('outreach-template-select')?.value || 'cold';
  const templateMeta = getOutreachTemplateMeta(templateKey);
  const subjectLine = result.subject_line || result.subjectLine || subjectOptions[0] || `Hiring signal at ${appState.accountDetail?.account?.displayName || 'this company'}`;
  return {
    templateKey,
    subjectLine,
    subjectOptions,
    messageBody: result.message_body || result.messageBody || result.outreach || '',
    linkedinMessage: result.linkedin_message || result.linkedinMessage || '',
    followUpMessage: result.follow_up_message || result.followUpMessage || '',
    callOpener: result.call_opener || result.callOpener || '',
    whyNow: result.why_now || result.whyNow || '',
    contactHook: result.contact_hook || result.contactHook || '',
    angleSummary: result.angle_summary || result.angleSummary || '',
    templateLabel: result.template_label || result.templateLabel || templateMeta.label,
    personaLabel: result.persona_label || result.personaLabel || '',
    contactName: result.contact_name || result.contactName || '',
    contactTitle: result.contact_title || result.contactTitle || '',
    outreachStatus: result.outreach_status || result.outreachStatus || '',
    sequenceStatus: result.sequence_status || result.sequenceStatus || '',
    sequenceGuidance: result.sequence_guidance || result.sequenceGuidance || '',
    signalFocus: result.signal_focus || result.signalFocus || '',
    suggestedNextStep: result.suggested_next_step || result.suggestedNextStep || '',
    companySnippet: result.companySnippet || result.company_snippet || '',
    timings: result.timings || {},
    variants: [],
  };
}

function normalizeGeneratedOutreach(result) {
  const primary = normalizeGeneratedOutreachItem(result);
  const variantItems = Array.isArray(result.variants) ? result.variants : [];
  const variants = variantItems
    .map((item) => normalizeGeneratedOutreachItem(item, item.template_key || item.templateKey || 'cold'))
    .filter((item) => item.messageBody || item.linkedinMessage || item.followUpMessage || item.callOpener);
  return {
    ...primary,
    variants,
  };
}

function renderOutreachPiece(title, body, actionsHtml, className = '') {
  if (!body) return '';
  return `
    <article class="outreach-piece ${className}">
      <div class="outreach-piece-header"><strong>${escapeHtml(title)}</strong></div>
      <div class="outreach-piece-body">${escapeHtml(body)}</div>
      ${actionsHtml ? `<div class="button-row outreach-piece-actions">${actionsHtml}</div>` : ''}
    </article>
  `;
}

function renderGeneratedOutreachVariants(outreach) {
  if (!outreach?.variants?.length) return '';
  return `
    <section class="outreach-variant-section">
      <div class="panel-header panel-header--compact">
        <div>
          <h4>Alternate angles</h4>
          <p class="muted small">Same account, different executive, manager, and recruiting approaches.</p>
        </div>
      </div>
      <div class="outreach-piece-grid outreach-piece-grid--variants">
        ${outreach.variants.map((variant, index) => `
          <article class="outreach-piece outreach-piece--variant">
            <div class="outreach-piece-header">
              <strong>${escapeHtml(variant.templateLabel || `Angle ${index + 1}`)}</strong>
              <div class="kpi-ribbon">
                ${variant.personaLabel ? renderStatusPill(variant.personaLabel, 'warm') : ''}
                ${variant.contactName ? renderStatusPill(variant.contactName, 'success') : ''}
              </div>
            </div>
            <div class="outreach-piece-subject">Subject: ${escapeHtml(variant.subjectLine || '')}</div>
            <div class="outreach-piece-body">${escapeHtml(variant.messageBody || '')}</div>
            ${variant.contactHook ? `<p class="small muted">${escapeHtml(variant.contactHook)}</p>` : ''}
            <div class="button-row outreach-piece-actions">
              <button class="primary-button" data-action="apply-generated-outreach-variant" data-index="${index}" type="button">Use this angle</button>
              <button class="secondary-button" data-action="copy-generated-outreach-variant" data-index="${index}" data-kind="email" type="button">Copy email</button>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `;
}

function renderGeneratedOutreach(outreach) {
  const gmailSubject = encodeURIComponent(outreach.subjectLine || '');
  const gmailBody = encodeURIComponent(outreach.messageBody || '');
  const selectedContact = getSelectedOutreachContact();
  const mailToAddress = selectedContact.email ? encodeURIComponent(selectedContact.email) : '';
  const gmailTo = selectedContact.email ? `&to=${encodeURIComponent(selectedContact.email)}` : '';
  const mailtoHref = `mailto:${mailToAddress}?subject=${gmailSubject}&body=${gmailBody}`;
  const pills = [
    outreach.templateLabel ? renderStatusPill(outreach.templateLabel, 'neutral') : '',
    outreach.personaLabel ? renderStatusPill(outreach.personaLabel, 'warm') : '',
    outreach.contactName ? renderStatusPill(outreach.contactName, 'success') : '',
    outreach.outreachStatus ? renderStatusPill(outreach.outreachStatus, 'neutral') : '',
  ].filter(Boolean).join('');

  return `
    <div class="outreach-composer">
      <div class="outreach-brief">
        <div class="kpi-ribbon">${pills}</div>
        ${outreach.whyNow ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Why now</span><p>${escapeHtml(outreach.whyNow)}</p></div>` : ''}
        ${outreach.contactHook ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Best angle</span><p>${escapeHtml(outreach.contactHook)}</p></div>` : ''}
        ${outreach.angleSummary ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Approach</span><p>${escapeHtml(outreach.angleSummary)}</p></div>` : ''}
        ${outreach.sequenceGuidance ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Sequence context</span><p>${escapeHtml(outreach.sequenceGuidance)}</p></div>` : ''}
        ${outreach.companySnippet ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Company context</span><p>${escapeHtml(outreach.companySnippet)}</p></div>` : ''}
        <div class="button-row outreach-piece-actions">
          <button class="primary-button" data-action="log-generated-outreach" type="button">Log sent + follow-up</button>
          <span class="small muted">Use after sending the email draft and LinkedIn message.</span>
        </div>
      </div>
      <div class="outreach-piece-grid">
        <article class="outreach-piece outreach-piece--primary">
          <div class="outreach-piece-header">
            <strong>Primary email</strong>
            ${outreach.subjectOptions.length > 1 ? `<div class="outreach-subject-options">${outreach.subjectOptions.map((option, index) => `<button class="ghost-button micro-button" data-action="copy-outreach-subject" data-index="${index}" type="button">${escapeHtml(option)}</button>`).join('')}</div>` : ''}
          </div>
          <div class="outreach-piece-subject">Subject: ${escapeHtml(outreach.subjectLine)}</div>
          <div class="outreach-piece-body">${escapeHtml(outreach.messageBody)}</div>
          <div class="button-row outreach-piece-actions">
            <button class="secondary-button" data-action="copy-generated-outreach" data-kind="email" type="button">Copy email</button>
            <a class="primary-button" href="${mailtoHref}" target="_blank" rel="noreferrer">Open in mail</a>
            <a class="secondary-button" href="https://mail.google.com/mail/?view=cm${gmailTo}&su=${gmailSubject}&body=${gmailBody}" target="_blank" rel="noreferrer">Draft in Gmail</a>
          </div>
        </article>
        ${renderOutreachPiece('LinkedIn DM', outreach.linkedinMessage, '<button class="primary-button" data-action="open-generated-linkedin" type="button">Copy & open LinkedIn</button><button class="secondary-button" data-action="copy-generated-outreach" data-kind="linkedin" type="button">Copy DM</button>')}
        ${renderOutreachPiece('Follow-up note', outreach.followUpMessage, '<button class="secondary-button" data-action="copy-generated-outreach" data-kind="followup" type="button">Copy follow-up</button>')}
        ${renderOutreachPiece('Call opener', outreach.callOpener, '<button class="secondary-button" data-action="copy-generated-outreach" data-kind="call" type="button">Copy opener</button>')}
      </div>
      ${renderGeneratedOutreachVariants(outreach)}
    </div>
  `;
}

function getGeneratedOutreachModel(variantIndex = null) {
  const outreach = appState.generatedOutreach;
  if (variantIndex == null || Number.isNaN(Number(variantIndex))) return outreach;
  return outreach?.variants?.[Number(variantIndex)] || null;
}

function getGeneratedOutreachText(kind, variantIndex = null) {
  const outreach = getGeneratedOutreachModel(variantIndex);
  if (!outreach) return '';
  switch ((kind || '').toLowerCase()) {
    case 'linkedin':
      return outreach.linkedinMessage || '';
    case 'followup':
      return outreach.followUpMessage || '';
    case 'call':
      return outreach.callOpener || '';
    case 'subject':
      return outreach.subjectLine || '';
    case 'email':
    default:
      return `Subject: ${outreach.subjectLine || ''}\n\n${outreach.messageBody || ''}`.trim();
  }
}

async function copyGeneratedOutreach(kind, buttonEl, variantIndex = null) {
  const text = getGeneratedOutreachText(kind, variantIndex);
  if (!text) return;
  const originalText = buttonEl.textContent;
  await navigator.clipboard.writeText(text);
  buttonEl.textContent = 'Copied!';
  setTimeout(() => { buttonEl.textContent = originalText; }, 1400);
}

async function copyGeneratedSubject(index, buttonEl) {
  const outreach = appState.generatedOutreach;
  if (!outreach?.subjectOptions?.length) return;
  const text = outreach.subjectOptions[Number(index)] || '';
  if (!text) return;
  const originalText = buttonEl.textContent;
  await navigator.clipboard.writeText(text);
  buttonEl.textContent = 'Copied!';
  setTimeout(() => { buttonEl.textContent = originalText; }, 1400);
}

async function openGeneratedLinkedIn(buttonEl) {
  const outreach = appState.generatedOutreach;
  if (!outreach?.linkedinMessage) return;
  const selectedContact = getSelectedOutreachContact();
  const originalText = buttonEl.textContent;
  await navigator.clipboard.writeText(outreach.linkedinMessage);
  window.open(selectedContact.linkedinUrl || 'https://www.linkedin.com/messaging/compose', '_blank', 'noopener');
  buttonEl.textContent = 'Copied & opened';
  setTimeout(() => { buttonEl.textContent = originalText; }, 1800);
}

function applyGeneratedOutreachVariant(index, buttonEl) {
  const current = appState.generatedOutreach;
  const nextPrimary = current?.variants?.[Number(index)];
  if (!current || !nextPrimary) return;

  const { variants, ...currentPrimary } = current;
  const nextVariants = (variants || []).filter((_, itemIndex) => itemIndex !== Number(index));
  nextVariants.unshift({ ...currentPrimary, variants: [] });

  appState.generatedOutreach = {
    ...nextPrimary,
    variants: nextVariants,
  };

  const templateSelect = document.getElementById('outreach-template-select');
  if (templateSelect && nextPrimary.templateKey) {
    templateSelect.value = nextPrimary.templateKey;
  }
  syncOutreachComposerState();

  const body = document.getElementById('outreach-prompt-body');
  if (body) {
    body.className = 'outreach-generated';
    body.innerHTML = renderGeneratedOutreach(appState.generatedOutreach);
  }

  const originalText = buttonEl?.textContent || '';
  if (buttonEl) {
    buttonEl.textContent = 'Angle selected';
    setTimeout(() => { buttonEl.textContent = originalText; }, 1400);
  }
  window.bdLocalApi.setAlert(`${nextPrimary.templateLabel || 'Alternate angle'} is now the primary draft.`, appAlert);
}

async function generateSmartOutreach(accountId, buttonEl, options = {}) {
  if (!accountId) return;
  const origText = buttonEl.textContent;
  const includeVariants = Boolean(options?.includeVariants);
  buttonEl.textContent = includeVariants ? 'Generating angles...' : 'Generating...';
  buttonEl.disabled = true;

  try {
    const contactSelect = document.getElementById('outreach-contact-select');
    const selectedOption = contactSelect?.selectedOptions?.[0];
    const contactName = selectedOption?.dataset?.name || selectedOption?.value || '';
    const contactTitle = selectedOption?.dataset?.title || '';

    const result = await api(`/api/accounts/${accountId}/generate-outreach`, {
      method: 'POST',
      body: JSON.stringify({
        bookingLink: 'https://tinyurl.com/ysdep7cn',
        contactName,
        contactTitle,
        template: document.getElementById('outreach-template-select')?.value || 'cold',
        includeVariants,
      }),
    });

    const outreach = normalizeGeneratedOutreach(result);
    appState.generatedOutreach = outreach;

    const body = document.getElementById('outreach-prompt-body');
    if (body && outreach.messageBody) {
      body.className = 'outreach-generated';
      body.innerHTML = renderGeneratedOutreach(outreach);
      const card = document.getElementById('outreach-prompt-card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    window.bdLocalApi.setAlert(includeVariants
      ? `${outreach.templateLabel} plus ${outreach.variants?.length || 0} alternate angles generated.`
      : `${outreach.templateLabel} generated. Review the email, LinkedIn note, follow-up, and call opener in the outreach card.`, appAlert);
  } catch (err) {
    showToast('Failed to generate outreach: ' + (err.message || err), 'error');
  } finally {
    buttonEl.textContent = origText;
    syncOutreachComposerState();
    buttonEl.disabled = false;
  }
}

async function archiveAccount(accountId) {
  if (!accountId) return;

  await api(`/api/accounts/${accountId}`, { method: 'DELETE' });
  invalidateAppData();

  if ((location.hash || '').endsWith(`/accounts/${accountId}`)) {
    location.hash = '#/accounts';
  } else {
    await renderRoute();
  }

  showUndoToast('Account paused.', async () => {
    await api(`/api/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify({ status: 'new' }) });
    invalidateAppData();
    await renderRoute();
  });
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

function renderScoreDelta(accountId, currentScore) {
  const prev = appState.previousScores[accountId];
  if (prev === undefined || prev === currentScore) return '';
  const delta = currentScore - prev;
  if (delta > 0) return `<span class="score-delta score-delta--up" aria-label="Score increased by ${delta}">+${delta}</span>`;
  return `<span class="score-delta score-delta--down" aria-label="Score decreased by ${Math.abs(delta)}">${delta}</span>`;
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

function needsDeepResolve(item = {}) {
  const configStatus = String(item.configDiscoveryStatus || '').toLowerCase();
  const enrichmentStatus = String(item.enrichmentStatus || '').toLowerCase();
  const confidence = String(item.enrichmentConfidence || '').toLowerCase();
  const hasAts = Array.isArray(item.atsTypes) && item.atsTypes.length > 0;
  if (hasAts && confidence === 'high') return false;
  if (configStatus === 'mapped' || configStatus === 'discovered') return false;
  return ['missing_inputs', 'no_match_supported_ats', 'error', 'unresolved', 'needs_review'].includes(configStatus)
    || ['missing_inputs', 'unresolved', 'failed'].includes(enrichmentStatus)
    || confidence === 'unresolved'
    || confidence === 'low';
}

function renderAccountResolutionSummary(item = {}) {
  const atsTypes = Array.isArray(item.atsTypes) ? item.atsTypes : [];
  const reviewReason = item.reviewReason || item.enrichmentFailureReason || '';
  const discoveryStatus = item.configDiscoveryStatus || (atsTypes.length ? 'discovered' : 'missing_inputs');
  const confidence = item.enrichmentConfidence || (atsTypes.length ? 'medium' : 'unresolved');
  const hasPrimaryConfig = Boolean(item.primaryConfigId);
  const signalSource = item.canonicalDomain || item.domain || item.careersUrl || 'No domain or careers URL yet';
  const actionButtons = `
    <div class="micro-button-row">
      <button class="micro-button" data-action="account-quick-enrich" data-id="${item.id}">Quick enrich</button>
      ${needsDeepResolve(item) ? `<button class="micro-button micro-button--primary" data-action="account-resolve-now" data-id="${item.id}">Resolve now</button>` : ''}
      ${needsDeepResolve(item) ? `<button class="micro-button" data-action="account-deep-verify" data-id="${item.id}">Deep verify</button>` : ''}
      ${hasPrimaryConfig && !needsDeepResolve(item) ? `<button class="micro-button" data-action="rerun-enrichment-resolution" data-id="${item.id}">Rerun ATS</button>` : ''}
    </div>
  `;

  return `
    <div class="table-cell-stack">
      <div class="inline-badge-row inline-badge-row--compact">
        ${atsTypes.length ? atsTypes.map((type) => renderStatusPill(type, 'neutral')).join('') : renderStatusPill('no board', 'neutral')}
        ${renderStatusPill(humanize(discoveryStatus), discoveryStatus === 'mapped' || discoveryStatus === 'discovered' ? 'success' : 'neutral')}
        ${renderStatusPill(confidence, toneForEnrichmentConfidence(confidence))}
      </div>
      ${renderEnrichmentSignalPills({
        ...item,
        configCount: hasPrimaryConfig ? 1 : 0,
      }, { compact: true })}
      <div class="small muted">${escapeHtml(reviewReason || signalSource)}</div>
      ${actionButtons}
    </div>
  `;
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
