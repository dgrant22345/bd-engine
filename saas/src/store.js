import { dbSaveTenantData, dbLoadAllTenantData, isDbEnabled } from './db.js';

const now = () => new Date().toISOString();

const pastDate = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
};

const futureDate = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

const seedTenant = {
  id: 'tenant-demo',
  slug: 'demo',
  name: 'BD Engine Cloud Demo',
  plan: 'trial',
  status: 'trialing',
};

const seedUser = {
  id: 'user-demo',
  email: 'founder@example.com',
  name: 'BD Engine Founder',
};

// ── Factories ───────────────────────────────────────────────────────────────

function account(input) {
  return {
    id: `acct-${Math.random().toString(36).slice(2, 6)}`,
    tenantId: seedTenant.id,
    normalizedName: input.displayName ? normalizeKey(input.displayName) : '',
    displayName: '',
    domain: '',
    industry: '',
    location: '',
    status: 'new',
    outreachStatus: 'not_started',
    targetScore: 0,
    dailyScore: 0,
    priorityTier: 'C',
    owner: '',
    connectionCount: 0,
    seniorContactCount: 0,
    talentContactCount: 0,
    buyerTitleCount: 0,
    jobCount: 0,
    openRoleCount: 0,
    newRoleCount7d: 0,
    jobsLast30Days: 0,
    hiringVelocity: 0,
    engagementScore: 0,
    relationshipStrengthScore: 0,
    alertPriorityScore: 0,
    nextAction: '',
    notes: '',
    createdAt: now(),
    updatedAt: now(),
    tags: [],
    aliases: [],
    hiringSpikeScore: 0,
    externalRecruiterLikelihoodScore: 0,
    companyGrowthSignalScore: 0,
    avgRoleSeniorityScore: 0,
    ...input,
  };
}

function contact(input) {
  return {
    id: `ct-${Math.random().toString(36).slice(2, 6)}`,
    tenantId: seedTenant.id,
    createdAt: now(),
    updatedAt: now(),
    source: 'manual',
    sourceMetadata: {},
    ...input,
  };
}

function job(input) {
  return {
    id: `job-${Math.random().toString(36).slice(2, 6)}`,
    tenantId: seedTenant.id,
    active: true,
    atsType: input.atsType || input.source || 'unknown',
    sourceUrl: '',
    createdAt: now(),
    updatedAt: now(),
    ...input,
  };
}

// ── Seed Data ───────────────────────────────────────────────────────────────

const workspace = {
  id: 'workspace-demo',
  tenantId: seedTenant.id,
  name: 'BD Engine Cloud Demo',
  companyName: 'Demo Staffing Co',
  updatedAt: now(),
};

const settings = {
  setupComplete: true,
  minCompanyConnections: 1,
  minJobsPosted: 1,
  contactPriorityThreshold: 25,
  maxCompaniesToReview: 100,
  geographyFocus: 'Canada + US',
  gtaPriority: false,
  jobRetentionDays: 28,
  ownerRoster: [
    { id: 'owner-founder', name: 'BD Engine Founder', displayName: 'BD Engine Founder', email: 'founder@example.com', role: 'Owner' },
    { id: 'owner-ae', name: 'Cloud AE', displayName: 'Cloud AE', email: 'ae@example.com', role: 'BD' },
  ],
  user: {
    name: seedUser.name,
    email: seedUser.email,
  },
};

const tenantProfiles = new Map([
  [seedTenant.id, { workspace, settings }],
]);

// Efficient tenant-keyed storage
const accountsByTenant = new Map();
const contactsByTenant = new Map();
const jobsByTenant = new Map();
const configsByTenant = new Map();
const activitiesByTenant = new Map();
const tasksByTenant = new Map();

function getTenantArray(map, tenantId) {
  if (!map.has(tenantId)) map.set(tenantId, []);
  return map.get(tenantId);
}

let accounts = [
  account({
    id: 'acct-northstar',
    displayName: 'Northstar Robotics',
    domain: 'northstar.example',
    industry: 'Industrial automation',
    location: 'Toronto, ON',
    status: 'contacted',
    outreachStatus: 'contacted',
    targetScore: 91,
    dailyScore: 91,
    priorityTier: 'A',
    owner: 'BD Engine Founder',
    connectionCount: 2,
    seniorContactCount: 2,
    talentContactCount: 1,
    buyerTitleCount: 1,
    jobCount: 2,
    openRoleCount: 14,
    newRoleCount7d: 2,
    jobsLast30Days: 2,
    hiringVelocity: 84,
    engagementScore: 70,
    relationshipStrengthScore: 86,
    alertPriorityScore: 91,
    nextAction: 'Follow up with Priya Shah',
    nextActionAt: futureDate(4),
    recommendedAction: 'Follow up on controls and embedded hiring demand.',
    targetScoreExplanation: 'Active hiring plus a warm talent leader makes this the best first account.',
    topContactName: 'Priya Shah',
    topContactTitle: 'Director of Talent',
    atsTypesText: 'Greenhouse',
    hiringStatus: 'Active hiring',
    notes: 'High hiring velocity across controls and embedded roles.',
  }),
  account({
    id: 'acct-vertex',
    displayName: 'Vertex Health Systems',
    domain: 'vertexhealth.example',
    industry: 'Health technology',
    location: 'Boston, MA',
    status: 'ready',
    outreachStatus: 'ready_to_contact',
    targetScore: 84,
    dailyScore: 84,
    priorityTier: 'A',
    owner: 'Cloud AE',
    connectionCount: 1,
    seniorContactCount: 1,
    talentContactCount: 1,
    buyerTitleCount: 1,
    jobCount: 1,
    openRoleCount: 8,
    newRoleCount7d: 1,
    jobsLast30Days: 1,
    hiringVelocity: 73,
    engagementScore: 48,
    relationshipStrengthScore: 75,
    alertPriorityScore: 80,
    nextAction: 'Draft VP People outreach',
    nextActionAt: futureDate(1),
    recommendedAction: 'Lead with data platform hiring and speed-to-shortlist.',
    targetScoreExplanation: 'New product hiring with a senior people leader in network.',
    topContactName: 'Marcus Lee',
    topContactTitle: 'VP People',
    atsTypesText: 'Lever',
    hiringStatus: 'Active hiring',
    notes: 'New product hiring with several data engineering openings.',
  }),
];

let contacts = [
  contact({
    id: 'ct-priya',
    accountId: 'acct-northstar',
    fullName: 'Priya Shah',
    firstName: 'Priya',
    lastName: 'Shah',
    email: 'priya.shah@example.com',
    linkedinUrl: 'https://www.linkedin.com/in/priya-shah',
    companyName: 'Northstar Robotics',
    title: 'Director of Talent',
    connectedOn: '2025-11-18',
    outreachStatus: 'contacted',
    priorityScore: 93,
    seniority: 'director',
    isTalentLeader: true,
  }),
];

let jobs = [
  job({
    id: 'job-controls',
    accountId: 'acct-northstar',
    title: 'Senior Controls Engineer',
    companyName: 'Northstar Robotics',
    location: 'Toronto, ON',
    source: 'Greenhouse',
    postedAt: pastDate(2),
  }),
];

let boardConfigs = [
  { id: 'cfg-northstar', tenantId: seedTenant.id, companyName: 'Northstar Robotics', normalizedCompanyName: 'northstar robotics', ats: 'greenhouse', discoveryStatus: 'resolved', active: true },
];

let activities = [];
let tasks = [];
let followups = [];

// Populate maps from seed data
accounts.forEach(a => getTenantArray(accountsByTenant, a.tenantId).push(a));
contacts.forEach(c => getTenantArray(contactsByTenant, c.tenantId).push(c));
jobs.forEach(j => getTenantArray(jobsByTenant, j.tenantId).push(j));
boardConfigs.forEach(c => getTenantArray(configsByTenant, c.tenantId).push(c));
activities.forEach(a => getTenantArray(activitiesByTenant, a.tenantId).push(a));
tasks.forEach(t => getTenantArray(tasksByTenant, t.tenantId).push(t));

const backgroundJobs = new Map();

// ── Debounced persistence ────────────────────────────────────────────────────

const pendingSaves = new Map();

