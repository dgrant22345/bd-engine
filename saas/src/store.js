const now = () => new Date().toISOString();

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

const boardConfigs = [
  {
    id: 'cfg-northstar',
    tenantId: seedTenant.id,
    companyName: 'Northstar Robotics',
    normalizedCompanyName: 'northstar robotics',
    ats: 'greenhouse',
    atsType: 'greenhouse',
    boardId: 'northstarrobotics',
    slug: 'northstarrobotics',
    active: true,
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    confidenceBand: 'high',
    source: 'seed',
    lastImportStatus: 'success',
  },
  {
    id: 'cfg-vertex',
    tenantId: seedTenant.id,
    companyName: 'Vertex Health Systems',
    normalizedCompanyName: 'vertex health systems',
    ats: 'lever',
    atsType: 'lever',
    boardId: 'vertexhealth',
    slug: 'vertexhealth',
    active: true,
    discoveryStatus: 'resolved',
    reviewStatus: 'approved',
    confidenceBand: 'high',
    source: 'seed',
    lastImportStatus: 'success',
  },
];

const accounts = [
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
  account({
    id: 'acct-lumen',
    displayName: 'LumenGrid Energy',
    domain: 'lumengrid.example',
    industry: 'Clean energy',
    location: 'Denver, CO',
    status: 'new',
    outreachStatus: 'not_started',
    targetScore: 78,
    dailyScore: 78,
    priorityTier: 'B',
    owner: '',
    connectionCount: 1,
    seniorContactCount: 1,
    talentContactCount: 0,
    buyerTitleCount: 1,
    jobCount: 1,
    openRoleCount: 5,
    newRoleCount7d: 0,
    jobsLast30Days: 1,
    hiringVelocity: 62,
    engagementScore: 22,
    relationshipStrengthScore: 64,
    alertPriorityScore: 70,
    nextAction: 'Find talent leader',
    nextActionAt: futureDate(7),
    recommendedAction: 'Map the talent function and test a technical buyer angle.',
    targetScoreExplanation: 'Active hiring for grid software and project delivery.',
    topContactName: 'Amara Patel',
    topContactTitle: 'Head of Engineering',
    atsTypesText: 'Ashby',
    hiringStatus: 'Active hiring',
    notes: 'Active hiring for grid software and project delivery.',
  }),
];

const contacts = [
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
    notes: 'Warm fit for recruiting delivery conversation.',
  }),
  contact({
    id: 'ct-marcus',
    accountId: 'acct-vertex',
    fullName: 'Marcus Lee',
    firstName: 'Marcus',
    lastName: 'Lee',
    email: 'marcus.lee@example.com',
    linkedinUrl: 'https://www.linkedin.com/in/marcus-lee',
    companyName: 'Vertex Health Systems',
    title: 'VP People',
    connectedOn: '2026-01-09',
    outreachStatus: 'ready_to_contact',
    priorityScore: 88,
    seniority: 'executive',
    isTalentLeader: true,
    notes: '',
  }),
  contact({
    id: 'ct-amara',
    accountId: 'acct-lumen',
    fullName: 'Amara Patel',
    firstName: 'Amara',
    lastName: 'Patel',
    email: '',
    linkedinUrl: 'https://www.linkedin.com/in/amara-patel',
    companyName: 'LumenGrid Energy',
    title: 'Head of Engineering',
    connectedOn: '2025-09-04',
    outreachStatus: 'not_started',
    priorityScore: 81,
    seniority: 'executive',
    isTalentLeader: false,
    notes: 'Technical buyer angle.',
  }),
];

const jobs = [
  job({
    id: 'job-controls',
    accountId: 'acct-northstar',
    title: 'Senior Controls Engineer',
    companyName: 'Northstar Robotics',
    location: 'Toronto, ON',
    source: 'Greenhouse',
    postedAt: pastDate(2),
  }),
  job({
    id: 'job-embedded',
    accountId: 'acct-northstar',
    title: 'Embedded Software Engineer',
    companyName: 'Northstar Robotics',
    location: 'Remote Canada',
    source: 'Greenhouse',
    postedAt: pastDate(5),
  }),
  job({
    id: 'job-data',
    accountId: 'acct-vertex',
    title: 'Data Platform Engineer',
    companyName: 'Vertex Health Systems',
    location: 'Boston, MA',
    source: 'Lever',
    postedAt: pastDate(1),
  }),
  job({
    id: 'job-grid',
    accountId: 'acct-lumen',
    title: 'Grid Software Program Manager',
    companyName: 'LumenGrid Energy',
    location: 'Denver, CO',
    source: 'Ashby',
    postedAt: pastDate(9),
  }),
];

