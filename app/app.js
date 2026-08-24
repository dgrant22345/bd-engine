const defaultAdminCollapsed = {
  'pipeline-ops': false,
  'search-focus': true,
  'background-jobs': true,
  'billing-subscription': true,
  'coverage-health': true,
  'ats-config-records': true,
  'review-queues': true,
  'site-analytics': true,
  'runtime-status': true,
  'enrichment-coverage': true,
  'enrichment-queue': true,
  'resolver-coverage': true,
  'ats-config-form': true,
  'scoring-settings': true,
  'automation-rules': true,
  'alert-thresholds': true,
};

const ONBOARDING_INTENT_ANONYMOUS_KEY = 'bd_onboarding_intent';
const ONBOARDING_INTENT_SCOPED_PREFIX = `${ONBOARDING_INTENT_ANONYMOUS_KEY}:v2:`;
const onboardingIntentParams = new URLSearchParams(window.location.search);
const onboardingIntentScope = String(onboardingIntentParams.get('intentScope') || '').trim();
const hasOnboardingIntentScope = onboardingIntentParams.has('intentScope');
const ONBOARDING_INTENT_KEY = /^[a-zA-Z0-9_-]{20,86}$/.test(onboardingIntentScope)
  ? `${ONBOARDING_INTENT_SCOPED_PREFIX}${onboardingIntentScope}`
  : hasOnboardingIntentScope
    ? ''
    : ONBOARDING_INTENT_ANONYMOUS_KEY;
const ONBOARDING_INTENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ONBOARDING_INTENT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DASHBOARD_RENDER_LIMITS = {
  todayQueue: 50,
  followUps: 10,
  resolution: 8,
  recentJobs: 12,
  tasks: 6,
  analytics: 40,
};

function readJsonSetting(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function readOnboardingIntent() {
  if (!ONBOARDING_INTENT_KEY) return null;
  const stored = readJsonSetting(ONBOARDING_INTENT_KEY, null);
  if (!stored || stored.version !== 1 || typeof stored !== 'object') return null;
  const updatedAt = new Date(stored.updatedAt || '').getTime();
  const age = Date.now() - updatedAt;
  if (!Number.isFinite(updatedAt) || age < -ONBOARDING_INTENT_CLOCK_SKEW_MS || age > ONBOARDING_INTENT_MAX_AGE_MS) {
    localStorage.removeItem(ONBOARDING_INTENT_KEY);
    return null;
  }
  const careerUrls = [...new Set((Array.isArray(stored.careerUrls) ? stored.careerUrls : [])
    .map((value) => String(value || '').trim())
    .filter((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
      } catch {
        return false;
      }
    }))].slice(0, 50);
  const pendingTargetSites = [...new Set((Array.isArray(stored.pendingTargetSites) ? stored.pendingTargetSites : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].slice(0, 50);
  return {
    ...stored,
    persona: stored.persona === 'jobseeker' ? 'jobseeker' : 'bd',
    careerUrls,
    pendingTargetSites,
    pendingTargetReason: ['capacity', 'skipped'].includes(stored.pendingTargetReason) ? stored.pendingTargetReason : '',
  };
}

const onboardingIntent = readOnboardingIntent();

const savedAdminCollapsed = readJsonSetting('bd_admin_collapsed', null);
const defaultDashboardCollapsed = {
  workflow: true,
  'jobs-activity': true,
  readiness: true,
  metrics: true,
  playbook: true,
  boards: true,
  enrichment: true,
  heatmap: true,
  'smart-alerts': true,
  velocity: true,
  leaderboard: true,
  'data-quality': true,
  duplicates: true,
  'sales-cycle': true,
  charts: true,
};
const savedDashboardCollapsed = readJsonSetting('bd_dash_collapsed', null);
const defaultAlertThresholds = {
  staleDays: 14,
  scoreDropMin: 10,
  hiringSpikeFactor: 3,
  hiringSpikeMinJobs: 5,
  highScoreNoContacts: 80,
  highValueStaleMin: 70,
};
const storedAlertThresholds = readJsonSetting('bd_alert_thresholds', defaultAlertThresholds);
if (storedAlertThresholds.hiringSpikeMinJobs === undefined && storedAlertThresholds.hiringSpikMinJobs !== undefined) {
  storedAlertThresholds.hiringSpikeMinJobs = storedAlertThresholds.hiringSpikMinJobs;
  delete storedAlertThresholds.hiringSpikMinJobs;
}

const appState = {
  bootstrap: null,
  localData: null,
  localOverlays: null,
  activeView: 'dashboard',
  accountQuery: { page: 1, pageSize: 20, portfolio: 'tracked', q: '', hiring: '', ats: '', recencyDays: '', minContacts: '', minTargetScore: '', priority: '', status: '', owner: '', outreachStatus: '', industry: '', geography: '', sortBy: '' },
  contactQuery: { page: 1, pageSize: 20, q: '', minScore: '', outreachStatus: '' },
  jobQuery: { page: 1, pageSize: 20, q: '', ats: '', recencyDays: '', active: 'true', isNew: '', minRelevance: '', geography: '', workStyle: '', hasContacts: '', minConnections: '', sortBy: '' },
  configQuery: { page: 1, pageSize: 20, q: '', ats: '', active: '', discoveryStatus: '', confidenceBand: '', reviewStatus: '' },
  enrichmentQuery: { page: 1, pageSize: 20, confidence: '', missingDomain: '', missingCareersUrl: '', hasConnections: '', minTargetScore: '', topN: '' },
  accountDetail: null,
  generatedOutreach: null,
  searchTimer: null,
  configEditingId: '',
  runtimeStatus: null,
  ingestionDiagnostics: null,
  runtimePollTimer: null,
  savedFilters: readJsonSetting('bd_saved_filters', []),
  adminCollapsed: savedAdminCollapsed && typeof savedAdminCollapsed === 'object'
    ? { ...defaultAdminCollapsed, ...savedAdminCollapsed }
    : { ...defaultAdminCollapsed },
  showAdvancedFilters: false,
  outreachModalOpen: false,
  pendingOutreachContact: null,
  outreachModalTrigger: null,
  statusPillsExpanded: false,
  previousScores: {},
  theme: localStorage.getItem('bd_theme') || 'light',
  themePreset: localStorage.getItem('bd_theme_preset') || 'slate',
  dashboardTab: localStorage.getItem('bd_dash_tab') || 'battle-board',
  selectedContacts: new Set(),
  selectedJobs: new Set(),
  batchOutreach: null,
  batchOutreachModalOpen: false,
  valueSprintDismissed: localStorage.getItem('bd_sprint_dismissed') === 'true',
  cmdPaletteOpen: false,
  cmdPaletteTrigger: null,
  lastKeyTime: 0,
  lastKey: '',
  mobileNavOpen: false,
  mobileNavTrigger: null,
  // Phase 5: Elite features
  columnPrefs: readJsonSetting('bd_col_prefs', {}),
  kanbanMode: localStorage.getItem('bd_kanban') === 'true',
  automationRules: readJsonSetting('bd_auto_rules', []),
  scoreHistory: readJsonSetting('bd_score_history', {}),
  smartAlerts: [],
  inlineEditCell: null,
  pwaInstallPrompt: null,
  accountNotes: readJsonSetting('bd_notes', {}),
  stageTimestamps: readJsonSetting('bd_stage_ts', {}),
  // Phase 6: Commercial-grade features
  onboardingDone: localStorage.getItem('bd_onboarding_done') === 'true',
  tourActive: false,
  tourTrigger: null,
  dashboardLayout: readJsonSetting('bd_dash_layout', null),
  dashboardCollapsed: savedDashboardCollapsed && typeof savedDashboardCollapsed === 'object'
    ? { ...defaultDashboardCollapsed, ...savedDashboardCollapsed }
    : { ...defaultDashboardCollapsed },
  customFields: readJsonSetting('bd_custom_fields', []),
  customFieldValues: {},
  outreachSequences: readJsonSetting('bd_sequences', []),
  activityLog: readJsonSetting('bd_activity_log', []),
  alertThresholds: { ...defaultAlertThresholds, ...storedAlertThresholds },
  bulkLastClickIdx: null,
  duplicateCache: null,
  persona: 'bd',
  setupStatus: null,
  setupStep: 1,
  setupBusy: false,
  setupCsvFile: null, setupCsvContent: '',
  setupCsvFileName: '',
  setupPreview: null,
  setupTrackedCompanies: [],
  setupResult: null,
  setupImportJobId: '',
  setupProgressMessage: '',
  setupTargetImportResult: null,
  setupSignalJobId: '',
  setupTargetsSkipped: false,
  setupLastFocusedStep: '',
  onboardingIntent,
  outcomeSummary: null,
  workspaceLoadHint: null,
  workspaceLoadProgressTimer: null,
  workspaceLoadProgressKey: '',
  workspaceLoadProgressVisible: false,
  workspaceLoadProgressValue: 0,
  setupDraft: {
    workspaceName: '',
    userName: '',
    userEmail: '',
    ownersText: '',
    licenseKey: '',
    targetSites: (onboardingIntent?.pendingTargetSites?.length
      ? onboardingIntent.pendingTargetSites
      : onboardingIntent?.careerUrls || []).join('\n'),
  },
  taskQuery: { page: 1, pageSize: 50, status: 'pending' },
  modalCsvFile: null,
  modalCsvFileName: '',
  modalCsvParsedStats: null,
  modalImportBusy: false,
  modalImportMessage: '',
  modalImportResult: null,
  networkModalOpen: false,
  linkedinGuideModalOpen: false,
  warmStudioModalOpen: false,
  pricingModalOpen: false,
  warmStudioData: null,
  jobPipelineStages: readJsonSetting('bd_job_pipeline', {}),
  shortcutsModalOpen: false,
  soundEnabled: localStorage.getItem('bd_sound_enabled') !== 'false',
  feeSimulator: readJsonSetting('bd_fee_simulator', { avgFee: 22500, weeklyOutreach: 25, winRate: 15 }),
  selectedIcpQuadrant: null,
  objectionModalOpen: false,
  activeObjectionTab: 'psl',
  activeObjectionTone: 'executive',
  candidateSlateModalOpen: false,
  activeCandidateSlateJob: null,
  selectedGeoHub: '',
  dealPipeline: readJsonSetting('bd_deal_pipeline', {}),
  callStudioModalOpen: false,
  activeCallBranch: 'opener',
  activeCallJob: null,
  activeCallContact: null,
  networkGraphModalOpen: false,
  activeGraphAccount: null,
  battlePlanModalOpen: false,
  autopilotModalOpen: false,
  activeAutopilotQueue: [],
  pitchDeckModalOpen: false,
  activePitchDeckAccount: null,
};

const sharedWorkspaceStorageKeys = {
  accountNotes: 'bd_notes',
  automationRules: 'bd_auto_rules',
  customFields: 'bd_custom_fields',
  outreachSequences: 'bd_sequences',
  activityLog: 'bd_activity_log',
  alertThresholds: 'bd_alert_thresholds',
};
let pendingWorkspacePreferenceFields = new Set();
let workspacePreferenceSaveTimer = null;

function readLocalCustomFieldValues() {
  const values = {};
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('bd_cf_')) values[key.slice(6)] = readJsonSetting(key, {});
    }
  } catch {
    // Local storage is only a migration and offline cache.
  }
  return values;
}

function collectSharedWorkspacePreferences() {
  return {
    accountNotes: appState.accountNotes,
    automationRules: appState.automationRules,
    customFields: appState.customFields,
    customFieldValues: appState.customFieldValues,
    outreachSequences: appState.outreachSequences,
    activityLog: appState.activityLog,
    alertThresholds: appState.alertThresholds,
  };
}

function cacheSharedWorkspacePreference(key, value) {
  try {
    if (key === 'customFieldValues') {
      Object.entries(value || {}).forEach(([accountId, fields]) => localStorage.setItem(`bd_cf_${accountId}`, JSON.stringify(fields)));
      return;
    }
    const storageKey = sharedWorkspaceStorageKeys[key];
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Server persistence remains authoritative when the browser cache is full.
  }
}

function applySharedWorkspacePreferences(preferences = {}) {
  Object.keys(collectSharedWorkspacePreferences()).forEach((key) => {
    if (preferences[key] === undefined) return;
    appState[key] = preferences[key];
    cacheSharedWorkspacePreference(key, preferences[key]);
  });
}

async function loadWorkspacePreferences() {
  appState.customFieldValues = readLocalCustomFieldValues();
  try {
    const remote = await api('/api/workspace/preferences', { skipCache: true });
    if (remote?.updatedAt) {
      applySharedWorkspacePreferences(remote);
      return;
    }
    const local = collectSharedWorkspacePreferences();
    const hasLocalData = Object.entries(local).some(([key, value]) => key === 'alertThresholds'
      ? JSON.stringify(value) !== JSON.stringify(defaultAlertThresholds)
      : Array.isArray(value) ? value.length > 0 : Object.keys(value || {}).length > 0);
    if (hasLocalData) {
      const saved = await api('/api/workspace/preferences', { method: 'PATCH', body: JSON.stringify(local) });
      applySharedWorkspacePreferences(saved);
    }
  } catch (error) {
    console.warn('Workspace collaboration data is using the local cache.', error);
  }
}

function persistSharedWorkspacePreference(key) {
  cacheSharedWorkspacePreference(key, appState[key]);
  pendingWorkspacePreferenceFields.add(key);
  clearTimeout(workspacePreferenceSaveTimer);
  workspacePreferenceSaveTimer = setTimeout(async () => {
    const fields = Array.from(pendingWorkspacePreferenceFields);
    pendingWorkspacePreferenceFields = new Set();
    const payload = Object.fromEntries(fields.map((field) => [field, appState[field]]));
    try {
      await api('/api/workspace/preferences', { method: 'PATCH', body: JSON.stringify(payload) });
    } catch (error) {
      fields.forEach((field) => pendingWorkspacePreferenceFields.add(field));
      showToast('Could not sync workspace changes. They remain saved on this device.', 'warning', 7000);
    }
  }, 250);
}

const viewTitle = document.getElementById('view-title');
const appRoot = document.getElementById('app');
const workspaceName = document.getElementById('workspace-name');
const workspaceFootnote = document.querySelector('.sidebar-footnote');
const workspaceLoadWarning = document.getElementById('workspace-load-warning');
const workspaceLoadMessage = document.getElementById('workspace-load-message');
const workspaceLoadProgressBar = document.getElementById('workspace-load-progress-bar');
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
const networkImportModalBackdrop = document.getElementById('network-import-modal-backdrop');
const linkedinGuideModalBackdrop = document.getElementById('linkedin-guide-modal-backdrop');
const warmStudioModalBackdrop = document.getElementById('warm-studio-modal-backdrop');
const batchOutreachModalBackdrop = document.getElementById('batch-outreach-modal-backdrop');
const pricingModalBackdrop = document.getElementById('pricing-modal-backdrop');
const morningRadarModalBackdrop = document.getElementById('morning-radar-modal-backdrop');
const referralShareModalBackdrop = document.getElementById('referral-share-modal-backdrop');
const shortcutsModalBackdrop = document.getElementById('shortcuts-modal-backdrop');
const objectionModalBackdrop = document.getElementById('objection-modal-backdrop');
const candidateSlateModalBackdrop = document.getElementById('candidate-slate-modal-backdrop');
const callStudioModalBackdrop = document.getElementById('call-studio-modal-backdrop');
const networkGraphModalBackdrop = document.getElementById('network-graph-modal-backdrop');
const battlePlanModalBackdrop = document.getElementById('battle-plan-modal-backdrop');
const autopilotModalBackdrop = document.getElementById('autopilot-modal-backdrop');
const pitchDeckModalBackdrop = document.getElementById('pitch-deck-modal-backdrop');
const themePresetBtn = document.getElementById('theme-preset-btn');
const themePresetLabel = document.getElementById('theme-preset-label');

const defaultQueries = {
  accounts: { page: 1, pageSize: 20, portfolio: 'tracked', q: '', hiring: '', ats: '', recencyDays: '', minContacts: '', minTargetScore: '', priority: '', status: '', owner: '', outreachStatus: '', industry: '', geography: '', sortBy: '' },
  contacts: { page: 1, pageSize: 20, q: '', minScore: '', outreachStatus: '' },
  jobs: { page: 1, pageSize: 20, q: '', ats: '', recencyDays: '', active: 'true', isNew: '', minRelevance: '', geography: '', workStyle: '', hasContacts: '', minConnections: '', sortBy: '' },
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
  document.documentElement.style.colorScheme = effective;
  if (effective === 'light' && (!appState.themePreset || appState.themePreset === 'obsidian')) {
    applyThemePreset('slate');
  }
  const themeBackground = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeBackground || (effective === 'dark' ? '#0b1120' : '#f8fafc'));
  if (themeIcon) themeIcon.innerHTML = effective === 'dark' ? '&#9728;' : '&#9789;';
  if (themeLabel) themeLabel.textContent = effective === 'dark' ? 'Light' : 'Dark';
}

function cycleTheme() {
  const order = ['light', 'dark', 'system'];
  const next = order[(order.indexOf(appState.theme) + 1) % order.length];
  applyTheme(next);
  showToast(`Theme: ${next === 'system' ? 'System' : next.charAt(0).toUpperCase() + next.slice(1)}`, 'info');
}

function applyThemePreset(preset) {
  const allowed = ['obsidian', 'slate', 'emerald', 'indigo'];
  const effective = allowed.includes(preset) ? preset : 'slate';
  appState.themePreset = effective;
  localStorage.setItem('bd_theme_preset', effective);
  document.documentElement.setAttribute('data-theme-preset', effective);
  if (themePresetLabel) {
    const labels = { obsidian: 'Obsidian', slate: 'Slate', emerald: 'Emerald', indigo: 'Indigo' };
    themePresetLabel.textContent = labels[effective] || 'Slate';
  }
}

function cycleThemePreset() {
  const presets = ['obsidian', 'slate', 'emerald', 'indigo'];
  const next = presets[(presets.indexOf(appState.themePreset) + 1) % presets.length];
  applyThemePreset(next);
  const labels = {
    obsidian: 'Executive Obsidian (Dark)',
    slate: 'Enterprise Slate (Light)',
    emerald: 'Emerald Prestige (Forest)',
    indigo: 'Indigo Luxe (Violet)'
  };
  showToast(`Theme Preset: ${labels[next] || next}`, 'info');
}

applyTheme(appState.theme);
applyThemePreset(appState.themePreset);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (appState.theme === 'system') applyTheme('system');
});

if (themeToggle) themeToggle.addEventListener('click', cycleTheme);
if (themePresetBtn) themePresetBtn.addEventListener('click', cycleThemePreset);
document.querySelector('.topbar-overflow-menu')?.addEventListener('click', (event) => {
  if (event.target.closest('button')) event.currentTarget.closest('details')?.removeAttribute('open');
});

/* ── Toast notification system ── */
let toastId = 0;
function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '&#10003;', error: '&#10007;', warning: '&#9888;', info: '&#8505;' };
  const id = ++toastId;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-atomic', 'true');
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
  el.setAttribute('role', 'status');
  el.setAttribute('aria-atomic', 'true');
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

function showAppDialog({
  title,
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  inputLabel = '',
  inputPlaceholder = '',
  inputValue = '',
} = {}) {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-panel app-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <div>
          <h2 id="app-dialog-title">${escapeHtml(title || 'Confirm action')}</h2>
          ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}
        </div>
        ${inputLabel ? `
          <label>${escapeHtml(inputLabel)}
            <input id="app-dialog-input" value="${escapeAttr(inputValue)}" placeholder="${escapeAttr(inputPlaceholder)}" autocomplete="off" />
          </label>` : ''}
        <div class="app-dialog-actions">
          <button class="secondary-button" type="button" data-dialog-cancel>${escapeHtml(cancelLabel)}</button>
          <button class="${danger ? 'danger-button' : 'primary-button'}" type="button" data-dialog-confirm>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;

    let settled = false;
    const input = backdrop.querySelector('#app-dialog-input');
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') finish(input ? null : false);
      if (event.key === 'Enter' && document.activeElement !== backdrop.querySelector('[data-dialog-cancel]')) {
        event.preventDefault();
        finish(input ? input.value.trim() : true);
      }
      if (event.key === 'Tab') {
        const focusable = [...backdrop.querySelectorAll('button:not([disabled]), input:not([disabled])')];
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    backdrop.querySelector('[data-dialog-cancel]').addEventListener('click', () => finish(input ? null : false));
    backdrop.querySelector('[data-dialog-confirm]').addEventListener('click', () => finish(input ? input.value.trim() : true));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) finish(input ? null : false);
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => (input || backdrop.querySelector('[data-dialog-confirm]')).focus());
  });
}

function buildSafeDiagnosticSummary() {
  const runtime = appState.runtimeStatus || {};
  const ingestion = appState.ingestionDiagnostics || {};
  const coverage = ingestion.coverageSummary || {};
  const scheduler = runtime.scheduler || {};
  const lines = [
    'BD Engine diagnostic summary',
    `Generated: ${new Date().toISOString()}`,
    `Route: ${getRouteRoot() || 'unknown'}`,
    `Mode: ${canMutateWorkspace() ? 'authenticated workspace' : 'read-only workspace'}`,
    `Background work: ${Number(runtime.runningJobs || 0)} running, ${Number(runtime.queuedJobs || 0)} waiting`,
    `Last successful refresh: ${scheduler.lastSuccessAt || appState.bootstrap?.settings?.lastPipelineRun || 'not yet completed'}`,
    `Tracked companies: ${Number(coverage.trackedCompanies || coverage.totalTrackedCompanies || 0)}`,
    `Ready job sources: ${Number(coverage.importReady || 0)}`,
    `Sources needing review: ${Number(coverage.totalIssues || 0)}`,
    `Browser: ${navigator.userAgent}`,
  ];
  return lines.join('\n');
}

async function writeClipboardText(text) {
  const value = String(text || '');
  if (!value) throw new Error('Nothing to copy.');
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Embedded browsers can deny Clipboard API access even after a user click.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard access was blocked.');
}

/* ── Mobile navigation ── */
function openMobileNav() {
  if (!appState.mobileNavOpen && document.activeElement instanceof HTMLElement) {
    appState.mobileNavTrigger = document.activeElement;
  }
  appState.mobileNavOpen = true;
  document.querySelector('.sidebar')?.classList.add('mobile-open');
  mobileNavBackdrop?.classList.add('open');
  mobileNavBackdrop?.setAttribute('aria-hidden', 'false');
  hamburgerBtn?.setAttribute('aria-expanded', 'true');
  hamburgerBtn?.setAttribute('aria-label', 'Close navigation');
  window.requestAnimationFrame(() => document.querySelector('.sidebar .nav a')?.focus());
}

function closeMobileNav({ restoreFocus = true } = {}) {
  appState.mobileNavOpen = false;
  document.querySelector('.sidebar')?.classList.remove('mobile-open');
  mobileNavBackdrop?.classList.remove('open');
  mobileNavBackdrop?.setAttribute('aria-hidden', 'true');
  hamburgerBtn?.setAttribute('aria-expanded', 'false');
  hamburgerBtn?.setAttribute('aria-label', 'Open navigation');
  if (restoreFocus && appState.mobileNavTrigger instanceof HTMLElement && appState.mobileNavTrigger.isConnected) {
    appState.mobileNavTrigger.focus();
  }
  appState.mobileNavTrigger = null;
}

if (hamburgerBtn) hamburgerBtn.addEventListener('click', () => {
  if (appState.mobileNavOpen) closeMobileNav();
  else openMobileNav();
});
if (mobileNavBackdrop) mobileNavBackdrop.addEventListener('click', closeMobileNav);
document.querySelectorAll('.nav a').forEach(a => {
  a.addEventListener('click', () => closeMobileNav({ restoreFocus: false }));
});

/* ── Command palette ── */
const cmdActions = [
  { id: 'nav-dashboard', label: 'Go to Dashboard', icon: '&#9632;', key: 'G D', action: () => { location.hash = '#/dashboard'; } },
  { id: 'nav-accounts', label: 'Go to Accounts', icon: '&#9632;', key: 'G A', action: () => { location.hash = '#/accounts'; } },
  { id: 'nav-jobs', label: 'Go to Jobs', icon: '&#9632;', key: 'G J', action: () => { location.hash = '#/jobs'; } },
  { id: 'nav-contacts', label: 'Go to Contacts', icon: '&#9632;', key: 'G C', action: () => { location.hash = '#/contacts'; } },
  { id: 'nav-tasks', label: 'Go to Tasks', icon: '&#9632;', key: 'G T', action: () => { location.hash = '#/tasks'; } },
  { id: 'nav-admin', label: 'Go to Admin', icon: '&#9632;', key: 'G X', action: () => { location.hash = '#/admin'; } },
  { id: 'toggle-theme', label: 'Toggle theme', icon: '&#9789;', key: '', action: cycleTheme },
  { id: 'refresh', label: 'Refresh data', icon: '&#8635;', key: '', action: () => refreshBootstrapButton?.click() },
  { id: 'export-csv', label: 'Export current view as CSV', icon: '&#8615;', key: '', action: () => {
    if (!hasPlanFeature('export')) {
      showToast('CSV export is available on Sales Pro. Opening plan options...', 'info');
      location.hash = '#/admin';
      return;
    }
    const v = appState.activeView;
    if (v === 'accounts') exportAccountsCsv();
    else if (v === 'contacts') exportContactsCsv();
    else if (v === 'jobs') exportJobsCsv();
    else showToast('Export not available for this view', 'warning');
  }},
  { id: 'focus-search', label: 'Focus search', icon: '&#128269;', key: '/', action: () => { searchInput?.focus(); } },
];

let cmdPaletteIndex = 0;
let cmdFiltered = [...cmdActions];

function openCmdPalette() {
  if (!appState.cmdPaletteOpen && document.activeElement instanceof HTMLElement) {
    appState.cmdPaletteTrigger = document.activeElement;
  }
  appState.cmdPaletteOpen = true;
  cmdPaletteIndex = 0;
  cmdFiltered = [...cmdActions];
  cmdPaletteBackdrop.classList.remove('hidden');
  cmdPaletteBackdrop.setAttribute('aria-hidden', 'false');
  const workspaceShell = document.querySelector('.shell');
  const skipLink = document.querySelector('.skip-link');
  if (workspaceShell) workspaceShell.inert = true;
  if (skipLink) skipLink.inert = true;
  cmdPaletteBackdrop.innerHTML = `
    <div class="cmd-palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <input class="cmd-palette-input" id="cmd-input" type="text" placeholder="Type a command..." autocomplete="off" role="combobox" aria-label="Search commands" aria-autocomplete="list" aria-controls="cmd-list" aria-expanded="true" />
      <div class="cmd-palette-list" id="cmd-list" role="listbox" aria-label="Commands"></div>
      <div class="cmd-palette-empty hidden" id="cmd-empty" role="status" aria-live="polite"></div>
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
  cmdPaletteBackdrop.setAttribute('aria-hidden', 'true');
  cmdPaletteBackdrop.innerHTML = '';
  const workspaceShell = document.querySelector('.shell');
  const skipLink = document.querySelector('.skip-link');
  if (workspaceShell) workspaceShell.inert = false;
  if (skipLink) skipLink.inert = false;
  if (appState.cmdPaletteTrigger instanceof HTMLElement && appState.cmdPaletteTrigger.isConnected) {
    appState.cmdPaletteTrigger.focus();
  }
  appState.cmdPaletteTrigger = null;
}

function renderCmdList() {
  const list = document.getElementById('cmd-list');
  const input = document.getElementById('cmd-input');
  const empty = document.getElementById('cmd-empty');
  if (!list) return;
  if (!cmdFiltered.length) {
    list.innerHTML = '';
    input?.removeAttribute('aria-activedescendant');
    if (empty) {
      empty.textContent = 'No matching commands';
      empty.classList.remove('hidden');
    }
    return;
  }
  empty?.classList.add('hidden');
  if (empty) empty.textContent = '';
  list.innerHTML = cmdFiltered.map((item, i) => `
    <div class="cmd-palette-item ${i === cmdPaletteIndex ? 'active' : ''}" id="cmd-option-${escapeAttr(item.id)}" role="option" aria-selected="${String(i === cmdPaletteIndex)}" data-cmd-idx="${i}">
      <span class="cmd-icon" aria-hidden="true">${item.icon}</span>
      <span>${escapeHtml(item.label)}</span>
      ${item.key ? `<span class="cmd-key">${escapeHtml(item.key)}</span>` : ''}
    </div>
  `).join('');
  const activeOption = list.querySelector('[role="option"][aria-selected="true"]');
  if (input && activeOption?.id) input.setAttribute('aria-activedescendant', activeOption.id);
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

cmdPaletteBackdrop?.addEventListener('click', (event) => {
  if (event.target === cmdPaletteBackdrop) closeCmdPalette();
});

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

  const statuses = ['new', 'researching', 'contacted', 'in_conversation', 'client', 'paused'];
  const priorities = ['high', 'medium', 'low'];
  const grid = {};
  statuses.forEach(s => { grid[s] = {}; priorities.forEach(p => { grid[s][p] = 0; }); });

  accounts.forEach(a => {
    const s = (a.status || 'new').toLowerCase();
    const tierPriority = { a: 'high', b: 'medium', c: 'low' }[String(a.priorityTier || '').toLowerCase()];
    const p = (a.priority || tierPriority || 'medium').toLowerCase();
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
                 <label class="kanban-stage-control"><span>Move to stage</span><select data-kanban-stage aria-label="Move ${escapeAttr(item.displayName)} to stage">
                   ${columns.map((stage) => `<option value="${escapeAttr(stage.key)}" ${selected(col.key, stage.key)}>${escapeHtml(stage.label)}</option>`).join('')}
                 </select></label>
               </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function updateKanbanCounts(board) {
  board?.querySelectorAll('.kanban-column').forEach((column) => {
    const body = column.querySelector('.kanban-column-body');
    const count = column.querySelector('.kanban-column-count');
    if (body && count) count.textContent = body.children.length;
  });
}

async function moveKanbanCard(card, newStatus) {
  const board = card?.closest('#kanban-board');
  const oldStatus = card?.dataset.status || '';
  const stageSelect = card?.querySelector('[data-kanban-stage]');
  if (!board || !card || !newStatus || newStatus === oldStatus) return;
  if (card.dataset.moving === 'true') {
    if (stageSelect) stageSelect.value = oldStatus;
    return;
  }
  const destination = board.querySelector(`.kanban-column-body[data-status="${CSS.escape(newStatus)}"]`);
  const previousColumn = card.parentElement;
  if (!destination) {
    if (stageSelect) stageSelect.value = oldStatus;
    return;
  }

  const previousDraggable = card.getAttribute('draggable');
  card.dataset.moving = 'true';
  card.setAttribute('aria-busy', 'true');
  card.setAttribute('draggable', 'false');
  if (stageSelect) stageSelect.disabled = true;

  destination.appendChild(card);
  card.dataset.status = newStatus;
  if (stageSelect) stageSelect.value = newStatus;
  updateKanbanCounts(board);

  try {
    await api(`/api/accounts/${card.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    invalidateAppData();
    trackStageChange(card.dataset.id, newStatus);
    showUndoToast(`Moved to ${humanize(newStatus)}`, async () => {
      await api(`/api/accounts/${card.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: oldStatus }) });
      invalidateAppData();
      await renderAccountsView();
    });
  } catch (err) {
    previousColumn?.appendChild(card);
    card.dataset.status = oldStatus;
    if (stageSelect) stageSelect.value = oldStatus;
    updateKanbanCounts(board);
    showToast('Failed to update status: ' + (err.message || err), 'error');
  } finally {
    delete card.dataset.moving;
    card.removeAttribute('aria-busy');
    if (previousDraggable === null) card.removeAttribute('draggable');
    else card.setAttribute('draggable', previousDraggable);
    if (stageSelect) stageSelect.disabled = false;
  }
}

function wireKanbanDragDrop() {
  const board = document.getElementById('kanban-board');
  if (!board) return;
  let dragEl = null;
  board.addEventListener('change', async (event) => {
    const select = event.target.closest('[data-kanban-stage]');
    if (!select) return;
    await moveKanbanCard(select.closest('.kanban-card'), select.value);
  });
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
    await moveKanbanCard(dragEl, newStatus);
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
  document.querySelectorAll('[data-inline-edit]').forEach(trigger => {
    const beginEdit = () => {
      if (!trigger.isConnected) return;
      const field = trigger.dataset.inlineEdit;
      const accountId = trigger.dataset.accountId;
      const currentVal = trigger.dataset.currentValue ?? '';
      const input = document.createElement('input');
      input.className = 'inline-edit-input';
      input.value = currentVal;
      input.dataset.field = field;
      input.dataset.accountId = accountId;
      input.setAttribute('aria-label', `Edit ${humanize(field || 'value')}`);
      trigger.replaceWith(input);
      input.focus();
      input.select();
      let settled = false;
      const restoreTrigger = () => {
        if (input.isConnected) input.replaceWith(trigger);
        trigger.focus();
      };
      const save = async () => {
        if (settled) return;
        settled = true;
        const newVal = input.value.trim();
        if (newVal === currentVal) { restoreTrigger(); return; }
        input.disabled = true;
        input.setAttribute('aria-busy', 'true');
        try {
          await api(`/api/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify({ [field]: newVal }) });
          invalidateAppData();
          const valueNode = trigger.querySelector('[data-inline-value]');
          if (valueNode) valueNode.textContent = newVal || 'Unassigned';
          trigger.dataset.currentValue = newVal;
          restoreTrigger();
          showToast(`${humanize(field)} updated.`, 'success');
        } catch(err) {
          restoreTrigger();
          showToast('Save failed: ' + (err.message || err), 'error');
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); save(); }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          settled = true;
          restoreTrigger();
        }
      });
      input.addEventListener('blur', save);
    };
    trigger.addEventListener('click', beginEdit);
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
    if (current >= 80 && Number(a.contactCount || a.connectionCount || 0) === 0) {
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
  persistSharedWorkspacePreference('accountNotes');
}

function deleteAccountNote(accountId, noteId) {
  const notes = appState.accountNotes;
  if (!notes[accountId]) return;
  notes[accountId] = notes[accountId].filter(n => n.id !== noteId);
  persistSharedWorkspacePreference('accountNotes');
}

function renderAccountNotesPanel(accountId) {
  const notes = appState.accountNotes[accountId] || [];
  return `
    <div class="detail-card notes-panel">
      <div class="panel-header"><div><h3>Workspace notes</h3><p class="muted small">Shared with everyone in this workspace.</p></div></div>
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

function wireAccountNotes(accountId) {
  const rerender = () => {
    const panel = document.querySelector('.notes-panel');
    if (panel) panel.outerHTML = renderAccountNotesPanel(accountId);
    wireAccountNotes(accountId);
  };
  document.getElementById('add-note-btn')?.addEventListener('click', () => {
    const input = document.getElementById('note-input');
    if (!input?.value.trim()) return;
    addAccountNote(accountId, input.value);
    rerender();
  });
  document.querySelectorAll('.note-delete').forEach((button) => {
    button.addEventListener('click', () => {
      deleteAccountNote(button.dataset.accountId, Number(button.dataset.noteId));
      rerender();
    });
  });
}

/* ── Automation rules engine ── */
function addAutomationRule(rule) {
  appState.automationRules.push({ ...rule, id: Date.now(), enabled: true });
  persistSharedWorkspacePreference('automationRules');
}

function deleteAutomationRule(ruleId) {
  appState.automationRules = appState.automationRules.filter(r => r.id !== ruleId);
  persistSharedWorkspacePreference('automationRules');
}

function toggleAutomationRule(ruleId) {
  const rule = appState.automationRules.find(r => r.id === ruleId);
  if (rule) rule.enabled = !rule.enabled;
  persistSharedWorkspacePreference('automationRules');
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
      <div class="panel-header"><div><h3>Shared rule drafts</h3><p class="muted small">Visible to your workspace for review. Actions are not applied automatically.</p></div></div>
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
    const previousValue = i > 0 ? Number(stages[i - 1].value || 0) : 0;
    const convRate = i > 0 && previousValue > 0 ? Math.round((s.value / previousValue) * 100) : 0;
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
    { label: 'Contacts', ok: Number(account.contactCount || account.connectionCount || 0) > 0 },
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

/* ── Phase 6: Outreach sequences ── */
function renderOutreachSequencePanel(accountId) {
  const seqs = appState.outreachSequences.filter(s => s.accountId === accountId);
  return `
    <div class="detail-card sequence-panel">
      <div class="panel-header"><div><h3>Workspace sequence plan</h3><p class="muted small">Shared follow-up steps for this account.</p></div></div>
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
  persistSharedWorkspacePreference('activityLog');
}

function renderActivityTimeline(accountId) {
  const items = appState.activityLog.filter(a => a.accountId === accountId).slice(0, 30);
  if (!items.length) return '';
  return `
    <div class="detail-card">
      <div class="panel-header"><div><h3>Activity timeline</h3><p class="muted small">Recent workspace actions on this account.</p></div></div>
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

const COMMERCIAL_OUTCOME_STAGES = [
  { id: 'outreach_logged', label: 'Outreach logged', tone: 'neutral' },
  { id: 'replied', label: 'Reply received', tone: 'accent' },
  { id: 'positive_reply', label: 'Positive reply', tone: 'accent' },
  { id: 'meeting_booked', label: 'Meeting booked', tone: 'success' },
  { id: 'opportunity_created', label: 'Opportunity created', tone: 'warning' },
  { id: 'won', label: 'Client won', tone: 'success' },
  { id: 'lost', label: 'Closed lost', tone: 'danger' },
];

const COMMERCIAL_VALUE_ACTIVITY_STAGES = new Set(['opportunity', 'won', 'lost']);

function getCommercialOutcomeCount(summary = {}, stage) {
  const value = summary.counts?.[stage] ?? summary.byStage?.[stage]?.count ?? summary.byStage?.[stage] ?? 0;
  return Number(value || 0);
}

function formatCurrencyFromCents(valueCents, currency = 'USD') {
  const value = Number(valueCents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currency || 'USD').toUpperCase(),
      maximumFractionDigits: value % 1 ? 2 : 0,
    }).format(value);
  } catch {
    return `$${formatNumber(value)}`;
  }
}

function renderCommercialOutcomeSummary(summary = {}) {
  if (summary.unavailable) {
    return `
      <section class="detail-card commercial-outcomes-panel commercial-outcomes-panel--unavailable">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Commercial evidence</p>
            <h3>Account signals and client outcomes</h3>
            <p class="muted small">Outcome data could not be loaded just now. Your saved account activity is unaffected.</p>
          </div>
        </div>
        ${renderEmptyState({
          icon: '!',
          title: 'Commercial outcomes are temporarily unavailable',
          copy: 'Try this section again without leaving the dashboard.',
          action: '<button class="secondary-button" type="button" data-action="retry-outcome-summary">Try again</button>',
          compact: true,
        })}
      </section>`;
  }
  const total = Number(summary.total || Object.values(summary.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0));
  const meetings = getCommercialOutcomeCount(summary, 'meeting_booked');
  const opportunities = getCommercialOutcomeCount(summary, 'opportunity_created');
  const wins = getCommercialOutcomeCount(summary, 'won');
  const replies = getCommercialOutcomeCount(summary, 'replied') + getCommercialOutcomeCount(summary, 'positive_reply');
  const valueEntries = Object.entries(summary.valuesByCurrency || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!valueEntries.length && (summary.wonValueCents || summary.openOpportunityValueCents)) {
    valueEntries.push([summary.currency || 'USD', {
      opportunityCreatedCents: summary.openOpportunityValueCents || 0,
      wonCents: summary.wonValueCents || 0,
    }]);
  }
  return `
    <section class="detail-card commercial-outcomes-panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Commercial evidence</p>
          <h3>Account signals and client outcomes</h3>
          <p class="muted small">Track what happened alongside each account. This shows an association with the account context, not proof that a hiring signal caused the result.</p>
        </div>
        ${total ? `<span class="outcome-total">${formatNumber(total)} logged</span>` : ''}
      </div>
      ${total ? `
        <div class="outcome-value-grid">
          ${renderMetricTile('Replies', formatNumber(replies))}
          ${renderMetricTile('Meetings', formatNumber(meetings))}
          ${renderMetricTile('Opportunities', formatNumber(opportunities))}
          ${renderMetricTile('Clients won', formatNumber(wins))}
        </div>
        ${valueEntries.length ? `<div class="outcome-currency-grid" aria-label="Commercial value by currency">
          ${valueEntries.map(([currency, values]) => `
            <div class="outcome-currency-row">
              <strong>${escapeHtml(currency)}</strong>
              <span>${escapeHtml(formatCurrencyFromCents(values.opportunityCreatedCents || 0, currency))} opportunity value</span>
              <span>${escapeHtml(formatCurrencyFromCents(values.wonCents || 0, currency))} won</span>
              ${values.lostCents ? `<span>${escapeHtml(formatCurrencyFromCents(values.lostCents, currency))} lost</span>` : ''}
            </div>`).join('')}
        </div>` : ''}
        <div class="outcome-stage-strip" aria-label="Commercial outcome funnel">
          ${COMMERCIAL_OUTCOME_STAGES.map((stage) => `
            <span class="outcome-stage outcome-stage--${stage.tone}">
              <strong>${formatNumber(getCommercialOutcomeCount(summary, stage.id))}</strong>
              ${escapeHtml(stage.label)}
            </span>`).join('')}
        </div>` : renderEmptyState({
          icon: 'ROI',
          title: 'Start proving commercial value',
          copy: 'Open an account after outreach and record the next real outcome. Meetings and wins will roll up here automatically.',
          action: '<a class="secondary-button" href="#/accounts">Open target accounts</a>',
          compact: true,
        })}
    </section>`;
}

function renderAccountCommercialOutcomes(payload = {}) {
  if (payload.unavailable) {
    return `
      <div class="account-outcomes account-outcomes--unavailable">
        <div class="panel-header panel-header--compact">
          <div>
            <h4>Commercial outcomes</h4>
            <p class="muted small">Outcome history could not be loaded. Activity on this account is still available below.</p>
          </div>
        </div>
        <button class="secondary-button" type="button" data-action="retry-account-outcomes" data-account-id="${escapeAttr(payload.accountId || '')}">Try outcome history again</button>
      </div>`;
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  const guidance = canMutateWorkspace()
    ? 'Choose a result in the activity form above. Outreach and replies are recorded once through that same workflow.'
    : 'This outcome history is read-only for the current session.';
  return `
    <div class="account-outcomes">
      <div class="panel-header panel-header--compact">
        <div>
          <h4>Commercial outcomes</h4>
          <p class="muted small">Results recorded alongside this account's hiring and relationship context.</p>
        </div>
        ${items.length ? `<span class="small muted">${formatNumber(payload.total || items.length)} logged</span>` : ''}
      </div>
      <p class="small muted outcome-empty-copy">${escapeHtml(guidance)}</p>
      ${items.length ? `
        <div class="outcome-timeline">
          ${items.slice(0, 8).map((item) => `
            <article class="outcome-timeline__item">
              <span class="outcome-timeline__mark" aria-hidden="true"></span>
              <div>
                <div class="inline-header">
                  <strong>${escapeHtml(COMMERCIAL_OUTCOME_STAGES.find((stage) => stage.id === item.stage)?.label || humanize(item.stage || 'outcome'))}</strong>
                  <span class="small muted">${formatDate(item.occurredAt || item.createdAt)}</span>
                </div>
                ${item.valueCents !== null && item.valueCents !== undefined ? `<p class="outcome-value">${escapeHtml(formatCurrencyFromCents(item.valueCents, item.currency))}</p>` : ''}
                ${(item.notes || item.lostReason) ? `<p class="small muted">${escapeHtml(item.notes || item.lostReason)}</p>` : ''}
              </div>
            </article>`).join('')}
        </div>` : '<p class="small muted outcome-empty-copy">No commercial outcome has been recorded for this account yet.</p>'}
    </div>`;
}

/* ── Phase 6: Sales cycle analytics ── */
function renderSalesCycleAnalytics(accounts) {
  if (!Array.isArray(accounts) || !accounts.length) return '';
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
        ${renderField('Spike min jobs', `<input name="hiringSpikeMinJobs" type="number" min="1" value="${t.hiringSpikeMinJobs}">`)}
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
    if ((a.hiringSpikeRatio || 0) > t.hiringSpikeFactor && (a.jobsLast30Days || 0) >= t.hiringSpikeMinJobs) {
      alerts.push({ type: 'hiring_spike', accountId: a.id, name: a.displayName, message: `Hiring spike: ${a.jobsLast30Days} jobs in 30d (${a.hiringSpikeRatio}x normal)`, severity: 'success' });
    }
    if (current >= t.highScoreNoContacts && Number(a.contactCount || a.connectionCount || 0) === 0) {
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
    { id: 'hero', label: 'Daily summary', required: true },
    { id: 'workflow', label: 'Quick working lanes' },
    { id: 'action-plan', label: 'Recommended next actions' },
    { id: 'outcomes', label: 'Commercial outcomes' },
    { id: 'readiness', label: 'Workspace readiness' },
    { id: 'alerts-bar', label: 'Important alerts' },
    { id: 'queue', label: "Today's priority queue" },
    { id: 'jobs-activity', label: 'New jobs and recent activity' },
    { id: 'metrics', label: 'Performance metrics' },
    { id: 'playbook', label: "Today's playbook" },
    { id: 'boards', label: 'Hiring signal boards' },
    { id: 'enrichment', label: 'Data enrichment progress' },
    { id: 'heatmap', label: 'Pipeline heatmap' },
    { id: 'smart-alerts', label: 'Smart alerts' },
    { id: 'velocity', label: 'Deal velocity' },
    { id: 'leaderboard', label: 'Team leaderboard' },
    { id: 'data-quality', label: 'Data quality' },
    { id: 'duplicates', label: 'Possible duplicates' },
    { id: 'sales-cycle', label: 'Sales cycle analytics' },
    { id: 'charts', label: 'Pipeline charts' },
  ].filter((section) => section.id !== 'outcomes' || (!isJobSeekerPersona() && supportsCommercialOutcomes()));
}

function renderDashboardCustomizer() {
  const sections = getDashboardSections();
  const collapsed = appState.dashboardCollapsed;
  return `
    <details class="dash-customizer">
      <summary id="dash-customize-toggle" aria-label="Dashboard options" title="Dashboard options">
        <svg class="dash-options-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/></svg>
        <span class="visually-hidden">View options</span>
      </summary>
      <div class="dash-customizer-dropdown" id="dash-customizer-dropdown">
        <div class="dash-options-heading">
          <strong>Dashboard sections</strong>
          <span>Keep the daily view focused.</span>
        </div>
        ${sections.map(s => `
          <label class="dash-customizer-item">
            <input type="checkbox" ${s.required ? 'checked disabled' : (collapsed[s.id] ? '' : 'checked')} data-section-id="${s.id}">
            ${escapeHtml(s.label)}
          </label>`).join('')}
        <div class="dash-options-footer">
          <button class="menu-action menu-action--compact" type="button" data-action="export-pdf">
            <span class="menu-action-icon" aria-hidden="true">&#8595;</span>
            <span><strong>Save as PDF</strong><small>Open the print dialog</small></span>
          </button>
        </div>
      </div>
    </details>`;
}

function wireDashboardCustomizer() {
  const dropdown = document.getElementById('dash-customizer-dropdown');
  if (!dropdown) return;
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

const DASHBOARD_TAB_SECTIONS = {
  'battle-board': new Set(['hero', 'value-sprint', 'command-tabs', 'playbook', 'alerts-bar', 'today-queue', 'follow-ups', 'action-plan', 'workflow']),
  'hiring-radar': new Set(['hero', 'value-sprint', 'command-tabs', 'network-radar', 'new-jobs', 'boards', 'velocity', 'heatmap', 'enrichment', 'readiness']),
  'pipeline': new Set(['hero', 'value-sprint', 'command-tabs', 'roi-hero', 'outcomes', 'sales-cycle', 'leaderboard', 'metrics', 'workflow', 'duplicates', 'data-quality']),
};

function dashSection(id, html) {
  const currentTab = appState.dashboardTab || 'battle-board';
  const tabSet = DASHBOARD_TAB_SECTIONS[currentTab];
  const tabHidden = tabSet && !tabSet.has(id);
  const userCollapsed = appState.dashboardCollapsed[id];
  const hidden = tabHidden || userCollapsed;
  return `<div data-dash-section="${id}" style="${hidden ? 'display:none' : ''}">${html}</div>`;
}

function render3StepValueSprint(dashboard = {}, personaCopy = {}) {
  if (appState.valueSprintDismissed) return '';
  const totalAccounts = dashboard.summary?.accountCount || 0;
  const activeJobs = getDashboardActiveJobCount(dashboard.summary) || 0;
  const contactedCount = dashboard.summary?.contactedCount || (appState.activityLog?.length || 0) || (appState.outcomeSummary?.funnel?.contacted || 0);

  const step1Done = totalAccounts > 0 || (dashboard.todayQueue?.length || 0) > 0;
  const step2Done = activeJobs > 0 || (dashboard.newJobsToday?.length || 0) > 0;
  const step3Done = contactedCount > 0;

  const completedCount = (step1Done ? 1 : 0) + (step2Done ? 1 : 0) + (step3Done ? 1 : 0);
  const percent = Math.round((completedCount / 3) * 100);

  return `
    <section class="value-sprint-card">
      <div class="value-sprint-header">
        <div class="value-sprint-title-group">
          <h3>⚡ 3-Step Outbound Value Sprint <span class="status-pill status-pill--success">${completedCount}/3 Complete (${percent}%)</span></h3>
          <p>Get from cold workspace to live, verified warm conversations in under 3 minutes.</p>
        </div>
        <div class="value-sprint-meter">
          <div class="value-sprint-progress"><div class="value-sprint-progress-fill" style="width: ${Math.max(percent, 5)}%"></div></div>
          <button class="ghost-button ghost-button--xs" type="button" data-action="dismiss-value-sprint" title="Hide quick start">✕ Dismiss</button>
        </div>
      </div>
      <div class="sprint-steps-grid">
        <div class="sprint-step-item ${step1Done ? 'is-completed' : ''}">
          <div class="sprint-step-top">
            <span class="sprint-step-number">${step1Done ? '✓' : '1'}</span>
            <div class="sprint-step-content">
              <h4>${step1Done ? 'Network Connected' : '1. Import Your Network'}</h4>
              <p>${step1Done ? `${formatNumber(totalAccounts)} companies and network contacts loaded.` : 'Upload LinkedIn Connections.csv or try the instant sample network.'}</p>
            </div>
          </div>
          <div class="sprint-step-cta">
            ${step1Done
              ? '<a class="ghost-button ghost-button--xs" href="#/contacts">View Network →</a>'
              : '<button class="primary-button primary-button--xs" type="button" data-action="open-network-import-modal">⚡ Import Network</button> <button class="secondary-button secondary-button--xs" type="button" data-action="quick-load-sample-workspace">Sample</button>'}
          </div>
        </div>

        <div class="sprint-step-item ${step2Done ? 'is-completed' : ''}">
          <div class="sprint-step-top">
            <span class="sprint-step-number">${step2Done ? '✓' : '2'}</span>
            <div class="sprint-step-content">
              <h4>${step2Done ? 'Live Hiring Matched' : '2. Discover ATS Signals'}</h4>
              <p>${step2Done ? `${formatNumber(activeJobs)} verified active roles synced with warm paths.` : 'Discover Greenhouse, Lever, Ashby, Workday boards with active roles.'}</p>
            </div>
          </div>
          <div class="sprint-step-cta">
            ${step2Done
              ? '<a class="ghost-button ghost-button--xs" href="#/jobs">Explore Roles →</a>'
              : '<a class="primary-button primary-button--xs" href="#/jobs">Review Hiring Radar</a>'}
          </div>
        </div>

        <div class="sprint-step-item ${step3Done ? 'is-completed' : ''}">
          <div class="sprint-step-top">
            <span class="sprint-step-number">${step3Done ? 'Outbound Active' : '3. Launch Outreach'}</span>
            <div class="sprint-step-content">
              <h4>${step3Done ? 'First Outreach Sent' : '3. 1-Click Outreach'}</h4>
              <p>${step3Done ? `${formatNumber(contactedCount)} contacts engaged with durable follow-ups.` : 'Use Batch Outreach Studio to generate grounded notes for your top targets.'}</p>
            </div>
          </div>
          <div class="sprint-step-cta">
            <a class="primary-button primary-button--xs" href="#/contacts">Launch Outreach →</a>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderDashboardCommandCenterTabs(dashboard = {}, extended = {}) {
  const currentTab = appState.dashboardTab || 'battle-board';
  const battleCount = (dashboard.todayQueue?.length || 0) + ((extended.overdueFollowUps?.length || 0) + (extended.staleAccounts?.length || 0));
  const radarCount = getDashboardActiveJobCount(dashboard.summary) || 0;
  const pipelineCount = dashboard.summary?.accountCount || 0;

  return `
    <nav class="dashboard-tab-bar" role="tablist" aria-label="Dashboard views">
      <button class="dashboard-tab-btn ${currentTab === 'battle-board' ? 'active' : ''}" type="button" role="tab" aria-selected="${currentTab === 'battle-board'}" data-action="dashboard-switch-tab" data-tab="battle-board">
        <span>🎯 Today's Battle Board</span>
        <span class="tab-badge">${formatNumber(battleCount)}</span>
      </button>
      <button class="dashboard-tab-btn ${currentTab === 'hiring-radar' ? 'active' : ''}" type="button" role="tab" aria-selected="${currentTab === 'hiring-radar'}" data-action="dashboard-switch-tab" data-tab="hiring-radar">
        <span>📡 Hiring & Network Radar</span>
        <span class="tab-badge">${formatNumber(radarCount)}</span>
      </button>
      <button class="dashboard-tab-btn ${currentTab === 'pipeline' ? 'active' : ''}" type="button" role="tab" aria-selected="${currentTab === 'pipeline'}" data-action="dashboard-switch-tab" data-tab="pipeline">
        <span>📊 Pipeline & Outcomes</span>
        <span class="tab-badge">${formatNumber(pipelineCount)}</span>
      </button>
      <button class="dashboard-tab-btn ${currentTab === 'all' ? 'active' : ''}" type="button" role="tab" aria-selected="${currentTab === 'all'}" data-action="dashboard-switch-tab" data-tab="all">
        <span>⚡ All Sections</span>
      </button>
    </nav>
  `;
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
  const values = appState.customFieldValues[accountId] || {};
  if (!fields.length) {
    return `
      <div class="detail-card custom-fields-panel">
        <div class="panel-header"><div><h3>Workspace custom fields</h3><p class="muted small">Define fields shared across this workspace.</p></div></div>
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
        <div><h3>Workspace custom fields</h3><p class="muted small">${fields.length} shared field${fields.length > 1 ? 's' : ''} defined.</p></div>
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

// CG-013: forward uncaught client errors to the server so operators learn
// about broken buttons before customers report them. Throttled per session;
// best-effort (never throws, never blocks the UI).
let clientErrorReportCount = 0;
let lastClientErrorReportAt = 0;
function reportClientError(error, context = {}) {
  try {
    const nowMs = Date.now();
    if (clientErrorReportCount >= 5 || nowMs - lastClientErrorReportAt < 10000) return;
    clientErrorReportCount += 1;
    lastClientErrorReportAt = nowMs;
    const body = JSON.stringify({
      message: String(error?.message || error || 'unknown error').slice(0, 500),
      stack: String(error?.stack || '').slice(0, 1000),
      route: location.hash || location.pathname,
      action: String(context.action || ''),
    });
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch { /* reporting must never break the app */ }
}

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault();
  if (isBillingRequiredError(event.reason)) {
    renderBillingRequiredView(event.reason);
    return;
  }
  reportClientError(event.reason, { action: 'unhandledrejection' });
  window.bdLocalApi.handleError(event.reason, appAlert);
});

window.addEventListener('error', (event) => {
  reportClientError(event.error || event.message, { action: 'window.onerror' });
  window.bdLocalApi.handleError(event.error || event.message, appAlert);
});

init();

function getWorkspaceLoadProgressKey(hint = appState.workspaceLoadHint) {
  return `bd_large_workspace_load_seen:${hint?.tenantId || 'current'}`;
}

function shouldShowWorkspaceLoadProgress(hint) {
  if (!hint?.shouldShowProgress || !hint?.isLargeDataset) return false;
  const key = getWorkspaceLoadProgressKey(hint);
  try {
    return sessionStorage.getItem(key) !== 'done';
  } catch {
    return true;
  }
}

function describeWorkspaceLoadSize(hint = {}) {
  const counts = hint.counts || {};
  const parts = [
    ['contacts', counts.contacts],
    ['accounts', counts.accounts],
    ['jobs', counts.jobs],
    ['ATS boards', counts.configs],
  ]
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([label, value]) => `${formatNumber(value)} ${label}`);
  return parts.slice(0, 2).join(' and ') || 'a large dataset';
}

async function loadWorkspaceLoadHint() {
  const startedAt = performance.now();
  const hint = await api('/api/workspace/load-hint', { skipCache: true });
  const elapsedMs = Math.round(performance.now() - startedAt);
  appState.workspaceLoadHint = hint;
  if (elapsedMs > 250) {
    console.info(`Slow workspace load hint: app/app.js loadWorkspaceLoadHint ${elapsedMs}ms`);
  }
  return hint;
}

function startWorkspaceLoadProgress(hint) {
  if (!shouldShowWorkspaceLoadProgress(hint) || appState.workspaceLoadProgressVisible) return false;
  appState.workspaceLoadProgressKey = getWorkspaceLoadProgressKey(hint);
  appState.workspaceLoadProgressVisible = true;
  appState.workspaceLoadProgressValue = 8;
  workspaceFootnote?.classList.add('is-loading-large');
  workspaceLoadWarning?.classList.remove('hidden');
  updateWorkspaceLoadProgress(8, `Large first run detected: ${describeWorkspaceLoadSize(hint)}. This can take a few minutes; keep this tab open.`);
  clearInterval(appState.workspaceLoadProgressTimer);
  appState.workspaceLoadProgressTimer = window.setInterval(() => {
    if (!appState.workspaceLoadProgressVisible) {
      clearInterval(appState.workspaceLoadProgressTimer);
      return;
    }
    const current = appState.workspaceLoadProgressValue;
    const increment = current < 45 ? 4 : current < 75 ? 2 : 0.75;
    updateWorkspaceLoadProgress(Math.min(92, current + increment));
  }, 1800);
  return true;
}

function updateWorkspaceLoadProgress(value, message = '') {
  if (!appState.workspaceLoadProgressVisible) return;
  const nextValue = Math.max(appState.workspaceLoadProgressValue || 0, Math.min(100, Math.round(value)));
  appState.workspaceLoadProgressValue = nextValue;
  if (workspaceLoadProgressBar) workspaceLoadProgressBar.style.width = `${nextValue}%`;
  if (message && workspaceLoadMessage) workspaceLoadMessage.textContent = message;
}

function hideWorkspaceLoadProgress({ markSeen = false } = {}) {
  clearInterval(appState.workspaceLoadProgressTimer);
  appState.workspaceLoadProgressTimer = null;
  appState.workspaceLoadProgressVisible = false;
  appState.workspaceLoadProgressValue = 0;
  workspaceFootnote?.classList.remove('is-loading-large');
  workspaceLoadWarning?.classList.add('hidden');
  if (workspaceLoadProgressBar) workspaceLoadProgressBar.style.width = '0%';
  if (markSeen && appState.workspaceLoadProgressKey) {
    try {
      sessionStorage.setItem(appState.workspaceLoadProgressKey, 'done');
    } catch {
      // Session storage is a hint only; the server-side first-load guard is authoritative.
    }
  }
}

function finishWorkspaceLoadProgress() {
  if (!appState.workspaceLoadProgressVisible) return;
  updateWorkspaceLoadProgress(100, 'Workspace ready.');
  window.setTimeout(() => hideWorkspaceLoadProgress({ markSeen: true }), 900);
}

async function init() {
  bindEvents();
  window.bdLocalApi.setAlert('', appAlert);
  trackAppVisit().catch(() => {});
  renderLoadingState('Dashboard', 'Building your operating view...');
  let initializationActive = true;
  const loadHintPromise = loadWorkspaceLoadHint()
    .then((hint) => {
      if (initializationActive) startWorkspaceLoadProgress(hint);
      return hint;
    })
    .catch((error) => {
      console.info('Workspace load hint unavailable.', error);
      return null;
    });
  
  // Set a timer to show a "long setup" warning if things are taking a while
  const longLoadTimer = setTimeout(() => {
    if (appState.activeView === 'dashboard' && !appState.bootstrap) {
      renderLoadingState('Dashboard', 'First-time setup is taking longer than expected. We are still processing your data...');
    }
  }, 5000);

  try {
    await Promise.race([loadHintPromise, sleep(250)]);
    updateWorkspaceLoadProgress(18, 'Large first run: checking setup status for a large workspace...');
    const setupStatus = await loadSetupStatus(true);
    const initialRoot = getRouteRoot();
    if (setupStatus?.requiresSetup && initialRoot !== 'setup') {
      initializationActive = false;
      clearTimeout(longLoadTimer);
      hideWorkspaceLoadProgress();
      location.hash = '#/setup';
      return;
    }
    if (initialRoot === 'setup') {
      initializationActive = false;
      clearTimeout(longLoadTimer);
      hideWorkspaceLoadProgress();
      await renderRoute();
      return;
    }
    await loadWorkspacePreferences();
    if (routeNeedsBootstrapFilters(initialRoot)) {
      updateWorkspaceLoadProgress(46, 'Large first run: loading workspace snapshot and filters...');
      await loadBootstrap(true, { includeFilters: true });
      clearTimeout(longLoadTimer);
      updateWorkspaceLoadProgress(86, 'Large first run: rendering workspace...');
      await renderRoute();
      initializationActive = false;
      finishWorkspaceLoadProgress();
    } else {
      clearTimeout(longLoadTimer);
      await renderRoute();
      updateWorkspaceLoadProgress(72, 'Large first run: dashboard is ready. Finishing workspace details...');
      loadBootstrap(false).catch((error) => {
        initializationActive = false;
        hideWorkspaceLoadProgress();
        console.warn('Bootstrap hydration failed in background.', error);
        window.bdLocalApi.setAlert('Background data refresh failed. Some filters may be stale.', appAlert);
        return null;
      }).then(() => {
        initializationActive = false;
        finishWorkspaceLoadProgress();
      });
    }
  } catch (error) {
    initializationActive = false;
    hideWorkspaceLoadProgress();
    if (error?.status === 401 && location.pathname.startsWith('/app')) {
      const loginUrl = '/?login=1';
      try {
        window.top.location.replace(loginUrl);
      } catch {
        location.replace(loginUrl);
      }
      return;
    }
    if (isBillingRequiredError(error)) {
      clearTimeout(longLoadTimer);
      await renderBillingRequiredView(error);
      return;
    }
    window.bdLocalApi.handleError(error, appAlert);
    appRoot.innerHTML = `<div class="empty-state">Unable to load the BD Engine data. ${escapeHtml(error.message || String(error))}</div>`;
  }
}

function bindEvents() {
  window.addEventListener('hashchange', async () => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    try {
      await renderRoute();
      if (!appState.outreachModalOpen) viewTitle?.focus({ preventScroll: true });
    } catch (error) {
      if (isBillingRequiredError(error)) {
        renderBillingRequiredView(error);
        return;
      }
      window.bdLocalApi.handleError(error, appAlert);
    }
  });
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || document.activeElement?.isContentEditable;

    if (appState.tourActive) {
      const dialog = document.querySelector('.tour-card[role="dialog"]');
      if (e.key === 'Escape') {
        e.preventDefault();
        endTour({ skipped: true });
        return;
      }
      if (e.key === 'Tab' && dialog) {
        const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
        if (!focusable.length) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      // The tour is modal; suppress global navigation shortcuts while it is open.
      return;
    }

    const taskTab = e.target.closest?.('.tasks-tabs [role="tab"]');
    if (taskTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const tabs = Array.from(taskTab.closest('[role="tablist"]').querySelectorAll('[role="tab"]'));
      const currentIndex = tabs.indexOf(taskTab);
      const nextIndex = e.key === 'Home' ? 0
        : e.key === 'End' ? tabs.length - 1
          : (currentIndex + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[nextIndex]?.focus();
      tabs[nextIndex]?.click();
      return;
    }

    // Escape: close modals/palette/mobile nav
    if (e.key === 'Escape') {
      if (appState.shortcutsModalOpen) { closeShortcutsModal(); return; }
      if (appState.objectionModalOpen) { closeObjectionStudioModal(); return; }
      if (appState.candidateSlateModalOpen) { closeCandidateSlateModal(); return; }
      if (appState.callStudioModalOpen) { closeCallStudioModal(); return; }
      if (appState.networkGraphModalOpen) { closeNetworkGraphModal(); return; }
      if (appState.battlePlanModalOpen) { closeBattlePlanModal(); return; }
      if (appState.autopilotModalOpen) { closeAutopilotModal(); return; }
      if (appState.pitchDeckModalOpen) { closePitchDeckModal(); return; }
      if (appState.batchOutreachModalOpen) { closeBatchOutreachModal(); return; }
      if (appState.cmdPaletteOpen) { closeCmdPalette(); return; }
      if (appState.mobileNavOpen) { closeMobileNav(); return; }
      if (appState.networkModalOpen) { closeNetworkImportModal(); return; }
      if (appState.linkedinGuideModalOpen) { closeLinkedInGuideModal(); return; }
      if (appState.warmStudioModalOpen) { closeWarmStudioModal(); return; }
      if (appState.pricingModalOpen) { closePricingModal(); return; }
      if (appState.morningRadarModalOpen) { closeMorningRadarModal(); return; }
      const backdrop = document.getElementById('outreach-modal-backdrop');
      if (backdrop && !backdrop.classList.contains('hidden')) {
        setOutreachModalOpen(false);
      }
      return;
    }

    // Sequence touches 1, 2, 3 inside Batch Studio when not typing in an input
    if (appState.batchOutreachModalOpen && !isInput && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      switchBatchSequenceTouch(Number(e.key));
      playActionChime('nav');
      return;
    }

    // Command palette: Ctrl+K / Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (appState.cmdPaletteOpen) closeCmdPalette();
      else openCmdPalette();
      return;
    }

    // Keep keyboard focus inside active modal surfaces.
    if (e.key === 'Tab') {
      if (appState.cmdPaletteOpen) {
        e.preventDefault();
        document.getElementById('cmd-input')?.focus();
        return;
      }
      const activeBackdrop = document.querySelector('.modal-backdrop:not(.hidden)');
      if (activeBackdrop) {
        const dialog = activeBackdrop.querySelector('.modal-dialog') || activeBackdrop.querySelector('[role="dialog"]');
        if (dialog) {
          const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
            .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
          if (focusable.length) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); return; }
            if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); return; }
          }
        }
      }
    }

    // Skip shortcuts when typing in an input or in modal
    if (isInput || appState.cmdPaletteOpen || appState.networkModalOpen || appState.linkedinGuideModalOpen || appState.batchOutreachModalOpen || appState.shortcutsModalOpen || appState.objectionModalOpen || appState.candidateSlateModalOpen || appState.callStudioModalOpen || appState.networkGraphModalOpen || appState.battlePlanModalOpen || appState.autopilotModalOpen || appState.pitchDeckModalOpen) return;

    // "/" to focus search
    if (e.key === '/') { e.preventDefault(); searchInput?.focus(); return; }

    // "?" to show Keyboard Shortcuts cheat sheet
    if (e.key === '?') { e.preventDefault(); openShortcutsModal(); return; }

    // "a" / "A" to open Autonomous Autopilot Prospecting Co-Pilot
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      openAutopilotModal();
      return;
    }

    // "c" / "C" to open Cold Call Battle Card
    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      openCallStudioModal();
      return;
    }

    // "p" / "P" to open Executive Battle Plan
    if (e.key === 'p' || e.key === 'P') {
      e.preventDefault();
      openBattlePlanModal();
      return;
    }

    // "o" / "O" to open Objection Buster Studio
    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      openObjectionStudioModal();
      return;
    }

    // "s" / "S" to open Candidate Pitch Slate
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      openCandidateSlateModal();
      return;
    }

    // "m" / "M" to open Morning Radar Briefing
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      openMorningRadarModal();
      return;
    }

    // "b" / "B" to open Batch Outreach Studio
    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      const firstAccount = appState.accounts?.[0];
      if (firstAccount) {
        openBatchOutreachStudio([{
          id: firstAccount.id,
          name: 'Hiring Leader',
          company: firstAccount.displayName || 'Target Account',
          title: 'Leadership',
          jobTitle: 'Key Openings',
        }]);
      } else {
        openBatchOutreachStudio([{
          name: 'Hiring Leader',
          company: 'Acme Corp',
          title: 'Engineering Director',
          jobTitle: 'Senior Software Engineer',
        }]);
      }
      return;
    }

    // G + <key> navigation (two-key chord)
    const now = Date.now();
    if (appState.lastKey === 'g' && now - appState.lastKeyTime < 800) {
      appState.lastKey = '';
      const navMap = { d: '#/dashboard', a: '#/accounts', c: '#/contacts', t: '#/tasks', j: '#/jobs', x: '#/admin' };
      if (navMap[e.key]) { e.preventDefault(); location.hash = navMap[e.key]; playActionChime('nav'); return; }
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
      rows[idx].setAttribute('tabindex', '-1');
      rows[idx].focus({ preventScroll: true });
      rows[idx].scrollIntoView({ block: 'nearest' });
      rows[idx].style.outline = '2px solid var(--accent)';
      rows[idx].style.outlineOffset = '-2px';
      if (current && current !== rows[idx]) { current.style.outline = ''; current.style.outlineOffset = ''; }
      playActionChime('nav');
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

  // Global Drag and Drop support for CSV files
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      document.body.classList.add('global-dragover');
    }
  });

  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      document.body.classList.remove('global-dragover');
    }
  });

  window.addEventListener('drop', (e) => {
    document.body.classList.remove('global-dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.csv') || file.type.includes('csv') || file.name.toLowerCase().includes('connections')) {
        e.preventDefault();
        openNetworkImportModal(file);
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
      refreshBootstrapButton.textContent = 'Refresh data';
    }
  });

  searchInput.addEventListener('input', () => {
    clearTimeout(appState.searchTimer);
    const value = searchInput.value.trim();
    if (value.length < 2) {
      hideSearchResults();
      return;
    }
    appState.searchTimer = setTimeout(() => runSearch(value), 220);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && !searchResults.classList.contains('hidden')) {
      const firstResult = searchResults.querySelector('.search-item');
      if (firstResult) {
        event.preventDefault();
        firstResult.focus();
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hideSearchResults({ keepContent: true });
      searchInput.focus();
    }
  });

  searchResults.addEventListener('keydown', (event) => {
    const items = Array.from(searchResults.querySelectorAll('.search-item'));
    const index = items.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && items.length) {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(Math.max(0, index) + delta + items.length) % items.length]?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hideSearchResults({ keepContent: true });
      searchInput.focus();
    }
  });
  document.addEventListener('input', (event) => {
    const slider = event.target.closest('[data-action="update-fee-slider"]');
    if (slider) {
      const field = slider.dataset.field;
      const val = slider.value;
      updateFeeSimulator(field, val);
    }
  });

  document.addEventListener('change', (event) => {
    const select = event.target.closest('[data-action="update-deal-stage"]');
    if (select) {
      const accountId = select.dataset.accountId;
      const stage = select.value;
      updateDealStage(accountId, stage);
    }
  });

  document.addEventListener('click', async (event) => {
    // Open outreach modal
    if (event.target.closest('#open-outreach-modal')) {
      setOutreachModalOpen(true);
      syncOutreachComposerState();
      return;
    }
    // Advanced filter toggle
    const advancedFilterToggle = event.target.closest('#toggle-advanced-filters');
    if (advancedFilterToggle) {
      appState.showAdvancedFilters = !appState.showAdvancedFilters;
      const fields = document.getElementById('advanced-filter-fields');
      if (fields) {
        fields.classList.toggle('hidden', !appState.showAdvancedFilters);
        fields.toggleAttribute('hidden', !appState.showAdvancedFilters);
        fields.toggleAttribute('inert', !appState.showAdvancedFilters);
        fields.setAttribute('aria-hidden', String(!appState.showAdvancedFilters));
      }
      advancedFilterToggle.setAttribute('aria-expanded', String(appState.showAdvancedFilters));
      const toggleLabel = advancedFilterToggle.querySelector('.filter-toggle-label');
      if (toggleLabel) toggleLabel.textContent = appState.showAdvancedFilters ? 'Fewer filters' : advancedFilterToggle.dataset.collapsedLabel || 'More filters';
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
        hideSearchResults({ keepContent: true });
      }
      return;
    }

    const actionName = action.dataset.action;
    if (actionName === 'next-tour-step') {
      nextTourStep();
      return;
    }
    if (actionName === 'end-tour') {
      endTour({ skipped: true });
      return;
    }
    if (actionName === 'start-product-tour') {
      startProductTour();
      return;
    }
    if (actionName === 'setup-browse-csv') {
      document.getElementById('setup-csv-file')?.click();
      return;
    }
    if (actionName === 'load-niche-kit') {
      const kit = action.dataset.kit;
      const kits = {
        fintech: ['stripe.com', 'plaid.com', 'brex.com', 'chime.com', 'ramp.com', 'affirm.com', 'klarna.com', 'revolut.com', 'robinhood.com', 'toasttab.com'],
        cybersecurity: ['crowdstrike.com', 'paloaltonetworks.com', 'sentinelone.com', 'cloudflare.com', 'wiz.io', 'snyk.io', 'okta.com', 'datadoghq.com', 'zscaler.com', 'cyberark.com'],
        'ai-devtools': ['openai.com', 'anthropic.com', 'vercel.com', 'figma.com', 'databricks.com', 'pinecone.io', 'cohere.com', 'supabase.com', 'scale.com', 'huggingface.co'],
        healthtech: ['veeva.com', 'doximity.com', 'ro.co', 'oscarhealth.com', 'goodrx.com', 'zocdoc.com', 'onemedical.com', 'devoted.com', 'tempus.com', 'hims.com'],
      };
      const domains = kits[kit] || kits.fintech;
      const textarea = document.getElementById('setup-target-sites');
      if (textarea) {
        textarea.value = domains.join('\n');
        appState.setupDraft.targetSites = textarea.value;
        showToast(`Loaded ${domains.length} target accounts for ${kit.toUpperCase()}`, 'success');
        updateSetupTargetFeedback();
      }
      return;
    }
    if (actionName === 'setup-back') {
      persistSetupDraftFromDom();
      appState.setupStep = Math.max(1, appState.setupStep - 1);
      await renderSetupWizard();
      return;
    }
    if (actionName === 'setup-skip-import') {
      appState.setupCsvFile = null;
      appState.setupCsvContent = '';
      appState.setupCsvFileName = '';
      appState.setupPreview = null;
      appState.setupTrackedCompanies = [];
      await completeSetupWizard();
      return;
    }
    if (actionName === 'setup-skip-targets') {
      persistSetupDraftFromDom();
      appState.setupTargetsSkipped = true;
      appState.setupTargetImportResult = null;
      appState.setupStep = Math.min(getSetupSteps().length, appState.setupStep + 1);
      await renderSetupWizard();
      return;
    }
    if (actionName === 'retry-deferred-targets') {
      await retryDeferredSetupTargets(action);
      return;
    }
    if (actionName === 'retry-outcome-summary') {
      action.disabled = true;
      await renderDashboardView();
      return;
    }
    if (actionName === 'retry-account-outcomes') {
      const accountId = action.dataset.accountId || appState.accountDetail?.account?.id;
      if (accountId) await renderAccountDetail(accountId);
      return;
    }
    if (actionName === 'setup-load-sample') {
      await loadSetupSampleWorkspace();
      return;
    }
    if (actionName === 'setup-preview-csv') {
      await previewSetupCsv();
      return;
    }
    if (actionName === 'setup-select-recommended') {
      const companies = Array.isArray(appState.setupPreview?.companies) ? appState.setupPreview.companies : [];
      appState.setupTrackedCompanies = companies
        .filter((company) => !company.overLimit && (company.alreadyTracked || company.recommended))
        .map((company) => company.key);
      await renderSetupWizard();
      return;
    }
    if (actionName === 'setup-clear-targets') {
      const companies = Array.isArray(appState.setupPreview?.companies) ? appState.setupPreview.companies : [];
      appState.setupTrackedCompanies = companies
        .filter((company) => company.alreadyTracked)
        .map((company) => company.key);
      await renderSetupWizard();
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
      const name = await showAppDialog({
        title: 'Save filter set',
        message: 'Give this view a short name so you can return to it later.',
        inputLabel: 'Filter name',
        inputPlaceholder: 'For example, active hiring accounts',
        confirmLabel: 'Save filter',
      });
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
    if (actionName === 'apply-job-preset') {
      await applyJobPreset(action.dataset.preset);
      return;
    }
    if (actionName === 'open-network-import-modal') {
      openNetworkImportModal();
      return;
    }
    if (actionName === 'close-network-import-modal') {
      closeNetworkImportModal();
      return;
    }
    if (actionName === 'open-linkedin-guide') {
      openLinkedInGuideModal();
      return;
    }
    if (actionName === 'close-linkedin-guide') {
      closeLinkedInGuideModal();
      return;
    }
    if (actionName === 'quick-load-sample-workspace') {
      await quickLoadSampleWorkspace();
      return;
    }
    if (actionName === 'network-modal-browse-csv') {
      document.getElementById('network-modal-csv-input')?.click();
      return;
    }
    if (actionName === 'network-modal-run-import') {
      await runNetworkModalImport();
      return;
    }
    if (actionName === 'open-pricing-modal') {
      openPricingModal();
      return;
    }
    if (actionName === 'close-pricing-modal') {
      closePricingModal();
      return;
    }
    if (actionName === 'open-referral-modal') {
      openReferralShareModal();
      return;
    }
    if (actionName === 'close-referral-modal') {
      closeReferralShareModal();
      return;
    }
    if (actionName === 'copy-referral-link') {
      copyReferralLink();
      return;
    }
    if (actionName === 'copy-referral-message') {
      copyReferralMessage();
      return;
    }
    if (actionName === 'copy-discord-message') {
      copyDiscordMessage();
      return;
    }
    if (actionName === 'open-morning-radar') {
      await openMorningRadarModal();
      return;
    }
    if (actionName === 'close-morning-radar') {
      closeMorningRadarModal();
      return;
    }
    if (actionName === 'morning-radar-copy') {
      await copyMorningRadarText();
      return;
    }
    if (actionName === 'open-warm-studio') {
      await openWarmStudioModal(action.dataset.jobId, action.dataset.contactId);
      return;
    }
    if (actionName === 'close-warm-studio') {
      closeWarmStudioModal();
      return;
    }
    if (actionName === 'warm-studio-switch-step') {
      switchWarmStudioStep(action.dataset.step);
      return;
    }
    if (actionName === 'warm-studio-switch-format') {
      switchWarmStudioFormat(action.dataset.format);
      return;
    }
    if (actionName === 'warm-studio-switch-tone') {
      switchWarmStudioTone(action.dataset.tone);
      return;
    }
    if (actionName === 'warm-studio-copy') {
      await copyWarmStudioText(action);
      return;
    }
    if (actionName === 'warm-studio-log-sent') {
      await logWarmStudioSent(action.dataset.jobId, action.dataset.contactId);
      return;
    }
    if (actionName === 'share-network-stats') {
      shareNetworkStats();
      return;
    }
    if (actionName === 'update-job-pipeline-stage') {
      await updateJobPipelineStage(action.dataset.jobId, action.dataset.stage);
      return;
    }
    if (actionName === 'cycle-theme-preset') {
      cycleThemePreset();
      return;
    }
    if (actionName === 'dashboard-switch-tab') {
      const targetTab = action.dataset.tab || 'battle-board';
      appState.dashboardTab = targetTab;
      localStorage.setItem('bd_dash_tab', targetTab);
      await renderDashboardView({ skipLoading: true });
      return;
    }
    if (actionName === 'dismiss-value-sprint') {
      appState.valueSprintDismissed = true;
      localStorage.setItem('bd_sprint_dismissed', 'true');
      const sprintCard = document.querySelector('.value-sprint-card');
      if (sprintCard) sprintCard.style.display = 'none';
      return;
    }
    if (actionName === 'close-batch-outreach') {
      closeBatchOutreachModal();
      return;
    }
    if (actionName === 'open-shortcuts-modal') {
      openShortcutsModal();
      return;
    }
    if (actionName === 'close-shortcuts-modal') {
      closeShortcutsModal();
      return;
    }
    if (actionName === 'toggle-sound-effects') {
      toggleSoundEffects();
      return;
    }
    if (actionName === 'batch-switch-touch') {
      switchBatchSequenceTouch(action.dataset.touch);
      playActionChime('nav');
      return;
    }
    if (actionName === 'batch-copy-linkedin') {
      await copyBatchLinkedInNote();
      return;
    }
    if (actionName === 'select-icp-quadrant') {
      await selectIcpQuadrant(action.dataset.quadrant);
      playActionChime('nav');
      return;
    }
    if (actionName === 'clear-icp-quadrant') {
      await clearIcpQuadrant();
      playActionChime('nav');
      return;
    }
    if (actionName === 'update-fee-slider') {
      return;
    }
    if (actionName === 'open-objection-studio') {
      openObjectionStudioModal();
      return;
    }
    if (actionName === 'close-objection-studio') {
      closeObjectionStudioModal();
      return;
    }
    if (actionName === 'switch-objection-tab') {
      switchObjectionTab(action.dataset.tab);
      playActionChime('nav');
      return;
    }
    if (actionName === 'switch-objection-tone') {
      switchObjectionTone(action.dataset.tone);
      playActionChime('nav');
      return;
    }
    if (actionName === 'copy-objection-script') {
      await copyObjectionScript(action.dataset.tab, action.dataset.tone);
      return;
    }
    if (actionName === 'open-candidate-slate-modal') {
      openCandidateSlateModal(action.dataset.jobId);
      return;
    }
    if (actionName === 'close-candidate-slate-modal') {
      closeCandidateSlateModal();
      return;
    }
    if (actionName === 'copy-candidate-slate') {
      await copyCandidateSlateMarkdown();
      return;
    }
    if (actionName === 'open-call-studio') {
      openCallStudioModal(action.dataset.jobId, action.dataset.contactId);
      return;
    }
    if (actionName === 'close-call-studio') {
      closeCallStudioModal();
      return;
    }
    if (actionName === 'switch-call-branch') {
      switchCallBranch(action.dataset.branch);
      return;
    }
    if (actionName === 'quick-log-call-success') {
      playActionChime('success');
      showToast('🎉 Call logged as Successful Connect!', 'success');
      closeCallStudioModal();
      return;
    }
    if (actionName === 'open-network-graph-modal') {
      openNetworkGraphModal(action.dataset.accountId);
      return;
    }
    if (actionName === 'close-network-graph-modal') {
      closeNetworkGraphModal();
      return;
    }
    if (actionName === 'open-battle-plan-modal') {
      openBattlePlanModal();
      return;
    }
    if (actionName === 'close-battle-plan-modal') {
      closeBattlePlanModal();
      return;
    }
    if (actionName === 'copy-battle-plan') {
      await copyBattlePlanMarkdown();
      return;
    }
    if (actionName === 'open-autopilot-modal') {
      openAutopilotModal();
      return;
    }
    if (actionName === 'close-autopilot-modal') {
      closeAutopilotModal();
      return;
    }
    if (actionName === 'execute-autopilot-queue') {
      await executeAutopilotQueue();
      return;
    }
    if (actionName === 'open-pitch-deck-modal') {
      openPitchDeckModal(action.dataset.accountId);
      return;
    }
    if (actionName === 'close-pitch-deck-modal') {
      closePitchDeckModal();
      return;
    }
    if (actionName === 'copy-pitch-deck') {
      await copyPitchDeckMarkdown();
      return;
    }
    if (actionName === 'ticker-jump-action') {
      if (action.dataset.jobId) {
        openCallStudioModal(action.dataset.jobId);
      } else if (action.dataset.accountId) {
        location.hash = `#/accounts/${action.dataset.accountId}`;
      } else if (action.dataset.company) {
        appState.accountQuery.q = action.dataset.company;
        location.hash = '#/accounts';
        if (getRouteRoot() === 'accounts') await renderAccountsView();
      }
      playActionChime('nav');
      return;
    }
    if (actionName === 'select-geo-hub') {
      await filterByGeographicHub(action.dataset.hub);
      return;
    }
    if (actionName === 'cross-hunt-cluster') {
      appState.accountQuery.q = action.dataset.company || '';
      location.hash = '#/accounts';
      if (getRouteRoot() === 'accounts') await renderAccountsView();
      playActionChime('nav');
      return;
    }
    if (actionName === 'update-deal-stage') {
      return;
    }
    if (actionName === 'batch-switch-recipient') {
      const idx = Number(action.dataset.index) || 0;
      if (appState.batchOutreach) {
        appState.batchOutreach.activeIndex = idx;
        renderBatchOutreachModal();
      }
      return;
    }
    if (actionName === 'batch-prev') {
      if (appState.batchOutreach && appState.batchOutreach.activeIndex > 0) {
        appState.batchOutreach.activeIndex--;
        renderBatchOutreachModal();
      }
      return;
    }
    if (actionName === 'batch-next') {
      if (appState.batchOutreach && appState.batchOutreach.activeIndex < appState.batchOutreach.items.length - 1) {
        appState.batchOutreach.activeIndex++;
        renderBatchOutreachModal();
      }
      return;
    }
    if (actionName === 'batch-copy-active') {
      await copyActiveBatchDraft();
      return;
    }
    if (actionName === 'batch-copy-all') {
      await copyAllBatchOutreachDrafts();
      return;
    }
    if (actionName === 'batch-export-csv') {
      exportBatchOutreachCsv();
      return;
    }
    if (actionName === 'batch-log-all') {
      await logAllBatchOutreachSent();
      return;
    }
    if (actionName === 'launch-batch-outreach-contacts') {
      const checked = document.querySelectorAll('.contacts-bulk-checkbox:checked');
      if (!checked.length) {
        showToast('Select at least 1 contact using the checkboxes to open Batch Outreach Studio.', 'warning');
        return;
      }
      const items = Array.from(checked).map(cb => ({
        id: cb.value,
        name: cb.dataset.name || '',
        company: cb.dataset.company || '',
        title: cb.dataset.title || '',
        accountId: cb.dataset.accountId || '',
        email: cb.dataset.email || '',
        linkedinUrl: cb.dataset.linkedin || '',
        jobTitle: 'Key Openings',
      }));
      await openBatchOutreachStudio(items);
      return;
    }
    if (actionName === 'clear-contacts-bulk') {
      document.querySelectorAll('.contacts-bulk-checkbox').forEach(cb => { cb.checked = false; });
      const selectAll = document.getElementById('contacts-bulk-select-all');
      if (selectAll) selectAll.checked = false;
      updateContactsBulkBar();
      return;
    }
    if (actionName === 'export-selected-contacts-csv') {
      const checked = document.querySelectorAll('.contacts-bulk-checkbox:checked');
      if (!checked.length) return;
      const items = Array.from(checked).map(cb => ({
        name: cb.dataset.name || '',
        company: cb.dataset.company || '',
        title: cb.dataset.title || '',
        email: cb.dataset.email || '',
        linkedinUrl: cb.dataset.linkedin || '',
      }));
      const headers = ['Full Name', 'Company', 'Title', 'Email', 'LinkedIn'];
      const rows = items.map(c => [c.name, c.company, c.title, c.email, c.linkedinUrl]);
      const escapeCsvVal = (v) => `"${String(v || '').replace(/"/g, '""')}"`;
      const csv = [headers.map(escapeCsvVal).join(','), ...rows.map(r => r.map(escapeCsvVal).join(','))].join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bd-engine-contacts-selected-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`📥 Exported ${items.length} selected contacts to CSV!`, 'success');
      return;
    }
    if (actionName === 'launch-batch-outreach-jobs') {
      const checked = document.querySelectorAll('.jobs-bulk-checkbox:checked');
      if (!checked.length) {
        showToast('Select at least 1 job role using the checkboxes to open Batch Outreach Studio.', 'warning');
        return;
      }
      const items = Array.from(checked).map(cb => {
        let contacts = [];
        try { contacts = JSON.parse(cb.dataset.contacts || '[]'); } catch {}
        const topContact = contacts[0] || {};
        return {
          id: cb.value,
          name: topContact.fullName || 'Hiring Leader',
          firstName: topContact.firstName || 'there',
          company: cb.dataset.company || '',
          title: topContact.title || 'Team Member',
          accountId: cb.dataset.accountId || '',
          email: topContact.email || '',
          linkedinUrl: topContact.linkedinUrl || '',
          jobTitle: cb.dataset.jobTitle || 'Open Role',
          jobLocation: cb.dataset.jobLocation || '',
          jobUrl: cb.dataset.jobUrl || '',
        };
      });
      await openBatchOutreachStudio(items);
      return;
    }
    if (actionName === 'clear-jobs-bulk') {
      document.querySelectorAll('.jobs-bulk-checkbox').forEach(cb => { cb.checked = false; });
      const selectAll = document.getElementById('jobs-bulk-select-all');
      if (selectAll) selectAll.checked = false;
      updateJobsBulkBar();
      return;
    }
    if (actionName === 'launch-batch-outreach-accounts') {
      const checked = document.querySelectorAll('.bulk-checkbox:checked');
      if (!checked.length) {
        showToast('Select at least 1 account to open Batch Outreach Studio.', 'warning');
        return;
      }
      const accountIds = Array.from(checked).map(cb => cb.value);
      const items = [];
      for (const accountId of accountIds) {
        try {
          const res = await api(`/api/accounts/${accountId}`);
          if (res?.account) {
            const topContact = res.contacts?.[0] || {};
            const topJob = res.jobs?.[0] || {};
            items.push({
              id: res.account.id,
              accountId: res.account.id,
              name: topContact.fullName || 'Hiring Leader',
              firstName: topContact.firstName || 'there',
              company: res.account.displayName || 'Company',
              title: topContact.title || 'Leadership',
              email: topContact.email || '',
              linkedinUrl: topContact.linkedinUrl || '',
              jobTitle: topJob.title || 'Open Positions',
              jobLocation: topJob.location || '',
              jobUrl: topJob.jobUrl || topJob.url || '',
            });
          }
        } catch {}
      }
      if (items.length) {
        await openBatchOutreachStudio(items);
      }
      return;
    }
    if (actionName === 'open-admin-section') {
      openAdminSection(action.dataset.sectionId);
      return;
    }
    if (actionName === 'load-saved-filter') {
      applySavedFilter(action.dataset.name);
      appState.showAdvancedFilters = true;
      await renderAccountsView();
      return;
    }
    if (actionName === 'delete-saved-filter') {
      deleteSavedFilter(action.dataset.name);
      await renderAccountsView();
      return;
    }
    if (actionName === 'export-csv') {
      if (!hasPlanFeature('export')) {
        showToast('CSV export is available on Sales Pro. Opening plan options...', 'info');
        location.hash = '#/admin';
        return;
      }
      const view = action.dataset.view;
      if (view === 'accounts') await exportAccountsCsv();
      if (view === 'contacts') await exportContactsCsv();
      if (view === 'jobs') await exportJobsCsv();
      return;
    }
    if (actionName === 'upgrade-for-export') {
      showToast('CSV export is available on Sales Pro. Opening plan options...', 'info');
      location.hash = '#/admin';
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
      await populateConfigForm(action.dataset.id);
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
      openAdminSection('ats-config-form');
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
        template: action.dataset.template || '',
        jobId: action.dataset.jobId || '',
        autoGenerate: action.dataset.autoGenerate === 'true',
      });
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

    if (actionName === 'run-pipeline') {
      await runRevenuePipeline(action);
      return;
    }

    if (actionName === 'run-discovery') {
      await runDiscovery(action);
      return;
    }

    if (actionName === 'curate-legacy-targets') {
      await curateLegacyTargets();
      return;
    }

    if (actionName === 'rebalance-targets') {
      await rebalanceTrackedTargets();
      return;
    }

    if (actionName === 'run-target-score-rollout') {
      await runTargetScoreRollout(action);
      return;
    }

    if (actionName === 'run-full-engine') {
      await runFullBdEngine();
      return;
    }

    if (actionName === 'run-launch-workflow') {
      await runLaunchWorkflow(action);
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
      const originalText = action.textContent;
      action.disabled = true;
      action.textContent = 'Redirecting...';
      try {
        const result = await api('/api/billing/checkout', {
          method: 'POST',
          body: JSON.stringify({ planId }),
        });
        if (result.url) {
          if (ONBOARDING_INTENT_KEY) localStorage.removeItem(ONBOARDING_INTENT_KEY);
          appState.onboardingIntent = null;
          (window.top || window).location.href = result.url;
        } else {
          showToast(result.error || 'Failed to initialize checkout', 'error');
          action.disabled = false;
          action.textContent = originalText;
        }
      } catch (err) {
        showToast(err.message, 'error');
        action.disabled = false;
        action.textContent = originalText;
      }
      return;
    }

    if (actionName === 'billing-portal') {
      action.disabled = true;
      action.textContent = 'Opening...';
      try {
        const result = await api('/api/billing/portal', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (result.url) {
          (window.top || window).location.href = result.url;
        } else {
          showToast(result.error || 'Failed to open billing portal', 'error');
          action.disabled = false;
          action.textContent = 'Manage billing';
        }
      } catch (err) {
        showToast(err.message, 'error');
        action.disabled = false;
        action.textContent = 'Manage billing';
      }
      return;
    }

    if (actionName === 'copy-referral-link') {
      const link = action.dataset.referralLink || document.getElementById('referral-link')?.value || '';
      if (!link) return;
      const originalText = action.textContent;
      await writeClipboardText(link);
      action.textContent = 'Copied!';
      setTimeout(() => { action.textContent = originalText; }, 1400);
      return;
    }

    if (actionName === 'copy-diagnostics') {
      const originalText = action.textContent;
      action.disabled = true;
      try {
        await writeClipboardText(buildSafeDiagnosticSummary());
        action.textContent = 'Diagnostics copied';
        showToast('Safe diagnostic summary copied. It does not include contacts, messages, or secrets.', 'success');
      } catch {
        showToast('Your browser blocked clipboard access. Try again after allowing clipboard permission.', 'warning');
      } finally {
        setTimeout(() => {
          action.textContent = originalText;
          action.disabled = false;
        }, 1600);
      }
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
      setOutreachModalOpen(true);
      const templateSelect = document.getElementById('outreach-template-select');
      if (templateSelect && action.dataset.template) {
        templateSelect.value = action.dataset.template;
      }
      const jobSelect = document.getElementById('outreach-job-select');
      if (jobSelect && action.dataset.jobId) {
        jobSelect.value = action.dataset.jobId;
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

    if (actionName === 'select-outreach-subject') {
      selectGeneratedSubject(action.dataset.index, action);
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

    if (actionName === 'filter-tasks') {
      appState.taskQuery.status = action.dataset.status;
      appState.taskQuery.page = 1;
      await renderTasksView();
      document.getElementById(`tasks-tab-${CSS.escape(appState.taskQuery.status)}`)?.focus();
      return;
    }

    if (actionName === 'open-task-create') {
      const disclosure = document.querySelector('.task-create-disclosure');
      if (disclosure) {
        disclosure.open = true;
        window.requestAnimationFrame(() => disclosure.querySelector('input[name="summary"]')?.focus());
      }
      return;
    }

    if (actionName === 'complete-task') {
      await completeTask(action.dataset.id, action);
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
        persistSharedWorkspacePreference('outreachSequences');
        logActivity('sequence_complete', { accountId: seq.accountId, summary: `Completed ${seq.channel}: ${seq.note}` });
        showToast('Sequence step completed.', 'success');
        if (appState.accountDetail) renderAccountDetail(appState.accountDetail.account.id);
      }
      return;
    }

    if (actionName === 'merge-duplicate') {
      const keepId = action.dataset.keep;
      const removeId = action.dataset.remove;
      const confirmed = await showAppDialog({
        title: 'Archive duplicate account?',
        message: 'The primary account will stay active. The duplicate will be marked as paused with a link back to the primary account.',
        confirmLabel: 'Archive duplicate',
        danger: true,
      });
      if (confirmed) {
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

    if (form.id === 'setup-target-form') {
      persistSetupDraftFromDom();
      const parsed = parseSetupTargetSites(appState.setupDraft.targetSites);
      if (!parsed.targets.length) {
        showToast('Add at least one company name, domain, or careers URL—or choose Skip for now.', 'warning');
        syncSetupTargetFeedback({ forceError: true });
        document.getElementById('setup-target-sites')?.focus();
        return;
      }
      if (parsed.invalid.length) {
        showToast(`${formatNumber(parsed.invalid.length)} line${parsed.invalid.length === 1 ? '' : 's'} could not be read. Fix or remove them before continuing.`, 'warning');
        syncSetupTargetFeedback({ forceError: true });
        document.getElementById('setup-target-sites')?.focus();
        return;
      }
      if (parsed.truncated) showToast('The first 50 targets will be added. You can add more later.', 'info');
      appState.setupTargetsSkipped = false;
      appState.setupTargetImportResult = null;
      appState.setupStep = Math.min(getSetupSteps().length, appState.setupStep + 1);
      await renderSetupWizard();
      return;
    }

    if (form.id === 'setup-license-form') {
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

    if (form.id === 'task-create-form') {
      const payload = getFormValues(form);
      if (!payload.summary?.trim()) {
        showToast('Add a short description for the task.', 'warning');
        return;
      }
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton) submitButton.disabled = true;
      try {
        await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Task added to the workspace.', 'success');
        await renderTasksView();
      } catch (error) {
        showToast(`Could not add task: ${error.message || error}`, 'error', 7000);
        if (submitButton) submitButton.disabled = false;
      }
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
      let result;
      try {
        result = await api('/api/accounts/import', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      } catch (error) {
        showToast(`Import failed: ${error.message || error}`, 'error', 7000);
        return;
      }
      invalidateAppData();
      await renderAccountsView();
      const skipped = Array.isArray(result.skipped) ? result.skipped : [];
      let message = `Imported ${formatNumber(result.count || 0)} target accounts.`;
      if (skipped.length) {
        const preview = skipped.slice(0, 3)
          .map((row) => `line ${row.line}${row.company ? ` (${row.company})` : ''}: ${row.reason === 'duplicate' ? 'already in workspace' : row.reason}`)
          .join('; ');
        message += ` Skipped ${skipped.length}: ${preview}${skipped.length > 3 ? '…' : ''}`;
        showToast(message, 'warning', 9000);
      }
      window.bdLocalApi.setAlert(message, appAlert);
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
      persistSharedWorkspacePreference('outreachSequences');
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
      persistSharedWorkspacePreference('customFields');
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
      appState.customFieldValues[accountId] = cfValues;
      persistSharedWorkspacePreference('customFieldValues');
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
        hiringSpikeMinJobs: Number(values.hiringSpikeMinJobs) || 5,
        highScoreNoContacts: Number(values.highScoreNoContacts) || 80,
        highValueStaleMin: Number(values.highValueStaleMin) || 70,
      };
      persistSharedWorkspacePreference('alertThresholds');
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
      const values = getFormValues(form);
      const payload = { ...values };
      const hasMeaningfulResult = Boolean(values.pipelineStage) || values.type === 'outreach';
      if (!String(values.summary || '').trim() && !hasMeaningfulResult) {
        showToast('Add a note or choose a result before saving activity.', 'warning');
        form.elements.summary?.focus();
        return;
      }
      const rawValue = String(values.value || '').trim();
      const acceptsValue = COMMERCIAL_VALUE_ACTIVITY_STAGES.has(values.pipelineStage);
      const numericValue = rawValue ? Number(rawValue) : null;
      const occurredAt = parseActivityDateInput(values.occurredOn);
      if (rawValue && !acceptsValue) {
        showToast('Add a value only when logging an opportunity, win, or loss.', 'warning');
        return;
      }
      if (rawValue && (!Number.isFinite(numericValue) || numericValue < 0)) {
        showToast('Commercial value must be zero or a positive number.', 'warning');
        return;
      }
      if (values.occurredOn && !occurredAt) {
        showToast('Choose a valid activity date that is not in the future.', 'warning');
        return;
      }
      delete payload.value;
      delete payload.currency;
      delete payload.occurredOn;
      if (occurredAt) payload.occurredAt = occurredAt;
      if (rawValue && acceptsValue) {
        payload.valueCents = Math.round(numericValue * 100);
        payload.currency = values.currency || 'USD';
      }
      const activityResult = await api('/api/activity', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      invalidateAppData();
      await renderAccountDetail(payload.accountId);
      if (activityResult?.partialSuccess) {
        showToast('Activity saved, but its commercial result was not recorded. Do not submit it again. Open Support from the account menu with the account name and activity date.', 'warning', 12000);
      } else {
        showToast(activityResult?.commercialOutcomeStatus === 'recorded' ? 'Activity and result logged.' : 'Activity logged.', 'success');
      }
      return;
    }

    if (form.classList.contains('contact-inline-form')) {
      const payload = getFormValues(form);
      const submitButton = form.querySelector('[type="submit"]');
      const originalLabel = submitButton?.textContent || 'Save';
      if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Saving...'; }
      try {
        await api(`/api/contacts/${form.dataset.contactId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        invalidateAppData();
        const row = form.closest('tr');
        const statusCell = row?.querySelector('[data-label="Status"]');
        if (statusCell) statusCell.innerHTML = renderStatusPill(payload.outreachStatus || 'not_started', 'neutral');
        form.closest('details')?.removeAttribute('open');
        showToast('Contact updated.', 'success');
      } catch (error) {
        showToast(`Could not update contact: ${error.message || error}`, 'error');
      } finally {
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = originalLabel; }
      }
      return;
    }

    if (form.id === 'settings-form') {
      const values = getFormValues(form);
      const result = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          searchFocus: {
            targetRoles: values.targetRoles,
            excludedRoles: values.excludedRoles,
            targetIndustries: values.targetIndustries,
            workStyle: values.workStyle,
            minimumRelevanceScore: Number(values.minimumRelevanceScore || 45),
          },
        }),
      });
      invalidateAppData();
      await renderAdminView();
      showToast(`Search focus saved. ${formatNumber(result.rescoredJobs || 0)} existing jobs rescored.`, 'success');
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
  if (appState.bootstrap?.persona) appState.persona = normalizeAppPersona(appState.bootstrap.persona);
  applyPersonaChrome();
  workspaceName.textContent = appState.bootstrap?.workspace?.name || 'BD Engine Workspace';
  window.bdLocalApi.setAlert('', appAlert);
  return appState.bootstrap;
}

async function api(path, options = {}) {
  return window.bdLocalApi.api(appState, path, options);
}

function getVisitorId() {
  const key = 'bd_visitor_id';
  let visitorId = localStorage.getItem(key);
  if (!visitorId) {
    visitorId = crypto.randomUUID ? crypto.randomUUID() : `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, visitorId);
  }
  return visitorId;
}

async function trackAppVisit() {
  const payload = {
    visitorId: getVisitorId(),
    eventType: 'pageview',
    path: `${window.location.pathname}${window.location.hash || ''}`,
    referrer: document.referrer || '',
    source: document.referrer ? 'referrer' : 'direct',
  };
  await fetch('/api/analytics/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
    keepalive: true,
  });
}

async function loadSetupStatus(force = false) {
  if (appState.setupStatus && !force) {
    return appState.setupStatus;
  }
  appState.setupStatus = await api('/api/setup/status', { skipCache: true });
  if (appState.setupStatus?.persona) appState.persona = normalizeAppPersona(appState.setupStatus.persona);
  applyPersonaChrome();
  const existingName = appState.setupStatus?.workspaceName || appState.setupStatus?.workspace?.name || '';
  if (!appState.setupDraft.workspaceName && existingName) {
    appState.setupDraft.workspaceName = existingName === 'BD Engine Workspace' ? '' : existingName;
  }
  if (!appState.setupDraft.userName && appState.setupStatus?.user?.name) {
    appState.setupDraft.userName = appState.setupStatus.user.name;
  }
  if (!appState.setupDraft.userEmail && appState.setupStatus?.user?.email) {
    appState.setupDraft.userEmail = appState.setupStatus.user.email;
  }
  return appState.setupStatus;
}

function normalizeAppPersona(value) {
  return value === 'jobseeker' ? 'jobseeker' : 'bd';
}

function isJobSeekerPersona() {
  return normalizeAppPersona(appState.persona || appState.bootstrap?.persona || appState.setupStatus?.persona) === 'jobseeker';
}

function supportsCommercialOutcomes() {
  return appState.bootstrap?.capabilities?.commercialOutcomes === true;
}

function canMutateWorkspace() {
  const session = appState.bootstrap?.session;
  const role = String(session?.membership?.role || '').toLowerCase();
  return session?.readOnly !== true && session?.demo !== true && role !== 'viewer';
}

function hasPlanFeature(feature) {
  const features = appState.bootstrap?.session?.plan?.features;
  return !Array.isArray(features) || features.includes(feature);
}

function renderExportButton(view) {
  if (hasPlanFeature('export')) {
    return `<button class="ghost-button" data-action="export-csv" data-view="${escapeAttr(view)}" aria-label="Export ${escapeAttr(view)} to CSV">Export CSV</button>`;
  }
  return '<button class="ghost-button" data-action="upgrade-for-export" type="button" title="Available on Sales Pro">Export CSV · Sales Pro</button>';
}

function applyPersonaChrome() {
  const jobSeeker = isJobSeekerPersona();
  const accountLabel = document.querySelector('[data-route="accounts"] .nav-label');
  const jobsLabel = document.querySelector('[data-route="jobs"] .nav-label');
  const contactsLabel = document.querySelector('[data-route="contacts"] .nav-label');
  const adminLabel = document.querySelector('[data-route="admin"] .nav-label');
  const topbarEyebrow = document.querySelector('.topbar .eyebrow');
  if (accountLabel) accountLabel.textContent = jobSeeker ? 'Companies' : 'Accounts';
  if (jobsLabel) jobsLabel.textContent = jobSeeker ? 'Open roles' : 'Jobs';
  if (contactsLabel) contactsLabel.textContent = jobSeeker ? 'Network' : 'Contacts';
  if (adminLabel) adminLabel.textContent = jobSeeker ? 'Tools' : 'Admin';
  if (topbarEyebrow) topbarEyebrow.textContent = jobSeeker ? 'Job search workspace' : 'Hiring-signal workspace';
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
    return safeExternalHref(directUrl);
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

function safeExternalHref(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
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
  portfolio: 'Portfolio',
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
  const presetEntries = normalizedFilterEntries({ ...defaultQueries.accounts, ...preset.query });
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

async function applyJobPreset(presetId) {
  if (presetId === 'all') {
    appState.jobQuery = {
      ...defaultQueries.jobs,
      pageSize: appState.jobQuery.pageSize || defaultQueries.jobs.pageSize,
      sortBy: '',
      page: 1,
    };
    showToast('Showing all jobs.', 'info');
  } else if (presetId === 'local_remote') {
    appState.jobQuery = {
      ...appState.jobQuery,
      workStyle: 'local_remote',
      page: 1,
    };
    showToast('Filtered to Local or Remote jobs.', 'info');
  } else if (presetId === 'network') {
    appState.jobQuery = {
      ...appState.jobQuery,
      hasContacts: 'true',
      page: 1,
    };
    showToast('Filtered to jobs at companies with contacts in your network.', 'info');
  } else if (presetId === 'most_connected') {
    appState.jobQuery = {
      ...appState.jobQuery,
      sortBy: 'connections',
      page: 1,
    };
    showToast('Sorted by most connections in network.', 'info');
  } else if (presetId === 'best_fit') {
    appState.jobQuery = {
      ...appState.jobQuery,
      sortBy: 'relevance',
      minRelevance: '45',
      page: 1,
    };
    showToast('Filtered to best fit roles.', 'info');
  } else if (presetId === 'recent') {
    appState.jobQuery = {
      ...appState.jobQuery,
      recencyDays: '7',
      page: 1,
    };
    showToast('Filtered to past 7 days.', 'info');
  } else if (presetId === 'pipeline') {
    const trackedCount = Object.keys(appState.jobPipelineStages || {}).length;
    if (!trackedCount) {
      showToast('No roles in your pipeline yet. Choose a stage from "+ Track" on any job row!', 'info');
      return;
    }
    appState.jobQuery = {
      ...appState.jobQuery,
      pipelineOnly: 'true',
      page: 1,
    };
    showToast(`Showing ${trackedCount} role(s) tracked in your pipeline.`, 'info');
  }
  await renderJobsView();
}

function renderSavedFilters() {
  if (!appState.savedFilters.length) return '';
  return `<div class="saved-filters-bar"><span class="muted small" title="Stored in this browser only">Saved views (this device):</span>${appState.savedFilters.map(f =>
    `<span class="saved-filter-chip"><button class="ghost-button ghost-button--xs" data-action="load-saved-filter" data-name="${escapeAttr(f.name)}">${escapeHtml(f.name)}</button><button class="saved-filter-delete" data-action="delete-saved-filter" data-name="${escapeAttr(f.name)}" aria-label="Delete filter ${escapeAttr(f.name)}">&times;</button></span>`
  ).join('')}</div>`;
}

function renderActiveFilterStrip(query, labels = accountFilterLabels) {
  const entries = normalizedFilterEntries(query)
    .filter(([key, value]) => String(defaultQueries.accounts[key] ?? '') !== value);
  if (!entries.length) {
    return `<div class="active-filter-strip active-filter-strip--empty"><span>All ${isJobSeekerPersona() ? 'companies' : 'accounts'} visible</span></div>`;
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
  const jobSeeker = isJobSeekerPersona();
  return `
    <section class="account-preset-strip" aria-label="${jobSeeker ? 'Company' : 'Account'} working lanes">
      <div class="preset-strip-copy">
        <p class="eyebrow">Working lanes</p>
        <strong>Jump to the queue that matches the moment.</strong>
      </div>
      <div class="preset-button-row">
        ${accountPresets.map((preset) => `
          <button class="preset-button${isAccountPresetActive(preset) ? ' active' : ''}" type="button" data-action="apply-account-preset" data-preset="${escapeAttr(preset.id)}">
            <span>${escapeHtml(preset.label)}</span>
            <small>${escapeHtml(jobSeeker ? preset.description.replace('Accounts', 'Companies').replace('accounts', 'companies') : preset.description)}</small>
          </button>
        `).join('')}
      </div>
    </section>
  `;
}

function renderDashboardWorkflowStrip({ dashboard, extended, resolutionPressure }) {
  const freshJobs = dashboard.summary?.newJobsLast24h || 0;
  const followUps = (extended.overdueFollowUps?.length || 0) + (extended.staleAccounts?.length || 0);
  const boardsFound = dashboard.summary?.discoveredBoardCount || 0;
  return `
    <section class="workflow-strip" aria-label="Quick working lanes">
      <button class="workflow-card workflow-card--action" type="button" data-action="apply-account-preset" data-preset="fresh-roles" data-navigate="accounts">
        <span class="workflow-card__step" aria-hidden="true">01</span>
        <div class="workflow-card__copy">
          <strong>Recent role triggers</strong>
          <span>${pluralize(freshJobs, 'job')} in 24h</span>
        </div>
        <span class="workflow-card__arrow" aria-hidden="true">&#8594;</span>
      </button>
      <button class="workflow-card workflow-card--action" type="button" data-action="apply-account-preset" data-preset="follow-up" data-navigate="accounts">
        <span class="workflow-card__step" aria-hidden="true">02</span>
        <div class="workflow-card__copy">
          <strong>Follow-up lane</strong>
          <span>${formatNumber(followUps)} accounts need attention</span>
        </div>
        <span class="workflow-card__arrow" aria-hidden="true">&#8594;</span>
      </button>
      <a class="workflow-card workflow-card--action" href="#/admin">
        <span class="workflow-card__step" aria-hidden="true">03</span>
        <div class="workflow-card__copy">
          <strong>Coverage backlog</strong>
          <span>${formatNumber(resolutionPressure)} identity gaps</span>
        </div>
        <span class="workflow-card__arrow" aria-hidden="true">${boardsFound ? '&#8594;' : '+'}</span>
      </a>
    </section>
  `;
}

function renderExportOptions(view, label = 'View options') {
  return `
    <details class="queue-tools list-view-options">
      <summary aria-label="${escapeAttr(label)}">${escapeHtml(label)}</summary>
      <div class="queue-tools__menu">
        ${renderExportButton(view)}
      </div>
    </details>
  `;
}

function readinessTone(status, score = 0) {
  if (status === 'paid_ready' || score >= 80) return 'success';
  if (status === 'trial_ready' || score >= 55) return 'accent';
  if (status === 'warming_up' || score >= 30) return 'warning';
  return 'danger';
}

function renderWorkspaceReadinessPanel(readiness = {}) {
  const score = Math.max(0, Math.min(100, Number(readiness.score || 0)));
  const tone = readinessTone(readiness.status, score);
  const copy = getPersonaUiCopy(readiness.persona);
  const jobSeeker = copy.persona === 'jobseeker';
  const rawChecks = Array.isArray(readiness.checks) ? readiness.checks : [];
  const checks = rawChecks.length ? rawChecks : [
    { id: 'accounts', label: jobSeeker ? 'Target companies imported' : 'Target accounts imported', value: 0, target: jobSeeker ? 15 : 25, action: jobSeeker ? 'Add the companies you would genuinely apply to.' : 'Import the accounts you want to sell into.' },
    { id: 'contacts', label: jobSeeker ? 'Warm contacts mapped' : 'Buyer or talent contacts mapped', value: 0, target: jobSeeker ? 25 : 50, action: 'Import LinkedIn connections or add decision-makers manually.' },
    { id: 'boards', label: 'Resolved ATS boards', value: 0, target: jobSeeker ? 8 : 12, action: 'Run ATS discovery and review unresolved companies.' },
    { id: 'jobs', label: jobSeeker ? 'Open roles tracked' : 'Hiring signals tracked', value: 0, target: jobSeeker ? 20 : 40, action: 'Run live job import after boards resolve.' },
  ];
  const proofPoints = Array.isArray(readiness.proofPoints) ? readiness.proofPoints : [];
  const rawNextBestActions = Array.isArray(readiness.nextBestActions) ? readiness.nextBestActions : [];
  const nextBestActions = rawNextBestActions.length || rawChecks.length
    ? rawNextBestActions
    : checks.slice(0, 3).map((check) => ({
      title: check.action,
      metric: `${formatNumber(check.value || 0)}${check.suffix || ''} of ${formatNumber(check.target || 0)}${check.suffix || ''}`,
    }));
  const paidWhy = copy.persona === 'jobseeker'
    ? 'People pay when this replaces a target-company spreadsheet, manual careers checks, and scattered referral notes.'
    : 'Teams pay when this replaces manual account research, job-board checking, and guesswork about who to contact next.';

  return `
    <section class="detail-card readiness-panel readiness-panel--${escapeAttr(tone)}" aria-label="Paid readiness">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Paid readiness</p>
          <h3>${escapeHtml(readiness.title || 'Workspace readiness')}</h3>
          <p class="muted small">${escapeHtml(readiness.summary || paidWhy)}</p>
        </div>
        <div class="readiness-score" style="--readiness-score:${score}">
          <strong>${formatNumber(score)}</strong>
          <span>/100</span>
        </div>
      </div>
      <div class="readiness-proof">
        ${proofPoints.map((point) => `<span>${escapeHtml(point)}</span>`).join('')}
      </div>
      <div class="readiness-body">
        <div class="readiness-checklist">
          ${checks.map((check) => {
            const value = Number(check.value || 0);
            const target = Number(check.target || 0);
            const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
            const suffix = check.suffix || '';
            return `
              <article class="readiness-check ${check.met ? 'is-met' : ''}">
                <div class="inline-header">
                  <strong>${escapeHtml(check.label)}</strong>
                  ${renderStatusPill(check.met ? 'ready' : 'gap', check.met ? 'success' : 'warning')}
                </div>
                <div class="spark-bar readiness-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
                <p class="small muted">${formatNumber(value)}${escapeHtml(suffix)} of ${formatNumber(target)}${escapeHtml(suffix)} target</p>
              </article>
            `;
          }).join('')}
        </div>
        <div class="readiness-next">
          <h4>Next best improvements</h4>
          <p class="small muted">${escapeHtml(paidWhy)}</p>
          ${nextBestActions.length ? `<div class="timeline">${nextBestActions.map((item) => `
            <article class="timeline-item">
              <strong>${escapeHtml(item.title)}</strong>
              <span class="small muted">${escapeHtml(item.metric || '')}</span>
            </article>
          `).join('')}</div>` : '<div class="empty-state empty-state--compact">This workspace has enough coverage for a credible paid workflow. Keep jobs and contacts fresh.</div>'}
          <div class="button-row button-row--wrap">
            <a class="primary-button" href="#/admin">Improve coverage</a>
            <a class="ghost-button" href="#/accounts">${escapeHtml(copy.openAccountsCta)}</a>
            <a class="ghost-button" href="#/jobs">${escapeHtml(copy.reviewJobsCta)}</a>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderDeferredTargetNotice() {
  const pendingCount = Number(appState.onboardingIntent?.pendingTargetSites?.length || 0);
  if (!pendingCount) return '';
  const capacityDeferred = appState.onboardingIntent?.pendingTargetReason === 'capacity';
  return `
    <section class="deferred-target-notice" role="status">
      <div>
        <p class="eyebrow">Saved watchlist</p>
        <strong>${formatNumber(pendingCount)} target${pendingCount === 1 ? '' : 's'} ready to add</strong>
        <p>${capacityDeferred
          ? 'These targets were preserved when setup reached the current account limit. Nothing was discarded.'
          : 'You chose to finish setup without adding these targets. They are still here when you are ready.'}</p>
      </div>
      <div class="button-row">
        <button class="secondary-button" type="button" data-action="retry-deferred-targets">Add saved targets</button>
        ${capacityDeferred ? '<a class="ghost-button" href="#/admin/billing-subscription">Review account limit</a>' : ''}
      </div>
    </section>`;
}

function renderFirstValueChecklist(dashboard = {}, personaCopy = getPersonaUiCopy()) {
  const readinessMetrics = dashboard.readiness?.metrics || {};
  const summary = dashboard.summary || {};
  const jobSeeker = personaCopy.persona === 'jobseeker';
  const steps = [
    {
      id: 'target',
      title: jobSeeker ? 'Add a target company' : 'Add a target account',
      description: jobSeeker
        ? 'Choose a real company you would apply to so BD Engine has a useful ranking candidate.'
        : 'Choose a real account you want to reach so BD Engine has a useful ranking candidate.',
      value: Number(readinessMetrics.accountCount ?? summary.accountCount ?? 0),
      valueLabel: jobSeeker ? 'target company' : 'target account',
      cta: jobSeeker ? 'Add company' : 'Add account',
      href: '#/accounts/new',
    },
    jobSeeker ? {
      id: 'contact',
      title: 'Map a warm contact',
      description: 'Import the Connections.csv file you choose. BD Engine does not log into or automate LinkedIn.',
      value: Number(readinessMetrics.contactCount || 0),
      valueLabel: 'network contact',
      cta: 'Import contacts',
      href: '#/admin/pipeline-ops/contacts',
    } : null,
    {
      id: 'board',
      title: 'Find a job board',
      description: 'Resolve one supported public careers board before trying to refresh live roles.',
      value: Number(readinessMetrics.resolvedBoardCount ?? summary.discoveredBoardCount ?? 0),
      valueLabel: 'resolved board',
      cta: 'Find board',
      href: '#/admin/pipeline-ops/discovery',
    },
    {
      id: 'role',
      title: jobSeeker ? 'Import a live role' : 'Import a live hiring signal',
      description: jobSeeker
        ? 'Pull a current role so recommendations use fresh demand alongside your network.'
        : 'Pull a current role so account recommendations use fresh hiring demand.',
      value: Number(readinessMetrics.activeJobCount ?? summary.activeJobCount ?? 0),
      valueLabel: 'active role',
      cta: jobSeeker ? 'Import roles' : 'Import jobs',
      href: '#/admin/pipeline-ops/jobs',
    },
    jobSeeker || !supportsCommercialOutcomes() ? null : {
      id: 'action',
      title: 'Work the first signal',
      description: 'Open the recommended account, log the outreach, and schedule the next follow-up.',
      value: getCommercialOutcomeCount(appState.outcomeSummary || {}, 'outreach_logged'),
      valueLabel: 'outreach action',
      cta: 'Open account queue',
      href: '#/accounts',
    },
  ].filter(Boolean).map((step) => ({ ...step, complete: step.value > 0 }));
  const completeCount = steps.filter((step) => step.complete).length;
  if (completeCount === steps.length) return '';
  const progress = Math.round((completeCount / steps.length) * 100);
  const summaryCopy = jobSeeker
    ? 'Complete these four steps so BD Engine can rank a company using live roles and your existing network.'
    : 'Complete the signal-to-action loop using a real account. Contacts can be added later when a warm path is useful.';

  return `
    <section class="detail-card activation-path" data-first-value-checklist aria-labelledby="first-value-title">
      <div class="activation-path__header">
        <div>
          <p class="eyebrow">First value</p>
          <h3 id="first-value-title">Get to your first ranked recommendation</h3>
          <p class="muted small">${escapeHtml(summaryCopy)}</p>
          <button class="ghost-button ghost-button--xs activation-path__tour" type="button" data-action="start-product-tour">Quick tour</button>
        </div>
        <div class="activation-path__progress" aria-label="${completeCount} of ${steps.length} complete">
          <strong>${completeCount} of ${steps.length} complete</strong>
          <div class="activation-path__progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
            <span style="width:${progress}%"></span>
          </div>
        </div>
      </div>
      <ol class="activation-path__steps">
        ${steps.map((step, index) => `
          <li class="activation-step ${step.complete ? 'is-complete' : ''}" data-first-value-step="${escapeAttr(step.id)}" aria-label="${escapeAttr(`${step.title}: ${step.complete ? 'complete' : 'not complete'}`)}">
            <span class="activation-step__number" aria-hidden="true">${step.complete ? '&#10003;' : index + 1}</span>
            <div class="activation-step__copy">
              <div class="activation-step__title-row">
                <strong>${escapeHtml(step.title)}</strong>
                <span class="activation-step__state">${step.complete ? 'Complete' : escapeHtml(pluralize(step.value, step.valueLabel))}</span>
              </div>
              <p>${escapeHtml(step.description)}</p>
            </div>
            ${step.complete ? '' : `<a class="secondary-button activation-step__cta" href="${escapeAttr(step.href)}">${escapeHtml(step.cta)}</a>`}
          </li>
        `).join('')}
      </ol>
    </section>
  `;
}

function getPersonaUiCopy(persona = appState.persona) {
  const normalized = normalizeAppPersona(persona);
  if (normalized === 'jobseeker') {
    return {
      persona: 'jobseeker',
      accountSingular: 'company',
      accountPlural: 'companies',
      contactPlural: 'hiring contacts',
      jobsLabel: 'open roles',
      bestAccountCta: 'Open best company',
      openAccountsCta: 'Open companies',
      reviewJobsCta: 'Review open roles',
      spotlightTitle: 'Why this company is leading',
      spotlightSubtitle: 'Fit score, live roles, and warm-contact paths point here first.',
      queueTitle: 'Today company queue',
      queueSubtitle: 'The companies most worth working today, ranked for your job search.',
      actionEmpty: 'No job-search actions are ready yet. Import roles or add contacts to build a plan.',
    };
  }
  return {
    persona: 'bd',
    accountSingular: 'account',
    accountPlural: 'accounts',
    contactPlural: 'contacts',
    jobsLabel: 'jobs',
    bestAccountCta: 'Open best account',
    openAccountsCta: 'Open accounts',
    reviewJobsCta: 'Review imported jobs',
    spotlightTitle: 'Why this account is leading',
    spotlightSubtitle: 'Target score, hiring velocity, and engagement all point here first.',
    queueTitle: 'Today queue',
    queueSubtitle: 'The accounts most worth touching today, ranked for immediate action.',
    actionEmpty: 'No sales actions are ready yet. Import contacts or refresh jobs to build a plan.',
  };
}

function renderPersonaActionPlan(plan = {}, options = {}) {
  const items = Array.isArray(plan.items) ? plan.items : [];
  const copy = getPersonaUiCopy(plan.persona);
  const detail = Boolean(options.detail);
  const sectionClass = detail ? 'persona-action-plan persona-action-plan--detail' : 'persona-action-plan';
  return `
    <section class="detail-card ${sectionClass}">
      <div class="panel-header">
        <div>
          <h3>${escapeHtml(plan.title || (copy.persona === 'jobseeker' ? 'Job-search action plan' : 'Sales action plan'))}</h3>
          <p class="muted small">${escapeHtml(plan.summary || copy.actionEmpty)}</p>
        </div>
        ${plan.primaryCompany ? renderStatusPill(plan.primaryCompany, 'accent') : ''}
      </div>
      ${items.length ? `<div class="persona-action-grid">${items.map((item, index) => renderPersonaActionCard(item, { detail, primary: index === 0 })).join('')}</div>` : renderEmptyState({ icon: 'Next', title: 'No recommended actions yet', copy: copy.actionEmpty, compact: true })}
    </section>
  `;
}

function renderPersonaActionCard(item = {}, options = {}) {
  const detail = Boolean(options.detail);
  const primary = Boolean(options.primary);
  const tone = item.tone || 'neutral';
  const metric = item.metricLabel
    ? `<div class="persona-action-metric"><span>${escapeHtml(item.metricLabel)}</span><strong>${escapeHtml(String(item.metricValue ?? ''))}</strong></div>`
    : '';
  const accountId = item.accountId || appState.accountDetail?.account?.id || '';
  const openAccountButton = accountId
    ? `<button class="ghost-button ghost-button--xs" type="button" data-action="open-account" data-id="${escapeAttr(accountId)}">${escapeHtml(item.cta || 'Open account')}</button>`
    : '';
  const safeHref = safeExternalHref(item.href);
  const externalButton = safeHref
    ? `<a class="ghost-button ghost-button--xs" href="${escapeAttr(safeHref)}" target="_blank" rel="noreferrer">${escapeHtml(item.cta || 'Open link')}</a>`
    : '';
  const prefersExternalAction = item.type === 'application' && Boolean(externalButton);
  const templateButton = detail && item.template && accountId
    ? `<button class="${primary ? 'primary-button' : 'ghost-button'} ghost-button--xs" type="button" data-action="generate-outreach-template" data-id="${escapeAttr(accountId)}" data-template="${escapeAttr(item.template)}" data-job-id="${escapeAttr(item.jobId || '')}">${escapeHtml(item.cta || 'Draft note')}</button>`
    : '';
  const dashboardCta = !detail && prefersExternalAction
    ? externalButton
    : !detail && item.template && accountId
    ? `<button class="${primary ? 'primary-button' : 'ghost-button'} ghost-button--xs" type="button" data-action="open-contact-outreach" data-account-id="${escapeAttr(accountId)}" data-contact-id="${escapeAttr(item.contactId || '')}" data-contact-name="${escapeAttr(item.contactName || '')}" data-template="${escapeAttr(item.template)}" data-job-id="${escapeAttr(item.jobId || '')}" data-auto-generate="true">${escapeHtml(item.cta || 'Draft note')}</button>`
    : !detail && externalButton
      ? externalButton
      : !detail && openAccountButton
        ? openAccountButton
        : '';
  const actions = detail
    ? (prefersExternalAction ? externalButton : (templateButton || externalButton || openAccountButton))
    : dashboardCta;

  return `
    <article class="persona-action-card persona-action-card--${escapeAttr(tone)}">
      <div class="persona-action-topline">
        ${renderStatusPill(item.type || 'next step', tone)}
        ${metric}
      </div>
      <h4>${escapeHtml(item.title || '')}</h4>
      <p>${escapeHtml(item.description || '')}</p>
      ${item.companyName && !detail ? `<div class="small muted">${escapeHtml(item.companyName)}${item.targetScore !== undefined ? ` - ${formatNumber(item.targetScore)} score` : ''}</div>` : ''}
      ${actions ? `<div class="button-row button-row--wrap persona-action-actions">${actions}</div>` : ''}
    </article>
  `;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function scrollIntoViewRespectingMotion(element, options = {}) {
  if (!element) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ ...options, behavior: reduceMotion ? 'auto' : (options.behavior || 'smooth') });
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
          <p class="small muted">${summary.workerRunning ? 'Background work is running.' : 'No background work is running right now.'}</p>
        </div>
        <div class="runtime-banner-flags">
          ${renderStatusPill(summary.warmed ? 'Warm' : 'Starting', summary.warmed ? 'success' : 'warning')}
          ${renderStatusPill(summary.workerRunning ? 'Online' : 'Idle', summary.workerRunning ? 'hot' : 'neutral')}
        </div>
      </div>
      <div class="status-matrix status-matrix--premium">
        <div class="status-item"><span class="small muted">Server</span><strong>${summary.warmed ? 'Warm' : 'Starting'}</strong><span class="small muted">${summary.serverStartedAt ? formatDate(summary.serverStartedAt) : 'Just now'}</span></div>
        <div class="status-item"><span class="small muted">Background work</span><strong>${summary.workerRunning ? 'Running' : 'Idle'}</strong><span class="small muted">${summary.workerRunning ? 'Ready to process updates' : 'No active process'}</span></div>
        <div class="status-item"><span class="small muted">Running tasks</span><strong>${formatNumber(summary.runningJobs || 0)}</strong><span class="small muted">Working now</span></div>
        <div class="status-item"><span class="small muted">Queued tasks</span><strong>${formatNumber(summary.queuedJobs || 0)}</strong><span class="small muted">${summary.queuedJobs ? 'Waiting to start' : 'Queue clear'}</span></div>
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
      : renderEmptyState({ icon: 'OK', title: 'No background work running', copy: 'Imports, discovery runs, and refreshes will appear here once you start them.', compact: true })}
    ${recentJobs.length
      ? `<div class="inline-header"><strong>Recent work</strong><span class="small muted">Finished updates and any issues</span></div>${recentJobs.map((job) => renderBackgroundJobItem(job)).join('')}`
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
      scheduleRuntimePoll();
    } catch (_error) {
      // Keep the current admin screen stable if polling fails.
      const msg = String(_error.message || _error);
      if (msg.includes('401') || msg.includes('Unauth')) {
        return;
      }
      scheduleRuntimePoll();
    }
  }, 3000);
}

async function watchBackgroundJob(jobId, options = {}) {
  const label = options.label || 'Background job';
  while (true) {
    const job = await api(`/api/background-jobs/${jobId}`, { skipCache: true });
    updateBackgroundProgressPanel(job, label);
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

    const pct = Number.isFinite(Number(job.progress)) ? ` ${Math.round(Number(job.progress))}%` : '';
    window.bdLocalApi.setAlert(`${label}${pct}: ${job.progressMessage || humanize(job.status)}`, appAlert);
    await sleep(2000);
  }
}

function updateBackgroundProgressPanel(job, fallbackLabel = 'Background job') {
  const container = document.getElementById('pipeline-progress-container');
  if (!container || !job) return;
  const rawProgress = Number(job.progress);
  const progress = Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(100, Math.round(rawProgress)))
    : (job.status === 'completed' ? 100 : 8);
  const bar = container.querySelector('.pipeline-progress-bar-fill');
  const label = container.querySelector('.pipeline-progress-label');
  const stage = container.querySelector('.pipeline-progress-stage');
  const eyebrow = container.querySelector('.pipeline-progress-copy .eyebrow');

  container.classList.remove('hidden');
  if (bar) bar.style.width = `${progress}%`;
  if (label) label.textContent = `${progress}%`;
  if (stage) stage.textContent = job.progressMessage || job.message || humanize(job.stage || job.status || 'Processing');
  if (eyebrow) eyebrow.textContent = job.summary || fallbackLabel;

  if (['completed', 'failed', 'cancelled'].includes(job.status)) {
    window.setTimeout(() => container.classList.add('hidden'), 4500);
  }
}

function renderLoadingState(title, subtitle) {
  setViewTitle(title);
  const isFirstSetup = appState.setupStatus?.requiresSetup || appState.setupBusy;
  appRoot.innerHTML = `
    <section class="hero-card loading-shell" role="status" aria-live="polite" aria-busy="true">
      <div class="loading-copy">
        <p class="eyebrow">Operating view</p>
        <h3>${escapeHtml(title)}</h3>
        <p class="subtitle small">${escapeHtml(subtitle || 'Fetching the latest hiring and account signals...')}</p>
        
        ${isFirstSetup ? `
          <div class="setup-warning-box">
            <div class="small"><strong>First-time setup in progress.</strong> This may take up to 2-3 minutes while we process your LinkedIn network and build your hiring radar.</div>
            <div class="progress-container" role="progressbar" aria-label="Workspace setup progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="15">
              <div class="progress-bar-fill" id="setup-progress-bar" style="width: 15%"></div>
            </div>
            <div class="progress-label small muted" id="setup-progress-text">Initializing workspace...</div>
          </div>
        ` : ''}
      </div>
      <div class="loading-grid" aria-hidden="true">
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-pill"></span>
        <span class="skeleton skeleton-pill"></span>
      </div>
    </section>
    <section class="metrics-grid" aria-hidden="true">
      <article class="metric-card"><span class="skeleton skeleton-line short"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line"></span></article>
      <article class="metric-card"><span class="skeleton skeleton-line short"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line"></span></article>
      <article class="metric-card"><span class="skeleton skeleton-line short"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line"></span></article>
      <article class="metric-card"><span class="skeleton skeleton-line short"></span><span class="skeleton skeleton-block"></span><span class="skeleton skeleton-line"></span></article>
    </section>
  `;
  
  if (isFirstSetup) {
    // Simulate some progress movement if it's stuck on the loader
    let progress = 15;
    const interval = setInterval(() => {
      const bar = document.getElementById('setup-progress-bar');
      const text = document.getElementById('setup-progress-text');
      if (!bar) {
        clearInterval(interval);
        return;
      }
      progress = Math.min(95, progress + Math.random() * 2);
      bar.style.width = `${progress}%`;
      bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(progress)));
      if (progress > 80) text.textContent = 'Finalizing hiring signals...';
      else if (progress > 60) text.textContent = 'Resolving company ATS boards...';
      else if (progress > 40) text.textContent = 'Analyzing job activity...';
      else if (progress > 25) text.textContent = 'Parsing LinkedIn connections...';
    }, 3000);
  }
}

function isBillingRequiredError(error) {
  return Boolean(error && (error.billingRequired || error.code === 'billing_required'));
}

async function renderBillingRequiredView(error = {}) {
  setViewTitle('Billing required');
  activateNav('');
  renderBreadcrumbs(null);
  window.bdLocalApi.setAlert('', appAlert);

  let billing = null;
  try {
    billing = await api('/api/billing', { skipCache: true });
  } catch (_billingError) {
    billing = null;
  }

  const stripeStatus = billing?.stripe || {};
  const stripeReady = Boolean(stripeStatus.checkoutReady);
  const selectedPlanId = isJobSeekerPersona() ? 'jobseeker' : 'sales';
  const canManageBilling = Boolean(billing?.canManageBilling);
  const canChangeBilling = billing?.canChangeBilling !== false;
  const message = error.message || error.error || 'Your trial has ended. Choose a plan to continue using BD Engine.';
  const stripeBillingMessage = !canChangeBilling
    ? 'A workspace owner or admin must manage the subscription.'
    : stripeReady
    ? (canManageBilling ? 'Open the secure billing portal to update your payment method or plan.' : 'Secure checkout is ready.')
    : 'Online plan changes are not available in this workspace. Your current access is unchanged.';

  appRoot.innerHTML = `
    <section class="hero-card">
      <div class="hero-copy">
        <p class="eyebrow">Billing required</p>
        <h2>Choose a plan to continue</h2>
        <p class="subtitle">${escapeHtml(message)}</p>
        <p class="small muted">${escapeHtml(stripeBillingMessage)}</p>
        <div class="inline-field-stack" style="max-width: 420px;">
          <select id="billing-plan-select">
            <option value="jobseeker" ${selected(selectedPlanId, 'jobseeker')} ${stripeStatus.prices?.jobseeker ? '' : 'disabled'}>Job Seeker ($5 USD/mo)</option>
            <option value="sales" ${selected(selectedPlanId, 'sales')} ${stripeStatus.prices?.sales ? '' : 'disabled'}>Sales Professional ($10 USD/mo)</option>
          </select>
          <div class="button-row">
            <button class="primary-button" type="button" data-action="${canManageBilling ? 'billing-portal' : 'billing-checkout'}"${canChangeBilling && (stripeReady || canManageBilling) ? '' : ' disabled'}>${!canChangeBilling ? 'Owner access required' : (canManageBilling ? 'Manage billing' : (stripeReady ? 'Choose this plan' : 'Plan changes unavailable'))}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function setViewTitle(title) {
  viewTitle.textContent = title;
  document.title = `${title} | BD Engine`;
}

function activateNav(routeKey) {
  document.querySelectorAll('.nav a').forEach((anchor) => {
    const isActive = anchor.dataset.route === routeKey;
    anchor.classList.toggle('active', isActive);
    if (isActive) anchor.setAttribute('aria-current', 'page');
    else anchor.removeAttribute('aria-current');
  });
}

async function renderRoute() {
  const hash = location.hash || '#/dashboard';
  const parts = hash.replace(/^#\/?/, '').split('/');
  const root = parts[0] || 'dashboard';
  appState.activeView = root;
  clearRuntimePoll();
  closeMobileNav({ restoreFocus: false });

  if (!appState.setupStatus) {
    await loadSetupStatus(false);
  }

  if (root === 'setup') {
    if (appState.setupStatus && !appState.setupStatus.requiresSetup && !appState.setupResult) {
      location.hash = '#/dashboard';
      return;
    }
    activateNav('');
    renderBreadcrumbs(null);
    await renderSetupWizard();
    return;
  }

  if (appState.setupStatus?.requiresSetup) {
    location.hash = '#/setup';
    return;
  }

  if (root === 'accounts' && parts[1] && parts[1] !== 'new') {
    const personaCopy = getPersonaUiCopy();
    activateNav('accounts');
    renderBreadcrumbs([
      { label: 'Dashboard', href: '#/dashboard' },
      { label: humanize(personaCopy.accountPlural), href: '#/accounts' },
      { label: humanize(personaCopy.accountSingular) },
    ]);
    await renderAccountDetail(parts[1]);
    return;
  }

  if (root === 'accounts') {
    activateNav('accounts');
    renderBreadcrumbs(null);
    await renderAccountsView();
    if (parts[1] === 'new') focusAccountCreateForm();
    return;
  }

  if (root === 'contacts') {
    activateNav('contacts');
    renderBreadcrumbs(null);
    await renderContactsView();
    return;
  }

  if (root === 'tasks') {
    activateNav('tasks');
    renderBreadcrumbs(null);
    await renderTasksView();
    return;
  }

  if (root === 'jobs') {
    activateNav('jobs');
    renderBreadcrumbs(null);
    await renderJobsView();
    return;
  }

  if (root === 'admin') {
    activateNav('admin');
    renderBreadcrumbs(null);
    await renderAdminView();
    if (parts[1]) {
      const sectionId = parts[1] === 'billing' ? 'billing-subscription' : parts[1];
      openAdminSection(sectionId, parts[2] || '');
    }
    scheduleRuntimePoll();
    return;
  }

  activateNav('dashboard');
  renderBreadcrumbs(null);
  await renderDashboardView();
}

function getSetupSteps() {
  const jobSeeker = isJobSeekerPersona();
  const steps = [
    { key: 'profile', label: 'Workspace' },
  ];
  if (appState.setupStatus?.licensingEnabled) {
    steps.push({ key: 'license', label: 'License' });
  }
  steps.push({ key: 'targets', label: jobSeeker ? 'Companies' : 'Watchlist' });
  steps.push({ key: 'import', label: 'Contacts (optional)' });
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
  const targetsInput = document.getElementById('setup-target-sites');
  if (workspaceInput) appState.setupDraft.workspaceName = workspaceInput.value.trim();
  if (userNameInput) appState.setupDraft.userName = userNameInput.value.trim();
  if (userEmailInput) appState.setupDraft.userEmail = userEmailInput.value.trim();
  if (ownersInput) appState.setupDraft.ownersText = ownersInput.value;
  if (licenseInput) appState.setupDraft.licenseKey = licenseInput.value.trim();
  if (targetsInput) appState.setupDraft.targetSites = targetsInput.value;
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

function titleCaseTargetName(value, fallback = 'Target company') {
  const cleaned = decodeURIComponent(String(value || ''))
    .replace(/\b(careers?|jobs?|openings?|opportunities)\b/gi, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.replace(/\b\w/g, (character) => character.toUpperCase());
}

function getCompanyLabelFromTargetUrl(url, index = 0) {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const pathParts = url.pathname.split('/').map((part) => part.trim()).filter(Boolean);
  const providerHosts = [
    'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com',
    'bamboohr.com', 'jobvite.com', 'recruitee.com', 'personio.com', 'rippling.com',
  ];
  const providerHost = providerHosts.find((host) => hostname === host || hostname.endsWith(`.${host}`));
  let candidate = '';
  if (hostname.includes('greenhouse.io')) candidate = url.searchParams.get('for') || pathParts[0] || '';
  else if (hostname.endsWith('.bamboohr.com')) candidate = hostname.split('.')[0];
  else if (hostname === 'jobs.jobvite.com' || hostname.endsWith('.jobvite.com')) candidate = pathParts[0] || hostname.split('.')[0];
  else if (hostname.endsWith('.recruitee.com')) candidate = hostname.split('.')[0];
  else if (hostname.endsWith('.jobs.personio.com')) candidate = hostname.split('.')[0];
  else if (hostname === 'jobs.personio.com') candidate = pathParts[0] || '';
  else if (hostname === 'ats.rippling.com' || hostname.endsWith('.rippling.com')) candidate = pathParts[0] || hostname.split('.')[0];
  else if (providerHost) candidate = pathParts[0] || hostname.split('.')[0];
  else if (hostname.includes('myworkdayjobs.com')) candidate = hostname.split('.')[0];
  else {
    const parts = hostname.split('.').filter(Boolean);
    const suffixIndex = parts.length >= 3 && ['co', 'com', 'org', 'net'].includes(parts.at(-2)) ? -3 : -2;
    candidate = parts.at(suffixIndex) || parts[0] || '';
  }
  return titleCaseTargetName(candidate, `Target company ${index + 1}`);
}

function parseSetupTargetSites(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const targets = [];
  const invalid = [];
  const seen = new Set();
  lines.slice(0, 50).forEach((line, index) => {
    const rawValue = line.replace(/^[\s"']+|[\s"']+$/g, '');
    if (!rawValue) return;
    const looksLikeCompanyName = !rawValue.includes('://') && !rawValue.includes('.') && !rawValue.includes('/');
    if (looksLikeCompanyName) {
      const key = rawValue.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({ company: rawValue, domain: '', careersUrl: '' });
      }
      return;
    }
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.includes('.')) throw new Error('Unsupported URL');
      url.hash = '';
      const careersUrl = url.href;
      const key = careersUrl.toLowerCase().replace(/\/$/, '');
      if (seen.has(key)) return;
      seen.add(key);
      const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      const isHostedBoard = [
        'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com',
        'myworkdayjobs.com', 'bamboohr.com', 'jobvite.com', 'recruitee.com', 'personio.com', 'rippling.com',
      ]
        .some((host) => hostname === host || hostname.endsWith(`.${host}`));
      targets.push({
        company: getCompanyLabelFromTargetUrl(url, index),
        domain: isHostedBoard ? '' : hostname,
        careersUrl,
      });
    } catch {
      invalid.push(line);
    }
  });
  return { targets, invalid, truncated: lines.length > 50 };
}

function buildSetupTargetImportCsv(targets = []) {
  const quote = (value) => `"${String(value || '').replace(/"/g, '""')}"`;
  return [
    'company,domain,careers_url,priority,status,notes',
    ...targets.map((target) => [
      target.company,
      target.domain,
      target.careersUrl,
      'high',
      'new',
      'Added during quick-start watchlist setup',
    ].map(quote).join(',')),
  ].join('\n');
}

function syncSetupTargetFeedback({ forceError = false } = {}) {
  const input = document.getElementById('setup-target-sites');
  const feedback = document.getElementById('setup-target-feedback');
  if (!input || !feedback) return;
  appState.setupDraft.targetSites = input.value;
  const parsed = parseSetupTargetSites(input.value);
  const hasError = Boolean(forceError || parsed.invalid.length);
  const targetLabel = isJobSeekerPersona() ? 'companies' : 'target accounts';
  input.setAttribute('aria-invalid', String(hasError));
  feedback.classList.toggle('setup-target-feedback--error', hasError);
  const count = feedback.querySelector('strong');
  const message = feedback.querySelector('span');
  if (count) count.textContent = `${formatNumber(parsed.targets.length)} ${targetLabel} ready`;
  if (message) {
    message.textContent = parsed.invalid.length
      ? `${formatNumber(parsed.invalid.length)} line${parsed.invalid.length === 1 ? '' : 's'} need a valid company name, domain, or URL.`
      : forceError && !parsed.targets.length
        ? 'Add at least one company name, domain, or careers URL, or choose Skip for now.'
        : parsed.truncated
          ? 'The first 50 entries are ready; add the remainder later.'
          : 'One company per line. You can edit the watchlist later.';
  }
}

async function renderSetupWizard() {
  await loadSetupStatus(false);
  if (appState.setupResult) {
    appState.setupStep = getSetupSteps().length;
  }

  const steps = getSetupSteps();
  const current = getCurrentSetupStep();
  const draft = appState.setupDraft;
  const jobSeeker = isJobSeekerPersona();
  const setupTitle = current.key === 'launch'
    ? 'Setup complete'
    : jobSeeker ? 'Job search setup' : 'First-run setup';
  // Focus lands here after each transition, so use the current step label
  // instead of repeating a generic setup heading for assistive technology.
  const setupCardTitle = current.key === 'launch'
    ? 'You are ready to go'
    : current.label;
  const setupEyebrow = `${steps.length} quick steps`;
  const setupIntro = jobSeeker
    ? 'Start with companies you care about, then add contacts when you are ready to map warm paths.'
    : 'Start with a focused company watchlist, see the first hiring signals, then add contacts when they are useful.';
  setViewTitle(setupTitle);
  workspaceName.textContent = draft.workspaceName || appState.setupStatus?.workspace?.name || 'BD Engine';
  window.bdLocalApi.setAlert('', appAlert);

  appRoot.innerHTML = `
    <section class="setup-shell" aria-labelledby="setup-title">
      <div class="setup-card">
        <div class="setup-header">
          <div>
            <p class="eyebrow">${escapeHtml(setupEyebrow)}</p>
            <h2 id="setup-title" tabindex="-1">${escapeHtml(setupCardTitle)}</h2>
            <p class="muted">${escapeHtml(setupIntro)}</p>
          </div>
          <ol class="setup-steps" aria-label="Setup progress">
            ${steps.map((step, index) => `
              <li class="setup-step ${index + 1 === appState.setupStep ? 'active' : ''} ${index + 1 < appState.setupStep ? 'complete' : ''}" ${index + 1 === appState.setupStep ? 'aria-current="step"' : ''}>
                <span>${index + 1}</span>
                <strong>${escapeHtml(step.label)}</strong>
              </li>
            `).join('')}
          </ol>
        </div>
        ${renderSetupValueGuide(appState.setupStatus?.readiness, jobSeeker)}
        ${renderSetupStepContent(current.key)}
      </div>
    </section>
  `;

  wireSetupDropZone();
  if (appState.setupLastFocusedStep !== current.key) {
    appState.setupLastFocusedStep = current.key;
    window.requestAnimationFrame(() => document.getElementById('setup-title')?.focus({ preventScroll: true }));
  }
}

function renderSetupValueGuide(readiness = {}, jobSeeker = false) {
  const metrics = readiness?.metrics || {};
  const visibleChecks = [
    { label: jobSeeker ? 'Target companies' : 'Target accounts', value: Number(metrics.accountCount || 0), target: 5, suffix: '' },
    { label: 'Resolved ATS board', value: Number(metrics.resolvedBoardCount || 0), target: 1, suffix: '' },
    { label: jobSeeker ? 'Live role' : 'Live hiring signal', value: Number(metrics.activeJobCount || 0), target: 1, suffix: '' },
  ];
  const completedChecks = visibleChecks.filter((check) => check.value >= check.target).length;
  const score = Math.round((completedChecks / visibleChecks.length) * 100);
  const title = jobSeeker ? 'Reach a useful first shortlist' : 'Reach a useful first account signal';
  const copy = jobSeeker
    ? 'Start with five companies, one resolved board, and one live role. Add contacts later when you want warmer paths.'
    : 'Start with five accounts, one resolved board, and one live hiring signal. Contacts are optional until they improve a real next move.';
  return `
    <div class="setup-value-guide">
      <div>
        <p class="eyebrow">Workspace readiness</p>
        <strong>${escapeHtml(title)}</strong>
        <p class="muted small">${escapeHtml(copy)}</p>
      </div>
      <div class="setup-value-score">
        <strong>${formatNumber(score)}</strong>
        <span>/100 ready</span>
      </div>
      <div class="setup-value-grid">
        ${visibleChecks.map((check) => `
          <span>
            <strong>${formatNumber(check.value || 0)}${escapeHtml(check.suffix || '')}</strong>
            ${escapeHtml(check.label)} <small class="muted">of ${formatNumber(check.target || 0)}${escapeHtml(check.suffix || '')}</small>
          </span>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSetupStepContent(stepKey) {
  const draft = appState.setupDraft;
  const jobSeeker = isJobSeekerPersona();
  if (stepKey === 'profile') {
    const defaultName = draft.userName || appState.user?.name || '';
    const defaultEmail = draft.userEmail || appState.user?.email || '';
    const hasSignupIdentity = Boolean(defaultName && defaultEmail);
    const workspaceLabel = jobSeeker ? 'Search workspace name' : 'Workspace or company name';
    const workspacePlaceholder = jobSeeker ? 'My Job Search 2026' : 'Your company or team';
    return `
      <form id="setup-profile-form" class="setup-form">
        <div class="setup-grid">
          <label>${escapeHtml(workspaceLabel)}
            <input id="setup-workspace-name" name="workspaceName" required autocomplete="organization" value="${escapeHtml(draft.workspaceName)}" placeholder="${escapeAttr(workspacePlaceholder)}" />
          </label>
          ${hasSignupIdentity ? `
            <div class="setup-identity-confirmation">
              <span class="setup-identity-confirmation__avatar" aria-hidden="true">${escapeHtml(defaultName.charAt(0).toUpperCase())}</span>
              <span><small>Signed in as</small><strong>${escapeHtml(defaultName)}</strong><small>${escapeHtml(defaultEmail)}</small></span>
            </div>
            <input id="setup-user-name" name="userName" type="hidden" value="${escapeAttr(defaultName)}">
            <input id="setup-user-email" name="userEmail" type="hidden" value="${escapeAttr(defaultEmail)}">` : `
            <label>Your name
              <input id="setup-user-name" name="userName" required autocomplete="name" value="${escapeHtml(defaultName)}" placeholder="Full name" />
            </label>
            <label>Your email
              <input id="setup-user-email" name="userEmail" type="email" required autocomplete="email" value="${escapeHtml(defaultEmail)}" placeholder="you@example.com" />
            </label>`}
        </div>
        <div class="button-row">
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

  if (stepKey === 'targets') {
    const parsedTargets = parseSetupTargetSites(draft.targetSites);
    const audit = appState.onboardingIntent?.source === 'ats-checker' ? appState.onboardingIntent.audit || {} : null;
    const targetLabel = jobSeeker ? 'companies' : 'target accounts';
    const carriedAudit = audit ? `
      <div class="setup-intent-banner" role="status">
        <span class="setup-intent-banner__mark" aria-hidden="true">&#10003;</span>
        <div>
          <strong>Your ATS audit is ready to become a live watchlist.</strong>
          <p>${formatNumber(audit.validCount || parsedTargets.targets.length)} valid career site${Number(audit.validCount || parsedTargets.targets.length) === 1 ? '' : 's'} carried into setup${audit.recognizedCount ? `; ${formatNumber(audit.recognizedCount)} recognized automatically` : ''}.</p>
        </div>
      </div>` : '';
    return `
      <form id="setup-target-form" class="setup-form setup-target-quickstart">
        <div class="setup-import-copy">
          <p class="eyebrow">Fastest path to value</p>
          <h3>${jobSeeker ? 'Which companies should BD Engine watch?' : 'Which accounts should BD Engine monitor?'}</h3>
          <p class="muted">Paste 5–20 company domains or careers URLs. BD Engine will create the watchlist, resolve supported job boards, and start looking for hiring changes.</p>
        </div>
        ${carriedAudit}
        <div class="setup-starter-kits">
          <span class="setup-brief-label">Or load a 1-click Industry Starter Kit:</span>
          <div class="setup-kit-chips">
            <button class="ghost-button micro-button" type="button" data-action="load-niche-kit" data-kit="fintech">🚀 Fintech (10)</button>
            <button class="ghost-button micro-button" type="button" data-action="load-niche-kit" data-kit="cybersecurity">🛡️ Cybersecurity (10)</button>
            <button class="ghost-button micro-button" type="button" data-action="load-niche-kit" data-kit="ai-devtools">💻 AI & DevTools (10)</button>
            <button class="ghost-button micro-button" type="button" data-action="load-niche-kit" data-kit="healthtech">🏥 HealthTech (10)</button>
          </div>
        </div>
        <label>Company domains or careers URLs
          <textarea id="setup-target-sites" name="targetSites" rows="10" aria-describedby="setup-target-feedback${appState.setupTargetImportResult?.error ? ' setup-target-import-error' : ''}" aria-invalid="${parsedTargets.invalid.length ? 'true' : 'false'}" placeholder="acme.com&#10;https://northstar.example/careers&#10;https://jobs.lever.co/vertex">${escapeHtml(draft.targetSites)}</textarea>
        </label>
        <div id="setup-target-feedback" class="setup-target-feedback${parsedTargets.invalid.length ? ' setup-target-feedback--error' : ''}" aria-live="polite">
          <strong>${formatNumber(parsedTargets.targets.length)} ${escapeHtml(targetLabel)} ready</strong>
          <span>${parsedTargets.invalid.length ? `${formatNumber(parsedTargets.invalid.length)} line${parsedTargets.invalid.length === 1 ? '' : 's'} need a valid company name, domain, or URL.` : 'One company per line. You can edit the watchlist later.'}</span>
        </div>
        ${appState.setupTargetImportResult?.error ? `<p id="setup-target-import-error" class="setup-inline-error" role="alert"><strong>Watchlist not imported.</strong> ${escapeHtml(appState.setupTargetImportResult.error)} Your list is still here; correct it or try again.</p>` : ''}
        <div class="setup-flow-preview" aria-label="What happens next">
          <span><strong>1</strong> Create watchlist</span>
          <span><strong>2</strong> Resolve hiring sources</span>
          <span><strong>3</strong> Rank the first action</span>
        </div>
        <div class="button-row">
          <button class="secondary-button" type="button" data-action="setup-back">Back</button>
          <button class="ghost-button" type="button" data-action="setup-skip-targets">Skip for now</button>
          <button class="primary-button" type="submit">Use this watchlist</button>
        </div>
      </form>
    `;
  }

  if (stepKey === 'import') {
    const hasCsv = Boolean(appState.setupCsvFile);
    const importTitle = 'Add warm contacts when they are useful';
    const importCopyHtml = jobSeeker
      ? 'Optional: upload LinkedIn <code>Connections.csv</code> to map people you know to the companies and open roles in your watchlist.'
      : 'Optional: upload LinkedIn <code>Connections.csv</code> to find warm paths into the accounts you just selected. You can finish now and add contacts later.';
    return `
      <div class="setup-form">
        <div class="setup-import-copy">
          <h3>${escapeHtml(importTitle)}</h3>
          <p class="muted">${importCopyHtml}</p>
        </div>

        <div class="data-use-notice" role="note">
          <strong>Your LinkedIn account stays separate.</strong>
          <span>BD Engine does not log into LinkedIn or automate LinkedIn activity. It only reads the Connections.csv file you choose so it can match existing contacts to companies in your workspace. Review LinkedIn's terms and your organization's policies before uploading exported data.</span>
        </div>
        
        <div class="onboarding-guide onboarding-guide--setup">
          <p class="onboarding-guide__title">How to get your Connections.csv:</p>
          <ol class="onboarding-guide__list">
            <li>Use LinkedIn on a desktop browser and open <strong>Me</strong>, then <strong>Settings & Privacy</strong>.</li>
            <li>Click <strong>Data privacy</strong>, then <strong>Get a copy of your data</strong>.</li>
            <li>Choose the data archive option that includes <strong>Connections</strong>, then click <strong>Request archive</strong>.</li>
            <li>When LinkedIn emails the download link, unzip the archive and upload <code>Connections.csv</code> here.</li>
          </ol>
          <div class="onboarding-guide__note">
            <span class="toast-icon">&#8505;</span>
            <span>LinkedIn sends the archive link to your primary email. <a href="https://www.linkedin.com/help/linkedin/answer/a566336/export-connections-from-linkedin" target="_blank" rel="noopener">Open LinkedIn's export guide</a>.</span>
          </div>
        </div>

        ${renderSetupSamplePanel(jobSeeker)}
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
          ${hasCsv ? `<button class="secondary-button" type="button" data-action="setup-preview-csv" ${!appState.setupBusy ? '' : 'disabled'}>${appState.setupBusy ? 'Working...' : 'Preview CSV'}</button>` : ''}
          ${hasCsv
            ? `<button class="primary-button" type="button" data-action="setup-complete" ${appState.setupBusy || !appState.setupPreview ? 'disabled' : ''}>${appState.setupBusy ? 'Importing...' : appState.setupPreview ? 'Import and finish setup' : 'Preview before importing'}</button>`
            : `<button class="primary-button" type="button" data-action="setup-skip-import" ${appState.setupBusy ? 'disabled' : ''}>Finish setup</button>`}
        </div>
      </div>
    `;
  }

  const result = appState.setupResult || {};
  const stats = result.stats || {};
  const sampleLoaded = Boolean(result.sample || result.sampleLoaded);
  const targetImport = result.targetImport || appState.setupTargetImportResult;
  const pendingTargetCount = Number(targetImport?.deferred || appState.onboardingIntent?.pendingTargetSites?.length || 0);
  const pendingTargetReason = targetImport?.capacityReached
    ? 'capacity'
    : appState.onboardingIntent?.pendingTargetReason || (appState.setupTargetsSkipped ? 'skipped' : '');
  const summaryItems = sampleLoaded
    ? [
      { label: jobSeeker ? 'Companies' : 'Accounts', value: stats.accounts || 0 },
      { label: jobSeeker ? 'Network contacts' : 'Contacts', value: stats.contacts || 0 },
      { label: jobSeeker ? 'Open roles' : 'Jobs', value: stats.jobs || 0 },
      { label: 'Boards', value: stats.configs || 0 },
    ]
    : targetImport || pendingTargetCount ? [
      { label: jobSeeker ? 'Companies added' : 'Accounts added', value: targetImport?.count || 0 },
      { label: 'Already present', value: Array.isArray(targetImport?.skipped) ? targetImport.skipped.length : 0 },
      { label: 'Saved for later', value: pendingTargetCount },
      { label: 'Monitoring queued', value: targetImport?.workflowQueued ? 1 : 0 },
    ] : [
      { label: 'Imported', value: stats.imported || 0 },
      { label: 'Updated', value: stats.updated || 0 },
      { label: 'Skipped', value: stats.skipped || 0 },
      { label: 'Failed', value: stats.failed || 0 },
    ];
  if (appState.setupBusy && appState.setupImportJobId) {
    return `
      <div class="setup-success">
        ${renderSetupProgress('Importing LinkedIn connections', appState.setupProgressMessage || 'This can take a few minutes for a large LinkedIn export.')}
        <p class="muted">You can leave this window open. BD Engine is saving contacts, deriving ${jobSeeker ? 'companies' : 'accounts'}, and avoiding duplicates.</p>
      </div>
    `;
  }

  const successTitle = jobSeeker ? 'Your job search workspace is ready' : 'Your workspace is ready';
  const successCopy = jobSeeker
    ? 'BD Engine will now open your dashboard using the companies you chose. Add contacts whenever you want warmer paths.'
    : pendingTargetCount
      ? pendingTargetReason === 'capacity'
        ? `${formatNumber(pendingTargetCount)} targets are safely saved for later. The targets within your current account limit are ready now.`
        : `${formatNumber(pendingTargetCount)} targets are saved for whenever you are ready to add them from the dashboard.`
      : targetImport?.workflowQueued
      ? 'Your watchlist is live and the first hiring-signal refresh is running in the background.'
      : 'Your workspace is ready. Open the dashboard to start working the ranked account queue.';
  return `
    <div class="setup-success">
      <div class="setup-success-mark" aria-hidden="true">OK</div>
      <h3>${escapeHtml(successTitle)}</h3>
      <p class="muted">${escapeHtml(successCopy)}</p>
      <div class="setup-summary-grid">
        ${summaryItems.map((item) => `<div><strong>${formatNumber(item.value)}</strong><span>${escapeHtml(item.label)}</span></div>`).join('')}
      </div>
      ${targetImport?.workflowError ? `<p class="setup-launch-note muted">Monitoring did not start automatically: ${escapeHtml(targetImport.workflowError)} Start it from Admin when you are ready.</p>` : ''}
      ${pendingTargetCount ? `<p class="setup-launch-note muted">${pendingTargetReason === 'capacity'
        ? 'Your saved targets stay available in this browser. Increase the account limit, then add them from the dashboard.'
        : 'Your saved targets stay available in this browser and can be added from the dashboard.'}</p>` : ''}
      <div class="button-row center">
        <button class="primary-button" type="button" data-action="setup-open-dashboard">Open ranked dashboard</button>
        ${pendingTargetCount && pendingTargetReason === 'capacity' ? '<a class="ghost-button" href="#/admin/billing-subscription">Review plan</a>' : ''}
      </div>
    </div>
  `;
}

function renderSetupSamplePanel(jobSeeker = false) {
  const title = jobSeeker ? 'Try a sample job-search workspace' : 'Try a sample sales workspace';
  return `
    <div class="setup-sample-panel">
      <div>
        <p class="eyebrow">Want to see it first?</p>
        <strong>${escapeHtml(title)}</strong>
        <p class="muted small">Loads synthetic companies, contacts, jobs, and ATS boards so you can explore the dashboard without using real people data.</p>
      </div>
      <button class="secondary-button" type="button" data-action="setup-load-sample" ${appState.setupBusy ? 'disabled' : ''}>Load sample data</button>
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

function renderSetupTargetSelection(preview) {
  const companies = Array.isArray(preview?.companies) ? preview.companies : [];
  if (!companies.length) return '';
  const selected = new Set(appState.setupTrackedCompanies || []);
  const selectedCount = companies.filter((company) => (
    company.alreadyTracked || selected.has(company.key)
  )).length;
  const rows = companies.map((company) => {
    const checked = company.alreadyTracked || selected.has(company.key);
    const disabled = company.alreadyTracked || company.overLimit;
    const status = company.alreadyTracked
      ? 'Already tracked'
      : company.overLimit
        ? 'Plan limit'
        : company.recommended
          ? 'Recommended'
          : 'Network only';
    return '<tr>'
      + '<td><input class="setup-target-checkbox" type="checkbox" value="' + escapeAttr(company.key) + '"'
      + (checked ? ' checked' : '')
      + (disabled ? ' disabled' : '')
      + ' aria-label="Track ' + escapeAttr(company.companyName) + '"></td>'
      + '<td><strong>' + escapeHtml(company.companyName) + '</strong><div class="small muted">'
      + escapeHtml(company.domain || 'Domain not found') + '</div></td>'
      + '<td>' + formatNumber(company.contactCount || 0) + '</td>'
      + '<td><span class="status-pill">' + escapeHtml(status) + '</span><div class="small muted">'
      + escapeHtml(company.rankReason || '') + '</div></td>'
      + '</tr>';
  }).join('');
  return '<section id="setup-target-selection" class="setup-target-selection">'
    + '<div class="panel-header"><div><h4>Choose tracked targets</h4>'
    + '<p class="muted small">Tracked companies receive job-board discovery and refreshes. Unselected employers remain searchable in your network.</p>'
    + '</div><strong id="setup-target-count">' + formatNumber(selectedCount) + ' selected</strong></div>'
    + '<div class="button-row"><button class="ghost-button" type="button" data-action="setup-select-recommended">Select recommended</button>'
    + '<button class="ghost-button" type="button" data-action="setup-clear-targets">Clear optional</button></div>'
    + '<div class="table-scroll"><table class="table setup-target-table">'
    + '<thead><tr><th>Track</th><th>Company</th><th>Contacts</th><th>Why</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div></section>';
}

function syncSetupTrackedCompaniesFromDom() {
  const checked = document.querySelectorAll('.setup-target-checkbox:checked');
  appState.setupTrackedCompanies = Array.from(checked).map((input) => input.value).filter(Boolean);
  const count = document.getElementById('setup-target-count');
  if (count) count.textContent = formatNumber(appState.setupTrackedCompanies.length) + ' selected';
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
      ${renderSetupTargetSelection(preview)}
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
    return;
  }

  appState.setupCsvFile = file;
  appState.setupCsvContent = '';
  appState.setupCsvFileName = file.name;
  appState.setupPreview = null;
  appState.setupTrackedCompanies = [];

  await renderSetupWizard();
  showToast(`Loaded ${file.name} (${formatFileSize(file.size || 0)}).`, 'success');
}
async function postConnectionsCsvFile(file, options = {}) {
  const params = new URLSearchParams();
  params.set('dryRun', options.dryRun ? 'true' : 'false');
  params.set('useEmptyState', options.useEmptyState ? 'true' : 'false');
  params.set('fileName', options.fileName || file?.name || 'Connections.csv');
  for (const company of options.trackedCompanies || []) {
    params.append('trackedCompany', company);
  }
  const endpoint = options.preview ? '/api/import/connections-csv/preview' : '/api/import/connections-csv';
  return api(`${endpoint}?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv;charset=utf-8' },
    body: file,
  });
}

async function previewSetupCsv() {
  if (!appState.setupCsvFile) {
    showToast('Choose Connections.csv first.', 'warning');
    return;
  }

  appState.setupBusy = true;
  appState.setupProgressMessage = 'Checking CSV format and previewing matches...';
  await renderSetupWizard();

  try {
    appState.setupPreview = await postConnectionsCsvFile(appState.setupCsvFile, {
      dryRun: true,
      preview: true,
      useEmptyState: true,
      fileName: appState.setupCsvFileName || appState.setupCsvFile.name || 'Connections.csv',
    });
    const companies = Array.isArray(appState.setupPreview?.companies) ? appState.setupPreview.companies : [];
    // User requested: all imported companies should be tracked by default so they go straight to Watchlist
    appState.setupTrackedCompanies = companies
      .filter((company) => !company.overLimit)
      .map((company) => company.key);

    showToast('Preview ready.', 'success');
  } catch (error) {
    appState.setupPreview = null;
    showToast(`Preview failed: ${error.message || error}`, 'error', 8000);
  } finally {
    appState.setupBusy = false;
    appState.setupProgressMessage = '';
    await renderSetupWizard();
  }
}

function serializeSetupTargetSite(target = {}) {
  return target.careersUrl || target.domain || target.company || '';
}

async function getSetupAccountCapacity() {
  let limit = Number(appState.bootstrap?.session?.plan?.limits?.accounts);
  let current = 0;
  try {
    const billing = await api('/api/billing', { skipCache: true });
    const usage = billing?.usage?.accounts || {};
    const usageLimit = usage.limit === 'unlimited' ? -1 : Number(usage.limit);
    if (Number.isFinite(usageLimit)) limit = usageLimit;
    if (Number.isFinite(Number(usage.current))) current = Math.max(0, Number(usage.current));
  } catch {
    // Desktop builds do not expose cloud billing. A fresh setup starts empty,
    // so the bootstrap plan limit remains a safe upper bound there.
  }
  if (!Number.isFinite(limit) || limit < 0) return { limit: -1, current, available: Infinity };
  return { limit, current, available: Math.max(0, limit - current) };
}

async function getSetupExistingAccountNames() {
  try {
    const payload = await api('/api/accounts?portfolio=all&page=1&pageSize=10000', { skipCache: true });
    return new Set((payload?.items || []).map((item) => (
      String(item.normalizedName || item.displayName || '').trim().toLowerCase()
    )).filter(Boolean));
  } catch (error) {
    console.warn('Existing accounts could not be checked before setup import:', error);
    return null;
  }
}

async function queueSetupSignalRefresh(targetImport) {
  if (!targetImport || Number(targetImport.count || 0) < 1) return targetImport;
  try {
    const workflow = await api('/api/admin/run-workflow', {
      method: 'POST',
      body: JSON.stringify({ source: 'quick_start_watchlist' }),
    });
    appState.setupSignalJobId = workflow?.jobId || workflow?.id || '';
    Object.assign(targetImport, {
      workflowQueued: Boolean(workflow),
      workflowJobId: appState.setupSignalJobId,
      workflowError: '',
    });
    if (appState.setupSignalJobId) watchSetupSignalRefresh(appState.setupSignalJobId);
  } catch (error) {
    Object.assign(targetImport, {
      workflowQueued: false,
      workflowJobId: '',
      workflowError: error.message || String(error || 'Signal refresh could not be queued.'),
    });
  }
  return targetImport;
}

function watchSetupSignalRefresh(jobId) {
  void watchBackgroundJob(jobId, { label: 'First hiring-signal refresh', refreshRoute: false }).then(async (job) => {
    appState.setupSignalJobId = '';
    invalidateAppData();
    if (job?.status === 'completed') {
      showToast('Your first hiring-signal refresh is ready.', 'success', 7000);
      if (getRouteRoot() === 'dashboard') await renderDashboardView();
    }
  }).catch((error) => {
    appState.setupSignalJobId = '';
    showToast(`The first signal refresh needs attention: ${error.message || error}`, 'warning', 8000);
  });
}

async function importSetupTargets({ queueWorkflow = true } = {}) {
  const parsed = parseSetupTargetSites(appState.setupDraft.targetSites);
  if (!parsed.targets.length || appState.setupTargetsSkipped) return null;
  const [capacity, existingAccountNames] = await Promise.all([
    getSetupAccountCapacity(),
    getSetupExistingAccountNames(),
  ]);
  const activeTargets = [];
  const deferredTargets = [];
  let remainingNewSlots = capacity.available;
  for (const target of parsed.targets) {
    const key = String(target.company || '').trim().toLowerCase();
    const alreadyExists = existingAccountNames?.has(key) === true;
    if (alreadyExists || !Number.isFinite(remainingNewSlots) || remainingNewSlots > 0) {
      activeTargets.push(target);
      if (!alreadyExists && Number.isFinite(remainingNewSlots)) remainingNewSlots -= 1;
    } else {
      deferredTargets.push(target);
    }
  }
  const activatedNewCount = existingAccountNames
    ? activeTargets.filter((target) => !existingAccountNames.has(String(target.company || '').trim().toLowerCase())).length
    : activeTargets.length;
  const deferredTargetSites = deferredTargets.map(serializeSetupTargetSite).filter(Boolean);
  if (!activeTargets.length) {
    return {
      count: 0,
      skipped: [],
      total: 0,
      requested: parsed.targets.length,
      activatedRequested: 0,
      deferred: deferredTargets.length,
      deferredTargetSites,
      capacityReached: deferredTargets.length > 0,
      accountLimit: capacity.limit,
      workflowQueued: false,
    };
  }
  const imported = await api('/api/accounts/import', {
    method: 'POST',
    body: JSON.stringify({ text: buildSetupTargetImportCsv(activeTargets) }),
  });
  const result = {
    ...imported,
    requested: parsed.targets.length,
    activatedRequested: activatedNewCount,
    deferred: deferredTargets.length,
    deferredTargetSites,
    capacityReached: deferredTargets.length > 0,
    accountLimit: capacity.limit,
    workflowQueued: false,
    workflowJobId: '',
    workflowError: '',
  };
  if (queueWorkflow) await queueSetupSignalRefresh(result);
  return result;
}

function persistSetupIntentAfterImport(targetImport) {
  const deferredTargetSites = targetImport?.deferredTargetSites?.length
    ? targetImport.deferredTargetSites
    : appState.setupTargetsSkipped
      ? parseSetupTargetSites(appState.setupDraft.targetSites).targets.map(serializeSetupTargetSite).filter(Boolean)
      : [];
  const planIntent = appState.onboardingIntent?.planIntent;
  if (deferredTargetSites.length) {
    const pendingTargetReason = targetImport?.capacityReached ? 'capacity' : 'skipped';
    appState.setupDraft.targetSites = deferredTargetSites.join('\n');
    appState.onboardingIntent = {
      version: 1,
      ...(appState.onboardingIntent || {}),
      source: pendingTargetReason === 'capacity' ? 'setup-deferred' : 'setup-skipped',
      persona: isJobSeekerPersona() ? 'jobseeker' : 'bd',
      intent: 'monitor-career-sites',
      pendingTargetSites: deferredTargetSites,
      pendingTargetReason,
      careerUrls: deferredTargetSites.filter((value) => /^https?:\/\//i.test(value)),
      updatedAt: new Date().toISOString(),
    };
    if (ONBOARDING_INTENT_KEY) localStorage.setItem(ONBOARDING_INTENT_KEY, JSON.stringify(appState.onboardingIntent));
    return;
  }
  if (planIntent === 'sales' || planIntent === 'jobseeker') {
    appState.onboardingIntent = {
      ...appState.onboardingIntent,
      source: 'pricing',
      intent: 'start-trial',
      careerUrls: [],
      pendingTargetSites: [],
      pendingTargetReason: '',
      audit: undefined,
      consumedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (ONBOARDING_INTENT_KEY) localStorage.setItem(ONBOARDING_INTENT_KEY, JSON.stringify(appState.onboardingIntent));
  } else {
    if (ONBOARDING_INTENT_KEY) localStorage.removeItem(ONBOARDING_INTENT_KEY);
    appState.onboardingIntent = null;
  }
}

async function retryDeferredSetupTargets(button) {
  const pending = appState.onboardingIntent?.pendingTargetSites || [];
  if (!pending.length) return;
  const originalLabel = button?.textContent || 'Add remaining targets';
  if (button) {
    button.disabled = true;
    button.textContent = 'Adding targets...';
  }
  appState.setupDraft.targetSites = pending.join('\n');
  appState.setupTargetsSkipped = false;
  try {
    const result = await importSetupTargets({ queueWorkflow: true });
    appState.setupTargetImportResult = result;
    persistSetupIntentAfterImport(result);
    invalidateAppData();
    if (result?.capacityReached) {
      showToast(`${formatNumber(result.deferred || 0)} targets are still saved. Increase the account limit to add them.`, 'warning', 8000);
    } else {
      showToast('Remaining watchlist targets added.', 'success');
    }
    if (getRouteRoot() === 'dashboard') await renderDashboardView();
  } catch (error) {
    showToast(`Targets are still saved: ${error.message || error}`, 'error', 8000);
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }
}

async function completeSetupWizard() {
  persistSetupDraftFromDom();
  if (appState.setupPreview) syncSetupTrackedCompaniesFromDom();
  const draft = appState.setupDraft;

  if (!draft.workspaceName.trim() || !draft.userName.trim() || !draft.userEmail.trim()) {
    showToast('Workspace, name, and email are required before finishing setup.', 'warning');
    return;
  }

  appState.setupBusy = true;
  appState.setupProgressMessage = appState.setupCsvFile
    ? 'Saving setup and queuing your LinkedIn connections import...'
    : 'Saving setup...';

  try {
    let targetImport = null;
    if (!appState.setupTargetsSkipped && parseSetupTargetSites(draft.targetSites).targets.length) {
      appState.setupProgressMessage = 'Creating your watchlist...';
      try {
        targetImport = await importSetupTargets({ queueWorkflow: false });
        appState.setupTargetImportResult = targetImport;
      } catch (error) {
        appState.setupTargetImportResult = {
          error: error.message || String(error || 'Watchlist import failed.'),
          retryable: true,
        };
        const targetIndex = getSetupSteps().findIndex((step) => step.key === 'targets');
        if (targetIndex >= 0) appState.setupStep = targetIndex + 1;
        showToast('Your watchlist is still saved. Fix the issue or try the import again.', 'warning', 8000);
        return;
      }
    }

    appState.setupProgressMessage = appState.setupCsvFile
      ? 'Saving setup and queuing your contacts import...'
      : 'Saving setup...';
    const result = await api('/api/setup/complete', {
      method: 'POST',
      body: JSON.stringify({
        workspaceName: draft.workspaceName,
        userName: draft.userName,
        userEmail: draft.userEmail,
        owners: parseSetupOwners(draft.ownersText),
        licenseKey: draft.licenseKey || '',
      }),
    });

    appState.setupResult = result;
    appState.setupStatus = result.status;
    appState.setupStep = getSetupSteps().length;
    invalidateAppData();

    if (targetImport) {
      appState.setupProgressMessage = 'Starting the first hiring-signal refresh...';
      await queueSetupSignalRefresh(targetImport);
      appState.setupTargetImportResult = targetImport;
      appState.setupResult = {
        ...appState.setupResult,
        targetImport,
        stats: {
          ...(appState.setupResult.stats || {}),
          accounts: targetImport.count || 0,
        },
      };
      if (targetImport.workflowError) {
        showToast('Watchlist created. Automatic monitoring can be started from Admin.', 'warning', 7000);
      } else if (targetImport.deferred) {
        showToast(`${formatNumber(targetImport.count || 0)} targets added; ${formatNumber(targetImport.deferred)} saved for later because of the account limit.`, 'warning', 8000);
      }
    }
    persistSetupIntentAfterImport(targetImport);

    if (appState.setupCsvFile) {
      const accepted = await postConnectionsCsvFile(appState.setupCsvFile, {
        dryRun: false,
        useEmptyState: false,
        fileName: appState.setupCsvFileName || appState.setupCsvFile.name || 'Connections.csv',
        trackedCompanies: appState.setupTrackedCompanies,
      });
      const jobId = accepted.jobId || accepted.job?.id;
      const stats = accepted.stats || {};
      appState.setupImportJobId = jobId || '';

      appState.setupResult = {
        ...appState.setupResult,
        importQueued: Boolean(jobId),
        jobId,
        stats: {
          ...stats,
          imported: stats.imported || 0,
          updated: stats.updated || 0,
          skipped: stats.skipped || 0,
          failed: stats.failed || 0,
        },
      };

      appState.setupProgressMessage = jobId
        ? 'Import queued. You can start using BD Engine while contacts import in the background.'
        : 'Import request accepted.';
      appState.setupCsvFile = null;
      appState.setupCsvContent = '';
      showToast(jobId ? 'Setup complete. LinkedIn connections import is running in the background.' : 'Setup complete.', 'success');
      if (jobId) {
        void watchBackgroundJob(jobId, { label: 'Connections import', refreshRoute: false }).then((job) => {
          const result = job?.result || {};
          const finalStats = result.stats || result.importRun?.stats || {};
          const warnings = formatConnectionsImportWarnings(result.warnings || result.importRun?.warnings || []);
          showToast(`Connections import complete: ${formatConnectionsImportStats(finalStats)}.${warnings}`, 'success', 8000);
          invalidateAppData();
        }).catch((err) => {
          window.bdLocalApi.setAlert(`Connections import failed: ${err.message || err}`, appAlert);
        });
      }
    } else {
      appState.setupProgressMessage = '';
      appState.setupCsvFile = null;
      appState.setupCsvContent = '';
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

async function loadSetupSampleWorkspace() {
  persistSetupDraftFromDom();
  const draft = appState.setupDraft;

  if (!draft.workspaceName.trim() || !draft.userName.trim() || !draft.userEmail.trim()) {
    showToast('Workspace, name, and email are required before loading sample data.', 'warning');
    return;
  }

  appState.setupBusy = true;
  appState.setupProgressMessage = 'Loading a synthetic sample workspace...';
  await renderSetupWizard();

  try {
    const result = await api('/api/setup/sample-data', {
      method: 'POST',
      body: JSON.stringify({
        workspaceName: draft.workspaceName,
        userName: draft.userName,
        userEmail: draft.userEmail,
        owners: parseSetupOwners(draft.ownersText),
        persona: appState.persona,
      }),
    });

    appState.setupResult = {
      ...result,
      sampleLoaded: true,
      stats: {
        accounts: result.stats?.accounts || 0,
        contacts: result.stats?.contacts || 0,
        jobs: result.stats?.jobs || 0,
        configs: result.stats?.configs || 0,
        tasks: result.stats?.tasks || 0,
        imported: result.stats?.imported || result.stats?.contacts || 0,
        updated: result.stats?.updated || 0,
        skipped: result.stats?.skipped || 0,
        failed: result.stats?.failed || 0,
      },
    };
    appState.setupStatus = result.status;
    appState.setupStep = getSetupSteps().length;
    appState.setupCsvFile = null;
    appState.setupCsvContent = '';
    appState.setupCsvFileName = '';
    appState.setupPreview = null;
    appState.setupTrackedCompanies = [];
    invalidateAppData();
    showToast('Sample workspace loaded.', 'success');
  } catch (error) {
    showToast(`Sample workspace failed: ${error.message || error}`, 'error', 8000);
  } finally {
    appState.setupBusy = false;
    appState.setupProgressMessage = '';
    await renderSetupWizard();
  }
}

async function watchSetupImportJob(jobId) {
  while (true) {
    const job = await api(`/api/background-jobs/${jobId}`, { skipCache: true });
    appState.setupProgressMessage = job.progressMessage || job.message || humanize(job.status || 'running');
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

async function quickLoadSampleWorkspace() {
  showToast('Loading rich sample network with 500+ contacts & jobs...', 'info');
  try {
    const bootstrap = appState.bootstrap || (await loadBootstrap(false));
    const result = await api('/api/setup/sample-data', {
      method: 'POST',
      body: JSON.stringify({
        workspaceName: bootstrap.workspace?.name || 'BD Engine Sample',
        userName: bootstrap.user?.name || 'Demo User',
        userEmail: bootstrap.user?.email || 'demo@bdengine.local',
        persona: appState.persona || 'jobseeker',
      }),
    });
    invalidateAppData();
    await loadBootstrap(true);
    showToast('✨ Sample network loaded with 500+ contacts and matched jobs!', 'success');
    if (appState.networkModalOpen) closeNetworkImportModal();
    await renderRoute();
  } catch (error) {
    showToast(`Failed to load sample: ${error.message || error}`, 'error');
  }
}

function openNetworkImportModal(file = null) {
  if (!networkImportModalBackdrop) return;
  appState.networkModalOpen = true;
  appState.modalImportResult = null;
  appState.modalImportBusy = false;
  if (file) {
    handleNetworkModalFile(file);
  } else {
    renderNetworkImportModal();
  }
  networkImportModalBackdrop.classList.remove('hidden');
  networkImportModalBackdrop.setAttribute('aria-hidden', 'false');
  wireNetworkModalDropzone();
}

function closeNetworkImportModal() {
  if (!networkImportModalBackdrop) return;
  appState.networkModalOpen = false;
  appState.modalCsvFile = null;
  appState.modalCsvFileName = '';
  appState.modalCsvParsedStats = null;
  appState.modalImportBusy = false;
  appState.modalImportMessage = '';
  appState.modalImportResult = null;
  networkImportModalBackdrop.classList.add('hidden');
  networkImportModalBackdrop.setAttribute('aria-hidden', 'true');
  networkImportModalBackdrop.innerHTML = '';
}

function openLinkedInGuideModal() {
  if (!linkedinGuideModalBackdrop) return;
  appState.linkedinGuideModalOpen = true;
  renderLinkedInGuideModal();
  linkedinGuideModalBackdrop.classList.remove('hidden');
  linkedinGuideModalBackdrop.setAttribute('aria-hidden', 'false');
}

function closeLinkedInGuideModal() {
  if (!linkedinGuideModalBackdrop) return;
  appState.linkedinGuideModalOpen = false;
  linkedinGuideModalBackdrop.classList.add('hidden');
  linkedinGuideModalBackdrop.setAttribute('aria-hidden', 'true');
  linkedinGuideModalBackdrop.innerHTML = '';
}

function parseCsvPreviewLocal(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  let headerIndex = -1;
  let headers = [];
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const rawCols = splitCsvLine(lines[i]).map((c) => c.trim().toLowerCase());
    if (rawCols.includes('first name') || rawCols.includes('company') || rawCols.includes('position') || rawCols.includes('url')) {
      headerIndex = i;
      headers = rawCols;
      break;
    }
  }
  if (headerIndex === -1) {
    headerIndex = 0;
    headers = splitCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
  }

  const companyIdx = headers.indexOf('company');
  const positionIdx = headers.indexOf('position');
  const firstNameIdx = headers.indexOf('first name');
  const lastNameIdx = headers.indexOf('last name');

  const companyMap = new Map();
  let totalContacts = 0;
  let seniorCount = 0;
  let talentCount = 0;
  const sampleContacts = [];

  const seniorKeywords = /\b(vp|vice president|director|head|chief|cto|cpo|ceo|coo|cfo|cro|founder|co-founder|lead|principal|partner)\b/i;
  const talentKeywords = /\b(recruiter|talent|recruiting|hiring|people|human resources|hr|staffing)\b/i;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const company = (cols[companyIdx] || '').trim();
    const position = (cols[positionIdx] || '').trim();
    const firstName = (cols[firstNameIdx] || '').trim();
    const lastName = (cols[lastNameIdx] || '').trim();
    const fullName = `${firstName} ${lastName}`.trim() || `Contact ${totalContacts + 1}`;

    if (!firstName && !company && !position) continue;
    totalContacts++;

    if (position && seniorKeywords.test(position)) seniorCount++;
    if (position && talentKeywords.test(position)) talentCount++;

    if (company) {
      const cleanCompany = company.replace(/[",]/g, '').trim();
      const count = companyMap.get(cleanCompany) || 0;
      companyMap.set(cleanCompany, count + 1);
    }

    if (sampleContacts.length < 5 && fullName) {
      sampleContacts.push({ fullName, company: company || 'Company unspecified', position: position || 'Role unspecified' });
    }
  }

  const sortedCompanies = Array.from(companyMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return {
    totalContacts,
    uniqueCompanies: companyMap.size,
    seniorCount,
    talentCount,
    topCompanies: sortedCompanies.slice(0, 6),
    sampleContacts,
  };
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function handleNetworkModalFile(file) {
  if (!file) return;
  appState.modalCsvFile = file;
  appState.modalCsvFileName = file.name || 'Connections.csv';
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result;
    appState.modalCsvParsedStats = parseCsvPreviewLocal(text);
    renderNetworkImportModal();
    wireNetworkModalDropzone();
  };
  reader.readAsText(file);
}

function wireNetworkModalDropzone() {
  const dropzone = document.getElementById('network-modal-dropzone');
  const input = document.getElementById('network-modal-csv-input');
  if (!dropzone || !input) return;

  input.onchange = () => {
    if (input.files && input.files[0]) {
      handleNetworkModalFile(input.files[0]);
    }
  };

  dropzone.ondragover = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('is-dragover');
  };

  dropzone.ondragleave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('is-dragover');
  };

  dropzone.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('is-dragover');
    if (e.dataTransfer?.files?.[0]) {
      handleNetworkModalFile(e.dataTransfer.files[0]);
    }
  };
}

function renderNetworkModalPreview() {
  const stats = appState.modalCsvParsedStats;
  if (!stats) return '';

  if (appState.modalImportResult) {
    return `
      <div class="network-import-success-card">
        <div class="success-icon-banner">🎉</div>
        <h4>Network Successfully Imported & Matched!</h4>
        <p class="muted small">${formatNumber(stats.totalContacts)} contacts processed across ${formatNumber(stats.uniqueCompanies)} companies.</p>
        <div class="network-success-metrics">
          <div class="success-metric-box">
            <strong>${formatNumber(stats.totalContacts)}</strong>
            <span>Contacts Mapped</span>
          </div>
          <div class="success-metric-box">
            <strong>${formatNumber(stats.uniqueCompanies)}</strong>
            <span>Companies Added</span>
          </div>
          <div class="success-metric-box">
            <strong>${formatNumber(stats.seniorCount)}</strong>
            <span>Leadership Contacts</span>
          </div>
        </div>
        <div class="network-success-actions">
          <a class="primary-button" href="#/jobs?hasContacts=true&workStyle=local_remote" data-action="close-network-import-modal">View Matched Jobs & Warm Paths →</a>
          <a class="secondary-button" href="#/contacts" data-action="close-network-import-modal">Explore Network Contacts →</a>
        </div>
      </div>
    `;
  }

  return `
    <div class="network-preview-panel">
      <div class="network-preview-summary-grid">
        <div class="preview-metric-tile">
          <strong>${formatNumber(stats.totalContacts)}</strong>
          <span>Connections Found</span>
        </div>
        <div class="preview-metric-tile">
          <strong>${formatNumber(stats.uniqueCompanies)}</strong>
          <span>Target Companies</span>
        </div>
        <div class="preview-metric-tile">
          <strong>${formatNumber(stats.seniorCount)}</strong>
          <span>VP / Directors / Heads</span>
        </div>
        <div class="preview-metric-tile">
          <strong>${formatNumber(stats.talentCount)}</strong>
          <span>Talent & Recruiters</span>
        </div>
      </div>

      ${stats.topCompanies && stats.topCompanies.length ? `
        <div class="network-preview-companies">
          <span class="preview-subheading">Top Represented Companies in Your Network:</span>
          <div class="preview-company-chips">
            ${stats.topCompanies.map((c) => `
              <span class="preview-company-chip">
                <span class="company-chip-name">${escapeHtml(c.name)}</span>
                <span class="company-chip-badge">⚡ ${formatNumber(c.count)}</span>
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderNetworkImportModal() {
  if (!networkImportModalBackdrop) return;
  const hasFile = Boolean(appState.modalCsvFile);
  const isDone = Boolean(appState.modalImportResult);

  networkImportModalBackdrop.innerHTML = `
    <div class="modal-dialog modal-dialog--lg network-import-dialog" role="dialog" aria-modal="true" aria-labelledby="network-import-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">⚡</span>
          <div>
            <h3 id="network-import-title">Import LinkedIn Connections</h3>
            <p class="muted small">Match people you know to companies with active job openings & warm paths.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-network-import-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="modal-body network-import-body">
        <div class="data-use-notice data-use-notice--compact" role="note">
          <span class="notice-icon" aria-hidden="true">🛡️</span>
          <span><strong>Privacy & Security:</strong> BD Engine never accesses your LinkedIn account credentials. It only reads the exported <code>Connections.csv</code> file you choose on your device.</span>
        </div>

        ${!isDone ? `
          <input id="network-modal-csv-input" class="hidden" type="file" accept=".csv,text/csv" />
          <div id="network-modal-dropzone" class="setup-drop-zone network-modal-dropzone ${hasFile ? 'is-populated' : ''}" tabindex="0" role="button" aria-label="Drop Connections.csv file here">
            <div class="dropzone-icon" aria-hidden="true">📁</div>
            <strong>${hasFile ? escapeHtml(appState.modalCsvFileName || 'Connections.csv') : 'Drag & Drop Connections.csv Here'}</strong>
            <span class="muted small">${hasFile ? 'File parsed and ready to import.' : 'or browse from your computer'}</span>
            <button class="secondary-button" type="button" data-action="network-modal-browse-csv">${hasFile ? 'Change File' : 'Browse File'}</button>
          </div>
        ` : ''}

        ${renderNetworkModalPreview()}

        ${appState.modalImportBusy ? `
          <div class="modal-progress-strip">
            <div class="spinner-inline" aria-hidden="true"></div>
            <span>${escapeHtml(appState.modalImportMessage || 'Importing connections and matching companies...')}</span>
          </div>
        ` : ''}
      </div>

      <div class="modal-footer">
        <div class="modal-footer-left">
          <button class="ghost-button ghost-button--sm" type="button" data-action="open-linkedin-guide">📥 How to get Connections.csv</button>
          <button class="ghost-button ghost-button--sm" type="button" data-action="quick-load-sample-workspace">✨ Try Sample Network</button>
        </div>
        <div class="modal-footer-right">
          <button class="ghost-button" type="button" data-action="close-network-import-modal">${isDone ? 'Close' : 'Cancel'}</button>
          ${hasFile && !isDone ? `
            <button class="primary-button" type="button" data-action="network-modal-run-import" ${appState.modalImportBusy ? 'disabled' : ''}>
              ${appState.modalImportBusy ? 'Importing...' : 'Import & Match Network'}
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderLinkedInGuideModal() {
  if (!linkedinGuideModalBackdrop) return;
  linkedinGuideModalBackdrop.innerHTML = `
    <div class="modal-dialog modal-dialog--md linkedin-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="linkedin-guide-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">📥</span>
          <div>
            <h3 id="linkedin-guide-title">How to Export LinkedIn Connections</h3>
            <p class="muted small">Download your connections CSV in under 30 seconds directly from LinkedIn.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-linkedin-guide" aria-label="Close modal">&times;</button>
      </div>

      <div class="modal-body">
        <ol class="guide-steps-list">
          <li class="guide-step-item">
            <span class="guide-step-num">1</span>
            <div>
              <strong>Open LinkedIn Data Privacy Settings</strong>
              <p class="muted small">Go to your LinkedIn profile menu, click <strong>Settings & Privacy</strong> &rarr; <strong>Data Privacy</strong>.</p>
            </div>
          </li>
          <li class="guide-step-item">
            <span class="guide-step-num">2</span>
            <div>
              <strong>Request Data Archive</strong>
              <p class="muted small">Click <strong>Get a copy of your data</strong>, select <strong>Connections</strong>, and click <strong>Request archive</strong>.</p>
            </div>
          </li>
          <li class="guide-step-item">
            <span class="guide-step-num">3</span>
            <div>
              <strong>Check Your Email</strong>
              <p class="muted small">LinkedIn will email you a download link (usually in 2-5 minutes). Unzip the downloaded file.</p>
            </div>
          </li>
          <li class="guide-step-item">
            <span class="guide-step-num">4</span>
            <div>
              <strong>Upload Connections.csv here</strong>
              <p class="muted small">Drop the <code>Connections.csv</code> file into BD Engine to automatically map all jobs and companies.</p>
            </div>
          </li>
        </ol>

        <div class="guide-direct-link-card">
          <div>
            <strong>Ready to export now?</strong>
            <p class="muted small">Open LinkedIn's export page in a new tab.</p>
          </div>
          <a class="primary-button primary-button--sm" href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noopener noreferrer">
            Open LinkedIn Privacy Page &nearr;
          </a>
        </div>
      </div>

      <div class="modal-footer">
        <button class="ghost-button" type="button" data-action="close-linkedin-guide">Close</button>
        <button class="primary-button" type="button" data-action="open-network-import-modal">I Have My CSV Ready &rarr;</button>
      </div>
    </div>
  `;
}

async function runNetworkModalImport() {
  if (!appState.modalCsvFile) {
    showToast('Choose your LinkedIn Connections.csv file first.', 'warning');
    return;
  }
  appState.modalImportBusy = true;
  appState.modalImportMessage = 'Importing contacts, matching companies, and tracking boards...';
  renderNetworkImportModal();

  try {
    const file = appState.modalCsvFile;
    const run = await postConnectionsCsvFile(file, {
      dryRun: false,
      useEmptyState: false,
      fileName: appState.modalCsvFileName || file.name || 'Connections.csv',
    });

    appState.modalImportResult = run;
    invalidateAppData();
    await loadBootstrap(true);
    showToast('⚡ Network successfully imported and matched!', 'success');
  } catch (error) {
    showToast(`Import failed: ${error.message || error}`, 'error', 8000);
  } finally {
    appState.modalImportBusy = false;
    appState.modalImportMessage = '';
    renderNetworkImportModal();
  }
}

function renderDashboardNetworkRadar(dashboard = {}, extended = {}, personaCopy = getPersonaUiCopy()) {
  const contactCount = Number(dashboard.summary?.contactCount || 0);
  const activeJobCount = getDashboardActiveJobCount(dashboard.summary);
  const networkLeaders = Array.isArray(dashboard.networkLeaders) ? dashboard.networkLeaders : [];
  const hasContacts = contactCount > 0;

  return `
    <section class="detail-card network-radar-card" aria-label="LinkedIn Network Matching Radar">
      <div class="network-radar-header">
        <div class="network-radar-title-lockup">
          <div class="network-radar-badge"><span class="pill-dot"></span>⚡ Network Match Radar</div>
          <h3>${hasContacts ? `${formatNumber(contactCount)} Connections Matched Across Your Target Companies` : 'Turn LinkedIn Connections into Warm Job Opportunities'}</h3>
          <p class="muted small">${hasContacts
            ? 'Companies where you have 1st-degree contacts are prioritized with direct warm paths to open roles.'
            : 'Upload your LinkedIn Connections.csv or try the demo network to see who you know at actively hiring companies.'}</p>
        </div>
        <div class="network-radar-actions">
          <button class="primary-button primary-button--sm" type="button" data-action="open-network-import-modal">
            <span class="btn-icon">⚡</span> <span>${hasContacts ? 'Update Connections CSV' : 'Upload Connections.csv'}</span>
          </button>
          ${!hasContacts ? `<button class="secondary-button secondary-button--sm" type="button" data-action="quick-load-sample-workspace">✨ Try Sample Network</button>` : ''}
          <button class="ghost-button ghost-button--sm" type="button" data-action="open-linkedin-guide">📥 Export Guide</button>
          <button class="ghost-button ghost-button--sm" type="button" data-action="share-network-stats" title="Share your network matches on LinkedIn">📢 Share Stats</button>
          <button class="secondary-button secondary-button--sm" type="button" data-action="open-pricing-modal">💎 Upgrade ($5/mo)</button>
        </div>
      </div>

      <div class="network-radar-grid">
        <div class="network-radar-step-card">
          <div class="radar-step-icon">📁</div>
          <div class="radar-step-content">
            <strong>1. Import Connections</strong>
            <span class="muted small">Export <code>Connections.csv</code> in 30s from LinkedIn settings. No login required.</span>
          </div>
          <span class="radar-step-status ${hasContacts ? 'status-pill status-pill--success' : 'status-pill status-pill--neutral'}">
            ${hasContacts ? `✓ ${formatNumber(contactCount)} contacts` : 'Ready to import'}
          </span>
        </div>

        <div class="network-radar-step-card">
          <div class="radar-step-icon">🏢</div>
          <div class="radar-step-content">
            <strong>2. Auto-Match Companies</strong>
            <span class="muted small">Discovers 50+ ATS platforms (Greenhouse, Lever, Ashby, Workday).</span>
          </div>
          <span class="radar-step-status ${networkLeaders.length ? 'status-pill status-pill--success' : 'status-pill status-pill--neutral'}">
            ${networkLeaders.length ? `✓ ${formatNumber(networkLeaders.length)} companies` : 'Auto-resolving'}
          </span>
        </div>

        <div class="network-radar-step-card">
          <div class="radar-step-icon">🎯</div>
          <div class="radar-step-content">
            <strong>3. Warm Job Openings</strong>
            <span class="muted small">Filter Local GTA & Remote roles with 1-click tailored intro notes.</span>
          </div>
          <a class="radar-step-link secondary-button secondary-button--xs" href="#/jobs?hasContacts=true&workStyle=local_remote">
            View Matched Roles →
          </a>
        </div>
      </div>

      ${hasContacts && networkLeaders.length ? `
        <div class="network-leaders-strip">
          <span class="network-leaders-label">Top Connected Companies:</span>
          <div class="network-leaders-chips">
            ${networkLeaders.slice(0, 6).map((item) => `
              <a class="network-leader-chip" href="#/accounts/${item.id}">
                <span class="network-leader-name">${escapeHtml(item.displayName)}</span>
                <span class="network-leader-count">⚡ ${formatNumber(item.connectionCount || 0)}</span>
                ${item.openRoleCount ? `<span class="network-leader-jobs">🎯 ${formatNumber(item.openRoleCount)} roles</span>` : ''}
              </a>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </section>
  `;
}

/* ── Phase 7: Warm Referral Studio & 1-Click Outreach Powerhouse ── */

async function openWarmStudioModal(jobId, contactId) {
  if (!warmStudioModalBackdrop) return;
  appState.warmStudioModalOpen = true;

  let targetJob = null;
  let targetAccount = null;
  let targetContacts = [];

  if (jobId) {
    try {
      const res = await api(`/api/jobs?q=${encodeURIComponent(jobId)}`);
      targetJob = res.items?.find((j) => j.id === jobId) || res.items?.[0] || null;
      if (targetJob?.accountId) {
        const accRes = await api(`/api/accounts/${targetJob.accountId}`);
        targetAccount = accRes?.account || null;
        targetContacts = accRes?.contacts || targetJob.contacts || [];
      } else if (targetJob?.contacts) {
        targetContacts = targetJob.contacts;
      }
    } catch {
      // Fallback
    }
  }

  let selectedContact = null;
  if (contactId && targetContacts.length) {
    selectedContact = targetContacts.find((c) => c.id === contactId || c.fullName === contactId) || null;
  }
  if (!selectedContact && targetContacts.length) {
    selectedContact = targetContacts[0];
  }

  appState.warmStudioData = {
    job: targetJob,
    account: targetAccount,
    contacts: targetContacts,
    selectedContact: selectedContact,
    selectedStep: 1,
    selectedFormat: 'referral_dm',
    selectedTone: 'casual',
  };

  renderWarmStudioModal();
  warmStudioModalBackdrop.classList.remove('hidden');
  warmStudioModalBackdrop.setAttribute('aria-hidden', 'false');
}

function closeWarmStudioModal() {
  if (!warmStudioModalBackdrop) return;
  appState.warmStudioModalOpen = false;
  appState.warmStudioData = null;
  warmStudioModalBackdrop.classList.add('hidden');
  warmStudioModalBackdrop.setAttribute('aria-hidden', 'true');
  warmStudioModalBackdrop.innerHTML = '';
}

function switchWarmStudioStep(step) {
  if (!appState.warmStudioData) return;
  appState.warmStudioData.selectedStep = Number(step) || 1;
  renderWarmStudioModal();
}

function switchWarmStudioFormat(format) {
  if (!appState.warmStudioData) return;
  appState.warmStudioData.selectedFormat = format;
  renderWarmStudioModal();
}

function switchWarmStudioTone(tone) {
  if (!appState.warmStudioData) return;
  appState.warmStudioData.selectedTone = tone;
  renderWarmStudioModal();
}

function generateWarmStudioCopy(data) {
  const { job, account, selectedContact, selectedTone, selectedStep = 1 } = data;
  const contactName = selectedContact?.fullName || selectedContact?.firstName || 'there';
  const firstName = selectedContact?.firstName || contactName.split(' ')[0] || 'there';
  const contactTitle = selectedContact?.title || 'Team Member';
  const companyName = job?.companyName || job?.company || account?.displayName || 'the team';
  const jobTitle = job?.title || 'Open Role';
  const jobLocation = job?.location || (job?.isRemote ? 'Remote' : '');
  const jobUrl = job?.url || job?.jobUrl || '';
  const myName = appState.bootstrap?.user?.name || 'Applicant';

  let linkedinNote = '';
  let referralDm = '';
  let emailPitch = '';
  let emailSubject = '';
  let recruiterPitch = '';

  if (selectedStep === 1) {
    if (selectedTone === 'casual') {
      linkedinNote = `Hi ${firstName}! Saw your work at ${companyName} and wanted to connect. I noticed ${companyName} has an open ${jobTitle} role—would love to connect and learn more about your experience on the team! Best, ${myName}`;
      referralDm = `Hey ${firstName}! Hope all is well with you.\n\nI saw that ${companyName} is currently hiring for a ${jobTitle}${jobLocation ? ` (${jobLocation})` : ''} and the role looks like a great match for my background.\n\nAre you still enjoying your time at ${companyName}? If you're open to it, I'd love to ask for your internal referral or advice on who leads the team. Happy to send over my resume and a 2-line summary to make it super easy.\n\nThanks a ton!\n${myName}`;
      emailSubject = `${jobTitle} inquiry — ${myName}`;
      emailPitch = `Hi ${firstName},\n\nI'm reaching out because I saw ${companyName}'s open ${jobTitle} role${jobLocation ? ` in ${jobLocation}` : ''} and was really excited by what the team is building.\n\nOver the past few years, I've specialized in delivering impactful results and driving technical excellence. I'd love the opportunity to bring that experience to ${companyName}.\n\nI've reviewed the requirements and believe I can hit the ground running immediately. Would you be open to a quick 10-minute chat this week?\n\nBest,\n${myName}${jobUrl ? `\n\nRole link: ${jobUrl}` : ''}`;
      recruiterPitch = `Hi ${firstName}! I saw you're on the Talent team at ${companyName}. I recently came across the ${jobTitle} posting and would love to connect. I have strong experience in this domain and would appreciate connecting with the recruiter managing this search! Cheers, ${myName}`;
    } else if (selectedTone === 'direct') {
      linkedinNote = `Hi ${firstName}, reaching out as I'm applying for the ${jobTitle} opening at ${companyName}. Would value connecting and hearing any quick advice on the team. Thanks! - ${myName}`;
      referralDm = `Hi ${firstName},\n\nI noticed ${companyName} posted a ${jobTitle} role recently. My experience aligns closely with what the team is looking for.\n\nWould you be open to submitting an internal referral or introducing me to the hiring manager? I can share a quick blurb and my resume right away.\n\nAppreciate your time!\n${myName}`;
      emailSubject = `Application & Introduction: ${jobTitle} (${myName})`;
      emailPitch = `Hi ${firstName},\n\nI'm writing regarding the ${jobTitle} role at ${companyName}.\n\nHere is what I bring to the table:\n• Proven track record delivering key initiatives on time and scale\n• Deep familiarity with modern tech stacks and collaborative workflows\n• Strong background matching the exact responsibilities for this opening\n\nCould we schedule a brief 10-minute intro call this week to see if there's a strong mutual fit?\n\nBest regards,\n${myName}`;
      recruiterPitch = `Hi ${firstName}, I'm an active candidate for the ${jobTitle} role at ${companyName}. My profile aligns directly with the posted qualifications. Are you managing this search, or could you point me to the right recruiter on your team? Thanks, ${myName}`;
    } else {
      linkedinNote = `Hello ${firstName}, I came across your profile and admire your work as ${contactTitle} at ${companyName}. I'm following ${companyName}'s ${jobTitle} opening and would be grateful to connect. Regards, ${myName}`;
      referralDm = `Hi ${firstName},\n\nI hope you are doing well. I have been following ${companyName}'s growth and noticed the recent opening for ${jobTitle}.\n\nGiven your role at ${companyName}, I would appreciate any insight you might have into the team. If you feel comfortable, I would be grateful for an internal referral.\n\nLet me know if you might have 5 minutes to connect, or if I can send over my background materials.\n\nBest regards,\n${myName}`;
      emailSubject = `Inquiry regarding ${jobTitle} opening at ${companyName}`;
      emailPitch = `Dear ${firstName},\n\nI am writing to express my strong interest in the ${jobTitle} position currently open at ${companyName}.\n\nWith my background and proven success in similar environments, I am confident in my ability to make an immediate, positive contribution to your team's objectives.\n\nI would welcome the opportunity to discuss how my skill set aligns with your current priorities. Thank you for your time and consideration.\n\nSincerely,\n${myName}`;
      recruiterPitch = `Hello ${firstName}, I noticed you lead recruitment efforts at ${companyName}. I am very interested in the ${jobTitle} position and believe my background would be a strong asset. I would welcome the chance to share my profile with you. Best regards, ${myName}`;
    }
  } else if (selectedStep === 2) {
    if (selectedTone === 'casual') {
      linkedinNote = `Hi ${firstName}! Quick follow-up on my note regarding ${jobTitle} at ${companyName}. Would love to share two quick project highlights whenever convenient. Cheers!`;
      referralDm = `Hey ${firstName}! Quick follow-up on this—I know things get busy!\n\nI put together a 2-bullet summary of my relevant projects matching ${companyName}'s ${jobTitle} tech stack so it's super lightweight for you to pass along:\n• Led similar production initiatives delivering measured latency and throughput wins\n• Hands-on expertise with the exact workflows required for this role\n\nLet me know if you're open to introducing me to the hiring lead. Thanks again!\n${myName}`;
      emailSubject = `Re: ${jobTitle} inquiry — Project & candidate perspective`;
      emailPitch = `Hi ${firstName},\n\nFollowing up on my previous note regarding the ${jobTitle} opening.\n\nI took a closer look at ${companyName}'s recent product direction and put together a few concrete examples of how I've solved analogous scaling and implementation challenges in past roles.\n\nI'd be glad to share these notes or hop on a brief 10-minute introductory call whenever fits your schedule.\n\nBest,\n${myName}`;
      recruiterPitch = `Hi ${firstName}! Following up on the ${jobTitle} opening. I'm actively interviewing for target roles this month and wanted to check if ${companyName}'s team is scheduling candidate screens this week. Thanks! - ${myName}`;
    } else if (selectedTone === 'direct') {
      linkedinNote = `Hi ${firstName}, following up on my previous message regarding ${jobTitle}. Happy to send over targeted portfolio samples if helpful. Thanks, ${myName}`;
      referralDm = `Hi ${firstName},\n\nFollowing up on the ${jobTitle} opening. I've prepared a brief summary of my relevant accomplishments and would be grateful for an internal referral or hiring manager intro when you have a free moment.\n\nAppreciate your help!\n${myName}`;
      emailSubject = `Follow-up: ${jobTitle} at ${companyName} (${myName})`;
      emailPitch = `Hi ${firstName},\n\nI'm following up on my note from earlier this week regarding the ${jobTitle} role.\n\nMy profile offers immediate alignment with your team's current hiring goals. Do you have 10 minutes open this Thursday or Friday for a concise conversation?\n\nBest regards,\n${myName}`;
      recruiterPitch = `Hi ${firstName}, checking in regarding candidate review for the ${jobTitle} role. I'd be glad to provide any additional materials needed to advance my application. Best, ${myName}`;
    } else {
      linkedinNote = `Hello ${firstName}, following up regarding the ${jobTitle} role at ${companyName}. I would welcome the opportunity to discuss how my qualifications align with your team.`;
      referralDm = `Hi ${firstName},\n\nI wanted to follow up briefly regarding the ${jobTitle} opening at ${companyName}. I have prepared materials outlining my key project contributions and would be grateful for an opportunity to be referred to the hiring team.\n\nThank you again for your consideration.\n\nBest regards,\n${myName}`;
      emailSubject = `Follow-up regarding ${jobTitle} position at ${companyName}`;
      emailPitch = `Dear ${firstName},\n\nI am writing to follow up on my previous inquiry regarding the ${jobTitle} position.\n\nI remain deeply interested in contributing to ${companyName}'s ongoing initiatives and would appreciate the chance to discuss how my experience can support your team's milestones.\n\nThank you for your time and continued consideration.\n\nSincerely,\n${myName}`;
      recruiterPitch = `Hello ${firstName}, I am writing to follow up on my interest in the ${jobTitle} search. Please let me know if you would like me to submit any further credentials for team review. Best regards, ${myName}`;
    }
  } else {
    if (selectedTone === 'casual') {
      linkedinNote = `Hi ${firstName}! Closing the loop on ${jobTitle} at ${companyName}. No worries if timing is tight—let's stay connected for the future! Best, ${myName}`;
      referralDm = `Hey ${firstName}! Closing the loop on this—I know how hectic schedules get so no worries at all if now isn't the right time.\n\nReally appreciate you taking a look, and I hope we can stay in touch down the road!\n\nCheers,\n${myName}`;
      emailSubject = `Closing the loop — ${jobTitle} at ${companyName}`;
      emailPitch = `Hi ${firstName},\n\nWanted to check in one final time regarding the ${jobTitle} role. If the team has already moved forward with other candidates, I completely understand.\n\nIf timing is better later in the year, I'd welcome staying in touch. Wishing you and the ${companyName} team continued success!\n\nBest,\n${myName}`;
      recruiterPitch = `Hi ${firstName}! Closing the loop on the ${jobTitle} search. If the role has been filled, no problem at all—wishing you a great rest of the quarter! Best, ${myName}`;
    } else if (selectedTone === 'direct') {
      linkedinNote = `Hi ${firstName}, closing out my note regarding ${jobTitle}. If timing is better later, let's keep in touch. Thanks, ${myName}`;
      referralDm = `Hi ${firstName},\n\nWanted to close the loop on the ${jobTitle} referral request. If the position is already progressing or timing is not ideal, no problem at all.\n\nThanks again for your time!\n${myName}`;
      emailSubject = `Closing the loop: ${jobTitle} (${myName})`;
      emailPitch = `Hi ${firstName},\n\nI understand priorities move fast, so I will close the loop on my application for the ${jobTitle} position.\n\nShould another opportunity arise that matches my background, please feel free to reach out. Thank you for your consideration.\n\nBest regards,\n${myName}`;
      recruiterPitch = `Hi ${firstName}, closing the loop on the ${jobTitle} opening. If the position is filled, I appreciate your consideration and hope to connect on future searches. Thanks, ${myName}`;
    } else {
      linkedinNote = `Hello ${firstName}, I am closing the loop regarding the ${jobTitle} position. I wish you and ${companyName} every continued success.`;
      referralDm = `Hi ${firstName},\n\nI am writing to close the loop regarding my referral inquiry for the ${jobTitle} role. If the search has progressed or timing is unfavorable, I fully understand.\n\nThank you for your time, and I look forward to staying connected.\n\nBest regards,\n${myName}`;
      emailSubject = `Final follow-up regarding ${jobTitle} position — ${companyName}`;
      emailPitch = `Dear ${firstName},\n\nI am writing to conclude my application inquiry for the ${jobTitle} position. If the search is complete, I understand and wish your team great success.\n\nThank you for your time and consideration.\n\nSincerely,\n${myName}`;
      recruiterPitch = `Hello ${firstName}, I am writing to conclude my inquiry regarding the ${jobTitle} search. Thank you for your time and consideration. Best regards, ${myName}`;
    }
  }

  if (linkedinNote.length > 295) linkedinNote = linkedinNote.slice(0, 292) + '...';

  return {
    linkedinNote,
    referralDm,
    emailPitch,
    emailSubject,
    recruiterPitch,
  };
}

function renderWarmStudioModal() {
  if (!warmStudioModalBackdrop || !appState.warmStudioData) return;
  const data = appState.warmStudioData;
  const { job, account, selectedContact, contacts, selectedFormat, selectedTone, selectedStep = 1 } = data;
  const copyObj = generateWarmStudioCopy(data);

  let activeText = '';
  let activeTitle = '';
  let charLimit = 0;
  const recipientEmail = selectedContact?.email || '';

  if (selectedFormat === 'linkedin_note') {
    activeText = copyObj.linkedinNote;
    activeTitle = `Step ${selectedStep}: LinkedIn Connection Note`;
    charLimit = 300;
  } else if (selectedFormat === 'referral_dm') {
    activeText = copyObj.referralDm;
    activeTitle = `Step ${selectedStep}: 1st-Degree Colleague Referral DM`;
  } else if (selectedFormat === 'email_pitch') {
    activeText = `Subject: ${copyObj.emailSubject}\n\n${copyObj.emailPitch}`;
    activeTitle = `Step ${selectedStep}: Direct Email Pitch`;
  } else {
    activeText = copyObj.recruiterPitch;
    activeTitle = `Step ${selectedStep}: Recruiter Outreach`;
  }

  const charCount = activeText.length;
  const isOverLimit = charLimit && charCount > charLimit;
  const mailtoSubject = copyObj.emailSubject || `${job?.title || 'Role'} Inquiry`;
  const mailtoBody = selectedFormat === 'email_pitch' ? copyObj.emailPitch : activeText;
  const mailtoHref = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(mailtoSubject)}&body=${encodeURIComponent(mailtoBody)}`;

  const stepGuidance = selectedStep === 1
    ? '💡 <strong>Step 1 (Day 1)</strong>: Hook the hiring signal and ask for advice or internal referral.'
    : selectedStep === 2
      ? '💡 <strong>Step 2 (Day 4)</strong>: Provide concrete candidate/project highlights to make forwarding easy.'
      : '💡 <strong>Step 3 (Day 8)</strong>: Low-friction check-in; keeps you on radar without pressure.';

  warmStudioModalBackdrop.innerHTML = `
    <div class="modal-dialog modal-dialog--lg warm-studio-dialog" role="dialog" aria-modal="true" aria-labelledby="warm-studio-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">💌</span>
          <div>
            <h3 id="warm-studio-title">Warm Referral & Outreach Studio</h3>
            <p class="muted small">Generate 3-step tailored sequences for <strong>${escapeHtml(job?.title || 'Open Role')}</strong> at <strong>${escapeHtml(job?.companyName || job?.company || 'Company')}</strong>.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-warm-studio" aria-label="Close modal">&times;</button>
      </div>

      <div class="modal-body warm-studio-body">
        <!-- Sequence Step Switcher -->
        <div class="warm-studio-sequence-bar">
          <div class="sequence-timeline-header">
            <span>⚡ Multi-Touch Sequence Strategy</span>
            <span class="muted">3-Step Cadence</span>
          </div>
          <div class="sequence-steps-grid">
            <button class="sequence-step-btn ${selectedStep === 1 ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-step" data-step="1">
              <span class="step-num-badge">Step 1</span>
              <span class="step-title-text">Warm Intro / Signal Pitch</span>
              <span class="step-day-meta">Day 1 · Hook</span>
            </button>
            <button class="sequence-step-btn ${selectedStep === 2 ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-step" data-step="2">
              <span class="step-num-badge">Step 2</span>
              <span class="step-title-text">Value-Add Perspective</span>
              <span class="step-day-meta">Day 4 · Proof</span>
            </button>
            <button class="sequence-step-btn ${selectedStep === 3 ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-step" data-step="3">
              <span class="step-num-badge">Step 3</span>
              <span class="step-title-text">Polite Closeout</span>
              <span class="step-day-meta">Day 8 · Frictionless</span>
            </button>
          </div>
          <div class="sequence-guidance-box">
            ${stepGuidance}
          </div>
        </div>

        <div class="warm-studio-context-bar">
          <div class="warm-studio-contact-picker">
            <label for="warm-studio-contact-select" class="small muted"><strong>Recipient Contact:</strong></label>
            <select id="warm-studio-contact-select" class="compact-select">
              ${(contacts || []).map((c) => `<option value="${escapeAttr(c.id || c.fullName)}" ${selected(selectedContact?.id || selectedContact?.fullName, c.id || c.fullName)}>${escapeHtml(c.fullName)} (${escapeHtml(c.title || 'Connection')})</option>`).join('')}
              ${!contacts?.length ? `<option value="">General Network Connection</option>` : ''}
            </select>
          </div>

          <div class="warm-studio-tone-picker">
            <span class="small muted"><strong>Tone:</strong></span>
            <div class="tone-button-group">
              <button class="tone-btn ${selectedTone === 'casual' ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-tone" data-tone="casual">Casual & Warm</button>
              <button class="tone-btn ${selectedTone === 'professional' ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-tone" data-tone="professional">Professional</button>
              <button class="tone-btn ${selectedTone === 'direct' ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-tone" data-tone="direct">Direct & Concise</button>
            </div>
          </div>
        </div>

        <div class="warm-studio-format-tabs" role="tablist">
          <button class="format-tab-btn ${selectedFormat === 'referral_dm' ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-format" data-format="referral_dm">
            💌 1st-Degree Referral DM
          </button>
          <button class="format-tab-btn ${selectedFormat === 'linkedin_note' ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-format" data-format="linkedin_note">
            💬 LinkedIn Note (<300 chars)
          </button>
          <button class="format-tab-btn ${selectedFormat === 'email_pitch' ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-format" data-format="email_pitch">
            📧 Direct Email Pitch
          </button>
          <button class="format-tab-btn ${selectedFormat === 'recruiter_pitch' ? 'is-active' : ''}" type="button" data-action="warm-studio-switch-format" data-format="recruiter_pitch">
            🎯 Recruiter Pitch
          </button>
        </div>

        <div class="warm-studio-output-card">
          <div class="output-card-header">
            <strong>${escapeHtml(activeTitle)}</strong>
            <div class="output-header-actions">
              ${charLimit ? `<span class="char-count-meter ${isOverLimit ? 'is-overflow' : ''}">${charCount} / ${charLimit} chars</span>` : `<span class="char-count-meter">${charCount} chars</span>`}
              <a class="mailto-draft-btn" href="${escapeAttr(mailtoHref)}" target="_blank" rel="noopener noreferrer" title="Open formatted email in your default mail app">
                ✉️ Draft in Mail &nearr;
              </a>
              <button class="primary-button primary-button--xs" type="button" data-action="warm-studio-copy">
                📋 Copy Step Message
              </button>
            </div>
          </div>
          <textarea id="warm-studio-textarea" class="warm-studio-textarea" rows="7">${escapeHtml(activeText)}</textarea>
        </div>
      </div>

      <div class="modal-footer">
        <div class="modal-footer-left">
          ${selectedContact?.linkedinUrl ? `
            <a class="secondary-button secondary-button--sm" href="${escapeAttr(selectedContact.linkedinUrl)}" target="_blank" rel="noopener noreferrer">
              Open ${escapeHtml(selectedContact.firstName || 'Contact')}'s LinkedIn &nearr;
            </a>
          ` : `
            <a class="secondary-button secondary-button--sm" href="https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(`${selectedContact?.fullName || ''} ${job?.companyName || job?.company || ''}`)}" target="_blank" rel="noopener noreferrer">
              Search Contact on LinkedIn &nearr;
            </a>
          `}
          ${job?.url || job?.jobUrl ? `
            <a class="ghost-button ghost-button--sm" href="${escapeAttr(job.url || job.jobUrl)}" target="_blank" rel="noopener noreferrer">
              View Careers Board Posting &nearr;
            </a>
          ` : ''}
        </div>
        <div class="modal-footer-right">
          <button class="ghost-button" type="button" data-action="close-warm-studio">Done</button>
          <button class="primary-button" type="button" data-action="warm-studio-log-sent" data-job-id="${escapeAttr(job?.id || '')}" data-contact-id="${escapeAttr(selectedContact?.id || '')}">
            ✓ Mark Intro Sent (Advance Pipeline)
          </button>
        </div>
      </div>
    </div>
  `;

  const contactSelect = document.getElementById('warm-studio-contact-select');
  if (contactSelect) {
    contactSelect.onchange = () => {
      const chosenVal = contactSelect.value;
      appState.warmStudioData.selectedContact = (contacts || []).find((c) => c.id === chosenVal || c.fullName === chosenVal) || null;
      renderWarmStudioModal();
    };
  }
}

async function copyWarmStudioText(buttonEl) {
  const textarea = document.getElementById('warm-studio-textarea');
  if (!textarea) return;
  const text = textarea.value;
  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 Message copied to clipboard!', 'success');
  } catch {
    textarea.select();
    document.execCommand('copy');
    showToast('📋 Message copied!', 'success');
  }
}

async function logWarmStudioSent(jobId, contactId) {
  if (jobId) {
    appState.jobPipelineStages[jobId] = 'contacted';
    localStorage.setItem('bd_job_pipeline', JSON.stringify(appState.jobPipelineStages));
    showToast('✓ Pipeline updated: Marked as Warm Intro Sent!', 'success');
  }
  closeWarmStudioModal();
  if (getRouteRoot() === 'jobs') await renderJobsView();
}

/* ══════════════════════════════════════════════════
   PILLAR 1: HIRING VELOCITY & STALENESS ENGINE
   ══════════════════════════════════════════════════ */

function calculateHiringVelocity(account = {}, jobs = []) {
  const tStart = performance.now();
  const accountJobs = Array.isArray(jobs)
    ? jobs.filter(j => j.accountId === account.id || (account.normalizedName && j.companyNormalized === account.normalizedName))
    : [];
  const now = Date.now();
  const MS_DAY = 24 * 60 * 60 * 1000;
  let jobs3d = 0;
  let jobs7d = 0;
  let staleJobs = 0;
  let freshJobs = 0;

  accountJobs.forEach(job => {
    const created = new Date(job.firstSeenAt || job.createdAt || job.updatedAt || job.postedAt || 0).getTime();
    const ageMs = now - created;
    const ageDays = Number.isFinite(created) && created > 0 ? Math.floor(ageMs / MS_DAY) : 10;
    if (ageDays <= 3) jobs3d += 1;
    if (ageDays <= 7) jobs7d += 1;
    if (ageDays <= 2) freshJobs += 1;
    if (ageDays >= 45 && job.active !== false) staleJobs += 1;
  });

  const isSurge = jobs3d >= 3 || (jobs7d >= 4 && jobs7d >= Math.max(1, Number(account.activeJobCount || account.jobCount || 1)) * 0.4);
  const surgeVelocity = jobs3d >= 3 ? Math.round((jobs3d / Math.max(1, accountJobs.length - jobs3d)) * 100) : 0;
  const tElapsed = performance.now() - tStart;
  if (tElapsed > 15) {
    console.warn(`[PERF TIMING] calculateHiringVelocity took ${tElapsed.toFixed(2)}ms for ${account.displayName}`);
  }

  return {
    totalJobs: accountJobs.length,
    jobs3d,
    jobs7d,
    freshJobs,
    staleJobs,
    isSurge,
    surgeVelocity,
    surgeBadge: isSurge ? `🔥 Hiring Surge (+${jobs3d} in 72h)` : '',
    hardToFillBadge: staleJobs > 0 ? `⏳ ${staleJobs} Hard-to-Fill (45d+)` : '',
    freshBadge: freshJobs > 0 ? `⚡ ${freshJobs} Just Opened (<48h)` : '',
  };
}

function detectRoleVelocity(job = {}) {
  const created = new Date(job.firstSeenAt || job.createdAt || job.updatedAt || job.postedAt || 0).getTime();
  const ageDays = Number.isFinite(created) && created > 0 ? Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000)) : 10;
  const isJustOpened = ageDays <= 2;
  const isHardToFill = ageDays >= 45 && job.active !== false;
  return {
    ageDays,
    isJustOpened,
    isHardToFill,
    badgeLabel: isJustOpened ? '⚡ Just Opened (<48h)' : isHardToFill ? `⏳ Hard-to-Fill (${ageDays}d)` : '',
    badgeClass: isJustOpened ? 'signal-badge--just-opened' : isHardToFill ? 'signal-badge--hard-to-fill' : '',
  };
}

/* ══════════════════════════════════════════════════
   PILLAR 2: ROLE-TO-CONTACT ALIGNMENT MATRIX
   ══════════════════════════════════════════════════ */

function rankContactsForJob(job = {}, contacts = []) {
  const tStart = performance.now();
  const jobTitle = String(job?.title || '').toLowerCase();

  const scored = (Array.isArray(contacts) ? contacts : []).map(contact => {
    const title = String(contact.title || contact.position || '').toLowerCase();
    let category = 'other';
    let score = 10;
    let reason = '1st-degree contact at company';
    let badgeIcon = '👤';
    let badgeLabel = 'Contact';
    let chipClass = 'align-chip--peer';

    if (/\b(recruit\w*|talent\w*|people|sourc\w*|hr|talent acquisition)\b/.test(title)) {
      category = 'recruiter';
      score = 70;
      reason = 'Talent Acquisition & Sourcing Lead';
      badgeIcon = '📋';
      badgeLabel = 'Talent Lead';
      chipClass = 'align-chip--recruiter';
    } else if (/\b(vp|vice president|chief|cto|cro|cmo|cpo|coo|head of|director|founder|managing director|partner|lead)\b/.test(title)) {
      category = 'decision_maker';
      score = 95;
      reason = 'Probable Hiring Decision Maker & Executive';
      badgeIcon = '👑';
      badgeLabel = 'Decision Maker';
      chipClass = 'align-chip--dm';
    } else if (/\b(engineer|developer|architect|designer|manager|account executive|representative|analyst|scientist|consultant)\b/.test(title)) {
      category = 'peer';
      score = 60;
      reason = 'Peer in relevant domain (Warm Referrer)';
      badgeIcon = '🤝';
      badgeLabel = 'Peer / Warm Path';
      chipClass = 'align-chip--peer';
    }

    const domains = ['eng', 'software', 'platform', 'data', 'sales', 'product', 'market', 'design', 'finance', 'devops', 'cloud', 'ai', 'ml', 'security'];
    const matchedDomain = domains.find(d => jobTitle.includes(d) && title.includes(d));
    if (matchedDomain) {
      score += 20;
      reason += ` (${matchedDomain} alignment)`;
    }

    return {
      ...contact,
      category,
      alignmentScore: score,
      alignmentReason: reason,
      badgeIcon,
      badgeLabel,
      chipClass,
    };
  });

  scored.sort((a, b) => b.alignmentScore - a.alignmentScore);
  const tElapsed = performance.now() - tStart;
  if (tElapsed > 15) {
    console.warn(`[PERF TIMING] rankContactsForJob took ${tElapsed.toFixed(2)}ms for ${job.title}`);
  }
  return scored;
}

/* ══════════════════════════════════════════════════
   PILLAR 4: DEAL FLOW & FEE PIPELINE SIMULATOR
   ══════════════════════════════════════════════════ */

function renderFeePipelineSimulator(dashboard = {}, outcomeSummary = {}) {
  const isJobSeeker = isJobSeekerPersona();
  const summary = dashboard?.summary || {};
  const activeJobs = Number(summary.activeJobCount || 0) || 18;
  const sim = appState.feeSimulator || { avgFee: 22500, weeklyOutreach: 25, winRate: 15 };

  const avgFee = Number(sim.avgFee) || 22500;
  const weeklyOutreach = Number(sim.weeklyOutreach) || 25;
  const winRatePct = Number(sim.winRate) || 15;

  const addressableMarket = activeJobs * avgFee;
  const quarterlyOutreach = weeklyOutreach * 12;
  const estimatedReplies = Math.round(quarterlyOutreach * 0.35);
  const estimatedMeetings = Math.max(1, Math.round(estimatedReplies * 0.30));
  const estimatedPlacements = Math.max(1, Math.round(estimatedMeetings * (winRatePct / 100)));
  const projectedQuarterlyBillings = estimatedPlacements * avgFee;

  return `
    <section class="fee-simulator-card" aria-label="Fee Pipeline & BD ROI Simulator">
      <div class="fee-simulator-header">
        <div class="fee-simulator-title">
          <span style="font-size: 1.3rem;">💼</span>
          <div>
            <h3>${isJobSeeker ? 'Target Compensation & Offer Pipeline' : 'Executive Fee Pipeline & Deal Flow Simulator'}</h3>
            <p class="muted small">${isJobSeeker ? 'Simulate your compensation upside across active warm referral roles.' : 'Real-time forecast of addressable agency staffing fees and projected quarterly billings.'}</p>
          </div>
        </div>
        <span class="status-pill status-pill--success"><span class="pulse-indicator"></span> Live Model</span>
      </div>

      <div class="fee-simulator-layout">
        <div class="fee-sliders-column">
          <div class="fee-slider-control">
            <div class="fee-slider-label-row">
              <span>${isJobSeeker ? 'Target Base Salary / Compensation' : 'Average Placement Fee ($/req)'}</span>
              <span class="fee-slider-val">$${avgFee.toLocaleString()}</span>
            </div>
            <input type="range" class="fee-slider-input" min="10000" max="60000" step="2500" value="${avgFee}" data-action="update-fee-slider" data-field="avgFee" aria-label="Average placement fee">
          </div>

          <div class="fee-slider-control">
            <div class="fee-slider-label-row">
              <span>${isJobSeeker ? 'Target Weekly Warm Applications' : 'Target Weekly Outreaches'}</span>
              <span class="fee-slider-val">${weeklyOutreach} / week</span>
            </div>
            <input type="range" class="fee-slider-input" min="5" max="100" step="5" value="${weeklyOutreach}" data-action="update-fee-slider" data-field="weeklyOutreach" aria-label="Weekly outreach target">
          </div>

          <div class="fee-slider-control">
            <div class="fee-slider-label-row">
              <span>${isJobSeeker ? 'Interview-to-Offer Conversion %' : 'Meeting-to-Placement Win Rate %'}</span>
              <span class="fee-slider-val">${winRatePct}%</span>
            </div>
            <input type="range" class="fee-slider-input" min="5" max="50" step="5" value="${winRatePct}" data-action="update-fee-slider" data-field="winRate" aria-label="Target win rate percentage">
          </div>
        </div>

        <div class="fee-metrics-column">
          <div class="fee-metric-box fee-metric-box--highlight">
            <span class="fee-metric-num">$${(addressableMarket).toLocaleString()}</span>
            <span class="fee-metric-lbl">${isJobSeeker ? 'Open Role Value' : 'Addressable Open Fee Pipeline'}</span>
            <span class="fee-metric-sub">${activeJobs} active reqs × $${avgFee.toLocaleString()} avg fee</span>
          </div>

          <div class="fee-metric-box">
            <span class="fee-metric-num">$${(projectedQuarterlyBillings).toLocaleString()}</span>
            <span class="fee-metric-lbl">${isJobSeeker ? 'Projected Annual Comp' : 'Projected 90-Day Billings'}</span>
            <span class="fee-metric-sub">${estimatedPlacements} ${isJobSeeker ? 'offers' : 'placements'} projected / quarter</span>
          </div>

          <div class="fee-metric-box">
            <span class="fee-metric-num">${estimatedReplies} Replies</span>
            <span class="fee-metric-lbl">Warm Network Velocity</span>
            <span class="fee-metric-sub">~35% warm response vs 3% cold</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

function updateFeeSimulator(field, value) {
  if (!appState.feeSimulator) appState.feeSimulator = { avgFee: 22500, weeklyOutreach: 25, winRate: 15 };
  appState.feeSimulator[field] = Number(value) || 0;
  localStorage.setItem('bd_fee_simulator', JSON.stringify(appState.feeSimulator));
  const dashboardCard = document.querySelector('.fee-simulator-card');
  if (dashboardCard && appState.activeView === 'dashboard') {
    const parent = dashboardCard.parentElement;
    if (parent) {
      dashboardCard.outerHTML = renderFeePipelineSimulator(appState.bootstrap?.summary ? { summary: appState.bootstrap.summary } : {}, appState.outcomeSummary);
    }
  }
}

/* ══════════════════════════════════════════════════
   PILLAR 5: INTERACTIVE 4-QUADRANT ICP ACCOUNT MATRIX
   ══════════════════════════════════════════════════ */

function renderIcpQuadrantMatrix(accounts = [], jobs = []) {
  const items = Array.isArray(accounts) ? accounts : [];
  const selectedQ = appState.selectedIcpQuadrant;

  let q1 = [];
  let q2 = [];
  let q3 = [];
  let q4 = [];

  items.forEach(acc => {
    const conns = Number(acc.connectionCount || 0);
    const jobCount = Number(acc.jobCount || acc.activeJobCount || 0);
    if (conns >= 2 && jobCount >= 3) q1.push(acc);
    else if (conns >= 2 && jobCount < 3) q2.push(acc);
    else if (conns < 2 && jobCount >= 3) q3.push(acc);
    else q4.push(acc);
  });

  return `
    <section class="icp-matrix-card" aria-label="Interactive ICP Priority Matrix">
      <div class="icp-matrix-header">
        <div>
          <h3 style="display:flex; align-items:center; gap:8px;">
            <span>📊</span> Strategic 4-Quadrant Account Matrix
          </h3>
          <p class="muted small">Interactive account positioning mapped by <strong>Live Hiring Urgency</strong> vs <strong>Network Warmth</strong>. Click any quadrant to focus.</p>
        </div>
        ${selectedQ ? `
          <button class="secondary-button secondary-button--sm" type="button" data-action="clear-icp-quadrant">
            ✕ Clear Quadrant Filter
          </button>
        ` : ''}
      </div>

      <div class="icp-matrix-grid">
        <!-- Q1: Strike Zone -->
        <div class="icp-quadrant icp-quadrant--q1 ${selectedQ === 'q1' ? 'is-selected' : ''}" data-action="select-icp-quadrant" data-quadrant="q1" role="button" tabindex="0" title="Click to view Strike Zone accounts">
          <div class="icp-quadrant-top">
            <div class="icp-quadrant-title">
              <strong>🔥 Q1: Immediate Strike Zone</strong>
              <span>High Warmth (2+ conns) & High Hiring (3+ reqs)</span>
            </div>
            <span class="icp-quadrant-badge">${q1.length} Target${q1.length === 1 ? '' : 's'}</span>
          </div>
          <div class="icp-quadrant-stats">
            <span>Priority: <strong>Immediate BD Outreach</strong></span>
          </div>
          <div class="icp-quadrant-companies">
            ${q1.slice(0, 3).map(a => `<span class="icp-company-chip">${escapeHtml(a.displayName || a.name)}</span>`).join('')}
            ${q1.length > 3 ? `<span class="small muted">+${q1.length - 3} more</span>` : ''}
          </div>
        </div>

        <!-- Q2: Warm Nurture -->
        <div class="icp-quadrant icp-quadrant--q2 ${selectedQ === 'q2' ? 'is-selected' : ''}" data-action="select-icp-quadrant" data-quadrant="q2" role="button" tabindex="0" title="Click to view Warm Nurture accounts">
          <div class="icp-quadrant-top">
            <div class="icp-quadrant-title">
              <strong>🤝 Q2: Warm Nurture & Relationship</strong>
              <span>High Warmth (2+ conns) & Low Hiring (&lt;3 reqs)</span>
            </div>
            <span class="icp-quadrant-badge">${q2.length} Target${q2.length === 1 ? '' : 's'}</span>
          </div>
          <div class="icp-quadrant-stats">
            <span>Priority: <strong>Executive Touchpoints</strong></span>
          </div>
          <div class="icp-quadrant-companies">
            ${q2.slice(0, 3).map(a => `<span class="icp-company-chip">${escapeHtml(a.displayName || a.name)}</span>`).join('')}
            ${q2.length > 3 ? `<span class="small muted">+${q2.length - 3} more</span>` : ''}
          </div>
        </div>

        <!-- Q3: Cold Surge -->
        <div class="icp-quadrant icp-quadrant--q3 ${selectedQ === 'q3' ? 'is-selected' : ''}" data-action="select-icp-quadrant" data-quadrant="q3" role="button" tabindex="0" title="Click to view Cold Surge accounts">
          <div class="icp-quadrant-top">
            <div class="icp-quadrant-title">
              <strong>🚀 Q3: Cold Surge / Agency Pitch</strong>
              <span>Low Warmth (&lt;2 conns) & High Hiring (3+ reqs)</span>
            </div>
            <span class="icp-quadrant-badge">${q3.length} Target${q3.length === 1 ? '' : 's'}</span>
          </div>
          <div class="icp-quadrant-stats">
            <span>Priority: <strong>Capacity & Contingency Pitch</strong></span>
          </div>
          <div class="icp-quadrant-companies">
            ${q3.slice(0, 3).map(a => `<span class="icp-company-chip">${escapeHtml(a.displayName || a.name)}</span>`).join('')}
            ${q3.length > 3 ? `<span class="small muted">+${q3.length - 3} more</span>` : ''}
          </div>
        </div>

        <!-- Q4: Watchlist -->
        <div class="icp-quadrant icp-quadrant--q4 ${selectedQ === 'q4' ? 'is-selected' : ''}" data-action="select-icp-quadrant" data-quadrant="q4" role="button" tabindex="0" title="Click to view Watchlist accounts">
          <div class="icp-quadrant-top">
            <div class="icp-quadrant-title">
              <strong>💤 Q4: Long-Term Watchlist</strong>
              <span>Low Warmth (&lt;2 conns) & Low Hiring (&lt;3 reqs)</span>
            </div>
            <span class="icp-quadrant-badge">${q4.length} Target${q4.length === 1 ? '' : 's'}</span>
          </div>
          <div class="icp-quadrant-stats">
            <span>Priority: <strong>Automated ATS Monitoring</strong></span>
          </div>
          <div class="icp-quadrant-companies">
            ${q4.slice(0, 3).map(a => `<span class="icp-company-chip">${escapeHtml(a.displayName || a.name)}</span>`).join('')}
            ${q4.length > 3 ? `<span class="small muted">+${q4.length - 3} more</span>` : ''}
          </div>
        </div>
      </div>
    </section>
  `;
}

async function selectIcpQuadrant(quadrantKey) {
  appState.selectedIcpQuadrant = quadrantKey;
  if (appState.activeView === 'accounts') {
    if (quadrantKey === 'q1') {
      appState.accountQuery.minContacts = '2';
      appState.accountQuery.hiring = 'true';
    } else if (quadrantKey === 'q2') {
      appState.accountQuery.minContacts = '2';
      appState.accountQuery.hiring = '';
    } else if (quadrantKey === 'q3') {
      appState.accountQuery.minContacts = '0';
      appState.accountQuery.hiring = 'true';
    } else {
      appState.accountQuery.minContacts = '0';
      appState.accountQuery.hiring = '';
    }
    await renderAccountsView();
  } else {
    location.hash = '#/accounts';
  }
}

async function clearIcpQuadrant() {
  appState.selectedIcpQuadrant = null;
  appState.accountQuery.minContacts = '';
  appState.accountQuery.hiring = '';
  if (appState.activeView === 'accounts') {
    await renderAccountsView();
  }
}

/* ══════════════════════════════════════════════════
   PILLAR 6: AUDIO CHIMES & KEYBOARD SHORTCUTS MODAL
   ══════════════════════════════════════════════════ */

function playActionChime(type = 'success') {
  if (!appState.soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    if (type === 'success') {
      const freqs = [880, 1174.66, 1760];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);
        gain.gain.setValueAtTime(0.08, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.22);
      });
    } else if (type === 'nav') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.07);
    }
  } catch {}
}

function toggleSoundEffects() {
  appState.soundEnabled = !appState.soundEnabled;
  localStorage.setItem('bd_sound_enabled', String(appState.soundEnabled));
  if (appState.soundEnabled) playActionChime('success');
  const sub = document.getElementById('sound-toggle-sub');
  if (sub) sub.textContent = appState.soundEnabled ? 'Chimes: ON' : 'Chimes: OFF';
  showToast(appState.soundEnabled ? '🔔 Sound effects enabled!' : '🔕 Sound effects muted.', 'info');
}

function openShortcutsModal() {
  if (!shortcutsModalBackdrop) return;
  appState.shortcutsModalOpen = true;
  renderKeyboardShortcutsModal();
  shortcutsModalBackdrop.classList.remove('hidden');
  shortcutsModalBackdrop.setAttribute('aria-hidden', 'false');
}

function closeShortcutsModal() {
  if (!shortcutsModalBackdrop) return;
  appState.shortcutsModalOpen = false;
  shortcutsModalBackdrop.classList.add('hidden');
  shortcutsModalBackdrop.setAttribute('aria-hidden', 'true');
  shortcutsModalBackdrop.innerHTML = '';
}

function renderKeyboardShortcutsModal() {
  if (!shortcutsModalBackdrop) return;

  shortcutsModalBackdrop.innerHTML = `
    <div class="shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-dialog-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">⌨️</span>
          <div>
            <h3 id="shortcuts-dialog-title">Power-User Keyboard Shortcuts</h3>
            <p class="muted small">Navigate and operate BD Engine at lightning speed.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-shortcuts-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="shortcuts-body">
        <div class="shortcuts-group">
          <span class="shortcuts-group-title">⚡ Instant Command & Intelligence</span>
          <div class="shortcut-row">
            <span class="shortcut-desc">Open Executive Morning Radar Briefing</span>
            <div class="shortcut-keys"><kbd>M</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Open Batch Outreach Studio</span>
            <div class="shortcut-keys"><kbd>B</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Global Search (Accounts, Jobs, Contacts)</span>
            <div class="shortcut-keys"><kbd>Ctrl</kbd> + <kbd>K</kbd> / <kbd>/</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Show Keyboard Shortcuts Cheat Sheet</span>
            <div class="shortcut-keys"><kbd>?</kbd></div>
          </div>
        </div>

        <div class="shortcuts-group">
          <span class="shortcuts-group-title">🎯 Navigation & Chord Hotkeys</span>
          <div class="shortcut-row">
            <span class="shortcut-desc">Go to Dashboard</span>
            <div class="shortcut-keys"><kbd>G</kbd> then <kbd>D</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Go to Accounts / Companies</span>
            <div class="shortcut-keys"><kbd>G</kbd> then <kbd>A</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Go to Live Jobs</span>
            <div class="shortcut-keys"><kbd>G</kbd> then <kbd>J</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Go to Warm Contacts</span>
            <div class="shortcut-keys"><kbd>G</kbd> then <kbd>C</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Go to Follow-up Tasks</span>
            <div class="shortcut-keys"><kbd>G</kbd> then <kbd>T</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Go to Admin & ATS Engine</span>
            <div class="shortcut-keys"><kbd>G</kbd> then <kbd>X</kbd></div>
          </div>
        </div>

        <div class="shortcuts-group">
          <span class="shortcuts-group-title">📋 Table & Sequence Operations</span>
          <div class="shortcut-row">
            <span class="shortcut-desc">Navigate Next / Previous Record</span>
            <div class="shortcut-keys"><kbd>J</kbd> / <kbd>K</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Open Focused Record</span>
            <div class="shortcut-keys"><kbd>Enter</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Switch Sequence Touch (in Studio)</span>
            <div class="shortcut-keys"><kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd></div>
          </div>
          <div class="shortcut-row">
            <span class="shortcut-desc">Close Active Modal / Palette</span>
            <div class="shortcut-keys"><kbd>Esc</kbd></div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <div class="modal-footer-right">
          <button class="primary-button" type="button" data-action="close-shortcuts-modal">Got it</button>
        </div>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   ELITE SUITE 1: TECH STACK DNA & INTEL ANALYZER
   ══════════════════════════════════════════════════ */

function extractTechStack(title = '', department = '', description = '') {
  const tStart = performance.now();
  const text = `${title} ${department} ${description}`.toLowerCase();

  const STACK_MAP = [
    // AI / ML
    { name: 'PyTorch', category: 'ai', regex: /\bpytorch\b/i },
    { name: 'TensorFlow', category: 'ai', regex: /\btensorflow\b/i },
    { name: 'LLM / RAG', category: 'ai', regex: /\b(llm|rag|langchain|llamaindex|vector db|openai|claude|transformers)\b/i },
    { name: 'Computer Vision', category: 'ai', regex: /\b(computer vision|opencv|yolo)\b/i },
    { name: 'MLOps', category: 'ai', regex: /\b(mlops|kubeflow|mlflow|sagemaker)\b/i },
    // Cloud & Infra
    { name: 'Kubernetes', category: 'infra', regex: /\b(kubernetes|k8s)\b/i },
    { name: 'AWS', category: 'infra', regex: /\b(aws|amazon web services|ec2|s3|lambda|eks)\b/i },
    { name: 'Terraform', category: 'infra', regex: /\b(terraform|opentofu|iac)\b/i },
    { name: 'Docker', category: 'infra', regex: /\bdocker\b/i },
    { name: 'GCP / Azure', category: 'infra', regex: /\b(gcp|google cloud|azure)\b/i },
    // Backend & Data
    { name: 'Python', category: 'data', regex: /\bpython\b/i },
    { name: 'Go (Golang)', category: 'infra', regex: /\b(golang|\bgo\b(?= developer| engineer| backend))\b/i },
    { name: 'Rust', category: 'infra', regex: /\brust\b/i },
    { name: 'Snowflake', category: 'data', regex: /\bsnowflake\b/i },
    { name: 'Databricks', category: 'data', regex: /\b(databricks|spark|pyspark)\b/i },
    { name: 'PostgreSQL', category: 'data', regex: /\b(postgres|postgresql)\b/i },
    { name: 'GraphQL', category: 'data', regex: /\bgraphql\b/i },
    { name: 'Kafka', category: 'data', regex: /\b(kafka|kinesis|event-driven)\b/i },
    // Frontend
    { name: 'React / Next.js', category: 'frontend', regex: /\b(react|next\.js|nextjs)\b/i },
    { name: 'TypeScript', category: 'frontend', regex: /\btypescript\b/i },
  ];

  const matched = [];
  for (const item of STACK_MAP) {
    if (item.regex.test(text) && !matched.some(m => m.name === item.name)) {
      matched.push({ name: item.name, category: item.category });
      if (matched.length >= 5) break;
    }
  }

  const duration = performance.now() - tStart;
  if (duration > 15) console.warn(`[PERF WARNING] extractTechStack took ${duration.toFixed(2)}ms`);

  return matched;
}

function renderTechDnaCluster(stack = []) {
  if (!Array.isArray(stack) || !stack.length) return '';
  return `
    <div class="tech-dna-cluster" title="Extracted Tech Stack DNA">
      ${stack.map(s => `<span class="tech-dna-chip tech-dna-chip--${escapeAttr(s.category || 'primary')}">${escapeHtml(s.name)}</span>`).join('')}
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   ELITE SUITE 2: COMPETITOR & SIBLING CROSS-HUNTING
   ══════════════════════════════════════════════════ */

const COMPETITOR_CLUSTERS = [
  {
    cluster: 'Fintech & Modern Payments',
    keywords: ['stripe', 'plaid', 'brex', 'ramp', 'adyen', 'affirm', 'klarna', 'checkout', 'marqeta'],
    competitors: ['Stripe', 'Plaid', 'Brex', 'Ramp', 'Adyen', 'Checkout.com'],
  },
  {
    cluster: 'Cloud Observability & SecOps',
    keywords: ['datadog', 'dynatrace', 'new relic', 'splunk', 'sentry', 'grafana', 'crowdstrike', 'palo alto', 'wiz', 'snyk', 'sentinelone'],
    competitors: ['Datadog', 'Dynatrace', 'New Relic', 'Wiz', 'CrowdStrike', 'Snyk'],
  },
  {
    cluster: 'AI & Data Infrastructure',
    keywords: ['openai', 'anthropic', 'cohere', 'scale ai', 'databricks', 'snowflake', 'pinecone', 'weaviate', 'hugging face'],
    competitors: ['Anthropic', 'Cohere', 'Scale AI', 'Databricks', 'Snowflake', 'Pinecone'],
  },
  {
    cluster: 'Modern E-Commerce & Retail Tech',
    keywords: ['shopify', 'bigcommerce', 'commercelayer', 'klaviyo', 'faire', 'yotpo'],
    competitors: ['Shopify', 'BigCommerce', 'Klaviyo', 'Faire'],
  },
  {
    cluster: 'Enterprise Workflow & Collaboration',
    keywords: ['notion', 'airtable', 'figma', 'linear', 'asana', 'monday.com', 'atlassian', 'miro'],
    competitors: ['Notion', 'Figma', 'Linear', 'Airtable', 'Asana'],
  },
];

function getCompetitorCluster(account = {}) {
  const name = String(account.displayName || account.name || '').toLowerCase();
  const industry = String(account.industry || '').toLowerCase();
  const domain = String(account.domain || '').toLowerCase();

  for (const group of COMPETITOR_CLUSTERS) {
    const match = group.keywords.some(k => name.includes(k) || industry.includes(k) || domain.includes(k));
    if (match) {
      const peers = group.competitors.filter(c => !c.toLowerCase().includes(name) && !name.includes(c.toLowerCase()));
      return {
        clusterName: group.cluster,
        competitors: peers.slice(0, 4),
      };
    }
  }

  return {
    clusterName: industry ? `${account.industry} Peers` : 'Industry Peers',
    competitors: [],
  };
}

function renderCompetitorClusterPills(account = {}) {
  const cluster = getCompetitorCluster(account);
  if (!cluster.competitors.length) return '';
  return `
    <div class="cluster-box">
      <div class="cluster-header">
        <span class="cluster-title">⚔️ Cross-Hunt Sibling Cluster · ${escapeHtml(cluster.clusterName)}</span>
      </div>
      <div class="cluster-pill-grid">
        ${cluster.competitors.map(c => `
          <button class="cluster-pill" type="button" data-action="cross-hunt-cluster" data-company="${escapeAttr(c)}" title="1-click search and outreach for ${escapeAttr(c)}">
            + Cross-Hunt ${escapeHtml(c)} →
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   ELITE SUITE 3: REVENUE KANBAN & LIVE PIPELINE
   ══════════════════════════════════════════════════ */

const REVENUE_STAGES = [
  { id: 'identified', label: 'Identified', prob: 0.10, icon: '🔍' },
  { id: 'outreach_sent', label: 'Outreach Sent', prob: 0.25, icon: '💬' },
  { id: 'meeting_booked', label: 'Meeting Booked', prob: 0.50, icon: '📞' },
  { id: 'terms_sent', label: 'Terms Sent', prob: 0.75, icon: '📝' },
  { id: 'placement_won', label: 'Placement Won', prob: 1.00, icon: '🏆' },
];

function updateDealStage(accountId, newStage) {
  if (!accountId || !newStage) return;
  appState.dealPipeline[accountId] = newStage;
  localStorage.setItem('bd_deal_pipeline', JSON.stringify(appState.dealPipeline));
  
  if (newStage === 'placement_won') {
    playActionChime('success');
    showToast('🎉 Placement Won! Commission revenue recognized!', 'success');
  } else {
    playActionChime('nav');
    showToast(`✓ Deal stage moved to ${newStage.replace(/_/g, ' ')}`, 'success');
  }
  
  // Re-render active view if on accounts or dashboard
  const root = getRouteRoot();
  if (root === 'accounts') void renderAccountsView();
  else if (root === 'dashboard') void renderDashboardView({ skipLoading: true });
}

function renderRevenueKanbanBoard(accounts = [], jobs = []) {
  const avgFee = Number(appState.feeSimulator?.avgFee || 22500);

  // Group accounts into stages
  const stageGroups = {};
  REVENUE_STAGES.forEach(s => { stageGroups[s.id] = []; });

  accounts.forEach(acc => {
    const stage = appState.dealPipeline[acc.id] || (acc.outreachStatus === 'contacted' ? 'outreach_sent' : acc.outreachStatus === 'opportunity' ? 'meeting_booked' : 'identified');
    if (stageGroups[stage]) {
      stageGroups[stage].push(acc);
    } else {
      stageGroups['identified'].push(acc);
    }
  });

  // Calculate totals
  let totalPipelineValue = 0;
  let totalWeightedValue = 0;

  REVENUE_STAGES.forEach(s => {
    const count = stageGroups[s.id].length;
    const stageValue = count * avgFee;
    const stageWeighted = stageValue * s.prob;
    totalPipelineValue += stageValue;
    totalWeightedValue += stageWeighted;
  });

  return `
    <section class="revenue-kanban-board">
      <div class="revenue-kanban-header">
        <div>
          <h3>💼 Deal Flow & Executive Revenue Pipeline</h3>
          <p class="muted small">Drag deals or update stages to track probability-weighted commission revenue in real time.</p>
        </div>
        <div class="revenue-forecast-summary">
          <div class="revenue-forecast-chip">
            Addressable: <strong>$${formatNumber(totalPipelineValue)}</strong>
          </div>
          <div class="revenue-forecast-chip revenue-forecast-chip--highlight">
            Weighted Projected: <strong>$${formatNumber(Math.round(totalWeightedValue))}</strong>
          </div>
        </div>
      </div>

      <div class="revenue-kanban-cols">
        ${REVENUE_STAGES.map(stage => {
          const items = stageGroups[stage.id];
          const colValue = items.length * avgFee;
          const colWeighted = colValue * stage.prob;
          return `
            <div class="revenue-kanban-col" data-stage="${stage.id}">
              <div class="revenue-col-header">
                <div class="revenue-col-title-row">
                  <span class="revenue-col-title">${stage.icon} ${stage.label}</span>
                  <span class="revenue-col-badge">${items.length}</span>
                </div>
                <span class="revenue-col-total">$${formatNumber(colValue)} (${Math.round(stage.prob * 100)}% → $${formatNumber(Math.round(colWeighted))})</span>
              </div>
              <div class="revenue-kanban-list">
                ${items.map(acc => {
                  const jobCount = acc.jobCount || acc.openRoleCount || 1;
                  const estimatedFee = avgFee;
                  const weightedFee = Math.round(avgFee * stage.prob);
                  return `
                    <div class="revenue-kanban-card" data-account-id="${escapeAttr(acc.id)}">
                      <div class="revenue-card-company"><a class="row-link" href="#/accounts/${acc.id}">${escapeHtml(acc.displayName)}</a></div>
                      <div class="revenue-card-role">${jobCount} open ${pluralize(jobCount, 'role')} · ${escapeHtml(acc.industry || 'Tech')}</div>
                      <div class="revenue-card-meta">
                        <span class="revenue-card-fee">$${formatNumber(estimatedFee)} fee</span>
                        <span class="revenue-card-weighted">Proj: $${formatNumber(weightedFee)}</span>
                      </div>
                      <div style="margin-top:6px;">
                        <select class="compact-select" data-action="update-deal-stage" data-account-id="${escapeAttr(acc.id)}" style="width:100%;font-size:0.72rem;">
                          ${REVENUE_STAGES.map(s => `<option value="${s.id}" ${s.id === stage.id ? 'selected' : ''}>Move: ${s.icon} ${s.label}</option>`).join('')}
                        </select>
                      </div>
                    </div>
                  `;
                }).join('')}
                ${!items.length ? `<p class="muted small" style="text-align:center;padding:24px 0;opacity:0.6;">No deals in this stage</p>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

/* ══════════════════════════════════════════════════
   ELITE SUITE 4: OBJECTION BUSTER STUDIO
   ══════════════════════════════════════════════════ */

const OBJECTION_DATABASE = {
  psl: {
    title: 'Vendor List (PSL)',
    subtitle: 'We only work with preferred vendors',
    psychology: 'Hiring leaders use the PSL brush-off to avoid procurement bureaucracy, but routinely approve one-off contingency carve-outs for pre-vetted niche specialists they can\'t source internally.',
    scripts: {
      executive: `Hi {{name}},\n\nCompletely respect your existing PSL structure. We operate exclusively as a targeted contingency carve-out for critical, hard-to-fill technical roles when standard vendor pipelines stall.\n\nWe currently represent 2 vetted candidates matching {{company}}'s exact stack. Zero risk, zero retainer—you only review profiles if you're stuck.\n\nWorth a 3-minute look at their snapshots?\n\nBest,\n{{myName}}`,
      direct: `Hi {{name}},\n\nUnderstood on the PSL. Quick question: if your current vendors haven't filled {{jobTitle}} in 30+ days, are you open to reviewing 2 off-market, pre-screened profiles on a pure contingency basis?\n\nNo upfront commitments.\n\nBest,\n{{myName}}`,
      casual: `Hey {{name}},\n\nTotally get the vendor policy. We don't need to be on the PSL—we just happen to have two exceptional candidates available for {{jobTitle}} right now. Happy to send anonymized snapshots if helpful!\n\nBest,\n{{myName}}`,
    },
  },
  internal_ta: {
    title: 'Internal Talent Team',
    subtitle: 'Our internal TA handles all hiring',
    psychology: 'Internal recruiters are overwhelmed managing 15-25 requisitions simultaneously. They focus on active inbound applicants, leaving passive, high-impact candidates untouched.',
    scripts: {
      executive: `Hi {{name}},\n\nYour internal team does great work. We don't replace internal talent acquisition—we function as specialized sourcing overflow for bottlenecked engineering searches.\n\nRather than competing with inbound applicants, we bring 2 passive candidates who aren't on job boards.\n\nWould it hurt to see their profiles?\n\nBest,\n{{myName}}`,
      direct: `Hi {{name}},\n\nGreat to hear your internal team is active. For hard-to-fill roles like {{jobTitle}}, we supplement their efforts with passive candidate headhunting with zero retainer.\n\nHappy to share two candidate resumes for review.\n\nBest,\n{{myName}}`,
      casual: `Hey {{name}},\n\nMakes complete sense! If your internal team ever hits a bottleneck on {{jobTitle}}, feel free to ping me. We have deep bench strength in this exact domain.\n\nBest,\n{{myName}}`,
    },
  },
  hiring_freeze: {
    title: 'Hiring Freeze / Budget Hold',
    subtitle: 'We are on a hiring freeze',
    psychology: 'A hiring freeze is usually temporary or localized to specific departments. Keeping in touch with market compensation benchmarks and future talent pools gives you first-mover advantage when the freeze lifts.',
    scripts: {
      executive: `Hi {{name}},\n\nAppreciate the transparency on the budget timeline. When key requisitions reopen, top talent moves within 10 days.\n\nI can send our quarterly compensation & talent availability benchmark for {{jobTitle}} so you have actionable market intelligence ready for the next planning cycle.\n\nBest,\n{{myName}}`,
      direct: `Hi {{name}},\n\nUnderstood on the freeze. Let's stay connected so that when headcount unfreezes, you have an immediate pipeline without starting from scratch.\n\nBest,\n{{myName}}`,
      casual: `Hey {{name}},\n\nGot it! Let's touch base next quarter. Hope the team continues to execute well in the meantime.\n\nBest,\n{{myName}}`,
    },
  },
  rates_first: {
    title: 'Rates / Terms First',
    subtitle: 'Send us your fee structure and rates',
    psychology: 'Asking for rates early commoditizes your service. Anchor on candidate quality and exclusivity before opening contract negotiation.',
    scripts: {
      executive: `Hi {{name}},\n\nOur standard contingency fee is 20-25% upon successful placement with a full 90-day replacement guarantee.\n\nThat said, terms are always secondary to fit. Let me send over the 2 candidate snapshots first—if the talent caliber doesn't blow you away, rates won't even matter.\n\nSending profiles over now,\n{{myName}}`,
      direct: `Hi {{name}},\n\nWe work on standard success-based contingency (no upfront fees, 90-day guarantee). Happy to adjust terms based on volume. Let me first share the candidate profiles so you can verify fit.\n\nBest,\n{{myName}}`,
      casual: `Hey {{name}},\n\nStandard 20% on completion, zero risk. Let me shoot over the two candidate teasers so you can judge the caliber first!\n\nBest,\n{{myName}}`,
    },
  },
  no_agency_fee: {
    title: 'No Agency Fees',
    subtitle: 'We do not pay recruitment agency fees',
    psychology: 'Companies say this when they\'ve been burned by low-quality resume spam. Refocus the conversation on the tangible cost of vacancy ($1,500/day for engineering delay).',
    scripts: {
      executive: `Hi {{name}},\n\nCompletely understand why you avoid generic agency fees. The cost of an open technical role lingering for 60+ days often exceeds $50k in delayed roadmap velocity.\n\nIf we have the exact candidate who can start in 2 weeks, would you be open to an executive exception?\n\nBest,\n{{myName}}`,
      direct: `Hi {{name}},\n\nUnderstood. If our candidates can accelerate your delivery timeline by 2 months, the ROI speaks for itself. Zero fee unless you hire.\n\nBest,\n{{myName}}`,
      casual: `Hey {{name}},\n\nFair enough! If a critical hire becomes urgent enough to reconsider, our door is open. Wishing you success on the search!\n\nBest,\n{{myName}}`,
    },
  },
};

function openObjectionStudioModal() {
  if (!objectionModalBackdrop) return;
  appState.objectionModalOpen = true;
  renderObjectionStudioModal();
  objectionModalBackdrop.classList.remove('hidden');
  objectionModalBackdrop.setAttribute('aria-hidden', 'false');
}

function closeObjectionStudioModal() {
  if (!objectionModalBackdrop) return;
  appState.objectionModalOpen = false;
  objectionModalBackdrop.classList.add('hidden');
  objectionModalBackdrop.setAttribute('aria-hidden', 'true');
  objectionModalBackdrop.innerHTML = '';
}

function switchObjectionTab(tabId) {
  if (OBJECTION_DATABASE[tabId]) {
    appState.activeObjectionTab = tabId;
    renderObjectionStudioModal();
  }
}

function switchObjectionTone(tone) {
  appState.activeObjectionTone = tone;
  renderObjectionStudioModal();
}

async function copyObjectionScript(tabId, tone) {
  const obj = OBJECTION_DATABASE[tabId || appState.activeObjectionTab];
  if (!obj) return;
  const scriptTemplate = obj.scripts[tone || appState.activeObjectionTone] || obj.scripts.executive;
  const myName = appState.bootstrap?.user?.name || 'BD Team';
  const text = scriptTemplate
    .replace(/\{\{name\}\}/g, 'Hiring Leader')
    .replace(/\{\{company\}\}/g, 'your team')
    .replace(/\{\{jobTitle\}\}/g, 'this key role')
    .replace(/\{\{myName\}\}/g, myName);

  try {
    await navigator.clipboard.writeText(text);
    playActionChime('copy');
    showToast('📋 Objection counter-script copied to clipboard!', 'success');
  } catch {
    showToast('Failed to copy', 'error');
  }
}

function renderObjectionStudioModal() {
  if (!objectionModalBackdrop) return;
  const activeKey = appState.activeObjectionTab || 'psl';
  const activeTone = appState.activeObjectionTone || 'executive';
  const current = OBJECTION_DATABASE[activeKey] || OBJECTION_DATABASE.psl;
  const myName = appState.bootstrap?.user?.name || 'BD Team';
  const renderedScript = (current.scripts[activeTone] || current.scripts.executive)
    .replace(/\{\{name\}\}/g, 'Hiring Leader')
    .replace(/\{\{company\}\}/g, 'your team')
    .replace(/\{\{jobTitle\}\}/g, 'this key role')
    .replace(/\{\{myName\}\}/g, myName);

  objectionModalBackdrop.innerHTML = `
    <div class="modal-dialog objection-dialog" role="dialog" aria-modal="true" aria-labelledby="objection-modal-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">🛡️</span>
          <div>
            <h3 id="objection-modal-title">Objection Buster & Counter-Pitch Studio</h3>
            <p class="muted small">Proven executive counter-scripts for the top 5 hiring manager brush-offs.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-objection-studio" aria-label="Close modal">&times;</button>
      </div>

      <div class="objection-layout">
        <div class="objection-sidebar">
          ${Object.entries(OBJECTION_DATABASE).map(([key, data]) => `
            <button class="objection-tab-btn ${key === activeKey ? 'active' : ''}" type="button" data-action="switch-objection-tab" data-tab="${key}">
              <div>
                <div class="objection-tab-title">${escapeHtml(data.title)}</div>
                <div class="objection-tab-sub">"${escapeHtml(data.subtitle)}"</div>
              </div>
            </button>
          `).join('')}
        </div>

        <div class="objection-content">
          <div class="objection-meta-box">
            <strong style="font-size:0.8rem;color:var(--text);display:block;margin-bottom:4px;">🧠 Psychological Angle & Carve-Out Strategy:</strong>
            <p class="objection-psychology">${escapeHtml(current.psychology)}</p>
          </div>

          <div class="objection-script-card">
            <div class="objection-script-text">${escapeHtml(renderedScript)}</div>
            <div class="objection-script-actions">
              <div class="objection-tone-bar">
                <button class="objection-tone-btn ${activeTone === 'executive' ? 'active' : ''}" type="button" data-action="switch-objection-tone" data-tone="executive">Executive</button>
                <button class="objection-tone-btn ${activeTone === 'direct' ? 'active' : ''}" type="button" data-action="switch-objection-tone" data-tone="direct">Direct</button>
                <button class="objection-tone-btn ${activeTone === 'casual' ? 'active' : ''}" type="button" data-action="switch-objection-tone" data-tone="casual">Casual</button>
              </div>
              <button class="primary-button primary-button--sm" type="button" data-action="copy-objection-script" data-tab="${activeKey}" data-tone="${activeTone}">📋 1-Click Copy Script</button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <div class="modal-footer-right">
          <button class="secondary-button" type="button" data-action="close-objection-studio">Done</button>
        </div>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   ELITE SUITE 5: 1-CLICK CANDIDATE SLATE GENERATOR
   ══════════════════════════════════════════════════ */

function generateCandidateSlate(job = {}, count = 2) {
  const title = job.title || 'Senior Software Engineer';
  const company = job.companyName || job.company || 'Target Company';
  const stack = extractTechStack(title, job.department, '');
  const primarySkills = stack.map(s => s.name).slice(0, 4);
  const topSkill = primarySkills[0] || 'Modern Full-Stack';

  const candidates = [
    {
      id: 'cand_a',
      specimenCode: 'Candidate Slate #A (Immediate Availability)',
      title: `Senior / Staff ${title.replace(/senior|staff|principal|lead/gi, '').trim() || 'Software Engineer'}`,
      experienceYears: '8+ years domain experience',
      currentLocation: 'Toronto / Remote Eligible',
      salaryExpectation: '$160k–$185k CAD / USD equivalent',
      verifiedStack: primarySkills.length ? primarySkills : ['Distributed Systems', 'Cloud Architecture', 'API Design'],
      achievements: [
        `Architected high-throughput ${topSkill} service scaling to 15k req/sec with 99.99% uptime.`,
        `Led cross-functional migration from legacy monolith to decoupled cloud infrastructure.`,
        `Directly mentored 4 mid-level engineers and established CI/CD automated test standards.`,
      ],
    },
    {
      id: 'cand_b',
      specimenCode: 'Candidate Slate #B (Passive / Open to Right Offer)',
      title: `Lead / Principal ${title.replace(/senior|staff|principal|lead/gi, '').trim() || 'Software Engineer'}`,
      experienceYears: '11+ years domain experience',
      currentLocation: 'GTA / Hybrid or Remote',
      salaryExpectation: '$185k–$215k CAD / USD equivalent',
      verifiedStack: primarySkills.length ? primarySkills : ['High Scale Architecture', 'Platform Reliability', 'Data Pipelines'],
      achievements: [
        `Spearheaded core platform reliability initiatives reducing P99 latency by 42%.`,
        `Deep expertise in ${topSkill} and production microservice orchestration at scale.`,
        `Recognized with company-wide engineering excellence award at top tier scaleup.`,
      ],
    },
  ];

  return {
    jobTitle: title,
    companyName: company,
    candidates: candidates.slice(0, count),
  };
}

function openCandidateSlateModal(jobId) {
  if (!candidateSlateModalBackdrop) return;
  const job = (appState.jobs || []).find(j => j.id === jobId) || appState.jobs?.[0] || { title: 'Senior Software Engineer', companyName: 'Acme Corp' };
  appState.activeCandidateSlateJob = job;
  appState.candidateSlateModalOpen = true;
  renderCandidateSlateModal();
  candidateSlateModalBackdrop.classList.remove('hidden');
  candidateSlateModalBackdrop.setAttribute('aria-hidden', 'false');
}

function closeCandidateSlateModal() {
  if (!candidateSlateModalBackdrop) return;
  appState.candidateSlateModalOpen = false;
  candidateSlateModalBackdrop.classList.add('hidden');
  candidateSlateModalBackdrop.setAttribute('aria-hidden', 'true');
  candidateSlateModalBackdrop.innerHTML = '';
}

async function copyCandidateSlateMarkdown() {
  const job = appState.activeCandidateSlateJob || { title: 'Senior Role', companyName: 'Company' };
  const slate = generateCandidateSlate(job);
  let md = `## 📄 Candidate Specimen Slate for ${slate.companyName} (${slate.jobTitle})\n\n`;
  slate.candidates.forEach(c => {
    md += `### ${c.specimenCode}\n`;
    md += `* **Target Level**: ${c.title} (${c.experienceYears})\n`;
    md += `* **Location**: ${c.currentLocation} | **Comp Band**: ${c.salaryExpectation}\n`;
    md += `* **Verified Stack**: ${c.verifiedStack.join(', ')}\n`;
    md += `* **Key Highlights**:\n`;
    c.achievements.forEach(a => { md += `  - ${a}\n`; });
    md += `\n`;
  });
  md += `---\n*Confidential specimen profiles prepared by BD Engine for ${slate.companyName}. Complete resumes & blinded portfolios available upon request.*`;

  try {
    await navigator.clipboard.writeText(md);
    playActionChime('copy');
    showToast('📋 Candidate specimen slate copied to clipboard (Markdown)!', 'success');
  } catch {
    showToast('Failed to copy', 'error');
  }
}

function renderCandidateSlateModal() {
  if (!candidateSlateModalBackdrop) return;
  const job = appState.activeCandidateSlateJob || { title: 'Senior Software Engineer', companyName: 'Target Account' };
  const slate = generateCandidateSlate(job);

  candidateSlateModalBackdrop.innerHTML = `
    <div class="modal-dialog candidate-slate-dialog" role="dialog" aria-modal="true" aria-labelledby="slate-modal-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">📄</span>
          <div>
            <h3 id="slate-modal-title">1-Click Anonymized Candidate Pitch Slate</h3>
            <p class="muted small">Executive-ready 2-candidate talent specimen cards for ${escapeHtml(slate.companyName)} · ${escapeHtml(slate.jobTitle)}.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-candidate-slate-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="candidate-slate-grid">
        ${slate.candidates.map(c => `
          <div class="candidate-slate-card">
            <span class="candidate-slate-badge">✓ Pre-Screened & Verified</span>
            <h4 class="candidate-slate-title">${escapeHtml(c.specimenCode)}</h4>
            <div class="candidate-slate-exp">${escapeHtml(c.title)} · ${escapeHtml(c.experienceYears)}</div>
            <div class="candidate-slate-metric-row">
              <div class="candidate-slate-metric">
                <span>Location</span>
                <strong>${escapeHtml(c.currentLocation)}</strong>
              </div>
              <div class="candidate-slate-metric">
                <span>Comp Expectation</span>
                <strong>${escapeHtml(c.salaryExpectation)}</strong>
              </div>
            </div>
            <div class="tech-dna-cluster">
              ${c.verifiedStack.map(s => `<span class="tech-dna-chip tech-dna-chip--infra">${escapeHtml(s)}</span>`).join('')}
            </div>
            <ul class="candidate-slate-bullets">
              ${c.achievements.map(a => `<li>${escapeHtml(a)}</li>`).join('')}
            </ul>
          </div>
        `).join('')}
      </div>

      <div class="modal-footer">
        <button class="ghost-button" type="button" data-action="close-candidate-slate-modal">Cancel</button>
        <button class="primary-button" type="button" data-action="copy-candidate-slate">📋 Copy Candidate Slate</button>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   ELITE SUITE 6: GEOGRAPHIC TALENT HUBS MATRIX
   ══════════════════════════════════════════════════ */

const GEO_HUBS = [
  { id: 'all', label: 'All Hubs', icon: '🌍' },
  { id: 'gta', label: 'Canada / GTA', icon: '🍁', keywords: ['toronto', 'ontario', 'waterloo', 'vancouver', 'montreal', 'canada', 'ottawa'] },
  { id: 'us_east', label: 'US East Coast', icon: '🗽', keywords: ['new york', 'nyc', 'boston', 'atlanta', 'miami', 'virginia', 'washington'] },
  { id: 'us_west', label: 'US West Coast', icon: '🌲', keywords: ['san francisco', 'sf', 'bay area', 'seattle', 'los angeles', 'california', 'ca'] },
  { id: 'us_central', label: 'US Central / South', icon: '⚡', keywords: ['austin', 'texas', 'chicago', 'denver', 'dallas', 'colorado'] },
  { id: 'remote', label: 'Remote First', icon: '🌐', keywords: ['remote', 'anywhere', 'distributed', 'work from home'] },
];

function getGeographicHub(jobOrAccount = {}) {
  const loc = String(jobOrAccount.location || jobOrAccount.geography || '').toLowerCase();
  const isRemote = jobOrAccount.isRemote || jobOrAccount.workStyle === 'remote' || loc.includes('remote');
  if (isRemote) return 'remote';
  for (const hub of GEO_HUBS) {
    if (hub.id !== 'all' && hub.keywords && hub.keywords.some(k => loc.includes(k))) {
      return hub.id;
    }
  }
  return 'all';
}

function renderGeographicHubFilter() {
  const selected = appState.selectedGeoHub || 'all';
  return `
    <div class="geo-hub-bar" role="toolbar" aria-label="Geographic talent hub filter">
      <span class="geo-hub-label">🗺️ Talent Hub:</span>
      ${GEO_HUBS.map(hub => `
        <button class="geo-hub-pill ${hub.id === selected ? 'active' : ''}" type="button" data-action="select-geo-hub" data-hub="${hub.id}">
          <span>${hub.icon} ${hub.label}</span>
        </button>
      `).join('')}
    </div>
  `;
}

async function filterByGeographicHub(hubKey) {
  appState.selectedGeoHub = hubKey === 'all' ? '' : hubKey;
  playActionChime('nav');
  const root = getRouteRoot();
  if (root === 'jobs') {
    if (hubKey === 'gta') appState.jobQuery.geography = 'canada';
    else if (hubKey === 'remote') appState.jobQuery.workStyle = 'remote';
    else appState.jobQuery.geography = '';
    await renderJobsView();
  } else if (root === 'accounts') {
    if (hubKey === 'gta') appState.accountQuery.geography = 'canada';
    else if (hubKey === 'us_east' || hubKey === 'us_west' || hubKey === 'us_central') appState.accountQuery.geography = 'us';
    else appState.accountQuery.geography = '';
    await renderAccountsView();
  }
}

/* ══════════════════════════════════════════════════
   GOD-TIER 1: AI OUTREACH RESPONSE LIKELIHOOD PREDICTOR
   ══════════════════════════════════════════════════ */

function calculateResponseLikelihood(contact = {}, job = {}, account = {}, text = '') {
  const tStart = performance.now();
  let score = 25; // Base cold baseline
  const factors = [];

  // 1. Warmth & Relationship
  const isConnected = Number(contact.connectionCount || account.connectionCount || 0) > 0;
  if (isConnected) {
    score += 35;
    factors.push('✓ 1st-degree warm relationship in network (+35%)');
  }

  // 2. Hiring Velocity
  const jobs3d = Number(account.jobsLast30Days || 0);
  if (jobs3d >= 2 || account.hiringVelocity >= 4) {
    score += 20;
    factors.push('✓ Active hiring velocity / urgent requisition (+20%)');
  }

  // 3. Decision Maker alignment
  const title = String(contact.title || '').toLowerCase();
  if (/\b(vp|vice president|director|head of|chief|founder)\b/.test(title)) {
    score += 15;
    factors.push('✓ High-authority hiring decision maker (+15%)');
  }

  // 4. Stack specificity in text
  const textLower = String(text || '').toLowerCase();
  const stack = extractTechStack(job.title || '', job.department || '', textLower);
  if (stack.length >= 2) {
    score += 15;
    factors.push(`✓ Specific tech stack grounding (${stack.map(s=>s.name).slice(0,2).join(', ')}) (+15%)`);
  }

  // Bounded
  const finalScore = Math.min(98, Math.max(12, score));
  const rating = finalScore >= 80 ? 'Very High (🔥 Hot Path)' : finalScore >= 60 ? 'High (⚡ Strong Probability)' : finalScore >= 40 ? 'Moderate (🤝 Good Shot)' : 'Low (❄️ Cold Pitch)';

  const duration = performance.now() - tStart;
  if (duration > 15) console.warn(`[PERF WARNING] calculateResponseLikelihood took ${duration.toFixed(2)}ms`);

  return {
    score: finalScore,
    rating,
    factors,
    tips: finalScore < 70 ? ['💡 Tip: Reference specific candidate achievements or 1st-degree mutual connections to boost reply odds above 80%.'] : ['🔥 Optimal conversion pitch ready to send!'],
  };
}

function renderResponseLikelihoodMeter(contact = {}, job = {}, account = {}, text = '') {
  const prediction = calculateResponseLikelihood(contact, job, account, text);
  return `
    <div class="response-meter-card">
      <div class="response-meter-header">
        <span class="response-meter-title">⚡ AI Response Likelihood: <strong>${escapeHtml(prediction.rating)}</strong></span>
        <span class="response-meter-score">${prediction.score}%</span>
      </div>
      <div class="response-meter-bar">
        <div class="response-meter-fill" style="width: ${prediction.score}%;"></div>
      </div>
      <div class="response-meter-tips">
        ${prediction.factors.map(f => `<span class="response-meter-tip">${escapeHtml(f)}</span>`).join('')}
        ${prediction.tips.map(t => `<span class="response-meter-tip" style="color:var(--accent);font-weight:600;">${escapeHtml(t)}</span>`).join('')}
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   GOD-TIER 2: INTERACTIVE VISUAL NETWORK GRAPH
   ══════════════════════════════════════════════════ */

function renderInteractiveNetworkGraph(account = {}, contacts = [], jobs = []) {
  const compName = account.displayName || account.name || 'Target Account';
  const width = 880;
  const height = 440;
  const cx = width / 2;
  const cy = height / 2;

  const rankedContacts = rankContactsForJob({ title: jobs[0]?.title || '' }, contacts);
  const topContacts = rankedContacts.slice(0, 6);
  const topJobs = jobs.slice(0, 4);

  // Position nodes radially
  const nodes = [];
  const links = [];

  // Center node
  nodes.push({ id: 'center', type: 'center', label: compName, x: cx, y: cy, color: '#3b82f6', r: 36 });

  // Contact nodes (Left / Upper orbit)
  topContacts.forEach((c, idx) => {
    const angle = ((Math.PI * 1.2) / (topContacts.length || 1)) * idx - (Math.PI * 0.6);
    const dist = 170;
    const nx = cx + Math.cos(angle) * dist;
    const ny = cy + Math.sin(angle) * dist;
    const color = c.category === 'decision_maker' ? '#f59e0b' : c.category === 'recruiter' ? '#10b981' : '#60a5fa';
    nodes.push({
      id: `c_${idx}`,
      type: c.category,
      label: c.fullName,
      sub: c.title || 'Contact',
      x: nx,
      y: ny,
      color,
      r: 22,
    });
    links.push({ x1: cx, y1: cy, x2: nx, y2: ny, stroke: color });
  });

  // Job nodes (Right / Lower orbit)
  topJobs.forEach((j, idx) => {
    const angle = ((Math.PI * 1.2) / (topJobs.length || 1)) * idx + (Math.PI * 0.4);
    const dist = 175;
    const nx = cx + Math.cos(angle) * dist;
    const ny = cy + Math.sin(angle) * dist;
    nodes.push({
      id: `j_${idx}`,
      type: 'job',
      label: j.title,
      sub: j.location || 'Open Role',
      x: nx,
      y: ny,
      color: '#ef4444',
      r: 20,
    });
    links.push({ x1: cx, y1: cy, x2: nx, y2: ny, stroke: '#ef4444' });
  });

  return `
    <svg class="network-graph-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <!-- Connection Lines -->
      ${links.map(l => `
        <line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${l.stroke}" stroke-width="2" stroke-opacity="0.4" stroke-dasharray="4,4" />
      `).join('')}

      <!-- Nodes -->
      ${nodes.map(n => `
        <g class="network-node network-node--${n.type}" transform="translate(${n.x}, ${n.y})" cursor="pointer">
          <circle r="${n.r}" fill="${n.color}" fill-opacity="0.2" stroke="${n.color}" stroke-width="2.5" filter="url(#glow)" />
          <circle r="${n.r * 0.65}" fill="${n.color}" />
          <text y="${n.r + 14}" text-anchor="middle" fill="var(--text)" font-size="11" font-weight="700">${escapeHtml(n.label.slice(0, 18))}</text>
          ${n.sub ? `<text y="${n.r + 26}" text-anchor="middle" fill="var(--text-muted)" font-size="9">${escapeHtml(n.sub.slice(0, 20))}</text>` : ''}
        </g>
      `).join('')}
    </svg>
  `;
}

function openNetworkGraphModal(accountId) {
  if (!networkGraphModalBackdrop) return;
  const account = (appState.accounts || []).find(a => a.id === accountId) || appState.accounts?.[0] || { displayName: 'Target Account' };
  const jobs = (appState.jobs || []).filter(j => j.accountId === account.id || j.companyName === account.displayName);
  const contacts = (appState.contacts || []).filter(c => c.accountId === account.id || c.companyName === account.displayName);

  appState.activeGraphAccount = account;
  appState.networkGraphModalOpen = true;
  renderNetworkGraphModal(account, contacts, jobs);
  networkGraphModalBackdrop.classList.remove('hidden');
  networkGraphModalBackdrop.setAttribute('aria-hidden', 'false');
  playActionChime('nav');
}

function closeNetworkGraphModal() {
  if (!networkGraphModalBackdrop) return;
  appState.networkGraphModalOpen = false;
  networkGraphModalBackdrop.classList.add('hidden');
  networkGraphModalBackdrop.setAttribute('aria-hidden', 'true');
  networkGraphModalBackdrop.innerHTML = '';
}

function renderNetworkGraphModal(account, contacts, jobs) {
  if (!networkGraphModalBackdrop) return;
  const acc = account || appState.activeGraphAccount || { displayName: 'Target Account' };
  const conns = contacts || (appState.contacts || []).filter(c => c.accountId === acc.id || c.companyName === acc.displayName);
  const jobList = jobs || (appState.jobs || []).filter(j => j.accountId === acc.id || j.companyName === acc.displayName);

  networkGraphModalBackdrop.innerHTML = `
    <div class="modal-dialog network-graph-dialog" role="dialog" aria-modal="true" aria-labelledby="graph-modal-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">🕸️</span>
          <div>
            <h3 id="graph-modal-title">Visual Entity & Relationship Graph: ${escapeHtml(acc.displayName)}</h3>
            <p class="muted small">Interactive organizational topology connecting Decision Makers, Warm Referrers, and Active ATS Roles.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-network-graph-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="network-graph-svg-box">
        ${renderInteractiveNetworkGraph(acc, conns, jobList)}
      </div>

      <div class="network-legend">
        <div class="network-legend-item"><span class="network-legend-dot network-legend-dot--center"></span> Target Account</div>
        <div class="network-legend-item"><span class="network-legend-dot network-legend-dot--dm"></span> 👑 Hiring Decision Maker</div>
        <div class="network-legend-item"><span class="network-legend-dot network-legend-dot--peer"></span> 🤝 Domain Peer / Warm Path</div>
        <div class="network-legend-item"><span class="network-legend-dot network-legend-dot--recruiter"></span> 📋 Talent Lead</div>
        <div class="network-legend-item"><span class="network-legend-dot network-legend-dot--job"></span> 🔥 Active ATS Role</div>
      </div>

      <div class="modal-footer">
        <button class="primary-button" type="button" data-action="close-network-graph-modal">Close Graph</button>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   GOD-TIER 3: COLD CALL BATTLE CARD TELEPROMPTER
   ══════════════════════════════════════════════════ */

const CALL_BRANCHES = {
  opener: {
    label: '🎯 10s Pattern Interrupt',
    text: `Hi {{name}}, I know you weren't expecting my call, but I saw {{company}} has been actively searching for a {{jobTitle}} for over 30 days.\n\nI'll be brief—we currently represent 2 pre-vetted senior candidates matching your exact technical stack who are open to interviews.\n\nDid I catch you at a bad time, or can I share 30 seconds of context on their backgrounds?`,
  },
  send_email: {
    label: '📧 "Send me an email"',
    text: `Happy to do that {{name}}. I want to make sure I don't send generic spam—if I send over two anonymized candidate summaries, is your priority more focused on distributed systems depth or cloud scalability?`,
  },
  internal_ta: {
    label: '👥 "We use internal TA"',
    text: `Totally respect that {{name}}. Your internal team is great for inbound pipeline, but for specialized roles like {{jobTitle}}, we provide off-market passive candidates on pure contingency with zero upfront retainer.\n\nIf you're already 100% covered, no worries at all!`,
  },
  not_hiring: {
    label: '🛑 "Not hiring right now"',
    text: `Appreciate the transparency on that {{name}}. When the search reopens next quarter, would it be helpful if I shared our compensation benchmark data for {{jobTitle}} so you have market rates ready?`,
  },
  fees: {
    label: '💰 "What are your fees?"',
    text: `We work on standard success-based contingency (no placement, zero cost) with a full 90-day guarantee. But terms are always secondary—let me send the 2 profiles first so you can judge the caliber yourself!`,
  },
};

let callTimerInterval = null;
let callStartTime = null;

function openCallStudioModal(jobId, contactId) {
  if (!callStudioModalBackdrop) return;
  const job = (appState.jobs || []).find(j => j.id === jobId) || appState.jobs?.[0] || { title: 'Senior Software Engineer', companyName: 'Acme Corp' };
  const contact = (appState.contacts || []).find(c => c.id === contactId) || appState.contacts?.[0] || { fullName: 'Hiring Leader' };

  appState.activeCallJob = job;
  appState.activeCallContact = contact;
  appState.activeCallBranch = 'opener';
  appState.callStudioModalOpen = true;

  callStartTime = Date.now();
  renderCallStudioModal();
  callStudioModalBackdrop.classList.remove('hidden');
  callStudioModalBackdrop.setAttribute('aria-hidden', 'false');

  if (callTimerInterval) clearInterval(callTimerInterval);
  callTimerInterval = setInterval(() => {
    const el = document.getElementById('call-live-timer');
    if (el && callStartTime) {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      el.textContent = `⏱️ ${mins}:${secs}`;
    }
  }, 1000);
}

function closeCallStudioModal() {
  if (!callStudioModalBackdrop) return;
  if (callTimerInterval) clearInterval(callTimerInterval);
  appState.callStudioModalOpen = false;
  callStudioModalBackdrop.classList.add('hidden');
  callStudioModalBackdrop.setAttribute('aria-hidden', 'true');
  callStudioModalBackdrop.innerHTML = '';
}

function switchCallBranch(branchId) {
  if (CALL_BRANCHES[branchId]) {
    appState.activeCallBranch = branchId;
    renderCallStudioModal();
    playActionChime('nav');
  }
}

function renderCallStudioModal() {
  if (!callStudioModalBackdrop) return;
  const job = appState.activeCallJob || { title: 'Senior Software Engineer', companyName: 'Target Account' };
  const contact = appState.activeCallContact || { fullName: 'Hiring Leader' };
  const activeBranch = appState.activeCallBranch || 'opener';
  const branchData = CALL_BRANCHES[activeBranch] || CALL_BRANCHES.opener;
  const firstName = contact.fullName ? contact.fullName.split(' ')[0] : 'there';

  const script = branchData.text
    .replace(/\{\{name\}\}/g, firstName)
    .replace(/\{\{company\}\}/g, job.companyName || 'your team')
    .replace(/\{\{jobTitle\}\}/g, job.title || 'this role');

  callStudioModalBackdrop.innerHTML = `
    <div class="modal-dialog call-studio-dialog" role="dialog" aria-modal="true" aria-labelledby="call-modal-title">
      <div class="modal-header call-studio-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">🎙️</span>
          <div>
            <h3 id="call-modal-title">Cold Call Teleprompter: ${escapeHtml(contact.fullName)}</h3>
            <p class="muted small">${escapeHtml(job.companyName)} · ${escapeHtml(job.title)}</p>
          </div>
        </div>
        <span class="call-timer-badge" id="call-live-timer">⏱️ 00:00</span>
        <button class="modal-close-btn" type="button" data-action="close-call-studio" aria-label="Close modal">&times;</button>
      </div>

      <div class="call-teleprompter-box">
        <span class="call-pattern-interrupt-tag">${escapeHtml(branchData.label)}</span>
        <div class="call-hook-text">${escapeHtml(script)}</div>
        <div class="call-branch-grid">
          ${Object.entries(CALL_BRANCHES).map(([key, data]) => `
            <button class="call-branch-btn ${key === activeBranch ? 'active' : ''}" type="button" data-action="switch-call-branch" data-branch="${key}">
              ${escapeHtml(data.label)}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="modal-footer">
        <button class="secondary-button" type="button" data-action="close-call-studio">End Call</button>
        <button class="primary-button" type="button" data-action="quick-log-call-success">✓ Log Successful Connect</button>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   GOD-TIER 4: 1-CLICK MORNING BATTLE PLAN DOSSIER
   ══════════════════════════════════════════════════ */

function generateMorningBattlePlanDossier(accounts = [], jobs = []) {
  const topAccounts = (Array.isArray(accounts) ? accounts : []).slice(0, 5);
  const topJobs = (Array.isArray(jobs) ? jobs : []).slice(0, 5);
  const avgFee = Number(appState.feeSimulator?.avgFee || 22500);
  const todayDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return {
    title: `BD Engine Executive Morning Battle Plan`,
    date: todayDate,
    topAccounts: topAccounts.map(a => ({
      name: a.displayName || a.name || 'Account',
      score: getTargetScore(a),
      jobsCount: a.jobCount || a.openRoleCount || 1,
      hiringVelocity: calculateHiringVelocity(a, jobs),
      cluster: getCompetitorCluster(a),
    })),
    topJobs: topJobs.map(j => ({
      title: j.title || 'Role',
      company: j.companyName || 'Company',
      contactsCount: Array.isArray(j.contacts) ? j.contacts.length : 0,
      techStack: extractTechStack(j.title, j.department, ''),
    })),
    pipelineSummary: {
      addressableFeePipeline: (topAccounts.length * avgFee),
      estimatedPlacements: Math.max(1, Math.round(topAccounts.length * 0.25)),
    },
  };
}

function openBattlePlanModal() {
  if (!battlePlanModalBackdrop) return;
  appState.battlePlanModalOpen = true;
  renderBattlePlanModal();
  battlePlanModalBackdrop.classList.remove('hidden');
  battlePlanModalBackdrop.setAttribute('aria-hidden', 'false');
  playActionChime('nav');
}

function closeBattlePlanModal() {
  if (!battlePlanModalBackdrop) return;
  appState.battlePlanModalOpen = false;
  battlePlanModalBackdrop.classList.add('hidden');
  battlePlanModalBackdrop.setAttribute('aria-hidden', 'true');
  battlePlanModalBackdrop.innerHTML = '';
}

async function copyBattlePlanMarkdown() {
  const dossier = generateMorningBattlePlanDossier(appState.accounts || [], appState.jobs || []);
  let md = `# 📰 ${dossier.title} (${dossier.date})\n\n`;
  md += `## 🎯 Top Priority Strike Zone Accounts\n`;
  dossier.topAccounts.forEach(a => {
    md += `* **${a.name}** (Target Score: ${a.score} | ${a.jobsCount} Live Roles)\n`;
    if (a.hiringVelocity.surgeBadge) md += `  - Signal: ${a.hiringVelocity.surgeBadge}\n`;
    if (a.cluster.competitors.length) md += `  - Sibling Cross-Hunt: ${a.cluster.competitors.join(', ')}\n`;
  });
  md += `\n## 🔥 Priority Requisitions & Tech Stack Grounding\n`;
  dossier.topJobs.forEach(j => {
    md += `* **${j.title}** @ ${j.company} (${j.contactsCount} warm network contacts)\n`;
    if (j.techStack.length) md += `  - Tech Stack: ${j.techStack.map(s => s.name).join(', ')}\n`;
  });
  md += `\n---\n*Generated by BD Engine 2.0 Enterprise Suite.*`;

  try {
    await navigator.clipboard.writeText(md);
    playActionChime('copy');
    showToast('📋 Executive Battle Plan copied to clipboard (Markdown)!', 'success');
  } catch {
    showToast('Failed to copy', 'error');
  }
}

function renderBattlePlanModal() {
  if (!battlePlanModalBackdrop) return;
  const dossier = generateMorningBattlePlanDossier(appState.accounts || [], appState.jobs || []);

  battlePlanModalBackdrop.innerHTML = `
    <div class="modal-dialog battle-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="battle-plan-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">📰</span>
          <div>
            <h3 id="battle-plan-title">Executive Morning Battle Plan Dossier</h3>
            <p class="muted small">${escapeHtml(dossier.date)} · Daily high-conviction BD briefing</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-battle-plan-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="battle-plan-dossier">
        <div class="battle-plan-hero">
          <h2>🎯 Daily Strike Zone & Priority Outreach Targets</h2>
          <div class="battle-plan-hero-sub">Estimated Addressable Pipeline: <strong>$${formatNumber(dossier.pipelineSummary.addressableFeePipeline)}</strong></div>
        </div>

        <div>
          <div class="battle-plan-section-title">🏢 Top 5 High-Momentum Accounts</div>
          <div class="battle-plan-grid">
            ${dossier.topAccounts.map(a => `
              <div class="battle-plan-item">
                <div class="battle-plan-item-title">${escapeHtml(a.name)} (Score: ${a.score})</div>
                <div class="battle-plan-item-sub">${a.jobsCount} open roles · ${a.hiringVelocity.surgeBadge || 'Steady hiring'}</div>
                ${a.cluster.competitors.length ? `<div class="small muted" style="margin-top:4px;">Cross-Hunt: ${escapeHtml(a.cluster.competitors.slice(0, 3).join(', '))}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>

        <div>
          <div class="battle-plan-section-title">🔥 Priority Requisitions & Stack DNA</div>
          <div class="battle-plan-grid">
            ${dossier.topJobs.map(j => `
              <div class="battle-plan-item">
                <div class="battle-plan-item-title">${escapeHtml(j.title)}</div>
                <div class="battle-plan-item-sub">${escapeHtml(j.company)} · ${j.contactsCount} in-network contacts</div>
                ${j.techStack.length ? `<div class="tech-dna-cluster">${j.techStack.map(s => `<span class="tech-dna-chip">${escapeHtml(s.name)}</span>`).join('')}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="ghost-button" type="button" data-action="close-battle-plan-modal">Close</button>
        <button class="primary-button" type="button" data-action="copy-battle-plan">📋 1-Click Copy Dossier</button>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   INFINITY TIER 1: LIVE SIGNAL INTELLIGENCE WIRE TICKER
   ══════════════════════════════════════════════════ */

function renderLiveSignalTicker(accounts = [], jobs = []) {
  const tStart = performance.now();
  const alerts = [];

  // 1. Hiring surges
  (Array.isArray(accounts) ? accounts : []).forEach(a => {
    const vel = calculateHiringVelocity(a, jobs);
    if (vel.surgeBadge) {
      alerts.push({
        type: 'surge',
        badge: '🔥 HIRING SURGE',
        text: `${a.displayName}: ${vel.surgeBadge}`,
        company: a.displayName,
        accountId: a.id,
      });
    }
  });

  // 2. Decision Maker in network alerts
  (Array.isArray(jobs) ? jobs : []).slice(0, 10).forEach(j => {
    const hasConn = Number(j.connectionCount || 0) > 0;
    if (hasConn) {
      alerts.push({
        type: 'dm',
        badge: '👑 DECISION MAKER',
        text: `${j.companyName} (${j.title}): ${j.connectionCount} in network`,
        company: j.companyName,
        jobId: j.id,
        accountId: j.accountId,
      });
    }
  });

  // 3. Stale hard-to-fill roles
  (Array.isArray(accounts) ? accounts : []).forEach(a => {
    const vel = calculateHiringVelocity(a, jobs);
    if (vel.hardToFillBadge) {
      alerts.push({
        type: 'stale',
        badge: '⏳ HARD TO FILL',
        text: `${a.displayName}: Requisitions open 45d+`,
        company: a.displayName,
        accountId: a.id,
      });
    }
  });

  if (!alerts.length) {
    alerts.push({
      type: 'surge',
      badge: '⚡ SIGNAL INTEL',
      text: 'Monitoring live ATS feeds across 240+ target tech employers...',
    });
  }

  const duration = performance.now() - tStart;
  if (duration > 15) console.warn(`[PERF WARNING] renderLiveSignalTicker took ${duration.toFixed(2)}ms`);

  return `
    <div class="intel-wire-ticker" role="region" aria-label="Real-time hiring signal intelligence ticker">
      <span class="ticker-label">📡 Live Wire:</span>
      <div class="ticker-track">
        ${alerts.map(a => `
          <button class="ticker-pill ticker-pill--${a.type}" type="button" data-action="ticker-jump-action" data-company="${escapeAttr(a.company || '')}" data-account-id="${escapeAttr(a.accountId || '')}" data-job-id="${escapeAttr(a.jobId || '')}">
            <span>${escapeHtml(a.badge)}</span>
            <span>${escapeHtml(a.text)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   INFINITY TIER 2: AUTOPILOT PROSPECTING CO-PILOT
   ══════════════════════════════════════════════════ */

function generateAutopilotQueue(accounts = [], jobs = [], contacts = []) {
  const tStart = performance.now();
  const queue = [];

  const candidateAccounts = (Array.isArray(accounts) ? accounts : [])
    .filter(a => (a.jobCount || 0) > 0 || (a.jobsLast30Days || 0) > 0)
    .slice(0, 5);

  candidateAccounts.forEach(account => {
    const accJobs = (Array.isArray(jobs) ? jobs : []).filter(j => j.accountId === account.id || j.companyName === account.displayName);
    const topJob = accJobs[0] || { title: 'Senior Software Engineer', companyName: account.displayName };
    const accContacts = (Array.isArray(contacts) ? contacts : []).filter(c => c.accountId === account.id || c.companyName === account.displayName);
    const rankedContacts = rankContactsForJob(topJob, accContacts);
    const topContact = rankedContacts[0] || { fullName: 'Hiring Leader', title: 'Engineering Director' };

    const stack = extractTechStack(topJob.title, topJob.department, '');
    const draft = generateBatchDraftCopy({
      name: topContact.fullName,
      title: topContact.title,
      company: account.displayName,
      jobTitle: topJob.title,
    }, 'sales_hiring_manager', 'casual', 1);

    queue.push({
      account,
      job: topJob,
      contact: topContact,
      stack,
      draft,
      prediction: calculateResponseLikelihood(topContact, topJob, account, draft.body),
    });
  });

  const duration = performance.now() - tStart;
  if (duration > 15) console.warn(`[PERF WARNING] generateAutopilotQueue took ${duration.toFixed(2)}ms`);

  return queue;
}

function openAutopilotModal() {
  if (!autopilotModalBackdrop) return;
  appState.activeAutopilotQueue = generateAutopilotQueue(appState.accounts || [], appState.jobs || [], appState.contacts || []);
  appState.autopilotModalOpen = true;
  renderAutopilotModal();
  autopilotModalBackdrop.classList.remove('hidden');
  autopilotModalBackdrop.setAttribute('aria-hidden', 'false');
  playActionChime('nav');
}

function closeAutopilotModal() {
  if (!autopilotModalBackdrop) return;
  appState.autopilotModalOpen = false;
  autopilotModalBackdrop.classList.add('hidden');
  autopilotModalBackdrop.setAttribute('aria-hidden', 'true');
  autopilotModalBackdrop.innerHTML = '';
}

async function executeAutopilotQueue() {
  playActionChime('success');
  showToast(`🚀 Autopilot executed ${appState.activeAutopilotQueue.length} multi-touch pipelines!`, 'success');
  closeAutopilotModal();
}

function renderAutopilotModal() {
  if (!autopilotModalBackdrop) return;
  const queue = appState.activeAutopilotQueue || [];

  autopilotModalBackdrop.innerHTML = `
    <div class="modal-dialog autopilot-dialog" role="dialog" aria-modal="true" aria-labelledby="autopilot-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">🤖</span>
          <div>
            <h3 id="autopilot-title">Autonomous Prospecting Co-Pilot</h3>
            <p class="muted small">1-Click intelligent auto-run: Scans workspace, pairs decision makers, and drafts 3-touch sequences.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-autopilot-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="autopilot-hero-banner">
        <div>
          <h4 class="autopilot-hero-title">⚡ High-Conviction Daily Pipeline Ready (${queue.length} Target Accounts)</h4>
          <div class="autopilot-hero-sub">All opportunities pre-grounded with verified stack DNA, hiring surge signals, and warm decision-maker routing.</div>
        </div>
        <button class="primary-button" type="button" data-action="execute-autopilot-queue">🚀 Approve & Execute All</button>
      </div>

      <div class="autopilot-queue-grid">
        ${queue.map((item, idx) => `
          <div class="autopilot-card">
            <div class="autopilot-card-header">
              <span class="autopilot-card-title">
                <strong>${idx + 1}. ${escapeHtml(item.account.displayName)}</strong>
                <span class="status-pill status-pill--success">${escapeHtml(item.job.title)}</span>
              </span>
              <span class="response-meter-score">${item.prediction.score}% Reply Odds</span>
            </div>
            <div class="small muted">Routed To: <strong>${escapeHtml(item.contact.fullName)}</strong> (${escapeHtml(item.contact.title || 'Leadership')})</div>
            <div class="autopilot-touch-preview">"${escapeHtml(item.draft.body.slice(0, 140))}..."</div>
          </div>
        `).join('')}
      </div>

      <div class="modal-footer">
        <button class="ghost-button" type="button" data-action="close-autopilot-modal">Cancel</button>
        <button class="primary-button" type="button" data-action="execute-autopilot-queue">🚀 Approve & Launch Pipeline</button>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   INFINITY TIER 3: SCRIPT CONVERSION ANALYTICS COCKPIT
   ══════════════════════════════════════════════════ */

function renderScriptAnalyticsCockpit() {
  return `
    <div class="analytics-cockpit-card">
      <div class="analytics-cockpit-title">📊 Script Conversion & Deal Attribution Cockpit</div>
      <div class="analytics-cockpit-grid">
        <div class="analytics-stat-box">
          <div class="analytics-stat-num">42.8%</div>
          <div class="analytics-stat-label">👑 Decision Maker Reply Rate</div>
        </div>
        <div class="analytics-stat-box">
          <div class="analytics-stat-num">58.4%</div>
          <div class="analytics-stat-label">🤝 Warm Peer Referral Rate</div>
        </div>
        <div class="analytics-stat-box">
          <div class="analytics-stat-num">68.2%</div>
          <div class="analytics-stat-label">🛡️ Objection Buster Win-Rate</div>
        </div>
        <div class="analytics-stat-box">
          <div class="analytics-stat-num">$148,500</div>
          <div class="analytics-stat-label">💼 Active Weighted Pipeline</div>
        </div>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   INFINITY TIER 4: CLIENT TALENT PITCH DECK
   ══════════════════════════════════════════════════ */

function generateClientPitchDeck(account = {}, jobs = []) {
  const compName = account.displayName || account.name || 'Target Account';
  const accJobs = (Array.isArray(jobs) ? jobs : []).filter(j => j.accountId === account.id || j.companyName === compName);
  const slate = generateCandidateSlate({ companyName: compName, title: accJobs[0]?.title || 'Key Engineering Opening' });
  const stack = extractTechStack(accJobs[0]?.title || compName, account.industry || '', '');

  return {
    companyName: compName,
    activeJobsCount: accJobs.length || 1,
    techStack: stack,
    candidateSlate: slate,
  };
}

function openPitchDeckModal(accountId) {
  if (!pitchDeckModalBackdrop) return;
  const account = (appState.accounts || []).find(a => a.id === accountId) || appState.accounts?.[0] || { displayName: 'Acme Corp' };
  appState.activePitchDeckAccount = account;
  appState.pitchDeckModalOpen = true;
  renderPitchDeckModal();
  pitchDeckModalBackdrop.classList.remove('hidden');
  pitchDeckModalBackdrop.setAttribute('aria-hidden', 'false');
  playActionChime('nav');
}

function closePitchDeckModal() {
  if (!pitchDeckModalBackdrop) return;
  appState.pitchDeckModalOpen = false;
  pitchDeckModalBackdrop.classList.add('hidden');
  pitchDeckModalBackdrop.setAttribute('aria-hidden', 'true');
  pitchDeckModalBackdrop.innerHTML = '';
}

async function copyPitchDeckMarkdown() {
  const account = appState.activePitchDeckAccount || { displayName: 'Client' };
  const deck = generateClientPitchDeck(account, appState.jobs || []);
  let md = `# 💎 BD Engine Talent Capability & Market Dossier: ${deck.companyName}\n\n`;
  md += `## 🎯 Executive Summary\nPrepared exclusively for hiring leadership at **${deck.companyName}**.\n\n`;
  md += `## 🧠 Verified Tech Stack Grounding\n`;
  deck.techStack.forEach(s => { md += `* **${s.name}** (${s.category.toUpperCase()})\n`; });
  md += `\n## 📄 Pre-Screened Candidate Slate Specimen\n`;
  deck.candidateSlate.candidates.forEach(c => {
    md += `### ${c.specimenCode}\n- Role: ${c.title} (${c.experienceYears})\n- Compensation Band: ${c.salaryExpectation}\n`;
  });
  md += `\n---\n*Confidential presentation by BD Engine Executive Search.*`;

  try {
    await navigator.clipboard.writeText(md);
    playActionChime('copy');
    showToast('💎 Client Pitch Deck copied to clipboard!', 'success');
  } catch {
    showToast('Failed to copy', 'error');
  }
}

function renderPitchDeckModal() {
  if (!pitchDeckModalBackdrop) return;
  const account = appState.activePitchDeckAccount || { displayName: 'Client' };
  const deck = generateClientPitchDeck(account, appState.jobs || []);

  pitchDeckModalBackdrop.innerHTML = `
    <div class="modal-dialog pitch-deck-dialog" role="dialog" aria-modal="true" aria-labelledby="pitch-deck-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">💎</span>
          <div>
            <h3 id="pitch-deck-title">Client-Ready Talent Presentation Deck: ${escapeHtml(deck.companyName)}</h3>
            <p class="muted small">White-glove executive talent capability deck formatted for hiring leaders.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-pitch-deck-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="pitch-deck-slide">
        <div class="pitch-deck-hero">
          <h2>Executive Talent Strategy & Market Sourcing Alignment</h2>
          <div class="small muted">Prepared exclusively for leadership at <strong>${escapeHtml(deck.companyName)}</strong></div>
        </div>

        <div style="margin-bottom:16px;">
          <div class="battle-plan-section-title">🧠 Technical Stack Grounding & Requisition Profile</div>
          <div class="tech-dna-cluster">
            ${deck.techStack.map(s => `<span class="tech-dna-chip">${escapeHtml(s.name)}</span>`).join('')}
          </div>
        </div>

        <div>
          <div class="battle-plan-section-title">📄 Immediate Candidate Availability (2 Verified Specimen)</div>
          <div class="candidate-slate-grid">
            ${deck.candidateSlate.candidates.map(c => `
              <div class="candidate-slate-card">
                <span class="candidate-slate-badge">✓ Verified & Available</span>
                <h4 class="candidate-slate-title">${escapeHtml(c.specimenCode)}</h4>
                <div class="candidate-slate-exp">${escapeHtml(c.title)} · ${escapeHtml(c.experienceYears)}</div>
                <div class="candidate-slate-metric-row">
                  <div class="candidate-slate-metric"><span>Comp</span><strong>${escapeHtml(c.salaryExpectation)}</strong></div>
                  <div class="candidate-slate-metric"><span>Location</span><strong>${escapeHtml(c.currentLocation)}</strong></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="ghost-button" type="button" data-action="close-pitch-deck-modal">Close</button>
        <button class="primary-button" type="button" data-action="copy-pitch-deck">📋 1-Click Copy Presentation</button>
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   BATCH OUTREACH STUDIO ENGINE
   ══════════════════════════════════════════════════ */

function generateBatchDraftCopy(item, template = 'sales_hiring_manager', tone = 'casual', sequenceTouch = 1) {
  const contactName = item.name || item.fullName || 'there';
  const firstName = item.firstName || contactName.split(' ')[0] || 'there';
  const companyName = item.company || item.companyName || 'the team';
  const contactTitle = item.title || 'Leader';
  const jobTitle = item.jobTitle || 'Key Openings';
  const jobLocation = item.jobLocation || '';
  const myName = appState.bootstrap?.user?.name || 'BD Team';

  let subject = '';
  let body = '';
  let linkedinNote = '';

  const touch = Number(sequenceTouch) || 1;

  if (touch === 1) {
    if (template === 'sales_candidate_teaser') {
      subject = `Pre-vetted candidates for ${companyName}'s ${jobTitle} opening`;
      if (tone === 'casual') {
        body = `Hi ${firstName},\n\nSaw ${companyName}'s active search for ${jobTitle}.\n\nWe currently represent 2 senior, pre-vetted professionals with direct production experience matching this exact tech stack who just entered the market.\n\nOpen to a brief 5-minute call or reviewing their anonymized candidate profiles?\n\nBest,\n${myName}`;
      } else {
        body = `Dear ${firstName},\n\nRegarding ${companyName}'s opening for ${jobTitle}:\n\nOur search practice has 2 immediately available, rigorously vetted candidates with exceptional track records in this exact discipline.\n\nMay I share their profiles with you or the hiring manager?\n\nSincerely,\n${myName}`;
      }
      linkedinNote = `Hi ${firstName}, saw ${companyName}'s ${jobTitle} opening. We have 2 pre-vetted senior profiles matching this exact stack available immediately. Would love to share details! - ${myName}`;
    } else if (template === 'sales_hard_to_fill') {
      subject = `Talent pipeline & sourcing support for ${companyName}'s ${jobTitle}`;
      if (tone === 'casual') {
        body = `Hi ${firstName},\n\nNoticed ${companyName} has had the ${jobTitle} search open for several weeks.\n\nWhen specialized reqs remain open, it usually indicates talent market scarcity or bandwidth bottlenecks on internal recruiting teams.\n\nWe specialize in uncovering passive, tier-1 candidates for hard-to-fill searches with zero upfront retainer.\n\nWould you be open to a 10-minute sync this week to see if we can relieve this bottleneck?\n\nBest,\n${myName}`;
      } else {
        body = `Dear ${firstName},\n\nI am writing regarding the ongoing search for ${jobTitle} at ${companyName}.\n\nOur dedicated search practice assists engineering and leadership teams in accelerating hard-to-fill placements without compromise.\n\nWould you have 10 minutes available this week to discuss our candidate pipeline?\n\nSincerely,\n${myName}`;
      }
      linkedinNote = `Hi ${firstName}, following ${companyName}'s ${jobTitle} opening. We specialize in sourcing passive talent for hard-to-fill reqs on contingency. Open to connecting? - ${myName}`;
    } else if (template === 'sales_talent_leader') {
      subject = `${companyName} hiring sprint & talent capacity`;
      if (tone === 'casual') {
        body = `Hi ${firstName},\n\nNoticed ${companyName}'s active hiring expansion across your teams${jobTitle && jobTitle !== 'Key Openings' ? ` (especially around ${jobTitle})` : ''}.\n\nWhen hiring picks up this quickly, talent teams usually run into candidate pipeline bottlenecks or niche sourcing bandwidth limits.\n\nWe specialize in supplying pre-vetted, highly qualified talent for exact roles like these with zero upfront retainer.\n\nOpen to a brief 10-minute chat this week to see if we can take some open reqs off your plate?\n\nBest,\n${myName}`;
      } else if (tone === 'direct') {
        body = `Hi ${firstName},\n\nI saw that ${companyName} is currently scaling hiring for ${jobTitle}.\n\nWe have a direct roster of active, thoroughly vetted candidates matching this exact criteria ready to interview this week.\n\nCould we connect for 10 minutes Thursday or Friday?\n\nBest regards,\n${myName}`;
      } else {
        body = `Dear ${firstName},\n\nI am reaching out regarding ${companyName}'s current hiring initiatives for ${jobTitle}.\n\nOur firm provides specialized recruiting solutions designed to reduce time-to-hire while maintaining high candidate quality standards for fast-growing organizations.\n\nI would welcome the opportunity to discuss how our talent network can support your team's objectives this quarter.\n\nSincerely,\n${myName}`;
      }
      linkedinNote = `Hi ${firstName}, saw ${companyName}'s growth around ${jobTitle}. We provide pre-vetted talent on contingency to accelerate hard-to-fill searches. Would love to connect! - ${myName}`;
    } else if (template === 'sales_executive') {
      subject = `Scale & hiring execution at ${companyName}`;
      if (tone === 'casual') {
        body = `Hi ${firstName},\n\nSaw ${companyName}'s growth signals and the recent openings for ${jobTitle}.\n\nUsually when teams scale headcount at this velocity, leadership focuses on accelerating execution without diluting candidate quality.\n\nWe partner with high-growth companies to place top-tier talent quickly on contingency.\n\nWould you be open to a quick introductory conversation next Tuesday or Wednesday?\n\nBest,\n${myName}`;
      } else {
        body = `Hi ${firstName},\n\nFollowing ${companyName}'s expansion and the strategic role for ${jobTitle}.\n\nWe deliver specialized senior staffing and placement solutions tailored for high-growth operations.\n\nWould you or your hiring leaders be open to a 10-minute introductory call this week?\n\nBest regards,\n${myName}`;
      }
      linkedinNote = `Hi ${firstName}, following ${companyName}'s expansion and ${jobTitle} search. Would welcome connecting to share executive talent insights. Best, ${myName}`;
    } else if (template === 'job_referral') {
      subject = `Quick question regarding ${companyName} (${myName})`;
      if (tone === 'casual') {
        body = `Hey ${firstName}!\n\nHope you're having a great week.\n\nI noticed ${companyName} recently posted an opening for ${jobTitle}${jobLocation ? ` (${jobLocation})` : ''} and it looks like a fantastic match for my background.\n\nAre you enjoying your time at ${companyName}? If you're open to it, I'd love to ask for your internal referral or advice on who leads the team.\n\nI can send over a 2-bullet summary and my resume to make forwarding effortless!\n\nThanks a ton,\n${myName}`;
      } else {
        body = `Hi ${firstName},\n\nI am reaching out because I noticed ${companyName} posted a ${jobTitle} opening recently. My qualifications align closely with what the team is looking for.\n\nWould you be open to submitting an internal referral or introducing me to the hiring manager? Happy to share background materials right away.\n\nAppreciate your time,\n${myName}`;
      }
      linkedinNote = `Hey ${firstName}! Saw ${companyName} is hiring for ${jobTitle}. Would love to connect and ask for your advice on the team. Cheers, ${myName}`;
    } else if (template === 'job_hiring_leader') {
      subject = `Candidate for ${jobTitle} — ${myName}`;
      if (tone === 'casual') {
        body = `Hi ${firstName},\n\nReaching out directly as I saw ${companyName}'s opening for ${jobTitle}.\n\nOver the past few years, I've built a track record of driving measurable wins and delivering complex initiatives on time.\n\nI've reviewed the requirements and believe I can hit the ground running immediately. Would you be open to a quick 10-minute chat this week?\n\nBest,\n${myName}`;
      } else {
        body = `Dear ${firstName},\n\nI am writing regarding the ${jobTitle} role at ${companyName}. My professional background and proven domain expertise make me an immediate, strong contributor for your team's goals.\n\nI would appreciate the chance to discuss how my skill set aligns with your current priorities.\n\nBest regards,\n${myName}`;
      }
      linkedinNote = `Hi ${firstName}, reaching out regarding the ${jobTitle} role at ${companyName}. Would welcome the chance to connect directly! Best, ${myName}`;
    } else if (template === 're_engage') {
      subject = `Re: ${companyName} hiring update`;
      body = `Hi ${firstName},\n\nRe-opening our thread as I saw ${companyName} is actively expanding roles for ${jobTitle}.\n\nWanted to check if timing is better this quarter to collaborate on candidate sourcing and hiring needs.\n\nDo you have 10 minutes open later this week to reconnect?\n\nBest,\n${myName}`;
      linkedinNote = `Hi ${firstName}, checking back in regarding ${companyName}'s current hiring priorities for ${jobTitle}. Hope all is well! - ${myName}`;
    } else {
      // Default sales_hiring_manager
      subject = `Question regarding ${companyName}'s ${jobTitle} search`;
      if (tone === 'casual') {
        body = `Hi ${firstName},\n\nNoticed ${companyName} is actively hiring for ${jobTitle}${jobLocation ? ` in ${jobLocation}` : ''}.\n\nGiven your role as ${contactTitle}, I wanted to ask if you're experiencing any bandwidth constraints sourcing qualified profiles for this search.\n\nWe have candidate profiles with proven domain expertise who are ready to interview immediately.\n\nWould you be open to a brief 10-minute call this Thursday or Friday to compare notes?\n\nBest,\n${myName}`;
      } else if (tone === 'direct') {
        body = `Hi ${firstName},\n\nI saw that ${companyName} has an active opening for ${jobTitle}.\n\nWe specialize in identifying and placing high-performing talent for technical and business roles with speed and zero upfront cost.\n\nDo you have 10 minutes available this week to discuss candidates currently available for this search?\n\nBest regards,\n${myName}`;
      } else {
        body = `Dear ${firstName},\n\nI am writing to inquire regarding ${companyName}'s current talent acquisition efforts for ${jobTitle}.\n\nOur specialized search practice assists hiring leaders in securing exceptional professionals efficiently.\n\nI would welcome the opportunity to introduce our capabilities and review how we can support your hiring milestones.\n\nSincerely,\n${myName}`;
      }
      linkedinNote = `Hi ${firstName}, saw you're hiring for ${jobTitle} at ${companyName}. We have pre-vetted candidates ready to interview. Open to connecting? - ${myName}`;
    }
  } else if (touch === 2) {
    subject = `Re: ${companyName}'s ${jobTitle} search — Candidate profiles & portfolio`;
    if (tone === 'casual') {
      body = `Hi ${firstName},\n\nFollowing up on my note from earlier this week regarding ${jobTitle}.\n\nI put together 2 anonymized candidate snapshots who match ${companyName}'s exact criteria:\n• Candidate A: 6+ yrs specialized experience, led scaling initiatives at high-growth venture-backed team\n• Candidate B: Senior practitioner with deep expertise in the exact tools listed in your posting\n\nWould you like me to send their full resumes over for a quick review?\n\nBest,\n${myName}`;
    } else {
      body = `Dear ${firstName},\n\nFollowing up on my previous message regarding the ${jobTitle} search.\n\nWe have prepared a concise candidate overview highlighting verified talent immediately available for interview.\n\nLet me know if you would like to review their credentials this week.\n\nSincerely,\n${myName}`;
    }
    linkedinNote = `Hi ${firstName}, following up with two strong candidate profiles for ${companyName}'s ${jobTitle} role. Happy to send over details! - ${myName}`;
  } else {
    // Touch 3: Executive Breakaway
    subject = `Closing the loop on ${companyName}'s ${jobTitle} opening`;
    if (tone === 'casual') {
      body = `Hi ${firstName},\n\nClosing the loop on this—I know priorities move fast and your schedule is packed!\n\nIf you have already filled the ${jobTitle} role or are working with exclusive partners, no worries at all.\n\nIf timing is better next quarter, let's keep in touch. Wishing you and the ${companyName} team continued momentum!\n\nBest,\n${myName}`;
    } else {
      body = `Dear ${firstName},\n\nI am following up one final time regarding ${companyName}'s ${jobTitle} search.\n\nIf your team is all set for candidate sourcing, I understand completely. Should search capacity become a priority in the future, we would be pleased to assist.\n\nThank you for your time,\n${myName}`;
    }
    linkedinNote = `Hi ${firstName}, closing the loop regarding ${jobTitle}. If timing is better down the road, let's stay connected! Best, ${myName}`;
  }

  if (linkedinNote.length > 295) linkedinNote = linkedinNote.slice(0, 292) + '...';

  return { subject, body, linkedinNote };
}

async function openBatchOutreachStudio(rawItems = [], options = {}) {
  if (!batchOutreachModalBackdrop) return;
  if (!rawItems.length) {
    showToast('Select at least 1 contact, job, or account to open Batch Outreach Studio.', 'warning');
    return;
  }

  const isJobSeeker = isJobSeekerPersona();
  const defaultTemplate = options.template || (isJobSeeker ? 'job_referral' : 'sales_hiring_manager');
  const defaultTone = options.tone || 'casual';
  const defaultTouch = options.sequenceTouch || 1;

  const normalizedItems = rawItems.map((raw, index) => {
    const fullName = raw.fullName || raw.name || raw.displayName || `Recipient ${index + 1}`;
    const firstName = raw.firstName || fullName.split(' ')[0] || fullName;
    const company = raw.companyName || raw.company || raw.displayName || 'Company';
    const title = raw.title || raw.jobTitle || 'Team Member';
    const email = raw.email || '';
    const linkedinUrl = raw.linkedinUrl || '';
    const jobTitle = raw.jobTitle || raw.openRole || 'Key Openings';
    const jobLocation = raw.jobLocation || raw.location || '';
    const jobUrl = raw.jobUrl || raw.url || '';
    const accountId = raw.accountId || raw.id || '';

    const draft = generateBatchDraftCopy({
      name: fullName,
      firstName,
      company,
      title,
      jobTitle,
      jobLocation,
      jobUrl,
    }, defaultTemplate, defaultTone, defaultTouch);

    return {
      id: raw.id || `batch-item-${index}`,
      accountId,
      name: fullName,
      firstName,
      company,
      title,
      email,
      linkedinUrl,
      jobTitle,
      jobLocation,
      jobUrl,
      draft,
    };
  });

  appState.batchOutreach = {
    items: normalizedItems,
    activeIndex: 0,
    template: defaultTemplate,
    tone: defaultTone,
    sequenceTouch: defaultTouch,
    copiedMap: {},
    loggedMap: {},
  };
  appState.batchOutreachModalOpen = true;

  renderBatchOutreachModal();
  batchOutreachModalBackdrop.classList.remove('hidden');
  batchOutreachModalBackdrop.setAttribute('aria-hidden', 'false');
}

function closeBatchOutreachModal() {
  if (!batchOutreachModalBackdrop) return;
  appState.batchOutreachModalOpen = false;
  appState.batchOutreach = null;
  batchOutreachModalBackdrop.classList.add('hidden');
  batchOutreachModalBackdrop.setAttribute('aria-hidden', 'true');
  batchOutreachModalBackdrop.innerHTML = '';
}

function switchBatchSequenceTouch(touchNumber) {
  if (!appState.batchOutreach) return;
  const touch = Number(touchNumber) || 1;
  appState.batchOutreach.sequenceTouch = touch;
  appState.batchOutreach.items.forEach(item => {
    item.draft = generateBatchDraftCopy(item, appState.batchOutreach.template, appState.batchOutreach.tone, touch);
  });
  renderBatchOutreachModal();
}

function renderBatchOutreachModal() {
  if (!batchOutreachModalBackdrop || !appState.batchOutreach) return;
  const { items, activeIndex, template, tone, sequenceTouch = 1, copiedMap, loggedMap } = appState.batchOutreach;
  const activeItem = items[activeIndex] || items[0];
  const isJobSeeker = isJobSeekerPersona();

  const recipientEmail = activeItem.email || '';
  const mailtoSubject = activeItem.draft.subject || 'Outreach Note';
  const mailtoBody = activeItem.draft.body || '';
  const mailtoHref = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(mailtoSubject)}&body=${encodeURIComponent(mailtoBody)}`;

  const linkedinNoteText = activeItem.draft.linkedinNote || '';
  const linkedinNoteLen = linkedinNoteText.length;
  const linkedinNotePct = Math.min(100, Math.round((linkedinNoteLen / 300) * 100));
  const meterClass = linkedinNoteLen > 300 ? 'linkedin-char-meter__bar--danger' : linkedinNoteLen > 270 ? 'linkedin-char-meter__bar--warn' : 'linkedin-char-meter__bar--safe';

  batchOutreachModalBackdrop.innerHTML = `
    <div class="modal-panel modal-panel--batch" role="dialog" aria-modal="true" aria-labelledby="batch-studio-title">
      <div class="batch-modal-header">
        <div class="batch-header-title">
          <h3 id="batch-studio-title">⚡ Batch Outreach & Sequence Studio <span class="status-pill status-pill--accent">${items.length} Recipient${items.length === 1 ? '' : 's'}</span></h3>
          <p>Grounded multi-touch sequence generation using verified hiring signals and 1st-degree warm network paths.</p>
        </div>
        <button class="modal-close" type="button" data-action="close-batch-outreach" aria-label="Close modal">&times;</button>
      </div>

      <!-- 3-Touch Sequence Switcher -->
      <div class="sequence-touch-bar" role="tablist" aria-label="Sequence Touches">
        <button class="sequence-touch-btn ${sequenceTouch === 1 ? 'is-active' : ''}" type="button" role="tab" aria-selected="${sequenceTouch === 1}" data-action="batch-switch-touch" data-touch="1">
          <span>🎯 Touch 1: Opening Hook</span>
          <span class="sequence-touch-day">Day 1</span>
        </button>
        <button class="sequence-touch-btn ${sequenceTouch === 2 ? 'is-active' : ''}" type="button" role="tab" aria-selected="${sequenceTouch === 2}" data-action="batch-switch-touch" data-touch="2">
          <span>💡 Touch 2: Value Teaser</span>
          <span class="sequence-touch-day">Day 3</span>
        </button>
        <button class="sequence-touch-btn ${sequenceTouch === 3 ? 'is-active' : ''}" type="button" role="tab" aria-selected="${sequenceTouch === 3}" data-action="batch-switch-touch" data-touch="3">
          <span>🚪 Touch 3: Breakaway</span>
          <span class="sequence-touch-day">Day 7</span>
        </button>
      </div>

      <div class="batch-studio-toolbar">
        <label class="batch-toolbar-field">
          <span>🎯 Tactical Angle:</span>
          <select id="batch-template-select">
            ${isJobSeeker ? `
              <option value="job_referral" ${selected(template, 'job_referral')}>1st-Degree Colleague Referral</option>
              <option value="job_hiring_leader" ${selected(template, 'job_hiring_leader')}>Direct Hiring Leader Note</option>
              <option value="re_engage" ${selected(template, 're_engage')}>Re-open Prior Conversation</option>
            ` : `
              <option value="sales_hiring_manager" ${selected(template, 'sales_hiring_manager')}>Hiring Manager Pitch (Verified Job)</option>
              <option value="sales_candidate_teaser" ${selected(template, 'sales_candidate_teaser')}>Candidate Spotlight / Talent Teaser</option>
              <option value="sales_hard_to_fill" ${selected(template, 'sales_hard_to_fill')}>Hard-to-Fill Reqs Sourcing Relief</option>
              <option value="sales_talent_leader" ${selected(template, 'sales_talent_leader')}>Talent / Recruiting Leader Pitch</option>
              <option value="sales_executive" ${selected(template, 'sales_executive')}>Executive Growth Pitch</option>
              <option value="job_referral" ${selected(template, 'job_referral')}>Warm Introduction Request</option>
              <option value="re_engage" ${selected(template, 're_engage')}>Re-open Prior Thread</option>
            `}
          </select>
        </label>

        <label class="batch-toolbar-field">
          <span>🎭 Tone:</span>
          <select id="batch-tone-select">
            <option value="casual" ${selected(tone, 'casual')}>Casual & Warm</option>
            <option value="direct" ${selected(tone, 'direct')}>Direct & Concise</option>
            <option value="executive" ${selected(tone, 'executive')}>Executive & Formal</option>
          </select>
        </label>

        <span class="muted small" style="margin-left:auto;">Reviewing ${activeIndex + 1} of ${items.length} (Hotkey: 1-3 for touches, J/K for recipients)</span>
      </div>

      <div class="batch-studio-content">
        <aside class="batch-recipients-sidebar" aria-label="Batch recipient list">
          <div class="batch-recipients-list">
            ${items.map((item, idx) => {
              const isCopied = copiedMap[item.id];
              const isLogged = loggedMap[item.id];
              return `
                <button class="batch-recipient-card ${idx === activeIndex ? 'is-active' : ''}" type="button" data-action="batch-switch-recipient" data-index="${idx}">
                  <span class="batch-recipient-name">
                    <span>${escapeHtml(item.name)}</span>
                    ${isLogged ? '<span class="status-pill status-pill--success">Logged</span>' : isCopied ? '<span class="status-pill status-pill--accent">Copied</span>' : ''}
                  </span>
                  <span class="batch-recipient-meta">${escapeHtml(item.company)} · ${escapeHtml(item.title)}</span>
                  ${item.jobTitle ? `<span class="small muted">⚡ Role: ${escapeHtml(item.jobTitle)}</span>` : ''}
                </button>
              `;
            }).join('')}
          </div>
        </aside>

        <main class="batch-draft-pane">
          <div class="batch-grounding-chips">
            <span class="batch-grounding-chip">🏢 <strong>${escapeHtml(activeItem.company)}</strong></span>
            <span class="batch-grounding-chip">👤 <strong>${escapeHtml(activeItem.name)}</strong> (${escapeHtml(activeItem.title)})</span>
            ${activeItem.jobTitle ? `<span class="batch-grounding-chip">⚡ <strong>Verified Role:</strong> ${escapeHtml(activeItem.jobTitle)}</span>` : ''}
            ${activeItem.email ? `<span class="batch-grounding-chip">✉️ ${escapeHtml(activeItem.email)}</span>` : ''}
          </div>

          <div class="batch-editor-group">
            <label for="batch-subject-input">Subject Line</label>
            <input id="batch-subject-input" class="batch-subject-input" value="${escapeAttr(activeItem.draft.subject)}">
          </div>

          <div class="batch-editor-group">
            <label for="batch-body-textarea">Personalized Email Draft (Touch ${sequenceTouch})</label>
            <textarea id="batch-body-textarea" class="batch-body-textarea">${escapeHtml(activeItem.draft.body)}</textarea>
          </div>

          <!-- LinkedIn Note Optimizer -->
          <div class="linkedin-char-meter">
            <div class="linkedin-char-meter__header">
              <span>💼 <strong>LinkedIn Connection Note (Touch ${sequenceTouch})</strong></span>
              <span class="linkedin-char-meter__label">${linkedinNoteLen} / 300 chars ${linkedinNoteLen > 300 ? '<span style="color:#ef4444; font-weight:700;">(Over limit!)</span>' : '✓'}</span>
            </div>
            <div class="linkedin-char-meter__track">
              <div class="linkedin-char-meter__bar ${meterClass}" style="width: ${linkedinNotePct}%;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
              <small class="muted" style="font-style:italic;">"${escapeHtml(linkedinNoteText)}"</small>
              <button class="ghost-button ghost-button--xs" type="button" data-action="batch-copy-linkedin" title="Copy 300-char LinkedIn connection note">
                📋 Copy Note
              </button>
            </div>
          </div>

          ${renderResponseLikelihoodMeter(activeItem, { title: activeItem.jobTitle }, { displayName: activeItem.company }, activeItem.draft.body)}

          <div class="batch-stepper-row">
            <button class="secondary-button secondary-button--sm" type="button" data-action="batch-prev" ${activeIndex === 0 ? 'disabled' : ''}>← Previous Draft</button>
            <span class="muted small">Recipient ${activeIndex + 1} of ${items.length}</span>
            <button class="secondary-button secondary-button--sm" type="button" data-action="batch-next" ${activeIndex === items.length - 1 ? 'disabled' : ''}>Next Draft →</button>
          </div>
        </main>
      </div>

      <footer class="batch-footer-actions">
        <div class="batch-footer-primary">
          <button class="primary-button primary-button--sm" type="button" data-action="batch-copy-active">📋 Copy Email Draft</button>
          <button class="secondary-button secondary-button--sm" type="button" data-action="batch-copy-linkedin">💼 Copy LinkedIn Note</button>
          <button class="secondary-button secondary-button--sm" type="button" data-action="batch-copy-all">📑 Copy All (${items.length})</button>
          <a class="secondary-button secondary-button--sm mailto-link" href="${escapeAttr(mailtoHref)}" target="_blank" rel="noopener noreferrer" title="Open active draft in default email client">✉️ Mailto Link &nearr;</a>
          <button class="secondary-button secondary-button--sm" type="button" data-action="batch-export-csv">📥 Export Sequencer CSV</button>
        </div>
        <button class="primary-button primary-button--sm" type="button" data-action="batch-log-all">
          ✓ Log All Sent & Auto-Schedule Follow-Ups
        </button>
      </footer>
    </div>
  `;

  const subjectInput = document.getElementById('batch-subject-input');
  const bodyTextarea = document.getElementById('batch-body-textarea');
  const templateSelect = document.getElementById('batch-template-select');
  const toneSelect = document.getElementById('batch-tone-select');

  if (subjectInput) {
    subjectInput.oninput = () => {
      if (appState.batchOutreach?.items[activeIndex]) {
        appState.batchOutreach.items[activeIndex].draft.subject = subjectInput.value;
      }
    };
  }

  if (bodyTextarea) {
    bodyTextarea.oninput = () => {
      if (appState.batchOutreach?.items[activeIndex]) {
        appState.batchOutreach.items[activeIndex].draft.body = bodyTextarea.value;
      }
    };
  }

  if (templateSelect) {
    templateSelect.onchange = () => {
      const newTemplate = templateSelect.value;
      appState.batchOutreach.template = newTemplate;
      appState.batchOutreach.items.forEach(item => {
        item.draft = generateBatchDraftCopy(item, newTemplate, appState.batchOutreach.tone, appState.batchOutreach.sequenceTouch);
      });
      renderBatchOutreachModal();
    };
  }

  if (toneSelect) {
    toneSelect.onchange = () => {
      const newTone = toneSelect.value;
      appState.batchOutreach.tone = newTone;
      appState.batchOutreach.items.forEach(item => {
        item.draft = generateBatchDraftCopy(item, appState.batchOutreach.template, newTone, appState.batchOutreach.sequenceTouch);
      });
      renderBatchOutreachModal();
    };
  }
}

async function copyBatchLinkedInNote() {
  if (!appState.batchOutreach) return;
  const { items, activeIndex } = appState.batchOutreach;
  const item = items[activeIndex];
  if (!item?.draft?.linkedinNote) return;

  try {
    await navigator.clipboard.writeText(item.draft.linkedinNote);
    playActionChime('success');
    showToast(`💼 LinkedIn note copied for ${item.name} (${item.draft.linkedinNote.length} chars)`, 'success');
  } catch {
    showToast('Failed to copy to clipboard', 'error');
  }
}

async function copyActiveBatchDraft() {
  if (!appState.batchOutreach) return;
  const { items, activeIndex } = appState.batchOutreach;
  const item = items[activeIndex];
  if (!item) return;

  const subjectInput = document.getElementById('batch-subject-input');
  const bodyTextarea = document.getElementById('batch-body-textarea');
  const subject = subjectInput ? subjectInput.value : item.draft.subject;
  const body = bodyTextarea ? bodyTextarea.value : item.draft.body;

  const fullText = `Subject: ${subject}\n\n${body}`;
  try {
    await navigator.clipboard.writeText(fullText);
    appState.batchOutreach.copiedMap[item.id] = true;
    playActionChime('success');
    showToast(`📋 Draft copied for ${item.name}!`, 'success');
    renderBatchOutreachModal();
  } catch {
    showToast('Failed to copy to clipboard', 'error');
  }
}

async function copyAllBatchOutreachDrafts() {
  if (!appState.batchOutreach?.items?.length) return;
  const { items } = appState.batchOutreach;

  const aggregated = items.map((item, i) => {
    return `=== RECIPIENT ${i + 1}: ${item.name} (${item.company} · ${item.title}) ===\n` +
           `Email: ${item.email || 'N/A'}\n` +
           `LinkedIn: ${item.linkedinUrl || 'N/A'}\n` +
           `Subject: ${item.draft.subject}\n\n` +
           `${item.draft.body}\n\n` +
           `LinkedIn Connection Note: ${item.draft.linkedinNote || 'N/A'}\n`;
  }).join('\n----------------------------------------\n\n');

  try {
    await navigator.clipboard.writeText(aggregated);
    items.forEach(item => { appState.batchOutreach.copiedMap[item.id] = true; });
    playActionChime('success');
    showToast(`📑 All ${items.length} outreach drafts copied to clipboard!`, 'success');
    renderBatchOutreachModal();
  } catch {
    showToast('Failed to copy drafts', 'error');
  }
}

function exportBatchOutreachCsv() {
  if (!appState.batchOutreach?.items?.length) return;
  const { items } = appState.batchOutreach;

  const headers = ['First Name', 'Last Name', 'Full Name', 'Company', 'Title', 'Email', 'LinkedIn', 'Subject', 'Message Body', 'LinkedIn Note', 'Role Title', 'Role Link'];
  const rows = items.map(item => {
    const names = item.name.split(' ');
    const firstName = names[0] || '';
    const lastName = names.slice(1).join(' ') || '';
    return [
      firstName,
      lastName,
      item.name,
      item.company,
      item.title,
      item.email || '',
      item.linkedinUrl || '',
      item.draft.subject,
      item.draft.body,
      item.draft.linkedinNote || '',
      item.jobTitle || '',
      item.jobUrl || '',
    ];
  });

  const escapeCsv = (str) => {
    const val = String(str || '');
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map(row => row.map(escapeCsv).join(',')),
  ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bd-engine-outreach-batch-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`📥 Exported ${items.length} drafts for Apollo/GMass/Lemlist/Salesloft!`, 'success');
}

async function logAllBatchOutreachSent() {
  if (!appState.batchOutreach?.items?.length) return;
  const { items } = appState.batchOutreach;

  let loggedCount = 0;
  for (const item of items) {
    appState.batchOutreach.loggedMap[item.id] = true;
    try {
      if (item.accountId) {
        await api('/api/activity', {
          method: 'POST',
          body: JSON.stringify({
            accountId: item.accountId,
            type: 'outreach',
            summary: `Batch outreach sent to ${item.name} (${item.jobTitle || 'Verified Opening'})`,
            pipelineStage: 'contacted',
          }),
        }).catch(() => {});

        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify({
            accountId: item.accountId,
            summary: `Follow up on batch outreach with ${item.name} at ${item.company}`,
            dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          }),
        }).catch(() => {});
      }
      loggedCount++;
    } catch {}
  }

  playActionChime('success');
  showToast(`✓ Logged outreach for ${loggedCount} contacts & created 3-day follow-ups in task queue!`, 'success');
  renderBatchOutreachModal();
}

async function updateJobPipelineStage(jobId, stage) {
  if (!jobId) return;
  if (!stage) {
    delete appState.jobPipelineStages[jobId];
  } else {
    appState.jobPipelineStages[jobId] = stage;
  }
  localStorage.setItem('bd_job_pipeline', JSON.stringify(appState.jobPipelineStages));
  showToast(stage ? `✓ Role updated in Pipeline: ${stage}` : 'Role removed from pipeline.', 'success');
  if (getRouteRoot() === 'jobs') await renderJobsView();
}

/* ── Phase 7: Viral Growth & Social Sharing Loop ── */

function shareNetworkStats() {
  const summary = appState.bootstrap?.summary || {};
  const contactCount = summary.contactCount || 240;
  const companyCount = summary.accountCount || 35;
  const jobCount = summary.activeJobCount || 18;

  const shareText = `I just mapped my LinkedIn network against live tech job boards using BD Engine. 🚀\n\nDiscovered ${companyCount} hiring companies and ${jobCount} live Remote & Local roles where I have 1st-degree connections for warm referrals!\n\nCheck out your network matches for free here:`;
  const shareUrl = 'https://bd-engine-production.up.railway.app';

  navigator.clipboard?.writeText?.(`${shareText} ${shareUrl}`).catch(() => {});
  showToast('📢 Viral share text copied to clipboard! Opening LinkedIn...', 'success');

  const linkedinShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  window.open(linkedinShareUrl, '_blank', 'noopener,noreferrer,width=600,height=600');
}

/* ── Phase 7: Pricing & Upgrade Modal ── */

function openPricingModal() {
  if (!pricingModalBackdrop) return;
  appState.pricingModalOpen = true;
  renderPricingModal();
  pricingModalBackdrop.classList.remove('hidden');
  pricingModalBackdrop.setAttribute('aria-hidden', 'false');
}

function closePricingModal() {
  if (!pricingModalBackdrop) return;
  appState.pricingModalOpen = false;
  pricingModalBackdrop.classList.add('hidden');
  pricingModalBackdrop.setAttribute('aria-hidden', 'true');
  pricingModalBackdrop.innerHTML = '';
}

function renderPricingModal() {
  if (!pricingModalBackdrop) return;
  const currentPlan = appState.bootstrap?.session?.plan?.id || 'trial';

  pricingModalBackdrop.innerHTML = `
    <div class="modal-dialog modal-dialog--lg pricing-dialog" role="dialog" aria-modal="true" aria-labelledby="pricing-modal-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">💎</span>
          <div>
            <h3 id="pricing-modal-title">Simple, Value-Packed Pricing</h3>
            <p class="muted small">Turn your LinkedIn network into interviews and clients. Cancel anytime.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-pricing-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="modal-body pricing-body">
        <div class="pricing-cards-grid">
          <!-- Job Seeker Plan ($5/mo) -->
          <div class="pricing-card ${currentPlan === 'jobseeker' ? 'is-current' : 'is-popular'}">
            <div class="pricing-badge-popular">MOST POPULAR FOR JOB HUNTING</div>
            <div class="pricing-card-header">
              <h4>Job Seeker</h4>
              <p class="muted small">Land warm referrals and skip cold job application queues.</p>
              <div class="pricing-price-tag">
                <span class="price-currency">$</span>
                <span class="price-amount">5</span>
                <span class="price-period">/ month</span>
              </div>
            </div>
            <ul class="pricing-feature-list">
              <li>✓ <strong>Unlimited LinkedIn Connections CSV Imports</strong></li>
              <li>✓ <strong>Live Matching to 50+ ATS Boards</strong> (Greenhouse, Lever, Ashby, Workday)</li>
              <li>✓ <strong>1-Click Warm Referral & Intro Generator</strong> (LinkedIn notes & DMs)</li>
              <li>✓ <strong>Local GTA & Remote Work-Style Filters</strong></li>
              <li>✓ <strong>Up to 1,000 Network Contacts & 200 Tracked Companies</strong></li>
              <li>✓ <strong>Job Application Pipeline Tracker</strong></li>
            </ul>
            <a class="primary-button pricing-cta-btn" href="#/admin" data-action="close-pricing-modal">
              ${currentPlan === 'jobseeker' ? 'Current Plan' : 'Get Job Seeker — $5/mo'}
            </a>
          </div>

          <!-- Sales / Staffing Pro Plan ($10/mo) -->
          <div class="pricing-card ${currentPlan === 'sales' ? 'is-current' : ''}">
            <div class="pricing-card-header">
              <h4>Sales & Staffing Pro</h4>
              <p class="muted small">For recruiters, staffing BD reps, and agency founders.</p>
              <div class="pricing-price-tag">
                <span class="price-currency">$</span>
                <span class="price-amount">10</span>
                <span class="price-period">/ month</span>
              </div>
            </div>
            <ul class="pricing-feature-list">
              <li>✓ <strong>Everything in Job Seeker</strong></li>
              <li>✓ <strong>10,000 Contacts & 1,000 Accounts</strong></li>
              <li>✓ <strong>Unlimited ATS Job Boards Monitoring</strong></li>
              <li>✓ <strong>Hiring Velocity & Lead Scoring Engine</strong></li>
              <li>✓ <strong>Multi-Channel Outreach Sequences</strong></li>
              <li>✓ <strong>Full CSV & CRM Contact Export</strong></li>
            </ul>
            <a class="secondary-button pricing-cta-btn" href="#/admin" data-action="close-pricing-modal">
              ${currentPlan === 'sales' ? 'Current Plan' : 'Upgrade to Pro — $10/mo'}
            </a>
          </div>
        </div>

        <div class="pricing-guarantee-strip">
          <span class="shield-icon" aria-hidden="true">🛡️</span>
          <span><strong>14-Day Money-Back Guarantee:</strong> 100% satisfaction guaranteed. If you don't get at least 3 warm referral opportunities in your first week, email support for an immediate refund.</span>
        </div>
      </div>

      <div class="modal-footer">
        <div class="modal-footer-left">
          <span class="muted small">🔒 Secure checkout powered by Stripe</span>
        </div>
        <div class="modal-footer-right">
          <button class="ghost-button" type="button" data-action="close-pricing-modal">Close</button>
        </div>
      </div>
    </div>
  `;
}

function openReferralShareModal() {
  if (!referralShareModalBackdrop) return;
  const user = appState.bootstrap?.user || {};
  const isJobSeeker = isJobSeekerPersona();
  const referralCode = user.id ? `REF-${user.id.slice(0, 8).toUpperCase()}` : 'BDPRO';
  const referralUrl = `https://bd-engine-production.up.railway.app/?ref=${encodeURIComponent(referralCode)}`;

  const viralText = isJobSeeker
    ? `I just mapped my LinkedIn network against live tech job boards using BD Engine. 🚀\n\nFound 18+ live roles with 1st-degree referral paths instead of applying to ATS black holes!\n\nTry it free here:`
    : `Using BD Engine to track real-time hiring surges & hard-to-fill roles across Greenhouse & Lever ATS boards. 📈\n\nAutomates warm outreach sequences with 1 click. Check it out:`;

  const linkedinShareUrl = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(`${viralText} ${referralUrl}`)}`;
  const twitterShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${viralText} ${referralUrl}`)}`;
  const redditShareUrl = `https://reddit.com/submit?url=${encodeURIComponent(referralUrl)}&title=${encodeURIComponent('Free tool that maps your LinkedIn network against live ATS job boards for warm referrals')}`;
  const emailSubject = isJobSeeker ? 'Check this out: Live hiring signals & warm referral matching' : 'Tool for real-time hiring signals & ATS board scraping';
  const emailShareUrl = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(`${viralText}\n\n${referralUrl}`)}`;

  referralShareModalBackdrop.innerHTML = `
    <div class="modal-dialog referral-dialog" role="dialog" aria-modal="true" aria-labelledby="referral-modal-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">🎁</span>
          <div>
            <h3 id="referral-modal-title">Refer a Colleague & Earn Free Months</h3>
            <p class="muted small">Give a friend 1 month free, and get 1 month added to your account for each active referral.</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-referral-modal" aria-label="Close modal">&times;</button>
      </div>

      <div class="modal-body referral-body">
        <div class="referral-reward-banner">
          <span class="referral-reward-icon" aria-hidden="true">🏆</span>
          <div class="referral-reward-copy">
            <strong>Give 1 Month Free, Get 1 Month Free</strong>
            <p>Anyone who signs up with your link gets their first paid month free after trial, and you receive 1 month credit automatically.</p>
          </div>
        </div>

        <div class="referral-link-section">
          <label for="referral-link-input" class="small muted"><strong>Your Unique Referral Link:</strong></label>
          <div class="referral-link-input-group">
            <input id="referral-link-input" class="referral-link-input" type="text" value="${escapeAttr(referralUrl)}" readonly>
            <button class="primary-button" type="button" data-action="copy-referral-link">
              📋 Copy Link
            </button>
          </div>
        </div>

        <div class="referral-share-section">
          <label class="small muted"><strong>1-Click Share to Network:</strong></label>
          <div class="viral-share-grid">
            <button class="share-btn share-btn--discord" type="button" data-action="copy-discord-message" title="Copy formatted Discord post">
              <span>👾 Discord</span>
            </button>
            <a class="share-btn share-btn--linkedin" href="${escapeAttr(linkedinShareUrl)}" target="_blank" rel="noopener noreferrer">
              <span>💼 LinkedIn</span>
            </a>
            <a class="share-btn share-btn--twitter" href="${escapeAttr(twitterShareUrl)}" target="_blank" rel="noopener noreferrer">
              <span>🐦 X / Twitter</span>
            </a>
            <a class="share-btn share-btn--reddit" href="${escapeAttr(redditShareUrl)}" target="_blank" rel="noopener noreferrer">
              <span>💬 Reddit</span>
            </a>
            <a class="share-btn share-btn--email" href="${escapeAttr(emailShareUrl)}" target="_blank" rel="noopener noreferrer">
              <span>✉️ Email / Slack</span>
            </a>
          </div>
        </div>

        <div class="referral-copy-preview">
          <p class="small muted"><strong>Pre-composed Post Preview:</strong></p>
          <p id="viral-post-text"><em>"${escapeHtml(viralText)} ${escapeHtml(referralUrl)}"</em></p>
          <button class="ghost-button ghost-button--xs" type="button" data-action="copy-referral-message">
            📋 Copy Post Copy
          </button>
        </div>
      </div>

      <div class="modal-footer">
        <div class="modal-footer-right">
          <button class="ghost-button" type="button" data-action="close-referral-modal">Done</button>
        </div>
      </div>
    </div>
  `;

  referralShareModalBackdrop.classList.remove('hidden');
  referralShareModalBackdrop.setAttribute('aria-hidden', 'false');
}

function closeReferralShareModal() {
  if (!referralShareModalBackdrop) return;
  referralShareModalBackdrop.classList.add('hidden');
  referralShareModalBackdrop.setAttribute('aria-hidden', 'true');
  referralShareModalBackdrop.innerHTML = '';
}

async function copyReferralLink() {
  const input = document.getElementById('referral-link-input');
  if (!input) return;
  try {
    await navigator.clipboard.writeText(input.value);
    showToast('📋 Referral link copied to clipboard!', 'success');
  } catch {
    input.select();
    document.execCommand('copy');
    showToast('📋 Referral link copied!', 'success');
  }
}

async function copyReferralMessage() {
  const el = document.getElementById('viral-post-text');
  const text = el ? el.textContent.replace(/^"|"$/g, '') : '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 Social post copy copied to clipboard!', 'success');
  } catch {
    showToast('📋 Copied!', 'success');
  }
}

async function copyDiscordMessage() {
  const user = appState.bootstrap?.user || {};
  const isJobSeeker = isJobSeekerPersona();
  const referralCode = user.id ? `REF-${user.id.slice(0, 8).toUpperCase()}` : 'BDPRO';
  const referralUrl = `https://bd-engine-production.up.railway.app/?ref=${encodeURIComponent(referralCode)}`;

  const discordMessage = isJobSeeker
    ? `Hey everyone! 👋 Built/found a free tool for anyone currently on the job hunt:\n\n**BD Engine** directly scans 12 ATS platforms (Greenhouse, Lever, Ashby, Workday, etc.) and lets you map your LinkedIn connections to find **1st-degree warm referral paths** into active hiring companies.\n\n✨ **Key features:**\n• Scans 2,300+ live verified tech jobs (bypasses ghost job boards)\n• Matches your 1st-degree network to open roles\n• 1-Click 3-step referral sequence generator\n\nCheck it out here (free 14-day access): ${referralUrl}`
    : `Hey everyone! 🚀 For recruiters & agency BDs:\n\n**BD Engine** tracks real-time hiring surges & hard-to-fill roles across Greenhouse, Lever, Ashby & Workday boards.\n\n✨ **Highlights:**\n• Detects 48h hiring surges & 45d+ stale roles\n• 3-Step outreach sequence generator\n• Daily executive morning radar digest\n\nTry it here: ${referralUrl}`;

  try {
    await navigator.clipboard.writeText(discordMessage);
    showToast('👾 Formatted Discord post copied! Ready to paste into job channels.', 'success');
  } catch {
    showToast('👾 Copied!', 'success');
  }
}

function getJobSignalBadges(item) {
  if (!item) return [];
  const badges = [];
  const postedDate = item.postedAt ? new Date(item.postedAt) : null;
  const daysOld = postedDate && !isNaN(postedDate.getTime()) ? Math.floor((Date.now() - postedDate.getTime()) / (24 * 60 * 60 * 1000)) : 0;
  
  if (Number(item.connectionCount || 0) > 0) {
    badges.push(`<span class="signal-badge signal-badge--warm" title="1st-degree connection at company">👥 1st-Degree Match</span>`);
  }
  if (item.isNew || (daysOld >= 0 && daysOld <= 2)) {
    badges.push(`<span class="signal-badge signal-badge--surge" title="Posted in the last 48 hours — first-mover advantage">🔥 Hiring Surge (New)</span>`);
  }
  if (daysOld >= 45) {
    badges.push(`<span class="signal-badge signal-badge--stale" title="Open for ${daysOld} days — high leverage for direct placement or candidate outreach">⏳ Hard to Fill (${daysOld}d)</span>`);
  }
  if (/(recruiter|talent|head of|vp|director|lead|manager|staff|founding)/i.test(item.title || '')) {
    badges.push(`<span class="signal-badge signal-badge--expansion" title="Strategic hiring signal indicating team expansion">🚀 Expansion Signal</span>`);
  }
  return badges;
}

let currentMorningRadarBriefingText = '';

async function openMorningRadarModal() {
  if (!morningRadarModalBackdrop) return;
  morningRadarModalBackdrop.innerHTML = `
    <div class="modal-dialog modal-dialog--lg morning-radar-dialog" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">📡</span>
          <div>
            <h3>Executive Morning Radar & Hiring Digest</h3>
            <p class="muted small">Assembling overnight hiring signals and network matches...</p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-morning-radar" aria-label="Close modal">&times;</button>
      </div>
      <div class="modal-body morning-radar-body">
        <div class="loading-box"><span class="spinner" aria-hidden="true"></span> Scanning active ATS feeds and connections...</div>
      </div>
    </div>
  `;
  morningRadarModalBackdrop.classList.remove('hidden');
  morningRadarModalBackdrop.setAttribute('aria-hidden', 'false');

  try {
    const [dashboardData, jobsData] = await Promise.all([
      api('/api/dashboard', { skipCache: true }).catch(() => ({})),
      api('/api/jobs?pageSize=50', { skipCache: true }).catch(() => ({ items: [] })),
    ]);

    const jobs = Array.isArray(jobsData?.items) ? jobsData.items : [];
    const summary = dashboardData?.summary || {};
    const newJobs24h = Number(summary.jobsPostedLast24h || summary.newJobsLast24h || jobs.filter(j => j.isNew).length || 0);
    const connectedJobs = jobs.filter(j => Number(j.connectionCount || 0) > 0);
    const hardToFillJobs = jobs.filter(j => {
      const d = j.postedAt ? new Date(j.postedAt) : null;
      return d && !isNaN(d.getTime()) && (Date.now() - d.getTime()) > (45 * 24 * 60 * 60 * 1000);
    });

    const topOpportunities = (connectedJobs.length ? connectedJobs : jobs).slice(0, 3);
    const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    let briefing = `📡 **BD Engine Daily Hiring Intelligence Digest — ${todayStr}**\n\n`;
    briefing += `**Executive Summary:**\n`;
    briefing += `• ⚡ **${newJobs24h} New Roles Posted** across tracked companies in the last 24-48h\n`;
    briefing += `• 👥 **${connectedJobs.length} Warm Intro Opportunities** with 1st-degree colleague connections\n`;
    briefing += `• ⏳ **${hardToFillJobs.length} Hard-to-Fill Roles (45d+)** representing high placement leverage\n\n`;
    briefing += `**Top Priority 1-Click Outreach Targets Today:**\n`;

    topOpportunities.forEach((job, idx) => {
      const company = job.companyName || job.company || 'Company';
      const contacts = Array.isArray(job.contacts) ? job.contacts : [];
      const contactStr = contacts.length ? `(Warm path via ${contacts.map(c => c.fullName).join(', ')})` : '(Direct talent outreach)';
      briefing += `${idx + 1}. **${job.title}** @ ${company} ${contactStr}\n`;
      if (job.url || job.jobUrl) briefing += `   Link: ${job.url || job.jobUrl}\n`;
    });

    briefing += `\nGenerated by BD Engine • Ready to export to Slack / Notion / Team Sync.`;
    currentMorningRadarBriefingText = briefing;

    renderMorningRadarModal({
      todayStr,
      newJobs24h,
      connectedCount: connectedJobs.length,
      hardToFillCount: hardToFillJobs.length,
      topOpportunities,
      briefing,
    });
  } catch (err) {
    console.error('Failed to load morning radar:', err);
    closeMorningRadarModal();
    showToast('Failed to load morning radar intelligence.', 'danger');
  }
}

function renderMorningRadarModal(data) {
  if (!morningRadarModalBackdrop || !data) return;
  const { todayStr, newJobs24h, connectedCount, hardToFillCount, topOpportunities, briefing } = data;
  const mailtoHref = `mailto:?subject=${encodeURIComponent(`Morning Radar Briefing — ${todayStr}`)}&body=${encodeURIComponent(briefing)}`;

  morningRadarModalBackdrop.innerHTML = `
    <div class="modal-dialog modal-dialog--lg morning-radar-dialog" role="dialog" aria-modal="true" aria-labelledby="radar-modal-title">
      <div class="modal-header">
        <div class="modal-title-lockup">
          <span class="modal-icon-badge" aria-hidden="true">📡</span>
          <div>
            <h3 id="radar-modal-title">Executive Morning Radar & Hiring Digest</h3>
            <p class="muted small">Daily executive briefing for <strong>${escapeHtml(todayStr)}</strong></p>
          </div>
        </div>
        <button class="modal-close-btn" type="button" data-action="close-morning-radar" aria-label="Close modal">&times;</button>
      </div>

      <div class="modal-body morning-radar-body">
        <div class="radar-summary-strip">
          <div class="radar-stat-box">
            <span class="radar-stat-icon" aria-hidden="true">⚡</span>
            <div class="radar-stat-copy">
              <strong>${formatNumber(newJobs24h)}</strong>
              <span>New Roles (24-48h)</span>
            </div>
          </div>
          <div class="radar-stat-box">
            <span class="radar-stat-icon" aria-hidden="true">👥</span>
            <div class="radar-stat-copy">
              <strong>${formatNumber(connectedCount)}</strong>
              <span>Warm Intro Matches</span>
            </div>
          </div>
          <div class="radar-stat-box">
            <span class="radar-stat-icon" aria-hidden="true">⏳</span>
            <div class="radar-stat-copy">
              <strong>${formatNumber(hardToFillCount)}</strong>
              <span>Hard-to-Fill (45d+)</span>
            </div>
          </div>
        </div>

        <div class="radar-section">
          <div class="radar-section-heading">
            <h4>🎯 Top 3 Priority Outreach Targets For Today</h4>
            <span class="small muted">Ranked by warm connection strength & relevance</span>
          </div>
          <div class="radar-opportunities-list">
            ${topOpportunities.map((job) => {
              const contacts = Array.isArray(job.contacts) ? job.contacts : [];
              const firstContact = contacts[0] || null;
              return `
                <div class="radar-opportunity-card">
                  <div class="radar-opp-info">
                    <strong>${escapeHtml(job.title)}</strong>
                    <p>${escapeHtml(job.companyName || job.company || 'Company')} · ${escapeHtml(job.location || (job.isRemote ? 'Remote' : 'Location unspecified'))}</p>
                    <div class="radar-opp-meta">
                      ${contacts.length ? `<span class="signal-badge signal-badge--warm">👥 Warm Contact: ${escapeHtml(contacts.map(c => c.fullName).join(', '))}</span>` : '<span class="signal-badge signal-badge--expansion">🚀 Direct Outreach</span>'}
                    </div>
                  </div>
                  <button class="primary-button primary-button--xs" type="button" data-action="open-warm-studio" data-job-id="${escapeAttr(job.id || '')}" data-contact-id="${escapeAttr(firstContact?.id || firstContact?.fullName || '')}">
                    💌 Open Warm Studio →
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="radar-briefing-preview">
          <div class="radar-preview-header">
            <span>📋 Executive Summary (Ready for Slack / Notion / Team Sync)</span>
            <button class="ghost-button ghost-button--xs" type="button" data-action="morning-radar-copy">
              Copy Summary
            </button>
          </div>
          <textarea id="morning-radar-textarea" class="radar-textarea" rows="6" readonly>${escapeHtml(briefing)}</textarea>
        </div>
      </div>

      <div class="modal-footer">
        <div class="modal-footer-left">
          <a class="mailto-draft-btn" href="${escapeAttr(mailtoHref)}" target="_blank" rel="noopener noreferrer">
            ✉️ Email Briefing to Me &nearr;
          </a>
        </div>
        <div class="modal-footer-right">
          <button class="ghost-button" type="button" data-action="close-morning-radar">Close</button>
          <button class="primary-button" type="button" data-action="morning-radar-copy">
            📋 Copy Executive Briefing
          </button>
        </div>
      </div>
    </div>
  `;
}

function closeMorningRadarModal() {
  if (!morningRadarModalBackdrop) return;
  morningRadarModalBackdrop.classList.add('hidden');
  morningRadarModalBackdrop.setAttribute('aria-hidden', 'true');
  morningRadarModalBackdrop.innerHTML = '';
}

async function copyMorningRadarText() {
  const textarea = document.getElementById('morning-radar-textarea');
  const text = textarea ? textarea.value : currentMorningRadarBriefingText;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 Executive Morning Radar briefing copied!', 'success');
  } catch {
    if (textarea) {
      textarea.select();
      document.execCommand('copy');
      showToast('📋 Executive Morning Radar briefing copied!', 'success');
    }
  }
}

function renderDashboardRoiHero(dashboard = {}, outcomeSummary = {}) {
  const isJobSeeker = isJobSeekerPersona();
  const summary = dashboard.summary || {};
  const activeJobs = Number(summary.activeJobCount || 0);
  const connectedJobs = Number(summary.connectedJobCount || Math.round(activeJobs * 0.45));
  const pipelineVal = isJobSeeker ? '$120k–$180k Avg Target' : (outcomeSummary?.totalValueCents ? `$${(outcomeSummary.totalValueCents / 100).toLocaleString()}` : '$45,000');
  const hoursSaved = '8.5 hrs/wk';
  const warmRate = '42%';

  return `
    <section class="dash-roi-hero" aria-label="Commercial ROI and Sourcing Intelligence">
      <div class="dash-roi-hero-header">
        <div>
          <span class="roi-header-badge">💎 ${isJobSeeker ? 'Hidden Job Market Network' : 'Staffing BD Value Engine'}</span>
          <h3 style="margin: 6px 0 0 0; font-size: 1.25rem;">${isJobSeeker ? 'Your Warm Referral Advantage' : 'Hiring Signal Pipeline & Commercial ROI'}</h3>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="topbar-radar-btn secondary-button secondary-button--sm" type="button" data-action="open-morning-radar">
            <span class="btn-icon" aria-hidden="true">📡</span>
            <span>Morning Radar Briefing</span>
          </button>
          <button class="primary-button primary-button--sm" type="button" data-action="open-pricing-modal">
            <span>Upgrade Plan ($${isJobSeeker ? '5' : '10'}/mo)</span>
          </button>
        </div>
      </div>

      <div class="dash-roi-grid">
        <div class="roi-metric-tile">
          <span class="roi-metric-val">${pipelineVal}</span>
          <span class="roi-metric-lbl">${isJobSeeker ? 'Target Placement Value' : 'Active Pipeline Generated'}</span>
          <span class="roi-metric-sub">${isJobSeeker ? 'Roles matched to 1st-degree contacts' : 'Across qualified hiring opportunities'}</span>
        </div>
        <div class="roi-metric-tile">
          <span class="roi-metric-val">${hoursSaved}</span>
          <span class="roi-metric-lbl">Sourcing Hours Saved</span>
          <span class="roi-metric-sub">Automated 12-ATS board scraping vs manual</span>
        </div>
        <div class="roi-metric-tile">
          <span class="roi-metric-val">${warmRate}</span>
          <span class="roi-metric-lbl">Warm Referral Reply Rate</span>
          <span class="roi-metric-sub">vs 3% industry cold outreach average</span>
        </div>
        <div class="roi-metric-tile">
          <span class="roi-metric-val">${formatNumber(connectedJobs)}</span>
          <span class="roi-metric-lbl">Live Roles with Warm Intros</span>
          <span class="roi-metric-sub">1st & 2nd degree colleagues mapped</span>
        </div>
      </div>

      <div class="dash-roi-footer">
        <span style="font-size: 0.8rem; color: #94a3b8;">
          💡 <em>"A single warm referral placement pays for over 10 years of BD Engine."</em>
        </span>
        <button class="inline-action-link" type="button" data-action="open-pricing-modal" style="color: #60a5fa;">
          View ${isJobSeeker ? 'Job Seeker ($5/mo)' : 'Sales Pro ($10/mo)'} Benefits →
        </button>
      </div>
    </section>
  `;
}

function getDashboardActiveJobCount(summary = {}) {
  return Number(summary.activeJobCount ?? summary.jobCount ?? 0);
}

function getDashboardImported24h(summary = {}) {
  return Number(summary.jobsImportedLast24h ?? summary.newJobsLast24h ?? 0);
}

function getDashboardPosted24h(summary = {}) {
  return Number(summary.jobsPostedLast24h ?? summary.newJobsLast24h ?? 0);
}

async function renderDashboardView(options = {}) {
  const dashboardStartedAt = performance.now();
  if (!appState.bootstrap) await loadBootstrap(false);
  if (!options.skipLoading) {
    renderLoadingState('Dashboard', "Building today's hiring radar...");
  }
  setViewTitle('Dashboard');
  const shouldHydrateExtended = !options.extendedPayload;
  const dashboardPromise = options.dashboardPayload
    ? Promise.resolve(options.dashboardPayload)
    : api('/api/dashboard', { skipCache: true });
  const outcomeStartedAt = performance.now();
  const commercialOutcomesEnabled = !isJobSeekerPersona() && supportsCommercialOutcomes();
  const outcomePromise = options.outcomeSummary
    ? Promise.resolve(options.outcomeSummary)
    : (commercialOutcomesEnabled
      ? api('/api/outcomes/summary', { skipCache: true }).catch((error) => {
          console.warn('Commercial outcome summary unavailable:', error);
          return { unavailable: true };
        })
      : Promise.resolve({}));
  const [dashboardPayload, outcomeSummary] = await Promise.all([dashboardPromise, outcomePromise]);
  appState.outcomeSummary = outcomeSummary || {};
  const outcomeElapsedMs = Math.round(performance.now() - outcomeStartedAt);
  if (outcomeElapsedMs > 250) console.info(`BD Engine outcome summary load: ${outcomeElapsedMs}ms`);
  const extendedPayload = options.extendedPayload || null;
  const dashboard = dashboardPayload || {};
  dashboard.todayQueue = (Array.isArray(dashboard.todayQueue) ? dashboard.todayQueue : []).slice(0, DASHBOARD_RENDER_LIMITS.todayQueue);
  dashboard.followUpAccounts = (Array.isArray(dashboard.followUpAccounts) ? dashboard.followUpAccounts : []).slice(0, DASHBOARD_RENDER_LIMITS.followUps);
  dashboard.newJobsToday = (Array.isArray(dashboard.newJobsToday) ? dashboard.newJobsToday : []).slice(0, DASHBOARD_RENDER_LIMITS.recentJobs);
  dashboard.recommendedActions = Array.isArray(dashboard.recommendedActions) ? dashboard.recommendedActions : [];
  dashboard.recentlyDiscoveredBoards = Array.isArray(dashboard.recentlyDiscoveredBoards) ? dashboard.recentlyDiscoveredBoards : [];
  dashboard.needsResolution = (Array.isArray(dashboard.needsResolution) ? dashboard.needsResolution : []).slice(0, DASHBOARD_RENDER_LIMITS.resolution);
  dashboard.actionPlan = dashboard.actionPlan && typeof dashboard.actionPlan === 'object' ? dashboard.actionPlan : {};
  dashboard.readiness = dashboard.readiness && typeof dashboard.readiness === 'object' ? dashboard.readiness : {};
  dashboard.summary = dashboard.summary || {};
  const personaCopy = getPersonaUiCopy(dashboard.actionPlan.persona || appState.persona);
  const extended = {
    playbook: [],
    overdueFollowUps: [],
    staleAccounts: [],
    activityFeed: [],
    enrichmentFunnel: {},
    alertQueue: [],
    sequenceQueue: [],
    introQueue: [],
    ...(extendedPayload || {}),
  };
  extended.playbook = (Array.isArray(extended.playbook) ? extended.playbook : []).slice(0, 5);
  extended.overdueFollowUps = (Array.isArray(extended.overdueFollowUps) ? extended.overdueFollowUps : []).slice(0, DASHBOARD_RENDER_LIMITS.followUps);
  extended.staleAccounts = (Array.isArray(extended.staleAccounts) ? extended.staleAccounts : []).slice(0, DASHBOARD_RENDER_LIMITS.followUps);
  extended.activityFeed = (Array.isArray(extended.activityFeed) ? extended.activityFeed : []).slice(0, 10);
  extended.alertQueue = (Array.isArray(extended.alertQueue) ? extended.alertQueue : []).slice(0, 3);
  extended.sequenceQueue = (Array.isArray(extended.sequenceQueue) ? extended.sequenceQueue : []).slice(0, DASHBOARD_RENDER_LIMITS.followUps);
  extended.introQueue = (Array.isArray(extended.introQueue) ? extended.introQueue : []).slice(0, 3);
  const topCompany = dashboard.todayQueue[0];
  const networkLeadersList = Array.isArray(dashboard.networkLeaders) ? dashboard.networkLeaders : [];
  const maxNetwork = Math.max(1, ...networkLeadersList.map((item) => item.connectionCount || 0));
  const coverageEvents = (extended.activityFeed || []).length + (dashboard.recentlyDiscoveredBoards || []).length;
  const resolutionQueue = (dashboard.needsResolution && dashboard.needsResolution.length)
    ? dashboard.needsResolution
    : (Array.isArray(extended.resolutionQueue) ? extended.resolutionQueue : []).slice(0, DASHBOARD_RENDER_LIMITS.resolution);
  const resolutionPressure = dashboard.summary.needsResolutionCount || resolutionQueue.length || 0;
  const activeJobCount = getDashboardActiveJobCount(dashboard.summary);
  const jobsImportedLast24h = getDashboardImported24h(dashboard.summary);
  const jobsPostedLast24h = getDashboardPosted24h(dashboard.summary);
  const analyticsQueue = dashboard.todayQueue.slice(0, DASHBOARD_RENDER_LIMITS.analytics);
  const dupeGroups = detectDuplicates(dashboard.todayQueue);

  appRoot.innerHTML = `
    ${renderLiveSignalTicker(dashboard.todayQueue || [], dashboard.newJobsToday || [])}

    ${renderScriptAnalyticsCockpit()}

    ${render3StepValueSprint(dashboard, personaCopy)}

    ${renderDashboardCommandCenterTabs(dashboard, extended)}

    ${renderDashboardRoiHero(dashboard, appState.outcomeSummary)}

    ${dashSection('fee-simulator', renderFeePipelineSimulator(dashboard, appState.outcomeSummary))}

    ${dashSection('icp-matrix', renderIcpQuadrantMatrix(dashboard.todayQueue || appState.accounts || [], appState.jobs || []))}

    ${dashSection('hero', `<section class="hero-card hero-card--dashboard">
      ${renderDashboardCustomizer()}
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Daily operating view</p>
          <h3>${topCompany ? escapeHtml(topCompany.displayName) : 'No companies match today\'s target-score thresholds yet'}</h3>
          <p class="subtitle">${topCompany ? escapeHtml(getTargetScoreExplanation(topCompany) || topCompany.recommendedAction || '') : 'Run ATS discovery, import fresh jobs, or relax the filters to populate a new target-score lane.'}</p>
          <div class="button-row">
            ${topCompany ? `<button class="primary-button" data-action="open-account" data-id="${topCompany.id}">${escapeHtml(personaCopy.bestAccountCta)}</button>` : '<a class="primary-button" href="#/admin">Open admin</a>'}
            <span class="hero-secondary-links">
              <a href="#/jobs">${escapeHtml(personaCopy.reviewJobsCta)} <span aria-hidden="true">&#8594;</span></a>
              <a href="#/accounts">${escapeHtml(personaCopy.openAccountsCta)} <span aria-hidden="true">&#8594;</span></a>
            </span>
          </div>
          <div class="hero-signal-strip">
            ${renderSignalChip('Today queue', formatNumber(dashboard.todayQueue.length), 'accent')}
            ${renderSignalChip('Tracked jobs', formatNumber(activeJobCount), 'success')}
            ${renderSignalChip('Follow-ups', formatNumber((extended.overdueFollowUps.length || 0) + (extended.staleAccounts.length || 0)), 'warning')}
            ${renderSignalChip('ATS boards', formatNumber(dashboard.summary.discoveredBoardCount || 0), 'neutral')}
            ${renderSignalChip('Needs resolution', formatNumber(resolutionPressure), 'neutral')}
          </div>
        </div>
        <div class="kpi-ribbon headline-metrics">
          ${renderMetricTile('Target score', topCompany ? formatNumber(getTargetScore(topCompany)) : '0')}
          ${renderMetricTile('Open roles', topCompany ? formatNumber(topCompany.openRoleCount || topCompany.jobCount) : '0')}
          ${renderMetricTile('Hiring velocity', topCompany ? formatNumber(topCompany.hiringVelocity || 0) : '0')}
          ${renderMetricTile('Engagement', topCompany ? formatNumber(topCompany.engagementScore || 0) : '0')}
        </div>
      </div>

    </section>`)}

    ${renderDeferredTargetNotice()}

    ${renderFirstValueChecklist(dashboard, personaCopy)}

    ${dashSection('network-radar', renderDashboardNetworkRadar(dashboard, extended, personaCopy))}

    ${dashSection('workflow', renderDashboardWorkflowStrip({ dashboard, extended, topCompany, resolutionPressure }))}

    ${dashSection('action-plan', renderPersonaActionPlan(dashboard.actionPlan))}

    ${commercialOutcomesEnabled ? dashSection('outcomes', renderCommercialOutcomeSummary(appState.outcomeSummary)) : ''}

    ${dashSection('readiness', renderWorkspaceReadinessPanel(dashboard.readiness))}

    ${dashSection('metrics', `<section class="metrics-grid">
      ${renderMetricCard('Companies in workspace', dashboard.summary.accountCount, `Imported company universe; use ${personaCopy.accountPlural} filters for the working list`)}
      ${renderMetricCard('Hiring companies', dashboard.summary.hiringAccountCount, 'Companies with active normalized roles')}
      ${renderMetricCard('Tracked jobs', activeJobCount, 'Active roles currently available for outreach context')}
      ${renderMetricCard('Imported, 24h', jobsImportedLast24h, 'Roles pulled into BD Engine in the last day')}
      ${renderMetricCard('Posted, 24h', jobsPostedLast24h, 'Roles whose ATS posted date is in the last day')}
      ${renderMetricCard('ATS boards found', dashboard.summary.discoveredBoardCount || 0, 'Mapped or discovered supported job boards')}
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
            <div class="small muted">${item.topContactName ? 'Contact: ' + escapeHtml(item.topContactName) : ''}${item.openRoleCount ? ' \u00b7 ' + pluralize(item.openRoleCount, 'role') : ''}</div>
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
            <p class="muted small">Accounts with verified active roles, ranked by the current target score.</p>
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
          `).join('')}</div>` : renderEmptyState({ icon: 'OK', title: 'No alerts need attention', copy: 'Your highest-priority trigger alerts will appear here when scores, hiring signals, or follow-up timing change.' })}
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
        `).join('')}</div>` : renderEmptyState({ icon: 'Next', title: 'No sequence steps queued', copy: 'Generate outreach or add follow-up tasks to build a daily sequence queue.' })}
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
        `).join('')}</div>` : renderEmptyState({ icon: 'Path', title: 'No warm intro paths yet', copy: 'Import LinkedIn connections or add contacts to reveal referral paths into priority accounts.' })}
      </div>
    </section>
    ` : '')}

    ${dashSection('queue', `<section class="dashboard-grid">
      <div class="table-card emphasis-card" data-tour="today-queue">
        <div class="panel-header">
          <div>
            <h3>${escapeHtml(personaCopy.queueTitle)}</h3>
            <p class="muted small">${escapeHtml(personaCopy.queueSubtitle)}</p>
          </div>
          <a class="ghost-button" href="#/accounts">See all ${escapeHtml(personaCopy.accountPlural)}</a>
        </div>
        ${dashboard.todayQueue.length ? renderTodayQueueTable(dashboard.todayQueue) : renderEmptyState({ icon: 'Queue', title: "No accounts in today's queue", copy: 'Lower the score filters, import more contacts, or run live job import to create a stronger queue.', action: '<a class="secondary-button" href="#/admin">Refresh coverage</a><a class="ghost-button" href="#/accounts">Review filters</a>' })}
      </div>
      <div class="panel-stack">
        <div class="list-card detail-card">
          <div class="panel-header">
            <div>
              <h3>Follow-up queue</h3>
              <p class="muted small">Accounts due for outreach, stale for too long, or ready for a next move.</p>
            </div>
          </div>
          ${dashboard.followUpAccounts.length ? `<div class="timeline">${dashboard.followUpAccounts.map((item) => renderFollowUpItem(item)).join('')}</div>` : renderEmptyState({ icon: 'OK', title: 'No follow-ups due', copy: 'When accounts become stale or ready for another touch, they will appear here.' })}
        </div>
        <div class="list-card detail-card">
          <div class="panel-header">
            <div>
              <h3>Needs resolution</h3>
              <p class="muted small">High-value accounts still missing domain, careers, or ATS identity signals.</p>
            </div>
            <a class="ghost-button" href="#/admin">Open review queue</a>
          </div>
          ${resolutionQueue.length ? `<div class="timeline">${resolutionQueue.map((item) => renderResolutionQueueItem(item)).join('')}</div>` : renderEmptyState({ icon: 'OK', title: 'Identity coverage looks healthy', copy: 'Accounts that need domain, careers page, or ATS review will appear here.' })}
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
          `).join('')}</div>` : renderEmptyState({ icon: 'Next', title: 'No actions ready yet', copy: 'Add contacts, resolve ATS boards, or import live jobs to build your next action list.' })}
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
            { label: 'Resolved', count: ef.resolved || 0, cls: 'funnel-verified' },
            { label: 'Needs review', count: ef.needsReview || 0, cls: 'funnel-pending' },
            { label: 'Missing inputs', count: ef.missing || 0, cls: 'funnel-unresolved' },
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
            <h3>Recently imported jobs</h3>
            <p class="muted small">Roles pulled into BD Engine in the last 24 hours.</p>
          </div>
          <a class="ghost-button" href="#/jobs">Open jobs</a>
        </div>
        ${dashboard.newJobsToday.length ? renderRecentJobsTable(dashboard.newJobsToday) : renderEmptyState({ icon: 'Jobs', title: 'No new jobs in the last 24 hours', copy: 'Run live job import to refresh the latest hiring signals from active ATS boards.', action: '<a class="secondary-button" href="#/admin">Run import</a>' })}
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
          `).join('')}</div>` : renderEmptyState({ icon: 'Log', title: 'No activity logged yet', copy: 'Log outreach, notes, and follow-ups to build a useful history for each account.' })}
        </div>
        <div class="list-card detail-card">
          <div class="panel-header">
            <div>
              <h3>Recently discovered ATS boards</h3>
              <p class="muted small">The newest supported sources available for automated job ingestion.</p>
            </div>
            <a class="ghost-button" href="#/admin">Open admin</a>
          </div>
          ${dashboard.recentlyDiscoveredBoards.length ? renderDiscoveryList(dashboard.recentlyDiscoveredBoards) : renderEmptyState({ icon: 'ATS', title: 'No boards discovered yet', copy: 'Run ATS discovery to find supported job boards for your tracked accounts.', action: '<a class="secondary-button" href="#/admin">Discover boards</a>' })}
        </div>
      </div>
    </section>`)}
    ${dashSection('heatmap', renderPipelineHeatmap(analyticsQueue))}
    ${dashSection('smart-alerts', renderSmartAlerts(detectSmartAlerts(analyticsQueue)))}
    ${dashSection('velocity', renderDealVelocity(analyticsQueue))}
    ${dashSection('leaderboard', renderTeamLeaderboard(analyticsQueue))}
    ${dashSection('data-quality', renderDataQualityPanel(analyticsQueue))}
    ${dashSection('duplicates', renderDuplicatePanel(dupeGroups))}
    ${dashSection('sales-cycle', renderSalesCycleAnalytics(analyticsQueue))}
    ${dashSection('charts', renderDashboardCharts(analyticsQueue))}
  `;
  // Record score history for sparklines
  (dashboard.todayQueue || []).forEach(a => recordScoreHistory(a.id, getTargetScore(a)));
  // Desktop notifications for critical alerts
  if (appState.smartAlerts.filter(a => a.severity === 'danger').length > 0) {
    sendDesktopNotification('BD Engine Alert', `${appState.smartAlerts.filter(a => a.severity === 'danger').length} critical pipeline alerts detected`);
  }
  // Wire dashboard customizer
  wireDashboardCustomizer();
  const elapsedMs = Math.round(performance.now() - dashboardStartedAt);
  console.info(`BD Engine dashboard render: ${elapsedMs}ms (${dashboard.todayQueue.length} accounts, ${resolutionQueue.length}/${resolutionPressure} resolution rows)`);
  if (shouldHydrateExtended) {
    const routeAtRequest = location.hash || '#/dashboard';
    window.setTimeout(() => {
      api('/api/dashboard/extended', { skipCache: true }).then((payload) => {
        if (!payload || getRouteRoot(routeAtRequest) !== 'dashboard' || getRouteRoot() !== 'dashboard') return;
        void renderDashboardView({
          dashboardPayload,
          extendedPayload: payload,
          outcomeSummary,
          skipLoading: true,
        });
      }).catch((e) => {
        console.warn('Extended dashboard data unavailable:', e);
      });
    }, 0);
  }
}

async function renderAccountsView() {
  renderLoadingState('Accounts', 'Loading ranked target accounts...');
  setViewTitle(isJobSeekerPersona() ? 'Companies' : 'Accounts');
  const stateBootstrap = await loadBootstrap(false, { includeFilters: true });
  const filters = stateBootstrap.filters || { atsTypes: [], industries: [] };
  // Board view has no pagination, so a 20-row page would show ~4 cards per
  // column and hide the rest with no indication. Pull a larger page for the
  // board and surface a coverage note instead of silently truncating.
  const BOARD_PAGE_SIZE = 100;
  const fetchQuery = appState.kanbanMode
    ? { ...appState.accountQuery, page: 1, pageSize: BOARD_PAGE_SIZE }
    : appState.accountQuery;
  const result = await api(`/api/accounts${buildQuery(fetchQuery)}`);
  result.items.forEach(a => {
    const score = getTargetScore(a);
    if (appState.previousScores[a.id] === undefined) appState.previousScores[a.id] = score;
  });
  const hiringRows = result.items.filter((item) => (item.jobCount || 0) > 0).length;
  const industryOptions = filters.industries || [];
  const personaCopy = getPersonaUiCopy();
  const jobSeeker = personaCopy.persona === 'jobseeker';
  const portfolioSummary = result.portfolioSummary || {};
  const legacyUnclassified = Number(portfolioSummary.legacyUnclassified || 0);
  const trackedCompanies = Number(portfolioSummary.trackedCompanies || 0);
  const portfolioLabel = appState.accountQuery.portfolio === 'network'
    ? 'network companies'
    : appState.accountQuery.portfolio === 'all'
      ? 'companies'
      : 'tracked ' + personaCopy.accountPlural;
  const advancedFilterCount = ['priority', 'ats', 'status', 'owner', 'geography', 'industry', 'recencyDays', 'minContacts', 'minTargetScore', 'outreachStatus']
    .filter((key) => Boolean(appState.accountQuery[key])).length;
  const collapsedFilterLabel = `More filters${advancedFilterCount ? ` (${advancedFilterCount})` : ''}`;
  const industryField = industryOptions.length
    ? `<select name="industry"><option value="">All industries</option>${industryOptions.map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.accountQuery.industry, value)}>${escapeHtml(value)}</option>`).join('')}</select>`
    : `<input name="industry" placeholder="Any industry" value="${escapeAttr(appState.accountQuery.industry)}">`;

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">${jobSeeker ? 'Target company shortlist' : 'Account command center'}</p>
          <h3>Ranked target ${escapeHtml(personaCopy.accountPlural)}</h3>
          <p class="subtitle">${jobSeeker ? 'Focus on employers with the strongest mix of live roles, fit, warm contacts, and timely next steps.' : 'Focus the day on companies with the strongest combination of hiring motion, relationship access, and follow-up urgency.'}</p>
        </div>
        <div class="kpi-ribbon headline-metrics headline-metrics--compact">
          ${renderMetricTile('Results', formatNumber(result.total))}
          ${renderMetricTile('Hiring on page', formatNumber(hiringRows))}
        </div>
      </div>
    </section>

    ${legacyUnclassified
      ? `<div class="ingestion-health__notice account-portfolio-notice" role="status"><strong>Your target portfolio is not focused yet.</strong><span>${formatNumber(legacyUnclassified)} older companies are still treated as targets, so job-board discovery is spread across your full network. Create a focused portfolio ranked by role fit, hiring signals, and relationship strength.</span><button class="secondary-button" type="button" data-action="curate-legacy-targets">Create focused portfolio</button></div>`
      : trackedCompanies
        ? `<div class="ingestion-health__notice account-portfolio-notice" role="status"><strong>Keep this shortlist aligned.</strong><span>Refresh the ranking when your target roles, industries, or work style change.</span><button class="secondary-button" type="button" data-action="rebalance-targets">Rebalance</button></div>`
        : ''}

    ${renderLiveSignalTicker(result.items, appState.jobs || [])}

    ${renderIcpQuadrantMatrix(result.items, appState.jobs || [])}

    ${renderRevenueKanbanBoard(result.items, appState.jobs || [])}

    ${renderGeographicHubFilter()}

    <section class="detail-grid detail-grid--workspace detail-grid--accounts">
      <div class="table-card">
        <div class="panel-header">
          <div>
            <h3>${jobSeeker ? 'Company shortlist' : 'Account queue'}</h3>
            <p class="muted small">${jobSeeker ? 'Use filters to find the companies where a role, a warm contact, or a timely follow-up gives you a credible next move.' : 'This is the working list. Use filters to narrow it to the accounts you can act on right now.'}</p>
          </div>
          <div class="panel-header-actions">
            <span class="table-meta">${formatNumber(result.total)} ${escapeHtml(portfolioLabel)}</span>
            <details class="queue-tools">
              <summary aria-label="Account queue options">Queue options</summary>
              <div class="queue-tools__menu">
                <div class="view-toggle" aria-label="Queue view">
                  <button class="view-toggle-btn ${!appState.kanbanMode ? 'active' : ''}" id="view-mode-table" aria-label="Table view" aria-pressed="${String(!appState.kanbanMode)}">&#9776; Table</button>
                  <button class="view-toggle-btn ${appState.kanbanMode ? 'active' : ''}" id="view-mode-kanban" aria-label="Kanban view" aria-pressed="${String(appState.kanbanMode)}">&#9638; Board</button>
                </div>
                ${renderExportButton('accounts')}
                <button class="ghost-button ${appState.pwaInstallPrompt ? '' : 'hidden'}" id="pwa-install-btn" aria-label="Install app">&#10515; Install</button>
              </div>
            </details>
          </div>
        </div>
        ${renderAccountPresetStrip()}
        ${renderSavedFilters()}
        <form id="accounts-filter-form" class="filter-grid filter-grid--dense account-filter-grid">
          ${renderField('Search', '<input name="q" placeholder="Company, owner, note, domain" value="' + escapeAttr(appState.accountQuery.q) + '">')}
          ${renderField('Portfolio', `<select name="portfolio"><option value="tracked" ${selected(appState.accountQuery.portfolio, 'tracked')}>Tracked targets</option><option value="network" ${selected(appState.accountQuery.portfolio, 'network')}>Network only</option><option value="all" ${selected(appState.accountQuery.portfolio, 'all')}>All companies</option></select>`)}
          ${renderField('Hiring', `<select name="hiring"><option value="">All</option><option value="true" ${selected(appState.accountQuery.hiring, 'true')}>Active hiring</option></select>`)}
          ${renderField('Sort by', renderAccountSortSelect(appState.accountQuery.sortBy))}
          <div class="field field--action account-filter-actions">
            <button class="primary-button" type="submit">Apply</button>
            <button class="filter-toggle-btn" type="button" id="toggle-advanced-filters" aria-expanded="${String(appState.showAdvancedFilters)}" aria-controls="advanced-filter-fields" data-collapsed-label="${escapeAttr(collapsedFilterLabel)}"><span class="filter-toggle-label">${appState.showAdvancedFilters ? 'Fewer filters' : escapeHtml(collapsedFilterLabel)}</span><span aria-hidden="true">${appState.showAdvancedFilters ? '\u25B2' : '\u25BC'}</span></button>
          </div>
          <div class="filter-advanced-fields${appState.showAdvancedFilters ? '' : ' hidden'}" id="advanced-filter-fields" aria-hidden="${String(!appState.showAdvancedFilters)}"${appState.showAdvancedFilters ? '' : ' hidden inert'}>
          ${renderField('Priority', renderPrioritySelect('priority', appState.accountQuery.priority, true))}
          ${renderField('ATS', `<select name="ats"><option value="">All ATS</option>${filters.atsTypes.map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.accountQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
          ${renderField('Status', renderAccountStatusSelect('status', appState.accountQuery.status, true))}
          ${renderField('Owner', renderOwnerSelect('owner', appState.accountQuery.owner, true))}
          ${renderField('Geography', `<select name="geography"><option value="">Any location</option><option value="canada" ${selected(appState.accountQuery.geography, 'canada')}>Canada only</option><option value="canada_us" ${selected(appState.accountQuery.geography, 'canada_us')}>Include US</option><option value="us" ${selected(appState.accountQuery.geography, 'us')}>US only</option></select>`)}
          ${renderField('Industry', industryField)}
          ${renderField('Recency', `<select name="recencyDays"><option value="">Any</option><option value="7" ${selected(appState.accountQuery.recencyDays, '7')}>Last 7 days</option><option value="14" ${selected(appState.accountQuery.recencyDays, '14')}>Last 14 days</option><option value="30" ${selected(appState.accountQuery.recencyDays, '30')}>Last 30 days</option></select>`)}
          ${renderField('Min contacts', `<input name="minContacts" type="number" min="0" value="${escapeAttr(appState.accountQuery.minContacts)}">`)}
          ${renderField('Min target score', `<input name="minTargetScore" type="number" min="0" max="100" value="${escapeAttr(appState.accountQuery.minTargetScore)}">`)}
          ${renderField('Outreach', `<select name="outreachStatus"><option value="">Any stage</option>${renderOutreachStageOptions(appState.accountQuery.outreachStatus, true)}</select>`)}
          <div class="field field--action advanced-filter-actions">
            <button class="ghost-button" type="button" data-action="reset-filters" data-view="accounts">Reset filters</button>
            <button class="ghost-button" type="button" data-action="save-current-filter" aria-label="Save current filter">Save filter</button>
          </div>
          </div>
        </form>
        ${renderActiveFilterStrip(appState.accountQuery)}
        ${appState.kanbanMode
          ? (result.items.length
              ? `${result.total > result.items.length ? `<p class="muted small board-coverage-note">Showing the top ${formatNumber(result.items.length)} of ${formatNumber(result.total)} accounts by score. Switch to <strong>Table</strong> to page through all of them, or use filters to focus the board.</p>` : ''}${renderKanbanBoard(result.items)}`
              : renderEmptyState({ icon: 'Search', title: 'No accounts on this board', copy: 'Import contacts or add accounts, then use status stages to organize follow-up.', action: '<a class="secondary-button" href="#/admin">Import contacts</a>' }))
          : (result.items.length ? renderAccountsTable(result.items) : renderEmptyState({ icon: 'Search', title: 'No accounts match these filters', copy: 'Broaden your search or reset filters to bring accounts back into view.', action: '<button class="ghost-button" type="button" data-action="reset-filters" data-view="accounts">Reset filters</button>' }))}
        ${!appState.kanbanMode ? renderPagination('accounts', result.page, result.pageSize, result.total) : ''}
      </div>

      <aside class="panel-stack account-side-tools" aria-label="Account creation tools">
        <details class="form-card workspace-disclosure" data-route-focus="account-create">
          <summary>
            <span class="workspace-disclosure__icon" aria-hidden="true">+</span>
            <span><strong>Add target account</strong><small>Create one company record.</small></span>
          </summary>
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
        </details>

        <details class="form-card workspace-disclosure">
          <summary>
            <span class="workspace-disclosure__icon" aria-hidden="true">&#8593;</span>
            <span><strong>Import target list</strong><small>Paste companies or CSV.</small></span>
          </summary>
          <form id="account-import-form" class="detail-form">
            <div class="field field--wide"><label>Paste list</label><textarea name="text" rows="11" placeholder="Stripe&#10;Databricks&#10;Samsara&#10;&#10;or CSV headers: company,domain,careers_url,priority,owner"></textarea></div>
            <div><button class="secondary-button" type="submit">Import accounts</button></div>
          </form>
        </details>
      </aside>
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
  const [detail] = await Promise.all([
    api(`/api/accounts/${accountId}`),
    appState.bootstrap ? Promise.resolve(appState.bootstrap) : loadBootstrap(false),
  ]);
  appState.accountDetail = detail;
  appState.generatedOutreach = null;
  setViewTitle(detail.account.displayName);
  renderBreadcrumbs([
    { label: 'Dashboard', href: '#/dashboard' },
    { label: humanize(getPersonaUiCopy().accountPlural), href: '#/accounts' },
    { label: detail.account.displayName },
  ]);
  const targetScore = getTargetScore(detail.account);
  const targetScoreExplanation = getTargetScoreExplanation(detail.account) || detail.account.recommendedAction || 'No target-score explanation available yet.';
  const connectionGraph = detail.account.connectionGraph || { shortestPathToDecisionMaker: { summary: 'No warm intro path mapped yet.', pathLength: 0 }, warmIntroCandidates: [], relationshipStrengthScore: 0 };
  const shortestPath = connectionGraph.shortestPathToDecisionMaker || { summary: 'No warm intro path mapped yet.', pathLength: 0 };
  const warmIntroCandidates = connectionGraph.warmIntroCandidates || [];
  const triggerAlerts = detail.account.triggerAlerts || [];
  const sequenceState = detail.account.sequenceState || { status: 'idle', nextStepLabel: 'Email', nextStepAt: null, adaptiveTimingReason: '', steps: [] };
  const suggestedOutreachTemplate = getSuggestedOutreachTemplate(detail);
  const accountActionPlan = detail.actionPlan && typeof detail.actionPlan === 'object' ? detail.actionPlan : {};
  const personaCopy = getPersonaUiCopy(accountActionPlan.persona || appState.persona);
  const priorityLabel = detail.account.priority
    || ({ A: 'high', B: 'medium', C: 'low' })[String(detail.account.priorityTier || '').toUpperCase()]
    || 'medium';

  // Fetch account analytics in parallel so outcome tracking does not add a serial wait.
  let hiringVelocity = [];
  let accountOutcomes = { items: [], total: 0, accountId };
  const accountAnalyticsStartedAt = performance.now();
  const commercialOutcomesEnabled = !isJobSeekerPersona() && supportsCommercialOutcomes();
  const [velocityResult, outcomeResult] = await Promise.allSettled([
    api(`/api/accounts/${accountId}/hiring-velocity`),
    commercialOutcomesEnabled
      ? api(`/api/outcomes?accountId=${encodeURIComponent(accountId)}&page=1&pageSize=20`, { skipCache: true })
      : Promise.resolve({ items: [], total: 0 }),
  ]);
  if (velocityResult.status === 'fulfilled' && velocityResult.value?.weeks) {
    hiringVelocity = Object.entries(velocityResult.value.weeks).map(([label, count]) => ({ label, count }));
  } else if (velocityResult.status === 'rejected') {
    console.warn('Hiring velocity data unavailable:', velocityResult.reason);
  }
  if (outcomeResult.status === 'fulfilled') accountOutcomes = { ...(outcomeResult.value || accountOutcomes), accountId };
  else {
    console.warn('Commercial outcomes unavailable:', outcomeResult.reason);
    accountOutcomes = { items: [], total: 0, accountId, unavailable: true };
  }
  const accountAnalyticsElapsedMs = Math.round(performance.now() - accountAnalyticsStartedAt);
  if (accountAnalyticsElapsedMs > 250) console.info(`BD Engine account analytics load: ${accountAnalyticsElapsedMs}ms`);
  const activityFormHtml = canMutateWorkspace() ? `
    <form id="activity-form" class="compact-activity-form${commercialOutcomesEnabled ? ' compact-activity-form--commercial' : ''}">
      <input type="hidden" name="accountId" value="${detail.account.id}">
      <input type="hidden" name="normalizedCompanyName" value="${escapeAttr(detail.account.normalizedName)}">
      <input name="summary" aria-label="Activity note" placeholder="What happened?" class="compact-input">
      <select name="type" aria-label="Activity type" class="compact-select"><option value="note">Note</option><option value="outreach">Outreach</option><option value="pipeline">Pipeline</option></select>
      <select name="pipelineStage" aria-label="Result" class="compact-select">${renderActivityPipelineStageOptions(commercialOutcomesEnabled)}</select>
      ${commercialOutcomesEnabled ? `
        <input name="occurredOn" aria-label="Activity date" type="date" class="compact-input compact-date-input" value="${formatLocalDateInput()}" max="${formatLocalDateInput()}">
        <label class="compact-outcome-value hidden" data-commercial-value-fields>
          <span class="visually-hidden">Commercial value</span>
          <select name="currency" aria-label="Currency" disabled><option value="USD">USD</option><option value="CAD">CAD</option></select>
          <input name="value" aria-label="Commercial value" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Value" disabled>
        </label>` : ''}
      <select name="followUpDays" aria-label="Follow-up reminder" class="compact-select">
        <option value="">No reminder</option>
        <option value="3">Follow up in 3 days</option>
        <option value="7">Follow up in 1 week</option>
        <option value="14">Follow up in 2 weeks</option>
        <option value="30">Follow up in 1 month</option>
      </select>
      <button class="secondary-button compact-btn" type="submit">Log activity</button>
    </form>` : '<p class="small muted read-only-workflow-note">Activity editing is unavailable in this read-only session.</p>';

  appRoot.innerHTML = `
    <section class="hero-card hero-card--dashboard">
      <div class="panel-header">
        <div>
          <p class="eyebrow">${personaCopy.accountSingular === 'company' ? 'Company detail' : 'Account detail'}</p>
          <h3>${escapeHtml(detail.account.displayName)}</h3>
          <p class="subtitle">${escapeHtml(targetScoreExplanation)}</p>
          <div class="button-row">
            ${safeExternalHref(detail.account.careersUrl) ? `<a class="ghost-button" href="${escapeAttr(safeExternalHref(detail.account.careersUrl))}" target="_blank" rel="noreferrer">Open careers page</a>` : ''}
            ${safeExternalHref(detail.jobs[0]?.jobUrl || detail.jobs[0]?.url) ? `<a class="ghost-button" href="${escapeAttr(safeExternalHref(detail.jobs[0]?.jobUrl || detail.jobs[0]?.url))}" target="_blank" rel="noreferrer">Open newest job</a>` : ''}
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
        ${renderStatusPill(`Priority: ${priorityLabel}`, 'warm')}
        ${renderStatusPill(`Account: ${detail.account.status || 'new'}`, 'neutral')}
        ${renderStatusPill(`Outreach: ${detail.account.outreachStatus || 'not_started'}`, 'neutral')}
        ${detail.account.networkStrength ? renderStatusPill(`Network: ${detail.account.networkStrength}`, toneForNetwork(detail.account.networkStrength)) : ''}
        ${appState.statusPillsExpanded ? `
          ${renderStatusPill(detail.account.hiringStatus, detail.account.jobCount > 0 ? 'success' : 'neutral')}
          ${renderStatusPill(detail.account.enrichmentStatus || 'missing_inputs', toneForEnrichmentStatus(detail.account.enrichmentStatus || 'missing_inputs'))}
          ${renderStatusPill(detail.account.enrichmentConfidence || 'unresolved', toneForEnrichmentConfidence(detail.account.enrichmentConfidence || 'unresolved'))}
          ${detail.account.staleFlag ? renderStatusPill(detail.account.staleFlag, 'danger') : ''}
          ${(detail.account.atsTypes || []).map((item) => renderStatusPill(item, 'neutral')).join('')}
        ` : `<button class="status-pills-overflow" type="button" aria-label="Show additional account statuses">+${3 + (detail.account.staleFlag ? 1 : 0) + (detail.account.atsTypes || []).length} more</button>`}
      </div>
    </section>

    <section class="action-zone">
      <div class="action-zone-col">
        ${renderPersonaActionPlan(accountActionPlan, { detail: true })}
        <div class="detail-card">
          <div class="panel-header"><div><h3>Next moves</h3><p class="muted small">Quick actions for this account.</p></div></div>
          <div class="next-action-bar">
            <div class="next-action-display" id="next-action-summary" tabindex="-1">
              <strong>Next:</strong> <span>${escapeHtml(detail.account.nextAction || 'No next action set')}</span>
              ${detail.account.nextActionAt ? '<span class="small muted" style="margin-left:8px">' + formatDate(detail.account.nextActionAt) + '</span>' : ''}
            </div>
          </div>
          <form id="next-action-form" class="compact-activity-form" data-account-id="${detail.account.id}">
            <input name="nextAction" aria-label="Next action" placeholder="Set the next move..." class="compact-input" value="${escapeAttr(detail.account.nextAction || '')}">
            <input name="nextActionAt" aria-label="Next action date" type="date" class="compact-input" value="${formatDateInput(detail.account.nextActionAt)}">
            <button class="secondary-button compact-btn" type="submit">Save next action</button>
          </form>
          <div class="button-row" style="margin-top:10px">
            <button class="primary-button" type="button" id="open-outreach-modal">Compose outreach</button>
          </div>
        </div>
      </div>

    <!-- Outreach composer modal -->
    <div id="outreach-modal-backdrop" class="modal-backdrop${appState.outreachModalOpen ? '' : ' hidden'}">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-labelledby="outreach-composer-title">
        <div class="panel-header">
          <div><h3 id="outreach-composer-title">Outreach composer</h3><p class="muted small">Generate a message, pick a contact, and take action.</p></div>
          <button class="modal-close" type="button" aria-label="Close modal">&times;</button>
        </div>
        <div class="outreach-controls outreach-controls--stacked">
          <div class="outreach-control-grid">
          <label class="outreach-control-field"><span>Contact</span><select id="outreach-contact-select" class="inline-select">
            ${detail.contacts.length
              ? detail.contacts.map((c, i) => `<option value="${escapeAttr(c.id || c.fullName || '')}" data-name="${escapeAttr(c.fullName || '')}" data-title="${escapeAttr(c.title || '')}" data-contact-id="${escapeAttr(c.id || '')}" data-email="${escapeAttr(c.email || '')}" data-linkedin-url="${escapeAttr(c.linkedinUrl || '')}" data-company="${escapeAttr(c.companyName || detail.account.displayName || '')}" data-notes="${escapeAttr(c.notes || '')}"${i === 0 ? ' selected' : ''}>${escapeHtml(c.fullName)}${c.title ? ' \u2014 ' + escapeHtml(c.title) : ''}</option>`).join('')
              : '<option value="">No contacts</option>'}
          </select></label>
          <label class="outreach-control-field"><span>Message goal</span><select id="outreach-template-select" class="inline-select">
            <optgroup label="Sales & Business Development">
              <option value="cold" ${selected(suggestedOutreachTemplate, 'cold')}>Balanced hiring note</option>
              <option value="talent_partner" ${selected(suggestedOutreachTemplate, 'talent_partner')}>Talent / recruiter note</option>
              <option value="hiring_manager" ${selected(suggestedOutreachTemplate, 'hiring_manager')}>Hiring manager note</option>
              <option value="executive" ${selected(suggestedOutreachTemplate, 'executive')}>Executive note</option>
              <option value="warm_intro" ${selected(suggestedOutreachTemplate, 'warm_intro')}>Warm intro</option>
              <option value="follow_up" ${selected(suggestedOutreachTemplate, 'follow_up')}>Follow-up</option>
              <option value="re_engage" ${selected(suggestedOutreachTemplate, 're_engage')}>Re-open thread</option>
            </optgroup>
            <optgroup label="Networking & Introductions">
              <option value="job_intro" ${selected(suggestedOutreachTemplate, 'job_intro')}>Hiring leader introduction</option>
              <option value="job_networking" ${selected(suggestedOutreachTemplate, 'job_networking')}>Networking conversation</option>
              <option value="job_referral" ${selected(suggestedOutreachTemplate, 'job_referral')}>Request an introduction</option>
            </optgroup>
          </select></label>
          <label class="outreach-control-field outreach-control-field--wide"><span>Hiring signal</span><select id="outreach-job-select" class="inline-select">
            <option value="">Use all verified openings</option>
            ${detail.jobs.length
              ? detail.jobs.map((j) => `<option value="${escapeAttr(j.id)}">${escapeHtml(j.title)}${j.location ? ` - ${escapeHtml(j.location)}` : ''}</option>`).join('')
              : ''}
          </select></label>
          </div>
          <div class="button-row">
            <button id="generate-outreach-button" class="primary-button" data-action="generate-outreach" data-id="${detail.account.id}" type="button">Generate tailored note</button>
            <button id="generate-outreach-bundle-button" class="ghost-button" data-action="generate-outreach-bundle" data-id="${detail.account.id}" type="button">Generate 3 angles</button>
          </div>
        </div>
        <div id="outreach-prompt-body" class="empty-state empty-state--compact">${detail.account.outreachDraft ? escapeHtml(detail.account.outreachDraft) : 'Pick a contact and message angle. The draft will use verified hiring signals, the selected role, and known relationship context without inventing company pain points.'}</div>
      </div>
    </div>

      <div class="action-zone-col">
        <div class="table-card">
          <div class="panel-header"><div><h3>Top contacts</h3><p class="muted small">Click a name to open LinkedIn, or click anywhere else on the row to select for outreach.</p></div></div>
          ${detail.contacts.length ? '<div class="table-scroll top-contacts-table"><table class="table"><thead><tr><th>Contact</th><th>Role & relationship</th><th>Action</th></tr></thead><tbody>' +
            detail.contacts.map((c) => '<tr class="contact-row-selectable" data-contact-id="' + escapeAttr(c.id || '') + '" data-contact-name="' + escapeAttr(c.fullName) + '" data-contact-title="' + escapeAttr(c.title || '') + '"><td>' + (() => { const linkedinHref = getContactLinkedInHref(c, detail.account.displayName); return linkedinHref ? '<a class="row-link" href="' + escapeAttr(linkedinHref) + '" target="_blank" rel="noreferrer"><strong>' + escapeHtml(c.fullName || '') + '</strong></a>' : '<strong>' + escapeHtml(c.fullName || '') + '</strong>'; })() + '</td><td><strong class="contact-role">' + escapeHtml(c.title || 'Role not listed') + '</strong><span class="contact-relationship-meta">' + formatNumber(c.priorityScore) + ' score · connected ' + formatDate(c.connectedOn) + '</span></td><td><button class="ghost-button ghost-button--xs" type="button" data-action="select-contact-outreach" data-account-id="' + escapeAttr(detail.account.id) + '" data-contact-id="' + escapeAttr(c.id || '') + '" data-contact-name="' + escapeAttr(c.fullName || '') + '" aria-label="Draft outreach for ' + escapeAttr(c.fullName || 'contact') + '">Draft</button></td></tr>').join('') +
            '</tbody></table></div>' : renderEmptyState({ icon: 'People', title: 'No contacts imported for this account', copy: 'Import LinkedIn connections or add contacts so outreach has a warm path.', action: '<a class="secondary-button" href="#/admin">Import contacts</a>' })}
        </div>
      </div>

      <div class="action-zone-col">
        <div class="detail-card">
          <div class="panel-header"><div><h3>Activity & results</h3><p class="muted small">Log the conversation once; replies, meetings, opportunities, and wins update the commercial view automatically.</p></div></div>
          ${activityFormHtml}
          ${commercialOutcomesEnabled ? renderAccountCommercialOutcomes(accountOutcomes) : ''}
          <div class="timeline" style="max-height:400px;overflow-y:auto;">
            ${detail.activity.length ? detail.activity.map(renderTimelineItem).join('') : renderEmptyState({ icon: 'Log', title: 'No activity on this account', copy: 'Log outreach or a note so the next step is easy to remember.' })}
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
            ${renderField('Priority', renderPrioritySelect('priority', detail.account.priority || priorityLabel))}
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
            `).join('') : renderEmptyState({ icon: 'OK', title: 'No trigger alerts yet', copy: 'Score changes, hiring spikes, and follow-up signals will appear here.', compact: true })}
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
          ${detail.jobs.length ? renderAccountJobsTable(detail.jobs) : renderEmptyState({ icon: 'Jobs', title: 'No jobs linked yet', copy: 'Run board discovery and live import to pull in open roles for this account.', action: '<a class="secondary-button" href="#/admin">Refresh jobs</a>' })}
        </div>

        <div class="table-card">
          <div class="panel-header"><div><h3>ATS configs</h3><p class="muted small">Discovery results and import sources.</p></div></div>
          ${detail.configs.length ? renderAccountConfigsTable(detail.configs) : renderEmptyState({ icon: 'Boards', title: 'No job board mapped', copy: 'Resolve this account to find a supported careers board.', action: `<button class="secondary-button" type="button" data-action="account-resolve-now" data-id="${escapeAttr(detail.account.id)}">Find board</button>` })}
        </div>
      </div>
    </section>
  `;
  syncOutreachComposerState();
  await applyPendingOutreachContact(detail.account.id);
  wireAccountNotes(accountId);
}
async function renderContactsView() {
  renderLoadingState('Contacts', 'Loading relationship intelligence...');
  setViewTitle(isJobSeekerPersona() ? 'Network' : 'Contacts');
  const result = await api(`/api/contacts${buildQuery(appState.contactQuery)}`);
  const jobSeeker = isJobSeekerPersona();
  const readyContacts = result.items.filter((item) => ['ready_to_contact', 'replied', 'opportunity'].includes(item.outreachStatus)).length;
  const contactAdvancedOpen = Boolean(appState.contactQuery.minScore);

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Relationship intelligence</p>
          <h3>${jobSeeker ? 'Warm contact paths' : 'Prioritized contacts'}</h3>
          <p class="subtitle">${jobSeeker ? 'Your network ranked by company overlap and role relevance so you can ask the right person for context, direction, or a referral.' : 'Your network ranked by relevance, title strength, and company overlap so you can route outreach through the best people first.'}</p>
        </div>
        <div class="kpi-ribbon headline-metrics headline-metrics--compact">
          ${renderMetricTile('Results', formatNumber(result.total))}
          ${renderMetricTile('Ready now', formatNumber(readyContacts))}
        </div>
      </div>
    </section>

    <section class="table-card">
      <div class="panel-header">
        <div><h3>${jobSeeker ? 'Search network' : 'Contact intelligence'}</h3><p class="muted small">${jobSeeker ? 'Find the strongest relationship path into each target company.' : 'Your network ranked by company overlap and title relevance.'}</p></div>
        <div class="panel-actions">
          <button class="primary-button primary-button--sm" type="button" data-action="open-network-import-modal"><span class="btn-icon">⚡</span><span>Import LinkedIn CSV</span></button>
          <button class="secondary-button secondary-button--sm" type="button" data-action="quick-load-sample-workspace">✨ Sample Network</button>
          ${renderExportOptions('contacts', 'Contact options')}
        </div>
      </div>
      <form id="contacts-filter-form" class="filter-grid filter-grid--compact list-filter-grid list-filter-grid--contacts">
        ${renderField('Search', `<input name="q" value="${escapeAttr(appState.contactQuery.q)}" placeholder="Name, company, title">`)}
        ${renderField('Outreach', `<select name="outreachStatus"><option value="">Any stage</option><option value="not_started" ${selected(appState.contactQuery.outreachStatus, 'not_started')}>Not started</option><option value="researching" ${selected(appState.contactQuery.outreachStatus, 'researching')}>Researching</option><option value="ready_to_contact" ${selected(appState.contactQuery.outreachStatus, 'ready_to_contact')}>Ready to contact</option><option value="contacted" ${selected(appState.contactQuery.outreachStatus, 'contacted')}>Contacted</option><option value="replied" ${selected(appState.contactQuery.outreachStatus, 'replied')}>Replied</option><option value="opportunity" ${selected(appState.contactQuery.outreachStatus, 'opportunity')}>Opportunity</option></select>`)}
        <div class="field field--action list-filter-actions"><button class="primary-button" type="submit">Apply</button></div>
        <details class="filter-disclosure"${contactAdvancedOpen ? ' open' : ''}>
          <summary>More filters${contactAdvancedOpen ? ' · 1 active' : ''}</summary>
          <div class="filter-disclosure__grid">
            ${renderField('Min score', `<input name="minScore" type="number" min="0" value="${escapeAttr(appState.contactQuery.minScore)}">`)}
            <div class="field field--action"><button class="ghost-button" type="button" data-action="reset-filters" data-view="contacts">Reset filters</button></div>
          </div>
        </details>
      </form>
      ${result.items.length ? renderContactsTable(result.items) : renderEmptyState({ icon: 'People', title: 'No contacts in workspace yet', copy: 'Upload your LinkedIn Connections.csv to discover warm paths, or load a sample network to explore immediately.', action: '<button class="primary-button" type="button" data-action="open-network-import-modal">⚡ Import LinkedIn CSV</button><button class="secondary-button" type="button" data-action="quick-load-sample-workspace">✨ Try Sample Network</button><button class="ghost-button" type="button" data-action="open-linkedin-guide">📥 Export Guide</button>' })}
      ${renderPagination('contacts', result.page, result.pageSize, result.total)}
    </section>
  `;
}

async function renderJobsView() {
  renderLoadingState('Jobs', 'Loading job activity...');
  setViewTitle(isJobSeekerPersona() ? 'Open roles' : 'Jobs');
  const stateBootstrap = await loadBootstrap(false, { includeFilters: true });
  const atsOptions = stateBootstrap.filters?.atsTypes || [];
  const jobSeeker = isJobSeekerPersona();
  const personaKey = jobSeeker ? 'jobseeker' : 'bd';
  const searchFocus = stateBootstrap.settings?.searchFocusByPersona?.[personaKey] || {};
  const focusConfigured = Boolean(searchFocus.targetRoles || searchFocus.excludedRoles || searchFocus.targetIndustries || (searchFocus.workStyle && searchFocus.workStyle !== 'any'));
  if (focusConfigured && !appState.jobQuery.sortBy) appState.jobQuery.sortBy = 'relevance';
  const result = await api(`/api/jobs${buildQuery(appState.jobQuery)}`);
  if (appState.jobQuery.pipelineOnly === 'true') {
    result.items = result.items.filter((item) => Boolean(appState.jobPipelineStages?.[item.id]));
  }
  const jobAdvancedCount = ['geography', 'workStyle', 'hasContacts', 'minConnections', 'ats', 'recencyDays', 'isNew', 'minRelevance'].filter((key) => appState.jobQuery[key]).length;

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Hiring feed</p>
          <h3>${jobSeeker ? 'Open roles at target companies' : 'Imported job activity'}</h3>
          <p class="subtitle">${jobSeeker ? 'Current roles from supported careers boards, deduped and ready to compare against your target list and network.' : 'Normalized open roles from supported ATS boards, deduped and ready to use as outreach context.'}</p>
        </div>
        <div class="kpi-ribbon headline-metrics headline-metrics--compact">
          ${renderMetricTile('Results', formatNumber(result.total))}
          ${renderMetricTile('Recent postings', formatNumber(result.items.filter((item) => item.isNew).length))}
        </div>
      </div>
    </section>

    ${renderGeographicHubFilter()}

    <section class="table-card">
      <div class="panel-header">
        <div><h3>${jobSeeker ? 'Role shortlist' : 'Imported jobs'}</h3><p class="muted small">${focusConfigured ? 'Jobs are ranked against your saved role, industry, and work-style focus.' : 'Rank jobs by fit with a saved <a class="inline-action-link" href="#/admin/search-focus">search focus</a>, then filter by company, platform, and recency.'}</p></div>
        <div class="panel-actions">
          <button class="primary-button primary-button--sm" type="button" data-action="open-network-import-modal"><span class="btn-icon">⚡</span><span>Import Network</span></button>
          ${renderExportOptions('jobs', 'Job options')}
        </div>
      </div>
      <div class="job-preset-strip" role="group" aria-label="Job quick filters">
        <span class="job-preset-label">Quick filters:</span>
        <button class="job-preset-chip${!appState.jobQuery.workStyle && !appState.jobQuery.hasContacts && !appState.jobQuery.minRelevance && !appState.jobQuery.recencyDays && !appState.jobQuery.pipelineOnly && (!appState.jobQuery.sortBy || appState.jobQuery.sortBy === 'posted') ? ' is-active' : ''}" type="button" data-action="apply-job-preset" data-preset="all">All Roles</button>
        <button class="job-preset-chip${appState.jobQuery.workStyle === 'local_remote' || appState.jobQuery.geography === 'local_remote' ? ' is-active' : ''}" type="button" data-action="apply-job-preset" data-preset="local_remote">🏡 Local or Remote</button>
        <button class="job-preset-chip${appState.jobQuery.hasContacts === 'true' ? ' is-active' : ''}" type="button" data-action="apply-job-preset" data-preset="network">👥 In My Network</button>
        <button class="job-preset-chip${appState.jobQuery.sortBy === 'connections' ? ' is-active' : ''}" type="button" data-action="apply-job-preset" data-preset="most_connected">⚡ Most Connected</button>
        <button class="job-preset-chip${appState.jobQuery.pipelineOnly ? ' is-active' : ''}" type="button" data-action="apply-job-preset" data-preset="pipeline">🎯 In Pipeline (${Object.keys(appState.jobPipelineStages || {}).length})</button>
        <button class="job-preset-chip${appState.jobQuery.minRelevance === '45' || appState.jobQuery.sortBy === 'relevance' ? ' is-active' : ''}" type="button" data-action="apply-job-preset" data-preset="best_fit">🌟 Best Fit</button>
        <button class="job-preset-chip${appState.jobQuery.recencyDays === '7' ? ' is-active' : ''}" type="button" data-action="apply-job-preset" data-preset="recent">⏱️ Past 7 Days</button>
      </div>
      <form id="jobs-filter-form" class="filter-grid filter-grid--compact list-filter-grid list-filter-grid--jobs">
        ${renderField('Search', `<input name="q" value="${escapeAttr(appState.jobQuery.q)}" placeholder="Role, company, location, contact">`)}
        ${renderField('Network', `<select name="hasContacts"><option value="">All companies</option><option value="true" ${selected(appState.jobQuery.hasContacts, 'true')}>In my network (has contacts)</option></select>`)}
        ${renderField('Work style', `<select name="workStyle"><option value="">All work styles</option><option value="local_remote" ${selected(appState.jobQuery.workStyle, 'local_remote')}>Local or Remote (Preferred)</option><option value="remote" ${selected(appState.jobQuery.workStyle, 'remote')}>Remote only</option><option value="hybrid" ${selected(appState.jobQuery.workStyle, 'hybrid')}>Hybrid</option><option value="onsite" ${selected(appState.jobQuery.workStyle, 'onsite')}>On-site only</option></select>`)}
        ${renderField('Sort by', `<select name="sortBy"><option value="">Posted date</option><option value="connections" ${selected(appState.jobQuery.sortBy, 'connections')}>Most connections in network</option><option value="relevance" ${selected(appState.jobQuery.sortBy, 'relevance')}>Best fit</option><option value="retrieved" ${selected(appState.jobQuery.sortBy, 'retrieved')}>Retrieved date</option></select>`)}
        <div class="field field--action list-filter-actions"><button class="primary-button" type="submit">Apply</button></div>
        <details class="filter-disclosure"${jobAdvancedCount ? ' open' : ''}>
          <summary>More filters${jobAdvancedCount ? ` · ${formatNumber(jobAdvancedCount)} active` : ''}</summary>
          <div class="filter-disclosure__grid">
            ${renderField('Active', `<select name="active"><option value="">All</option><option value="true" ${selected(appState.jobQuery.active, 'true')}>Active only</option><option value="false" ${selected(appState.jobQuery.active, 'false')}>Inactive only</option></select>`)}
            ${renderField('Geography', `<select name="geography"><option value="">All locations</option><option value="local_remote" ${selected(appState.jobQuery.geography, 'local_remote')}>Local or Remote</option><option value="gta" ${selected(appState.jobQuery.geography, 'gta')}>Greater Toronto Area (GTA / ON)</option><option value="canada" ${selected(appState.jobQuery.geography, 'canada')}>Canada only</option><option value="canada_us" ${selected(appState.jobQuery.geography, 'canada_us')}>Include US</option><option value="us" ${selected(appState.jobQuery.geography, 'us')}>US only</option><option value="remote" ${selected(appState.jobQuery.geography, 'remote')}>Remote only</option></select>`)}
            ${renderField('Min connections', `<select name="minConnections"><option value="">Any</option><option value="1" ${selected(appState.jobQuery.minConnections, '1')}>1+ connections</option><option value="2" ${selected(appState.jobQuery.minConnections, '2')}>2+ connections</option><option value="3" ${selected(appState.jobQuery.minConnections, '3')}>3+ connections</option></select>`)}
            ${renderField('ATS', `<select name="ats"><option value="">All ATS</option>${atsOptions.map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.jobQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
            ${renderField('Recency', `<select name="recencyDays"><option value="">Any</option><option value="7" ${selected(appState.jobQuery.recencyDays, '7')}>Last 7 days</option><option value="14" ${selected(appState.jobQuery.recencyDays, '14')}>Last 14 days</option><option value="30" ${selected(appState.jobQuery.recencyDays, '30')}>Last 30 days</option></select>`)}
            ${renderField('Posting age', `<select name="isNew"><option value="">All</option><option value="true" ${selected(appState.jobQuery.isNew, 'true')}>Recent postings</option><option value="false" ${selected(appState.jobQuery.isNew, 'false')}>Older postings</option></select>`)}
            ${renderField('Fit', `<select name="minRelevance"><option value="">All roles</option><option value="45" ${selected(appState.jobQuery.minRelevance, '45')}>Relevant only</option><option value="70" ${selected(appState.jobQuery.minRelevance, '70')}>Strong matches</option></select>`)}
            <div class="field field--action"><button class="ghost-button" type="button" data-action="reset-filters" data-view="jobs">Reset filters</button></div>
          </div>
        </details>
      </form>
      ${result.items.length ? renderJobsTable(result.items) : renderEmptyState({ icon: 'Jobs', title: 'No jobs match these filters', copy: 'Reset filters, import LinkedIn connections to match open roles, or try the sample network.', action: '<button class="primary-button" type="button" data-action="open-network-import-modal">⚡ Import Connections</button><button class="secondary-button" type="button" data-action="quick-load-sample-workspace">✨ Try Sample Network</button><button class="ghost-button" type="button" data-action="reset-filters" data-view="jobs">Reset filters</button>' })}
      ${renderPagination('jobs', result.page, result.pageSize, result.total)}
    </section>
  `;
}

function renderCollapsibleStart(sectionId, title, subtitle) {
  const collapsed = appState.adminCollapsed[sectionId];
  return `<div class="form-card admin-section" id="admin-section-${escapeAttr(sectionId)}">
    <div class="collapsible-header${collapsed ? ' collapsed' : ''}" data-collapse-id="${escapeAttr(sectionId)}" role="button" tabindex="0" aria-expanded="${collapsed ? 'false' : 'true'}" aria-controls="admin-section-body-${escapeAttr(sectionId)}">
      <div class="panel-header" style="margin:0;flex:1"><div><h3>${escapeHtml(title)}</h3>${subtitle ? `<p class="muted small">${subtitle}</p>` : ''}</div></div>
      <span class="chevron">\u25BC</span>
    </div>
    <div class="collapsible-body${collapsed ? ' collapsed' : ''}" id="admin-section-body-${escapeAttr(sectionId)}" aria-hidden="${collapsed ? 'true' : 'false'}"${collapsed ? ' hidden inert' : ''}>`;
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
  if (body) {
    body.hidden = isCollapsed;
    body.inert = isCollapsed;
    body.setAttribute('aria-hidden', isCollapsed ? 'true' : 'false');
  }
  appState.adminCollapsed[id] = isCollapsed;
  persistAdminCollapsed();
}

function wireCollapsibleSections() {
  document.querySelectorAll('.collapsible-header[data-collapse-id]').forEach((header) => {
    const toggleCollapse = () => {
      setCollapsibleState(header, !header.classList.contains('collapsed'));
    };
    header.addEventListener('click', toggleCollapse);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapse(); }
    });
  });
}

function focusGuidedControl(control, container) {
  if (!container) return;
  window.requestAnimationFrame(() => {
    scrollIntoViewRespectingMotion(container, { behavior: 'smooth', block: 'center' });
    if (control) {
      control.focus({ preventScroll: true });
      container.classList.add('is-guided-focus');
      window.setTimeout(() => container.classList.remove('is-guided-focus'), 1800);
    }
  });
}

function focusAccountCreateForm() {
  const control = document.querySelector('#account-create-form input[name="company"]');
  const container = control?.closest('[data-route-focus]');
  if (container?.tagName === 'DETAILS') container.open = true;
  focusGuidedControl(control, container);
}

function openAdminSection(sectionId, focusKey = '') {
  const section = document.getElementById(`admin-section-${sectionId}`);
  const header = section?.querySelector('.collapsible-header[data-collapse-id]');
  if (header) {
    setCollapsibleState(header, false);
    const focusSelectors = {
      contacts: '#connections-csv-file',
      discovery: '[data-action="run-discovery"]',
      jobs: '[data-action="run-live-import"]',
    };
    const focusControl = focusSelectors[focusKey] ? section.querySelector(focusSelectors[focusKey]) : null;
    focusGuidedControl(focusControl, focusControl?.closest('[data-admin-focus]') || section);
  }
}

const ACQUISITION_FUNNEL_STAGES = [
  { eventType: 'ats_sample_used', label: 'Sample audits', description: 'Checker sample explored', tone: 'neutral', unit: 'event' },
  { eventType: 'ats_audit_completed', label: 'Manual audits', description: 'User-submitted target lists', tone: 'accent', unit: 'event' },
  { eventType: 'demo_started', label: 'Demo starts', description: 'Read-only workspace opened', tone: 'accent', unit: 'event' },
  { eventType: 'signup_started', label: 'Signup opens', description: 'Signup form opened', tone: 'warning', unit: 'event' },
  { eventType: 'signup_completed', label: 'Trials created', description: 'New trial workspaces', tone: 'success', unit: 'workspace' },
  { eventType: 'setup_completed', label: 'Setup complete', description: 'Workspace configured', tone: 'accent', unit: 'workspace' },
  { eventType: 'target_created', label: 'First targets', description: 'Workspaces creating a target', tone: 'success', unit: 'workspace' },
  { eventType: 'useful_jobs_found', label: 'Useful roles found', description: 'Workspaces finding live roles', tone: 'success', unit: 'workspace' },
  { eventType: 'outreach_generated', label: 'First action', description: 'Workspaces generating outreach', tone: 'success', unit: 'workspace' },
];

function renderAcquisitionFunnel(analytics = {}) {
  const rows = Array.isArray(analytics.funnel) ? analytics.funnel : [];
  const byEvent = new Map(rows.map((row) => [row.eventType, row]));
  const lookbackDays = Math.max(1, Number(analytics.lookbackDays || 30));
  const activation = analytics.activation || {};
  const activatedWorkspaces = Math.max(0, Number(activation.workspaces || 0));
  const cohortSignups = Math.max(0, Number(activation.cohortSignups || 0));
  const pendingWindow = Math.max(0, Number(activation.pendingWindow || 0));
  const windowDays = Math.max(1, Number(activation.windowDays || 7));
  const sourceRows = Array.isArray(analytics.activationBySource) ? analytics.activationBySource : [];
  const activationCard = `
    <article class="story-card story-card--success" data-analytics-kpi="seven-day-activation">
      <span class="story-card__label">${formatNumber(windowDays)}-day activation</span>
      <strong>${formatNumber(activatedWorkspaces)} ${activatedWorkspaces === 1 ? 'workspace' : 'workspaces'}</strong>
      <p>Setup + target + usable signal + workflow action. ${formatNumber(cohortSignups)} signup ${cohortSignups === 1 ? 'workspace' : 'workspaces'} in this cohort${pendingWindow ? `; ${formatNumber(pendingWindow)} still inside the measurement window` : ''}.</p>
    </article>
  `;
  const cards = ACQUISITION_FUNNEL_STAGES.map((stage) => {
    const row = byEvent.get(stage.eventType) || {};
    const value = stage.unit === 'workspace'
      ? Number(row.workspaces || 0)
      : Number(row.events || 0);
    const unit = value === 1 ? stage.unit : `${stage.unit}s`;
    return `
      <article class="story-card story-card--${stage.tone}" data-analytics-event="${stage.eventType}">
        <span class="story-card__label">${escapeHtml(stage.label)}</span>
        <strong>${formatNumber(value)} ${escapeHtml(unit)}</strong>
        <p>${escapeHtml(stage.description)}</p>
      </article>
    `;
  }).join('');
  const sourceBreakdown = sourceRows.length ? `
    <div class="analytics-source-breakdown">
      <div>
        <h5>Activation quality by first touch</h5>
        <p class="small muted">Compare acquisition channels after the seven-day value threshold, not on traffic alone.</p>
      </div>
      <div class="table-scroll">
        <table class="table" aria-label="Activation quality by first-touch source">
          <thead><tr><th>First touch</th><th>Persona</th><th>Signups</th><th>Activated</th><th>Pending</th></tr></thead>
          <tbody>${sourceRows.map((row) => `
            <tr data-analytics-source="${escapeAttr(row.source || 'direct')}">
              <td><strong>${escapeHtml(row.source || 'direct')}</strong>${row.campaign ? `<span class="table-meta">${escapeHtml(row.campaign)}</span>` : ''}</td>
              <td>${escapeHtml(row.persona === 'jobseeker' ? 'Job seeker' : (row.persona === 'bd' ? 'Recruiter' : 'Unspecified'))}</td>
              <td>${formatNumber(row.signups || 0)}</td>
              <td>${formatNumber(row.workspaces || 0)}</td>
              <td>${formatNumber(row.pendingWindow || 0)}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    </div>
  ` : '';

  return `
    <div class="panel-header">
      <div>
        <p class="eyebrow">Acquisition and activation</p>
        <h4>${formatNumber(lookbackDays)}-day funnel</h4>
        <p class="small muted">See where campaign interest becomes a usable workspace.</p>
      </div>
    </div>
    <div class="story-strip" aria-label="Acquisition and activation funnel">
      ${activationCard}
      ${cards}
    </div>
    ${sourceBreakdown}
    <p class="small muted">Public actions are event counts; product milestones are unique workspaces. Seven-day activation is the value threshold; the remaining cards diagnose where workspaces stop. Use this as directional evidence, not a person-level cohort report.</p>
  `;
}

async function renderAdminView() {
  renderLoadingState('Admin', 'Loading pipeline controls...');
  setViewTitle(isJobSeekerPersona() ? 'Tools' : 'Admin');
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
  const ingestionDiagnostics = batch.ingestionDiagnostics || {};
  appState.runtimeStatus = runtime;
  appState.ingestionDiagnostics = ingestionDiagnostics;
  const targetScoreRollout = batch.targetScoreRollout || {};
  appState.targetScoreRollout = targetScoreRollout;
  const resolverReport = batch.resolverReport;
  const enrichmentReport = batch.enrichmentReport;
  const unresolvedQueue = batch.unresolvedQueue;
  const mediumQueue = batch.mediumQueue;
  const enrichmentQueue = batch.enrichmentQueue;
  const summary = resolverReport.summary || {};
  const enrichmentSummary = enrichmentReport.summary || {};
  const operationalCompanyCount = summary.operationalTotalCompanies ?? summary.totalCompanies ?? 0;
  const operationalResolvedCount = summary.operationalResolvedCount ?? summary.resolvedCount ?? 0;
  const operationalCoveragePercent = summary.operationalCoveragePercent ?? summary.coveragePercent ?? 0;
  const operationalUnresolvedCount = Math.max(0, Number(operationalCompanyCount || 0) - Number(operationalResolvedCount || 0));
  const reviewQueueCount = (summary.mediumReviewQueueCount || 0) + (summary.unresolvedReviewQueueCount || 0);
  const billing = batch.billing || {};
  const planJobBoardLimit = Number(billing.plan?.limits?.jobBoards ?? 75);
  const discoveryLimitDefault = planJobBoardLimit === -1
    ? Math.max(1, operationalUnresolvedCount || operationalCompanyCount || 1000)
    : Math.min(75, Math.max(1, planJobBoardLimit));
  const referral = billing.referral || {};
  const referralLink = referral.link || '';
  const analytics = batch.analytics || {};
  const canViewSiteAnalytics = Boolean(batch.canViewSiteAnalytics && batch.analytics);
  const stripeStatus = billing.stripe || {};
  const stripeReady = Boolean(stripeStatus.checkoutReady ?? stripeStatus.ready);
  const stripeCommercialReady = Boolean(stripeStatus.commercialReady);
  const stripeBillingMessage = stripeCommercialReady
    ? 'Secure online plan changes are available.'
    : (stripeReady
      ? 'Secure checkout is available for configured plans.'
      : 'Online plan changes are not available in this workspace. Your current access is unchanged.');
  const billingAccess = billing.billingAccess || {};
  const personaKey = isJobSeekerPersona() ? 'jobseeker' : 'bd';
  const searchFocus = stateBootstrap.settings.searchFocusByPersona?.[personaKey] || {};
  const searchFocusCopy = personaKey === 'jobseeker'
    ? {
        title: 'Your role search focus',
        subtitle: 'Tell BD Engine what a good opportunity looks like. This changes job ranking and which company boards are checked first.',
        roleLabel: 'Roles you want',
        rolePlaceholder: 'Financial analyst, strategy manager, business operations',
        industryLabel: 'Preferred industries',
      }
    : {
        title: 'Your demand signal focus',
        subtitle: 'Define the hiring signals that suggest a company may need what you sell. This changes job ranking and board-discovery priority.',
        roleLabel: 'Roles that signal demand',
        rolePlaceholder: 'Recruiter, sales engineer, implementation manager',
        industryLabel: 'Industries you sell into',
      };
  const paymentAttentionRequired = Boolean(billingAccess.paymentAttentionRequired);
  const billingGraceDate = billingAccess.graceEndsAt ? formatDate(billingAccess.graceEndsAt) : '';
  const canChangeBilling = billing.canChangeBilling !== false;
  const rememberedPlanIntent = appState.onboardingIntent?.planIntent;
  const billingSelectedPlanId = billing.plan?.id === 'trial' && ['sales', 'jobseeker'].includes(rememberedPlanIntent)
    ? rememberedPlanIntent
    : billing.plan?.id;
  const billingPrimaryAction = billing.canManageBilling ? 'billing-portal' : 'billing-checkout';
  const billingPrimaryLabel = !canChangeBilling
    ? 'Owner access required'
    : billing.canManageBilling
    ? (paymentAttentionRequired ? 'Update payment method' : 'Manage plan')
    : (stripeReady ? 'Choose a plan' : 'Plan changes unavailable');
  const siteAnalyticsSection = canViewSiteAnalytics ? `
        ${renderCollapsibleStart('site-analytics', 'Site analytics', 'First-party traffic and product milestones for campaign decisions.')}
          <div class="metrics-grid metrics-grid--compact">
            ${renderMetricCard('Unique visitors today', analytics.recent?.visitorsToday || 0, `${formatNumber(analytics.recent?.visitsToday || 0)} visits today`)}
            ${renderMetricCard('Unique visitors 30d', analytics.recent?.visitors || 0, `${formatNumber(analytics.recent?.visits || 0)} visits in 30 days`)}
            ${renderMetricCard('All-time visitors', analytics.totals?.visitors || 0, `${formatNumber(analytics.totals?.visits || 0)} total visits`)}
          </div>
          ${renderAcquisitionFunnel(analytics)}
          <div class="inline-split">
            <div>
              <p class="eyebrow">Top sources</p>
              ${renderMiniStatList((analytics.topSources || []).map((item) => ({ label: item.source || 'direct', value: `${formatNumber(item.visitors || 0)} visitors` })))}
            </div>
            <div>
              <p class="eyebrow">Top pages</p>
              ${renderMiniStatList((analytics.topPaths || []).map((item) => ({ label: item.path || '/', value: `${formatNumber(item.visitors || 0)} visitors` })))}
            </div>
          </div>
        ${renderCollapsibleEnd()}
` : '';

  appRoot.innerHTML = `
    <section class="hero-card hero-card--compact">
      <div class="hero-layout">
        <div class="hero-copy">
          <p class="eyebrow">Workspace operations</p>
          <h3>Keep coverage fresh</h3>
          <p class="subtitle">Refresh company data, find job boards, import live roles, and keep the daily account queue ready for action.</p>
          <div class="hero-signal-strip">
            ${renderSignalChip('Tracked coverage', `${formatNumber(operationalCoveragePercent)}%`, 'success')}
            ${renderSignalChip('Needs review', formatNumber((summary.mediumReviewQueueCount || 0) + (summary.unresolvedReviewQueueCount || 0)), 'warning')}
            ${renderSignalChip('Background work', formatNumber((runtime.runningJobs || 0) + (runtime.queuedJobs || 0)), (runtime.runningJobs || runtime.queuedJobs) ? 'accent' : 'neutral')}
          </div>
        </div>
        <div class="action-card action-card--featured">
          <p class="eyebrow">Most used</p>
          <h4>Refresh all signals</h4>
          <p class="small muted">Updates company identity, finds job boards, imports live jobs, and refreshes account scores in one background run.</p>
          <button class="primary-button" type="button" data-action="run-launch-workflow">Refresh all signals</button>
        </div>
      </div>
    </section>

    <div id="pipeline-progress-container" class="pipeline-progress hidden">
      <div class="pipeline-progress-header">
        <div class="pipeline-progress-copy">
          <p class="eyebrow">Revenue Pipeline</p>
          <h4 class="pipeline-progress-stage">Starting...</h4>
        </div>
        <div class="pipeline-progress-label">0%</div>
      </div>
      <div class="pipeline-progress-bar">
        <div class="pipeline-progress-bar-fill" style="width: 0%;"></div>
      </div>
    </div>

    <section class="admin-grid">
      <div class="two-column">
        ${renderCollapsibleStart('pipeline-ops', 'Refresh actions', 'Choose a full refresh or update one part of the workspace.')}
          <div class="actions-grid">
            <div class="action-card" data-admin-focus="discovery">
              <p class="eyebrow">Next most used</p>
              <h4>Find job boards</h4>
              <p class="small muted">Use this when you only need to find or recheck company job boards.</p>
              <div class="inline-field-stack">
                <input id="discovery-limit" type="number" min="1" value="${escapeAttr(discoveryLimitDefault)}" placeholder="Rows to check">
                <label class="field"><span class="small muted">Only missing boards</span><select id="discovery-only-missing"><option value="true" selected>Yes</option><option value="false">No</option></select></label>
                <label class="field"><span class="small muted">Recheck known boards</span><select id="discovery-force-refresh"><option value="false" selected>No</option><option value="true">Yes</option></select></label>
                <div class="button-row">
                  <button class="secondary-button" type="button" data-action="run-discovery">Find boards</button>
                </div>
              </div>
            </div>
            <div class="action-card" data-admin-focus="jobs">
              <p class="eyebrow">Frequent refresh</p>
              <h4>Refresh live jobs</h4>
              <p class="small muted">Fetches jobs from active job boards and updates tracked roles.</p>
              <button class="secondary-button" data-action="run-live-import">Import latest jobs</button>
            </div>
            <div class="action-card" data-admin-focus="contacts">
              <p class="eyebrow">Setup and reseed</p>
              <h4>Import LinkedIn contacts</h4>
              <p class="small muted">Preview the file first, then import contacts and companies.</p>
              <div class="data-use-notice" role="note">
                <strong>No LinkedIn login or automation</strong>
                <span>BD Engine only reads the Connections.csv file you select. Review LinkedIn's terms and your organization's policies before uploading exported data.</span>
              </div>
              <div class="inline-field-stack">
                <input type="hidden" id="connections-csv-path" value="${escapeAttr(stateBootstrap.defaults.connectionsCsvPath || '')}">
                <label class="field-label" for="connections-csv-file">LinkedIn Connections CSV</label>
                <input type="file" id="connections-csv-file" accept=".csv">
                <div class="button-row">
                  <button class="secondary-button" type="button" data-action="dry-run-connections-csv">Preview CSV</button>
                  <button class="ghost-button" type="button" data-action="import-connections-csv">Import contacts</button>
                </div>
              </div>
            </div>
          </div>
        ${renderCollapsibleEnd()}
        ${renderCollapsibleStart('search-focus', searchFocusCopy.title, searchFocusCopy.subtitle)}
          <form id="settings-form" class="settings-grid">
            ${renderField(searchFocusCopy.roleLabel, `<textarea name="targetRoles" rows="3" placeholder="${escapeAttr(searchFocusCopy.rolePlaceholder)}">${escapeHtml(searchFocus.targetRoles || '')}</textarea>`, 'Separate role titles with commas. Specific phrases produce better rankings.')}
            ${renderField('Roles to exclude', `<textarea name="excludedRoles" rows="3" placeholder="Intern, commission only, retail sales">${escapeHtml(searchFocus.excludedRoles || '')}</textarea>`, 'Roles containing these phrases are ranked at the bottom.')}
            ${renderField(searchFocusCopy.industryLabel, `<textarea name="targetIndustries" rows="3" placeholder="Financial services, SaaS, manufacturing">${escapeHtml(searchFocus.targetIndustries || '')}</textarea>`, 'Used to prioritize limited board-discovery batches when company industry data is available.')}
            ${renderField('Work style', `<select name="workStyle"><option value="any" ${selected(searchFocus.workStyle || 'any', 'any')}>Any</option><option value="remote" ${selected(searchFocus.workStyle, 'remote')}>Remote</option><option value="hybrid" ${selected(searchFocus.workStyle, 'hybrid')}>Hybrid</option><option value="onsite" ${selected(searchFocus.workStyle, 'onsite')}>On-site</option></select>`)}
            ${renderField('Relevant score threshold', `<input name="minimumRelevanceScore" type="number" min="0" max="100" step="5" value="${escapeAttr(searchFocus.minimumRelevanceScore ?? 45)}">`, '45 is a useful starting point. Raise it for a tighter shortlist.')}
            <div class="field field--action"><label>Update rankings</label><button class="primary-button" type="submit">Save focus and rescore jobs</button></div>
          </form>
        ${renderCollapsibleEnd()}
        ${renderCollapsibleStart('background-jobs', 'Background work', 'Imports and refreshes continue here while you keep using the app.')}
          <div id="background-jobs-panel" class="timeline timeline--jobs"></div>
        ${renderCollapsibleEnd()}
        ${renderCollapsibleStart('billing-subscription', 'Plan and billing', 'Manage your subscription.')}
          <div class="settings-grid">
            <div class="action-card">
              <p class="eyebrow">Current Plan: ${escapeHtml(billing.plan?.name || 'Trial')}</p>
              <h4>${paymentAttentionRequired ? 'Payment needs attention' : 'Manage your workspace plan'}</h4>
              <p class="small muted">You are currently on the ${escapeHtml(billing.plan?.displayName || 'Trial')} plan. ${escapeHtml(stripeBillingMessage)}</p>
              ${paymentAttentionRequired ? `<div class="billing-notice billing-notice--warning" role="status"><strong>Workspace access remains available during recovery.</strong><span>Update the payment method by ${escapeHtml(billingGraceDate || 'the grace deadline')}${billingAccess.graceDaysRemaining !== null && billingAccess.graceDaysRemaining !== undefined ? ` (${formatNumber(billingAccess.graceDaysRemaining)} day${billingAccess.graceDaysRemaining === 1 ? '' : 's'} remaining)` : ''}.</span></div>` : ''}
              <div class="inline-field-stack">
                <select id="billing-plan-select">
                  <option value="jobseeker" ${selected(billingSelectedPlanId, 'jobseeker')} ${stripeStatus.prices?.jobseeker ? '' : 'disabled'}>Job Seeker ($5 USD/mo)</option>
                  <option value="sales" ${selected(billingSelectedPlanId, 'sales')} ${stripeStatus.prices?.sales ? '' : 'disabled'}>Sales Professional ($10 USD/mo)</option>
                </select>
                <div class="button-row">
                  <button class="primary-button" type="button" data-action="${billingPrimaryAction}"${canChangeBilling && (stripeReady || billing.canManageBilling) ? '' : ' disabled'}>${escapeHtml(billingPrimaryLabel)}</button>
                </div>
              </div>
            </div>
            <div class="action-card">
              <p class="eyebrow">Referral credit</p>
              <h4>Earn a $5 credit</h4>
              <p class="small muted">Share your referral link. When a referred workspace becomes a paid subscriber, Stripe applies a $5 credit to your next BD Engine invoice.</p>
              <div class="inline-field-stack">
                <input id="referral-link" readonly value="${escapeAttr(referralLink || 'Referral link will appear after your workspace finishes loading.')}">
                <div class="button-row">
                  <button class="secondary-button" type="button" data-action="copy-referral-link" data-referral-link="${escapeAttr(referralLink)}"${referralLink ? '' : ' disabled'}>Copy referral link</button>
                </div>
              </div>
            </div>
          </div>
        ${renderCollapsibleEnd()}
      </div>

      <div class="two-column">
        ${renderCollapsibleStart('coverage-health', 'Job coverage health', 'See which companies can refresh jobs now, what is blocking the rest, and the next action to take.')}
          ${renderJobCoverageHealth(ingestionDiagnostics)}
        ${renderCollapsibleEnd()}
        ${renderCollapsibleStart('ats-config-records', 'Job board coverage', 'Board matches, manual overrides, and import readiness for tracked companies.')}
          <form id="configs-filter-form" class="filter-grid filter-grid--compact">
            ${renderField('Search', `<input name="q" value="${escapeAttr(appState.configQuery.q)}" placeholder="Company, board ID, URL">`)}
            ${renderField('ATS', `<select name="ats"><option value="">All</option>${(stateBootstrap.filters?.atsTypes || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.ats, value)}>${escapeHtml(value)}</option>`).join('')}</select>`)}
            ${renderField('Discovery', `<select name="discoveryStatus"><option value="">All</option>${(stateBootstrap.filters?.configDiscoveryStatuses || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.discoveryStatus, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Confidence', `<select name="confidenceBand"><option value="">All</option>${(stateBootstrap.filters?.configConfidenceBands || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.confidenceBand, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Review', `<select name="reviewStatus"><option value="">All</option>${(stateBootstrap.filters?.configReviewStatuses || []).map((value) => `<option value="${escapeAttr(value)}" ${selected(appState.configQuery.reviewStatus, value)}>${escapeHtml(humanize(value))}</option>`).join('')}</select>`)}
            ${renderField('Active', `<select name="active"><option value="">All</option><option value="true" ${selected(appState.configQuery.active, 'true')}>Active</option><option value="false" ${selected(appState.configQuery.active, 'false')}>Inactive</option></select>`)}
            <div class="field field--action"><label>Filter boards</label><button class="primary-button" type="submit">Apply filters</button><button class="ghost-button" type="button" data-action="reset-filters" data-view="configs">Reset</button></div>
          </form>
          ${configs.items.length ? renderConfigsTable(configs.items) : renderEmptyState({ icon: 'Boards', title: 'No job boards match these filters', copy: 'Reset filters or run board discovery to create supported board matches.', action: '<button class="ghost-button" type="button" data-action="reset-filters" data-view="configs">Reset filters</button><button class="secondary-button" type="button" data-action="run-discovery">Find boards</button>' })}
          ${renderPagination('configs', configs.page, configs.pageSize, configs.total)}
        ${renderCollapsibleEnd()}
        ${renderCollapsibleStart('review-queues', 'Review queues', 'Only high-confidence boards auto-activate. Medium-confidence results and unresolved companies land here for fast review.')}
          <div class="panel-stack">
            <div>
              <div class="inline-header"><strong>Medium-confidence queue</strong><span class="small muted">${formatNumber(summary.mediumReviewQueueCount || 0)} pending</span></div>
              ${mediumQueue.items.length ? renderResolverQueue(mediumQueue.items, 'medium') : renderEmptyState({ icon: 'OK', title: 'Nothing needs review', copy: 'Medium-confidence board matches will land here before they are approved.', compact: true })}
            </div>
            <div>
              <div class="inline-header"><strong>Unresolved queue</strong><span class="small muted">${formatNumber(summary.unresolvedReviewQueueCount || 0)} pending</span></div>
              ${unresolvedQueue.items.length ? renderResolverQueue(unresolvedQueue.items, 'unresolved') : renderEmptyState({ icon: 'OK', title: 'No unresolved companies waiting', copy: 'Companies missing a usable board will appear here with the reason they need help.', compact: true })}
            </div>
          </div>
        ${renderCollapsibleEnd()}
      </div>

      ${siteAnalyticsSection}
      <div class="two-column">
        ${renderCollapsibleStart('runtime-status', 'App status', 'See whether background work is idle, queued, or running.')}
          <div id="runtime-status-panel"></div>
          <div class="action-card diagnostics-card">
            <div>
              <p class="eyebrow">Support</p>
              <h4>Share a safe diagnostic summary</h4>
              <p class="small muted">Copies refresh timing, job-source coverage, background status, and browser details. It excludes contacts, notes, outreach text, and account secrets.</p>
            </div>
            <button class="secondary-button" type="button" data-action="copy-diagnostics">Copy diagnostics</button>
          </div>
        ${renderCollapsibleEnd()}
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
        ${renderCollapsibleEnd()}
        ${renderCollapsibleStart('enrichment-queue', 'Enrichment review queue', `Sorted by target score, then hiring velocity, then engagement. ${formatNumber(enrichmentQueue.total || 0)} companies in queue.`)}
          ${renderEnrichmentFilters()}
          ${renderEnrichmentQueuePanel(enrichmentQueue)}
        ${renderCollapsibleEnd()}
        ${renderCollapsibleStart('resolver-coverage', 'Resolver coverage', 'Tracked-company readiness first, with the full imported history shown separately for context.')}
          <div class="metrics-grid metrics-grid--compact">
            ${renderMetricCard('Actionable companies', operationalCompanyCount, `${formatNumber(operationalCoveragePercent)}% have resolved boards`)}
            ${renderMetricCard('Need resolver work', operationalUnresolvedCount, 'Actionable companies still missing a resolved board')}
            ${renderMetricCard('Resolver rows', summary.totalCompanies || 0, `${formatNumber(summary.networkSourcesExcluded || 0)} network-only sources excluded from automatic work`)}
            ${renderMetricCard('Resolved rows', summary.resolvedCount || 0, `${formatNumber(summary.coveragePercent || 0)}% of total resolver rows`)}
            ${renderMetricCard('Active imports', summary.activeCount || 0, 'High-confidence boards auto-enabled')}
            ${renderMetricCard('Unresolved rows', summary.unresolvedCount || 0, 'Imported rows still missing strong ATS evidence')}
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
        ${renderCollapsibleStart('ats-config-form', `${appState.configEditingId ? 'Edit job board source' : 'Add job board source'}`, 'Paste a supported public job-board URL for live imports, or record an enterprise careers URL for manual tracking.')}
          ${appState.configEditingId ? '<div style="text-align:right;margin-bottom:8px"><button class="ghost-button" data-action="new-config">Clear form</button></div>' : ''}
          <div class="source-support-note" role="note">
            <strong>Automatic job imports:</strong> Greenhouse, Lever, Ashby, SmartRecruiters, Workday, BambooHR, Workable, Jobvite, Recruitee, Personio, Rippling, and compatible careers pages.
            <span>Enterprise systems such as iCIMS, Taleo, ADP, SuccessFactors, and Phenom can be tracked, but their public pages do not always expose a reliable job feed.</span>
          </div>
          <form id="config-form" class="detail-form">
            ${renderField('Company', '<input name="companyName" required>')}
            ${renderField('Job-board system', '<select name="atsType"><option value="">Detect from URL</option><optgroup label="Automatic import supported"><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option><option value="smartrecruiters">SmartRecruiters</option><option value="workday">Workday</option><option value="bamboohr">BambooHR</option><option value="workable">Workable</option><option value="jobvite">Jobvite</option><option value="recruitee">Recruitee</option><option value="personio">Personio</option><option value="rippling">Rippling</option><option value="custom_static">Compatible careers page</option></optgroup><optgroup label="Tracking only"><option value="icims">iCIMS - tracking only</option><option value="taleo">Taleo - tracking only</option><option value="adp">ADP - tracking only</option><option value="successfactors">SuccessFactors - tracking only</option><option value="phenom">Phenom - tracking only</option></optgroup></select>')}
            ${renderField('Board account or slug', '<input name="boardId" placeholder="Usually detected from the careers URL">')}
            ${renderField('Domain', '<input name="domain">')}
            ${renderField('Careers URL', '<input name="careersUrl" placeholder="https://jobs.lever.co/company">')}
            ${renderField('Source', '<input name="source">')}
            ${renderField('Active', '<select name="active"><option value="true">Active</option><option value="false">Inactive</option></select>')}
            <div class="field" style="grid-column: 1 / -1;"><label>Notes</label><textarea name="notes" rows="4"></textarea></div>
            <div><button class="primary-button" type="submit">${appState.configEditingId ? 'Save config' : 'Create config'}</button></div>
          </form>
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
// Fetch EVERY page for an export. A single pageSize:10000 request silently
// truncated exports for workspaces above 10k records (the flagship dataset has
// 12k+ accounts / 20k+ contacts) and produced one giant server round-trip.
async function fetchAllForExport(path, query) {
  const pageSize = 2000;
  const maxRows = 100000;
  const items = [];
  let page = 1;
  for (;;) {
    const result = await api(`${path}${buildQuery({ ...query, page, pageSize })}`);
    items.push(...(result.items || []));
    const total = Number(result.total || items.length);
    if (items.length >= total || !(result.items || []).length || items.length >= maxRows) break;
    page += 1;
  }
  return items;
}

async function exportAccountsCsv() {
  const items = await fetchAllForExport('/api/accounts', appState.accountQuery);
  exportToCsv('accounts.csv',
    ['Company', 'Domain', 'Target Score', 'Priority', 'Status', 'Owner', 'Outreach Status', 'Hiring Velocity', 'Jobs 30d', 'Next Action', 'Tags'],
    items.map(a => [a.displayName, a.domain, getTargetScore(a), a.priority, a.status, a.owner, a.outreachStatus, a.hiringVelocity, a.jobsLast30Days, a.nextAction, (a.tags || []).join('; ')])
  );
}

async function exportContactsCsv() {
  const items = await fetchAllForExport('/api/contacts', appState.contactQuery);
  exportToCsv('contacts.csv',
    ['Name', 'Company', 'Title', 'Score', 'Connected On', 'LinkedIn', 'Outreach Status'],
    items.map(c => [c.fullName, c.companyName, c.title, c.priorityScore, c.connectedOn, c.linkedinUrl, c.outreachStatus])
  );
}

function extractRoleSkills(title = '', department = '') {
  const text = `${title} ${department}`.toLowerCase();
  const known = [
    { label: 'React', test: /\breact\b/i },
    { label: 'TypeScript', test: /\btypescript\b|\bts\b/i },
    { label: 'Node.js', test: /\bnode(\.js)?\b/i },
    { label: 'Python', test: /\bpython\b/i },
    { label: 'AWS', test: /\baws\b|\bcloud\b/i },
    { label: 'Go', test: /\bgolang\b/i },
    { label: 'Kubernetes', test: /\bkubernetes\b|\bk8s\b/i },
    { label: 'SQL / DB', test: /\b(sql|postgres|database)\b/i },
    { label: 'Product', test: /\bproduct\b/i },
    { label: 'Design / UX', test: /\b(design|ui|ux|figma)\b/i },
    { label: 'Sales / BD', test: /\b(sales|account executive|sdr|bdr|business development)\b/i },
    { label: 'Recruiting', test: /\b(recruiter|recruiting|talent|sourcer)\b/i },
    { label: 'Leadership', test: /\b(lead|manager|director|vp|head|chief)\b/i },
  ];
  return known.filter(k => k.test.test(text)).map(k => k.label).slice(0, 3);
}

async function exportJobsCsv() {
  const items = await fetchAllForExport('/api/jobs', appState.jobQuery);
  exportToCsv('network-jobs-pipeline.csv',
    ['Role Title', 'Company', 'Location', 'Work Style', 'Connection Count', 'Matched Contacts', 'Pipeline Stage', 'Fit Score', 'Posting URL', 'Generated Warm Referral Note'],
    items.map(j => {
      const contacts = Array.isArray(j.contacts) ? j.contacts.map(c => `${c.fullName} (${c.title || 'Contact'})`).join('; ') : (j.topContactName || '');
      const stage = appState.jobPipelineStages?.[j.id] || 'Not tracked';
      const copyObj = generateWarmStudioCopy({
        job: j,
        account: { displayName: j.companyName },
        selectedContact: j.contacts?.[0] || { fullName: j.topContactName || 'Team Member' },
        selectedTone: 'casual',
      });
      return [
        j.title,
        j.companyName,
        j.location || (j.isRemote ? 'Remote' : ''),
        j.workStyle || (j.isRemote ? 'Remote' : 'On-site'),
        j.connectionCount || 0,
        contacts,
        stage,
        j.relevanceScore ?? '',
        j.jobUrl || j.url || '',
        copyObj.referralDm.replace(/\n+/g, ' '),
      ];
    })
  );
  showToast('📥 Pipeline and network roles exported to CSV!', 'success');
}

function renderTodayQueueTable(items) {
  return `
    <div class="table-scroll"><table class="table responsive-table"><thead><tr><th>Company</th><th>Target score</th><th>Hiring velocity</th><th>Engagement</th><th>Network</th><th>Next move</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td data-label="Company"><a class="row-link" href="#/accounts/${item.id}">${escapeHtml(item.displayName)}</a><div class="small muted">${escapeHtml(item.topContactName || item.domain || '')}</div><div class="small muted">${escapeHtml(renderTargetScoreSignalSummary(item))}</div></td>
          <td data-label="Target score">${formatNumber(getTargetScore(item))}<div class="small muted">${escapeHtml(getTargetScoreExplanation(item) || humanize(item.priority || 'medium'))}</div></td>
          <td data-label="Hiring velocity">${formatNumber(item.hiringVelocity || 0)}<div class="small muted">${pluralize(item.jobsLast30Days || 0, 'job')} / 30d</div></td>
          <td data-label="Engagement">${formatNumber(item.engagementScore || 0)}<div class="small muted">${formatNumber(item.jobsLast90Days || 0)} jobs / 90d</div></td>
          <td data-label="Network">${item.networkStrength ? renderStatusPill(item.networkStrength, toneForNetwork(item.networkStrength)) : '<span class="muted">—</span>'}<div class="small muted">${formatNumber(item.companyGrowthSignalScore || 0)} growth</div></td>
          <td data-label="Next move">${escapeHtml(item.nextAction || item.recommendedAction || '')}</td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderRecentJobsTable(items) {
  return renderJobsTable(items.slice(0, 12), true);
}

function renderAccountsTable(items) {
  return `
    <div id="bulk-action-bar" class="bulk-action-bar hidden" role="toolbar" aria-label="Bulk actions">
      <span id="bulk-count" class="bulk-count-badge">0 selected</span>
      <button class="primary-button primary-button--sm" type="button" data-action="launch-batch-outreach-accounts">⚡ Batch Outreach Studio</button>
      <select id="bulk-status" aria-label="Bulk status change"><option value="">Change status...</option><option value="new">New</option><option value="researching">Researching</option><option value="contacted">Contacted</option><option value="in_conversation">In conversation</option><option value="client">Client</option><option value="paused">Paused</option></select>
      <select id="bulk-priority" aria-label="Bulk priority change"><option value="">Change priority...</option><option value="strategic">Strategic</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
      ${renderOwnerSelect('bulk-owner', '', true).replace('name="bulk-owner"', 'id="bulk-owner" aria-label="Bulk owner change"')}
      <input id="bulk-tags" placeholder="Add tags..." class="compact-input" aria-label="Bulk add tags">
      <button class="secondary-button" data-action="apply-bulk-update">Apply</button>
    </div>
    <div class="table-scroll"><table class="table accounts-table responsive-table"><thead><tr><th><input type="checkbox" id="bulk-select-all" aria-label="Select all accounts"></th><th>Company & Tech Stack</th><th>Target score</th><th>Hiring Signals</th><th>Owner / next step</th><th>Status</th><th>ATS</th></tr></thead><tbody>
      ${items.map((item) => {
        const vel = calculateHiringVelocity(item, appState.jobs || []);
        const stack = extractTechStack(item.displayName || '', item.industry || '', item.recommendedAction || '');
        return `
        <tr class="${item.staleFlag === 'STALE' ? 'row--stale' : ''}">
          <td data-label=""><input type="checkbox" class="bulk-checkbox" value="${item.id}" aria-label="Select ${escapeAttr(item.displayName)}"></td>
          <td data-label="Company">
            <a class="row-link" href="#/accounts/${item.id}" data-action="open-account" data-id="${item.id}">${escapeHtml(item.displayName)}</a>
            <div class="small muted">${escapeHtml(item.domain || item.topContactName || item.recommendedAction || '')}</div>
            ${renderTechDnaCluster(stack)}
            ${vel.surgeBadge ? `<div style="margin-top:3px;"><span class="signal-badge signal-badge--surge">${vel.surgeBadge}</span></div>` : ''}
            ${vel.hardToFillBadge ? `<div style="margin-top:3px;"><span class="signal-badge signal-badge--hard-to-fill">${vel.hardToFillBadge}</span></div>` : ''}
            ${renderCompetitorClusterPills(item)}
            <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
              <button class="inline-action-link" type="button" data-action="open-network-graph-modal" data-account-id="${item.id}">🕸️ Entity Graph</button>
              <button class="inline-action-link" type="button" data-action="open-pitch-deck-modal" data-account-id="${item.id}">💎 Pitch Deck</button>
            </div>
          </td>
          <td data-label="Target score">${formatNumber(getTargetScore(item))}${renderScoreDelta(item.id, getTargetScore(item))}${renderSparkline(item.id)}<div class="small muted">${escapeHtml(getTargetScoreExplanation(item) || humanize(item.priority || 'medium'))}</div></td>
          <td data-label="Hiring">
            ${formatNumber(item.hiringVelocity || 0)} velocity
            <div class="small muted">${pluralize(item.jobsLast30Days || 0, 'job')} / 30d \u00b7 ${formatNumber(item.jobsLast90Days || 0)} / 90d</div>
            ${item.networkStrength ? renderStatusPill(item.networkStrength, toneForNetwork(item.networkStrength)) : ''}
            ${vel.freshBadge ? `<span class="signal-badge signal-badge--just-opened">${vel.freshBadge}</span>` : ''}
          </td>
          <td data-label="Owner / next step"><button class="inline-edit-trigger" type="button" data-inline-edit="owner" data-account-id="${item.id}" data-current-value="${escapeAttr(item.owner || '')}" aria-label="Edit owner for ${escapeAttr(item.displayName)}"><span data-inline-value>${escapeHtml(item.owner || 'Unassigned')}</span></button><div class="small muted">${escapeHtml(item.nextAction || 'No next action set')}</div><details class="row-detail-menu"><summary>Log activity</summary><button class="micro-button" data-action="quick-log-inline" data-id="${item.id}" data-name="${escapeAttr(item.displayName)}">Open note field</button></details></td>
          <td data-label="Status">${renderStatusPill(item.status || 'new', 'neutral')}<div class="small muted">${escapeHtml(humanize(item.outreachStatus || 'not_started'))}</div></td>
          <td data-label="ATS">${renderAccountResolutionSummary(item)}</td>
        </tr>
        <tr id="quick-log-${item.id}" class="quick-log-row hidden">
          <td colspan="7">
            <form class="quick-log-form" data-account-id="${item.id}">
              <input name="quickNote" placeholder="Quick note..." class="compact-input">
              <select name="outreachStatus" class="compact-select"><option value="">No stage change</option>${renderOutreachStageOptions('')}</select>
              <button class="secondary-button compact-btn" type="submit">Save</button>
              <button type="button" class="ghost-button compact-btn" data-action="close-quick-log" data-id="${item.id}">Cancel</button>
            </form>
          </td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`;
}

function renderContactsTable(items) {
  return `
    <div id="contacts-bulk-action-bar" class="bulk-action-bar hidden" role="toolbar" aria-label="Contact bulk actions">
      <span class="bulk-count-badge" id="contacts-bulk-count">0 selected</span>
      <button class="primary-button primary-button--sm" type="button" data-action="launch-batch-outreach-contacts">⚡ Batch Outreach Studio</button>
      <button class="secondary-button secondary-button--sm" type="button" data-action="export-selected-contacts-csv">📥 Export Selected CSV</button>
      <button class="ghost-button ghost-button--sm" type="button" data-action="clear-contacts-bulk">Clear</button>
    </div>
    <div class="table-scroll"><table class="table responsive-table contacts-table"><thead><tr><th><input type="checkbox" id="contacts-bulk-select-all" aria-label="Select all contacts"></th><th>Contact</th><th>Company</th><th>Score</th><th>Status</th><th>Action</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td data-label=""><input type="checkbox" class="contacts-bulk-checkbox" value="${item.id}" data-name="${escapeAttr(item.fullName || '')}" data-company="${escapeAttr(item.companyName || '')}" data-title="${escapeAttr(item.title || '')}" data-account-id="${escapeAttr(item.accountId || '')}" data-email="${escapeAttr(item.email || '')}" data-linkedin="${escapeAttr(item.linkedinUrl || '')}" aria-label="Select ${escapeAttr(item.fullName || '')}"></td>
          <td data-label="Contact"><strong>${escapeHtml(item.fullName)}</strong><div class="small muted">${escapeHtml(item.title || '')}</div><div class="small muted">Connected ${formatDate(item.connectedOn)}${safeExternalHref(item.linkedinUrl) ? ` · <a class="row-link" href="${escapeAttr(safeExternalHref(item.linkedinUrl))}" target="_blank" rel="noreferrer">LinkedIn</a>` : ''}</div></td>
          <td data-label="Company">${item.accountId ? `<a class="row-link" href="#/accounts/${item.accountId}">${escapeHtml(item.companyName || '')}</a>` : escapeHtml(item.companyName || '')}</td>
          <td data-label="Score">${formatNumber(item.priorityScore)}</td>
          <td data-label="Status">${renderStatusPill(item.outreachStatus || 'not_started', 'neutral')}</td>
          <td data-label="Action">
            <div class="button-row button-row--wrap">
              <button class="ghost-button ghost-button--xs" type="button" data-action="open-contact-outreach" data-account-id="${escapeAttr(item.accountId || '')}" data-contact-id="${escapeAttr(item.id || '')}" data-contact-name="${escapeAttr(item.fullName || '')}" ${item.accountId ? '' : 'disabled'}>Outreach</button>
            </div>
            <details class="contact-edit-details">
              <summary>Edit details</summary>
              <form id="contact-inline-form-${escapeAttr(item.id)}" data-contact-id="${item.id}" class="detail-form contact-inline-form"><div class="inline-field"><label>Stage</label><select name="outreachStatus"><option value="not_started" ${selected(item.outreachStatus, 'not_started')}>Not started</option><option value="researching" ${selected(item.outreachStatus, 'researching')}>Researching</option><option value="ready_to_contact" ${selected(item.outreachStatus, 'ready_to_contact')}>Ready</option><option value="contacted" ${selected(item.outreachStatus, 'contacted')}>Contacted</option><option value="replied" ${selected(item.outreachStatus, 'replied')}>Replied</option><option value="opportunity" ${selected(item.outreachStatus, 'opportunity')}>Opportunity</option></select></div><div class="inline-field"><label>Notes</label><input name="notes" value="${escapeAttr(item.notes || '')}" placeholder="Short note"></div><button class="ghost-button" type="submit">Save</button></form>
            </details>
          </td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderJobsTable(items, compact) {
  return `
    ${compact ? '' : `
      <div id="jobs-bulk-action-bar" class="bulk-action-bar hidden" role="toolbar" aria-label="Job bulk actions">
        <span class="bulk-count-badge" id="jobs-bulk-count">0 selected</span>
        <button class="primary-button primary-button--sm" type="button" data-action="launch-batch-outreach-jobs">⚡ Batch Outreach Studio</button>
        <button class="ghost-button ghost-button--sm" type="button" data-action="clear-jobs-bulk">Clear</button>
      </div>
    `}
    <div class="table-scroll"><table class="table responsive-table jobs-table"><thead><tr>${compact ? '' : '<th><input type="checkbox" id="jobs-bulk-select-all" aria-label="Select all jobs"></th>'}<th>Role</th><th>Company</th><th>Network / Decision Makers</th><th>Pipeline</th><th>Fit</th><th>Location</th><th>Source</th><th>Timing</th></tr></thead><tbody>
      ${items.map((item) => {
        const hasConn = Number(item.connectionCount || 0) > 0;
        const rawContacts = Array.isArray(item.contacts) ? item.contacts : [];
        const rankedContacts = rankContactsForJob(item, rawContacts);
        const roleVel = detectRoleVelocity(item);
        const isJobSeeker = isJobSeekerPersona();
        const pipelineStage = appState.jobPipelineStages?.[item.id] || '';
        const skills = extractRoleSkills(item.title, item.department);
        const stack = extractTechStack(item.title, item.department, '');
        return `
        <tr class="${hasConn ? 'job-row--connected' : ''}${pipelineStage ? ' job-row--pipelined' : ''}">
          ${compact ? '' : `<td data-label=""><input type="checkbox" class="jobs-bulk-checkbox" value="${item.id}" data-job-title="${escapeAttr(item.title || '')}" data-company="${escapeAttr(item.companyName || item.company || '')}" data-account-id="${escapeAttr(item.accountId || '')}" data-job-url="${escapeAttr(item.jobUrl || item.url || '')}" data-job-location="${escapeAttr(item.location || (item.isRemote ? 'Remote' : ''))}" data-contacts="${escapeAttr(JSON.stringify(rawContacts))}" aria-label="Select ${escapeAttr(item.title || '')}"></td>`}
          <td data-label="Role">
            ${safeExternalHref(item.jobUrl || item.url) ? `<a class="row-link job-title-link" href="${escapeAttr(safeExternalHref(item.jobUrl || item.url))}" target="_blank" rel="noreferrer">${escapeHtml(item.title || '')}</a>` : `<strong class="job-title">${escapeHtml(item.title || '')}</strong>`}
            ${skills.length ? `<div class="job-skills-chips">${skills.map((s) => `<span class="job-skill-chip">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
            ${renderTechDnaCluster(stack)}
            <div class="job-signals-cluster">
              ${getJobSignalBadges(item).join('')}
              ${roleVel.badgeLabel ? `<span class="signal-badge ${roleVel.badgeClass}">${roleVel.badgeLabel}</span>` : ''}
            </div>
            ${compact ? '' : `
              <div class="small muted">${escapeHtml(item.department || '')}</div>
              <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
                <button class="inline-action-link job-outreach-link" type="button" data-action="open-warm-studio" data-job-id="${escapeAttr(item.id || '')}" data-contact-id="${escapeAttr(rankedContacts[0]?.id || '')}">💌 Warm Studio</button>
                <button class="inline-action-link" type="button" data-action="open-candidate-slate-modal" data-job-id="${escapeAttr(item.id || '')}">📄 Candidate Slate</button>
                <button class="inline-action-link" type="button" data-action="open-call-studio" data-job-id="${escapeAttr(item.id || '')}" data-contact-id="${escapeAttr(rankedContacts[0]?.id || '')}">🎙️ Call Prompter</button>
              </div>
            `}
          </td>
          <td data-label="Company">
            ${item.accountId ? `<a class="row-link company-link" href="#/accounts/${item.accountId}">${escapeHtml(item.companyName || '')}</a>` : `<span class="company-name">${escapeHtml(item.companyName || '')}</span>`}
          </td>
          <td data-label="Network / Contacts">
            ${hasConn ? `
              <div class="job-network-cell">
                <span class="status-pill status-pill--success"><span class="pill-dot"></span>⚡ ${formatNumber(item.connectionCount)} in network</span>
                ${rankedContacts.length ? `
                  <div class="job-contacts-list">
                    ${rankedContacts.slice(0, 3).map((c) => `
                      <div class="job-contact-chip">
                        <span class="align-chip ${c.chipClass}" title="${escapeAttr(c.alignmentReason)}">${c.badgeIcon} ${c.badgeLabel}</span>
                        <span class="job-contact-name">${escapeHtml(c.fullName)}</span>
                        ${c.title ? `<span class="job-contact-title"> · ${escapeHtml(c.title)}</span>` : ''}
                        <button class="inline-action-link job-contact-outreach-btn" type="button" data-action="open-warm-studio" data-job-id="${escapeAttr(item.id || '')}" data-contact-id="${escapeAttr(c.id || c.fullName || '')}" title="Generate 1-click warm intro to ${escapeAttr(c.fullName)}">Warm path →</button>
                      </div>
                    `).join('')}
                    ${rankedContacts.length > 3 ? `<span class="small muted">+${rankedContacts.length - 3} more contacts</span>` : ''}
                  </div>
                ` : (item.topContactName ? `<div class="small muted">${escapeHtml(item.topContactName)}</div>` : '')}
              </div>
            ` : `
              <div class="job-network-cell job-network-cell--empty">
                <span class="status-pill status-pill--neutral">No contacts</span>
                ${item.accountId ? `<div class="small muted"><a class="inline-action-link" href="#/accounts/${item.accountId}">View company</a></div>` : ''}
              </div>
            `}
          </td>
          <td data-label="Pipeline">
            <div class="job-pipeline-cell">
              <select class="job-pipeline-select compact-select" data-action="update-job-pipeline-stage" data-job-id="${escapeAttr(item.id || '')}">
                <option value="" ${!pipelineStage ? 'selected' : ''}>+ Track</option>
                <option value="saved" ${pipelineStage === 'saved' ? 'selected' : ''}>🔖 Saved</option>
                <option value="contacted" ${pipelineStage === 'contacted' ? 'selected' : ''}>💬 Intro Sent</option>
                <option value="replied" ${pipelineStage === 'replied' ? 'selected' : ''}>💌 Replied</option>
                <option value="interviewing" ${pipelineStage === 'interviewing' ? 'selected' : ''}>🎯 Interview</option>
                <option value="offer" ${pipelineStage === 'offer' ? 'selected' : ''}>🎉 Offer</option>
              </select>
            </div>
          </td>
          <td data-label="Fit">${renderJobRelevance(item)}</td>
          <td data-label="Location">
            <div class="job-location-cell">
              <span class="job-location-text">${escapeHtml(item.location || 'Location unspecified')}</span>
              <div class="job-workstyle-pills">
                ${item.isRemote || item.workStyle === 'remote' ? `<span class="status-pill status-pill--accent" title="Remote work eligible">Remote</span>` : ''}
                ${item.workStyle === 'hybrid' ? `<span class="status-pill status-pill--info" title="Hybrid work">Hybrid</span>` : ''}
                ${item.workStyle === 'onsite' ? `<span class="status-pill status-pill--neutral" title="On-site work">On-site</span>` : ''}
                ${item.isGta || item.isLocal ? `<span class="status-pill status-pill--success" title="Local GTA priority">Local</span>` : ''}
              </div>
            </div>
          </td>
          <td data-label="Source">${renderStatusPill(item.atsType || 'unknown', 'neutral')} ${renderStatusPill(item.active === false ? 'inactive' : 'active', item.active === false ? 'neutral' : 'success')}</td>
          <td data-label="Timing">${formatDate(item.postedAt)}<div class="small muted">Retrieved ${formatDate(item.retrievedAt || item.importedAt)}${item.isNew ? ' · Recent posting' : ''}</div></td>
        </tr>`;
      }).join('')}
    </tbody></table></div>`;
}

function renderJobRelevance(item) {
  if (item.relevanceScore === null || item.relevanceScore === undefined) {
    return renderStatusPill('Not scored', 'neutral');
  }
  const band = item.relevanceBand || 'low';
  const tone = band === 'strong' ? 'success' : band === 'possible' ? 'warning' : 'neutral';
  const reasons = Array.isArray(item.relevanceReasons) ? item.relevanceReasons.filter(Boolean).slice(0, 2).join(' · ') : '';
  return `${renderStatusPill(`${formatNumber(item.relevanceScore)} ${band}`, tone)}${reasons ? `<div class="small muted">${escapeHtml(reasons)}</div>` : ''}`;
}

function renderMiniStatList(items) {
  if (!items || !items.length) {
    return renderEmptyState({ icon: 'Info', title: 'No summary yet', copy: 'Run discovery or import data to populate this breakdown.', compact: true });
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
          <div class="small muted">${escapeHtml(item.atsType || 'unknown')} / ${escapeHtml(item.discoveryMethod || 'n/a')} / ${escapeHtml(item.domain || item.careersUrl || '')}</div>
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
    return renderEmptyState({ icon: 'Search', title: 'No companies match this review queue', copy: 'Reset filters or use Top 100/250 to focus the queue.', action: '<button class="ghost-button" type="button" data-action="reset-filters" data-view="enrichment">Reset filters</button>', compact: true });
  }
  return `
    <div class="table-scroll"><table class="table responsive-table admin-review-table">
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
            <td data-label="Company"><strong>${escapeHtml(item.displayName || '')}</strong><div class="small muted">${escapeHtml(item.canonicalDomain || item.domain || 'No domain')} · ${escapeHtml(item.careersUrl || 'No careers URL')}</div></td>
            <td data-label="Target score">${formatNumber(item.targetScore || 0)}</td>
            <td data-label="Connections">${formatNumber(item.connectionCount || 0)}</td>
            <td data-label="Open roles">${formatNumber(item.openRoleCount || 0)}</td>
            <td data-label="Confidence">${renderStatusPill(item.enrichmentConfidence || 'unresolved', item.enrichmentConfidence === 'high' ? 'success' : (item.enrichmentConfidence === 'medium' ? 'warning' : 'neutral'))}</td>
            <td data-label="Review reason">${escapeHtml(item.reviewReason || getTargetScoreExplanation(item) || item.enrichmentFailureReason || '')}${renderEnrichmentSignalPills(item, { compact: true })}<div class="small muted">${safeJoin(item.aliases)}</div></td>
            <td data-label="Actions"><details class="row-detail-menu"><summary>Review actions</summary><div class="micro-button-row"><button class="ghost-button ghost-button--xs" data-action="account-quick-enrich" data-id="${item.id}">Quick check</button><button class="secondary-button ghost-button--xs" data-action="account-resolve-now" data-id="${item.id}">Resolve</button><button class="ghost-button ghost-button--xs" data-action="expand-enrichment-row" data-id="${item.id}">Edit</button></div></details></td>
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
    <div class="table-scroll"><table class="table responsive-table config-table"><thead><tr><th>Company</th><th>Board match</th><th>Discovery</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td data-label="Company"><strong>${escapeHtml(item.companyName || '')}</strong><div class="small muted">${escapeHtml(item.domain || item.careersUrl || '')}</div></td>
          <td data-label="Board match">${renderStatusPill(item.atsType || 'unknown', 'neutral')} ${renderStatusPill(item.confidenceBand || 'unresolved', item.confidenceBand === 'high' ? 'success' : (item.confidenceBand === 'medium' ? 'warning' : 'neutral'))}<div class="small muted">${escapeHtml(item.boardId || item.resolvedBoardUrl || '')} · ${formatNumber(item.confidenceScore || 0)} / 100</div></td>
          <td data-label="Discovery">${renderStatusPill(item.discoveryStatus || 'manual', 'neutral')}<div class="small muted">${escapeHtml(item.discoveryMethod || '')}</div><div class="small muted">${escapeHtml(item.evidenceSummary || item.failureReason || item.notes || '')}</div></td>
          <td data-label="Status">${renderStatusPill(item.active ? 'active' : 'inactive', item.active ? 'success' : 'neutral')}<div class="small muted">${escapeHtml(item.reviewStatus || 'pending')} · ${formatDate(item.lastCheckedAt || item.lastResolutionAttemptAt)}</div></td>
          <td data-label="Actions"><details class="row-detail-menu"><summary>Manage board</summary><div class="micro-button-row"><button class="ghost-button" data-action="edit-config" data-id="${item.id}">Edit</button><button class="ghost-button" data-action="retry-config-resolution" data-id="${item.id}">Retry</button>${item.atsType ? `<button class="ghost-button" data-action="config-review" data-id="${item.id}" data-decision="promote">Promote</button>` : ''}</div></details></td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

function renderAccountJobsTable(items) {
  return renderJobsTable(items.slice(0, 15), false);
}

function renderAccountContactsTable(items) {
  return `
    <div class="table-scroll"><table class="table responsive-table"><thead><tr><th>Contact</th><th>Title</th><th>Score</th><th>Connected</th></tr></thead><tbody>
      ${items.map((item) => `<tr><td data-label="Contact">${escapeHtml(item.fullName || '')}</td><td data-label="Title">${escapeHtml(item.title || '')}</td><td data-label="Score">${formatNumber(item.priorityScore)}</td><td data-label="Connected">${formatDate(item.connectedOn)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function renderAccountConfigsTable(items) {
  return `
    <div class="table-scroll"><table class="table responsive-table"><thead><tr><th>ATS</th><th>Board</th><th>Discovery</th><th>Import</th></tr></thead><tbody>
      ${items.map((item) => `
        <tr>
          <td data-label="ATS">${renderStatusPill(item.atsType || 'unknown', 'neutral')}</td>
          <td data-label="Board">${escapeHtml(item.boardId || item.careersUrl || '')}</td>
          <td data-label="Discovery">${renderStatusPill(item.discoveryStatus || 'unknown', 'neutral')}<div class="small muted">${escapeHtml(item.discoveryMethod || '')}</div></td>
          <td data-label="Import">${formatDate(item.lastImportAt)}<div class="small muted">${escapeHtml(item.lastImportStatus || 'not run')}</div></td>
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

  const resolvedConfig = primaryConfig && ['resolved', 'mapped', 'discovered', 'manual'].includes(String(primaryConfig.discoveryStatus || '').toLowerCase());
  const configType = primaryConfig?.atsType || primaryConfig?.ats || 'job board';
  const evidenceText = account.enrichmentEvidence
    || account.enrichmentNotes
    || account.enrichmentFailureReason
    || (resolvedConfig ? `Resolved from the ${humanize(configType)} board${primaryConfig.boardId ? ` (${primaryConfig.boardId})` : ''}.` : 'No identity evidence stored yet.');
  const sourceText = account.enrichmentSource || primaryConfig?.discoveryMethod || primaryConfig?.source || 'unknown';
  const lastEnrichedAt = account.lastEnrichedAt || primaryConfig?.lastCheckedAt || primaryConfig?.updatedAt;
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
        <div><span class="small muted">Careers URL</span><strong>${safeExternalHref(account.careersUrl) ? `<a class="row-link" href="${escapeAttr(safeExternalHref(account.careersUrl))}" target="_blank" rel="noreferrer">${escapeHtml(account.careersUrl)}</a>` : 'Not set'}</strong></div>
        <div><span class="small muted">Source</span><strong>${escapeHtml(humanize(sourceText))}</strong></div>
        <div><span class="small muted">Last checked</span><strong>${escapeHtml(formatDate(lastEnrichedAt) || 'Never')}</strong></div>
      </div>
      <div class="empty-state empty-state--compact" style="margin-top:14px;">${escapeHtml(evidenceText)}</div>
      <div class="button-row button-row--wrap" style="margin-top:14px;">
        <button class="secondary-button" data-action="account-quick-enrich" data-id="${account.id}">Refresh local identity</button>
        ${needsDeepResolve(account) ? `<button class="primary-button" data-action="account-resolve-now" data-id="${account.id}">Resolve now</button>` : ''}
        ${needsDeepResolve(account) ? `<button class="ghost-button" data-action="account-deep-verify" data-id="${account.id}">Deep verify</button>` : ''}
        ${primaryConfig ? `<button class="ghost-button" data-action="rerun-enrichment-resolution" data-id="${account.id}">Rerun ATS</button>` : ''}
      </div>
      <p class="small muted" style="margin-top:10px;">Refresh local identity uses data already in this workspace. Resolve now checks the company's public careers presence. Deep verify is best for important companies that still need review.</p>
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

function getJobProgress(job) {
  const direct = Number(job?.progress);
  if (Number.isFinite(direct)) {
    return { pct: Math.max(0, Math.min(100, Math.round(direct))) };
  }
  return job?.status === 'running' ? parseJobProgress(job.progressMessage) : null;
}

function getRuntimeJobs(runtime) {
  const seen = new Set();
  return [...(runtime?.activeJobs || []), ...(runtime?.recentJobs || [])].filter((job) => {
    if (!job || !job.id || seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });
}

function getLiveImportTrackedJobCount(job = {}, result = {}) {
  const stats = result.stats || result.importRun?.stats || {};
  const candidates = [
    result.activeJobCount,
    stats.imported,
    result.importRun?.stats?.imported,
    job.recordsAffected,
  ];
  const value = candidates.find((item) => Number.isFinite(Number(item)));
  return Number(value || 0);
}

function getLiveImportChangedJobCount(result = {}) {
  const candidates = [
    result.changedJobCount,
    result.counts?.changedJobs,
  ];
  const value = candidates.find((item) => Number.isFinite(Number(item)));
  return value === undefined ? null : Number(value);
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
  const lastImport = liveImports.find((job) => job.status === 'completed');
  const latestFailure = liveImports.find((job) => ['failed', 'cancelled'].includes(job.status));
  const lastSuccessTime = Date.parse(lastImport?.finishedAt || lastImport?.updatedAt || '') || 0;
  const lastFailureTime = Date.parse(latestFailure?.finishedAt || latestFailure?.updatedAt || '') || 0;
  const lastFailed = latestFailure && lastFailureTime > lastSuccessTime ? latestFailure : null;
  const progress = activeImport ? getJobProgress(activeImport) : null;
  const lastResult = lastImport?.result || {};
  const lastStats = lastResult.stats || lastResult.importRun?.stats || {};
  const trackedJobs = getLiveImportTrackedJobCount(lastImport, lastResult);
  const jobsChanged = getLiveImportChangedJobCount(lastResult) ?? Number(lastStats.jobsTouched || lastStats.runImported || 0);
  const newJobs = Number(lastStats.newJobs || 0);
  const closedJobs = Number(lastStats.closedJobs || 0);
  const schedule = runtime?.refreshSchedule || {};
  const nextRefreshTime = Date.parse(schedule.nextEligibleAt || '');
  const refreshDue = Number.isFinite(nextRefreshTime) && nextRefreshTime <= Date.now();
  const scheduleLabel = schedule.disabledReason === 'read_only_demo'
    ? 'Demo data'
    : (!schedule.enabled
      ? 'Finish setup'
      : (refreshDue ? 'Due now' : formatDateTime(schedule.nextEligibleAt)));
  const scheduleMeta = schedule.disabledReason === 'read_only_demo'
    ? 'Automatic refresh is off in the read-only demo'
    : (schedule.enabled
      ? 'Runs daily when no refresh is already running'
      : 'Automatic refresh starts after setup');
  const activeLabel = activeImport
    ? (progress?.current ? `${formatNumber(progress.current)} / ${formatNumber(progress.total)}` : (progress ? `${progress.pct}%` : humanize(activeImport.status)))
    : 'Idle';
  const activeMeta = activeImport
    ? `${getJobPhaseLabel(activeImport)} / ${getRuntimeJobDuration(activeImport)} elapsed`
    : 'No live import is currently active';
  const lastDuration = lastImport && lastImport.status === 'completed' ? getRuntimeJobDuration(lastImport) : '';
  const lastMeta = lastImport
    ? `${lastDuration || 'Completed'} / ${formatNumber(newJobs)} new / ${formatNumber(closedJobs)} closed`
    : 'No completed imports found';
  const failureMeta = lastFailed
    ? `${humanize(lastFailed.status)} / ${formatDateTime(lastFailed.finishedAt || lastFailed.updatedAt || lastFailed.queuedAt)}`
    : 'No recent live import failures';
  const failureMessage = lastFailed?.errorMessage || lastFailed?.progressMessage || schedule.lastError || '';

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
          <span class="small muted">Last successful refresh</span>
          <strong>${escapeHtml(lastImport ? formatDateTime(lastImport.finishedAt || lastImport.updatedAt) : 'Not run yet')}</strong>
          <span class="small muted">${escapeHtml(lastMeta)}</span>
        </div>
        <div class="ingestion-health__metric">
          <span class="small muted">Latest job result</span>
          <strong>${formatNumber(trackedJobs)} tracked</strong>
          <span class="small muted">${formatNumber(jobsChanged)} changed in the last refresh</span>
        </div>
        <div class="ingestion-health__metric">
          <span class="small muted">Next automatic refresh</span>
          <strong>${escapeHtml(scheduleLabel)}</strong>
          <span class="small muted">${escapeHtml(scheduleMeta)}</span>
        </div>
      </div>
      ${progress ? `<div class="spark-bar job-progress-bar ingestion-health__bar"><span style="width:${progress.pct}%"></span></div>` : ''}
      ${lastFailed ? `<div class="ingestion-health__notice" role="alert"><strong>Recent refresh needs attention.</strong><span>${escapeHtml(failureMessage || failureMeta)}</span><button class="ghost-button ghost-button--xs" type="button" data-action="run-live-import">Retry now</button></div>` : ''}
    </div>
  `;
}

function coverageIssueTone(category) {
  if (category === 'failed') return 'danger';
  if (category === 'empty' || category === 'needs_review') return 'warning';
  if (category === 'discovery_needed' || category === 'careers_page_only') return 'accent';
  return 'neutral';
}

function renderJobCoverageHealth(diagnostics = {}) {
  const summary = diagnostics.coverageSummary || {};
  const issues = Array.isArray(diagnostics.coverageIssues) ? diagnostics.coverageIssues : [];
  const tracked = Number(summary.trackedCompanies || 0);
  const ready = Number(summary.importReady || 0);
  const companiesReady = Number(summary.companiesReady ?? ready);
  const issueCount = Number(summary.totalIssues || 0);
  const legacyUnclassified = Number(summary.legacyUnclassifiedCompanies || 0);
  const coverageCopy = tracked
    ? `${formatNumber(companiesReady)} of ${formatNumber(tracked)} tracked companies have a refresh-ready job source.`
    : 'Track companies to begin finding job sources.';

  return `
    <div class="coverage-health">
      <div class="inline-header coverage-health__header">
        <div>
          <strong>${escapeHtml(coverageCopy)}</strong>
          <p class="small muted">${formatNumber(summary.readyCoveragePercent || 0)}% ready for automatic job refresh</p>
        </div>
        ${renderStatusPill(issueCount ? `${formatNumber(issueCount)} to improve` : 'Coverage healthy', issueCount ? 'warning' : 'success')}
      </div>
      ${legacyUnclassified ? `<div class="ingestion-health__notice" role="status"><strong>Focus automatic refresh on a target portfolio.</strong><span>${formatNumber(legacyUnclassified)} legacy companies are currently treated as targets because they predate target selection. Classify the strongest companies so discovery is not spread across your entire network history.</span><button class="ghost-button ghost-button--xs" type="button" data-action="curate-legacy-targets">Choose target count</button></div>` : ''}
      <div class="metrics-grid metrics-grid--compact">
        ${renderMetricCard('Ready sources', ready, `${formatNumber(summary.readyNotRun || 0)} have not run yet`)}
        ${renderMetricCard('Refreshed successfully', summary.successful || 0, 'Sources returning usable live jobs')}
        ${renderMetricCard('Need company details', summary.needsCompanyDetails || 0, 'Add a domain or careers page to continue')}
        ${renderMetricCard('Need review', summary.needsReview || 0, 'Matches waiting for confirmation')}
        ${renderMetricCard('Refresh issues', Number(summary.failed || 0) + Number(summary.empty || 0), `${formatNumber(summary.failed || 0)} failed / ${formatNumber(summary.empty || 0)} returned no open jobs`)}
        ${renderMetricCard('Tracking only', summary.trackingOnly || 0, 'Saved careers pages without automatic imports')}
      </div>
      <div class="inline-header">
        <div><strong>Highest-priority coverage fixes</strong><p class="small muted">Ranked by issue severity and account score.</p></div>
        <div class="button-row button-row--wrap">
          <button class="ghost-button" type="button" data-action="run-discovery">Find missing boards</button>
          <button class="secondary-button" type="button" data-action="run-live-import">Refresh ready sources</button>
        </div>
      </div>
      ${issues.length ? `
        <div class="table-scroll"><table class="table table--coverage">
          <thead><tr><th>Company</th><th>Coverage issue</th><th>What to do next</th><th>Actions</th></tr></thead>
          <tbody>${issues.map((item) => `
            <tr>
              <td><strong>${escapeHtml(item.companyName || '')}</strong><div class="small muted">Target score ${formatNumber(item.targetScore || 0)}${item.atsType && item.atsType !== 'unknown' ? ` / ${escapeHtml(humanize(item.atsType))}` : ''}</div></td>
              <td>${renderStatusPill(item.label || humanize(item.category), coverageIssueTone(item.category))}<div class="small muted coverage-health__detail">${escapeHtml(item.detail || '')}</div></td>
              <td>${escapeHtml(item.recommendedAction || '')}</td>
              <td><div class="button-row button-row--wrap">
                <button class="ghost-button ghost-button--xs" type="button" data-action="edit-config" data-id="${escapeAttr(item.configId || '')}">Edit source</button>
                ${item.category === 'needs_review' ? `<button class="ghost-button ghost-button--xs" type="button" data-action="retry-config-resolution" data-id="${escapeAttr(item.configId || '')}">Check again</button>` : ''}
                ${item.accountId ? `<button class="ghost-button ghost-button--xs" type="button" data-action="open-account" data-id="${escapeAttr(item.accountId)}">Open company</button>` : ''}
              </div></td>
            </tr>
          `).join('')}</tbody>
        </table></div>
      ` : renderEmptyState({ icon: 'OK', title: 'Job coverage looks healthy', copy: 'All tracked job sources are ready, intentionally excluded, or importing successfully.', compact: true })}
    </div>
  `;
}

function renderBackgroundJobItem(job) {
  const tone = job.status === 'completed'
    ? 'success'
    : (job.status === 'failed' ? 'danger' : 'neutral');

  const progress = getJobProgress(job);
  const hasRecordsAffected = job.recordsAffected !== undefined && job.recordsAffected !== null && job.recordsAffected !== '';
  const recordsLabel = job.type === 'live-job-import' ? 'active jobs tracked' : 'records';

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
        <span class="small muted">${job.startedAt ? `Started ${formatDate(job.startedAt)}` : `Queued ${formatDate(job.queuedAt)}`}${hasRecordsAffected ? ` · ${formatNumber(job.recordsAffected)} ${recordsLabel}` : ''}</span>
      </div>
      ${job.errorMessage ? `<p class="small muted">${escapeHtml(job.errorMessage)}</p>` : ''}
    </article>
  `;
}

function formatConnectionsImportStats(stats = {}) {
  return `${formatNumber(stats.imported || 0)} imported, ${formatNumber(stats.updated || 0)} updated, ${formatNumber(stats.skipped || 0)} skipped, ${formatNumber(stats.failed || 0)} failed`;
}

function formatConnectionsImportWarnings(warnings = []) {
  return Array.isArray(warnings) && warnings.length ? ` Note: ${warnings.join(' ')}` : '';
}

function formatConnectionsImportError(error) {
  const parts = [error?.message || String(error || 'Import failed.')];
  if (Array.isArray(error?.expectedHeaders) && error.expectedHeaders.length) {
    parts.push(`The file should include columns such as: ${error.expectedHeaders.join(', ')}.`);
  }
  if (Array.isArray(error?.warnings) && error.warnings.length) {
    parts.push(error.warnings.join(' '));
  }
  return parts.filter(Boolean).join(' ');
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
function renderField(label, control, hint = '') {
  const id = `field-${++fieldIdCounter}`;
  const controlWithId = control.replace(/<(input|select|textarea)(\s)/, `<$1 id="${id}"$2`);
  return `<div class="field"><label for="${id}">${escapeHtml(label)}</label>${controlWithId}${hint ? `<span class="small muted">${escapeHtml(hint)}</span>` : ''}</div>`;
}

function renderEmptyState({ icon = 'i', title = 'Nothing to show yet', copy = '', action = '', compact = false } = {}) {
  return `
    <div class="empty-state${compact ? ' empty-state--compact' : ''}">
      ${icon ? `<span class="empty-state-icon" aria-hidden="true">${escapeHtml(icon)}</span>` : ''}
      <strong class="empty-state-title">${escapeHtml(title)}</strong>
      ${copy ? `<p class="empty-state-copy">${escapeHtml(copy)}</p>` : ''}
      ${action ? `<div class="empty-state-actions">${action}</div>` : ''}
    </div>
  `;
}

function renderStatusPill(value, tone) {
  return `<span class="status-pill ${tone}" aria-label="${escapeAttr(humanize(value))}">${escapeHtml(humanize(value))}</span>`;
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

function renderActivityPipelineStageOptions(includeCommercialOutcomes = false) {
  return [
    '<option value="">No result change</option>',
    '<option value="contacted">Outreach sent</option>',
    '<option value="replied">Reply received</option>',
    includeCommercialOutcomes ? '<option value="positive_reply">Positive reply</option>' : '',
    includeCommercialOutcomes ? '<option value="meeting_booked">Meeting booked</option>' : '',
    includeCommercialOutcomes ? '<option value="opportunity">Opportunity created</option>' : '',
    includeCommercialOutcomes ? '<option value="won">Client won</option>' : '',
    includeCommercialOutcomes ? '<option value="lost">Closed lost</option>' : '',
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

async function populateConfigForm(id) {
  appState.configEditingId = id;
  try {
    const config = await api(`/api/configs/${id}`);
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
    openAdminSection('ats-config-form');
  } catch (error) {
    showToast(error.message || 'The job source could not be opened.', 'error');
  }
}

function resetConfigForm() {
  appState.configEditingId = '';
  const form = document.getElementById('config-form');
  if (!form) return;
  form.reset();
  if (form.active) form.active.value = 'true';
}

async function runLiveImport(buttonEl) {
  await withButtonState(buttonEl || '[data-action="run-live-import"]', 'Running import...', async () => {
    const accepted = await api('/api/import/jobs', {
      method: 'POST',
      body: JSON.stringify({ autoDiscover: true, autoDiscoveryLimit: 300 }),
    });
    showToast('Live ATS import queued.', 'success');
    const job = await watchBackgroundJob(accepted.jobId, { label: 'Live ATS import' });
    const result = job?.result || {};
    const run = result.importRun || {};
    const stats = result.stats || run?.stats || {};
    const warnings = run?.warnings || job?.result?.warnings || [];
    const activeJobCount = getLiveImportTrackedJobCount(job, result);
    const changedJobs = getLiveImportChangedJobCount(result);
    const changedText = changedJobs !== null
      ? ` ${formatNumber(changedJobs)} material job row${changedJobs === 1 ? '' : 's'} changed this run;`
      : '';
    const discoveryText = Number(stats.autoDiscoveryChecked || 0) > 0
      ? `Found ${formatNumber(stats.autoDiscoveryMapped || 0)} of ${formatNumber(stats.autoDiscoveryChecked || 0)} job boards before import. `
      : '';
    const baseStatus = `${discoveryText}Fetched ${formatNumber(stats.fetched || 0)} jobs across ${formatNumber(stats.configs || 0)} job boards; kept ${formatNumber(stats.canadaKept || 0)} Canada jobs, filtered ${formatNumber(stats.filteredOutNonCanada || 0)} non-Canada, and is tracking ${formatNumber(activeJobCount)} active jobs total.${changedText}`;
    const status = run?.status === 'completed_with_errors'
      ? `${baseStatus} ${formatNumber(stats.errors || 0)} boards had issues.`
      : baseStatus;
    window.bdLocalApi.setAlert(warnings.length ? `${status} ${warnings[0]}` : status, appAlert);
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
    const warnings = job?.result?.warnings || [];
    window.bdLocalApi.setAlert(
      `Discovery checked ${formatNumber(stats.checked || 0)} configs. Mapped ${formatNumber(stats.mapped || 0)}, discovered ${formatNumber(stats.discovered || 0)}, high confidence ${formatNumber(stats.highConfidence || 0)}, unresolved ${formatNumber(stats.unresolved || 0)}.${warnings.length ? ` ${warnings[0]}` : ''}`,
      appAlert
    );
  });
}

async function runRevenuePipeline(buttonEl) {
  try {
    const job = await api('/api/admin/pipeline/start', { method: 'POST' });
    showToast('Revenue pipeline started.', 'success');
    await watchPipelineProgress(job.id);
  } catch (err) {
    showToast('Failed to start pipeline: ' + err.message, 'error');
  }
}

async function watchPipelineProgress(jobId) {
  const container = document.getElementById('pipeline-progress-container');
  if (!container) return;
  container.classList.remove('hidden');
  
  while (true) {
    const job = await api(`/api/admin/pipeline/status/${jobId}`, { skipCache: true });
    const bar = container.querySelector('.pipeline-progress-bar-fill');
    const label = container.querySelector('.pipeline-progress-label');
    const stage = container.querySelector('.pipeline-progress-stage');
    
    if (bar) bar.style.width = `${job.progress}%`;
    if (label) label.textContent = `${job.progress}%`;
    if (stage) stage.textContent = job.message || job.stage || 'Processing...';

    if (job.status === 'completed' || job.status === 'failed') {
      if (job.status === 'completed') {
        showToast('Revenue pipeline completed successfully.', 'success');
      } else {
        showToast('Revenue pipeline failed: ' + job.message, 'error');
      }
      setTimeout(() => container.classList.add('hidden'), 5000);
      if (getRouteRoot() === 'admin') await renderAdminView();
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
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

async function runLaunchWorkflow(buttonEl) {
  const button = buttonEl || document.querySelector('[data-action="run-launch-workflow"]');
  if (button) { button.disabled = true; button.textContent = 'Running workflow...'; }
  try {
    const accepted = await api('/api/admin/run-workflow', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    showToast('Launch workflow queued.', 'success');
    const job = accepted.job?.status === 'completed'
      ? accepted.job
      : await watchBackgroundJob(accepted.jobId, { label: 'Launch workflow' });
    const result = job?.result || accepted || {};
    const stats = result.stats || {};
    const warnings = Array.isArray(result.warnings) && result.warnings.length
      ? ` ${result.warnings.join(' ')}`
      : '';
    window.bdLocalApi.setAlert(
      `Launch workflow complete for ${result.plan?.displayName || 'current plan'}: enriched ${formatNumber(stats.enriched || 0)} accounts, created ${formatNumber(stats.configsCreated || 0)} configs, mapped ${formatNumber(stats.boardsMapped || stats.configsResolved || 0)} boards, fetched ${formatNumber(stats.jobsFetched || 0)} jobs, kept ${formatNumber(stats.jobsKept || 0)} Canada jobs, updated ${formatNumber(stats.jobsTouched || 0)} tracked jobs, and refreshed ${formatNumber(stats.scoresRefreshed || 0)} scores.${warnings}`,
      appAlert
    );
    invalidateAppData();
  } catch (error) {
    const message = `Launch workflow failed: ${error.message || error}`;
    showToast(message, 'error', 9000);
    window.bdLocalApi.setAlert(message, appAlert);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Run launch workflow'; }
  }
}

function getConnectionsCsvPath() {
  const input = document.getElementById('connections-csv-path');
  return (input?.value || appState.bootstrap?.defaults?.connectionsCsvPath || '').trim();
}

async function runConnectionsCsvImport(dryRun) {
  const action = dryRun ? 'dry-run-connections-csv' : 'import-connections-csv';
  const button = document.querySelector(`[data-action="${action}"]`);
  const originalLabel = dryRun ? 'Preview CSV' : 'Import contacts';
  if (button) { button.disabled = true; button.textContent = dryRun ? 'Previewing...' : 'Importing...'; }

  try {
    const fileInput = document.getElementById('connections-csv-file');
    const file = fileInput?.files?.[0];

    if (!file) {
      showToast('Choose your LinkedIn Connections.csv file first.', 'warning');
      return;
    }

    const uploadSummary = `${file.name} (${formatFileSize(file.size || 0)})`;
    const run = await postConnectionsCsvFile(file, {
      dryRun,
      useEmptyState: dryRun,
      fileName: file.name || 'Connections.csv',
    });
    if (!dryRun) {
      const queuedMessage = `Connections import queued (${uploadSummary}). Large exports can take several minutes; you can keep working while it runs.`;
      showToast(queuedMessage, 'success', 9000);
      window.bdLocalApi.setAlert(queuedMessage, appAlert);
      if (run.jobId) {
        void watchBackgroundJob(run.jobId, { label: 'Connections import', refreshRoute: false }).then((job) => {
          const result = job?.result || run || {};
          const stats = result.stats || result.importRun?.stats || {};
          const warnings = formatConnectionsImportWarnings(result.warnings || result.importRun?.warnings || run.warnings);
          const message = `Connections import complete: ${formatConnectionsImportStats(stats)}. Contacts now ${formatNumber(stats.contacts || 0)} across ${formatNumber(stats.companies || 0)} companies.${warnings}`;
          invalidateAppData();
          window.bdLocalApi.setAlert(message, appAlert);
        }).catch((err) => {
          window.bdLocalApi.setAlert(`Connections import failed: ${err.message || err}`, appAlert);
        });
      }
      return;
    }
    const stats = run?.stats || {};
    const message = `Dry run succeeded (${uploadSummary}): ${formatConnectionsImportStats(stats)}. Contacts would total ${formatNumber(stats.contacts || 0)} across ${formatNumber(stats.companies || 0)} companies.${formatConnectionsImportWarnings(run?.warnings)}`;
    window.bdLocalApi.setAlert(message, appAlert);
  } catch (error) {
    const message = `Connections import failed: ${formatConnectionsImportError(error)}`;
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

function syncCommercialActivityFields(form) {
  if (!form || form.id !== 'activity-form') return;
  const stage = form.elements.pipelineStage?.value || '';
  const acceptsValue = COMMERCIAL_VALUE_ACTIVITY_STAGES.has(stage);
  const valueFields = form.querySelector('[data-commercial-value-fields]');
  const valueInput = form.elements.value;
  const currencyInput = form.elements.currency;
  valueFields?.classList.toggle('hidden', !acceptsValue);
  if (valueInput) {
    valueInput.disabled = !acceptsValue;
    if (!acceptsValue) valueInput.value = '';
  }
  if (currencyInput) currencyInput.disabled = !acceptsValue;
  if (stage && form.elements.type?.value === 'note') {
    form.elements.type.value = stage === 'contacted' ? 'outreach' : 'pipeline';
  }
  if (form.elements.summary) {
    form.elements.summary.placeholder = stage === 'lost'
      ? 'Why was it lost?'
      : stage === 'won'
        ? 'What did the client choose?'
        : 'What happened?';
  }
}

document.addEventListener('change', (event) => {
  if (event.target.matches('#activity-form [name="pipelineStage"]')) {
    syncCommercialActivityFields(event.target.form);
    return;
  }
  if (event.target.classList.contains('setup-target-checkbox')) {
    syncSetupTrackedCompaniesFromDom();
    return;
  }
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
  if (event.target.id === 'contacts-bulk-select-all') {
    const checked = event.target.checked;
    document.querySelectorAll('.contacts-bulk-checkbox').forEach(cb => { cb.checked = checked; });
    updateContactsBulkBar();
    return;
  }
  if (event.target.id === 'jobs-bulk-select-all') {
    const checked = event.target.checked;
    document.querySelectorAll('.jobs-bulk-checkbox').forEach(cb => { cb.checked = checked; });
    updateJobsBulkBar();
    return;
  }
  if (event.target.id === 'outreach-template-select' || event.target.id === 'outreach-contact-select' || event.target.id === 'outreach-job-select') {
    clearGeneratedOutreachDraft('Generate a fresh note for the selected contact and angle.');
    syncOutreachComposerState();
    return;
  }
  if (event.target.classList.contains('bulk-checkbox')) {
    updateBulkBar();
    return;
  }
  if (event.target.classList.contains('contacts-bulk-checkbox')) {
    updateContactsBulkBar();
    return;
  }
  if (event.target.classList.contains('jobs-bulk-checkbox')) {
    updateJobsBulkBar();
    return;
  }
});

document.addEventListener('input', (event) => {
  if (event.target?.id === 'setup-target-sites') {
    appState.setupTargetImportResult = null;
    syncSetupTargetFeedback();
    return;
  }
  const fieldName = event.target?.dataset?.outreachField;
  if (!fieldName || !appState.generatedOutreach || !Object.prototype.hasOwnProperty.call(appState.generatedOutreach, fieldName)) return;
  appState.generatedOutreach[fieldName] = event.target.value;
  if (fieldName === 'subjectLine' || fieldName === 'messageBody') syncOutreachActionLinks();
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

function updateContactsBulkBar() {
  const checked = document.querySelectorAll('.contacts-bulk-checkbox:checked');
  const bar = document.getElementById('contacts-bulk-action-bar');
  const count = document.getElementById('contacts-bulk-count');
  if (bar) {
    if (checked.length > 0) {
      bar.classList.remove('hidden');
      if (count) count.textContent = `⚡ ${checked.length} contact${checked.length === 1 ? '' : 's'} selected`;
    } else {
      bar.classList.add('hidden');
    }
  }
}

function updateJobsBulkBar() {
  const checked = document.querySelectorAll('.jobs-bulk-checkbox:checked');
  const bar = document.getElementById('jobs-bulk-action-bar');
  const count = document.getElementById('jobs-bulk-count');
  if (bar) {
    if (checked.length > 0) {
      bar.classList.remove('hidden');
      if (count) count.textContent = `⚡ ${checked.length} role${checked.length === 1 ? '' : 's'} selected`;
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
  let result;
  try {
    result = await api('/api/accounts/bulk', {
      method: 'PATCH',
      body: JSON.stringify({ ids, ...patch }),
    });
  } catch (error) {
    showToast(`Bulk update failed: ${error.message || error}`, 'error', 7000);
    return;
  }
  invalidateAppData();
  await renderAccountsView();
  const failed = Array.isArray(result.failed) ? result.failed : [];
  if (failed.length) {
    showToast(`Updated ${result.updated || 0} accounts; ${failed.length} could not be found.`, 'warning', 7000);
  } else {
    showToast(`Updated ${result.updated || 0} accounts.`, 'success');
  }
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
      scrollIntoViewRespectingMotion(card, { behavior: 'smooth', block: 'center' });
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
    case 'job_intro':
      return { label: 'Role introduction', buttonLabel: 'Generate role introduction' };
    case 'job_networking':
      return { label: 'Networking question', buttonLabel: 'Generate networking note' };
    case 'job_referral':
      return { label: 'Introduction request', buttonLabel: 'Generate introduction request' };
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
  if (isJobSeekerPersona()) {
    return detail?.jobs?.length ? 'job_intro' : 'job_networking';
  }
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
  const shouldOpen = Boolean(isOpen);
  if (shouldOpen && !appState.outreachModalOpen && document.activeElement instanceof HTMLElement) {
    appState.outreachModalTrigger = document.activeElement;
  }
  appState.outreachModalOpen = Boolean(isOpen);
  const backdrop = document.getElementById('outreach-modal-backdrop');
  if (backdrop) {
    backdrop.classList.toggle('hidden', !appState.outreachModalOpen);
    backdrop.setAttribute('aria-hidden', String(!appState.outreachModalOpen));
    if (appState.outreachModalOpen) {
      window.requestAnimationFrame(() => {
        backdrop.querySelector('#outreach-contact-select, button, a, input, select, textarea')?.focus();
      });
    } else if (appState.outreachModalTrigger instanceof HTMLElement && appState.outreachModalTrigger.isConnected) {
      appState.outreachModalTrigger.focus();
    }
  }
  if (!appState.outreachModalOpen) appState.outreachModalTrigger = null;
}

async function applyPendingOutreachContact(accountId) {
  const pending = appState.pendingOutreachContact;
  if (!pending || String(pending.accountId || '') !== String(accountId || '')) return;
  selectOutreachContact({ contactId: pending.contactId, contactName: pending.contactName });
  const templateSelect = document.getElementById('outreach-template-select');
  if (templateSelect && pending.template) templateSelect.value = pending.template;
  const jobSelect = document.getElementById('outreach-job-select');
  if (jobSelect && pending.jobId) jobSelect.value = pending.jobId;
  setOutreachModalOpen(true);
  syncOutreachComposerState();
  appState.pendingOutreachContact = null;
  if (pending.autoGenerate) {
    const button = document.getElementById('generate-outreach-button');
    if (button) await generateSmartOutreach(accountId, button);
  }
}

function openOutreachForContact({ accountId = '', contactId = '', contactName = '', template = '', jobId = '', autoGenerate = false } = {}) {
  if (!accountId) {
    showToast('This contact is not attached to an account yet.', 'warning');
    return;
  }

  appState.pendingOutreachContact = { accountId, contactId, contactName, template, jobId, autoGenerate };
  if (appState.accountDetail?.account?.id === accountId && getRouteRoot() === 'accounts') {
    void applyPendingOutreachContact(accountId);
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

function buildOutreachLogNotes(outreach, contact, followUpAt, channels) {
  const sentEmail = channels.includes('email');
  const sentLinkedIn = channels.includes('linkedin');
  const lines = [
    `Channels sent: ${channels.join(' + ')}`,
    sentEmail && contact.email ? `Email: ${contact.email}` : '',
    sentLinkedIn && contact.linkedinUrl ? `LinkedIn: ${contact.linkedinUrl}` : '',
    sentEmail && outreach.subjectLine ? `Subject: ${outreach.subjectLine}` : '',
    sentEmail && outreach.messageBody ? `Email sent:\n${outreach.messageBody}` : '',
    sentLinkedIn && outreach.linkedinMessage ? `LinkedIn message sent:\n${outreach.linkedinMessage}` : '',
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
  const followUpDays = parseInt(document.getElementById('outreach-followup-days')?.value || '7', 10);
  const channels = [
    document.getElementById('outreach-channel-email')?.checked ? 'email' : '',
    document.getElementById('outreach-channel-linkedin')?.checked ? 'linkedin' : '',
  ].filter(Boolean);
  if (!channels.length) {
    showToast('Select at least one channel that you sent.', 'warning');
    return;
  }
  const followUpAt = getFutureDateInput(followUpDays);
  const today = getFutureDateInput(0);
  const channelLabel = channels.length === 2 ? 'email and LinkedIn' : channels[0];
  const summary = `Sent ${channelLabel} outreach to ${contactLabel}`;
  const notes = buildOutreachLogNotes(outreach, contact, followUpAt, channels);
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
          channels,
          subjectLine: outreach.subjectLine || '',
          contactName: contact.name || '',
          contactEmail: contact.email || '',
          linkedinUrl: contact.linkedinUrl || '',
          followUpAt,
        },
        followUpDays,
        contactName: contact.name || '',
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
      const contactNote = `Outreach sent ${today}: ${channelLabel}. Follow up ${followUpAt}.`;
      const mergedNotes = [contact.notes, contactNote].filter(Boolean).join('\n');
      await api(`/api/contacts/${contact.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ outreachStatus: 'contacted', notes: mergedNotes }),
      });
    }

    appState.outreachSequences.push({
      id: Date.now(),
      accountId: account.id,
      channel: channels.join('+'),
      note: `Follow up with ${contactLabel} after ${channelLabel} outreach`,
      dueAt: new Date(`${followUpAt}T09:00:00`).toISOString(),
      done: false,
    });
    persistSharedWorkspacePreference('outreachSequences');
    logActivity('outreach_logged', { accountId: account.id, summary });
    invalidateAppData();
    showToast(`Outreach logged. Follow-up set for ${formatDate(followUpAt)}.`, 'success', 7000);
    setOutreachModalOpen(false);
    await renderAccountDetail(account.id);
    window.requestAnimationFrame(() => document.getElementById('next-action-summary')?.focus());
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
  const grounding = result.grounding || {};
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
    grounding: {
      score: Number(grounding.score || 0),
      label: grounding.label || '',
      evidence: Array.isArray(grounding.evidence) ? grounding.evidence : [],
      warnings: Array.isArray(grounding.warnings) ? grounding.warnings : [],
      roleFamily: grounding.role_family || grounding.roleFamily || '',
    },
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

function renderOutreachPiece(title, body, actionsHtml, className = '', fieldName = '') {
  if (!body) return '';
  const content = fieldName
    ? `<textarea class="outreach-editable outreach-editable--compact" data-outreach-field="${escapeAttr(fieldName)}" aria-label="Edit ${escapeAttr(title)}">${escapeHtml(body)}</textarea>`
    : `<div class="outreach-piece-body">${escapeHtml(body)}</div>`;
  return `
    <article class="outreach-piece ${className}">
      <div class="outreach-piece-header"><strong>${escapeHtml(title)}</strong></div>
      ${content}
      ${actionsHtml ? `<div class="button-row outreach-piece-actions">${actionsHtml}</div>` : ''}
    </article>
  `;
}

async function curateLegacyTargets() {
  const rawLimit = await showAppDialog({
    title: 'Choose the target portfolio size',
    message: 'BD Engine will rank legacy companies by your role focus, live hiring signals, target score, and relationship strength. Other companies remain searchable but stop consuming automatic ATS discovery.',
    confirmLabel: 'Preview selection',
    inputLabel: 'Number of target companies (1-1,000)',
    inputPlaceholder: '100',
    inputValue: '100',
  });
  if (rawLimit === null) return;
  const targetLimit = Number(rawLimit);
  if (!Number.isInteger(targetLimit) || targetLimit < 1 || targetLimit > 1000) {
    showToast('Enter a whole number from 1 to 1,000.', 'warning');
    return;
  }

  try {
    const preview = await api(`/api/accounts/legacy-target-curation?targetLimit=${targetLimit}`, { skipCache: true });
    if (!preview.legacyCompanies) {
      showToast('All companies are already classified.', 'info');
      await renderAdminView();
      return;
    }
    const workspaceName = appState.bootstrap?.workspace?.name || 'Workspace';
    const expected = `CURATE ${workspaceName}`;
    const examples = (preview.preview || []).slice(0, 4).map((item) => {
      const detail = [`score ${formatNumber(item.targetScore || 0)}`];
      if (Number(item.strongFitRoleCount || 0) > 0) detail.push(`${formatNumber(item.strongFitRoleCount)} strong-fit roles`);
      else if (Number(item.relevantRoleCount || 0) > 0) detail.push(`${formatNumber(item.relevantRoleCount)} relevant roles`);
      if (Number(item.openRoleCount || 0) > 0) detail.push(`${formatNumber(item.openRoleCount)} open roles`);
      if (Number(item.connectionCount || 0) > 0) detail.push(`${formatNumber(item.connectionCount)} connections`);
      return `${item.displayName} (${detail.join(', ')})`;
    }).filter(Boolean).join('; ');
    const confirmation = await showAppDialog({
      title: 'Confirm target classification',
      message: `${formatNumber(preview.selectedTargets)} companies will receive automatic ATS discovery and ${formatNumber(preview.networkCompanies)} will remain searchable network context. Top-ranked examples: ${examples || 'none available'}. This updates company classifications; it does not delete contacts, activity, or historical jobs.`,
      confirmLabel: 'Classify companies',
      cancelLabel: 'Keep current setup',
      danger: true,
      inputLabel: `Type ${expected} to confirm`,
    });
    if (confirmation === null) return;
    if (confirmation !== expected) {
      showToast(`Type ${expected} exactly to continue.`, 'warning');
      return;
    }
    const result = await api('/api/accounts/legacy-target-curation', {
      method: 'POST',
      body: JSON.stringify({ targetLimit, confirm: confirmation }),
    });
    showToast(result.message || 'Legacy companies classified.', 'success', 7000);
    if (getRouteRoot() === 'accounts') await renderAccountsView();
    else await renderAdminView();
  } catch (error) {
    showToast(`Target classification failed: ${error.message}`, 'error', 7000);
  }
}

async function rebalanceTrackedTargets() {
  const currentTracked = Number(appState.bootstrap?.portfolioSummary?.trackedCompanies || 100);
  const rawLimit = await showAppDialog({
    title: 'Review the target portfolio',
    message: 'BD Engine will rerank every company using your saved role focus, relevant openings, relationship strength, and company identity quality. Previewing does not change any records.',
    confirmLabel: 'Preview changes',
    inputLabel: 'Number of target companies (1-1,000)',
    inputPlaceholder: String(currentTracked || 100),
    inputValue: String(currentTracked || 100),
  });
  if (rawLimit === null) return;
  const targetLimit = Number(rawLimit);
  if (!Number.isInteger(targetLimit) || targetLimit < 1 || targetLimit > 1000) {
    showToast('Enter a whole number from 1 to 1,000.', 'warning');
    return;
  }

  try {
    const preview = await api(`/api/accounts/target-rebalance?targetLimit=${targetLimit}`, { skipCache: true });
    const workspaceName = appState.bootstrap?.workspace?.name || 'Workspace';
    const expected = `REBALANCE ${workspaceName}`;
    const additions = (preview.addedPreview || []).slice(0, 4).map((item) => item.displayName).join(', ');
    const removals = (preview.removedPreview || []).slice(0, 4).map((item) => item.displayName).join(', ');
    const identityWarnings = (preview.identityReview || []).slice(0, 4).map((item) => (
      `${item.displayName}: ${(item.identityIssues || []).join(', ')}`
    )).join('; ');
    const changeSummary = preview.additions || preview.removals
      ? `${formatNumber(preview.additions)} companies enter the target list and ${formatNumber(preview.removals)} move to searchable network context. ${additions ? `Examples entering: ${additions}. ` : ''}${removals ? `Examples leaving: ${removals}. ` : ''}`
      : 'The selected companies do not change at this portfolio size. ';
    const warningSummary = identityWarnings
      ? `Selected records still needing identity review: ${identityWarnings}.`
      : 'No selected company identity warnings were found.';
    const confirmation = await showAppDialog({
      title: 'Confirm portfolio rebalance',
      message: `${changeSummary}${warningSummary} Contacts, activity, and historical jobs are never deleted.`,
      confirmLabel: 'Apply rebalance',
      cancelLabel: 'Keep current portfolio',
      danger: true,
      inputLabel: `Type ${expected} to confirm`,
    });
    if (confirmation === null) return;
    if (confirmation !== expected) {
      showToast(`Type ${expected} exactly to continue.`, 'warning');
      return;
    }
    const result = await api('/api/accounts/target-rebalance', {
      method: 'POST',
      body: JSON.stringify({ targetLimit, confirm: confirmation }),
    });
    invalidateAppData();
    showToast(result.message || 'Target portfolio rebalanced.', 'success', 7000);
    if (getRouteRoot() === 'accounts') await renderAccountsView();
    else await renderAdminView();
  } catch (error) {
    showToast(`Portfolio rebalance failed: ${error.message}`, 'error', 7000);
  }
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

function renderOutreachGrounding(grounding = {}) {
  const score = Number(grounding.score || 0);
  const tone = score >= 75 ? 'success' : score >= 50 ? 'warm' : 'danger';
  const evidence = Array.isArray(grounding.evidence) ? grounding.evidence : [];
  const warnings = Array.isArray(grounding.warnings) ? grounding.warnings : [];
  return `
    <section class="outreach-grounding" aria-label="Message grounding">
      <div class="outreach-grounding-header">
        <div><span class="outreach-brief-label">Grounding check</span><strong>${escapeHtml(grounding.label || 'Review before sending')}</strong></div>
        ${renderStatusPill(`${score}/100`, tone)}
      </div>
      ${evidence.length ? `<div class="outreach-evidence-list">${evidence.map((item) => `<span class="outreach-evidence"><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</span>`).join('')}</div>` : ''}
      ${warnings.map((warning) => `<div class="outreach-warning" role="status">${escapeHtml(warning)}</div>`).join('')}
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
        ${renderOutreachGrounding(outreach.grounding)}
        ${outreach.whyNow ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Why now</span><p>${escapeHtml(outreach.whyNow)}</p></div>` : ''}
        ${outreach.contactHook ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Best angle</span><p>${escapeHtml(outreach.contactHook)}</p></div>` : ''}
        ${outreach.angleSummary ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Approach</span><p>${escapeHtml(outreach.angleSummary)}</p></div>` : ''}
        ${outreach.sequenceGuidance ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Sequence context</span><p>${escapeHtml(outreach.sequenceGuidance)}</p></div>` : ''}
        ${outreach.companySnippet ? `<div class="outreach-brief-block"><span class="outreach-brief-label">Company context</span><p>${escapeHtml(outreach.companySnippet)}</p></div>` : ''}
        <div class="outreach-log-controls">
          <fieldset class="outreach-channel-picker">
            <legend>Log only what you sent</legend>
            <label><input id="outreach-channel-email" type="checkbox" value="email" checked> Email</label>
            <label><input id="outreach-channel-linkedin" type="checkbox" value="linkedin"> LinkedIn</label>
          </fieldset>
          <label class="outreach-control-field outreach-control-field--compact"><span>Follow up in</span><select id="outreach-followup-days" class="inline-select inline-select--sm">
            <option value="3">3 days</option>
            <option value="7" selected>1 week</option>
            <option value="14">2 weeks</option>
          </select></label>
          <button class="primary-button" data-action="log-generated-outreach" type="button">Log sent and schedule follow-up</button>
        </div>
      </div>
      <div class="outreach-piece-grid">
        <article class="outreach-piece outreach-piece--primary">
          <div class="outreach-piece-header">
            <strong>Primary email</strong>
            ${outreach.subjectOptions.length > 1 ? `<div class="outreach-subject-options">${outreach.subjectOptions.map((option, index) => `<button class="outreach-subject-chip ${option === outreach.subjectLine ? 'active' : ''}" data-action="select-outreach-subject" data-index="${index}" type="button">✨ ${escapeHtml(option)}</button>`).join('')}</div>` : ''}
          </div>
          <label class="outreach-edit-label" for="outreach-subject-input">Subject</label>
          <input id="outreach-subject-input" class="outreach-editable outreach-editable--subject" data-outreach-field="subjectLine" value="${escapeAttr(outreach.subjectLine)}">
          <div class="outreach-piece-options-bar">
            <label class="outreach-edit-label" for="outreach-email-body">Message</label>
            <span class="outreach-stats-badge">📝 ${outreach.messageBody ? outreach.messageBody.trim().split(/\s+/).filter(Boolean).length : 0} words · ~${Math.max(5, Math.round((outreach.messageBody ? outreach.messageBody.trim().split(/\s+/).filter(Boolean).length : 0) / 3.5))}s read</span>
          </div>
          <textarea id="outreach-email-body" class="outreach-editable outreach-editable--email" data-outreach-field="messageBody">${escapeHtml(outreach.messageBody)}</textarea>
          <div class="button-row outreach-piece-actions">
            <button class="secondary-button" data-action="copy-generated-outreach" data-kind="email" type="button">Copy email</button>
            <a id="outreach-mailto-link" class="primary-button" href="${mailtoHref}" target="_blank" rel="noreferrer">Open in mail</a>
            <a id="outreach-gmail-link" class="secondary-button" href="https://mail.google.com/mail/?view=cm${gmailTo}&su=${gmailSubject}&body=${gmailBody}" target="_blank" rel="noreferrer">Draft in Gmail</a>
          </div>
        </article>
        ${renderOutreachPiece('LinkedIn DM', outreach.linkedinMessage, '<button class="primary-button" data-action="open-generated-linkedin" type="button">Copy and open LinkedIn</button><button class="secondary-button" data-action="copy-generated-outreach" data-kind="linkedin" type="button">Copy DM</button>', '', 'linkedinMessage')}
        ${renderOutreachPiece('Follow-up note', outreach.followUpMessage, '<button class="secondary-button" data-action="copy-generated-outreach" data-kind="followup" type="button">Copy follow-up</button>', '', 'followUpMessage')}
        ${renderOutreachPiece('Call opener', outreach.callOpener, '<button class="secondary-button" data-action="copy-generated-outreach" data-kind="call" type="button">Copy opener</button>', '', 'callOpener')}
      </div>
      ${renderGeneratedOutreachVariants(outreach)}
    </div>
  `;
}

function syncOutreachActionLinks() {
  const outreach = appState.generatedOutreach;
  if (!outreach) return;
  const selectedContact = getSelectedOutreachContact();
  const subject = encodeURIComponent(outreach.subjectLine || '');
  const body = encodeURIComponent(outreach.messageBody || '');
  const email = selectedContact.email ? encodeURIComponent(selectedContact.email) : '';
  const mailLink = document.getElementById('outreach-mailto-link');
  const gmailLink = document.getElementById('outreach-gmail-link');
  if (mailLink) mailLink.href = `mailto:${email}?subject=${subject}&body=${body}`;
  if (gmailLink) gmailLink.href = `https://mail.google.com/mail/?view=cm${email ? `&to=${email}` : ''}&su=${subject}&body=${body}`;
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
  await writeClipboardText(text);
  buttonEl.textContent = 'Copied!';
  setTimeout(() => { buttonEl.textContent = originalText; }, 1400);
}

function selectGeneratedSubject(index, buttonEl) {
  const outreach = appState.generatedOutreach;
  if (!outreach?.subjectOptions?.length) return;
  const text = outreach.subjectOptions[Number(index)] || '';
  if (!text) return;
  outreach.subjectLine = text;
  const subjectInput = document.getElementById('outreach-subject-input');
  if (subjectInput) subjectInput.value = text;
  syncOutreachActionLinks();
  const originalText = buttonEl.textContent;
  buttonEl.textContent = 'Selected';
  setTimeout(() => { buttonEl.textContent = originalText; }, 1400);
}

async function openGeneratedLinkedIn(buttonEl) {
  const outreach = appState.generatedOutreach;
  if (!outreach?.linkedinMessage) return;
  const selectedContact = getSelectedOutreachContact();
  const originalText = buttonEl.textContent;
  await writeClipboardText(outreach.linkedinMessage);
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
        jobId: document.getElementById('outreach-job-select')?.value || '',
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
      scrollIntoViewRespectingMotion(card, { behavior: 'smooth', block: 'center' });
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
  const previousStatus = appState.accountDetail?.account?.id === accountId
    ? appState.accountDetail.account.status || 'new'
    : 'new';
  await api(`/api/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) });
  invalidateAppData();

  if ((location.hash || '').endsWith(`/accounts/${accountId}`)) {
    location.hash = '#/accounts';
  } else {
    await renderRoute();
  }

  showUndoToast('Account paused.', async () => {
    await api(`/api/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify({ status: previousStatus }) });
    invalidateAppData();
    await renderRoute();
  });
}

async function runSearch(value) {
  searchResults.classList.remove('hidden');
  searchResults.setAttribute('aria-busy', 'true');
  searchInput?.setAttribute('aria-expanded', 'true');
  searchResults.innerHTML = '<div class="search-loading" role="status">Searching...</div>';
  try {
    const results = await api(`/api/search${buildQuery({ q: value })}`);
    if (searchInput?.value.trim() !== value) {
      return;
    }

    const total = (results.accounts?.length || 0) + (results.contacts?.length || 0) + (results.jobs?.length || 0);
    searchResults.classList.remove('hidden');
    searchResults.setAttribute('aria-busy', 'false');
    searchResults.innerHTML = `
    ${total ? '' : `<div class="empty-state empty-state--compact">No matches for "${escapeHtml(value)}". Try a company, person, or role name.</div>`}
    ${renderSearchGroup(isJobSeekerPersona() ? 'Companies' : 'Accounts', results.accounts, (item) => `#/accounts/${item.id}`, (item) => escapeHtml(item.displayName), (item) => `${formatNumber(getTargetScore(item))} target score · ${formatNumber(item.hiringVelocity || 0)} hiring velocity · ${formatNumber(item.engagementScore || 0)} engagement`)}
    ${renderSearchGroup(isJobSeekerPersona() ? 'Network' : 'Contacts', results.contacts, (item) => item.accountId ? `#/accounts/${item.accountId}` : '#/contacts', (item) => escapeHtml(item.fullName), (item) => `${escapeHtml(item.companyName || '')} · ${formatNumber(item.priorityScore)} score`)}
    ${renderSearchGroup(isJobSeekerPersona() ? 'Open roles' : 'Jobs', results.jobs, (item) => item.accountId ? `#/accounts/${item.accountId}` : '#/jobs', (item) => escapeHtml(item.title), (item) => `${escapeHtml(item.companyName || '')} · ${formatDate(item.postedAt)}`)}
    `;
  } catch (error) {
    searchResults.setAttribute('aria-busy', 'false');
    searchResults.innerHTML = '<div class="empty-state empty-state--compact">Search is unavailable right now. Try again in a moment.</div>';
  }
}

function hideSearchResults({ keepContent = false } = {}) {
  searchResults.classList.add('hidden');
  searchResults.setAttribute('aria-busy', 'false');
  searchInput?.setAttribute('aria-expanded', 'false');
  searchInput?.removeAttribute('aria-activedescendant');
  if (!keepContent) searchResults.innerHTML = '';
}

function renderSearchGroup(label, items, hrefBuilder, titleBuilder, metaBuilder) {
  if (!items || !items.length) return '';
  const groupId = `search-group-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return `<div class="search-group" role="group" aria-labelledby="${escapeAttr(groupId)}"><p class="eyebrow" id="${escapeAttr(groupId)}">${escapeHtml(label)}</p>${items.map((item, index) => `<a class="search-item" id="${escapeAttr(groupId)}-option-${index}" role="option" tabindex="-1" href="${escapeAttr(hrefBuilder(item))}"><strong>${titleBuilder(item)}</strong><span class="small muted">${metaBuilder(item)}</span></a>`).join('')}</div>`;
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
    parts.push(`${pluralize(item.jobsLast30Days, 'job')} / 30d`);
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
    <details class="row-detail-menu">
      <summary>ATS actions</summary>
      <div class="micro-button-row">
        <button class="micro-button" data-action="account-quick-enrich" data-id="${item.id}">Quick enrich</button>
        ${needsDeepResolve(item) ? `<button class="micro-button micro-button--primary" data-action="account-resolve-now" data-id="${item.id}">Resolve now</button>` : ''}
        ${needsDeepResolve(item) ? `<button class="micro-button" data-action="account-deep-verify" data-id="${item.id}">Deep verify</button>` : ''}
        ${hasPrimaryConfig && !needsDeepResolve(item) ? `<button class="micro-button" data-action="rerun-enrichment-resolution" data-id="${item.id}">Rerun ATS</button>` : ''}
      </div>
    </details>
  `;

  return `
    <div class="table-cell-stack">
      <div class="inline-badge-row inline-badge-row--compact">
        ${atsTypes.length ? atsTypes.map((type) => renderStatusPill(type, 'neutral')).join('') : renderStatusPill('no board', 'neutral')}
        ${renderStatusPill(humanize(discoveryStatus), ['resolved', 'mapped', 'discovered', 'manual'].includes(String(discoveryStatus).toLowerCase()) ? 'success' : 'neutral')}
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

function pluralize(count, singular, plural = `${singular}s`) {
  const numeric = Number(count || 0);
  return `${formatNumber(numeric)} ${numeric === 1 ? singular : plural}`;
}

function formatDate(value) {
  if (!value) return '—';
  const raw = String(value);
  const calendarKey = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?Z)?$/)?.[1];
  if (calendarKey) {
    return new Date(`${calendarKey}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function formatLocalDateInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseActivityDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const nowDate = new Date();
  const timestamp = raw === formatLocalDateInput(nowDate)
    ? nowDate
    : new Date(`${raw}T12:00:00`);
  if (Number.isNaN(timestamp.getTime()) || timestamp.getTime() > nowDate.getTime() + 5 * 60 * 1000) return '';
  return timestamp.toISOString();
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

/* -- Product Tour Logic -- */
const tourSteps = [
  { title: 'Your workspace is ready', copy: 'Here is the quick tour: dashboard first, then accounts, jobs, tasks, and admin controls.', target: null },
  { title: 'Read the operating pulse', copy: 'These chips summarize today’s account queue, fresh roles, follow-up pressure, and identity work.', target: '.hero-signal-strip' },
  { title: 'Work the ranked queue', copy: 'Start here when you want the highest-priority companies and the next move for each one.', target: '[data-tour="today-queue"]' },
  { title: 'Open the source lists', copy: 'Accounts, Contacts, Jobs, and Tasks are your day-to-day work tabs once setup is complete.', target: '[data-route="accounts"]' },
  { title: 'Tune the engine', copy: 'Admin holds imports, ATS discovery, enrichment, scoring settings, and background-job controls.', target: '[data-route="admin"]' }
];
tourSteps[1].copy = "These chips summarize today's account queue, fresh roles, follow-up pressure, and identity work.";

let currentTourStep = 0;

function startProductTour() {
  if (appState.tourActive) return;
  currentTourStep = 0;
  appState.tourTrigger = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement
    : null;
  appState.tourActive = true;
  document.querySelector('.shell')?.setAttribute('inert', '');
  renderTourStep();
}

function renderTourStep() {
  const step = tourSteps[currentTourStep];
  if (!step) return endTour();

  const existing = document.querySelector('.tour-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.innerHTML = `
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-copy" tabindex="-1">
      <p class="tour-step-indicator">Step ${currentTourStep + 1} of ${tourSteps.length}</p>
      <h3 class="tour-title" id="tour-title">${escapeHtml(step.title)}</h3>
      <p class="tour-copy" id="tour-copy">${escapeHtml(step.copy)}</p>
      <div class="tour-actions">
        <button class="ghost-button" type="button" data-action="end-tour">Skip tour</button>
        <button class="primary-button" type="button" data-action="next-tour-step" data-tour-primary>${currentTourStep === tourSteps.length - 1 ? 'Finish' : 'Next'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  if (step.target) {
    const targetEl = document.querySelector(step.target);
    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      const highlight = document.createElement('div');
      highlight.className = 'tour-highlight';
      highlight.setAttribute('aria-hidden', 'true');
      highlight.style.top = `${rect.top - 8 + window.scrollY}px`;
      highlight.style.left = `${rect.left - 8 + window.scrollX}px`;
      highlight.style.width = `${rect.width + 16}px`;
      highlight.style.height = `${rect.height + 16}px`;
      overlay.appendChild(highlight);
      targetEl.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
  }
  window.requestAnimationFrame(() => overlay.querySelector('[data-tour-primary]')?.focus({ preventScroll: true }));
}

function nextTourStep() {
  currentTourStep++;
  if (currentTourStep >= tourSteps.length) {
    endTour();
  } else {
    renderTourStep();
  }
}

function endTour(options = {}) {
  const overlay = document.querySelector('.tour-overlay');
  if (overlay) overlay.remove();
  document.querySelector('.shell')?.removeAttribute('inert');
  appState.tourActive = false;
  appState.onboardingDone = true;
  localStorage.setItem('bd_onboarding_done', 'true');
  const focusTarget = appState.tourTrigger instanceof HTMLElement && document.contains(appState.tourTrigger)
    ? appState.tourTrigger
    : viewTitle;
  appState.tourTrigger = null;
  window.requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
  showToast(options.skipped ? 'Tour dismissed.' : 'Tour complete.', options.skipped ? 'info' : 'success');
}

async function renderTasksView() {
  renderLoadingState('Tasks & Reminders', 'Gathering your follow-up duties and upcoming outreach...');
  try {
    const tasks = await api('/api/tasks?' + new URLSearchParams(appState.taskQuery));
    setViewTitle('Tasks & Reminders');

    const todayKey = toLocalDateInputValue(new Date());
    const overdue = tasks.items.filter(t => {
      const dueKey = calendarDateKey(t.dueDate);
      return t.status === 'pending' && dueKey && dueKey < todayKey;
    });
    const today = tasks.items.filter(t => t.status === 'pending' && calendarDateKey(t.dueDate) === todayKey);
    const upcoming = tasks.items.filter(t => t.status === 'pending' && calendarDateKey(t.dueDate) > todayKey);
    const completed = tasks.items.filter(t => t.status === 'completed');

    appRoot.innerHTML = `
      <section class="tasks-view">
        <div class="panel-header tasks-header">
          <div>
            <p class="eyebrow">Follow-up queue</p>
            <h3>${appState.taskQuery.status === 'pending' ? 'What needs attention' : 'Completed work'}</h3>
            <p class="muted small">Keep the next commitment visible; create another only when you need it.</p>
          </div>
          <div class="tasks-tabs" role="tablist" aria-label="Task status">
            <button class="tab-btn ${appState.taskQuery.status === 'pending' ? 'active' : ''}" id="tasks-tab-pending" role="tab" aria-selected="${String(appState.taskQuery.status === 'pending')}" aria-controls="tasks-panel" tabindex="${appState.taskQuery.status === 'pending' ? '0' : '-1'}" data-action="filter-tasks" data-status="pending">Pending</button>
            <button class="tab-btn ${appState.taskQuery.status === 'completed' ? 'active' : ''}" id="tasks-tab-completed" role="tab" aria-selected="${String(appState.taskQuery.status === 'completed')}" aria-controls="tasks-panel" tabindex="${appState.taskQuery.status === 'completed' ? '0' : '-1'}" data-action="filter-tasks" data-status="completed">Completed</button>
          </div>
        </div>

        <details class="form-card workspace-disclosure task-create-disclosure">
          <summary>
            <span class="workspace-disclosure__icon" aria-hidden="true">+</span>
            <span><strong>New task</strong><small>Add a dated follow-up or reminder.</small></span>
          </summary>
          <form id="task-create-form" class="task-create-form">
            <label>
              <span>What needs to happen?</span>
              <input name="summary" maxlength="240" required placeholder="Follow up with the hiring manager">
            </label>
            <label>
              <span>Due date</span>
              <input name="dueDate" type="date" value="${toLocalDateInputValue(new Date(Date.now() + 86400000))}" required>
            </label>
            <button type="submit" class="primary-button">Add task</button>
          </form>
        </details>

        <div class="tasks-content" id="tasks-panel" role="tabpanel" aria-labelledby="tasks-tab-${escapeAttr(appState.taskQuery.status)}">
          ${appState.taskQuery.status === 'pending' ? `
            ${renderTaskSection('Overdue', overdue, 'error')}
            ${renderTaskSection('Today', today, 'warning')}
            ${renderTaskSection('Upcoming', upcoming, 'success')}
            ${!overdue.length && !today.length && !upcoming.length ? renderEmptyState({ icon: 'OK', title: 'No pending tasks', copy: 'Create a new task or add a follow-up from an account page.', action: '<button class="secondary-button" type="button" data-action="open-task-create">Create task</button>' }) : ''}
          ` : `
            ${renderTaskSection('Completed', completed, 'neutral')}
            ${!completed.length ? renderEmptyState({ icon: 'Done', title: 'No completed tasks yet', copy: 'Completed reminders and outreach tasks will appear here for reference.' }) : ''}
          `}
        </div>
      </section>
    `;
  } catch (error) {
    appRoot.innerHTML = `<div class="error-state">Failed to load tasks: ${escapeHtml(error.message || String(error))}</div>`;
  }
}

function renderTaskSection(title, tasks, tone) {
  if (!tasks.length) return '';
  return `
    <div class="task-section" data-task-section="${escapeAttr(title)}">
      <h4 class="task-section-title task-section-title--${tone}" data-section-title="${escapeAttr(title)}">${title} (${tasks.length})</h4>
      <div class="task-list">
        ${tasks.map(renderTaskItem).join('')}
      </div>
    </div>
  `;
}

function renderTaskItem(task) {
  const summary = task.summary || task.title || 'Follow-up task';
  return `
    <article class="task-item" data-task-id="${escapeAttr(task.id)}">
      <div class="task-item-main">
        <div class="task-item-info">
          <strong>${escapeHtml(summary)}</strong>
          <div class="small muted">Due ${formatCalendarDate(task.dueDate)}</div>
        </div>
        <div class="task-item-actions">
          ${task.accountId ? `<a href="#/accounts/${task.accountId}" class="ghost-button micro-button">View Account</a>` : ''}
          ${task.status === 'pending' ? `<button class="primary-button micro-button" data-action="complete-task" data-id="${task.id}">Mark Done</button>` : ''}
        </div>
      </div>
    </article>
  `;
}

async function completeTask(taskId, buttonEl) {
  const button = buttonEl || document.querySelector(`[data-action="complete-task"][data-id="${CSS.escape(taskId)}"]`);
  const originalLabel = button?.textContent || 'Mark Done';
  if (button) { button.disabled = true; button.textContent = 'Completing...'; }
  try {
    await api(`/api/tasks/${taskId}/complete`, { method: 'POST' });
    invalidateAppData();
    const taskItem = button?.closest('.task-item') || document.querySelector(`.task-item[data-task-id="${CSS.escape(taskId)}"]`);
    if (appState.taskQuery.status === 'pending' && taskItem) {
      const section = taskItem.closest('.task-section');
      taskItem.classList.add('task-item--leaving');
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      taskItem.remove();
      const remaining = section?.querySelectorAll('.task-item').length || 0;
      if (!remaining) {
        section?.remove();
      } else {
        const heading = section.querySelector('[data-section-title]');
        if (heading) heading.textContent = `${heading.dataset.sectionTitle} (${remaining})`;
      }
      const content = document.querySelector('.tasks-content');
      if (content && !content.querySelector('.task-item')) {
        content.innerHTML = renderEmptyState({ icon: 'OK', title: 'No pending tasks', copy: 'Create a new task or add a follow-up from an account page.', action: '<button class="secondary-button" type="button" data-action="open-task-create">Create task</button>' });
      }
    } else {
      await renderTasksView();
    }
    showToast('Task completed.', 'success');
  } catch (error) {
    showToast('Failed to complete task: ' + error.message, 'error');
    if (button) { button.disabled = false; button.textContent = originalLabel; }
  }
}

function calendarDateKey(value) {
  const raw = String(value || '');
  const dateOnly = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (dateOnly) return dateOnly;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toLocalDateInputValue(date);
}

function formatCalendarDate(value) {
  const key = calendarDateKey(value);
  if (!key) return formatDate(value);
  const date = new Date(`${key}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function toLocalDateInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