function persistTenant(tenantId) {
  if (!isDbEnabled()) return;
  if (pendingSaves.has(tenantId)) clearTimeout(pendingSaves.get(tenantId));
  pendingSaves.set(tenantId, setTimeout(() => {
    pendingSaves.delete(tenantId);
    const profile = tenantProfiles.get(tenantId);
    const status = loadedTenants.get(tenantId) || {};
    
    // Only persist fields that have actually been loaded/initialized
    const data = {
      settings: profile ? { ...profile.settings, persona: profile.persona } : undefined
    };

    if (status.core) {
      data.accounts = accountsByTenant.get(tenantId);
      data.jobs = jobsByTenant.get(tenantId);
      data.configs = configsByTenant.get(tenantId);
      data.activities = activitiesByTenant.get(tenantId);
      data.tasks = tasksByTenant.get(tenantId);
    }

    if (status.contacts) {
      data.contacts = contactsByTenant.get(tenantId);
    }

    dbSaveTenantData(tenantId, data).catch(err => console.error('Persist error:', err.message));
  }, 500));
}

const loadedTenants = new Map(); // tenantId -> { core: boolean, contacts: boolean }

async function ensureDataLoaded(tenantId, needsContacts = false) {
  if (!isDbEnabled()) return;
  const status = loadedTenants.get(tenantId) || { core: false, contacts: false };
  
  // If we already have what we need, return immediately
  if (status.core && (!needsContacts || status.contacts)) return;

  const start = Date.now();
  console.log(`  Store: Loading data for ${tenantId} (needsContacts: ${needsContacts})`);

  const { dbLoadTenantData } = await import('./db.js');
  const data = await dbLoadTenantData(tenantId, needsContacts);
  
  if (data) {
    if (data.accounts.length > 0 || !status.core) {
      const tenantAccts = data.accounts || [];
      tenantAccts.sort((a, b) => (b.targetScore || 0) - (a.targetScore || 0));
      accountsByTenant.set(tenantId, tenantAccts);
      jobsByTenant.set(tenantId, data.jobs || []);
      configsByTenant.set(tenantId, data.configs || []);
      activitiesByTenant.set(tenantId, data.activities || []);
      tasksByTenant.set(tenantId, data.tasks || []);

      // Optimization: Only merge into global arrays if this is the FIRST load for this tenant
      if (!status.core) {
        const existingAcctIds = new Set(accounts.map(x => x.id));
        for (const a of tenantAccts) if (!existingAcctIds.has(a.id)) accounts.push(a);

        const existingJobIds = new Set(jobs.map(x => x.id));
        for (const j of (data.jobs || [])) if (!existingJobIds.has(j.id)) jobs.push(j);

        const existingConfigIds = new Set(boardConfigs.map(x => x.id));
        for (const c of (data.configs || [])) if (!existingConfigIds.has(c.id)) boardConfigs.push(c);

        const existingActivityIds = new Set(activities.map(x => x.id));
        for (const a of (data.activities || [])) if (!existingActivityIds.has(a.id)) activities.push(a);

        const existingTaskIds = new Set(tasks.map(x => x.id));
        for (const t of (data.tasks || [])) if (!existingTaskIds.has(t.id)) tasks.push(t);
      }

      status.core = true;
    }
    
    if (needsContacts && !status.contacts) {
      const tenantConts = data.contacts || [];
      tenantConts.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
      contactsByTenant.set(tenantId, tenantConts);

      const existingContactIds = new Set(contacts.map(x => x.id));
      for (const c of tenantConts) if (!existingContactIds.has(c.id)) contacts.push(c);

      status.contacts = true;
    }
  }
  
  loadedTenants.set(tenantId, status);
  console.log(`  Store: Data loaded for ${tenantId} in ${Date.now() - start}ms`);
}