const activities = [
  {
    id: 'act-seed',
    tenantId: seedTenant.id,
    accountId: 'acct-northstar',
    contactId: 'ct-priya',
    type: 'outreach',
    summary: 'Sent email + LinkedIn outreach to Priya Shah',
    notes: 'Manual seed activity for the SaaS prototype.',
    occurredAt: pastDate(3),
    createdAt: pastDate(3),
    metadata: { channels: ['email', 'linkedin'] },
  },
];

const followups = [
  {
    id: 'fu-priya',
    tenantId: seedTenant.id,
    accountId: 'acct-northstar',
    contactId: 'ct-priya',
    dueAt: `${futureDate(4)}T09:00:00.000Z`,
    status: 'open',
    note: 'Follow up with Priya Shah after email + LinkedIn outreach',
  },
];

const backgroundJobs = new Map();

export function createStore() {
  return {
    ensureTenant(tenant, user = {}) {
      return ensureTenantProfile(tenant?.id || tenant, tenant, user);
    },

    getSession() {
      return {
        tenant: { ...seedTenant },
        user: { ...seedUser },
        membership: { role: 'owner' },
      };
    },

    getSetupStatus(tenantId) {
      assertTenant(tenantId);
      const profile = getTenantProfile(tenantId);
      return {
        requiresSetup: !profile.settings.setupComplete,
        setupComplete: Boolean(profile.settings.setupComplete),
        licensingEnabled: false,
        workspaceName: profile.workspace.name,
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

    getBootstrap(tenantId, { includeFilters = false, session = null } = {}) {
      assertTenant(tenantId);
      const profile = getTenantProfile(tenantId);
      return {
        workspace: { ...profile.workspace },
        settings: { ...profile.settings },
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

    getDashboard(tenantId) {
      assertTenant(tenantId);
      const tenantAccounts = accountsForTenant(tenantId);
      const tenantJobs = jobsForTenant(tenantId);
      const newJobsToday = tenantJobs.filter((item) => daysSince(item.postedAt) <= 1);
      const followUpAccounts = tenantAccounts.filter((item) => item.nextActionAt);
      return {
        summary: {
          accountCount: tenantAccounts.length,
          hiringAccountCount: tenantAccounts.filter((item) => item.jobCount > 0).length,
          newJobsLast24h: newJobsToday.length,
          discoveredBoardCount: boardConfigs.length,
          needsResolutionCount: 1,
        },
        todayQueue: tenantAccounts,
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

    getDashboardExtended(tenantId) {
      assertTenant(tenantId);
      const tenantAccounts = accountsForTenant(tenantId);
      return {
        playbook: tenantAccounts.slice(0, 5),
        overdueFollowUps: [],
        staleAccounts: tenantAccounts.filter((item) => item.status === 'new'),
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

    findAccounts(tenantId, query) {
      assertTenant(tenantId);
      return paginate(filterText(accountsForTenant(tenantId), query.q, ['displayName', 'domain', 'industry', 'location', 'owner', 'notes']), query);
    },

    getAccountDetail(tenantId, accountId) {
      assertTenant(tenantId);
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

    patchAccount(tenantId, accountId, patch) {
      assertTenant(tenantId);
      const item = accountById(accountId);
      if (!item || item.tenantId !== tenantId) return null;
      Object.assign(item, pickPatch(patch, ['status', 'outreachStatus', 'priorityTier', 'notes', 'industry', 'location', 'domain', 'nextAction', 'nextActionAt', 'owner']));
      item.updatedAt = now();
      return item;
    },

    findContacts(tenantId, query) {
      assertTenant(tenantId);
      return paginate(filterText(contactsForTenant(tenantId), query.q, ['fullName', 'companyName', 'title', 'email', 'notes']), query);
    },

    patchContact(tenantId, contactId, patch) {
      assertTenant(tenantId);
      const item = contacts.find((contactItem) => contactItem.tenantId === tenantId && contactItem.id === contactId);
      if (!item) return null;
      Object.assign(item, pickPatch(patch, ['outreachStatus', 'notes', 'email', 'title', 'linkedinUrl']));
      item.updatedAt = now();
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
      return config;
    },

    patchConfig(tenantId, configId, patch) {
      assertTenant(tenantId);
      const config = boardConfigs.find((item) => item.tenantId === tenantId && item.id === configId);
      if (!config) return null;
      Object.assign(config, normalizeConfigPatch(pickPatch(patch, ['companyName', 'atsType', 'ats', 'boardId', 'domain', 'careersUrl', 'source', 'active', 'notes'])));
      if (config.companyName) config.normalizedCompanyName = normalizeKey(config.companyName);
      config.updatedAt = now();
      return config;
    },

    reviewConfig(tenantId, configId, payload) {
      assertTenant(tenantId);
      const config = boardConfigs.find((item) => item.tenantId === tenantId && item.id === configId);
      if (!config) return null;
      config.reviewStatus = payload.action === 'reject' ? 'rejected' : 'approved';
      config.active = payload.action !== 'reject';
      config.updatedAt = now();
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
      ]));
      return { ok: true, settings: { ...profile.settings } };
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
      return activity;
    },

    createOutreachDraft(tenantId, accountId, payload = {}) {
      assertTenant(tenantId);
      const detail = this.getAccountDetail(tenantId, accountId);
      if (!detail) return null;
      const selectedContact = selectContact(detail.contacts, payload.contactName);
      return buildDraft({ account: detail.account, contact: selectedContact, jobs: detail.jobs, template: payload.template });
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

    getBackgroundJob(jobId) {
      return backgroundJobs.get(jobId) || this.createCompletedJob(jobId).job;
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
  };
}

const processStartedAt = now();

function account(input) {
  return {
    tenantId: seedTenant.id,
    normalizedName: normalizeKey(input.displayName),
    createdAt: pastDate(30),
    updatedAt: now(),
    lastJobPostedAt: pastDate(2),
    lastContactedAt: '',
    daysSinceContact: 999,
    staleFlag: '',
    priority: input.priority || input.priorityTier || 'medium',
    networkStrength: input.networkStrength || (input.connectionCount > 1 ? 'warm' : 'mapped'),
    canonicalDomain: input.canonicalDomain || input.domain || '',
    careersUrl: input.careersUrl || '',
    enrichmentStatus: input.enrichmentStatus || 'enriched',
    enrichmentConfidence: input.enrichmentConfidence || 'medium',
    jobsLast90Days: input.jobsLast90Days || input.jobsLast30Days || 0,
    hiringSpikeScore: input.hiringSpikeScore || 0,
    externalRecruiterLikelihoodScore: input.externalRecruiterLikelihoodScore || 0,
    companyGrowthSignalScore: input.companyGrowthSignalScore || 0,
    avgRoleSeniorityScore: input.avgRoleSeniorityScore || 0,
    tags: [],
    aliases: [],
    ...input,
  };
}

function contact(input) {
  return {
    tenantId: seedTenant.id,
    createdAt: pastDate(20),
    updatedAt: now(),
    source: 'seed',
    sourceMetadata: {},
    ...input,
  };
}

function job(input) {
  return {
    tenantId: seedTenant.id,
    active: true,
    atsType: input.atsType || input.source || 'unknown',
    sourceUrl: '',
    createdAt: pastDate(10),
    updatedAt: now(),
    ...input,
  };
}

function normalizeConfigPatch(input) {
  const output = { ...input };
  if (output.ats && !output.atsType) output.atsType = output.ats;
  if (output.atsType && !output.ats) output.ats = output.atsType;
  if (Object.prototype.hasOwnProperty.call(output, 'active')) {
    output.active = output.active === true || output.active === 'true';
  }
  return output;
}

function buildDraft({ account: itemAccount, contact: itemContact, jobs: accountJobs, template }) {
  const roles = accountJobs.slice(0, 3).map((item) => item.title);
  const roleList = roles.join(', ');
  const openRoleLine = roles.length
    ? `${itemAccount.displayName} has live roles showing up, including ${roleList}.`
    : `${itemAccount.displayName} has hiring movement worth watching.`;
  const firstName = itemContact?.firstName || itemContact?.fullName?.split(' ')[0] || 'there';
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
  return accounts
    .filter((item) => item.tenantId === tenantId)
    .sort((a, b) => b.targetScore - a.targetScore);
}

function contactsForTenant(tenantId) {
  return contacts
    .filter((item) => item.tenantId === tenantId)
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

function jobsForTenant(tenantId) {
  return jobs
    .filter((item) => item.tenantId === tenantId)
    .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
}

function activitiesForTenant(tenantId) {
  return activities
    .filter((item) => item.tenantId === tenantId)
    .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
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
  if (tenantProfiles.has(tenantId)) return tenantProfiles.get(tenantId);
  const ownerName = user.name || user.email || 'Owner';
  const ownerEmail = user.email || '';
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
    },
  };
  tenantProfiles.set(tenantId, profile);
  return profile;
}

function getTenantProfile(tenantId) {
  return tenantProfiles.get(tenantId) || null;
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

function daysSince(value) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
}

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function pastDate(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}