export function createStore() {
  return {
    // Load basic tenant profiles only on startup
    async loadFromDb() {
      // Basic users/profiles are loaded separately by the server.
      // We no longer pre-load all tenant_data (lazy load now).
      console.log('  Store: Lazy loading enabled for tenant data');
    },
    ensureTenant(tenant, user = {}) {
      return ensureTenantProfile(tenant?.id || tenant, tenant, user);
    },

    setPersona(tenantId, persona) {
      const profile = getTenantProfile(tenantId);
      if (profile) {
        profile.persona = normalizePersona(persona);
        profile.settings.persona = profile.persona;
      }
      persistTenant(tenantId);
    },

    getPersona(tenantId) {
      const profile = getTenantProfile(tenantId);
      return normalizePersona(profile?.persona || profile?.settings?.persona);
    },

    getSession() {
      return {
        tenant: { ...seedTenant },
        user: { ...seedUser },
        membership: { role: 'owner' },
      };
    },

    async getSetupStatus(tenantId) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const profile = getTenantProfile(tenantId);
      return {
        requiresSetup: !profile.settings.setupComplete,
        setupComplete: Boolean(profile.settings.setupComplete),
        licensingEnabled: false,
        workspaceName: profile.workspace.name,
        persona: this.getPersona(tenantId),
        user: profile.settings.user,
      };
    },

    getRuntimeStatus() {
      return {
        ok: true,
        serverStartedAt: processStartedAt,
        serverWarmedAt: processStartedAt,
        warmed: true,
        workerRunning: false,
        workerPid: null,
        runningJobs: 0,
        queuedJobs: 0,
        activeJobs: [],
        recentJobs: [],
      };
    },

    async getBootstrap(tenantId, { includeFilters = false, session = null } = {}) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false); // Don't need contacts for bootstrap
      const profile = getTenantProfile(tenantId);
      return {
        workspace: { ...profile.workspace },
        settings: { ...profile.settings },
        persona: profile.persona || 'bd',
        defaults: {
          workbookPath: '',
          spreadsheetId: '',
          connectionsCsvPath: '',
        },
        ownerRoster: profile.settings.ownerRoster,
        session: session || this.getSession(),
        ...(includeFilters ? { filters: buildFilters(tenantId) } : {}),
      };
    },

    async getDashboard(tenantId) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false); // Don't need full contact list for dashboard summary
      const tenantAccounts = accountsForTenant(tenantId);
      const tenantJobs = jobsForTenant(tenantId);
      const newJobsToday = tenantJobs.filter((item) => daysSince(item.postedAt) <= 1).slice(0, 100);
      const followUpAccounts = tenantAccounts.filter((item) => item.nextActionAt).slice(0, 50);
      return {
        summary: {
          accountCount: tenantAccounts.length,
          hiringAccountCount: tenantAccounts.filter((item) => item.jobCount > 0).length,
          newJobsLast24h: newJobsToday.length,
          discoveredBoardCount: boardConfigs.length,
          needsResolutionCount: tenantAccounts.filter((item) => item.status === 'new').length,
        },
        todayQueue: tenantAccounts.slice(0, 100),
        followUpAccounts,
        newJobsToday,
        networkLeaders: contactsForTenant(tenantId).slice(0, 5),
        needsResolution: tenantAccounts.filter((item) => item.status === 'new').slice(0, 5),
        recommendedActions: tenantAccounts.slice(0, 5).map((item) => ({
          accountId: item.id,
          company: item.displayName,
          recommendedAction: item.recommendedAction,
          outreachStatus: item.outreachStatus,
        })),
        recentlyDiscoveredBoards: boardConfigs.slice(0, 5).map((item) => ({
          companyName: item.companyName,
          ats: item.ats,
          confidenceBand: item.confidenceBand,
          discoveredAt: pastDate(2),
        })),
      };
    },

    async getDashboardExtended(tenantId) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false);
      const tenantAccounts = accountsForTenant(tenantId);
      return {
        playbook: tenantAccounts.slice(0, 5),
        overdueFollowUps: [],
        staleAccounts: tenantAccounts.filter((item) => item.status === 'new').slice(0, 50),
        activityFeed: activitiesForTenant(tenantId).slice(0, 10),
        enrichmentFunnel: { resolved: 2, needsReview: 1, missing: 0 },
        alertQueue: tenantAccounts.slice(0, 3).map((item) => ({
          ...item,
          accountId: item.id,
          type: 'hiring_signal',
          title: 'Hiring signal',
          summary: item.targetScoreExplanation,
        })),
        sequenceQueue: followups
          .filter((item) => item.tenantId === tenantId && item.status === 'open')
          .map((item) => {
            const itemAccount = accountById(item.accountId);
            return {
              accountId: item.accountId,
              displayName: itemAccount?.displayName || 'Account',
              status: item.status,
              nextStepLabel: item.note,
              nextStepAt: item.dueAt,
              targetScore: itemAccount?.targetScore || 0,
              relationshipStrengthScore: itemAccount?.relationshipStrengthScore || 0,
            };
          }),
        introQueue: contactsForTenant(tenantId).slice(0, 3).map((item) => ({
          accountId: item.accountId,
          displayName: item.companyName,
          contactName: item.fullName,
          contactTitle: item.title,
          relationshipStrengthScore: item.priorityScore,
          introSummary: `Best path is through ${item.fullName}.`,
          pathLength: 1,
        })),
        resolutionQueue: tenantAccounts.filter((item) => item.status === 'new'),
      };
    },

    async findAccounts(tenantId, query) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      return paginate(filterText(accountsForTenant(tenantId), query.q, ['displayName', 'domain', 'industry', 'location', 'owner', 'notes']), query);
    },

    async getAccountDetail(tenantId, accountId) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const item = accountById(accountId);
      if (!item || item.tenantId !== tenantId) return null;
      const accountContacts = contacts.filter((contactItem) => contactItem.tenantId === tenantId && contactItem.accountId === accountId);
      const accountJobs = jobs.filter((jobItem) => jobItem.tenantId === tenantId && jobItem.accountId === accountId);
      const accountActivities = activities.filter((activity) => activity.tenantId === tenantId && activity.accountId === accountId);
      return {
        account: item,
        contacts: accountContacts,
        jobs: accountJobs,
        activity: accountActivities,
        activities: accountActivities,
        configs: boardConfigs.filter((config) => config.normalizedCompanyName === item.normalizedName),
        config: boardConfigs.find((config) => config.normalizedCompanyName === item.normalizedName) || null,
      };
    },

    getHiringVelocity(tenantId, accountId) {
      assertTenant(tenantId);
      const detail = this.getAccountDetail(tenantId, accountId);
      if (!detail) return null;
      return {
        weeks: {
          '4w ago': Math.max(0, Math.floor((detail.account.jobsLast90Days || detail.jobs.length) / 2)),
          '3w ago': Math.max(0, Math.floor((detail.account.jobsLast30Days || detail.jobs.length) / 2)),
          '2w ago': detail.jobs.length,
          'This week': detail.jobs.filter((item) => daysSince(item.postedAt) <= 7).length,
        },
        jobs: detail.jobs,
      };
    },

    async patchAccount(tenantId, accountId, patch) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const item = accountById(accountId);
      if (!item || item.tenantId !== tenantId) return null;
      Object.assign(item, pickPatch(patch, ['status', 'outreachStatus', 'priorityTier', 'notes', 'industry', 'location', 'domain', 'nextAction', 'nextActionAt', 'owner']));
      item.updatedAt = now();
      persistTenant(tenantId);
      return item;
    },

    async findContacts(tenantId, query) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, true); // MUST load contacts here
      return paginate(filterText(contactsForTenant(tenantId), query.q, ['fullName', 'companyName', 'title', 'email', 'notes']), query);
    },

    async patchContact(tenantId, contactId, patch) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const item = contacts.find((contactItem) => contactItem.tenantId === tenantId && contactItem.id === contactId);
      if (!item) return null;
      Object.assign(item, pickPatch(patch, ['outreachStatus', 'notes', 'email', 'title', 'linkedinUrl']));
      item.updatedAt = now();
      persistTenant(tenantId);
      return item;
    },

    findJobs(tenantId, query) {
      assertTenant(tenantId);
      return paginate(filterText(jobsForTenant(tenantId), query.q, ['title', 'companyName', 'location', 'source']), query);
    },

    findConfigs(tenantId, query) {
      assertTenant(tenantId);
      return paginate(boardConfigs.filter((item) => item.tenantId === tenantId), query);
    },

    addConfig(tenantId, payload) {
      assertTenant(tenantId);
      const config = normalizeConfigPatch({
        id: `cfg-${Date.now()}`,
        tenantId,
        companyName: payload.companyName || 'New company',
        normalizedCompanyName: normalizeKey(payload.companyName || 'New company'),
        active: payload.active !== false && payload.active !== 'false',
        discoveryStatus: 'manual',
        reviewStatus: 'approved',
        confidenceBand: payload.atsType || payload.ats ? 'high' : 'unresolved',
        source: payload.source || 'manual',
        lastImportStatus: 'not run',
        createdAt: now(),
        updatedAt: now(),
        ...payload,
      });
      boardConfigs.unshift(config);
      persistTenant(tenantId);
      return config;
    },

    patchConfig(tenantId, configId, patch) {
      assertTenant(tenantId);
      const config = boardConfigs.find((item) => item.tenantId === tenantId && item.id === configId);
      if (!config) return null;
      Object.assign(config, normalizeConfigPatch(pickPatch(patch, ['companyName', 'atsType', 'ats', 'boardId', 'domain', 'careersUrl', 'source', 'active', 'notes'])));
      if (config.companyName) config.normalizedCompanyName = normalizeKey(config.companyName);
      config.updatedAt = now();
      persistTenant(tenantId);
      return config;
    },

    reviewConfig(tenantId, configId, payload) {
      assertTenant(tenantId);
      const config = boardConfigs.find((item) => item.tenantId === tenantId && item.id === configId);
      if (!config) return null;
      config.reviewStatus = payload.action === 'reject' ? 'rejected' : 'approved';
      config.active = payload.action !== 'reject';
      config.updatedAt = now();
      persistTenant(tenantId);
      return config;
    },

    patchSettings(tenantId, patch) {
      assertTenant(tenantId);
      const profile = getTenantProfile(tenantId);
      Object.assign(profile.settings, pickPatch(patch, [
        'minCompanyConnections',
        'minJobsPosted',
        'contactPriorityThreshold',
        'maxCompaniesToReview',
        'geographyFocus',
        'gtaPriority',
        'jobRetentionDays',
      ]));
      persistTenant(tenantId);
      return { ok: true, settings: { ...profile.settings } };
    },

    completeSetup(tenantId) {
      assertTenant(tenantId);
      const profile = getTenantProfile(tenantId);
      const wasComplete = profile.settings.setupComplete;
      profile.settings.setupComplete = true;
      profile.settings.lastPipelineRun = now();
      persistTenant(tenantId);
      
      if (!wasComplete) {
        console.log(`[Auto-Pipeline] Triggering initial pipeline for ${tenantId}`);
        this.startRevenuePipeline(tenantId);
      }
      return { ok: true };
    },

    getActivity(tenantId, query) {
      assertTenant(tenantId);
      return paginate(activitiesForTenant(tenantId), query);
    },

    addActivity(tenantId, userId, payload) {
      assertTenant(tenantId);
      const activity = {
        id: `act-${Date.now()}`,
        tenantId,
        accountId: payload.accountId || '',
        contactId: payload.contactId || '',
        normalizedCompanyName: payload.normalizedCompanyName || '',
        type: payload.type || 'note',
        summary: payload.summary || 'Activity note',
        notes: payload.notes || '',
        pipelineStage: payload.pipelineStage || '',
        occurredAt: now(),
        createdAt: now(),
        createdByUserId: userId,
        metadata: payload.metadata || {},
      };
      activities.unshift(activity);
      const itemAccount = activity.accountId ? accountById(activity.accountId) : null;
      if (itemAccount) {
        itemAccount.lastContactedAt = activity.occurredAt;
        if (activity.pipelineStage) itemAccount.outreachStatus = activity.pipelineStage;
      }

      // Auto-create follow-up task if requested
      if (payload.followUpDays) {
        const days = parseInt(payload.followUpDays, 10);
        if (!isNaN(days) && days > 0) {
          const task = {
            id: `task-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            tenantId,
            accountId: payload.accountId,
            type: 'follow_up',
            status: 'pending',
            summary: `Follow up on outreach sent today to ${payload.contactName || 'contact'}.`,
            dueDate: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: now(),
          };
          tasks.push(task);
        }
      }

      persistTenant(tenantId);
      return activity;
    },

    findActivities(tenantId, query) {
      assertTenant(tenantId);
      return paginate(activitiesForTenant(tenantId), query);
    },

    findTasks(tenantId, query) {
      assertTenant(tenantId);
      const status = query.status || 'pending';
      return paginate(tasksForTenant(tenantId).filter(t => t.status === status), query);
    },

    completeTask(tenantId, taskId) {
      assertTenant(tenantId);
      const task = tasks.find((t) => t.id === taskId && t.tenantId === tenantId);
      if (task) {
        task.status = 'completed';
        persistTenant(tenantId);
      }
      return task;
    },

    createOutreachDraft(tenantId, accountId, payload = {}) {
      assertTenant(tenantId);
      const detail = this.getAccountDetail(tenantId, accountId);
      if (!detail) return null;
      const selectedContact = selectContact(detail.contacts, payload.contactName);
      return buildDraft({ account: detail.account, contact: selectedContact, jobs: detail.jobs, template: payload.template, jobId: payload.jobId });
    },

    getTargetScoreRollout(tenantId) {
      assertTenant(tenantId);
      return {
        remainingCount: 0,
        hasActiveJob: false,
        defaultLimit: 150,
        defaultMaxBatches: 6,
      };
    },

    getResolverReport(tenantId) {
      assertTenant(tenantId);
      const tenantConfigs = boardConfigs.filter((item) => item.tenantId === tenantId);
      const resolved = tenantConfigs.filter((item) => item.discoveryStatus === 'resolved');
      const medium = tenantConfigs.filter((item) => item.confidenceBand === 'medium');
      const unresolved = tenantConfigs.filter((item) => item.confidenceBand === 'unresolved' || item.discoveryStatus === 'unresolved');
      return {
        summary: {
          totalCompanies: tenantConfigs.length,
          resolvedCount: resolved.length,
          activeCount: tenantConfigs.filter((item) => item.active).length,
          unresolvedCount: unresolved.length,
          mediumReviewQueueCount: medium.length,
          unresolvedReviewQueueCount: unresolved.length,
          coveragePercent: tenantConfigs.length ? Math.round((resolved.length / tenantConfigs.length) * 100) : 0,
        },
        byConfidenceBand: countBy(tenantConfigs, 'confidenceBand'),
        topFailureReasons: unresolved.length ? [{ failureReason: 'Missing verified ATS evidence', count: unresolved.length }] : [],
      };
    },

    getEnrichmentReport(tenantId) {
      assertTenant(tenantId);
      const tenantAccounts = accountsForTenant(tenantId);
      const enriched = tenantAccounts.filter((item) => item.canonicalDomain || item.domain);
      const careers = tenantAccounts.filter((item) => item.careersUrl);
      return {
        summary: {
          canonicalDomainCount: enriched.length,
          careersUrlCount: careers.length,
          aliasesCount: tenantAccounts.reduce((sum, item) => sum + (item.aliases || []).length, 0),
          enrichedCount: enriched.length,
          enrichmentCoveragePercent: tenantAccounts.length ? Math.round((enriched.length / tenantAccounts.length) * 100) : 0,
        },
        byConfidence: countBy(tenantAccounts, 'enrichmentConfidence'),
        topUnresolvedReasons: [{ reason: 'Needs cloud resolver implementation', count: Math.max(0, tenantAccounts.length - enriched.length) }],
        resolutionByEnrichmentPresence: [
          { enrichmentPresence: 'present', totalCompanies: enriched.length, coveragePercent: tenantAccounts.length ? Math.round((enriched.length / tenantAccounts.length) * 100) : 0 },
        ],
        bySource: [{ source: 'seed', count: tenantAccounts.length }],
      };
    },

    getResolverQueue(tenantId, band) {
      assertTenant(tenantId);
      const items = boardConfigs
        .filter((item) => item.tenantId === tenantId)
        .filter((item) => band === 'medium' ? item.confidenceBand === 'medium' : item.confidenceBand === 'unresolved' || item.discoveryStatus === 'unresolved');
      return paginate(items, { page: 1, pageSize: 10 });
    },

    getEnrichmentQueue(tenantId, query = {}) {
      assertTenant(tenantId);
      const candidates = accountsForTenant(tenantId).map((item) => ({
        ...item,
        primaryConfigId: boardConfigs.find((config) => config.normalizedCompanyName === item.normalizedName)?.id || '',
        configCount: boardConfigs.filter((config) => config.normalizedCompanyName === item.normalizedName).length,
        canonicalDomain: item.canonicalDomain || item.domain,
        enrichmentStatus: item.enrichmentStatus || 'enriched',
        enrichmentConfidence: item.enrichmentConfidence || 'medium',
        reviewReason: item.reviewReason || item.recommendedAction || 'Review this account before deeper verification.',
      }));
      return paginate(candidates, query);
    },

    runLaunchWorkflow(tenantId, { plan } = {}) {
      assertTenant(tenantId);
      const selectedPlan = plan || { displayName: 'current', limits: {} };
      const planName = selectedPlan.displayName || selectedPlan.name || 'current';
      const accountLimit = Number(selectedPlan.limits?.accounts ?? -1);
      const jobBoardLimit = Number(selectedPlan.limits?.jobBoards ?? -1);
      const tenantAccounts = accountsForTenant(tenantId).slice(0, accountLimit === -1 ? undefined : accountLimit);
      let tenantConfigs = boardConfigs.filter((item) => item.tenantId === tenantId);
      const warnings = [];

      if (accountLimit !== -1 && accountsForTenant(tenantId).length > accountLimit) {
        warnings.push(`Only the first ${accountLimit} accounts were processed on the ${planName} plan.`);
      }

      let configsCreated = 0;
      for (const item of tenantAccounts) {
        const alreadyExists = tenantConfigs.some((config) => config.normalizedCompanyName === item.normalizedName);
        if (alreadyExists) continue;
        if (jobBoardLimit !== -1 && tenantConfigs.length >= jobBoardLimit) {
          warnings.push(`ATS config creation stopped at the ${jobBoardLimit} board limit for the ${planName} plan.`);
          break;
        }
        const domain = item.domain || item.canonicalDomain || '';
        const config = normalizeConfigPatch({
          id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tenantId,
          companyName: item.displayName,
          normalizedCompanyName: item.normalizedName,
          atsType: 'unknown',
          ats: 'unknown',
          boardId: normalizeKey(item.displayName).replace(/\s+/g, ''),
          domain,
          careersUrl: domain ? `https://${domain.replace(/^https?:\/\//, '')}/careers` : '',
          active: Boolean(domain),
          discoveryStatus: domain ? 'resolved' : 'needs_review',
          reviewStatus: domain ? 'approved' : 'pending',
          confidenceBand: domain ? 'high' : 'medium',
          source: 'launch_workflow',
          lastImportStatus: 'ready',
          createdAt: now(),
          updatedAt: now(),
        });
        boardConfigs.unshift(config);
        tenantConfigs = boardConfigs.filter((existing) => existing.tenantId === tenantId);
        configsCreated++;
      }

      let enriched = 0;
      for (const item of tenantAccounts) {
        const domain = item.domain || item.canonicalDomain || inferDomainFromContacts(tenantId, item.id);
        if (domain && !item.domain) item.domain = domain;
        if (domain && !item.canonicalDomain) item.canonicalDomain = domain;
        if (domain && !item.careersUrl) item.careersUrl = `https://${domain.replace(/^https?:\/\//, '')}/careers`;
        item.enrichmentStatus = domain ? 'enriched' : 'needs_review';
        item.enrichmentConfidence = domain ? 'high' : 'medium';
        item.updatedAt = now();
        enriched++;
      }

      let configsResolved = 0;
      for (const config of tenantConfigs.slice(0, jobBoardLimit === -1 ? undefined : jobBoardLimit)) {
        if (config.confidenceBand === 'high' && config.discoveryStatus === 'resolved') continue;
        if (config.domain || config.careersUrl || config.boardId) {
          config.discoveryStatus = 'resolved';
          config.reviewStatus = 'approved';
          config.confidenceBand = config.domain || config.careersUrl ? 'high' : 'medium';
          config.active = true;
          config.lastImportStatus = 'ready';
          config.updatedAt = now();
          configsResolved++;
        }
      }

      let jobsTouched = 0;
      for (const config of tenantConfigs.filter((item) => item.active).slice(0, jobBoardLimit === -1 ? undefined : jobBoardLimit)) {
        const accountItem = tenantAccounts.find((item) => item.normalizedName === config.normalizedCompanyName);
        if (!accountItem) continue;
        const existingJobs = jobs.filter((jobItem) => jobItem.tenantId === tenantId && jobItem.accountId === accountItem.id);
        if (!existingJobs.length) {
          jobs.push(job({
            id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            tenantId,
            accountId: accountItem.id,
            title: 'New hiring signal detected',
            companyName: accountItem.displayName,
            location: accountItem.location || 'Remote',
            source: config.atsType || config.ats || 'ATS',
            postedAt: now(),
          }));
          accountItem.jobCount = (accountItem.jobCount || 0) + 1;
          accountItem.openRoleCount = (accountItem.openRoleCount || 0) + 1;
          accountItem.jobsLast30Days = (accountItem.jobsLast30Days || 0) + 1;
        }
        config.lastImportStatus = 'success';
        config.lastImportedAt = now();
        jobsTouched += Math.max(1, existingJobs.length);
      }

      let scoresRefreshed = 0;
      for (const item of tenantAccounts) {
        item.targetScore = Math.min(100, Math.round(
          (Number(item.connectionCount || 0) * 8) +
          (Number(item.seniorContactCount || 0) * 12) +
          (Number(item.talentContactCount || 0) * 16) +
          (Number(item.jobCount || 0) * 10)
        ));
        item.dailyScore = item.targetScore;
        item.alertPriorityScore = Math.max(item.alertPriorityScore || 0, item.targetScore);
        item.recommendedAction = item.recommendedAction || 'Review hiring signal and map the best contact.';
        item.updatedAt = now();
        scoresRefreshed++;
      }

      activities.unshift({
        id: `act-${Date.now()}`,
        tenantId,
        type: 'launch_workflow',
        summary: `Launch workflow processed ${tenantAccounts.length} accounts on the ${planName} plan.`,
        notes: warnings.join(' '),
        occurredAt: now(),
        createdAt: now(),
        metadata: { plan: selectedPlan.id || 'unknown' },
      });

      persistTenant(tenantId);

      return {
        workflow: 'launch',
        plan: { id: selectedPlan.id || 'unknown', displayName: planName },
        stats: {
          accountsProcessed: tenantAccounts.length,
          configsCreated,
          configsResolved,
          enriched,
          jobsTouched,
          scoresRefreshed,
        },
        warnings,
        timings: { totalMs: 1 },
      };
    },

    createCompletedJob(id, result = {}) {
      const job = {
        id: id || `cloud-job-${Date.now()}`,
        type: 'cloud-stub',
        status: 'completed',
        summary: 'Cloud prototype stub',
        progressMessage: 'Completed',
        queuedAt: now(),
        startedAt: now(),
        finishedAt: now(),
        recordsAffected: result.count || result.accountCount || 0,
        result,
      };
      backgroundJobs.set(job.id, job);
      return { ok: true, jobId: job.id, job };
    },

    startLinkedInCsvImport(tenantId, csvText, options = {}) {
      assertTenant(tenantId);
      const jobId = `linkedin-csv-${Date.now()}`;
      const job = {
        id: jobId,
        type: 'linkedin-csv-import',
        status: 'queued',
        summary: 'LinkedIn connections CSV import',
        progressMessage: 'Queued LinkedIn connections import.',
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        recordsAffected: 0,
        result: null,
      };
      backgroundJobs.set(jobId, job);

      setImmediate(async () => {
        try {
          job.status = 'running';
          job.startedAt = now();
          job.progressMessage = 'Parsing LinkedIn connections CSV...';
          const result = await this.importLinkedInCSV(tenantId, csvText, options);
          if (result.error) {
            job.status = 'failed';
            job.errorMessage = result.error;
            job.result = result;
          } else {
            job.status = 'completed';
            job.progressMessage = 'Completed';
            job.recordsAffected = result.stats?.imported || result.stats?.contactsCreated || 0;
            job.result = {
              stats: result.stats,
              importRun: {
                status: result.warnings?.length ? 'completed_with_warnings' : 'completed',
                stats: result.stats,
                warnings: result.warnings || [],
              },
              warnings: result.warnings || [],
            };
          }
        } catch (err) {
          job.status = 'failed';
          job.errorMessage = err.message || 'LinkedIn connections import failed.';
        } finally {
          job.finishedAt = now();
        }
      });

      return { ok: true, jobId, job };
    },

    getBackgroundJob(jobId) {
      return backgroundJobs.get(jobId) || this.createCompletedJob(jobId).job;
    },

    // ── Revenue Pipeline ──────────────────────────────────────────────────
    
    startRevenuePipeline(tenantId) {
      assertTenant(tenantId);
      const jobId = `pipe-${Date.now()}`;
      const job = {
        id: jobId,
        type: 'revenue-pipeline',
        status: 'queued',
        progress: 0,
        stage: 'starting',
        message: 'Initializing pipeline...',
        startedAt: now(),
        updatedAt: now(),
      };
      backgroundJobs.set(jobId, job);

      // Run in background
      (async () => {
        try {
          const update = (stage, progress, message) => {
            job.stage = stage;
            job.progress = progress;
            job.message = message;
            job.status = 'running';
            job.updatedAt = now();
            console.log(`  Pipeline ${tenantId}: ${stage} (${progress}%) - ${message}`);
          };

          // Stage 1: Enrichment (30%)
          update('enrichment', 5, 'Enriching company data from internal signals...');
          const accounts = accountsForTenant(tenantId);
          let enriched = 0;
          for (let i = 0; i < accounts.length; i++) {
            // Simulated enrichment pass (real logic is elsewhere but we aggregate progress here)
            if (i % 100 === 0) {
              update('enrichment', Math.min(30, 5 + Math.floor((i / accounts.length) * 25)), `Enriched ${i}/${accounts.length} companies...`);
              await new Promise(r => setImmediate(r));
            }
          }
          update('enrichment', 30, 'Enrichment complete.');

          // Stage 2: Discovery (60%)
          update('discovery', 35, 'Searching for new job boards...');
          await new Promise(r => setTimeout(r, 1000)); // Simulate work
          update('discovery', 60, 'Discovery complete.');

          // Stage 3: Job Ingestion (90%)
          update('ingestion', 65, 'Polling active boards for new jobs...');
          const configs = boardConfigs.filter(c => c.tenantId === tenantId && c.active);
          for (let i = 0; i < configs.length; i++) {
            if (i % 5 === 0) {
              update('ingestion', Math.min(90, 65 + Math.floor((i / configs.length) * 25)), `Polling board ${i}/${configs.length}...`);
              await new Promise(r => setImmediate(r));
            }
          }
          update('ingestion', 90, 'Job ingestion complete.');

          // Stage 4: Scoring (95%)
          update('scoring', 95, 'Recalculating target scores...');
          await new Promise(r => setTimeout(r, 500));

          // Stage 5: Cleanup (100%)
          update('cleanup', 98, 'Purging stale data and optimizing database...');
          this.purgeStaleJobs(tenantId);
          
          job.status = 'completed';
          job.progress = 100;
          job.message = 'Revenue pipeline completed successfully.';
          job.finishedAt = now();
        } catch (err) {
          job.status = 'failed';
          job.message = `Pipeline failed: ${err.message}`;
          job.error = err.message;
        }
      })();

      return job;
    },

    purgeStaleJobs(tenantId) {
      assertTenant(tenantId);
      const profile = getTenantProfile(tenantId);
      const retentionDays = Number(profile.settings.jobRetentionDays || 28);
      const threshold = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      const tenantJobs = jobsByTenant.get(tenantId);
      if (!tenantJobs) return;

      const initialCount = tenantJobs.length;
      const filteredJobs = tenantJobs.filter(j => {
        const postedAt = new Date(j.postedAt).getTime();
        return postedAt > threshold;
      });

      if (filteredJobs.length !== initialCount) {
        jobsByTenant.set(tenantId, filteredJobs);
        console.log(`[Purge] Removed ${initialCount - filteredJobs.length} jobs for ${tenantId} (Retention: ${retentionDays} days)`);
        persistTenant(tenantId);
      }
    },

    search(tenantId, query) {
      assertTenant(tenantId);
      const q = query.q || '';
      return {
        accounts: filterText(accountsForTenant(tenantId), q, ['displayName', 'domain', 'industry']).slice(0, 8),
        contacts: filterText(contactsForTenant(tenantId), q, ['fullName', 'companyName', 'title', 'email']).slice(0, 8),
        jobs: filterText(jobsForTenant(tenantId), q, ['title', 'companyName', 'location']).slice(0, 8),
      };
    },

    getAllTenants() {
      return Array.from(tenantsById.values());
    },

    // ── Account creation ──────────────────────────────────────────────────

    async addAccount(tenantId, payload, _skipPersist = false) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const id = `acct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const item = account({
        id,
        tenantId,
        displayName: payload.displayName || payload.companyName || 'New Account',
        domain: payload.domain || '',
        industry: payload.industry || '',
        location: payload.location || '',
        status: payload.status || 'new',
        outreachStatus: payload.outreachStatus || 'not_started',
        ...payload,
        createdAt: now(),
        updatedAt: now(),
      });
      item.tenantId = tenantId;
      accounts.push(item);
      const tenantAccts = getTenantArray(accountsByTenant, tenantId);
      tenantAccts.push(item);
      if (!_skipPersist) {
        tenantAccts.sort((a, b) => (b.targetScore || 0) - (a.targetScore || 0));
        persistTenant(tenantId);
      }
      return item;
    },

    // ── Contact creation ──────────────────────────────────────────────────

    async addContact(tenantId, payload, _skipPersist = false) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const id = `ct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const item = contact({
        id,
        tenantId,
        accountId: payload.accountId || '',
        fullName: payload.fullName || `${payload.firstName || ''} ${payload.lastName || ''}`.trim(),
        firstName: payload.firstName || '',
        lastName: payload.lastName || '',
        email: payload.email || '',
        linkedinUrl: payload.linkedinUrl || payload.url || '',
        companyName: payload.companyName || '',
        title: payload.title || payload.position || '',
        connectedOn: payload.connectedOn || '',
        outreachStatus: 'not_started',
        priorityScore: payload.priorityScore || 0,
        seniority: payload.seniority || '',
        isTalentLeader: payload.isTalentLeader || false,
        notes: payload.notes || '',
        source: payload.source || 'manual',
        createdAt: now(),
        updatedAt: now(),
      });
      // Override the default tenantId from contact() factory
      item.tenantId = tenantId;
      contacts.push(item);
      const tenantContacts = getTenantArray(contactsByTenant, tenantId);
      tenantContacts.push(item);
      if (!_skipPersist) {
        tenantContacts.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
        persistTenant(tenantId);
      }
      return item;
    },

    // ── LinkedIn CSV import ───────────────────────────────────────────────

    async importLinkedInCSV(tenantId, csvText, options = {}) {
      assertTenant(tenantId);
      // IMPORTANT: Must load contacts to perform deduplication correctly
      await ensureDataLoaded(tenantId, true);
      const dryRun = Boolean(options.dryRun);
      const plan = options.plan || { limits: {} };
      const timestamp = now();
      
      const rows = parseCSV(csvText || '');
      if (!String(csvText || '').trim()) {
        return {
          error: 'CSV file is empty. Upload the Connections.csv export from LinkedIn.',
          code: 'empty_csv',
          expectedHeaders: ['First Name', 'Last Name', 'Company', 'Position', 'Connected On', 'URL'],
        };
      }
      if (!rows.length) {
        return {
          error: 'No data rows were found in the CSV. Check that the first row contains headers.',
          code: 'no_rows',
          expectedHeaders: ['First Name', 'Last Name', 'Company', 'Position', 'Connected On', 'URL'],
        };
      }

      // Group contacts by company
      const companyMap = new Map();
      let skippedMissingName = 0;
      let skippedMissingCompany = 0;

      for (const row of rows) {
        const firstName = (row['First Name'] || row['first name'] || '').trim();
        const lastName = (row['Last Name'] || row['last name'] || '').trim();
        const fullName = `${firstName} ${lastName}`.trim();
        if (!fullName) {
          skippedMissingName++;
          continue;
        }

        const email = (row['Email Address'] || row['email address'] || row['Email'] || row['email'] || '').trim();
        const company = (row['Company'] || row['company'] || '').trim();
        const position = (row['Position'] || row['position'] || row['Title'] || row['title'] || '').trim();
        const connectedOn = (row['Connected On'] || row['connected on'] || '').trim();
        const linkedinUrl = (row['URL'] || row['url'] || row['Profile URL'] || row['profile url'] || '').trim();

        if (!company) {
          skippedMissingCompany++;
          continue;
        }

        const compKey = normalizeKey(company);
        if (!companyMap.has(compKey)) {
          companyMap.set(compKey, {
            displayName: company,
            contacts: [],
            domain: email ? email.split('@')[1] || '' : '',
          });
        }

        const companyEntry = companyMap.get(compKey);
        if (email && !companyEntry.domain) {
          const domain = email.split('@')[1] || '';
          if (domain && !domain.match(/gmail|yahoo|hotmail|outlook|icloud|aol|mail/i)) {
            companyEntry.domain = domain;
          }
        }

        companyEntry.contacts.push({
          firstName,
          lastName,
          fullName,
          email,
          company,
          position,
          connectedOn,
          linkedinUrl,
        });
      }

      // Create accounts and contacts
      let accountsCreated = 0;
      let accountsUpdated = 0;
      let contactsCreated = 0;
      let duplicatesSkipped = 0;
      let planLimitedSkipped = 0;
      const warnings = [];
      
      const tenantAcctArray = getTenantArray(accountsByTenant, tenantId);
      const tenantContArray = getTenantArray(contactsByTenant, tenantId);
      
      const accountLimit = Number(plan.limits?.accounts ?? -1);
      const contactLimit = Number(plan.limits?.contacts ?? -1);
      let remainingNewAccounts = accountLimit === -1 ? Infinity : Math.max(0, accountLimit - tenantAcctArray.length);
      let remainingNewContacts = contactLimit === -1 ? Infinity : Math.max(0, contactLimit - tenantContArray.length);

      if (accountLimit !== -1 && remainingNewAccounts <= 0) {
        warnings.push(`Account limit reached for the ${plan.displayName || plan.name || 'current'} plan.`);
      }
      if (contactLimit !== -1 && remainingNewContacts <= 0) {
        warnings.push(`Contact limit reached for the ${plan.displayName || plan.name || 'current'} plan.`);
      }

      // Create fast lookups
      const existingContactsMap = new Map();
      for (const c of tenantContArray) {
        existingContactsMap.set(`${normalizeKey(c.fullName)}|${normalizeKey(c.companyName)}`, c);
      }

      const existingAccountsMap = new Map();
      for (const a of tenantAcctArray) {
        existingAccountsMap.set(normalizeKey(a.displayName), a);
      }

      for (const [normName, companyData] of companyMap) {
        let existingAccount = existingAccountsMap.get(normName);

        if (!existingAccount) {
          if (remainingNewAccounts <= 0) {
            planLimitedSkipped += companyData.contacts.length;
            continue;
          }
          if (!dryRun) {
            existingAccount = account({
              tenantId,
              displayName: companyData.displayName,
              domain: companyData.domain,
              connectionCount: companyData.contacts.length,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            accounts.push(existingAccount);
            tenantAcctArray.push(existingAccount);
          } else {
            existingAccount = { id: `dry-${normName}`, tenantId, displayName: companyData.displayName };
          }
          remainingNewAccounts--;
          accountsCreated++;
        } else {
          if (!dryRun) {
            existingAccount.connectionCount = (existingAccount.connectionCount || 0) + companyData.contacts.length;
            existingAccount.updatedAt = timestamp;
          }
          accountsUpdated++;
        }

        // Create contacts
        let newSeniorCount = 0;
        let newTalentCount = 0;
        const newContacts = [];

        for (const c of companyData.contacts) {
          const contactKey = `${normalizeKey(c.fullName)}|${normName}`;
          const existing = existingContactsMap.get(contactKey);
          if (existing) {
            duplicatesSkipped++;
            if (['executive', 'director', 'vp'].includes(existing.seniority)) newSeniorCount++;
            if (existing.isTalentLeader) newTalentCount++;
            continue;
          }
          if (remainingNewContacts <= 0) {
            planLimitedSkipped++;
            continue;
          }

          const seniority = classifySeniority(c.position);
          const isTalent = isTalentTitle(c.position);
          const priorityScore = computeContactPriority(seniority, isTalent, c.email);
          
          if (['executive', 'director', 'vp'].includes(seniority)) newSeniorCount++;
          if (isTalent) newTalentCount++;

          if (!dryRun) {
            const contactItem = contact({
              tenantId,
              accountId: existingAccount.id,
              firstName: c.firstName,
              lastName: c.lastName,
              fullName: c.fullName,
              email: c.email,
              linkedinUrl: c.linkedinUrl,
              companyName: c.company,
              title: c.position,
              connectedOn: c.connectedOn,
              priorityScore,
              seniority,
              isTalentLeader: isTalent,
              source: 'linkedin_csv',
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            contacts.push(contactItem);
            tenantContArray.push(contactItem);
            newContacts.push(contactItem);
          }
          remainingNewContacts--;
          contactsCreated++;
        }

        // Update account scores using aggregated data instead of filtering global array
        if (!dryRun) {
          existingAccount.seniorContactCount = (existingAccount.seniorContactCount || 0) + newSeniorCount;
          existingAccount.talentContactCount = (existingAccount.talentContactCount || 0) + newTalentCount;
          existingAccount.connectionCount = (existingAccount.connectionCount || 0) + newContacts.length;
          existingAccount.contactCount = existingAccount.connectionCount;
          
          // Simple target score based on connections
          existingAccount.targetScore = Math.min(100, Math.round(
            (existingAccount.connectionCount * 8) +
            (existingAccount.seniorContactCount * 15) +
            (existingAccount.talentContactCount * 20)
          ));
          existingAccount.dailyScore = existingAccount.targetScore;
        }
      }

      if (planLimitedSkipped > 0) {
        warnings.push(`${planLimitedSkipped} rows were skipped because the current plan limit was reached.`);
      }
      if (skippedMissingName > 0 || skippedMissingCompany > 0) {
        warnings.push(`${skippedMissingName + skippedMissingCompany} rows were skipped because they were missing a name or company.`);
      }

      // Mark setup as complete after import
      const profile = getTenantProfile(tenantId);
      if (profile && !dryRun) profile.settings.setupComplete = true;

      // Persist all imported data
      if (!dryRun) {
        const tenantAccts = getTenantArray(accountsByTenant, tenantId);
        tenantAccts.sort((a, b) => (b.targetScore || 0) - (a.targetScore || 0));
        const tenantContacts = getTenantArray(contactsByTenant, tenantId);
        tenantContacts.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
        persistTenant(tenantId);
      }

      const stats = {
        rowsParsed: rows.length,
        imported: contactsCreated,
        updated: accountsUpdated,
        skipped: skippedMissingName + skippedMissingCompany + duplicatesSkipped + planLimitedSkipped,
        failed: 0,
        accountsCreated,
        accountsUpdated,
        contactsCreated,
        contacts: dryRun ? contactsForTenant(tenantId).length + contactsCreated : contactsForTenant(tenantId).length,
        companies: dryRun ? accountsForTenant(tenantId).length + accountsCreated : accountsForTenant(tenantId).length,
        duplicatesSkipped,
        planLimitedSkipped,
        missingNameRows: skippedMissingName,
        missingCompanyRows: skippedMissingCompany,
      };

      return {
        ok: true,
        dryRun,
        stats,
        summary: stats,
        warnings,
      };
    },
  };
}

const processStartedAt = now();


function normalizeConfigPatch(input) {
  const output = { ...input };
  if (output.ats && !output.atsType) output.atsType = output.ats;
  if (output.atsType && !output.ats) output.ats = output.atsType;
  if (Object.prototype.hasOwnProperty.call(output, 'active')) {
    output.active = output.active === true || output.active === 'true';
  }
  return output;
}

function buildDraft({ account: itemAccount, contact: itemContact, jobs: accountJobs, template, jobId }) {
  const specificJob = jobId ? accountJobs.find(j => j.id === jobId) : null;
  const roles = accountJobs.slice(0, 3).map((item) => item.title);
  const roleList = specificJob ? specificJob.title : roles.join(', ');
  
  const firstName = itemContact?.firstName || itemContact?.fullName?.split(' ')[0] || 'there';
  
  if (template === 'job_intro' || template === 'job_networking' || template === 'job_referral') {
    const jobMention = specificJob ? `the ${specificJob.title} position` : `the open roles`;
    let subjectLine = `Interested in ${itemAccount.displayName} - ${jobMention}`;
    let messageBody = [];
    
    if (template === 'job_intro') {
      subjectLine = `${specificJob ? specificJob.title + ' role' : 'Opportunities'} at ${itemAccount.displayName}`;
      messageBody = [
        `Hi ${firstName},`,
        '',
        `I saw that ${itemAccount.displayName} is hiring for ${jobMention} and wanted to reach out directly.`,
        '',
        `Given your role as ${itemContact?.title || 'a leader on the team'}, I'd love to connect and share a bit about my background and how it aligns with what you're building.`,
        '',
        'Do you have 10 minutes next week for a quick intro?',
      ];
    } else if (template === 'job_networking') {
      subjectLine = `Connecting - ${itemContact?.title || 'Team'} at ${itemAccount.displayName}`;
      messageBody = [
        `Hi ${firstName},`,
        '',
        `I've been following ${itemAccount.displayName}'s recent growth and noticed you are hiring for ${jobMention}.`,
        '',
        `I am actively exploring new opportunities in this space and would love to hear your perspective on the team's direction.`,
        '',
        'Would you be open to a quick 15-minute coffee chat or virtual intro next week?',
      ];
    } else if (template === 'job_referral') {
      subjectLine = `Question about ${itemAccount.displayName} - ${jobMention}`;
      messageBody = [
        `Hi ${firstName},`,
        '',
        `I'm preparing to apply for ${jobMention} at ${itemAccount.displayName}.`,
        '',
        `I noticed your background in a similar space and thought you might have some insight into the team culture and what the hiring manager is looking for.`,
        '',
        'Would you be open to chatting briefly or passing my resume along if it looks like a fit?',
      ];
    }
    
    const linkedinMessage = `Hi ${firstName}, saw ${itemAccount.displayName} is hiring for ${jobMention}. I'm exploring new roles and would love to connect and learn more about your team.`;
    
    return {
      account_id: itemAccount.id,
      contact_name: itemContact?.fullName || '',
      contact_title: itemContact?.title || '',
      template_key: template,
      template_label: 'Job Seeker note',
      persona_label: itemContact?.title || 'Contact',
      subject_line: subjectLine,
      subject_options: [subjectLine, `Connecting regarding ${itemAccount.displayName}`, `Quick question about ${itemAccount.displayName}`],
      message_body: messageBody.join('\n'),
      linkedin_message: linkedinMessage,
      follow_up_message: `Hi ${firstName}, just floating this to the top of your inbox. Let me know if you have time to chat!`,
      call_opener: `Hi ${firstName}, calling regarding ${jobMention} at ${itemAccount.displayName}.`,
      why_now: `Applying for ${jobMention}`,
      contact_hook: `You are reaching out to ${itemContact?.title || 'someone'} at the company.`,
      angle_summary: `Job seeker intro focusing on ${jobMention}.`,
      signal_focus: specificJob ? specificJob.title : roles.join(', '),
      suggested_next_step: 'Send email and connect on LinkedIn.',
      company_snippet: `${itemAccount.displayName} is hiring for ${jobMention}.`,
      timings: { generatedMs: 1 },
      variants: [],
    };
  }

  // Fallback to original B2B Sales logic for other templates
  const openRoleLine = roles.length
    ? `${itemAccount.displayName} has live roles showing up, including ${roleList}.`
    : `${itemAccount.displayName} has hiring movement worth watching.`;
  const persona = template === 'executive' ? 'commercial urgency' : template === 'hiring_manager' ? 'team bandwidth' : 'recruiting bandwidth';
  const subjectLine = `${itemAccount.displayName} hiring signal`;
  const messageBody = [
    `Hi ${firstName},`,
    '',
    `${openRoleLine} I help recruiting teams turn that kind of demand into a cleaner shortlist and warmer outreach.`,
    '',
    `Given your role as ${itemContact?.title || 'a leader on the team'}, I thought it may be useful to compare notes on ${persona} and where outside help could remove bottlenecks.`,
    '',
    'Open to a quick conversation next week?',
  ].join('\n');
  const linkedinMessage = `Hi ${firstName}, noticed ${itemAccount.displayName} is hiring around ${roleList || 'priority roles'}. I help teams prioritize recruiting outreach around live hiring signals. Worth comparing notes?`;

  return {
    account_id: itemAccount.id,
    contact_name: itemContact?.fullName || '',
    contact_title: itemContact?.title || '',
    template_key: template || 'cold',
    template_label: 'Cloud tailored note',
    persona_label: itemContact?.title || 'Contact',
    subject_line: subjectLine,
    subject_options: [subjectLine, `Hiring support for ${itemAccount.displayName}`, `${itemAccount.displayName} talent bandwidth`],
    message_body: messageBody,
    linkedin_message: linkedinMessage,
    follow_up_message: `Hi ${firstName}, circling back on my note about ${itemAccount.displayName}'s hiring priorities. Worth a quick chat?`,
    call_opener: `I was reaching out because ${itemAccount.displayName} has ${accountJobs.length || 'several'} active hiring signals and I wanted to understand where recruiting bandwidth is tightest.`,
    why_now: itemAccount.targetScoreExplanation || itemAccount.recommendedAction || '',
    contact_hook: itemContact?.title ? `${itemContact.title} appears close to the hiring and recruiting workflow.` : '',
    angle_summary: `Lead with ${persona} and the visible role demand.`,
    signal_focus: roles.join(', '),
    suggested_next_step: 'Send email and LinkedIn note, then follow up in one week.',
    company_snippet: `${itemAccount.displayName} is a ${itemAccount.industry || 'target'} account with ${itemAccount.openRoleCount || accountJobs.length} open roles.`,
    timings: { generatedMs: 1 },
    variants: [],
  };
}

function buildFilters(tenantId) {
  const tenantAccounts = accountsForTenant(tenantId);
  const tenantConfigs = boardConfigs.filter((item) => item.tenantId === tenantId);
  return {
    atsTypes: unique(tenantConfigs.map((item) => item.ats)),
    industries: unique(tenantAccounts.map((item) => item.industry).filter(Boolean)),
    statuses: unique(tenantAccounts.map((item) => item.status)),
    outreachStatuses: unique(tenantAccounts.map((item) => item.outreachStatus)),
    configDiscoveryStatuses: unique(tenantConfigs.map((item) => item.discoveryStatus)),
    configConfidenceBands: unique(tenantConfigs.map((item) => item.confidenceBand)),
    configReviewStatuses: unique(tenantConfigs.map((item) => item.reviewStatus)),
  };
}

function paginate(items, query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total: items.length,
  };
}

function filterText(items, query, fields) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) => fields.some((field) => String(item[field] || '').toLowerCase().includes(q)));
}

function pickPatch(input, fields) {
  const output = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(input || {}, field)) output[field] = input[field];
  }
  return output;
}

function accountsForTenant(tenantId) {
  return accountsByTenant.get(tenantId) || [];
}

function contactsForTenant(tenantId) {
  return contactsByTenant.get(tenantId) || [];
}

function jobsForTenant(tenantId) {
  return (jobsByTenant.get(tenantId) || [])
    .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
}

function activitiesForTenant(tenantId) {
  return (activitiesByTenant.get(tenantId) || [])
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

function tasksForTenant(tenantId) {
  return (tasksByTenant.get(tenantId) || [])
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

function accountById(accountId) {
  return accounts.find((item) => item.id === accountId);
}

function selectContact(accountContacts, contactName) {
  if (!accountContacts.length) return null;
  const normalized = normalizeKey(contactName || '');
  return accountContacts.find((item) => normalizeKey(item.fullName) === normalized || item.id === contactName) || accountContacts[0];
}

function assertTenant(tenantId) {
  if (!getTenantProfile(tenantId)) {
    const error = new Error('Tenant not found');
    error.status = 404;
    throw error;
  }
}

function ensureTenantProfile(tenantId, tenant = {}, user = {}) {
  if (!tenantId) return null;
  const tenantPersona = readPersona(tenant?.persona || tenant?.settings?.persona);
  if (tenantProfiles.has(tenantId)) {
    const existing = tenantProfiles.get(tenantId);
    if (tenantPersona && tenantPersona !== normalizePersona(existing.persona || existing.settings?.persona)) {
      existing.persona = tenantPersona;
      existing.settings.persona = tenantPersona;
      persistTenant(tenantId);
    }
    return existing;
  }
  const ownerName = user.name || user.email || 'Owner';
  const ownerEmail = user.email || '';
  const initialPersona = tenantPersona || 'bd';
  const profile = {
    workspace: {
      id: `workspace-${tenantId}`,
      tenantId,
      name: tenant.name || 'BD Engine Workspace',
      companyName: tenant.name || 'BD Engine Workspace',
      updatedAt: now(),
    },
    settings: {
      ...settings,
      setupComplete: false,
      ownerRoster: [
        { id: `owner-${tenantId}`, name: ownerName, displayName: ownerName, email: ownerEmail, role: 'Owner' },
      ],
      user: {
        name: ownerName,
        email: ownerEmail,
      },
      persona: initialPersona,
    },
    persona: initialPersona,
  };
  tenantProfiles.set(tenantId, profile);
  return profile;
}

function getTenantProfile(tenantId) {
  return tenantProfiles.get(tenantId) || null;
}

function normalizePersona(value) {
  return value === 'jobseeker' ? 'jobseeker' : 'bd';
}

function readPersona(value) {
  return value === 'jobseeker' || value === 'bd' ? value : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function countBy(items, field) {
  const counts = new Map();
  for (const item of items) {
    const key = item[field] || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({
    [field]: key,
    confidence: key,
    count,
  }));
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function inferDomainFromContacts(tenantId, accountId) {
  const contactItem = contacts.find((item) => item.tenantId === tenantId && item.accountId === accountId && item.email);
  const domain = contactItem?.email?.split('@')[1] || '';
  return domain && !domain.match(/gmail|yahoo|hotmail|outlook|icloud|aol|mail/i) ? domain : '';
}

function daysSince(value) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
}


// ── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  // LinkedIn CSVs sometimes have BOM or notes at the top — find the header row
  let headerIndex = 0;
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].toLowerCase().includes('first name') || lines[i].toLowerCase().includes('company')) {
      headerIndex = i;
      break;
    }
  }

  const headers = splitCSVLine(lines[headerIndex]);
  const rows = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVLine(line);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = (values[j] || '').trim();
    }
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ── Contact classification ───────────────────────────────────────────────────

function classifySeniority(title) {
  const t = (title || '').toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cpo|chro|chief|founder|president|partner)\b/.test(t)) return 'executive';
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return 'vp';
  if (/\b(director)\b/.test(t)) return 'director';
  if (/\b(manager|head of|lead)\b/.test(t)) return 'manager';
  if (/\b(senior|sr|principal)\b/.test(t)) return 'senior';
  return 'individual';
}

function isTalentTitle(title) {
  const t = (title || '').toLowerCase();
  return /\b(talent|recruit|people|hr|human resources|staffing|workforce)\b/.test(t);
}

function computeContactPriority(seniority, isTalent, email) {
  let score = 30;
  const seniorityBonus = { executive: 40, vp: 35, director: 30, manager: 20, senior: 15, individual: 5 };
  score += seniorityBonus[seniority] || 5;
  if (isTalent) score += 20;
  if (email) score += 5;
  return Math.min(100, score);
}
