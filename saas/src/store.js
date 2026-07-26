import { createHash } from 'node:crypto';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import { dbClassifyLegacyAccounts, dbLoadAllTenantData, dbLoadBackgroundJob, dbLoadRecentBackgroundJobs, dbLoadRecoverableBackgroundJobs, dbRecordAuditLog, dbRecordImportRun, dbRecordProductEvent, dbSaveBackgroundJob, dbSaveTenantData, isDbEnabled } from './db.js';
import { primeTenantRelationalMirror, syncTenantRelationalMirror, wipeTenantRelationalMirror } from './relational-writes.js';
import { compareTenantDataCounts, findTenantAccountsRelational, findTenantConfigsRelational, findTenantContactsRelational, findTenantJobsRelational, getTenantFiltersRelational, getTenantRelationalStats, getTenantUsageCountsRelational, loadTenantRelationalData } from './relational-reads.js';
import { buildProductEvent } from './product-analytics.js';
import { summarizeOperationalJobs } from './operational-metrics.js';
import { decorateAccountsWithConfigs } from './account-resolution.js';
import { safeErrorSummary } from './operational-logging.js';

const now = () => new Date().toISOString();
const DASHBOARD_EXTENDED_QUEUE_LIMIT = 50;
const DEFAULT_ATS_FETCH_CONCURRENCY = readPositiveInteger(process.env.BD_ATS_FETCH_CONCURRENCY, 8);
const DEFAULT_ATS_DISCOVERY_CONCURRENCY = readPositiveInteger(process.env.BD_ATS_DISCOVERY_CONCURRENCY, 8);
const DEFAULT_ATS_CAREERS_SCRAPE_TIMEOUT_MS = readPositiveInteger(process.env.BD_ATS_CAREERS_SCRAPE_TIMEOUT_MS, 5000);
const DEFAULT_ATS_MAX_PAGES = readPositiveInteger(process.env.BD_ATS_MAX_PAGES, 10);
const DEFAULT_WORKDAY_MAX_PAGES = readPositiveInteger(process.env.BD_WORKDAY_MAX_PAGES, 50);
const DEFAULT_IMPORT_DISCOVERY_LIMIT = readPositiveInteger(process.env.BD_IMPORT_DISCOVERY_LIMIT, 250);
const DEFAULT_ATS_MAX_DISCOVERY_BATCH = readPositiveInteger(process.env.BD_ATS_MAX_DISCOVERY_BATCH, 150);
const DEFAULT_IMPORT_DISCOVERY_MIN_READY = readPositiveInteger(process.env.BD_IMPORT_DISCOVERY_MIN_READY, 100);
const CONFIG_ATS_URL_FIELDS = ['apiUrl', 'resolvedBoardUrl', 'sourceUrl', 'boardUrl', 'careersUrl', 'url'];
const STATIC_CAREERS_MIN_JOB_LINKS = readPositiveInteger(process.env.BD_STATIC_CAREERS_MIN_JOB_LINKS, 3);
const STATIC_CAREERS_MAX_JOBS = readPositiveInteger(process.env.BD_STATIC_CAREERS_MAX_JOBS, 500);
const ATS_PAGE_FETCH_CONCURRENCY = readPositiveInteger(process.env.BD_ATS_PAGE_FETCH_CONCURRENCY, 6);
const ATS_DISCOVERY_PROBE_CONCURRENCY = readPositiveInteger(process.env.BD_ATS_DISCOVERY_PROBE_CONCURRENCY, 4);
const ATS_JSON_REQUEST_ATTEMPTS = readPositiveInteger(process.env.BD_ATS_JSON_REQUEST_ATTEMPTS, 3);
const ATS_RENDER_SERVICE_URL = String(process.env.BD_ATS_RENDER_SERVICE_URL || '').trim();
const ATS_RENDER_SERVICE_TOKEN = String(process.env.BD_ATS_RENDER_SERVICE_TOKEN || '').trim();
const ATS_RENDER_TIMEOUT_MS = readPositiveInteger(process.env.BD_ATS_RENDER_TIMEOUT_MS, 20000);
const RELATIONAL_READ_TENANTS = new Set(String(process.env.BD_RELATIONAL_READ_TENANTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const RELATIONAL_SQL_TENANTS = new Set(String(process.env.BD_RELATIONAL_SQL_TENANTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const RELATIONAL_SQL_CONTACT_TENANTS = new Set(String(process.env.BD_RELATIONAL_SQL_CONTACT_TENANTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const RELATIONAL_SQL_JOB_TENANTS = new Set(String(process.env.BD_RELATIONAL_SQL_JOB_TENANTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const RELATIONAL_SQL_CONFIG_TENANTS = new Set(String(process.env.BD_RELATIONAL_SQL_CONFIG_TENANTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const RELATIONAL_USAGE_TENANTS = new Set(String(process.env.BD_RELATIONAL_USAGE_TENANTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const RELATIONAL_WRITE_TENANTS = new Set(String(process.env.BD_RELATIONAL_WRITE_TENANTS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean));
const durableRelationalWriteTenants = new Set();
const confirmedRelationalSqlTenants = new Set();
const confirmedRelationalContactSqlTenants = new Set();
const confirmedRelationalJobSqlTenants = new Set();
const confirmedRelationalConfigSqlTenants = new Set();
const confirmedRelationalUsageTenants = new Set();

function relationalReadsEnabledForTenant(tenantId) {
  return relationalWritesPrimaryForTenant(tenantId) || RELATIONAL_READ_TENANTS.has('*') || RELATIONAL_READ_TENANTS.has(tenantId);
}

function relationalSqlEnabledForTenant(tenantId) {
  return RELATIONAL_SQL_TENANTS.has('*') || RELATIONAL_SQL_TENANTS.has(tenantId);
}

function relationalContactSqlEnabledForTenant(tenantId) {
  return RELATIONAL_SQL_CONTACT_TENANTS.has('*') || RELATIONAL_SQL_CONTACT_TENANTS.has(tenantId);
}

function relationalJobSqlEnabledForTenant(tenantId) {
  return RELATIONAL_SQL_JOB_TENANTS.has('*') || RELATIONAL_SQL_JOB_TENANTS.has(tenantId);
}

function relationalConfigSqlEnabledForTenant(tenantId) {
  return RELATIONAL_SQL_CONFIG_TENANTS.has('*') || RELATIONAL_SQL_CONFIG_TENANTS.has(tenantId);
}

function relationalUsageEnabledForTenant(tenantId) {
  return RELATIONAL_USAGE_TENANTS.has('*') || RELATIONAL_USAGE_TENANTS.has(tenantId);
}

function relationalWritesPrimaryForTenant(tenantId) {
  return RELATIONAL_WRITE_TENANTS.has(tenantId) || durableRelationalWriteTenants.has(tenantId);
}

export function registerRelationalPrimaryTenant(tenantId) {
  if (tenantId) durableRelationalWriteTenants.add(tenantId);
  return relationalWritesPrimaryForTenant(tenantId);
}

export function getRelationalPrimaryTenantIds() {
  return [...new Set([...RELATIONAL_WRITE_TENANTS, ...durableRelationalWriteTenants])].filter((tenantId) => tenantId && tenantId !== '*');
}

async function hasRelationalParity(tenantId, includeContacts = false) {
  if (relationalWritesPrimaryForTenant(tenantId)) return true;
  const { dbGetTenantDataStats } = await import('./db.js');
  const [blobStats, relationalStats] = await Promise.all([
    dbGetTenantDataStats(tenantId),
    getTenantRelationalStats(tenantId),
  ]);
  if (!blobStats || !relationalStats) return false;
  return compareTenantDataCounts(blobStats, relationalStats, includeContacts).matches;
}

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
    // Timestamp + 8 random chars: the old 4-char suffix only had 1.68M values,
    // which statistically guarantees duplicate ids at 10k+ records.
    id: `acct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: seedTenant.id,
    normalizedName: input.displayName ? normalizeKey(input.displayName) : '',
    displayName: '',
    domain: '',
    industry: '',
    location: '',
    status: 'new',
    outreachStatus: 'not_started',
    // DATA-101: tracked targets get discovery/refresh; network companies
    // (imported employers the user has not selected) do not. Explicit
    // creation implies intent, so the factory defaults to tracked; bulk
    // LinkedIn imports override this to false. Legacy records without the
    // field are grandfathered as tracked (isTrackedTarget).
    tracked: true,
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
    id: `ct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    tenantId: seedTenant.id,
    active: true,
    atsType: input.atsType || input.source || 'unknown',
    sourceUrl: '',
    relevanceScore: null,
    relevanceBand: 'unscored',
    relevanceReasons: [],
    createdAt: now(),
    updatedAt: now(),
    ...input,
  };
}

function dashboardAccountSummary(item) {
  return {
    id: item.id,
    accountId: item.id,
    displayName: item.displayName,
    normalizedName: item.normalizedName,
    status: item.status,
    outreachStatus: item.outreachStatus,
    priority: item.priority,
    targetScore: item.targetScore,
    dailyScore: item.dailyScore,
    priorityTier: item.priorityTier,
    owner: item.owner,
    domain: item.domain,
    canonicalDomain: item.canonicalDomain,
    careersUrl: item.careersUrl,
    industry: item.industry,
    location: item.location,
    openRoleCount: item.openRoleCount,
    jobCount: item.jobCount,
    jobsLast30Days: item.jobsLast30Days,
    jobsLast90Days: item.jobsLast90Days,
    relevantRoleCount: item.relevantRoleCount,
    strongFitRoleCount: item.strongFitRoleCount,
    hiringVelocity: item.hiringVelocity,
    hiringStatus: item.hiringStatus,
    connectionCount: item.connectionCount,
    seniorContactCount: item.seniorContactCount,
    talentContactCount: item.talentContactCount,
    engagementScore: item.engagementScore,
    relationshipStrengthScore: item.relationshipStrengthScore,
    alertPriorityScore: item.alertPriorityScore,
    networkStrength: item.networkStrength,
    companyGrowthSignalScore: item.companyGrowthSignalScore,
    enrichmentConfidence: item.enrichmentConfidence,
    enrichmentStatus: item.enrichmentStatus,
    reviewReason: item.reviewReason,
    recommendedAction: item.recommendedAction,
    nextAction: item.nextAction,
    nextActionAt: item.nextActionAt,
    topContactName: item.topContactName,
    isOverdue: item.isOverdue,
    staleFlag: item.staleFlag,
    targetScoreExplanation: item.targetScoreExplanation,
  };
}

function dashboardJobSummary(item) {
  return {
    id: item.id,
    accountId: item.accountId,
    title: item.title,
    companyName: item.companyName,
    location: item.location,
    department: item.department,
    atsType: item.atsType,
    jobUrl: item.jobUrl,
    url: item.url,
    jobId: item.jobId,
    postedAt: item.postedAt,
    retrievedAt: item.retrievedAt,
    importedAt: item.importedAt,
    active: item.active,
    isNew: item.isNew,
    isGta: item.isGta,
    relevanceScore: item.relevanceScore,
    relevanceBand: item.relevanceBand,
    relevanceReasons: item.relevanceReasons,
  };
}

function buildPersonaActionPlan(persona, accountItem = {}, context = {}) {
  const normalizedPersona = normalizePersona(persona);
  const isJobSeeker = normalizedPersona === 'jobseeker';
  const accountJobs = [...(context.jobs || [])]
    .filter((item) => item?.active !== false)
    .sort((a, b) => String(b.postedAt || b.importedAt || '').localeCompare(String(a.postedAt || a.importedAt || '')));
  const accountContacts = [...(context.contacts || [])]
    .sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0));
  const accountConfigs = context.configs || [];
  const newestJob = accountJobs[0] || null;
  const topContact = accountContacts[0] || null;
  const score = Number(accountItem.targetScore || accountItem.dailyScore || 0);
  const resolvedBoards = accountConfigs.filter(isResolvedBoardConfig).length;
  const companyName = accountItem.displayName || accountItem.companyName || 'this company';
  const items = [];
  const addItem = (item) => {
    if (!item?.title) return;
    items.push({
      id: item.id || `action-${items.length + 1}`,
      type: item.type || 'next_step',
      title: item.title,
      description: item.description || '',
      tone: item.tone || 'neutral',
      cta: item.cta || 'Open',
      template: item.template || '',
      jobId: item.jobId || '',
      href: item.href || '',
      metricLabel: item.metricLabel || '',
      metricValue: item.metricValue ?? '',
      accountId: accountItem.id || accountItem.accountId || '',
      companyName,
    });
  };

  if (isJobSeeker) {
    addItem(newestJob ? {
      id: 'apply-role',
      type: 'application',
      title: `Apply to ${newestJob.title}`,
      description: `Use the live role at ${companyName} as the anchor for your application and outreach.`,
      tone: newestJob.isNew ? 'success' : 'accent',
      cta: 'Open role',
      template: 'job_intro',
      jobId: newestJob.id,
      href: newestJob.jobUrl || newestJob.url || '',
      metricLabel: 'Open roles',
      metricValue: accountJobs.length,
    } : {
      id: 'watch-roles',
      type: 'role_watch',
      title: 'Keep role discovery fresh',
      description: `${companyName} has no imported active roles yet. Run discovery/import or verify the careers page before prioritizing an application.`,
      tone: resolvedBoards ? 'warning' : 'neutral',
      cta: resolvedBoards ? 'Import jobs' : 'Review board',
      metricLabel: 'ATS boards',
      metricValue: resolvedBoards,
    });
    addItem(topContact ? {
      id: 'warm-referral',
      type: 'referral',
      title: `Ask ${topContact.fullName} for context`,
      description: 'Use the warm contact path for a referral, team context, or hiring-manager intro.',
      tone: 'success',
      cta: 'Draft referral ask',
      template: 'job_referral',
      jobId: newestJob?.id || '',
      metricLabel: 'Contact score',
      metricValue: topContact.priorityScore || accountItem.relationshipStrengthScore || 0,
    } : {
      id: 'map-contact',
      type: 'network',
      title: 'Map a warm contact',
      description: 'Import LinkedIn connections or add a hiring contact before sending a cold application follow-up.',
      tone: 'warning',
      cta: 'Add contact',
      metricLabel: 'Contacts',
      metricValue: accountContacts.length,
    });
    addItem({
      id: 'company-research',
      type: 'research',
      title: 'Build a company-specific angle',
      description: accountItem.targetScoreExplanation || accountItem.recommendedAction || `Review roles, team language, and recent hiring at ${companyName}.`,
      tone: score >= 70 ? 'accent' : 'neutral',
      cta: 'Review company',
      metricLabel: 'Fit score',
      metricValue: score,
    });
    if (accountItem.nextAction) {
      addItem({
        id: 'follow-up',
        type: 'follow_up',
        title: accountItem.nextAction,
        description: accountItem.nextActionAt ? `Due ${accountItem.nextActionAt}.` : 'Already queued as the next move.',
        tone: accountItem.isOverdue ? 'danger' : 'warning',
        cta: 'Work next move',
        template: newestJob ? 'job_networking' : '',
        jobId: newestJob?.id || '',
        metricLabel: 'Due',
        metricValue: accountItem.nextActionAt ? String(accountItem.nextActionAt).slice(0, 10) : '',
      });
    }
    return {
      persona: normalizedPersona,
      title: 'Job search action plan',
      summary: newestJob
        ? `Turn ${companyName}'s live hiring signal into an application, referral ask, and follow-up.`
        : `Get ${companyName} ready for job-search outreach by refreshing roles and mapping a contact.`,
      items: items.slice(0, 4),
    };
  }

  addItem(topContact ? {
    id: 'message-contact',
    type: 'outreach',
    title: `Message ${topContact.fullName}`,
    description: accountJobs.length
      ? `Lead with ${accountJobs.length} active role${accountJobs.length === 1 ? '' : 's'} and ask where hiring bandwidth is tight.`
      : 'Lead with a lightweight check-in and confirm whether hiring support is relevant.',
    tone: 'success',
    cta: 'Draft sales note',
    template: topContact.isTalentLeader ? 'talent_partner' : 'cold',
    jobId: newestJob?.id || '',
    metricLabel: 'Contact score',
    metricValue: topContact.priorityScore || accountItem.relationshipStrengthScore || 0,
  } : {
    id: 'map-buyer',
    type: 'contact_gap',
    title: 'Map a buyer or talent leader',
    description: 'This account needs a stronger contact path before outreach will be credible.',
    tone: 'warning',
    cta: 'Review contacts',
    metricLabel: 'Contacts',
    metricValue: accountContacts.length,
  });
  addItem(accountJobs.length ? {
    id: 'hiring-trigger',
    type: 'hiring_signal',
    title: `Use ${accountJobs.length} active hiring signal${accountJobs.length === 1 ? '' : 's'}`,
    description: newestJob ? `Anchor the pitch on "${newestJob.title}" and adjacent demand.` : 'Use active roles as the reason to reach out now.',
    tone: accountItem.hiringVelocity >= 50 ? 'accent' : 'neutral',
    cta: 'Review roles',
    template: 'hiring_manager',
    jobId: newestJob?.id || '',
    metricLabel: 'Velocity',
    metricValue: accountItem.hiringVelocity || 0,
  } : {
    id: 'refresh-hiring',
    type: 'coverage',
    title: 'Refresh hiring coverage',
    description: resolvedBoards ? 'Run a live import to confirm whether this account is hiring now.' : 'Resolve the careers or ATS board before scoring this account too heavily.',
    tone: resolvedBoards ? 'warning' : 'neutral',
    cta: resolvedBoards ? 'Import jobs' : 'Resolve ATS',
    metricLabel: 'ATS boards',
    metricValue: resolvedBoards,
  });
  addItem({
    id: 'qualify-account',
    type: 'qualification',
    title: score >= 75 ? 'Qualify for active sequence' : 'Decide whether to nurture or pause',
    description: accountItem.targetScoreExplanation || accountItem.recommendedAction || 'Use score drivers, role demand, and network coverage to choose the next lane.',
    tone: score >= 75 ? 'accent' : 'neutral',
    cta: 'Review score',
    metricLabel: 'Target score',
    metricValue: score,
  });
  if (accountItem.nextAction) {
    addItem({
      id: 'follow-up',
      type: 'follow_up',
      title: accountItem.nextAction,
      description: accountItem.nextActionAt ? `Due ${accountItem.nextActionAt}.` : 'Already queued as the next move.',
      tone: accountItem.isOverdue ? 'danger' : 'warning',
      cta: 'Work next move',
      template: 'follow_up',
      jobId: newestJob?.id || '',
      metricLabel: 'Due',
      metricValue: accountItem.nextActionAt ? String(accountItem.nextActionAt).slice(0, 10) : '',
    });
  }

  return {
    persona: normalizedPersona,
    title: 'Sales action plan',
    summary: accountJobs.length
      ? `Use ${companyName}'s hiring demand and warmest contact to create a timely sales motion.`
      : `Tighten ${companyName}'s coverage before spending high-effort outreach.`,
    items: items.slice(0, 4),
  };
}

function buildDashboardActionPlan(persona, tenantAccounts = [], tenantJobs = [], tenantContacts = [], tenantConfigs = []) {
  const normalizedPersona = normalizePersona(persona);
  const jobsByAccountId = groupBy(tenantJobs.filter((item) => item.active !== false), 'accountId');
  const contactsByAccountId = groupBy(tenantContacts, 'accountId');
  const configsByAccountName = groupBy(tenantConfigs, (config) => normalizeKey(config.normalizedCompanyName || config.companyName));
  const candidates = tenantAccounts
    .slice(0, 8)
    .map((accountItem) => {
      const plan = buildPersonaActionPlan(normalizedPersona, accountItem, {
        jobs: jobsByAccountId.get(accountItem.id) || [],
        contacts: contactsByAccountId.get(accountItem.id) || [],
        configs: configsByAccountName.get(normalizeKey(accountItem.normalizedName || accountItem.displayName)) || [],
      });
      const primary = plan.items[0] || null;
      if (!primary) return null;
      return {
        ...primary,
        accountId: accountItem.id,
        companyName: accountItem.displayName,
        targetScore: accountItem.targetScore || accountItem.dailyScore || 0,
        openRoleCount: accountItem.openRoleCount || accountItem.jobCount || 0,
        relationshipStrengthScore: accountItem.relationshipStrengthScore || 0,
      };
    })
    .filter(Boolean);

  const topAccount = tenantAccounts[0] || null;
  return {
    persona: normalizedPersona,
    title: normalizedPersona === 'jobseeker' ? 'Job-search focus plan' : 'Sales focus plan',
    summary: normalizedPersona === 'jobseeker'
      ? 'Prioritize roles with live hiring signals, then turn the warmest contact into a referral path.'
      : 'Prioritize accounts with fresh hiring demand, then turn the warmest contact into timely outreach.',
    primaryAccountId: topAccount?.id || '',
    primaryCompany: topAccount?.displayName || '',
    items: candidates.slice(0, 5),
  };
}

function buildWorkspaceReadiness(persona, tenantAccounts = [], tenantJobs = [], tenantContacts = [], tenantConfigs = []) {
  const normalizedPersona = normalizePersona(persona);
  const isJobSeeker = normalizedPersona === 'jobseeker';
  const activeJobs = tenantJobs.filter((item) => item.active !== false);
  const resolvedConfigs = tenantConfigs.filter(isResolvedBoardConfig);
  const accountsWithDomain = tenantAccounts.filter((item) => item.domain || item.canonicalDomain || item.careersUrl);
  const accountsWithJobs = tenantAccounts.filter((item) => Number(item.jobCount || item.openRoleCount || 0) > 0);
  const accountsWithContacts = tenantAccounts.filter((item) => Number(item.connectionCount || item.seniorContactCount || item.talentContactCount || item.buyerTitleCount || 0) > 0);
  const accountsWithNextAction = tenantAccounts.filter((item) => item.nextAction || item.recommendedAction);
  const recentJobs = activeJobs.filter((item) => daysSince(item.importedAt || item.retrievedAt || item.postedAt) <= 7);
  const warmContacts = tenantContacts.filter((item) => Number(item.priorityScore || 0) >= 50);
  const thresholds = isJobSeeker
    ? { accounts: 15, contacts: 25, boards: 8, jobs: 20, nextActions: 5, domainsPct: 60 }
    : { accounts: 25, contacts: 50, boards: 12, jobs: 40, nextActions: 10, domainsPct: 70 };
  const domainCoveragePct = tenantAccounts.length ? Math.round((accountsWithDomain.length / tenantAccounts.length) * 100) : 0;
  const checks = [
    {
      id: 'accounts',
      label: isJobSeeker ? 'Target companies imported' : 'Target accounts imported',
      value: tenantAccounts.length,
      target: thresholds.accounts,
      met: tenantAccounts.length >= thresholds.accounts,
      action: isJobSeeker ? 'Add 15-30 companies you would genuinely apply to.' : 'Import 25-100 target accounts before selling from the workspace.',
    },
    {
      id: 'contacts',
      label: isJobSeeker ? 'Warm contacts mapped' : 'Buyer or talent contacts mapped',
      value: tenantContacts.length,
      target: thresholds.contacts,
      met: tenantContacts.length >= thresholds.contacts || warmContacts.length >= Math.ceil(thresholds.contacts / 2),
      action: 'Import LinkedIn connections or add decision-makers manually.',
    },
    {
      id: 'boards',
      label: 'Resolved ATS boards',
      value: resolvedConfigs.length,
      target: thresholds.boards,
      met: resolvedConfigs.length >= thresholds.boards,
      action: 'Run ATS discovery and review unresolved companies.',
    },
    {
      id: 'jobs',
      label: isJobSeeker ? 'Open roles tracked' : 'Hiring signals tracked',
      value: activeJobs.length,
      target: thresholds.jobs,
      met: activeJobs.length >= thresholds.jobs || accountsWithJobs.length >= Math.ceil(thresholds.accounts / 3),
      action: 'Run live job import after boards resolve.',
    },
    {
      id: 'next_actions',
      label: 'Actionable next steps',
      value: accountsWithNextAction.length,
      target: thresholds.nextActions,
      met: accountsWithNextAction.length >= thresholds.nextActions,
      action: 'Review top accounts and save next actions.',
    },
    {
      id: 'coverage',
      label: 'Company identity coverage',
      value: domainCoveragePct,
      target: thresholds.domainsPct,
      suffix: '%',
      met: domainCoveragePct >= thresholds.domainsPct,
      action: 'Fill domain and careers-page gaps for high-value companies.',
    },
  ];
  const score = Math.round(checks.reduce((sum, check) => {
    const pct = check.target ? Math.min(1, Number(check.value || 0) / check.target) : 0;
    return sum + (check.met ? 1 : pct * 0.7);
  }, 0) / checks.length * 100);
  const metCount = checks.filter((check) => check.met).length;
  const status = score >= 80 ? 'paid_ready' : score >= 55 ? 'trial_ready' : score >= 30 ? 'warming_up' : 'needs_setup';
  const title = {
    paid_ready: isJobSeeker ? 'Ready for a paid job-search workflow' : 'Ready for a paid sales workflow',
    trial_ready: 'Strong trial value; tighten coverage before upgrading',
    warming_up: 'Useful signals are forming',
    needs_setup: 'Not enough data to feel valuable yet',
  }[status];
  const summary = isJobSeeker
    ? 'A paid job-search workflow needs enough target companies, live roles, and warm paths to replace manual tracking.'
    : 'A paid sales workflow needs enough target accounts, contacts, live hiring signals, and next actions to guide daily work.';
  const nextBestActions = checks.filter((check) => !check.met).slice(0, 3).map((check) => ({
    id: check.id,
    title: check.action,
    metric: `${check.value}${check.suffix || ''} of ${check.target}${check.suffix || ''}`,
  }));
  const proofPoints = [
    `${tenantAccounts.length} ${isJobSeeker ? 'companies' : 'accounts'} in workspace`,
    `${activeJobs.length} active roles tracked`,
    `${resolvedConfigs.length} resolved ATS boards`,
    `${tenantContacts.length} mapped contacts`,
  ];

  return {
    persona: normalizedPersona,
    score,
    status,
    title,
    summary,
    metCount,
    totalChecks: checks.length,
    checks,
    nextBestActions,
    proofPoints,
    metrics: {
      accountCount: tenantAccounts.length,
      contactCount: tenantContacts.length,
      warmContactCount: warmContacts.length,
      activeJobCount: activeJobs.length,
      recentJobCount: recentJobs.length,
      resolvedBoardCount: resolvedConfigs.length,
      accountsWithJobs: accountsWithJobs.length,
      accountsWithContacts: accountsWithContacts.length,
      accountsWithDomain: accountsWithDomain.length,
      accountsWithNextAction: accountsWithNextAction.length,
      domainCoveragePct,
    },
  };
}

function groupBy(items = [], keyOrGetter) {
  const getter = typeof keyOrGetter === 'function'
    ? keyOrGetter
    : (item) => item?.[keyOrGetter];
  const grouped = new Map();
  for (const item of items) {
    const key = getter(item) || '';
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return grouped;
}

function dashboardContactSummary(item) {
  return {
    id: item.id,
    accountId: item.accountId,
    fullName: item.fullName,
    companyName: item.companyName,
    title: item.title,
    priorityScore: item.priorityScore,
    connectionCount: item.connectionCount,
    outreachStatus: item.outreachStatus,
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
  searchFocusByPersona: {
    bd: {
      targetRoles: '',
      excludedRoles: '',
      targetIndustries: '',
      workStyle: 'any',
      minimumRelevanceScore: 45,
    },
    jobseeker: {
      targetRoles: '',
      excludedRoles: '',
      targetIndustries: '',
      workStyle: 'any',
      minimumRelevanceScore: 45,
    },
  },
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
  [seedTenant.id, { workspace, settings, tenant: { ...seedTenant } }],
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

function replaceTenantItems(map, globalName, tenantId, items) {
  map.set(tenantId, items);
  if (globalName === 'accounts') accounts = accounts.filter((item) => item.tenantId !== tenantId).concat(items);
  if (globalName === 'contacts') contacts = contacts.filter((item) => item.tenantId !== tenantId).concat(items);
  if (globalName === 'jobs') jobs = jobs.filter((item) => item.tenantId !== tenantId).concat(items);
  if (globalName === 'configs') boardConfigs = boardConfigs.filter((item) => item.tenantId !== tenantId).concat(items);
  if (globalName === 'activities') activities = activities.filter((item) => item.tenantId !== tenantId).concat(items);
  if (globalName === 'tasks') tasks = tasks.filter((item) => item.tenantId !== tenantId).concat(items);
}

function mergeTenantItems(persisted = [], inMemory = []) {
  const merged = [];
  const seen = new Set();
  for (const item of [...persisted, ...inMemory]) {
    const key = item?.id || `${item?.tenantId || ''}:${JSON.stringify(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

// CG-009: sample/demo account rollups must be derived from the sample records
// themselves — a stored count that disagrees with the visible jobs/contacts is
// a trust failure (P0.3), and hard-coded demo numbers were exactly that.
function applyDerivedSampleCounts(accountList, contactList, jobList) {
  const dayMs = 86400000;
  const seniorLevels = new Set(['director', 'vp', 'head', 'chief', 'c_level', 'cxo', 'founder', 'partner']);
  for (const item of accountList) {
    const accountJobs = jobList.filter((jobItem) => jobItem.accountId === item.id);
    const activeJobs = accountJobs.filter((jobItem) => jobItem.active !== false);
    const ageDays = (jobItem) => (Date.now() - new Date(jobItem.postedAt || 0).getTime()) / dayMs;
    item.jobCount = activeJobs.length;
    item.openRoleCount = activeJobs.length;
    item.newRoleCount7d = activeJobs.filter((jobItem) => ageDays(jobItem) <= 7).length;
    item.jobsLast30Days = accountJobs.filter((jobItem) => ageDays(jobItem) <= 30).length;
    item.jobsLast90Days = accountJobs.filter((jobItem) => ageDays(jobItem) <= 90).length;
    const accountContacts = contactList.filter((contactItem) => contactItem.accountId === item.id);
    item.connectionCount = accountContacts.length;
    item.contactCount = accountContacts.length;
    item.activeJobCount = activeJobs.length;
    item.talentContactCount = accountContacts.filter((contactItem) => contactItem.isTalentLeader).length;
    item.seniorContactCount = accountContacts.filter(
      (contactItem) => seniorLevels.has(String(contactItem.seniority || '').toLowerCase())
    ).length;
  }
}

function buildSampleWorkspaceData(tenantId, persona = 'bd') {
  const isJobSeeker = normalizePersona(persona) === 'jobseeker';
  const id = (slug) => `sample-${tenantId}-${slug}`;
  const sampleAccounts = [
    account({
      id: id('northstar'),
      tenantId,
      displayName: 'Northstar Robotics',
      domain: 'northstar.example',
      canonicalDomain: 'northstar.example',
      careersUrl: 'https://northstar.example/careers',
      industry: 'Industrial automation',
      location: 'Toronto, ON',
      status: 'contacted',
      outreachStatus: 'contacted',
      targetScore: 91,
      dailyScore: 91,
      priorityTier: 'A',
      owner: 'Owner',
      connectionCount: 3,
      seniorContactCount: 2,
      talentContactCount: 1,
      buyerTitleCount: 1,
      jobCount: 3,
      openRoleCount: 14,
      newRoleCount7d: 2,
      jobsLast30Days: 3,
      jobsLast90Days: 7,
      hiringVelocity: 84,
      relationshipStrengthScore: 86,
      alertPriorityScore: 91,
      nextAction: isJobSeeker ? 'Ask Priya for team context' : 'Follow up with Priya Shah',
      nextActionAt: futureDate(2),
      recommendedAction: isJobSeeker ? 'Use Priya as the warm path before applying.' : 'Lead with controls hiring and recruiting bandwidth.',
      targetScoreExplanation: 'Fresh hiring plus a warm talent leader makes this the clearest next move.',
      topContactName: 'Priya Shah',
      topContactTitle: 'Director of Talent',
      atsTypesText: 'Greenhouse',
      hiringStatus: 'Active hiring',
      notes: 'Synthetic sample account. Safe to delete after exploring.',
    }),
    account({
      id: id('vertex'),
      tenantId,
      displayName: 'Vertex Health Systems',
      domain: 'vertexhealth.example',
      canonicalDomain: 'vertexhealth.example',
      careersUrl: 'https://vertexhealth.example/jobs',
      industry: 'Health technology',
      location: 'Boston, MA',
      status: 'researching',
      outreachStatus: 'ready_to_contact',
      targetScore: 84,
      dailyScore: 84,
      priorityTier: 'A',
      owner: 'Owner',
      connectionCount: 2,
      seniorContactCount: 1,
      talentContactCount: 1,
      buyerTitleCount: 1,
      jobCount: 2,
      openRoleCount: 8,
      newRoleCount7d: 1,
      jobsLast30Days: 2,
      jobsLast90Days: 5,
      hiringVelocity: 73,
      relationshipStrengthScore: 75,
      alertPriorityScore: 80,
      nextAction: isJobSeeker ? 'Draft referral ask to Marcus' : 'Draft VP People outreach',
      nextActionAt: futureDate(1),
      recommendedAction: 'Lead with data platform hiring and speed-to-shortlist.',
      targetScoreExplanation: 'New product hiring with a senior people leader in network.',
      topContactName: 'Marcus Lee',
      topContactTitle: 'VP People',
      atsTypesText: 'Lever',
      hiringStatus: 'Active hiring',
      notes: 'Synthetic sample account. Safe to delete after exploring.',
    }),
    account({
      id: id('luma'),
      tenantId,
      displayName: 'Luma Climate',
      domain: 'lumaclimate.example',
      canonicalDomain: 'lumaclimate.example',
      careersUrl: 'https://jobs.ashbyhq.com/lumaclimate',
      industry: 'Climate software',
      location: 'Remote',
      status: 'researching',
      outreachStatus: 'researching',
      targetScore: 72,
      dailyScore: 72,
      priorityTier: 'B',
      owner: 'Owner',
      connectionCount: 1,
      seniorContactCount: 1,
      talentContactCount: 0,
      buyerTitleCount: 1,
      jobCount: 1,
      openRoleCount: 5,
      newRoleCount7d: 0,
      jobsLast30Days: 1,
      jobsLast90Days: 3,
      hiringVelocity: 58,
      relationshipStrengthScore: 64,
      alertPriorityScore: 72,
      nextAction: 'Verify hiring manager path',
      nextActionAt: futureDate(5),
      recommendedAction: 'Research the platform team before outreach.',
      targetScoreExplanation: 'Moderate hiring and one executive contact.',
      topContactName: 'Elena Park',
      topContactTitle: 'Head of Partnerships',
      atsTypesText: 'Ashby',
      hiringStatus: 'Active hiring',
      notes: 'Synthetic sample account. Safe to delete after exploring.',
    }),
  ];
  const sampleContacts = [
    contact({ id: id('priya'), tenantId, accountId: id('northstar'), fullName: 'Priya Shah', firstName: 'Priya', lastName: 'Shah', email: 'priya.shah@example.com', linkedinUrl: 'https://www.linkedin.com/in/priya-shah', companyName: 'Northstar Robotics', title: 'Director of Talent', connectedOn: pastDate(90), outreachStatus: 'contacted', priorityScore: 93, seniority: 'director', isTalentLeader: true }),
    contact({ id: id('owen'), tenantId, accountId: id('northstar'), fullName: 'Owen Miller', firstName: 'Owen', lastName: 'Miller', email: 'owen.miller@example.com', linkedinUrl: 'https://www.linkedin.com/in/owen-miller', companyName: 'Northstar Robotics', title: 'VP Engineering', connectedOn: pastDate(160), outreachStatus: 'not_started', priorityScore: 81, seniority: 'vp', isTalentLeader: false }),
    contact({ id: id('marcus'), tenantId, accountId: id('vertex'), fullName: 'Marcus Lee', firstName: 'Marcus', lastName: 'Lee', email: 'marcus.lee@example.com', linkedinUrl: 'https://www.linkedin.com/in/marcus-lee', companyName: 'Vertex Health Systems', title: 'VP People', connectedOn: pastDate(45), outreachStatus: 'ready_to_contact', priorityScore: 88, seniority: 'vp', isTalentLeader: true }),
    contact({ id: id('elena'), tenantId, accountId: id('luma'), fullName: 'Elena Park', firstName: 'Elena', lastName: 'Park', email: 'elena.park@example.com', linkedinUrl: 'https://www.linkedin.com/in/elena-park', companyName: 'Luma Climate', title: 'Head of Partnerships', connectedOn: pastDate(220), outreachStatus: 'researching', priorityScore: 71, seniority: 'head', isTalentLeader: false }),
  ];
  const sampleJobs = [
    job({ id: id('controls-job'), tenantId, accountId: id('northstar'), title: 'Senior Controls Engineer', companyName: 'Northstar Robotics', location: 'Toronto, ON', source: 'Greenhouse', atsType: 'greenhouse', jobUrl: 'https://northstar.example/jobs/controls', postedAt: pastDate(2), retrievedAt: now(), importedAt: now(), isNew: true }),
    job({ id: id('embedded-job'), tenantId, accountId: id('northstar'), title: 'Embedded Robotics Developer', companyName: 'Northstar Robotics', location: 'Toronto, ON', source: 'Greenhouse', atsType: 'greenhouse', jobUrl: 'https://northstar.example/jobs/embedded', postedAt: pastDate(6), retrievedAt: now(), importedAt: now(), isNew: true }),
    job({ id: id('data-platform-job'), tenantId, accountId: id('vertex'), title: 'Data Platform Engineer', companyName: 'Vertex Health Systems', location: 'Boston, MA', source: 'Lever', atsType: 'lever', jobUrl: 'https://vertexhealth.example/jobs/data-platform', postedAt: pastDate(4), retrievedAt: now(), importedAt: now(), isNew: true }),
    job({ id: id('climate-pm-job'), tenantId, accountId: id('luma'), title: 'Product Manager, Climate Intelligence', companyName: 'Luma Climate', location: 'Remote', source: 'Ashby', atsType: 'ashby', jobUrl: 'https://jobs.ashbyhq.com/lumaclimate/pm', postedAt: pastDate(12), retrievedAt: now(), importedAt: now(), isNew: false }),
  ];
  const sampleConfigs = [
    { id: id('cfg-northstar'), tenantId, accountId: id('northstar'), companyName: 'Northstar Robotics', normalizedCompanyName: 'northstar robotics', ats: 'greenhouse', atsType: 'greenhouse', boardId: 'northstar', domain: 'northstar.example', careersUrl: 'https://northstar.example/careers', discoveryStatus: 'resolved', discoveryMethod: 'sample', confidenceBand: 'high', reviewStatus: 'approved', active: true, source: 'sample_workspace', createdAt: now(), updatedAt: now() },
    { id: id('cfg-vertex'), tenantId, accountId: id('vertex'), companyName: 'Vertex Health Systems', normalizedCompanyName: 'vertex health systems', ats: 'lever', atsType: 'lever', boardId: 'vertexhealth', domain: 'vertexhealth.example', careersUrl: 'https://vertexhealth.example/jobs', discoveryStatus: 'resolved', discoveryMethod: 'sample', confidenceBand: 'high', reviewStatus: 'approved', active: true, source: 'sample_workspace', createdAt: now(), updatedAt: now() },
    { id: id('cfg-luma'), tenantId, accountId: id('luma'), companyName: 'Luma Climate', normalizedCompanyName: 'luma climate', ats: 'ashby', atsType: 'ashby', boardId: 'lumaclimate', domain: 'lumaclimate.example', careersUrl: 'https://jobs.ashbyhq.com/lumaclimate', discoveryStatus: 'resolved', discoveryMethod: 'sample', confidenceBand: 'high', reviewStatus: 'approved', active: true, source: 'sample_workspace', createdAt: now(), updatedAt: now() },
  ];
  const sampleActivities = [
    { id: id('activity-sample'), tenantId, type: 'sample_workspace', summary: 'Loaded synthetic sample workspace', notes: 'Synthetic data for product exploration; no real personal data.', occurredAt: now(), createdAt: now(), createdByUserId: 'system' },
  ];
  const sampleTasks = [
    { id: id('task-sample'), tenantId, accountId: id('northstar'), summary: isJobSeeker ? 'Draft Priya referral ask' : 'Send Priya hiring-signal follow-up', dueDate: futureDate(2), status: 'pending', priority: 'high', createdAt: now(), updatedAt: now() },
  ];
  applyDerivedSampleCounts(sampleAccounts, sampleContacts, sampleJobs);
  return { accounts: sampleAccounts, contacts: sampleContacts, jobs: sampleJobs, configs: sampleConfigs, activities: sampleActivities, tasks: sampleTasks };
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
    status: 'researching',
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

// The local dev seed workspace claimed hard-coded rollups too — derive them
// from the seed records so the first thing a developer sees is coherent.
applyDerivedSampleCounts(accounts, contacts, jobs);
let followups = [];

// Populate maps from seed data
accounts.forEach(a => getTenantArray(accountsByTenant, a.tenantId).push(a));
contacts.forEach(c => getTenantArray(contactsByTenant, c.tenantId).push(c));
jobs.forEach(j => getTenantArray(jobsByTenant, j.tenantId).push(j));
boardConfigs.forEach(c => getTenantArray(configsByTenant, c.tenantId).push(c));
activities.forEach(a => getTenantArray(activitiesByTenant, a.tenantId).push(a));
tasks.forEach(t => getTenantArray(tasksByTenant, t.tenantId).push(t));

const backgroundJobs = new Map();
const persistedBackgroundJobSnapshots = new Map();

async function persistBackgroundJob(job) {
  if (!job?.id || !job.tenantId) return false;
  const snapshot = JSON.stringify(job);
  if (persistedBackgroundJobSnapshots.get(job.id) === snapshot) return true;
  const result = await dbSaveBackgroundJob(job.tenantId, job);
  if (result.recorded) persistedBackgroundJobSnapshots.set(job.id, snapshot);
  return result.recorded;
}

function trackBackgroundJob(tenantId, job) {
  Object.defineProperty(job, 'tenantId', {
    value: tenantId,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  backgroundJobs.set(job.id, job);
  persistBackgroundJob(job).catch((error) => console.error('Background job snapshot error:', safeErrorSummary(error)));
  return job;
}

function missingBackgroundJob(jobId) {
  return {
    id: jobId,
    type: 'unknown',
    status: 'failed',
    summary: 'Job not found',
    progressMessage: 'Job not found',
    errorMessage: 'This operation is no longer available. Please run it again.',
    queuedAt: null,
    startedAt: null,
    finishedAt: now(),
    recordsAffected: 0,
    result: null,
  };
}

function publicBackgroundJob(job) {
  if (!job) return job;
  const { recovery: _recovery, ...publicJob } = job;
  return publicJob;
}

function backgroundJobTimestamp(job = {}) {
  return Date.parse(job.updatedAt || job.finishedAt || job.startedAt || job.queuedAt || '') || 0;
}

function getNextScheduledRefreshAt(settings = {}, nowMs = Date.now()) {
  const intervalMs = 24 * 60 * 60 * 1000;
  const retryDelayMs = 60 * 60 * 1000;
  const successAt = Date.parse(settings.lastPipelineRun || '');
  if (Number.isFinite(successAt) && successAt > nowMs - intervalMs) {
    return new Date(successAt + intervalMs).toISOString();
  }
  const attemptAt = Date.parse(settings.lastPipelineAttemptAt || '');
  if (Number.isFinite(attemptAt) && attemptAt > nowMs - retryDelayMs) {
    return new Date(attemptAt + retryDelayMs).toISOString();
  }
  return new Date(nowMs).toISOString();
}

const RESUMABLE_BACKGROUND_JOB_TYPES = new Set(['live-job-import', 'linkedin-csv-import']);

export function getBackgroundJobRecoveryDecision(job = {}) {
  const recovery = job.recovery && typeof job.recovery === 'object' ? job.recovery : null;
  if (!recovery || !RESUMABLE_BACKGROUND_JOB_TYPES.has(job.type) || recovery.kind !== job.type) {
    return { recoverable: false, reason: 'missing_recovery_descriptor' };
  }
  const attempts = Math.max(0, Number(recovery.attempts) || 0);
  if (attempts >= 3) return { recoverable: false, reason: 'attempt_limit', attempts };
  if (job.type === 'linkedin-csv-import' && !String(recovery.csvText || '').trim()) {
    return { recoverable: false, reason: 'missing_csv_payload', attempts };
  }
  return { recoverable: true, reason: 'resumable', attempts };
}

export function getScheduledPipelineDecision({
  settings = {},
  hasActiveJob = false,
  nowMs = Date.now(),
  intervalMs = 24 * 60 * 60 * 1000,
  retryDelayMs = 60 * 60 * 1000,
} = {}) {
  if (!settings.setupComplete) return { due: false, reason: 'setup_incomplete' };
  if (hasActiveJob) return { due: false, reason: 'already_running' };
  const successAt = new Date(settings.lastPipelineRun || 0).getTime();
  if (Number.isFinite(successAt) && successAt > nowMs - intervalMs) {
    return { due: false, reason: 'fresh' };
  }
  const attemptAt = new Date(settings.lastPipelineAttemptAt || 0).getTime();
  if (Number.isFinite(attemptAt) && attemptAt > nowMs - retryDelayMs) {
    return { due: false, reason: 'recent_attempt' };
  }
  return { due: true, reason: 'overdue' };
}

function cloneRecoveryOptions(options = {}) {
  return JSON.parse(JSON.stringify(options, (_key, value) => (
    typeof value === 'function' || value === undefined ? undefined : value
  )));
}

async function persistQueuedBackgroundJob(job) {
  const recorded = await persistBackgroundJob(job);
  if (recorded || !isDbEnabled()) return;
  backgroundJobs.delete(job.id);
  persistedBackgroundJobSnapshots.delete(job.id);
  const error = new Error('The import queue is temporarily unavailable. Please try again.');
  error.status = 503;
  error.code = 'background_queue_unavailable';
  throw error;
}

function failInterruptedBackgroundJob(job, decision) {
  job.status = 'failed';
  job.finishedAt = now();
  job.updatedAt = job.finishedAt;
  job.progressMessage = decision.reason === 'attempt_limit'
    ? 'Stopped after repeated restart interruptions'
    : 'Interrupted by a service restart';
  job.errorMessage = decision.reason === 'attempt_limit'
    ? 'This operation was interrupted three times and was stopped. Please run it again.'
    : 'This operation was interrupted by a deployment or restart. Your saved workspace data is safe; please run the operation again.';
  delete job.recovery;
}

const backgroundJobSnapshotTimer = setInterval(() => {
  for (const job of backgroundJobs.values()) {
    persistBackgroundJob(job).catch((error) => console.error('Background job snapshot error:', safeErrorSummary(error)));
  }
}, 2 * 1000);
backgroundJobSnapshotTimer.unref?.();

function getTrackedJobCountFromResult(result = {}) {
  return Number(result.stats?.activeTrackedJobs || result.stats?.imported || result.importRun?.stats?.imported || 0);
}

function getTouchedJobCountFromResult(result = {}) {
  return Number(result.stats?.jobsTouched || result.stats?.runImported || result.stats?.newJobs || result.stats?.updatedJobs || 0);
}

// ── Debounced persistence ────────────────────────────────────────────────────

const pendingSaves = new Map();
const saveRetryCounts = new Map();

async function saveTenantNow(tenantId) {
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

  if (relationalWritesPrimaryForTenant(tenantId)) {
    const syncResult = await syncTenantRelationalMirror(tenantId, data, { reconcile: true });
    if (syncResult?.skipped) throw new Error('Relational primary write was skipped.');
    const settingsResult = await dbSaveTenantData(tenantId, { settings: data.settings }, { throwOnError: true });
    if (!settingsResult?.saved) throw new Error(`Workspace settings save failed: ${settingsResult?.reason || 'unknown error'}`);
  } else {
    await dbSaveTenantData(tenantId, data, { throwOnError: true });
    try {
      await syncTenantRelationalMirror(tenantId, data);
    } catch (err) {
      console.error('Relational mirror sync error:', safeErrorSummary(err));
    }
  }
  saveRetryCounts.delete(tenantId);
}

function scheduleTenantSave(tenantId, delayMs) {
  if (pendingSaves.has(tenantId)) clearTimeout(pendingSaves.get(tenantId));
  pendingSaves.set(tenantId, setTimeout(() => {
    pendingSaves.delete(tenantId);
    saveTenantNow(tenantId).catch((error) => {
      const attempt = (saveRetryCounts.get(tenantId) || 0) + 1;
      saveRetryCounts.set(tenantId, attempt);
      const retryDelay = Math.min(30000, 1000 * (2 ** Math.min(5, attempt - 1)));
      console.error(`Workspace persist error; retrying in ${retryDelay}ms:`, safeErrorSummary(error));
      scheduleTenantSave(tenantId, retryDelay);
    });
  }, delayMs));
}

function persistTenant(tenantId) {
  if (!isDbEnabled()) return;
  saveRetryCounts.delete(tenantId);
  scheduleTenantSave(tenantId, 500);
}

// Debounced writes still pending at shutdown would otherwise be dropped on
// every deploy/restart, silently losing up to 500ms of mutations (including
// whole CSV imports, which queue exactly one save).
export async function flushPendingSaves() {
  const tenantIds = [...pendingSaves.keys()];
  for (const tenantId of tenantIds) {
    clearTimeout(pendingSaves.get(tenantId));
    pendingSaves.delete(tenantId);
  }
  await Promise.all(tenantIds.map(async (tenantId) => {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await saveTenantNow(tenantId);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
    throw new Error(`Flush persist failed for ${tenantId}: ${lastError?.message || 'unknown error'}`);
  }));
  await Promise.all([...backgroundJobs.values()].map((job) =>
    persistBackgroundJob(job).catch((err) => console.error('Flush background job error:', safeErrorSummary(err)))
  ));
  return tenantIds.length;
}

const loadedTenants = new Map(); // tenantId -> { core: boolean, contacts: boolean }
const RESIDENT_TENANT_LIMIT = readPositiveInteger(process.env.BD_RESIDENT_TENANT_LIMIT, 8);
const RESIDENT_TENANT_IDLE_MS = readPositiveInteger(process.env.BD_RESIDENT_TENANT_IDLE_MS, 5 * 60 * 1000);
const BACKGROUND_JOB_RETENTION_MS = readPositiveInteger(process.env.BD_BACKGROUND_JOB_RETENTION_MS, 60 * 60 * 1000);
const LARGE_WORKSPACE_LOAD_THRESHOLDS = Object.freeze({
  accounts: readPositiveInteger(process.env.BD_LARGE_WORKSPACE_ACCOUNTS, 500),
  contacts: readPositiveInteger(process.env.BD_LARGE_WORKSPACE_CONTACTS, 1000),
  jobs: readPositiveInteger(process.env.BD_LARGE_WORKSPACE_JOBS, 1500),
  configs: readPositiveInteger(process.env.BD_LARGE_WORKSPACE_CONFIGS, 500),
  total: readPositiveInteger(process.env.BD_LARGE_WORKSPACE_TOTAL, 2500),
});

function hasActiveBackgroundJobs() {
  return [...backgroundJobs.values()].some((job) => job?.status === 'queued' || job?.status === 'running');
}

function removeResidentTenant(tenantId) {
  accountsByTenant.delete(tenantId);
  contactsByTenant.delete(tenantId);
  jobsByTenant.delete(tenantId);
  configsByTenant.delete(tenantId);
  activitiesByTenant.delete(tenantId);
  tasksByTenant.delete(tenantId);
  accounts = accounts.filter((item) => item.tenantId !== tenantId);
  contacts = contacts.filter((item) => item.tenantId !== tenantId);
  jobs = jobs.filter((item) => item.tenantId !== tenantId);
  boardConfigs = boardConfigs.filter((item) => item.tenantId !== tenantId);
  activities = activities.filter((item) => item.tenantId !== tenantId);
  tasks = tasks.filter((item) => item.tenantId !== tenantId);
  loadedTenants.delete(tenantId);
}

function evictIdleResidentTenants(protectedTenantId = '') {
  if (loadedTenants.size <= RESIDENT_TENANT_LIMIT || hasActiveBackgroundJobs()) return 0;
  const cutoff = Date.now() - RESIDENT_TENANT_IDLE_MS;
  const candidates = [...loadedTenants.entries()]
    .filter(([tenantId, status]) => tenantId !== protectedTenantId
      && !pendingSaves.has(tenantId)
      && Number(status.lastAccessAt || 0) <= cutoff)
    .sort((a, b) => Number(a[1].lastAccessAt || 0) - Number(b[1].lastAccessAt || 0));
  let evicted = 0;
  for (const [tenantId] of candidates) {
    if (loadedTenants.size <= RESIDENT_TENANT_LIMIT) break;
    removeResidentTenant(tenantId);
    evicted += 1;
  }
  if (evicted) console.log(`Store: Evicted ${evicted} idle workspace${evicted === 1 ? '' : 's'} from memory.`);
  return evicted;
}

function pruneFinishedBackgroundJobs() {
  const cutoff = Date.now() - BACKGROUND_JOB_RETENTION_MS;
  let pruned = 0;
  for (const [jobId, job] of backgroundJobs) {
    if (!['completed', 'failed', 'cancelled'].includes(job?.status)) continue;
    const finishedAt = new Date(job.finishedAt || job.updatedAt || 0).getTime();
    if (!Number.isFinite(finishedAt) || finishedAt > cutoff) continue;
    backgroundJobs.delete(jobId);
    persistedBackgroundJobSnapshots.delete(jobId);
    pruned += 1;
  }
  return pruned;
}

const residentCleanupTimer = setInterval(() => {
  pruneFinishedBackgroundJobs();
  evictIdleResidentTenants();
}, 60 * 1000);
residentCleanupTimer.unref?.();

function countTenantWorkspaceItems(tenantId) {
  const counts = {
    accountCount: accountsForTenant(tenantId).length,
    contactCount: contactsForTenant(tenantId).length,
    jobCount: jobsForTenant(tenantId).length,
    configCount: configsForTenant(tenantId).length,
    activityCount: getTenantArray(activitiesByTenant, tenantId).length,
    taskCount: getTenantArray(tasksByTenant, tenantId).length,
  };
  counts.total = counts.accountCount + counts.contactCount + counts.jobCount + counts.configCount + counts.activityCount + counts.taskCount;
  return counts;
}

function normalizeWorkspaceLoadCounts(stats = {}) {
  const counts = {
    accounts: Number(stats.accountCount || 0),
    contacts: Number(stats.contactCount || 0),
    jobs: Number(stats.jobCount || 0),
    configs: Number(stats.configCount || 0),
    activities: Number(stats.activityCount || 0),
  };
  counts.total = counts.accounts + counts.contacts + counts.jobs + counts.configs + counts.activities;
  return counts;
}

function isLargeWorkspaceDataset(counts) {
  return counts.accounts >= LARGE_WORKSPACE_LOAD_THRESHOLDS.accounts
    || counts.contacts >= LARGE_WORKSPACE_LOAD_THRESHOLDS.contacts
    || counts.jobs >= LARGE_WORKSPACE_LOAD_THRESHOLDS.jobs
    || counts.configs >= LARGE_WORKSPACE_LOAD_THRESHOLDS.configs
    || counts.total >= LARGE_WORKSPACE_LOAD_THRESHOLDS.total;
}

async function ensureTenantSettingsLoaded(tenantId) {
  if (!isDbEnabled()) return;
  const status = loadedTenants.get(tenantId) || { core: false, contacts: false, settings: false };
  status.lastAccessAt = Date.now();
  if (status.settings) {
    loadedTenants.set(tenantId, status);
    return;
  }
  const { dbLoadTenantSettings } = await import('./db.js');
  const settings = await dbLoadTenantSettings(tenantId);
  const profile = tenantProfiles.get(tenantId);
  if (profile && settings && Object.keys(settings).length) {
    profile.settings = { ...profile.settings, ...settings };
    profile.persona = normalizePersona(settings.persona || profile.persona);
  }
  status.settings = true;
  loadedTenants.set(tenantId, status);
}

async function ensureDataLoaded(tenantId, needsContacts = false) {
  if (!isDbEnabled()) return;
  const status = loadedTenants.get(tenantId) || { core: false, contacts: false };
  status.lastAccessAt = Date.now();
  
  // If we already have what we need, return immediately
  if (status.core && (!needsContacts || status.contacts)) {
    loadedTenants.set(tenantId, status);
    return;
  }

  const start = Date.now();
  const timings = {};
  console.log(`  Store: Loading data for ${tenantId} (needsContacts: ${needsContacts})`);

  const { dbGetTenantDataStats, dbLoadTenantData, dbLoadTenantSettings } = await import('./db.js');
  const dbStartedAt = Date.now();
  // A tenant with no tenant_data row yet (fresh signup) is an EMPTY workspace,
  // not an unloaded one. Leaving status.core false meant the tenant's first
  // mutations were never persisted (saveTenantNow skips un-loaded sections)
  // and were then wiped from memory by the next load.
  let data = null;
  let readSource = 'legacy';
  if (relationalReadsEnabledForTenant(tenantId)) {
    try {
      const [blobStats, relationalStats, settings] = await Promise.all([
        dbGetTenantDataStats(tenantId),
        getTenantRelationalStats(tenantId),
        dbLoadTenantSettings(tenantId),
      ]);
      const parity = relationalWritesPrimaryForTenant(tenantId)
        ? { matches: Boolean(relationalStats), mismatches: relationalStats ? [] : [{ entity: 'workspace', reason: 'relational stats unavailable' }] }
        : blobStats && relationalStats
          ? compareTenantDataCounts(blobStats, relationalStats, needsContacts)
          : { matches: false, mismatches: [{ entity: 'workspace', reason: 'stats unavailable' }] };
      if (parity.matches && settings !== null) {
        const relationalData = await loadTenantRelationalData(tenantId, needsContacts);
        if (relationalData) {
          data = { ...relationalData, settings };
          readSource = 'relational';
        }
      } else {
        console.warn(`Relational read fallback for ${tenantId}:`, parity.mismatches);
      }
    } catch (error) {
      console.error('Relational read failed; using legacy data:', safeErrorSummary(error));
    }
  }
  if (!data) data = await dbLoadTenantData(tenantId, needsContacts);
  data = data || { accounts: [], contacts: [], jobs: [], configs: [], activities: [], tasks: [], settings: {} };
  timings.dbLoadMs = Date.now() - dbStartedAt;
  timings.readSource = readSource;

  if (data) {
    const mergeStartedAt = Date.now();
    const mirrorData = {};
    // Only load core the FIRST time. A contacts-only lazy load (needsContacts
    // now true, core already loaded) must NOT re-set these maps from the DB
    // snapshot: that would clobber in-memory mutations still sitting in the
    // 500ms debounced-save window and silently discard them.
    if (!status.core) {
      const tenantAccts = mergeTenantItems(data.accounts || [], accountsByTenant.get(tenantId) || []);
      tenantAccts.sort((a, b) => (b.targetScore || 0) - (a.targetScore || 0));
      accountsByTenant.set(tenantId, tenantAccts);
      jobsByTenant.set(tenantId, mergeTenantItems(data.jobs || [], jobsByTenant.get(tenantId) || []));
      configsByTenant.set(tenantId, mergeTenantItems(data.configs || [], configsByTenant.get(tenantId) || []));
      activitiesByTenant.set(tenantId, mergeTenantItems(data.activities || [], activitiesByTenant.get(tenantId) || []));
      tasksByTenant.set(tenantId, mergeTenantItems(data.tasks || [], tasksByTenant.get(tenantId) || []));
      mirrorData.accounts = accountsByTenant.get(tenantId) || [];
      mirrorData.jobs = jobsByTenant.get(tenantId) || [];
      mirrorData.configs = configsByTenant.get(tenantId) || [];
      mirrorData.activities = activitiesByTenant.get(tenantId) || [];
      mirrorData.tasks = tasksByTenant.get(tenantId) || [];

      // Merge into global arrays only on this first load for the tenant.
      {
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

      // Hydrate persisted settings (geographyFocus, thresholds, etc.) into the
      // in-memory profile. Without this they were only ever set at signup and
      // silently reverted to defaults after every restart.
      const profile = tenantProfiles.get(tenantId);
      if (profile && data.settings && Object.keys(data.settings).length) {
        profile.settings = { ...profile.settings, ...data.settings };
      }

      status.core = true;
      status.settings = true;
    }
    
    if (needsContacts && !status.contacts) {
      const tenantConts = mergeTenantItems(data.contacts || [], contactsByTenant.get(tenantId) || []);
      tenantConts.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
      contactsByTenant.set(tenantId, tenantConts);

      const existingContactIds = new Set(contacts.map(x => x.id));
      for (const c of tenantConts) if (!existingContactIds.has(c.id)) contacts.push(c);

      status.contacts = true;
      mirrorData.contacts = tenantConts;
    }
    timings.mergeMs = Date.now() - mergeStartedAt;
    if (Object.keys(mirrorData).length) {
      if (readSource === 'relational') {
        primeTenantRelationalMirror(tenantId, mirrorData);
      } else {
        syncTenantRelationalMirror(tenantId, mirrorData)
          .catch((err) => console.error('Relational mirror lazy backfill error:', safeErrorSummary(err)));
      }
    }
  }
  
  loadedTenants.set(tenantId, status);
  evictIdleResidentTenants(tenantId);
  const elapsedMs = Date.now() - start;
  console.log(`  Store: Data loaded for ${tenantId} in ${elapsedMs}ms`, timings);
  if (elapsedMs > 1000) {
    console.warn(`Slow tenant data load: saas/src/store.js ensureDataLoaded ${elapsedMs}ms`, {
      ...timings,
      needsContacts,
    });
  }
}

function queueResumableBackgroundJob(storeApi, tenantId, job) {
  setImmediate(() => {
    const runner = job.type === 'live-job-import'
      ? runLiveJobImportBackgroundJob
      : runLinkedInCsvBackgroundJob;
    runner(storeApi, tenantId, job).catch((error) => {
      console.error('Background job runner failed:', safeErrorSummary(error));
    });
  });
}

async function beginResumableBackgroundJob(job, message) {
  job.recovery.attempts = Math.max(0, Number(job.recovery.attempts) || 0) + 1;
  job.status = 'running';
  job.startedAt = now();
  job.finishedAt = null;
  job.updatedAt = job.startedAt;
  job.progressMessage = message;
  await persistBackgroundJob(job);
}

async function finishResumableBackgroundJob(job) {
  job.finishedAt = now();
  job.updatedAt = job.finishedAt;
  delete job.recovery;
  await persistBackgroundJob(job);
}

async function runLiveJobImportBackgroundJob(storeApi, tenantId, job) {
  const scheduled = Boolean(job.recovery?.options?.scheduled);
  try {
    await beginResumableBackgroundJob(job, 'Fetching active ATS boards...');
    job.progress = 25;
    job.stage = 'import';
    const result = await storeApi.importLiveJobs(tenantId, job.recovery.options || {});
    if (result.error) {
      job.status = 'failed';
      job.errorMessage = result.error;
      job.result = result;
    } else {
      job.status = 'completed';
      job.progress = 100;
      job.stage = 'completed';
      job.progressMessage = 'Completed';
      job.recordsAffected = getTrackedJobCountFromResult(result) || getTouchedJobCountFromResult(result);
      job.result = {
        stats: result.stats,
        importRun: result.importRun,
        warnings: result.warnings || [],
      };
    }
  } catch (err) {
    job.status = 'failed';
    job.errorMessage = err.message || 'Live ATS job import failed.';
  } finally {
    await finishResumableBackgroundJob(job);
    if (scheduled) {
      const profile = getTenantProfile(tenantId);
      if (profile) {
        profile.settings.lastPipelineAttemptAt = job.startedAt || job.queuedAt;
        profile.settings.lastPipelineStatus = job.status;
        profile.settings.lastPipelineError = job.status === 'failed' ? job.errorMessage || '' : '';
        if (job.status === 'completed') profile.settings.lastPipelineRun = job.finishedAt;
        persistTenant(tenantId);
      }
    }
  }
}

async function runLinkedInCsvBackgroundJob(storeApi, tenantId, job) {
  try {
    await beginResumableBackgroundJob(job, 'Parsing LinkedIn connections CSV...');
    const result = await storeApi.importLinkedInCSV(
      tenantId,
      job.recovery.csvText,
      job.recovery.options || {}
    );
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
    await finishResumableBackgroundJob(job);
  }
}

export function createStore() {
  return {
    // Load basic tenant profiles only on startup
    async loadFromDb() {
      // Basic users/profiles are loaded separately by the server.
      // We no longer pre-load all tenant_data (lazy load now).
      console.log('  Store: Lazy loading enabled for tenant data');
      const interruptedJobs = await dbLoadRecoverableBackgroundJobs(50, { throwOnError: true });
      let resumed = 0;
      let failed = 0;
      for (const persisted of interruptedJobs) {
        if (!persisted?.id || !persisted.tenantId || backgroundJobs.has(persisted.id)) continue;
        const tenantId = persisted.tenantId;
        const decision = getBackgroundJobRecoveryDecision(persisted);
        trackBackgroundJob(tenantId, persisted);
        if (decision.recoverable) {
          persisted.status = 'queued';
          persisted.startedAt = null;
          persisted.finishedAt = null;
          persisted.updatedAt = now();
          persisted.progressMessage = 'Resuming after a service restart...';
          await persistBackgroundJob(persisted);
          queueResumableBackgroundJob(this, tenantId, persisted);
          resumed += 1;
        } else {
          failInterruptedBackgroundJob(persisted, decision);
          await persistBackgroundJob(persisted);
          failed += 1;
        }
      }
      if (resumed || failed) {
        console.log(`  Store: Recovered ${resumed} interrupted job${resumed === 1 ? '' : 's'}; marked ${failed} non-resumable job${failed === 1 ? '' : 's'} failed`);
      }
    },
    flushPendingSaves,
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

    async exportTenantData(tenantId, context = {}) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, true);
      const profile = getTenantProfile(tenantId);
      return {
        exportedAt: now(),
        product: 'BD Engine',
        tenant: context.tenant || { id: tenantId },
        user: context.user || null,
        membership: context.membership || null,
        workspace: {
          profile: profile ? {
            persona: profile.persona,
            settings: profile.settings || {},
          } : null,
          accounts: accountsForTenant(tenantId),
          contacts: contactsForTenant(tenantId),
          jobs: jobsForTenant(tenantId),
          configs: configsForTenant(tenantId),
          activities: activitiesForTenant(tenantId),
          tasks: tasksForTenant(tenantId),
        },
      };
    },

    async clearTenantWorkspaceData(tenantId) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, true);
      const before = countTenantWorkspaceItems(tenantId);
      await dbSaveTenantData(tenantId, {
        accounts: [],
        contacts: [],
        jobs: [],
        configs: [],
        activities: [],
        tasks: [],
        settings: getTenantProfile(tenantId)?.settings || {},
      }, { throwOnError: true });
      await wipeTenantRelationalMirror(tenantId);
      replaceTenantItems(accountsByTenant, 'accounts', tenantId, []);
      replaceTenantItems(contactsByTenant, 'contacts', tenantId, []);
      replaceTenantItems(jobsByTenant, 'jobs', tenantId, []);
      replaceTenantItems(configsByTenant, 'configs', tenantId, []);
      replaceTenantItems(activitiesByTenant, 'activities', tenantId, []);
      replaceTenantItems(tasksByTenant, 'tasks', tenantId, []);
      loadedTenants.set(tenantId, { core: true, contacts: true });
      await dbRecordAuditLog({
        tenantId,
        action: 'workspace.clear',
        entityType: 'tenant',
        entityId: tenantId,
        before: before,
        after: countTenantWorkspaceItems(tenantId),
        metadata: { privacySafe: true },
      });
      return { ok: true, deleted: before, remaining: countTenantWorkspaceItems(tenantId) };
    },

    forgetClosedTenants(tenantIds = []) {
      for (const tenantId of new Set(tenantIds.filter(Boolean))) {
        const pending = pendingSaves.get(tenantId);
        if (pending) clearTimeout(pending);
        pendingSaves.delete(tenantId);
        saveRetryCounts.delete(tenantId);
        removeResidentTenant(tenantId);
        tenantProfiles.delete(tenantId);
        durableRelationalWriteTenants.delete(tenantId);
        for (const [jobId, job] of backgroundJobs) {
          if (job.tenantId === tenantId) backgroundJobs.delete(jobId);
        }
      }
    },

    async curateLegacyTargets(tenantId, { targetLimit = 100, apply = false } = {}) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false);
      const limit = Math.max(1, Math.min(1000, Math.floor(Number(targetLimit) || 100)));
      const legacyAccounts = accountsForTenant(tenantId).filter((item) => typeof item.tracked !== 'boolean');
      const ranked = [...legacyAccounts].sort((a, b) => (
        Number(b.targetScore || 0) - Number(a.targetScore || 0)
        || Number(b.openRoleCount || b.jobCount || 0) - Number(a.openRoleCount || a.jobCount || 0)
        || Number(b.talentContactCount || 0) - Number(a.talentContactCount || 0)
        || Number(b.seniorContactCount || 0) - Number(a.seniorContactCount || 0)
        || Number(b.connectionCount || 0) - Number(a.connectionCount || 0)
        || String(a.displayName || '').localeCompare(String(b.displayName || ''))
      ));
      const selectedIds = new Set(ranked.slice(0, limit).map((item) => item.id));
      const summary = {
        legacyCompanies: legacyAccounts.length,
        selectedTargets: Math.min(limit, legacyAccounts.length),
        networkCompanies: Math.max(0, legacyAccounts.length - limit),
        targetLimit: limit,
        preview: ranked.slice(0, 12).map((item) => ({
          id: item.id,
          displayName: item.displayName,
          targetScore: Number(item.targetScore || 0),
          openRoleCount: Number(item.openRoleCount || item.jobCount || 0),
          connectionCount: Number(item.connectionCount || 0),
        })),
      };
      if (!apply || !legacyAccounts.length) return { ok: true, applied: false, ...summary };

      const timestamp = now();
      const previous = new Map(legacyAccounts.map((item) => [item.id, { updatedAt: item.updatedAt }]));
      for (const item of legacyAccounts) {
        item.tracked = selectedIds.has(item.id);
        item.updatedAt = timestamp;
      }
      try {
        if (isDbEnabled()) {
          const result = await dbClassifyLegacyAccounts(tenantId, [...selectedIds], timestamp);
          if (!result?.saved) throw new Error(`Target classification save failed: ${result?.reason || 'unknown error'}`);
          primeTenantRelationalMirror(tenantId, { accounts: accountsForTenant(tenantId) });
        }
      } catch (error) {
        for (const item of legacyAccounts) {
          delete item.tracked;
          item.updatedAt = previous.get(item.id)?.updatedAt;
        }
        throw error;
      }
      return { ok: true, applied: true, ...summary };
    },

    getSession() {
      return {
        tenant: { ...seedTenant },
        user: { ...seedUser },
        membership: { role: 'owner' },
      };
    },

    async getWorkspaceLoadHint(tenantId) {
      assertTenant(tenantId);
      const startedAt = performance.now();
      const status = loadedTenants.get(tenantId) || { core: false, contacts: false };
      let stats = null;
      let source = 'memory';
      if (isDbEnabled()) {
        const { dbGetTenantDataStats } = await import('./db.js');
        stats = await dbGetTenantDataStats(tenantId);
        source = 'database';
      }
      const counts = normalizeWorkspaceLoadCounts(stats || countTenantWorkspaceItems(tenantId));
      const isLargeDataset = isLargeWorkspaceDataset(counts);
      const firstLoadPending = !status.core && counts.total > 0;
      const elapsedMs = Math.round(performance.now() - startedAt);
      const payload = {
        tenantId,
        counts,
        thresholds: { ...LARGE_WORKSPACE_LOAD_THRESHOLDS },
        loaded: {
          core: Boolean(status.core),
          contacts: Boolean(status.contacts),
        },
        firstLoadPending,
        isLargeDataset,
        shouldShowProgress: Boolean(firstLoadPending && isLargeDataset),
        source,
        timings: {
          totalMs: elapsedMs,
          statsQueryMs: stats?.queryMs || 0,
        },
      };
      if (elapsedMs > 150) {
        console.warn(`Slow workspace load hint: saas/src/store.js getWorkspaceLoadHint ${elapsedMs}ms`, payload.timings);
      }
      return payload;
    },

    async getIngestionDiagnostics(tenantId) {
      assertTenant(tenantId);
      const startedAt = performance.now();
      const timings = {};
      const loadStartedAt = performance.now();
      await ensureDataLoaded(tenantId, false);
      timings.loadMs = Math.round(performance.now() - loadStartedAt);

      const tenantAccounts = accountsForTenant(tenantId);
      const tenantConfigs = configsForTenant(tenantId);
      const tenantJobs = jobsForTenant(tenantId);
      const trackedAccounts = tenantAccounts.filter(isTrackedTarget);
      const explicitTrackedAccounts = tenantAccounts.filter((item) => item.tracked === true);
      const networkAccounts = tenantAccounts.filter((item) => item.tracked === false);
      const legacyUnclassifiedAccounts = tenantAccounts.filter((item) => typeof item.tracked !== 'boolean');
      const accountsById = new Map(tenantAccounts.map((item) => [item.id, item]));
      const accountsByName = new Map(tenantAccounts.map((item) => [normalizeKey(item.normalizedName || item.displayName), item]));
      const operationalConfigs = tenantConfigs.filter((config) => {
        const owner = accountForConfig(config, accountsById, accountsByName);
        return !owner || isTrackedTarget(owner);
      });
      const networkConfigsExcluded = tenantConfigs.length - operationalConfigs.length;
      const activeConfigs = operationalConfigs.filter((item) => item.active !== false);
      const importReadyConfigs = activeConfigs.filter(isImportReadyConfig);
      const supportedConfigs = importReadyConfigs
        .map((config) => ({ config, atsType: getConfigAtsType(config), boardId: getConfigBoardId(config) }))
        .filter(({ config, atsType, boardId }) => isImportReadyConfig(config) && ATS_FETCHERS.has(atsType) && boardId);
      const linkedCareerConfigs = operationalConfigs.filter((config) => detectAtsTypeFromUrl(config.careersUrl || config.resolvedBoardUrl || config.sourceUrl || config.boardUrl || config.apiUrl || config.url || ''));
      const latestLaunch = activitiesForTenant(tenantId).find((item) => item.type === 'launch_workflow') || null;
      const latestImport = activitiesForTenant(tenantId).find((item) => item.type === 'live_job_import') || null;
      const coverageRows = operationalConfigs.map((config) => {
        const category = classifyBoardCoverage(config);
        const accountItem = accountForConfig(config, accountsById, accountsByName);
        const meta = BOARD_COVERAGE_META[category];
        let detail = meta.action;
        if (category === 'failed') detail = getBoardCoverageFailureDetail(config);
        if (category === 'tracking_only') detail = `${config.atsType || config.ats || 'This provider'} does not expose a supported public job feed.`;
        if (category === 'careers_page_only') {
          detail = getConfigUrlCandidates(config).map((value) => getUsableCareerUrl(value)).find(Boolean) || meta.action;
        }
        if (category === 'discovery_needed') detail = `Company domain: ${config.domain || config.canonicalDomain}`;
        if (category === 'missing_identity') detail = 'No usable company domain or careers URL is saved yet.';
        return {
          config,
          accountItem,
          category,
          label: meta.label,
          recommendedAction: meta.action,
          detail,
          targetScore: Number(accountItem?.targetScore || accountItem?.dailyScore || 0),
        };
      });
      const coverageCategories = countValues(coverageRows.map((item) => item.category));
      const issuePriorities = {
        failed: 0,
        needs_review: 1,
        empty: 2,
        careers_page_only: 3,
        discovery_needed: 4,
        missing_identity: 5,
        tracking_only: 6,
      };
      const coverageIssues = coverageRows
        .filter((item) => Object.prototype.hasOwnProperty.call(issuePriorities, item.category))
        .sort((a, b) => (
          issuePriorities[a.category] - issuePriorities[b.category]
          || b.targetScore - a.targetScore
          || String(a.config.companyName || '').localeCompare(String(b.config.companyName || ''))
        ));
      const readyTrackedAccountIds = new Set(importReadyConfigs
        .map((config) => accountForConfig(config, accountsById, accountsByName))
        .filter((item) => item && isTrackedTarget(item))
        .map((item) => item.id));
      const readyCoveragePercent = trackedAccounts.length
        ? Math.round((readyTrackedAccountIds.size / trackedAccounts.length) * 1000) / 10
        : 0;

      timings.totalMs = Math.round(performance.now() - startedAt);
      if (timings.totalMs > 500) {
        console.warn(`Slow ingestion diagnostics: saas/src/store.js getIngestionDiagnostics ${timings.totalMs}ms`, timings);
      }

      return {
        counts: {
          accounts: tenantAccounts.length,
          trackedCompanies: trackedAccounts.length,
          explicitTrackedCompanies: explicitTrackedAccounts.length,
          networkCompanies: networkAccounts.length,
          legacyUnclassifiedCompanies: legacyUnclassifiedAccounts.length,
          jobs: tenantJobs.length,
          activeJobs: tenantJobs.filter((item) => item.active !== false).length,
          configs: tenantConfigs.length,
          operationalConfigs: operationalConfigs.length,
          networkConfigsExcluded,
          activeConfigs: activeConfigs.length,
          importReadyConfigs: importReadyConfigs.length,
          supportedImportReadyConfigs: supportedConfigs.length,
          needsResolutionConfigs: operationalConfigs.length - importReadyConfigs.length,
          linkedCareerConfigs: linkedCareerConfigs.length,
        },
        coverageSummary: {
          trackedCompanies: trackedAccounts.length,
          explicitTrackedCompanies: explicitTrackedAccounts.length,
          networkCompanies: networkAccounts.length,
          legacyUnclassifiedCompanies: legacyUnclassifiedAccounts.length,
          sourceCount: operationalConfigs.length,
          networkSourcesExcluded: networkConfigsExcluded,
          importReady: importReadyConfigs.length,
          companiesReady: readyTrackedAccountIds.size,
          readyCoveragePercent,
          successful: coverageCategories.healthy || 0,
          readyNotRun: coverageCategories.ready_not_run || 0,
          failed: coverageCategories.failed || 0,
          empty: coverageCategories.empty || 0,
          needsReview: coverageCategories.needs_review || 0,
          needsCompanyDetails: (coverageCategories.missing_identity || 0)
            + (coverageCategories.discovery_needed || 0)
            + (coverageCategories.careers_page_only || 0),
          trackingOnly: coverageCategories.tracking_only || 0,
          rejected: coverageCategories.rejected || 0,
          totalIssues: coverageIssues.length,
        },
        coverageCategories,
        coverageIssues: coverageIssues.slice(0, 12).map((item) => ({
          configId: item.config.id,
          accountId: item.accountItem?.id || item.config.accountId || '',
          companyName: item.config.companyName || item.accountItem?.displayName || 'Unknown company',
          atsType: getConfigAtsType(item.config) || normalizeAtsType(item.config.atsType || item.config.ats) || 'unknown',
          category: item.category,
          label: item.label,
          detail: item.detail,
          recommendedAction: item.recommendedAction,
          targetScore: item.targetScore,
          active: item.config.active !== false,
          careersUrl: item.config.careersUrl || item.config.resolvedBoardUrl || '',
          lastCheckedAt: item.config.lastCheckedAt || item.config.lastResolutionAttemptAt || '',
        })),
        byAtsType: countValues(operationalConfigs.map((config) => getConfigAtsType(config) || 'unknown')),
        byDiscoveryStatus: countValues(operationalConfigs.map((config) => normalizeKey(config.discoveryStatus || 'missing'))),
        byReviewStatus: countValues(operationalConfigs.map((config) => normalizeKey(config.reviewStatus || 'missing'))),
        byImportStatus: countValues(operationalConfigs.map((config) => normalizeKey(config.lastImportStatus || 'never'))),
        sampleNeedsResolution: operationalConfigs
          .filter((config) => !isImportReadyConfig(config))
          .slice(0, 10)
          .map((config) => ({
            companyName: config.companyName,
            atsType: config.atsType || config.ats || 'unknown',
            domain: config.domain || '',
            careersUrl: config.careersUrl || '',
            discoveryStatus: config.discoveryStatus || '',
            reviewStatus: config.reviewStatus || '',
            active: config.active !== false,
            lastImportStatus: config.lastImportStatus || '',
            lastDiscoveryError: config.lastDiscoveryError || '',
          })),
        latestLaunch: latestLaunch ? {
          summary: latestLaunch.summary || '',
          occurredAt: latestLaunch.occurredAt || '',
          metadata: latestLaunch.metadata || {},
          notes: latestLaunch.notes || '',
        } : null,
        latestImport: latestImport ? {
          summary: latestImport.summary || '',
          occurredAt: latestImport.occurredAt || '',
          metadata: latestImport.metadata || {},
          notes: latestImport.notes || '',
        } : null,
        timings,
      };
    },

    async getSetupStatus(tenantId, options = {}) {
      assertTenant(tenantId);
      const startedAt = performance.now();
      const timings = {};
      const loadStartedAt = performance.now();
      await ensureTenantSettingsLoaded(tenantId);
      let profile = getTenantProfile(tenantId);
      const needsWorkspaceData = !profile.settings.setupComplete || options.includeReadiness === true;
      if (needsWorkspaceData) await ensureDataLoaded(tenantId);
      timings.loadMs = Math.round(performance.now() - loadStartedAt);
      const shapeStartedAt = performance.now();
      profile = getTenantProfile(tenantId);
      const tenantAccounts = accountsForTenant(tenantId);
      const tenantJobs = jobsForTenant(tenantId);
      const tenantContacts = contactsForTenant(tenantId);
      const tenantConfigs = configsForTenant(tenantId);
      const persona = this.getPersona(tenantId);
      const hasWorkspaceData = tenantAccounts.length > 0 || tenantJobs.length > 0;
      if (!profile.settings.setupComplete && hasWorkspaceData) {
        profile.settings.setupComplete = true;
        profile.settings.lastPipelineRun = profile.settings.lastPipelineRun || now();
        persistTenant(tenantId);
      }
      const setupComplete = Boolean(profile.settings.setupComplete);
      const payload = {
        requiresSetup: !setupComplete,
        setupComplete,
        licensingEnabled: false,
        workspaceName: profile.workspace.name,
        persona,
        user: profile.settings.user,
        ...(needsWorkspaceData ? { readiness: buildWorkspaceReadiness(persona, tenantAccounts, tenantJobs, tenantContacts, tenantConfigs) } : {}),
      };
      timings.shapeMs = Math.round(performance.now() - shapeStartedAt);
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs > 500) {
        console.warn(`Slow setup status: saas/src/store.js getSetupStatus ${elapsedMs}ms`, timings);
      }
      return payload;
    },

    async getRuntimeStatus(tenantId) {
      assertTenant(tenantId);
      const persistedJobs = await dbLoadRecentBackgroundJobs(tenantId, 20);
      const jobsById = new Map();
      for (const job of persistedJobs) jobsById.set(job.id, job);
      for (const job of backgroundJobs.values()) {
        if (job.tenantId === tenantId) jobsById.set(job.id, publicBackgroundJob(job));
      }
      const tenantJobs = [...jobsById.values()]
        .sort((a, b) => backgroundJobTimestamp(b) - backgroundJobTimestamp(a));
      const activeJobs = tenantJobs.filter((job) => ['queued', 'running'].includes(job.status));
      const recentJobs = tenantJobs.filter((job) => !['queued', 'running'].includes(job.status)).slice(0, 10);
      const runningJobs = activeJobs.filter((job) => job.status === 'running').length;
      const queuedJobs = activeJobs.filter((job) => job.status === 'queued').length;
      const profile = getTenantProfile(tenantId);
      const settings = profile?.settings || {};
      const isReadOnlyDemo = profile?.tenant?.slug === 'bd-engine-demo';
      const automaticRefreshEnabled = Boolean(settings.setupComplete && !isReadOnlyDemo);
      const operational = summarizeOperationalJobs(tenantJobs, {
        staleAfterMs: readPositiveInteger(process.env.BD_BACKGROUND_JOB_STALE_MS, 15 * 60 * 1000),
      });
      return {
        ok: true,
        serverStartedAt: processStartedAt,
        serverWarmedAt: processStartedAt,
        warmed: true,
        workerRunning: runningJobs > 0,
        runningJobs,
        queuedJobs,
        activeJobs: activeJobs.map(publicBackgroundJob),
        recentJobs: recentJobs.map(publicBackgroundJob),
        operational,
        refreshSchedule: {
          enabled: automaticRefreshEnabled,
          disabledReason: isReadOnlyDemo ? 'read_only_demo' : (settings.setupComplete ? '' : 'setup_incomplete'),
          lastAttemptAt: settings.lastPipelineAttemptAt || '',
          lastSuccessAt: settings.lastPipelineRun || '',
          lastStatus: settings.lastPipelineStatus || '',
          lastError: settings.lastPipelineError || '',
          nextEligibleAt: automaticRefreshEnabled ? getNextScheduledRefreshAt(settings) : '',
        },
      };
    },

    async getUsageCounts(tenantId) {
      assertTenant(tenantId);
      if (relationalUsageEnabledForTenant(tenantId)) {
        try {
          if (await hasRelationalParity(tenantId, true)) {
            const usage = await getTenantUsageCountsRelational(tenantId);
            if (usage) {
              if (!confirmedRelationalUsageTenants.has(tenantId)) {
                confirmedRelationalUsageTenants.add(tenantId);
                console.log(`Relational usage queries active for ${tenantId}.`);
              }
              const profile = getTenantProfile(tenantId);
              return { ...usage, users: 1 };
            }
          } else {
            console.warn(`Relational usage fallback for ${tenantId}: parity check failed.`);
          }
        } catch (error) {
          console.error('Relational usage query failed; using memory:', safeErrorSummary(error));
        }
      }
      await ensureDataLoaded(tenantId, true);
      const tenantAccounts = accountsForTenant(tenantId);
      const tenantContacts = contactsForTenant(tenantId);
      const tenantConfigs = configsForTenant(tenantId);
      const profile = getTenantProfile(tenantId);
      return {
        accounts: tenantAccounts.length,
        contacts: tenantContacts.length,
        jobBoards: tenantConfigs.filter((item) => item.active !== false).length,
        users: 1,
      };
    },

    async getBootstrap(tenantId, { includeFilters = false, session = null } = {}) {
      assertTenant(tenantId);
      const startedAt = performance.now();
      const timings = {};
      const loadStartedAt = performance.now();
      let filters = null;
      if (includeFilters && relationalWritesPrimaryForTenant(tenantId)) {
        [filters] = await Promise.all([
          getTenantFiltersRelational(tenantId),
          ensureTenantSettingsLoaded(tenantId),
        ]);
      } else if (includeFilters) {
        await ensureDataLoaded(tenantId, false);
      } else {
        await ensureTenantSettingsLoaded(tenantId);
      }
      if (includeFilters && !filters) {
        await ensureDataLoaded(tenantId, false);
        filters = buildFilters(tenantId);
      }
      timings.loadMs = Math.round(performance.now() - loadStartedAt);
      const shapeStartedAt = performance.now();
      const profile = getTenantProfile(tenantId);
      const payload = {
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
        ...(includeFilters ? { filters } : {}),
      };
      timings.shapeMs = Math.round(performance.now() - shapeStartedAt);
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs > 500) {
        console.warn(`Slow bootstrap: saas/src/store.js getBootstrap ${elapsedMs}ms`, {
          ...timings,
          includeFilters,
        });
      }
      return payload;
    },

    async getDashboard(tenantId) {
      assertTenant(tenantId);
      const dashboardStartedAt = performance.now();
      const timings = {};
      const loadStartedAt = performance.now();
      // Contacts are needed for networkLeaders; without them the widget was
      // silently empty until some other endpoint happened to load contacts.
      await ensureDataLoaded(tenantId, true);
      timings.scopeLoadMs = Math.round(performance.now() - loadStartedAt);
      const shapeStartedAt = performance.now();
      const tenantAccounts = accountsForTenant(tenantId);
      const tenantJobs = jobsForTenant(tenantId);
      const tenantConfigs = configsForTenant(tenantId);
      const tenantContacts = contactsForTenant(tenantId);
      const persona = this.getPersona(tenantId);
      const activeJobs = tenantJobs.filter((item) => item.active !== false);
      const jobsPostedLast24h = activeJobs.filter((item) => daysSince(item.postedAt) <= 1);
      const jobsImportedLast24h = activeJobs.filter((item) => daysSince(item.importedAt || item.retrievedAt) <= 1);
      const resolvedConfigs = tenantConfigs.filter(isResolvedBoardConfig);
      const unresolvedAccounts = getAccountsNeedingResolution(tenantAccounts, tenantConfigs);
      const newJobsToday = jobsImportedLast24h.slice(0, 50).map(dashboardJobSummary);
      const followUpAccounts = tenantAccounts
        .filter((item) => item.nextActionAt)
        .slice(0, 25)
        .map(dashboardAccountSummary);
      const dashboard = {
        summary: {
          accountCount: tenantAccounts.length,
          hiringAccountCount: tenantAccounts.filter((item) => item.jobCount > 0).length,
          activeJobCount: activeJobs.length,
          jobsImportedLast24h: jobsImportedLast24h.length,
          jobsPostedLast24h: jobsPostedLast24h.length,
          newJobsLast24h: jobsPostedLast24h.length,
          discoveredBoardCount: resolvedConfigs.length,
          needsResolutionCount: unresolvedAccounts.length,
        },
        todayQueue: tenantAccounts.slice(0, 50).map(dashboardAccountSummary),
        followUpAccounts,
        newJobsToday,
        networkLeaders: tenantContacts.slice(0, 5).map(dashboardContactSummary),
        needsResolution: unresolvedAccounts.slice(0, 5).map(dashboardAccountSummary),
        actionPlan: buildDashboardActionPlan(persona, tenantAccounts, activeJobs, tenantContacts, tenantConfigs),
        readiness: buildWorkspaceReadiness(persona, tenantAccounts, activeJobs, tenantContacts, tenantConfigs),
        recommendedActions: tenantAccounts.slice(0, 5).map((item) => ({
          accountId: item.id,
          company: item.displayName,
          text: item.recommendedAction,
          recommendedAction: item.recommendedAction,
          outreachStatus: item.outreachStatus,
        })),
        recentlyDiscoveredBoards: resolvedConfigs.slice(0, 5).map((item) => ({
          companyName: item.companyName,
          ats: getConfigAtsType(item),
          atsType: getConfigAtsType(item),
          confidenceBand: item.confidenceBand,
          discoveryStatus: item.discoveryStatus || 'resolved',
          discoveryMethod: item.discoveryMethod || item.source || 'configured',
          careersUrl: item.careersUrl || item.resolvedBoardUrl || '',
          domain: item.domain || '',
          discoveredAt: item.discoveredAt || item.updatedAt || '',
        })),
      };
      timings.shapeMs = Math.round(performance.now() - shapeStartedAt);
      const dashboardElapsedMs = Math.round(performance.now() - dashboardStartedAt);
      if (dashboardElapsedMs > 500) {
        console.warn(`Slow dashboard summary: saas/src/store.js getDashboard ${dashboardElapsedMs}ms`, timings);
      }
      return dashboard;
    },

    async getDashboardExtended(tenantId) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, true); // introQueue reads contacts
      const tenantAccounts = accountsForTenant(tenantId);
      const tenantConfigs = configsForTenant(tenantId);
      const unresolvedAccounts = getAccountsNeedingResolution(tenantAccounts, tenantConfigs);
      const unresolvedDashboardAccounts = unresolvedAccounts
        .slice(0, DASHBOARD_EXTENDED_QUEUE_LIMIT)
        .map(dashboardAccountSummary);
      return {
        playbook: tenantAccounts.slice(0, 5).map(dashboardAccountSummary),
        overdueFollowUps: [],
        staleAccounts: unresolvedDashboardAccounts,
        activityFeed: activitiesForTenant(tenantId).slice(0, 10),
        enrichmentFunnel: { resolved: 2, needsReview: 1, missing: 0 },
        alertQueue: tenantAccounts.slice(0, 3).map((item) => ({
          ...dashboardAccountSummary(item),
          accountId: item.id,
          type: 'hiring_signal',
          title: 'Hiring signal',
          summary: item.targetScoreExplanation,
        })),
        sequenceQueue: followups
          .filter((item) => item.tenantId === tenantId && item.status === 'open')
          .slice(0, DASHBOARD_EXTENDED_QUEUE_LIMIT)
          .map((item) => {
            const itemAccount = accountById(item.accountId, tenantId);
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
        resolutionQueue: unresolvedDashboardAccounts,
        resolutionQueueTotal: unresolvedAccounts.length,
      };
    },

    async findAccounts(tenantId, query) {
      assertTenant(tenantId);
      const richFilters = ['hiring', 'ats', 'recencyDays', 'minContacts', 'minTargetScore', 'priority', 'status', 'owner', 'outreachStatus', 'industry', 'geography', 'sortBy'];
      const needsInMemoryFiltering = richFilters.some((key) => String(query?.[key] || '').trim());
      if (relationalSqlEnabledForTenant(tenantId) && !needsInMemoryFiltering) {
        try {
          if (await hasRelationalParity(tenantId, false)) {
            const result = await findTenantAccountsRelational(tenantId, query);
            if (result) {
              if (!confirmedRelationalSqlTenants.has(tenantId)) {
                confirmedRelationalSqlTenants.add(tenantId);
                console.log(`Relational SQL account queries active for ${tenantId}.`);
              }
              return result;
            }
          } else {
            console.warn(`Relational account query fallback for ${tenantId}: parity check failed.`);
          }
        } catch (error) {
          console.error('Relational account query failed; using memory:', safeErrorSummary(error));
        }
      }
      await ensureDataLoaded(tenantId);
      let items = decorateAccountsWithConfigs(accountsForTenant(tenantId), configsForTenant(tenantId));
      items = filterText(items, query.q, ['displayName', 'domain', 'industry', 'location', 'owner', 'notes']);
      if (query.hiring === 'true' || query.hiring === true) {
        items = items.filter((item) => Number(item.openRoleCount || item.jobCount || 0) > 0);
      }
      if (query.ats) {
        const ats = normalizeAtsType(query.ats);
        items = items.filter((item) => item.atsTypes.some((value) => normalizeAtsType(value) === ats));
      }
      const recencyDays = Number(query.recencyDays || 0);
      if (recencyDays > 0) {
        items = items.filter((item) => {
          if (item.lastJobPostedAt) return daysSince(item.lastJobPostedAt) <= recencyDays;
          if (recencyDays <= 30) return Number(item.jobsLast30Days || 0) > 0;
          return Number(item.jobsLast90Days || item.jobsLast30Days || 0) > 0;
        });
      }
      const minContacts = Number(query.minContacts || 0);
      if (minContacts > 0) items = items.filter((item) => Number(item.connectionCount || item.contactCount || 0) >= minContacts);
      const minTargetScore = Number(query.minTargetScore || 0);
      if (minTargetScore > 0) items = items.filter((item) => Number(item.targetScore || item.dailyScore || 0) >= minTargetScore);
      if (query.priority) items = items.filter((item) => accountPriority(item) === normalizeKey(query.priority));
      if (query.status) items = items.filter((item) => normalizeKey(item.status) === normalizeKey(query.status));
      if (query.owner) items = items.filter((item) => normalizeKey(item.owner) === normalizeKey(query.owner));
      if (query.outreachStatus) items = items.filter((item) => normalizeKey(item.outreachStatus) === normalizeKey(query.outreachStatus));
      if (query.industry) items = items.filter((item) => normalizeKey(item.industry) === normalizeKey(query.industry));
      if (query.geography) items = items.filter((item) => accountMatchesGeography(item, query.geography));
      sortAccountRows(items, query.sortBy);
      return paginate(items, query);
    },

    async getAccountDetail(tenantId, accountId) {
      assertTenant(tenantId);
      const loadStartedAt = performance.now();
      await ensureDataLoaded(tenantId, true);
      const loadElapsedMs = Math.round(performance.now() - loadStartedAt);
      if (loadElapsedMs > 500) {
        console.warn(`Slow account detail load: saas/src/store.js getAccountDetail ${loadElapsedMs}ms`);
      }
      const item = accountById(accountId, tenantId);
      if (!item || item.tenantId !== tenantId) return null;
      const accountContacts = contacts.filter((contactItem) => contactItem.tenantId === tenantId && contactItem.accountId === accountId);
      const accountJobs = jobs.filter((jobItem) => jobItem.tenantId === tenantId && jobItem.accountId === accountId);
      const accountActivities = activities.filter((activity) => activity.tenantId === tenantId && activity.accountId === accountId);
      const accountConfigs = boardConfigs.filter((config) => config.tenantId === tenantId && (
        config.accountId === item.id
        || (!config.accountId && normalizeKey(config.normalizedCompanyName || config.companyName) === item.normalizedName)
      ));
      const decoratedAccount = decorateAccountsWithConfigs([item], accountConfigs)[0];
      const relationshipContacts = accountContacts.slice().sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0));
      const decisionContact = relationshipContacts.find((contactItem) => (
        contactItem.isTalentLeader
        || ['director', 'vp', 'head', 'cxo', 'owner'].includes(normalizeKey(contactItem.seniority))
      ));
      const accountWithRelationships = {
        ...decoratedAccount,
        networkStrength: decoratedAccount.networkStrength || (relationshipContacts.length >= 3 ? 'hot' : relationshipContacts.length ? 'warm' : 'cold'),
        connectionGraph: decoratedAccount.connectionGraph || {
          shortestPathToDecisionMaker: decisionContact
            ? { summary: `${decisionContact.fullName} is a direct connection${decisionContact.title ? ` and works as ${decisionContact.title}` : ''}.`, pathLength: 1 }
            : { summary: relationshipContacts.length ? 'Direct contacts are mapped, but no likely hiring decision maker is identified yet.' : 'No warm intro path mapped yet.', pathLength: 0 },
          warmIntroCandidates: relationshipContacts.slice(0, 5).map((contactItem) => ({
            fullName: contactItem.fullName,
            title: contactItem.title,
            relationshipStrengthScore: contactItem.priorityScore || 0,
            introPath: 'Direct connection',
            why: contactItem.isTalentLeader ? 'Talent leader in your network' : 'Existing relationship at this company',
          })),
          relationshipStrengthScore: decoratedAccount.relationshipStrengthScore || relationshipContacts[0]?.priorityScore || 0,
        },
      };
      const persona = this.getPersona(tenantId);
      return {
        account: accountWithRelationships,
        contacts: accountContacts,
        jobs: accountJobs,
        activity: accountActivities,
        activities: accountActivities,
        configs: accountConfigs,
        config: accountConfigs[0] || null,
        actionPlan: buildPersonaActionPlan(persona, accountWithRelationships, {
          contacts: accountContacts,
          jobs: accountJobs,
          configs: accountConfigs,
        }),
      };
    },

    async getHiringVelocity(tenantId, accountId) {
      assertTenant(tenantId);
      const detail = await this.getAccountDetail(tenantId, accountId);
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
      const item = accountById(accountId, tenantId);
      if (!item || item.tenantId !== tenantId) return null;
      Object.assign(item, pickPatch(patch, [
        'status', 'outreachStatus', 'priorityTier', 'priority', 'notes', 'industry', 'location',
        'domain', 'canonicalDomain', 'careersUrl', 'nextAction', 'nextActionAt', 'owner',
        'tags', 'aliases', 'linkedinCompanySlug', 'enrichmentStatus', 'enrichmentSource',
        'enrichmentConfidence', 'enrichmentConfidenceScore', 'enrichmentNotes',
      ]));
      if (Array.isArray(item.tags)) item.tags = unique(item.tags.map((value) => String(value).trim()).filter(Boolean)).slice(0, 50);
      if (Array.isArray(item.aliases)) item.aliases = unique(item.aliases.map((value) => String(value).trim()).filter(Boolean)).slice(0, 50);
      if (Object.prototype.hasOwnProperty.call(patch, 'enrichmentConfidenceScore')) {
        item.enrichmentConfidenceScore = Math.max(0, Math.min(100, Number(patch.enrichmentConfidenceScore) || 0));
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'tracked')) {
        item.tracked = patch.tracked === true || patch.tracked === 'true';
      }
      item.updatedAt = now();
      persistTenant(tenantId);
      return item;
    },

    async findContacts(tenantId, query) {
      assertTenant(tenantId);
      const needsInMemoryFiltering = ['minScore', 'outreachStatus'].some((key) => String(query?.[key] || '').trim());
      if (relationalContactSqlEnabledForTenant(tenantId) && !needsInMemoryFiltering) {
        try {
          if (await hasRelationalParity(tenantId, true)) {
            const result = await findTenantContactsRelational(tenantId, query);
            if (result) {
              if (!confirmedRelationalContactSqlTenants.has(tenantId)) {
                confirmedRelationalContactSqlTenants.add(tenantId);
                console.log(`Relational SQL contact queries active for ${tenantId}.`);
              }
              return result;
            }
          } else {
            console.warn(`Relational contact query fallback for ${tenantId}: parity check failed.`);
          }
        } catch (error) {
          console.error('Relational contact query failed; using memory:', safeErrorSummary(error));
        }
      }
      await ensureDataLoaded(tenantId, true); // MUST load contacts here
      let items = filterText(contactsForTenant(tenantId), query.q, ['fullName', 'companyName', 'title', 'email', 'notes']);
      const minScore = Number(query.minScore || 0);
      if (minScore > 0) items = items.filter((item) => Number(item.priorityScore || 0) >= minScore);
      if (query.outreachStatus) items = items.filter((item) => normalizeKey(item.outreachStatus) === normalizeKey(query.outreachStatus));
      items.sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0)
        || String(a.fullName || '').localeCompare(String(b.fullName || '')));
      return paginate(items, query);
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

    async findJobs(tenantId, query) {
      assertTenant(tenantId);
      if (relationalJobSqlEnabledForTenant(tenantId)) {
        try {
          if (await hasRelationalParity(tenantId, false)) {
            const result = await findTenantJobsRelational(tenantId, query);
            if (result) {
              if (!confirmedRelationalJobSqlTenants.has(tenantId)) {
                confirmedRelationalJobSqlTenants.add(tenantId);
                console.log(`Relational SQL job queries active for ${tenantId}.`);
              }
              return result;
            }
          } else {
            console.warn(`Relational job query fallback for ${tenantId}: parity check failed.`);
          }
        } catch (error) {
          console.error('Relational job query failed; using memory:', safeErrorSummary(error));
        }
      }
      const queryStartedAt = performance.now();
      let items = filterText(jobsForTenant(tenantId), query.q, ['title', 'companyName', 'location', 'source']);
      if (query.ats) {
        const ats = normalizeAtsType(query.ats);
        items = items.filter((item) => normalizeAtsType(item.atsType || item.source) === ats);
      }
      if (query.active === 'true' || query.active === true) {
        items = items.filter((item) => item.active !== false);
      } else if (query.active === 'false' || query.active === false) {
        items = items.filter((item) => item.active === false);
      }
      if (query.isNew === 'true' || query.isNew === true) {
        items = items.filter((item) => item.isNew);
      } else if (query.isNew === 'false' || query.isNew === false) {
        items = items.filter((item) => !item.isNew);
      }
      const recencyDays = Number(query.recencyDays || 0);
      if (recencyDays > 0) {
        items = items.filter((item) => daysSince(item.postedAt) <= recencyDays);
      }
      const minRelevance = Number(query.minRelevance || 0);
      if (minRelevance > 0) {
        items = items.filter((item) => Number(item.relevanceScore ?? -1) >= minRelevance);
      }
      if (query.sortBy === 'relevance') {
        items.sort((a, b) => Number(b.relevanceScore ?? -1) - Number(a.relevanceScore ?? -1)
          || String(b.postedAt || b.importedAt || '').localeCompare(String(a.postedAt || a.importedAt || '')));
      } else if (query.sortBy === 'retrieved') {
        items.sort((a, b) => String(b.retrievedAt || b.importedAt || '').localeCompare(String(a.retrievedAt || a.importedAt || '')));
      }
      const result = paginate(items, query);
      const queryElapsedMs = Math.round(performance.now() - queryStartedAt);
      if (queryElapsedMs > 250) {
        console.warn(`Slow job query: saas/src/store.js findJobs ${queryElapsedMs}ms`);
      }
      return result;
    },

    async findConfigs(tenantId, query) {
      assertTenant(tenantId);
      const filterKeys = ['q', 'ats', 'active', 'discoveryStatus', 'confidenceBand', 'reviewStatus'];
      const needsInMemoryFiltering = filterKeys.some((key) => String(query?.[key] || '').trim());
      if (relationalConfigSqlEnabledForTenant(tenantId) && !needsInMemoryFiltering) {
        try {
          if (await hasRelationalParity(tenantId, false)) {
            const result = await findTenantConfigsRelational(tenantId, query);
            if (result) {
              if (!confirmedRelationalConfigSqlTenants.has(tenantId)) {
                confirmedRelationalConfigSqlTenants.add(tenantId);
                console.log(`Relational SQL config queries active for ${tenantId}.`);
              }
              return result;
            }
          } else {
            console.warn(`Relational config query fallback for ${tenantId}: parity check failed.`);
          }
        } catch (error) {
          console.error('Relational config query failed; using memory:', safeErrorSummary(error));
        }
      }
      await ensureDataLoaded(tenantId, false);
      let items = filterText(configsForTenant(tenantId), query.q, ['companyName', 'normalizedCompanyName', 'boardId', 'domain', 'careersUrl', 'resolvedBoardUrl', 'source', 'notes']);
      if (query.ats) {
        const ats = normalizeAtsType(query.ats);
        items = items.filter((item) => normalizeAtsType(item.atsType || item.ats) === ats);
      }
      if (query.active === 'true' || query.active === true) items = items.filter((item) => item.active !== false);
      if (query.active === 'false' || query.active === false) items = items.filter((item) => item.active === false);
      if (query.discoveryStatus) items = items.filter((item) => normalizeKey(item.discoveryStatus) === normalizeKey(query.discoveryStatus));
      if (query.confidenceBand) items = items.filter((item) => normalizeKey(item.confidenceBand) === normalizeKey(query.confidenceBand));
      if (query.reviewStatus) items = items.filter((item) => normalizeKey(item.reviewStatus) === normalizeKey(query.reviewStatus));
      items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.id || '').localeCompare(String(b.id || '')));
      return paginate(items, query);
    },

    async getConfig(tenantId, configId) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false);
      return boardConfigs.find((item) => item.tenantId === tenantId && item.id === configId) || null;
    },

    addConfig(tenantId, payload) {
      assertTenant(tenantId);
      const config = normalizeConfigPatch({
        id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
      getTenantArray(configsByTenant, tenantId).unshift(config);
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

    async reviewConfig(tenantId, configId, payload) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false);
      const config = boardConfigs.find((item) => item.tenantId === tenantId && item.id === configId);
      if (!config) return null;
      const rejected = payload.action === 'reject';
      const timestamp = now();
      config.reviewStatus = rejected ? 'rejected' : 'approved';
      config.active = !rejected;
      config.updatedAt = timestamp;
      if (rejected) {
        const tenantJobs = getTenantArray(jobsByTenant, tenantId);
        deactivateJobsForConfig(config, tenantJobs, timestamp);
        const accountItem = config.accountId ? accountById(config.accountId, tenantId) : null;
        if (accountItem) refreshAccountHiringStats(accountItem, tenantJobs);
      }
      persistTenant(tenantId);
      return config;
    },

    async patchSettings(tenantId, patch) {
      assertTenant(tenantId);
      await ensureTenantSettingsLoaded(tenantId);
      await ensureDataLoaded(tenantId, false);
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
      const persona = normalizePersona(profile.persona || profile.settings.persona);
      if (patch.searchFocus && typeof patch.searchFocus === 'object') {
        const currentByPersona = profile.settings.searchFocusByPersona || {};
        profile.settings.searchFocusByPersona = {
          ...currentByPersona,
          [persona]: sanitizeSearchFocus(patch.searchFocus, currentByPersona[persona]),
        };
      }
      const focus = getSearchFocus(profile.settings, persona);
      const tenantJobs = jobsForTenant(tenantId);
      const accountMap = new Map(accountsForTenant(tenantId).map((item) => [item.id, item]));
      let rescoredJobs = 0;
      for (const item of tenantJobs) {
        const relevance = scoreJobRelevance(item, accountMap.get(item.accountId), focus);
        Object.assign(item, relevance, { relevanceUpdatedAt: now(), updatedAt: now() });
        rescoredJobs++;
      }
      for (const item of accountMap.values()) refreshAccountHiringStats(item, tenantJobs, focus);
      persistTenant(tenantId);
      return { ok: true, settings: { ...profile.settings }, rescoredJobs };
    },

    async getWorkspacePreferences(tenantId) {
      assertTenant(tenantId);
      await ensureTenantSettingsLoaded(tenantId);
      const profile = getTenantProfile(tenantId);
      return JSON.parse(JSON.stringify(profile.settings.workspacePreferences || {}));
    },

    async patchWorkspacePreferences(tenantId, patch) {
      assertTenant(tenantId);
      await ensureTenantSettingsLoaded(tenantId);
      const profile = getTenantProfile(tenantId);
      profile.settings.workspacePreferences = sanitizeWorkspacePreferences(patch, profile.settings.workspacePreferences || {});
      persistTenant(tenantId);
      return profile.settings.workspacePreferences;
    },

    completeSetup(tenantId, payload = {}, options = {}) {
      assertTenant(tenantId);
      const profile = getTenantProfile(tenantId);
      const workspaceName = String(payload.workspaceName || '').trim();
      const userName = String(payload.userName || '').trim();
      const userEmail = String(payload.userEmail || '').trim();
      if (workspaceName) {
        profile.workspace.name = workspaceName;
        profile.workspace.companyName = workspaceName;
        profile.workspace.updatedAt = now();
      }
      if (userName || userEmail) {
        profile.settings.user = {
          ...(profile.settings.user || {}),
          name: userName || profile.settings.user?.name || '',
          email: userEmail || profile.settings.user?.email || '',
        };
      }
      if (Array.isArray(payload.owners)) {
        const owners = payload.owners
          .filter((item) => item && (item.name || item.displayName || item.email))
          .map((item, index) => ({
            id: item.id || `owner-${tenantId}-${index + 1}`,
            name: item.name || item.displayName || item.email || `Owner ${index + 1}`,
            displayName: item.displayName || item.name || item.email || `Owner ${index + 1}`,
            email: item.email || '',
            role: item.role || (index === 0 ? 'Owner' : 'Member'),
          }));
        if (owners.length) profile.settings.ownerRoster = owners;
      }
      const wasComplete = profile.settings.setupComplete;
      profile.settings.setupComplete = true;
      profile.settings.lastPipelineRun = now();
      persistTenant(tenantId);
      
      if (!wasComplete && options.runPipeline !== false) {
        console.log(`[Auto-Pipeline] Triggering initial pipeline for ${tenantId}`);
        this.startRevenuePipeline(tenantId);
      }
      return { ok: true };
    },

    async loadSampleWorkspace(tenantId, options = {}) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, true);
      const existingCounts = countTenantWorkspaceItems(tenantId);
      const normalizedCounts = normalizeWorkspaceLoadCounts(existingCounts);
      if (!options.force && (normalizedCounts.accounts || normalizedCounts.contacts || normalizedCounts.jobs || normalizedCounts.configs)) {
        return {
          error: 'Sample data can only be loaded into an empty workspace.',
          counts: normalizedCounts,
        };
      }
      const profile = getTenantProfile(tenantId);
      if (options.setup) this.completeSetup(tenantId, options.setup, { runPipeline: false });
      const persona = normalizePersona(options.persona || profile?.persona || profile?.settings?.persona);
      const sample = buildSampleWorkspaceData(tenantId, persona);
      replaceTenantItems(accountsByTenant, 'accounts', tenantId, sample.accounts);
      replaceTenantItems(contactsByTenant, 'contacts', tenantId, sample.contacts);
      replaceTenantItems(jobsByTenant, 'jobs', tenantId, sample.jobs);
      replaceTenantItems(configsByTenant, 'configs', tenantId, sample.configs);
      replaceTenantItems(activitiesByTenant, 'activities', tenantId, sample.activities);
      replaceTenantItems(tasksByTenant, 'tasks', tenantId, sample.tasks);
      if (profile) {
        profile.settings.setupComplete = true;
        profile.settings.sampleDataLoadedAt = now();
        profile.settings.lastPipelineRun = now();
      }
      loadedTenants.set(tenantId, { core: true, contacts: true });
      persistTenant(tenantId);
      return {
        ok: true,
        sample: true,
        stats: {
          accounts: sample.accounts.length,
          contacts: sample.contacts.length,
          jobs: sample.jobs.length,
          configs: sample.configs.length,
          tasks: sample.tasks.length,
          imported: sample.contacts.length,
          updated: 0,
          skipped: 0,
          failed: 0,
        },
      };
    },

    getActivity(tenantId, query) {
      assertTenant(tenantId);
      return paginate(activitiesForTenant(tenantId), query);
    },

    async addActivity(tenantId, userId, payload) {
      assertTenant(tenantId);
      // Load core first: otherwise on a cold tenant this creates a fresh
      // single-item tenant array, persistTenant skips it (status.core false ->
      // COALESCE keeps old DB rows), and the next load overwrites it — the
      // logged activity/follow-up would silently vanish.
      await ensureDataLoaded(tenantId, false);
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
      // Also write to the tenant map: findActivities reads and persistTenant
      // saves ONLY the tenant maps, so global-only writes were invisible in
      // the UI and silently dropped on restart.
      getTenantArray(activitiesByTenant, tenantId).unshift(activity);
      const itemAccount = activity.accountId ? accountById(activity.accountId, tenantId) : null;
      if (itemAccount) {
        itemAccount.lastContactedAt = activity.occurredAt;
        if (activity.pipelineStage) itemAccount.outreachStatus = activity.pipelineStage;
      }

      // Auto-create follow-up task if requested
      if (payload.followUpDays) {
        const days = parseInt(payload.followUpDays, 10);
        if (!isNaN(days) && days > 0) {
          const task = {
            id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            tenantId,
            accountId: payload.accountId,
            type: 'follow_up',
            status: 'pending',
            summary: `Follow up on outreach sent today to ${payload.contactName || 'contact'}.`,
            dueDate: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: now(),
          };
          tasks.push(task);
          getTenantArray(tasksByTenant, tenantId).push(task);
        }
      }

      persistTenant(tenantId);
      return activity;
    },

    findActivities(tenantId, query) {
      assertTenant(tenantId);
      return paginate(activitiesForTenant(tenantId), query);
    },

    async findTasks(tenantId, query) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false);
      const status = query.status || 'pending';
      return paginate(tasksForTenant(tenantId).filter(t => t.status === status), query);
    },

    async createTask(tenantId, payload = {}) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false);
      const summary = String(payload.summary || '').trim().slice(0, 240);
      if (!summary) throw new Error('Task summary is required');
      const requestedDueDate = new Date(payload.dueDate || Date.now() + 24 * 60 * 60 * 1000);
      const task = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        tenantId,
        accountId: String(payload.accountId || '').slice(0, 120),
        type: String(payload.type || 'follow_up').slice(0, 60),
        status: 'pending',
        summary,
        dueDate: Number.isNaN(requestedDueDate.getTime()) ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : requestedDueDate.toISOString(),
        createdAt: now(),
        updatedAt: now(),
      };
      tasks.push(task);
      getTenantArray(tasksByTenant, tenantId).push(task);
      persistTenant(tenantId);
      return task;
    },

    async completeTask(tenantId, taskId) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, false);
      const task = tasksForTenant(tenantId).find((item) => item.id === taskId);
      if (task) {
        task.status = 'completed';
        task.updatedAt = now();
        persistTenant(tenantId);
      }
      return task;
    },

    async createOutreachDraft(tenantId, accountId, payload = {}) {
      assertTenant(tenantId);
      const totalStartedAt = performance.now();
      const detailStartedAt = performance.now();
      const detail = await this.getAccountDetail(tenantId, accountId);
      const detailLoadMs = Math.round(performance.now() - detailStartedAt);
      if (!detail) return null;
      const selectedContact = selectContact(detail.contacts, payload.contactName)
        || (payload.contactName || payload.contactTitle ? {
          fullName: payload.contactName || '',
          firstName: String(payload.contactName || '').trim().split(/\s+/)[0] || '',
          title: payload.contactTitle || '',
        } : null);
      const template = payload.template || (this.getPersona(tenantId) === 'jobseeker' ? 'job_intro' : 'cold');
      const draft = buildDraft({
        account: detail.account,
        contact: selectedContact,
        jobs: detail.jobs,
        template,
        jobId: payload.jobId,
        includeVariants: payload.includeVariants === true,
      });
      draft.timings = {
        ...(draft.timings || {}),
        detailLoadMs,
        totalMs: Math.round(performance.now() - totalStartedAt),
      };
      if (draft.timings.totalMs > 500) {
        console.warn(`Slow outreach draft: saas/src/store.js createOutreachDraft ${draft.timings.totalMs}ms`, draft.timings);
      }
      return draft;
    },

    async createContactOutreachDraft(tenantId, contactId, payload = {}) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId, true);
      const itemContact = contacts.find((item) => item.tenantId === tenantId && item.id === contactId);
      if (!itemContact) return null;
      return this.createOutreachDraft(tenantId, itemContact.accountId, {
        ...payload,
        contactName: payload.contactName || itemContact.fullName || itemContact.id,
      });
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
      const tenantConfigs = configsForTenant(tenantId);
      const resolved = tenantConfigs.filter(isResolvedBoardConfig);
      const medium = tenantConfigs.filter((item) => item.confidenceBand === 'medium');
      const unresolved = tenantConfigs.filter((item) => !isResolvedBoardConfig(item));
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
      const items = configsForTenant(tenantId)
        .filter((item) => band === 'medium' ? item.confidenceBand === 'medium' : !isResolvedBoardConfig(item));
      return paginate(items, { page: 1, pageSize: 10 });
    },

    getEnrichmentQueue(tenantId, query = {}) {
      assertTenant(tenantId);
      const tenantConfigs = configsForTenant(tenantId);
      let candidates = decorateAccountsWithConfigs(accountsForTenant(tenantId), tenantConfigs).map((item) => ({
        ...item,
        reviewReason: item.reviewReason || item.recommendedAction || 'Review this account before deeper verification.',
      }));
      if (query.confidence) candidates = candidates.filter((item) => normalizeKey(item.enrichmentConfidence) === normalizeKey(query.confidence));
      if (query.missingDomain === 'true' || query.missingDomain === true) candidates = candidates.filter((item) => !(item.canonicalDomain || item.domain));
      if (query.missingCareersUrl === 'true' || query.missingCareersUrl === true) candidates = candidates.filter((item) => !item.careersUrl);
      if (query.hasConnections === 'true' || query.hasConnections === true) candidates = candidates.filter((item) => Number(item.connectionCount || item.contactCount || 0) > 0);
      const minTargetScore = Number(query.minTargetScore || 0);
      if (minTargetScore > 0) candidates = candidates.filter((item) => Number(item.targetScore || item.dailyScore || 0) >= minTargetScore);
      candidates.sort((a, b) => Number(b.targetScore || b.dailyScore || 0) - Number(a.targetScore || a.dailyScore || 0)
        || String(a.displayName || '').localeCompare(String(b.displayName || '')));
      const topN = Number(query.topN || 0);
      if (topN > 0) candidates = candidates.slice(0, topN);
      return paginate(candidates, query);
    },

    startLaunchWorkflow(tenantId, options = {}) {
      assertTenant(tenantId);
      const jobId = `launch-workflow-${Date.now()}`;
      const job = {
        id: jobId,
        type: 'launch-workflow',
        status: 'queued',
        summary: 'End-to-end launch workflow',
        progressMessage: 'Queued launch workflow.',
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        progress: 0,
        stage: 'queued',
        recordsAffected: 0,
        result: null,
      };
      trackBackgroundJob(tenantId, job);

      setImmediate(async () => {
        const updateProgress = (progress, stage, message) => {
          job.progress = Math.max(0, Math.min(100, Math.round(progress)));
          job.stage = stage;
          job.progressMessage = message;
          job.updatedAt = now();
        };
        try {
          job.status = 'running';
          job.startedAt = now();
          updateProgress(5, 'loading', 'Loading workspace data...');
          const result = await this.runLaunchWorkflow(tenantId, { ...options, onProgress: updateProgress });
          job.status = 'completed';
          updateProgress(100, 'completed', 'Completed');
          job.recordsAffected = getTrackedJobCountFromResult(result) || getTouchedJobCountFromResult(result) || result.stats?.accountsProcessed || 0;
          job.result = result;
        } catch (err) {
          job.status = 'failed';
          job.errorMessage = err.message || 'Launch workflow failed.';
        } finally {
          job.finishedAt = now();
        }
      });

      return { ok: true, jobId, job };
    },

    async runLaunchWorkflow(tenantId, { plan, onProgress } = {}) {
      assertTenant(tenantId);
      const updateProgress = typeof onProgress === 'function' ? onProgress : () => {};
      const totalStartedAt = performance.now();
      const timings = {};
      const selectedPlan = plan || { displayName: 'current', limits: {} };
      const planName = selectedPlan.displayName || selectedPlan.name || 'current';
      const accountLimit = Number(selectedPlan.limits?.accounts ?? -1);
      const jobBoardLimit = Number(selectedPlan.limits?.jobBoards ?? -1);
      const loadStartedAt = performance.now();
      await ensureDataLoaded(tenantId, true);
      timings.scopeLoadMs = Math.round(performance.now() - loadStartedAt);
      updateProgress(12, 'loaded', 'Loaded workspace data.');
      const tenantAccounts = accountsForTenant(tenantId).slice(0, accountLimit === -1 ? undefined : accountLimit);
      let tenantConfigs = boardConfigs.filter((item) => item.tenantId === tenantId);
      const inferredDomainsByAccount = buildInferredDomainMap(tenantId);
      const warnings = [];

      if (accountLimit !== -1 && accountsForTenant(tenantId).length > accountLimit) {
        warnings.push(`Only the first ${accountLimit} accounts were processed on the ${planName} plan.`);
      }

      let configsCreated = 0;
      const existingWorkflowConfigNames = new Set(tenantConfigs.map((config) => config.normalizedCompanyName));
      for (const item of tenantAccounts) {
        if (existingWorkflowConfigNames.has(item.normalizedName)) continue;
        if (jobBoardLimit !== -1 && tenantConfigs.length >= jobBoardLimit) {
          warnings.push(`ATS config creation stopped at the ${jobBoardLimit} board limit for the ${planName} plan.`);
          break;
        }
        const domain = getUsableCompanyDomain(item.domain || item.canonicalDomain)
          || inferredDomainsByAccount.get(item.id)
          || '';
        const config = normalizeConfigPatch({
          id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          accountId: item.id,
          companyName: item.displayName,
          normalizedCompanyName: item.normalizedName,
          atsType: 'unknown',
          ats: 'unknown',
          boardId: '',
          domain,
          careersUrl: domain ? `https://${domain.replace(/^https?:\/\//, '')}/careers` : '',
          active: false,
          discoveryStatus: 'needs_review',
          reviewStatus: 'pending',
          confidenceBand: domain ? 'medium' : 'unresolved',
          source: 'launch_workflow',
          lastImportStatus: 'not ready',
          createdAt: now(),
          updatedAt: now(),
        });
        boardConfigs.unshift(config);
        getTenantArray(configsByTenant, tenantId).unshift(config);
        tenantConfigs.unshift(config);
        existingWorkflowConfigNames.add(config.normalizedCompanyName);
        configsCreated++;
      }
      updateProgress(22, 'configs', `Prepared ${configsCreated} new ATS config${configsCreated === 1 ? '' : 's'}.`);

      let enriched = 0;
      const enrichStartedAt = performance.now();
      for (const item of tenantAccounts) {
        const domain = getUsableCompanyDomain(item.domain || item.canonicalDomain)
          || inferredDomainsByAccount.get(item.id)
          || '';
        if (domain && !item.domain) item.domain = domain;
        if (domain && !item.canonicalDomain) item.canonicalDomain = domain;
        if (domain && !item.careersUrl) item.careersUrl = `https://${domain.replace(/^https?:\/\//, '')}/careers`;
        item.enrichmentStatus = domain ? 'enriched' : 'needs_review';
        item.enrichmentConfidence = domain ? 'high' : 'medium';
        item.updatedAt = now();
        if (domain) enriched++;
      }
      timings.enrichmentMs = Math.round(performance.now() - enrichStartedAt);
      updateProgress(35, 'enrichment', `Enriched ${enriched}/${tenantAccounts.length} accounts.`);

      let configsResolved = 0;
      for (const config of tenantConfigs.slice(0, jobBoardLimit === -1 ? undefined : jobBoardLimit)) {
        if (config.reviewStatus === 'rejected') continue;
        if (hasSupportedBoardIdentity(config)) {
          config.discoveryStatus = 'resolved';
          config.reviewStatus = 'approved';
          config.confidenceBand = 'high';
          config.active = true;
          config.lastImportStatus = 'ready';
          config.updatedAt = now();
          configsResolved++;
        } else {
          config.discoveryStatus = config.discoveryStatus === 'error' ? 'error' : 'needs_review';
          config.reviewStatus = config.reviewStatus || 'pending';
          config.confidenceBand = config.domain || config.careersUrl ? 'medium' : 'unresolved';
          config.active = false;
          config.lastImportStatus = 'not ready';
          config.updatedAt = now();
        }
      }

      updateProgress(45, 'discovery', 'Discovering public ATS boards...');
      const launchDiscoveryLimit = jobBoardLimit === -1
        ? Math.max(1, tenantConfigs.length || tenantAccounts.length)
        : Math.max(1, jobBoardLimit);
      const discovery = await this.runAtsDiscovery(tenantId, {
        plan: selectedPlan,
        limit: launchDiscoveryLimit,
        onlyMissing: true,
      });
      timings.discoveryMs = discovery.timings?.totalMs || 0;
      warnings.push(...(discovery.warnings || []));
      updateProgress(68, 'discovery', `Mapped ${discovery.stats?.mapped || 0}/${discovery.stats?.checked || 0} ATS boards.`);

      updateProgress(72, 'import', 'Importing live jobs from active ATS boards...');
      const importResult = await this.importLiveJobs(tenantId, { plan: selectedPlan, autoDiscover: false });
      timings.importMs = importResult.timings?.totalMs || 0;
      warnings.push(...(importResult.warnings || []));
      updateProgress(88, 'import', `Fetched ${importResult.stats?.fetched || 0} jobs; imported ${importResult.stats?.kept || importResult.stats?.canadaKept || 0} jobs.`);

      let scoresRefreshed = 0;
      const scoringStartedAt = performance.now();
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
      timings.scoringMs = Math.round(performance.now() - scoringStartedAt);
      updateProgress(95, 'scoring', `Refreshed ${scoresRefreshed} account scores.`);

      const launchActivity = {
        id: `act-${Date.now()}`,
        tenantId,
        type: 'launch_workflow',
        summary: `Launch workflow processed ${tenantAccounts.length} accounts, mapped ${discovery.stats?.mapped || 0} boards, and is tracking ${importResult.stats?.imported || 0} active jobs on the ${planName} plan.`,
        notes: warnings.join(' '),
        occurredAt: now(),
        createdAt: now(),
        metadata: {
          plan: selectedPlan.id || 'unknown',
          discovery: discovery.stats,
          import: importResult.stats,
        },
      };
      activities.unshift(launchActivity);
      getTenantArray(activitiesByTenant, tenantId).unshift(launchActivity);

      persistTenant(tenantId);
      timings.totalMs = Math.round(performance.now() - totalStartedAt);
      if (timings.totalMs > 15000) {
        console.warn(`Slow launch workflow: saas/src/store.js runLaunchWorkflow ${timings.totalMs}ms`, timings);
      }

      return {
        workflow: 'launch',
        plan: { id: selectedPlan.id || 'unknown', displayName: planName },
        stats: {
          accountsProcessed: tenantAccounts.length,
          configsCreated,
          configsResolved,
          enriched,
          boardsChecked: discovery.stats?.checked || 0,
          boardsMapped: discovery.stats?.mapped || 0,
          boardsUnresolved: discovery.stats?.unresolved || 0,
          jobsFetched: importResult.stats?.fetched || 0,
          jobsKept: importResult.stats?.kept || importResult.stats?.canadaKept || 0,
          jobsTouched: importResult.stats?.runImported || 0,
          activeTrackedJobs: importResult.stats?.imported || 0,
          scoresRefreshed,
        },
        discovery: discovery.stats,
        importRun: importResult.importRun,
        warnings,
        timings,
      };
    },

    startAtsDiscovery(tenantId, options = {}) {
      assertTenant(tenantId);
      const jobId = `ats-discovery-${Date.now()}`;
      const job = {
        id: jobId,
        type: 'ats-discovery',
        status: 'queued',
        summary: 'ATS discovery',
        progressMessage: 'Queued ATS discovery.',
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        progress: 0,
        stage: 'queued',
        recordsAffected: 0,
        result: null,
      };
      trackBackgroundJob(tenantId, job);

      setImmediate(async () => {
        try {
          job.status = 'running';
          job.startedAt = now();
          job.progress = 20;
          job.stage = 'discovery';
          job.progressMessage = 'Mapping public ATS boards...';
          const result = await this.runAtsDiscovery(tenantId, options);
          job.status = 'completed';
          job.progress = 100;
          job.stage = 'completed';
          job.progressMessage = 'Completed';
          job.recordsAffected = result.stats?.mapped || result.stats?.discovered || 0;
          job.result = result;
        } catch (err) {
          job.status = 'failed';
          job.errorMessage = err.message || 'ATS discovery failed.';
        } finally {
          job.finishedAt = now();
        }
      });

      return { ok: true, jobId, job };
    },

    async runAtsDiscovery(tenantId, options = {}) {
      assertTenant(tenantId);
      const totalStartedAt = performance.now();
      const timings = {};
      const warnings = [];
      const errors = [];
      const selectedPlan = options.plan || { displayName: 'current', limits: {} };
      const jobBoardLimit = Number(selectedPlan.limits?.jobBoards ?? -1);
      const requestedLimitOption = Number(options.limit || 0);
      const onlyMissing = options.onlyMissing !== false && options.onlyMissing !== 'false';
      const forceRefresh = options.forceRefresh === true || options.forceRefresh === 'true';

      const loadStartedAt = performance.now();
      await ensureDataLoaded(tenantId, false);
      timings.scopeLoadMs = Math.round(performance.now() - loadStartedAt);

      const tenantAccounts = accountsForTenant(tenantId);
      let tenantConfigs = boardConfigs.filter((item) => item.tenantId === tenantId);
      const existingConfigNames = new Set(tenantConfigs.map((item) => normalizeKey(item.normalizedCompanyName || item.companyName)));
      let createdConfigs = 0;
      for (const item of tenantAccounts) {
        // DATA-101: only tracked targets get discovery configs — an imported
        // network of 12k employers must not become a 12k-company scrape queue.
        if (!isTrackedTarget(item)) continue;
        if (createdConfigs + tenantConfigs.length >= (jobBoardLimit === -1 ? Infinity : jobBoardLimit)) break;
        const normalizedName = normalizeKey(item.normalizedName || item.displayName);
        if (!normalizedName || existingConfigNames.has(normalizedName)) continue;
        const inferredDomain = getUsableCompanyDomain(item.domain || item.canonicalDomain)
          || inferDomainFromContacts(tenantId, item.id);
        const config = normalizeConfigPatch({
          id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          tenantId,
          accountId: item.id,
          companyName: item.displayName,
          normalizedCompanyName: normalizedName,
          atsType: 'unknown',
          ats: 'unknown',
          boardId: '',
          domain: inferredDomain,
          careersUrl: item.careersUrl || '',
          active: false,
          discoveryStatus: 'needs_review',
          reviewStatus: 'pending',
          confidenceBand: inferredDomain || item.careersUrl ? 'medium' : 'unresolved',
          source: 'ats_discovery',
          createdAt: now(),
          updatedAt: now(),
        });
        boardConfigs.unshift(config);
        getTenantArray(configsByTenant, tenantId).unshift(config);
        tenantConfigs.unshift(config);
        existingConfigNames.add(normalizedName);
        createdConfigs++;
      }

      const identityRepairStartedAt = performance.now();
      let directResolved = 0;
      for (const config of tenantConfigs) {
        if (repairKnownAtsIdentity(config, { approveDirect: true })) directResolved++;
      }
      timings.identityRepairMs = Math.round(performance.now() - identityRepairStartedAt);

      // Hard cap on configs probed per run. Domain-guessing scrapes several
      // careers URLs per company, so an unlimited plan (12k+ configs) would
      // otherwise fan out to ~100k external fetches in a single run. Callers
      // chew through the backlog by running discovery repeatedly.
      const defaultLimit = jobBoardLimit === -1
        ? DEFAULT_ATS_MAX_DISCOVERY_BATCH
        : Math.min(75, Math.max(1, jobBoardLimit));
      const requestedLimit = requestedLimitOption > 0 ? Math.floor(requestedLimitOption) : defaultLimit;
      const cappedByPlan = jobBoardLimit === -1 ? requestedLimit : Math.min(requestedLimit, Math.max(1, jobBoardLimit));
      const limit = Math.min(cappedByPlan, DEFAULT_ATS_MAX_DISCOVERY_BATCH);
      let candidates = tenantConfigs.filter((item) => item.reviewStatus !== 'rejected');
      // DATA-101: probe only tracked targets' boards. Configs that resolve to
      // an untracked (network) account are skipped; configs with no matching
      // account keep working (they were created deliberately).
      const trackFilterById = new Map(tenantAccounts.map((item) => [item.id, item]));
      const trackFilterByName = new Map(
        tenantAccounts
          .filter((item) => item.normalizedName)
          .map((item) => [item.normalizedName, item])
      );
      candidates = candidates.filter((item) => {
        const owner = accountForConfig(item, trackFilterById, trackFilterByName);
        return !owner || isTrackedTarget(owner);
      });
      if (onlyMissing && !forceRefresh) {
        candidates = candidates.filter((item) => {
          return !isResolvedBoardConfig(item) || item.discoveryStatus === 'needs_review' || item.discoveryStatus === 'unresolved';
        });
      }
      const prioritizeStartedAt = performance.now();
      const accountsById = new Map(tenantAccounts.map((item) => [item.id, item]));
      const accountsByName = new Map(
        tenantAccounts
          .map((item) => [normalizeKey(item.normalizedName || item.displayName), item])
          .filter(([key]) => key)
      );
      const profile = getTenantProfile(tenantId);
      const searchFocus = getSearchFocus(profile?.settings, profile?.persona);
      const relevantJobsByAccount = new Map();
      for (const item of jobsForTenant(tenantId)) {
        if (!item.accountId || item.active === false) continue;
        if (Number(item.relevanceScore ?? -1) < searchFocus.minimumRelevanceScore) continue;
        relevantJobsByAccount.set(item.accountId, (relevantJobsByAccount.get(item.accountId) || 0) + 1);
      }
      candidates = prioritizeDiscoveryCandidates(candidates, accountsById, accountsByName, {
        searchFocus,
        relevantJobsByAccount,
      }).slice(0, limit);
      let linkedAccountConfigs = 0;
      for (const config of candidates) {
        if (config.accountId) continue;
        const owner = accountForConfig(config, accountsById, accountsByName);
        if (!owner?.id) continue;
        config.accountId = owner.id;
        config.updatedAt = now();
        linkedAccountConfigs++;
      }
      timings.candidatePrioritizationMs = Math.round(performance.now() - prioritizeStartedAt);

      let checked = 0;
      let mapped = directResolved;
      let highConfidence = directResolved;
      let suggested = 0;
      let unresolved = 0;
      const discoveryStartedAt = performance.now();
      const discoveryConcurrency = readPositiveInteger(options.discoveryConcurrency || options.concurrency, DEFAULT_ATS_DISCOVERY_CONCURRENCY);
      const discoveredBoards = await mapSettledWithConcurrency(candidates, discoveryConcurrency, async (config) => {
        const match = await discoverAtsBoard(config);
        return { config, match };
      });
      for (let index = 0; index < discoveredBoards.length; index++) {
        const config = candidates[index];
        const settled = discoveredBoards[index];
        checked++;
        if (settled.status === 'rejected') {
          const message = settled.reason?.message || 'Discovery failed';
          errors.push({ configId: config.id, companyName: config.companyName, error: message });
          config.discoveryStatus = 'error';
          config.discoveryMethod = 'public_ats_probe';
          config.lastDiscoveryError = message;
          config.lastDiscoveryCheckedAt = now();
          config.updatedAt = now();
          unresolved++;
          continue;
        }

        const match = settled.value?.match;
        try {
          if (match) {
            const requiresReview = match.method === 'public_ats_probe' || match.requiresReview === true;
            Object.assign(config, {
              atsType: match.atsType,
              ats: match.atsType,
              boardId: match.boardId,
              apiUrl: match.apiUrl,
              resolvedBoardUrl: match.resolvedBoardUrl,
              discoveryStatus: requiresReview ? 'needs_review' : 'resolved',
              discoveryMethod: match.method,
              confidenceBand: requiresReview ? 'medium' : 'high',
              reviewStatus: requiresReview ? 'pending' : 'approved',
              active: !requiresReview,
              lastDiscoveryJobCount: match.jobCount,
              lastDiscoveryCheckedAt: now(),
              updatedAt: now(),
            });
            if (requiresReview) {
              suggested++;
              unresolved++;
            } else {
              mapped++;
              highConfidence++;
            }
          } else {
            config.discoveryStatus = 'unresolved';
            config.discoveryMethod = 'public_ats_probe';
            config.confidenceBand = config.domain || config.careersUrl ? 'medium' : 'unresolved';
            config.lastDiscoveryCheckedAt = now();
            config.updatedAt = now();
            unresolved++;
          }
        } catch (err) {
          const message = err.message || 'Discovery failed';
          errors.push({ configId: config.id, companyName: config.companyName, error: message });
          config.discoveryStatus = 'error';
          config.discoveryMethod = 'public_ats_probe';
          config.lastDiscoveryError = message;
          config.lastDiscoveryCheckedAt = now();
          config.updatedAt = now();
          unresolved++;
        }
      }
      timings.discoveryMs = Math.round(performance.now() - discoveryStartedAt);
      timings.discoveryConcurrency = discoveryConcurrency;

      const persistStartedAt = performance.now();
      if (createdConfigs || directResolved || linkedAccountConfigs || checked) persistTenant(tenantId);
      timings.persistQueuedMs = Math.round(performance.now() - persistStartedAt);
      timings.totalMs = Math.round(performance.now() - totalStartedAt);

      if (timings.totalMs > 10000) {
        console.warn(`Slow ATS discovery: saas/src/store.js runAtsDiscovery ${timings.totalMs}ms`, timings);
      }
      if (!mapped && suggested) {
        warnings.push(`Found ${suggested} possible ATS board${suggested === 1 ? '' : 's'} by company-name matching. Review them before importing jobs.`);
      } else if (!mapped && checked) {
        warnings.push('No supported public job boards were matched. Add the company careers URL or a known board URL, then try discovery again.');
      }

      const stats = {
        checked,
        mapped,
        discovered: mapped,
        highConfidence,
        suggested,
        unresolved,
        directResolved,
        linkedAccountConfigs,
        configsCreated: createdConfigs,
        candidateCount: candidates.length,
        discoveryConcurrency,
        errors: errors.length,
      };
      if (mapped > 0) {
        dbRecordProductEvent(buildProductEvent({
          eventType: 'board_resolved',
          tenantId,
          eventKey: tenantId,
          dimensions: { source: 'ats_discovery' },
        })).catch((error) => console.error('Board resolution milestone recording failed:', safeErrorSummary(error)));
      }
      return {
        ok: true,
        stats,
        timings,
        warnings,
        errors,
      };
    },

    async startLiveJobImport(tenantId, options = {}) {
      assertTenant(tenantId);
      const jobId = `live-job-import-${Date.now()}`;
      const job = {
        id: jobId,
        type: 'live-job-import',
        status: 'queued',
        summary: 'Live ATS job import',
        progressMessage: 'Queued live ATS job import.',
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        progress: 0,
        stage: 'queued',
        recordsAffected: 0,
        result: null,
        recovery: {
          kind: 'live-job-import',
          attempts: 0,
          options: cloneRecoveryOptions(options),
        },
      };
      trackBackgroundJob(tenantId, job);
      await persistQueuedBackgroundJob(job);
      queueResumableBackgroundJob(this, tenantId, job);

      return { ok: true, jobId, job: publicBackgroundJob(job) };
    },

    async importLiveJobs(tenantId, options = {}) {
      assertTenant(tenantId);
      const totalStartedAt = performance.now();
      const timings = {};
      const warnings = [];
      const errors = [];
      const importStartedAt = now();
      const importRunId = `imp-jobs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const importItems = [];
      const selectedPlan = options.plan || { displayName: 'current', limits: {} };
      const jobBoardLimit = Number(selectedPlan.limits?.jobBoards ?? -1);

      const loadStartedAt = performance.now();
      await ensureDataLoaded(tenantId, false);
      timings.scopeLoadMs = Math.round(performance.now() - loadStartedAt);

      const tenantAccounts = accountsForTenant(tenantId);
      const tenantJobs = getTenantArray(jobsByTenant, tenantId);
      const tenantConfigs = configsForTenant(tenantId);
      const profile = getTenantProfile(tenantId);
      const geographyFilter = parseGeographyFocus(profile?.settings?.geographyFocus);
      const searchFocus = getSearchFocus(profile?.settings, profile?.persona);

      const identityRepairStartedAt = performance.now();
      let directResolvedConfigs = 0;
      for (const config of tenantConfigs) {
        if (repairKnownAtsIdentity(config, { approveDirect: true })) directResolvedConfigs++;
      }
      timings.identityRepairMs = Math.round(performance.now() - identityRepairStartedAt);
      if (directResolvedConfigs) persistTenant(tenantId);

      // DATA-101: refresh only tracked targets' boards; network companies are
      // not part of the paid refresh surface. Unmatched configs keep working.
      const importAccountsById = new Map(tenantAccounts.map((item) => [item.id, item]));
      const importAccountsByName = new Map(
        tenantAccounts
          .filter((item) => item.normalizedName)
          .map((item) => [item.normalizedName, item])
      );
      let activeTenantConfigs = tenantConfigs.filter((item) => {
        if (item.active === false) return false;
        const owner = accountForConfig(item, importAccountsById, importAccountsByName);
        return !owner || isTrackedTarget(owner);
      });
      let importReadyConfigs = activeTenantConfigs.filter(isImportReadyConfig);
      let autoDiscoveryStats = null;
      const autoDiscoverEnabled = options.autoDiscover !== false && options.autoDiscover !== 'false';
      const autoDiscoveryLimit = readPositiveInteger(options.autoDiscoveryLimit, DEFAULT_IMPORT_DISCOVERY_LIMIT);
      const autoDiscoveryMinReady = readPositiveInteger(options.autoDiscoveryMinReady, DEFAULT_IMPORT_DISCOVERY_MIN_READY);
      const hasAutoDiscoveryCandidates = tenantConfigs.some((item) => {
        if (normalizeKey(item.reviewStatus) === 'rejected') return false;
        const owner = accountForConfig(item, importAccountsById, importAccountsByName);
        if (owner && !isTrackedTarget(owner)) return false;
        return !isResolvedBoardConfig(item)
          || ['needs_review', 'unresolved', 'error'].includes(normalizeKey(item.discoveryStatus));
      });
      const autoDiscoveryNeeded = autoDiscoverEnabled
        && autoDiscoveryLimit > 0
        && hasAutoDiscoveryCandidates
        && (options.scheduled === true || options.scheduled === 'true' || importReadyConfigs.length < autoDiscoveryMinReady);
      if (autoDiscoveryNeeded) {
        const autoDiscoveryStartedAt = performance.now();
        const discovery = await this.runAtsDiscovery(tenantId, {
          plan: selectedPlan,
          onlyMissing: true,
          limit: autoDiscoveryLimit,
          discoveryConcurrency: options.discoveryConcurrency || options.concurrency,
        });
        timings.autoDiscoveryMs = Math.round(performance.now() - autoDiscoveryStartedAt);
        autoDiscoveryStats = discovery.stats || {};
        if (discovery.warnings?.length) warnings.push(...discovery.warnings);

        const postDiscoveryRepairStartedAt = performance.now();
        let postDiscoveryDirectResolved = 0;
        for (const config of tenantConfigs) {
          if (repairKnownAtsIdentity(config, { approveDirect: true })) postDiscoveryDirectResolved++;
        }
        timings.postDiscoveryIdentityRepairMs = Math.round(performance.now() - postDiscoveryRepairStartedAt);
        directResolvedConfigs += postDiscoveryDirectResolved;

        activeTenantConfigs = tenantConfigs.filter((item) => {
          if (item.active === false) return false;
          const owner = accountForConfig(item, importAccountsById, importAccountsByName);
          return !owner || isTrackedTarget(owner);
        });
        importReadyConfigs = activeTenantConfigs.filter(isImportReadyConfig);
      }
      let limitedImportConfigs = importReadyConfigs;
      if (jobBoardLimit !== -1 && limitedImportConfigs.length > jobBoardLimit) {
        limitedImportConfigs = limitedImportConfigs.slice(0, jobBoardLimit);
        warnings.push(`Only the first ${jobBoardLimit} active ATS configs were processed on the ${selectedPlan.displayName || selectedPlan.name || 'current'} plan.`);
      }

      const activeConfigs = limitedImportConfigs.length;
      const unsupportedCount = activeTenantConfigs.length - importReadyConfigs.length;
      const needsResolutionConfigs = tenantConfigs.length - importReadyConfigs.length;
      const supportedCandidates = limitedImportConfigs
        .map((config) => ({ config, atsType: getConfigAtsType(config), boardId: getConfigBoardId(config) }))
        .filter(({ config, atsType, boardId }) => isImportReadyConfig(config) && ATS_FETCHERS.has(atsType) && boardId);
      const seenProviderBoards = new Set();
      let duplicateBoardsSkipped = 0;
      const supportedConfigs = supportedCandidates.filter(({ config, atsType, boardId }) => {
        const providerKey = `${atsType}|${normalizeKey(boardId || config.resolvedBoardUrl || config.apiUrl)}`;
        if (seenProviderBoards.has(providerKey)) {
          duplicateBoardsSkipped++;
          return false;
        }
        seenProviderBoards.add(providerKey);
        return true;
      });
      if (duplicateBoardsSkipped) {
        warnings.push(`${duplicateBoardsSkipped} duplicate ATS board configuration${duplicateBoardsSkipped === 1 ? ' was' : 's were'} skipped.`);
      }
      if (!tenantConfigs.length) {
        warnings.push('No active ATS configs were found yet. Run setup/workflow first so the app can discover job boards for your accounts.');
      } else if (!supportedConfigs.length) {
        warnings.push(`No supported job boards were ready to import. Add a board URL or approve a suggested match. ${needsResolutionConfigs} config${needsResolutionConfigs === 1 ? '' : 's'} still need ATS resolution.`);
      } else if (unsupportedCount > 0) {
        warnings.push(`${unsupportedCount} active config${unsupportedCount === 1 ? '' : 's'} could not be fetched because the ATS type or board ID is missing/unsupported. ${needsResolutionConfigs} total config${needsResolutionConfigs === 1 ? '' : 's'} still need ATS resolution.`);
      }

      const accountsByNormalizedName = new Map(tenantAccounts.map((item) => [normalizeKey(item.displayName || item.normalizedName), item]));
      const accountsById = new Map(tenantAccounts.map((item) => [item.id, item]));
      const existingByNaturalKey = new Map();
      const existingByProviderIdentity = new Map();
      for (const existingJob of tenantJobs) {
        const key = getJobNaturalKey(existingJob);
        if (key && !existingByNaturalKey.has(key)) existingByNaturalKey.set(key, existingJob);
        const providerIdentity = getProviderJobIdentity(existingJob);
        if (providerIdentity && !existingByProviderIdentity.has(providerIdentity)) {
          existingByProviderIdentity.set(providerIdentity, existingJob);
        }
      }

      let fetched = 0;
      let kept = 0;
      let filteredOutNonCanada = 0;
      let newJobs = 0;
      let updatedJobs = 0;
      let closedJobs = 0;
      let reactivatedJobs = 0;
      const touchedAccountIds = new Set();

      const fetchStartedAt = performance.now();
      const fetchConcurrency = readPositiveInteger(options.fetchConcurrency, DEFAULT_ATS_FETCH_CONCURRENCY);
      const fetchedBoards = await mapSettledWithConcurrency(supportedConfigs, fetchConcurrency, async ({ config, atsType, boardId }) => {
        const fetcher = ATS_FETCHERS.get(atsType);
        const response = await fetcher(config, boardId);
        return { config, atsType, jobs: response.jobs || [] };
      });
      timings.fetchMs = Math.round(performance.now() - fetchStartedAt);
      timings.fetchConcurrency = fetchConcurrency;

      const upsertStartedAt = performance.now();
      for (let index = 0; index < fetchedBoards.length; index++) {
        const configInfo = supportedConfigs[index];
        const { config, atsType } = configInfo;
        const settled = fetchedBoards[index];

        if (settled.status === 'rejected') {
          const message = settled.reason?.message || 'Unknown ATS fetch failure';
          const permanentlyMissing = /HTTP\s+(404|410)\b/i.test(message);
          errors.push({ configId: config.id, companyName: config.companyName, atsType, error: message });
          importItems.push({
            entityType: 'board_config',
            entityId: config.id,
            naturalKey: `${normalizeKey(config.companyName)}|${atsType}|${normalizeKey(config.boardId || config.resolvedBoardUrl)}`,
            status: 'failed',
            message,
            sourceRow: { companyName: config.companyName, atsType, boardId: config.boardId },
          });
          config.lastImportStatus = 'failed';
          config.lastImportError = message;
          if (permanentlyMissing) {
            config.active = false;
            config.discoveryStatus = 'needs_review';
            config.reviewStatus = 'pending';
            config.confidenceBand = 'unresolved';
            deactivateJobsForConfig(config, tenantJobs, now());
            if (config.accountId) touchedAccountIds.add(config.accountId);
            warnings.push(`${config.companyName} returned ${message.match(/HTTP\s+\d+/i)?.[0] || 'a permanent not-found response'} and was moved back to ATS review.`);
          }
          config.updatedAt = now();
          continue;
        }

        const fetchedJobs = settled.value.jobs;
        fetched += fetchedJobs.length;
        const accountItem = findAccountForConfig(config, accountsByNormalizedName, accountsById);
        if (accountItem?.id && config.accountId !== accountItem.id) {
          config.accountId = accountItem.id;
        }
        if (accountItem?.id) touchedAccountIds.add(accountItem.id);
        let configKept = 0;
        const seenJobIds = new Set();

        for (const fetchedJob of fetchedJobs) {
          const normalizedJob = normalizeFetchedAtsJob(fetchedJob, config, accountItem, atsType);
          if (!normalizedJob) continue;
          normalizedJob.jobUrl = normalizePublicHttpUrl(normalizedJob.jobUrl || normalizedJob.url);
          normalizedJob.url = normalizedJob.jobUrl;
          if (!jobMatchesGeography(normalizedJob, accountItem, geographyFilter)) {
            filteredOutNonCanada++;
            continue;
          }
          Object.assign(normalizedJob, scoreJobRelevance(normalizedJob, accountItem, searchFocus), {
            relevanceUpdatedAt: now(),
          });

          kept++;
          configKept++;
          const naturalKey = getJobNaturalKey(normalizedJob);
          const providerIdentity = getProviderJobIdentity(normalizedJob);
          const existingJob = existingByNaturalKey.get(naturalKey)
            || (providerIdentity ? existingByProviderIdentity.get(providerIdentity) : null);
          if (existingJob) {
            const wasClosed = existingJob.active === false || Boolean(existingJob.closedAt);
            Object.assign(existingJob, {
              ...normalizedJob,
              id: existingJob.id,
              tenantId,
              active: true,
              closedAt: '',
              createdAt: existingJob.createdAt || normalizedJob.createdAt,
              naturalKey,
              firstSeenAt: existingJob.firstSeenAt || existingJob.createdAt || normalizedJob.createdAt,
              lastSeenAt: now(),
              importRunId,
              updatedAt: now(),
            });
            existingByNaturalKey.set(naturalKey, existingJob);
            if (providerIdentity) existingByProviderIdentity.set(providerIdentity, existingJob);
            seenJobIds.add(existingJob.id);
            if (wasClosed) reactivatedJobs++;
            importItems.push({
              entityType: 'job',
              entityId: existingJob.id,
              naturalKey,
              status: 'updated',
              message: 'Matched existing job',
              sourceRow: { title: normalizedJob.title, companyName: normalizedJob.companyName, jobId: normalizedJob.jobId, jobUrl: normalizedJob.jobUrl || normalizedJob.url },
            });
            updatedJobs++;
          } else {
            const newJob = job({
              ...normalizedJob,
              id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              tenantId,
              naturalKey,
              firstSeenAt: now(),
              lastSeenAt: now(),
              importRunId,
              createdAt: now(),
              updatedAt: now(),
            });
            tenantJobs.unshift(newJob);
            jobs.push(newJob);
            existingByNaturalKey.set(naturalKey, newJob);
            if (providerIdentity) existingByProviderIdentity.set(providerIdentity, newJob);
            seenJobIds.add(newJob.id);
            importItems.push({
              entityType: 'job',
              entityId: newJob.id,
              naturalKey,
              status: 'created',
              message: 'Imported from ATS board',
              sourceRow: { title: normalizedJob.title, companyName: normalizedJob.companyName, jobId: normalizedJob.jobId, jobUrl: normalizedJob.jobUrl || normalizedJob.url },
            });
            newJobs++;
          }
          if (accountItem?.id) touchedAccountIds.add(accountItem.id);
        }

        const closedForConfig = deactivateMissingJobsForConfig(config, tenantJobs, seenJobIds, now());
        closedJobs += closedForConfig.length;
        for (const closedJob of closedForConfig) {
          importItems.push({
            entityType: 'job',
            entityId: closedJob.id,
            naturalKey: getJobNaturalKey(closedJob),
            status: 'closed',
            message: 'No longer present on the successfully refreshed ATS board',
            sourceRow: { title: closedJob.title, companyName: closedJob.companyName, jobId: closedJob.jobId },
          });
        }

        config.lastImportStatus = configKept > 0 ? 'success' : 'empty';
        config.lastImportedAt = now();
        config.lastImportError = '';
        config.updatedAt = now();
      }

      for (const accountId of touchedAccountIds) {
        const item = accountsById.get(accountId);
        if (item) refreshAccountHiringStats(item, tenantJobs, searchFocus);
      }

      tenantJobs.sort((a, b) => String(b.postedAt || b.importedAt || b.updatedAt).localeCompare(String(a.postedAt || a.importedAt || a.updatedAt)));
      timings.upsertMs = Math.round(performance.now() - upsertStartedAt);

      const persistStartedAt = performance.now();
      if (supportedConfigs.length || touchedAccountIds.size || errors.length) persistTenant(tenantId);
      timings.persistQueuedMs = Math.round(performance.now() - persistStartedAt);
      timings.totalMs = Math.round(performance.now() - totalStartedAt);

      if (timings.totalMs > 5000) {
        console.warn(`Slow live job import: saas/src/store.js importLiveJobs ${timings.totalMs}ms`, timings);
      }

      const activeTrackedJobs = tenantJobs.filter((item) => item.active !== false).length;
      const stats = {
        activeConfigs,
        configRows: tenantConfigs.length,
        configs: supportedConfigs.length,
        unsupportedConfigs: unsupportedCount,
        needsResolutionConfigs,
        fetchConcurrency,
        directResolvedConfigs,
        autoDiscoveryLimit,
        autoDiscoveryChecked: autoDiscoveryStats?.checked || 0,
        autoDiscoveryMapped: autoDiscoveryStats?.mapped || 0,
        autoDiscoveryDirectResolved: autoDiscoveryStats?.directResolved || 0,
        autoDiscoveryUnresolved: autoDiscoveryStats?.unresolved || 0,
        importReadyConfigs: importReadyConfigs.length,
        supportedConfigs: supportedConfigs.length,
        duplicateBoardsSkipped,
        fetched,
        kept,
        canadaKept: kept,
        filteredOutNonCanada,
        relevantJobs: tenantJobs.filter((item) => item.active !== false && Number(item.relevanceScore ?? -1) >= searchFocus.minimumRelevanceScore).length,
        imported: activeTrackedJobs,
        runImported: newJobs + updatedJobs,
        jobsTouched: newJobs + updatedJobs + closedJobs,
        newJobs,
        updatedJobs,
        closedJobs,
        reactivatedJobs,
        errors: errors.length,
      };
      const importRun = {
        id: importRunId,
        status: errors.length ? 'completed_with_errors' : warnings.length ? 'completed_with_warnings' : 'completed',
        stats,
        timings,
        warnings,
        errors,
      };
      await dbRecordImportRun({
        id: importRunId,
        tenantId,
        runType: 'live_jobs',
        status: importRun.status,
        source: 'ats_boards',
        sourceHash: hashText(supportedConfigs.map(({ config, atsType, boardId }) => `${config.id}|${atsType}|${boardId}`).join('\n')),
        startedAt: importStartedAt,
        completedAt: now(),
        rowsTotal: fetched,
        rowsCreated: newJobs,
        rowsUpdated: updatedJobs + closedJobs,
        rowsSkipped: filteredOutNonCanada,
        rowsFailed: errors.length,
        warnings,
        errors,
        metadata: { stats, timings },
        items: importItems,
      });
      if (activeTrackedJobs > 0) {
        dbRecordProductEvent(buildProductEvent({
          eventType: 'useful_jobs_found',
          tenantId,
          eventKey: tenantId,
          dimensions: { source: 'live_job_import' },
        })).catch((error) => console.error('Useful jobs milestone recording failed:', safeErrorSummary(error)));
      }

      activities.unshift({
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        tenantId,
        type: 'live_job_import',
        summary: `Live job import fetched ${fetched} jobs across ${supportedConfigs.length} import-ready ATS configs and imported ${kept} jobs.`,
        notes: warnings.join(' '),
        occurredAt: now(),
        createdAt: now(),
        metadata: {
          import: stats,
          errors,
        },
      });
      getTenantArray(activitiesByTenant, tenantId).unshift(activities[0]);
      persistTenant(tenantId);

      return {
        ok: true,
        stats,
        importRun,
        timings,
        warnings,
        errors,
      };
    },

    // ── Real per-account/config actions (previously fabricated stubs) ──────

    async accountQuickEnrich(tenantId, accountId) {
      assertTenant(tenantId);
      const startedAt = performance.now();
      await ensureDataLoaded(tenantId, true); // contacts needed for domain inference
      const item = accountById(accountId, tenantId);
      if (!item || item.tenantId !== tenantId) return null;
      let totalUpdated = 0;
      const domain = getUsableCompanyDomain(item.domain || item.canonicalDomain)
        || inferDomainFromContacts(tenantId, accountId);
      if (domain && !item.domain) { item.domain = domain; totalUpdated++; }
      if (domain && !item.canonicalDomain) { item.canonicalDomain = domain; totalUpdated++; }
      if (domain && !item.careersUrl) {
        item.careersUrl = `https://${domain.replace(/^https?:\/\//, '')}/careers`;
        totalUpdated++;
      }
      refreshAccountHiringStats(item, getTenantArray(jobsByTenant, tenantId));
      if (totalUpdated) persistTenant(tenantId);
      return {
        ok: true,
        stats: { totalUpdated, checked: 1, domain: domain || '' },
        durationMs: Math.round(performance.now() - startedAt),
        account: item,
      };
    },

    // Shared engine for resolve-now / deep-verify / rerun-resolution / config
    // resolve: find (or create) the account's board config, verify or discover
    // its ATS board for real, and report honest results.
    startAccountResolution(tenantId, { accountId = '', configId = '', deep = false, label = 'ATS resolution' } = {}) {
      assertTenant(tenantId);
      const jobId = `resolve-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const job = {
        id: jobId,
        type: 'ats-resolution',
        status: 'queued',
        summary: label,
        progressMessage: `Queued ${label.toLowerCase()}.`,
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        progress: 0,
        stage: 'queued',
        recordsAffected: 0,
        result: null,
      };
      trackBackgroundJob(tenantId, job);

      setImmediate(async () => {
        const startedAt = performance.now();
        try {
          job.status = 'running';
          job.startedAt = now();
          job.progressMessage = 'Probing ATS boards...';
          await ensureDataLoaded(tenantId, false);
          const tenantConfigArr = getTenantArray(configsByTenant, tenantId);
          let config = null;
          let item = null;
          if (configId) {
            config = tenantConfigArr.find((c) => c.id === configId) || null;
          }
          if (!config && accountId) {
            item = accountById(accountId, tenantId);
            if (!item || item.tenantId !== tenantId) throw new Error('Account not found');
            config = tenantConfigArr.find((c) => c.accountId === item.id)
              || tenantConfigArr.find((c) => c.normalizedCompanyName === item.normalizedName)
              || null;
            if (!config) {
              config = normalizeConfigPatch({
                id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                tenantId,
                accountId: item.id,
                companyName: item.displayName,
                normalizedCompanyName: item.normalizedName,
                atsType: 'unknown',
                ats: 'unknown',
                boardId: '',
                domain: item.domain || item.canonicalDomain || '',
                careersUrl: item.careersUrl || '',
                active: false,
                discoveryStatus: 'needs_review',
                reviewStatus: 'pending',
                confidenceBand: item.domain || item.canonicalDomain || item.careersUrl ? 'medium' : 'unresolved',
                source: 'manual_resolve',
                createdAt: now(),
                updatedAt: now(),
              });
              boardConfigs.unshift(config);
              tenantConfigArr.unshift(config);
            }
          }
          if (!config) throw new Error('Board config not found');

          let verifiedJobCount = null;
          if (deep && isResolvedBoardConfig(config)) {
            // Deep verify: actually fetch the currently-resolved board and
            // count live postings instead of trusting the stored identity.
            const atsType = getConfigAtsType(config);
            const boardId = getConfigBoardId(config);
            const fetcher = ATS_FETCHERS.get(atsType);
            try {
              const response = await fetcher(config, boardId);
              verifiedJobCount = Array.isArray(response?.jobs) ? response.jobs.length : 0;
            } catch {
              verifiedJobCount = 0;
            }
            if (verifiedJobCount > 0) {
              config.lastDiscoveryJobCount = verifiedJobCount;
              config.lastDiscoveryCheckedAt = now();
              config.updatedAt = now();
              persistTenant(tenantId);
              job.status = 'completed';
              job.progress = 100;
              job.progressMessage = 'Completed';
              job.recordsAffected = 1;
              job.result = {
                stats: { resolved: 1, verified: 1, atsType, boardId, jobCount: verifiedJobCount },
                timings: { enrichmentMs: Math.round(performance.now() - startedAt) },
              };
              job.finishedAt = now();
              return;
            }
            // Stored identity no longer returns jobs — fall through to rediscovery.
            config.discoveryStatus = 'needs_review';
          }

          const match = await discoverAtsBoard(config);
          if (match) {
            Object.assign(config, {
              atsType: match.atsType,
              ats: match.atsType,
              boardId: match.boardId,
              apiUrl: match.apiUrl,
              resolvedBoardUrl: match.resolvedBoardUrl,
              discoveryStatus: 'resolved',
              discoveryMethod: match.method,
              confidenceBand: 'high',
              reviewStatus: 'approved',
              active: true,
              lastDiscoveryJobCount: match.jobCount,
              lastDiscoveryCheckedAt: now(),
              updatedAt: now(),
            });
          } else {
            config.discoveryStatus = 'unresolved';
            config.discoveryMethod = 'public_ats_probe';
            config.confidenceBand = config.domain || config.careersUrl ? 'medium' : 'unresolved';
            config.lastDiscoveryCheckedAt = now();
            config.updatedAt = now();
          }
          persistTenant(tenantId);
          job.status = 'completed';
          job.progress = 100;
          job.progressMessage = 'Completed';
          job.recordsAffected = match ? 1 : 0;
          job.result = {
            stats: {
              resolved: match ? 1 : 0,
              verified: verifiedJobCount === null ? undefined : 0,
              atsType: match?.atsType || '',
              boardId: match?.boardId || '',
              jobCount: match?.jobCount || 0,
            },
            timings: { enrichmentMs: Math.round(performance.now() - startedAt) },
          };
        } catch (err) {
          job.status = 'failed';
          job.errorMessage = err.message || `${label} failed.`;
        } finally {
          job.finishedAt = now();
        }
      });

      return { ok: true, jobId, job };
    },

    startTargetScoreRollout(tenantId, options = {}) {
      assertTenant(tenantId);
      const limit = Math.max(1, Math.min(2000, Number(options.limit) || 150));
      const maxBatches = Math.max(1, Math.min(50, Number(options.maxBatches) || 6));
      const jobId = `target-score-rollout-${Date.now()}`;
      const job = {
        id: jobId,
        type: 'target-score-rollout',
        status: 'queued',
        summary: 'Target-score rollout',
        progressMessage: 'Queued target-score rollout.',
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        progress: 0,
        stage: 'queued',
        recordsAffected: 0,
        result: null,
      };
      trackBackgroundJob(tenantId, job);

      setImmediate(async () => {
        try {
          job.status = 'running';
          job.startedAt = now();
          const scopeStartedAt = performance.now();
          await ensureDataLoaded(tenantId, false);
          const scopeLoadMs = Math.round(performance.now() - scopeStartedAt);
          const deriveStartedAt = performance.now();
          const tenantAccounts = accountsForTenant(tenantId);
          const tenantJobsArr = getTenantArray(jobsByTenant, tenantId);
          const toProcess = tenantAccounts.slice(0, limit * maxBatches);
          for (const item of toProcess) refreshAccountHiringStats(item, tenantJobsArr);
          const deriveMs = Math.round(performance.now() - deriveStartedAt);
          const persistStartedAt = performance.now();
          if (toProcess.length) persistTenant(tenantId);
          job.status = 'completed';
          job.progress = 100;
          job.progressMessage = 'Completed';
          job.recordsAffected = toProcess.length;
          job.result = {
            accountCount: toProcess.length,
            count: toProcess.length,
            batchCount: Math.ceil(toProcess.length / limit) || 0,
            remainingCount: Math.max(0, tenantAccounts.length - toProcess.length),
            timings: {
              deriveMs,
              scopeLoadMs,
              persistMs: Math.round(performance.now() - persistStartedAt),
            },
          };
        } catch (err) {
          job.status = 'failed';
          job.errorMessage = err.message || 'Target-score rollout failed.';
        } finally {
          job.finishedAt = now();
        }
      });

      return { ok: true, jobId, job };
    },

    startConfigsSync(tenantId) {
      assertTenant(tenantId);
      const jobId = `configs-sync-${Date.now()}`;
      const job = {
        id: jobId,
        type: 'configs-sync',
        status: 'queued',
        summary: 'Rebuild board configs from accounts',
        progressMessage: 'Queued config rebuild.',
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        progress: 0,
        stage: 'queued',
        recordsAffected: 0,
        result: null,
      };
      trackBackgroundJob(tenantId, job);

      setImmediate(async () => {
        try {
          job.status = 'running';
          job.startedAt = now();
          await ensureDataLoaded(tenantId, false);
          const tenantAccounts = accountsForTenant(tenantId);
          const tenantConfigArr = getTenantArray(configsByTenant, tenantId);
          const existingNames = new Set(tenantConfigArr.map((c) => normalizeKey(c.normalizedCompanyName || c.companyName)));
          let created = 0;
          for (const item of tenantAccounts) {
            const normalizedName = normalizeKey(item.normalizedName || item.displayName);
            if (!normalizedName || existingNames.has(normalizedName)) continue;
            const domain = getUsableCompanyDomain(item.domain || item.canonicalDomain)
              || inferDomainFromContacts(tenantId, item.id);
            const config = normalizeConfigPatch({
              id: `cfg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              tenantId,
              accountId: item.id,
              companyName: item.displayName,
              normalizedCompanyName: normalizedName,
              atsType: 'unknown',
              ats: 'unknown',
              boardId: '',
              domain,
              careersUrl: getUsableCareerUrl(item.careersUrl, item.displayName) || '',
              active: false,
              discoveryStatus: 'needs_review',
              reviewStatus: 'pending',
              confidenceBand: domain || getUsableCareerUrl(item.careersUrl, item.displayName) ? 'medium' : 'unresolved',
              source: 'configs_sync',
              createdAt: now(),
              updatedAt: now(),
            });
            boardConfigs.unshift(config);
            tenantConfigArr.unshift(config);
            existingNames.add(normalizedName);
            created++;
          }
          if (created) persistTenant(tenantId);
          job.status = 'completed';
          job.progress = 100;
          job.progressMessage = 'Completed';
          job.recordsAffected = created;
          job.result = { count: created, created, totalRows: tenantConfigArr.length };
        } catch (err) {
          job.status = 'failed';
          job.errorMessage = err.message || 'Config rebuild failed.';
        } finally {
          job.finishedAt = now();
        }
      });

      return { ok: true, jobId, job };
    },

    async startLinkedInCsvImport(tenantId, csvText, options = {}) {
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
        recovery: {
          kind: 'linkedin-csv-import',
          attempts: 0,
          csvText: String(csvText || ''),
          options: cloneRecoveryOptions(options),
        },
      };
      trackBackgroundJob(tenantId, job);
      await persistQueuedBackgroundJob(job);
      queueResumableBackgroundJob(this, tenantId, job);

      return { ok: true, jobId, job: publicBackgroundJob(job) };
    },

    async getBackgroundJob(tenantId, jobId) {
      assertTenant(tenantId);
      const job = backgroundJobs.get(jobId);
      // Never invent a fake "completed" job for an unknown id — report the
      // truth so the UI shows a failure instead of a phantom success.
      if (job?.tenantId === tenantId) {
        await persistBackgroundJob(job);
        return publicBackgroundJob(job);
      }
      const persisted = await dbLoadBackgroundJob(tenantId, jobId);
      if (!persisted) return missingBackgroundJob(jobId);
      if (persisted.status === 'queued' || persisted.status === 'running') {
        const decision = getBackgroundJobRecoveryDecision(persisted);
        trackBackgroundJob(tenantId, persisted);
        if (decision.recoverable) {
          persisted.status = 'queued';
          persisted.startedAt = null;
          persisted.finishedAt = null;
          persisted.updatedAt = now();
          persisted.progressMessage = 'Resuming after a service restart...';
          await persistBackgroundJob(persisted);
          queueResumableBackgroundJob(this, tenantId, persisted);
          return publicBackgroundJob(persisted);
        }
        failInterruptedBackgroundJob(persisted, decision);
      }
      if (!backgroundJobs.has(jobId)) trackBackgroundJob(tenantId, persisted);
      await persistBackgroundJob(persisted);
      return publicBackgroundJob(persisted);
    },

    // ── Revenue Pipeline ──────────────────────────────────────────────────
    
    startRevenuePipeline(tenantId, options = {}) {
      assertTenant(tenantId);
      const activeJob = [...backgroundJobs.values()].find((jobItem) => (
        jobItem.tenantId === tenantId
        && jobItem.type === 'revenue-pipeline'
        && ['queued', 'running'].includes(jobItem.status)
      ));
      if (activeJob) return { ...publicBackgroundJob(activeJob), alreadyRunning: true };
      const jobId = `pipe-${Date.now()}`;
      const job = {
        id: jobId,
        type: 'revenue-pipeline',
        status: 'queued',
        progress: 0,
        stage: 'starting',
        message: 'Initializing pipeline...',
        progressMessage: 'Initializing pipeline...',
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
        updatedAt: now(),
        recordsAffected: 0,
        result: null,
      };
      trackBackgroundJob(tenantId, job);

      (async () => {
        const pipelineStartedAt = performance.now();
        const timings = {};
        try {
          job.status = 'running';
          job.startedAt = now();
          const update = (stage, progress, message) => {
            job.stage = stage;
            job.progress = progress;
            job.message = message;
            job.progressMessage = message;
            job.status = 'running';
            job.updatedAt = now();
            console.log(`  Pipeline ${tenantId}: ${stage} (${progress}%) - ${message}`);
          };

          update('loading', 5, 'Loading workspace data...');
          const workflow = await this.runLaunchWorkflow(tenantId, {
            ...options,
            onProgress: (progress, stage, message) => update(stage, progress, message),
          });

          const cleanupStartedAt = performance.now();
          update('cleanup', 98, 'Pruning jobs not seen within the retention window...');
          const purgeResult = this.purgeStaleJobs(tenantId);
          timings.cleanupMs = Math.round(performance.now() - cleanupStartedAt);
          timings.workflowMs = workflow.timings?.totalMs || 0;
          timings.totalMs = Math.round(performance.now() - pipelineStartedAt);

          console.log(
            `Pipeline ingestion complete: saas/src/store.js startRevenuePipeline ` +
            `fetched=${workflow.stats?.jobsFetched || 0} kept=${workflow.stats?.jobsKept || 0} ` +
            `activeTracked=${workflow.stats?.activeTrackedJobs || 0} removed=${purgeResult.removed} totalMs=${timings.totalMs}`
          );
           
          job.status = 'completed';
          job.progress = 100;
          job.message = 'Revenue pipeline completed successfully.';
          job.progressMessage = job.message;
          job.finishedAt = now();
          job.recordsAffected = getTrackedJobCountFromResult(workflow) || getTouchedJobCountFromResult(workflow);
          job.result = {
            ...workflow,
            cleanup: purgeResult,
            timings: {
              ...workflow.timings,
              pipelineTotalMs: timings.totalMs,
              cleanupMs: timings.cleanupMs,
            },
          };
        } catch (err) {
          job.status = 'failed';
          job.message = `Pipeline failed: ${err.message}`;
          job.progressMessage = job.message;
          job.error = err.message;
          job.errorMessage = err.message || 'Revenue pipeline failed.';
        } finally {
          job.finishedAt = job.finishedAt || now();
          job.updatedAt = job.finishedAt;
          const profile = getTenantProfile(tenantId);
          if (profile) {
            profile.settings.lastPipelineAttemptAt = job.startedAt || job.queuedAt;
            profile.settings.lastPipelineStatus = job.status;
            profile.settings.lastPipelineError = job.status === 'failed' ? job.errorMessage || job.error || '' : '';
            if (job.status === 'completed') profile.settings.lastPipelineRun = job.finishedAt;
            persistTenant(tenantId);
          }
          await persistBackgroundJob(job);
        }
      })();

      return publicBackgroundJob(job);
    },

    purgeStaleJobs(tenantId) {
      assertTenant(tenantId);
      const startedAt = performance.now();
      const profile = getTenantProfile(tenantId);
      const retentionDays = Number(profile.settings.jobRetentionDays || 28);
      const threshold = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      const tenantJobs = jobsByTenant.get(tenantId);
      if (!tenantJobs) return { removed: 0, remaining: 0, timings: { totalMs: Math.round(performance.now() - startedAt) } };

      const initialCount = tenantJobs.length;
      const filteredJobs = tenantJobs.filter(j => {
        const freshnessValue = j.retrievedAt || j.lastSeenAt || j.importedAt || j.updatedAt || j.createdAt || j.postedAt;
        const freshnessTime = new Date(freshnessValue).getTime();
        if (!Number.isFinite(freshnessTime)) return true;
        return freshnessTime > threshold;
      });

      if (filteredJobs.length !== initialCount) {
        const removed = initialCount - filteredJobs.length;
        jobsByTenant.set(tenantId, filteredJobs);
        const keptJobIds = new Set(filteredJobs.map((item) => item.id));
        jobs = jobs.filter((item) => item.tenantId !== tenantId || keptJobIds.has(item.id));
        console.log(`[Purge] Removed ${removed} jobs for ${tenantId} (Retention: ${retentionDays} days)`);
        dbRecordAuditLog({
          tenantId,
          action: 'jobs.purge_stale',
          entityType: 'job',
          before: { count: initialCount },
          after: { count: filteredJobs.length },
          metadata: { retentionDays, removed },
        }).catch(() => {});
        persistTenant(tenantId);
      }
      const totalMs = Math.round(performance.now() - startedAt);
      if (totalMs > 250) {
        console.warn(`Slow stale job purge: saas/src/store.js purgeStaleJobs ${totalMs}ms`, {
          initialCount,
          remaining: filteredJobs.length,
          removed: initialCount - filteredJobs.length,
        });
      }
      return {
        removed: initialCount - filteredJobs.length,
        remaining: filteredJobs.length,
        retentionDays,
        timings: { totalMs },
      };
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
      return [...tenantProfiles.entries()].map(([tenantId, profile]) => ({
        id: tenantId,
        plan: profile.tenant?.plan || 'trial',
        status: profile.tenant?.status || 'active',
        slug: profile.tenant?.slug || '',
      }));
    },

    getOperationalMetrics() {
      const staleAfterMs = readPositiveInteger(process.env.BD_BACKGROUND_JOB_STALE_MS, 15 * 60 * 1000);
      return {
        ...summarizeOperationalJobs([...backgroundJobs.values()], { staleAfterMs }),
        residentTenants: loadedTenants.size,
        pendingTenantSaves: pendingSaves.size,
      };
    },

    async claimScheduledPipeline(tenantId, options = {}) {
      assertTenant(tenantId);
      await ensureTenantSettingsLoaded(tenantId);
      const profile = getTenantProfile(tenantId);
      const hasActiveJob = [...backgroundJobs.values()].some((jobItem) => (
        jobItem.tenantId === tenantId
        && ['revenue-pipeline', 'launch-workflow', 'live-job-import', 'ats-discovery'].includes(jobItem.type)
        && ['queued', 'running'].includes(jobItem.status)
      ));
      const nowMs = Number(options.nowMs) || Date.now();
      const decision = getScheduledPipelineDecision({
        settings: profile.settings,
        hasActiveJob,
        nowMs,
        intervalMs: Number(options.intervalMs) || 24 * 60 * 60 * 1000,
        retryDelayMs: Number(options.retryDelayMs) || 60 * 60 * 1000,
      });
      if (!decision.due) return { claimed: false, ...decision };
      profile.settings.lastPipelineAttemptAt = new Date(nowMs).toISOString();
      profile.settings.lastPipelineStatus = 'queued';
      profile.settings.lastPipelineError = '';
      persistTenant(tenantId);
      return { claimed: true, ...decision, attemptedAt: profile.settings.lastPipelineAttemptAt };
    },

    // ── Account creation ──────────────────────────────────────────────────

    async addAccount(tenantId, payload, _skipPersist = false) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const id = `acct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

    // Bulk-edit selected accounts (status/priority/owner/addTags). Applies the
    // patch per id and reports failed rows instead of failing the whole batch.
    async bulkUpdateAccounts(tenantId, payload = {}) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const ids = Array.isArray(payload.ids) ? payload.ids.filter(Boolean) : [];
      const patch = pickPatch(payload, ['status', 'priority', 'owner']);
      if (Object.prototype.hasOwnProperty.call(payload, 'tracked')) {
        patch.tracked = payload.tracked === true || payload.tracked === 'true';
      }
      const addTags = Array.isArray(payload.addTags)
        ? payload.addTags.map((tag) => String(tag).trim()).filter(Boolean)
        : [];
      const failed = [];
      let updated = 0;
      for (const accountId of ids) {
        const item = accountById(accountId, tenantId);
        if (!item || item.tenantId !== tenantId) {
          failed.push({ id: accountId, reason: 'not_found' });
          continue;
        }
        Object.assign(item, patch);
        if (addTags.length) {
          item.tags = [...new Set([...(Array.isArray(item.tags) ? item.tags : []), ...addTags])];
        }
        item.updatedAt = now();
        updated += 1;
      }
      if (updated) persistTenant(tenantId);
      return { updated, failed };
    },

    // Parse a pasted target list (one company per line, or CSV with a header
    // row containing "company"). Rows may set domain, careers_url, priority,
    // owner, notes, status. Duplicates (by normalized name) and blank rows are
    // reported per line, never silently dropped.
    parseAccountImportText(text) {
      const raw = String(text || '');
      const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      const headerLine = lines.find((line) => line.trim());
      const looksLikeCsv = Boolean(headerLine)
        && headerLine.includes(',')
        && /(^|,)\s*"?company"?\s*(,|$)/i.test(headerLine);
      if (looksLikeCsv) {
        return parseCSV(raw).map((row, index) => ({
          line: index + 2, // 1-based, after the header row
          company: (row.company || row.Company || '').trim(),
          domain: (row.domain || '').trim(),
          careersUrl: (row.careers_url || row.careersUrl || '').trim(),
          priority: (row.priority || '').trim(),
          owner: (row.owner || '').trim(),
          notes: (row.notes || '').trim(),
          status: (row.status || '').trim(),
        }));
      }
      return lines
        .map((line, index) => ({ line: index + 1, company: line.trim() }))
        .filter((row) => row.company);
    },

    // Import a pasted target list. Creates accounts for new companies, skips
    // duplicates/invalid rows with per-row reasons, persists once at the end.
    async importAccountsList(tenantId, text) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const rows = this.parseAccountImportText(text);
      const existing = new Set(
        accountsForTenant(tenantId).map((item) => item.normalizedName).filter(Boolean)
      );
      const skipped = [];
      const created = [];
      for (const row of rows) {
        if (!row.company) {
          skipped.push({ line: row.line, reason: 'missing_company' });
          continue;
        }
        const key = normalizeKey(row.company);
        if (existing.has(key)) {
          skipped.push({ line: row.line, company: row.company, reason: 'duplicate' });
          continue;
        }
        const item = await this.addAccount(tenantId, {
          displayName: row.company,
          domain: row.domain || '',
          careersUrl: row.careersUrl || '',
          priority: row.priority || '',
          owner: row.owner || '',
          notes: row.notes || '',
          status: row.status || 'new',
        }, true);
        existing.add(key);
        created.push(item);
      }
      if (created.length) {
        getTenantArray(accountsByTenant, tenantId).sort((a, b) => (b.targetScore || 0) - (a.targetScore || 0));
        persistTenant(tenantId);
      }
      return { count: created.length, skipped, total: rows.length };
    },

    // ── Contact creation ──────────────────────────────────────────────────

    async addContact(tenantId, payload, _skipPersist = false) {
      assertTenant(tenantId);
      await ensureDataLoaded(tenantId);
      const id = `ct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
        outreachStatus: payload.outreachStatus || 'not_started',
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
      const trackedCompaniesProvided = Array.isArray(options.trackedCompanies);
      const selectedTrackedCompanies = new Set(
        (trackedCompaniesProvided ? options.trackedCompanies : [])
          .map((value) => normalizeKey(value))
          .filter(Boolean)
      );
      const timestamp = now();
      const importRunId = `imp-linkedin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sourceHash = hashText(csvText || '');
      const importItems = [];
      
      let rows;
      try {
        rows = parseCSV(csvText || '');
      } catch (error) {
        return {
          error: error.message,
          code: error.code || 'invalid_csv',
          expectedHeaders: ['First Name', 'Last Name', 'Company', 'Position'],
        };
      }
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
          const emailDomain = email ? email.split('@')[1] || '' : '';
          companyMap.set(compKey, {
            displayName: company,
            contacts: [],
            domain: getUsableCompanyDomain(emailDomain),
          });
        }

        const companyEntry = companyMap.get(compKey);
        if (email && !companyEntry.domain) {
          const domain = email.split('@')[1] || '';
          companyEntry.domain = getUsableCompanyDomain(domain);
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
      let contactsUpdated = 0;
      let duplicatesSkipped = 0;
      let planLimitedSkipped = 0;
      const warnings = [];
      const contactRollupAccountIds = new Set();
      
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
        const indexedContact = dryRun
          ? { ...c, sourceMetadata: { ...(c.sourceMetadata || {}) }, employmentHistory: [...(c.employmentHistory || [])] }
          : c;
        indexContactDedupeKeys(existingContactsMap, indexedContact);
      }

      const existingAccountsMap = new Map();
      for (const a of tenantAcctArray) {
        existingAccountsMap.set(normalizeKey(a.displayName), a);
      }

      const companyCandidates = rankLinkedInCompanyCandidates(
        companyMap,
        existingAccountsMap,
        remainingNewAccounts
      );

      for (const candidate of companyCandidates) {
        const normName = candidate.key;
        const companyData = companyMap.get(normName);
        let existingAccount = existingAccountsMap.get(normName);

        if (!existingAccount) {
          if (remainingNewAccounts <= 0) {
            planLimitedSkipped += companyData.contacts.length;
            importItems.push({
              entityType: 'account',
              naturalKey: `account:${normName}`,
              status: 'skipped',
              message: 'Account limit reached',
              sourceRow: { company: companyData.displayName, contacts: companyData.contacts.length },
            });
            continue;
          }
          if (!dryRun) {
            existingAccount = account({
              tenantId,
              displayName: companyData.displayName,
              domain: companyData.domain,
              connectionCount: 0,
              // DATA-101: bulk-imported employers are network companies, not
              // refreshable targets, until the user selects them.
              tracked: selectedTrackedCompanies.has(normName),
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
            if (selectedTrackedCompanies.has(normName)) existingAccount.tracked = true;
            existingAccount.updatedAt = timestamp;
          }
          accountsUpdated++;
        }
        contactRollupAccountIds.add(existingAccount.id);

        // Create contacts
        let newSeniorCount = 0;
        let newTalentCount = 0;
        const newContacts = [];

        for (const c of companyData.contacts) {
          const contactKeys = contactDedupeKeys({
            fullName: c.fullName,
            email: c.email,
            linkedinUrl: c.linkedinUrl,
            companyName: c.company,
          }, normName);
          const matchedKey = contactKeys.find((key) => existingContactsMap.has(key));
          const existing = matchedKey ? existingContactsMap.get(matchedKey) : null;
          if (existing) {
            const patch = buildLinkedInContactPatch(existing, c, existingAccount, timestamp, {
              allowCompanyMove: matchedKey.startsWith('linkedin:') || matchedKey.startsWith('email:'),
            });
            c.previewAction = patch ? 'Update' : 'Existing';
            if (patch) {
              if (existing.accountId) contactRollupAccountIds.add(existing.accountId);
              Object.assign(existing, patch);
              indexContactDedupeKeys(existingContactsMap, existing, normName);
              contactsUpdated++;
            } else {
              duplicatesSkipped++;
            }
            importItems.push({
              entityType: 'contact',
              entityId: existing.id || '',
              naturalKey: contactKeys[0] || '',
              status: patch ? 'updated' : 'duplicate',
              message: patch ? 'Refreshed from LinkedIn CSV' : 'Matched an unchanged contact',
              sourceRow: { fullName: c.fullName, company: c.company, email: c.email, linkedinUrl: c.linkedinUrl },
            });
            continue;
          }
          if (remainingNewContacts <= 0) {
            planLimitedSkipped++;
            importItems.push({
              entityType: 'contact',
              naturalKey: contactKeys[0] || '',
              status: 'skipped',
              message: 'Contact limit reached',
              sourceRow: { fullName: c.fullName, company: c.company, email: c.email, linkedinUrl: c.linkedinUrl },
            });
            continue;
          }

          const seniority = classifySeniority(c.position);
          const isTalent = isTalentTitle(c.position);
          const priorityScore = computeContactPriority(seniority, isTalent, c.email);
          c.previewAction = 'Import';
          
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
              sourceMetadata: { currentEmploymentObservedAt: timestamp },
              employmentHistory: [],
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            contacts.push(contactItem);
            tenantContArray.push(contactItem);
            newContacts.push(contactItem);
            indexContactDedupeKeys(existingContactsMap, contactItem, normName);
            importItems.push({
              entityType: 'contact',
              entityId: contactItem.id,
              naturalKey: contactKeys[0] || '',
              status: 'created',
              message: 'Imported from LinkedIn CSV',
              sourceRow: { fullName: c.fullName, company: c.company, email: c.email, linkedinUrl: c.linkedinUrl },
            });
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
          existingAccount.updatedAt = timestamp;
          
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

      if (!dryRun) {
        refreshAccountContactRollups(tenantAcctArray, tenantContArray, contactRollupAccountIds, timestamp);
      }

      // Mark setup as complete after import
      const profile = getTenantProfile(tenantId);
      if (profile && !dryRun) profile.settings.setupComplete = true;
      if (!dryRun) {
        dbRecordProductEvent(buildProductEvent({
          eventType: 'setup_completed',
          tenantId,
          eventKey: tenantId,
          dimensions: { persona: profile?.tenant?.persona || 'bd', planId: profile?.tenant?.plan || 'trial', source: 'csv' },
        })).catch((error) => console.error('Setup milestone recording failed:', safeErrorSummary(error)));
      }

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
        updated: contactsUpdated,
        skipped: skippedMissingName + skippedMissingCompany + duplicatesSkipped + planLimitedSkipped,
        failed: 0,
        accountsCreated,
        accountsUpdated,
        contactsCreated,
        contactsUpdated,
        contacts: dryRun ? contactsForTenant(tenantId).length + contactsCreated : contactsForTenant(tenantId).length,
        companies: dryRun ? accountsForTenant(tenantId).length + accountsCreated : accountsForTenant(tenantId).length,
        duplicatesSkipped,
        planLimitedSkipped,
        missingNameRows: skippedMissingName,
        missingCompanyRows: skippedMissingCompany,
        trackedTargetsSelected: companyCandidates.filter((candidate) => (
          !candidate.overLimit
          && (candidate.alreadyTracked || selectedTrackedCompanies.has(candidate.key))
        )).length,
        recommendedTargets: companyCandidates.filter((candidate) => candidate.recommended).length,
        companiesPreviewed: companyCandidates.length,
      };

      if (!dryRun) {
        await dbRecordImportRun({
          id: importRunId,
          tenantId,
          runType: 'linkedin_csv',
          status: stats.failed ? 'failed' : warnings.length ? 'completed_with_warnings' : 'completed',
          source: 'linkedin_csv',
          sourceHash,
          startedAt: timestamp,
          completedAt: now(),
          rowsTotal: rows.length,
          rowsCreated: contactsCreated + accountsCreated,
          rowsUpdated: accountsUpdated + contactsUpdated,
          rowsSkipped: stats.skipped,
          rowsFailed: stats.failed,
          warnings,
          errors: [],
          metadata: { stats },
          items: importItems,
        });
      }

      const preview = companyCandidates.flatMap((candidate) => {
        const companyData = companyMap.get(candidate.key);
        return companyData.contacts.map((contactItem) => {
          const duplicate = contactDedupeKeys({
            fullName: contactItem.fullName,
            email: contactItem.email,
            linkedinUrl: contactItem.linkedinUrl,
            companyName: contactItem.company,
          }, candidate.key).some((key) => existingContactsMap.has(key));
          return {
            action: candidate.overLimit ? 'Plan limit' : contactItem.previewAction || (duplicate ? 'Existing' : 'Import'),
            fullName: contactItem.fullName,
            companyName: contactItem.company,
            title: contactItem.position,
            email: contactItem.email,
            connectedOn: contactItem.connectedOn,
            message: candidate.overLimit ? 'This company is outside the current account allowance.' : '',
          };
        });
      }).slice(0, 20);

      return {
        ok: true,
        dryRun,
        stats,
        summary: stats,
        warnings,
        preview,
        companies: companyCandidates.map((candidate) => ({
          ...candidate,
          selected: candidate.alreadyTracked
            || selectedTrackedCompanies.has(candidate.key)
            || (dryRun && !trackedCompaniesProvided && candidate.recommended),
        })),
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
  repairKnownAtsIdentity(output, { approveDirect: true });
  return output;
}

function classifyOutreachRoleFamily(jobTitle = '', department = '') {
  const value = `${jobTitle} ${department}`.toLowerCase();
  if (/data|machine learning|artificial intelligence|analytics|scientist/.test(value)) return 'data';
  if (/engineer|developer|software|platform|devops|security|technical|technology/.test(value)) return 'engineering';
  if (/sales|account executive|business development|revenue|growth/.test(value)) return 'sales';
  if (/marketing|brand|content|communications|demand generation/.test(value)) return 'marketing';
  if (/product|design|research|user experience|ux|ui/.test(value)) return 'product';
  if (/clinical|medical|nurse|physician|health|pharma|biotech/.test(value)) return 'clinical';
  if (/manufactur|operations|supply chain|logistics|quality|field service/.test(value)) return 'operations';
  if (/finance|accounting|controller|legal|compliance|risk/.test(value)) return 'finance';
  if (/people|human resources|talent|recruit/.test(value)) return 'people';
  return 'general';
}

function buildOutreachGrounding({ itemContact, accountJobs, specificJob, roleSignal }) {
  const newestJob = specificJob || accountJobs
    .slice()
    .sort((a, b) => String(b.postedAt || b.importedAt || '').localeCompare(String(a.postedAt || a.importedAt || '')))[0];
  const ageDays = newestJob ? daysSince(newestJob.postedAt || newestJob.importedAt) : 999;
  const roleFamily = classifyOutreachRoleFamily(newestJob?.title, newestJob?.department);
  const evidence = [];
  if (roleSignal) evidence.push({ label: specificJob ? 'Selected role' : 'Visible openings', value: roleSignal, confidence: 'verified' });
  if (newestJob?.department) evidence.push({ label: 'Team', value: newestJob.department, confidence: 'verified' });
  if (newestJob?.postedAt && ageDays >= 0 && ageDays < 999) {
    evidence.push({
      label: 'Signal age',
      value: ageDays === 0 ? 'Posted today' : ageDays === 1 ? 'Posted yesterday' : `Posted ${ageDays} days ago`,
      confidence: ageDays <= 30 ? 'verified' : 'stale',
    });
  }
  if (itemContact?.title) evidence.push({ label: 'Contact role', value: itemContact.title, confidence: 'verified' });

  let qualityScore = 20;
  if (roleSignal) qualityScore += 30;
  if (specificJob) qualityScore += 15;
  if (itemContact?.fullName) qualityScore += 10;
  if (itemContact?.title) qualityScore += 15;
  if (newestJob?.department) qualityScore += 5;
  if (ageDays <= 30) qualityScore += 5;
  qualityScore = Math.min(100, qualityScore);

  const warnings = [];
  if (!roleSignal) warnings.push('No verified opening is available. Add or select a role before sending this message.');
  if (!itemContact?.title) warnings.push('The contact title is missing, so the draft cannot tailor the reason for reaching out.');
  if (ageDays > 90 && ageDays < 999) warnings.push('The newest role signal is more than 90 days old. Confirm it is still active.');

  return {
    roleFamily,
    ageDays,
    evidence,
    qualityScore,
    qualityLabel: qualityScore >= 75 ? 'Strong grounding' : qualityScore >= 50 ? 'Review before sending' : 'Limited context',
    warnings,
  };
}

function buildDraft({ account: itemAccount, contact: itemContact, jobs: accountJobs = [], template, jobId, includeVariants = false }) {
  const templateKey = template || 'cold';
  const specificJob = jobId ? accountJobs.find((item) => item.id === jobId) : null;
  const roles = unique(accountJobs.map((item) => String(item.title || '').trim()).filter(Boolean)).slice(0, 3);
  const locations = unique(accountJobs.map((item) => String(item.location || '').trim()).filter(Boolean)).slice(0, 2);
  const companyName = itemAccount.displayName || itemAccount.companyName || 'the company';
  const firstName = itemContact?.firstName || itemContact?.fullName?.trim().split(/\s+/)[0] || 'there';
  const contactTitle = String(itemContact?.title || '').trim();
  const jobLabel = specificJob?.title || roles[0] || 'an open role';
  const roleSignal = specificJob
    ? `${jobLabel}${specificJob.location ? ` in ${specificJob.location}` : ''}`
    : roles.length
      ? `${roles.join(', ')}${locations.length ? ` across ${locations.join(' and ')}` : ''}`
      : '';
  const activeRoleCount = Number(itemAccount.openRoleCount || accountJobs.length || 0);
  const signalSentence = roleSignal
    ? `${companyName} is currently hiring for ${roleSignal}.`
    : `${companyName} is on my target list, although I do not have a verified open role to reference yet.`;
  const grounding = buildOutreachGrounding({ itemContact, accountJobs, specificJob, roleSignal });

  const draft = isJobSeekerTemplate(templateKey)
    ? buildJobSeekerDraft({ companyName, firstName, contactTitle, templateKey, jobLabel, roleSignal, specificJob })
    : buildSalesDraft({
      companyName,
      firstName,
      contactTitle,
      templateKey,
      roleSignal,
      signalSentence,
      activeRoleCount,
      specificJob,
      focusRole: jobLabel,
      grounding,
    });

  const result = {
    account_id: itemAccount.id,
    contact_name: itemContact?.fullName || '',
    contact_title: contactTitle,
    template_key: templateKey,
    persona_label: contactTitle || (isJobSeekerTemplate(templateKey) ? 'Company contact' : 'Hiring stakeholder'),
    signal_focus: roleSignal,
    company_snippet: signalSentence,
    grounding: {
      score: grounding.qualityScore,
      label: grounding.qualityLabel,
      evidence: grounding.evidence,
      warnings: grounding.warnings,
      role_family: grounding.roleFamily,
    },
    timings: { generatedMs: 1 },
    ...draft,
    variants: [],
  };

  if (includeVariants) {
    const variantKeys = isJobSeekerTemplate(templateKey)
      ? ['job_intro', 'job_networking', 'job_referral']
      : ['talent_partner', 'hiring_manager', 'executive'];
    result.variants = variantKeys
      .filter((key) => key !== templateKey)
      .slice(0, 3)
      .map((key) => buildDraft({
        account: itemAccount,
        contact: itemContact,
        jobs: accountJobs,
        template: key,
        jobId,
        includeVariants: false,
      }));
  }
  return result;
}

function isJobSeekerTemplate(template) {
  return ['job_intro', 'job_networking', 'job_referral'].includes(template);
}

function buildJobSeekerDraft({ companyName, firstName, contactTitle, templateKey, jobLabel, roleSignal, specificJob }) {
  const verifiedRole = Boolean(roleSignal);
  const rolePhrase = verifiedRole ? `the ${jobLabel} role` : 'future opportunities';
  const contactContext = contactTitle ? `Given your work as ${contactTitle}, ` : '';
  const base = {
    why_now: verifiedRole ? `${companyName} has a verified opening for ${roleSignal}.` : `No verified opening is available, so this draft avoids claiming one.`,
    contact_hook: contactTitle ? `${contactTitle} is the known relationship context.` : 'No contact role is available; keep the request directional.',
    signal_focus: roleSignal,
    suggested_next_step: 'Personalize one sentence about your relevant experience before sending.',
  };

  if (templateKey === 'job_networking') {
    return {
      ...base,
      template_label: 'Networking question',
      subject_line: `${companyName}: a question about ${jobLabel}`,
      subject_options: [`${companyName}: a question about ${jobLabel}`, `Your perspective on ${companyName}`, `Quick question about the team`],
      message_body: [
        `Hi ${firstName},`, '',
        verifiedRole ? `I came across ${rolePhrase} at ${companyName}.` : `I am interested in the work at ${companyName} and am researching where my experience could be relevant.`, '',
        `${contactContext}I would value your perspective on one thing: what does the team tend to prioritize when evaluating people for this kind of work?`, '',
        'Even a quick reply would be genuinely helpful.',
      ].join('\n'),
      linkedin_message: `Hi ${firstName}, ${verifiedRole ? `I came across ${rolePhrase} at ${companyName}` : `I am researching ${companyName}`}. What does the team tend to value most in candidates for this kind of work? Even a quick reply would help.`,
      follow_up_message: `Hi ${firstName}, following up once in case you have a quick perspective on what ${companyName} values for ${jobLabel} candidates. No worries if timing is tight.`,
      call_opener: `I am researching ${rolePhrase} at ${companyName} and hoped to ask what the team values most in candidates.`,
      angle_summary: 'Ask one easy, informed question instead of requesting a meeting immediately.',
    };
  }

  if (templateKey === 'job_referral') {
    return {
      ...base,
      template_label: 'Referral path',
      subject_line: `${jobLabel} at ${companyName}`,
      subject_options: [`${jobLabel} at ${companyName}`, `A quick fit check before I apply`, `Question about the ${jobLabel} role`],
      message_body: [
        `Hi ${firstName},`, '',
        verifiedRole ? `I am considering an application for ${rolePhrase} at ${companyName}.` : `I am considering ${companyName} for my next move.`, '',
        `${contactContext}would you be comfortable sharing whether this is the right team to approach? If my background looks relevant after I apply, I would also appreciate any guidance on the referral process.`, '',
        'Thanks for considering it.',
      ].join('\n'),
      linkedin_message: `Hi ${firstName}, I am considering ${verifiedRole ? `the ${jobLabel} role` : 'future roles'} at ${companyName}. Would you be comfortable pointing me toward the right team or referral process?`,
      follow_up_message: `Hi ${firstName}, one quick follow-up on the ${jobLabel} opportunity. A pointer to the right team would be plenty; no need for a meeting.`,
      call_opener: `I am considering ${rolePhrase} at ${companyName} and wanted to confirm the right team or referral path.`,
      angle_summary: 'Ask for direction first and make any referral request conditional on genuine fit.',
    };
  }

  return {
    ...base,
    template_label: 'Role introduction',
    subject_line: verifiedRole ? `${jobLabel} at ${companyName}` : `Interest in ${companyName}`,
    subject_options: [verifiedRole ? `${jobLabel} at ${companyName}` : `Interest in ${companyName}`, `Question for the ${jobLabel} team`, `Exploring ${companyName}`],
    message_body: [
      `Hi ${firstName},`, '',
      verifiedRole ? `I found ${rolePhrase} at ${companyName} and it caught my attention.` : `I am exploring future opportunities at ${companyName}.`, '',
      `${contactContext}could you point me to the person who owns hiring for this area? I will keep the introduction concise and apply through the normal process.`, '',
      'Thank you for any direction you can share.',
    ].join('\n'),
    linkedin_message: `Hi ${firstName}, ${verifiedRole ? `I found the ${jobLabel} role at ${companyName}` : `I am exploring ${companyName}`}. Could you point me to the person who owns hiring for this area? I will keep it concise.`,
    follow_up_message: `Hi ${firstName}, following up once on my note about ${rolePhrase}. A name or team to contact would be more than enough.`,
    call_opener: `I am calling about ${rolePhrase} at ${companyName} and hoped you could direct me to the right hiring contact.`,
    angle_summary: 'Request a low-effort introduction to the right owner without overstating your fit.',
  };
}

function buildSalesDraft({ companyName, firstName, contactTitle, templateKey, roleSignal, activeRoleCount, specificJob, focusRole: requestedFocusRole, grounding }) {
  const hasVerifiedSignal = Boolean(roleSignal);
  const focusRole = specificJob?.title || requestedFocusRole || 'a priority search';
  const additionalRoleCount = Math.max(0, activeRoleCount - 1);
  const roleReference = hasVerifiedSignal
    ? additionalRoleCount > 0
      ? `${focusRole} and ${additionalRoleCount} other open ${additionalRoleCount === 1 ? 'role' : 'roles'}`
      : focusRole
    : 'your current hiring priorities';
  const roleCountText = activeRoleCount > 1 ? `${activeRoleCount} open roles` : roleReference;
  const familyValue = {
    data: 'For data searches, I help teams map the relevant talent pool and qualify a focused shortlist before the process absorbs more manager time.',
    engineering: 'For technical searches, I help teams reach qualified people outside the active applicant pool and narrow the market to a credible shortlist.',
    sales: 'For revenue searches, I help teams identify candidates with the right segment, buyer, and deal-cycle experience instead of relying on title matches.',
    marketing: 'For marketing searches, I help teams find candidates whose channel and growth experience matches the actual mandate, not just the job title.',
    product: 'For product and design searches, I help teams find candidates whose scope and operating environment match what the role needs.',
    clinical: 'For clinical and life-sciences searches, I help teams reach specialized candidates while keeping qualification criteria precise.',
    operations: 'For operations searches, I help teams map candidates with the right environment, scale, and hands-on operating experience.',
    finance: 'For finance and risk searches, I help teams identify candidates with the right technical depth and business context.',
    people: 'For people and talent searches, I help teams add focused sourcing capacity without creating another process to manage.',
    general: 'I help teams map the relevant market and build a focused shortlist for priority searches.',
  }[grounding.roleFamily];
  const roleQuestion = hasVerifiedSignal
    ? 'Is that search already well covered, or would a quick market map be useful?'
    : 'Who owns the searches where outside market coverage would be most useful?';
  const approaches = {
    executive: {
      label: 'Executive capacity note',
      subject: `${companyName}: hiring capacity`,
      value: activeRoleCount > 1
        ? `${roleCountText} suggests there may be a few searches competing for attention. I help teams add focused market coverage around the one role tied most closely to delivery.`
        : familyValue,
      question: hasVerifiedSignal ? 'Would additional search coverage be useful for that role?' : 'Is there one role where additional search coverage would materially help the team?',
      angle: 'Tie visible hiring demand to a specific search decision without claiming delivery is at risk.',
    },
    hiring_manager: {
      label: 'Hiring manager note',
      subject: `${roleReference} at ${companyName}`,
      value: familyValue,
      question: hasVerifiedSignal ? 'For that role, is the harder part reaching the right people or narrowing the shortlist?' : 'Is the harder part reaching the right people or narrowing the shortlist?',
      angle: 'Ask where the search is constrained and keep the offer tied to the visible role.',
    },
    talent_partner: {
      label: 'Talent partner note',
      subject: `${companyName}: ${roleCountText}`,
      value: familyValue,
      question: roleQuestion,
      angle: 'Offer a small, concrete market-mapping step around the least-covered search.',
    },
    warm_intro: {
      label: 'Warm relationship note',
      subject: `Quick question about ${companyName}'s hiring`,
      value: `I work with teams that need extra search capacity around a small number of priority roles.`,
      question: `Would you be comfortable pointing me to whoever owns recruiting for this area?`,
      angle: 'Use the relationship to ask for direction, not to force a sales meeting.',
    },
    follow_up: {
      label: 'Useful follow-up',
      subject: `Re: ${companyName}: ${roleCountText}`,
      value: `One practical place I could help is a quick market map for the role that is consuming the most search time.`,
      question: `Would a short sample map be useful, or is this not a priority now?`,
      angle: 'Add a concrete offer and an easy way to decline.',
    },
    re_engage: {
      label: 'Re-engagement note',
      subject: `Worth revisiting at ${companyName}?`,
      value: hasVerifiedSignal ? `I noticed the hiring picture now includes ${roleReference}.` : `I wanted to check whether hiring priorities have changed since we last connected.`,
      question: `Worth reopening the conversation, or should I close the loop for now?`,
      angle: 'Reopen with a current signal and give the recipient a clean out.',
    },
    cold: {
      label: 'Hiring signal note',
      subject: `${companyName}: ${roleCountText}`,
      value: familyValue,
      question: roleQuestion,
      angle: 'Lead with the verified role signal and ask a diagnostic question.',
    },
  };
  const approach = approaches[templateKey] || approaches.cold;
  const contactLine = contactTitle ? `Given your role as ${contactTitle}, I thought you might be the right person to ask.` : 'I may not have the right owner, so a redirect would be helpful.';
  const messageBody = [
    `Hi ${firstName},`, '',
    hasVerifiedSignal ? `I noticed ${companyName} is hiring for ${roleReference}.` : `I am reaching out about hiring at ${companyName}, but I do not have a verified open role to reference.`, '',
    approach.value, '',
    contactLine, '',
    approach.question,
  ].join('\n');
  return {
    template_label: approach.label,
    subject_line: approach.subject,
    subject_options: unique([approach.subject, `${roleReference} at ${companyName}`, `A question about hiring at ${companyName}`]),
    message_body: messageBody,
    linkedin_message: `Hi ${firstName}, ${hasVerifiedSignal ? `I noticed ${companyName} is hiring for ${roleReference}` : `I am trying to find the right hiring contact at ${companyName}`}. ${approach.question}`,
    follow_up_message: `Hi ${firstName}, one quick follow-up on ${focusRole}. I can send a short sample market map if useful; otherwise I am happy to close the loop.`,
    call_opener: hasVerifiedSignal
      ? `I noticed ${companyName} is hiring for ${focusRole}. I am calling to ask whether that search is already well covered or could use additional market reach.`
      : `I am trying to find the person who owns priority hiring at ${companyName}. I do not want to assume there is an active need.`,
    why_now: hasVerifiedSignal ? `${companyName} has a verified opening for ${roleReference}.` : 'No verified role signal is available; the draft does not claim one.',
    contact_hook: contactTitle ? `${contactTitle} is the known reason this contact may be relevant.` : 'No contact title is available, so the note keeps the assumption light.',
    angle_summary: approach.angle,
    suggested_next_step: 'Review the factual role signal, send the shortest suitable channel, and follow up once.',
  };
}

function buildFilters(tenantId) {
  const tenantAccounts = accountsForTenant(tenantId);
  const tenantConfigs = configsForTenant(tenantId);
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

function accountPriority(item = {}) {
  const explicit = normalizeKey(item.priority);
  if (['strategic', 'high', 'medium', 'low'].includes(explicit)) return explicit;
  return ({ a: 'high', b: 'medium', c: 'low' })[normalizeKey(item.priorityTier)] || 'medium';
}

function accountMatchesGeography(item = {}, geography = '') {
  const location = normalizeKey(item.location);
  if (!location) return false;
  const canada = /\b(canada|ontario|quebec|alberta|british columbia|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island)\b/.test(location)
    || /(?:^|,\s*)(on|qc|ab|bc|mb|sk|ns|nb|nl|pe)(?:\s|,|$)/i.test(String(item.location));
  const us = /\b(united states|usa|u\.s\.|us)\b/.test(location)
    || /(?:^|,\s*)(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)(?:\s|,|$)/i.test(String(item.location));
  const requested = normalizeKey(geography);
  if (requested === 'canada') return canada;
  if (requested === 'us') return us;
  if (requested === 'canada_us') return canada || us;
  return true;
}

function sortAccountRows(items, sortBy = '') {
  const timestamp = (value, fallback) => {
    const parsed = new Date(value || '').getTime();
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  items.sort((a, b) => {
    let difference;
    if (sortBy === 'new_roles') difference = Number(b.newRoleCount7d || 0) - Number(a.newRoleCount7d || 0);
    else if (sortBy === 'connections') difference = Number(b.connectionCount || b.contactCount || 0) - Number(a.connectionCount || a.contactCount || 0);
    else if (sortBy === 'follow_up') difference = timestamp(a.nextActionAt, Number.MAX_SAFE_INTEGER) - timestamp(b.nextActionAt, Number.MAX_SAFE_INTEGER);
    else if (sortBy === 'recent_jobs') difference = timestamp(b.lastJobPostedAt, 0) - timestamp(a.lastJobPostedAt, 0)
      || Number(b.jobsLast30Days || 0) - Number(a.jobsLast30Days || 0);
    else difference = Number(b.targetScore || b.dailyScore || 0) - Number(a.targetScore || a.dailyScore || 0);
    return difference
      || Number(b.targetScore || b.dailyScore || 0) - Number(a.targetScore || a.dailyScore || 0)
      || String(a.displayName || '').localeCompare(String(b.displayName || ''))
      || String(a.id || '').localeCompare(String(b.id || ''));
  });
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
  // Sort a copy: sorting the stored array in place mutates persisted order on
  // every read and races with concurrent iteration.
  return [...(jobsByTenant.get(tenantId) || [])]
    .sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt)));
}

function configsForTenant(tenantId) {
  return configsByTenant.get(tenantId) || [];
}

function activitiesForTenant(tenantId) {
  return [...(activitiesByTenant.get(tenantId) || [])]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

function tasksForTenant(tenantId) {
  return [...(tasksByTenant.get(tenantId) || [])]
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

function accountById(accountId, tenantId) {
  // Prefer the tenant-scoped array: the global array spans all tenants, so an
  // id collision with another tenant's record would shadow the right account.
  if (tenantId) {
    const scoped = (accountsByTenant.get(tenantId) || []).find((item) => item.id === accountId);
    if (scoped) return scoped;
  }
  return accounts.find((item) => item.id === accountId);
}

function selectContact(accountContacts, contactName) {
  if (!Array.isArray(accountContacts) || !accountContacts.length) return null;
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
  if ((tenant.storageMode || tenant.storage_mode) === 'relational') registerRelationalPrimaryTenant(tenantId);
  const tenantPersona = readPersona(tenant?.persona || tenant?.settings?.persona);
  if (tenantProfiles.has(tenantId)) {
    const existing = tenantProfiles.get(tenantId);
    existing.tenant = {
      ...(existing.tenant || {}),
      ...(typeof tenant === 'object' ? tenant : {}),
      id: tenantId,
    };
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
    tenant: {
      ...(typeof tenant === 'object' ? tenant : {}),
      id: tenantId,
    },
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

function countValues(values = []) {
  return values.reduce((acc, value) => {
    const key = String(value || 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
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

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

const WORKSPACE_PREFERENCE_FIELDS = new Set([
  'accountNotes',
  'automationRules',
  'customFields',
  'customFieldValues',
  'outreachSequences',
  'activityLog',
  'alertThresholds',
]);

function sanitizeWorkspacePreferences(input = {}, current = {}) {
  const result = { ...current };
  for (const [key, value] of Object.entries(input || {})) {
    if (!WORKSPACE_PREFERENCE_FIELDS.has(key)) continue;
    if (key === 'automationRules' || key === 'customFields') {
      result[key] = Array.isArray(value) ? value.slice(0, 100) : [];
    } else if (key === 'outreachSequences') {
      result[key] = Array.isArray(value) ? value.slice(-1000) : [];
    } else if (key === 'activityLog') {
      result[key] = Array.isArray(value) ? value.slice(0, 500) : [];
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = value;
    }
  }
  result.updatedAt = now();
  return JSON.parse(JSON.stringify(result));
}

function stableIdentityKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function hashText(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function canonicalLinkedInUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${path}`;
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
  }
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function contactDedupeKeys(item = {}, companyKey = '') {
  const keys = [];
  const linkedin = canonicalLinkedInUrl(item.linkedinUrl || item.linkedin_url || item.url);
  const email = normalizedEmail(item.email || item.emailAddress);
  const name = stableIdentityKey(item.fullName || item.name);
  const company = companyKey || stableIdentityKey(item.companyName || item.company);
  if (linkedin) keys.push(`linkedin:${linkedin}`);
  if (email) keys.push(`email:${email}`);
  if (name && company) keys.push(`name-company:${name}|${company}`);
  return keys;
}

function indexContactDedupeKeys(map, contactItem, companyKey = '') {
  for (const key of contactDedupeKeys(contactItem, companyKey)) {
    if (!map.has(key)) map.set(key, contactItem);
  }
}

function buildLinkedInContactPatch(existing, incoming, targetAccount, timestamp, options = {}) {
  const patch = {};
  const setIfChanged = (field, value) => {
    const cleanValue = String(value || '').trim();
    if (cleanValue && cleanValue !== String(existing[field] || '').trim()) patch[field] = cleanValue;
  };

  setIfChanged('firstName', incoming.firstName);
  setIfChanged('lastName', incoming.lastName);
  setIfChanged('fullName', incoming.fullName);
  setIfChanged('email', incoming.email);
  setIfChanged('linkedinUrl', incoming.linkedinUrl);
  setIfChanged('connectedOn', incoming.connectedOn);

  const currentCompany = String(existing.companyName || '').trim();
  const incomingCompany = String(incoming.company || '').trim();
  const companyChanged = Boolean(
    options.allowCompanyMove
    && incomingCompany
    && normalizeKey(incomingCompany) !== normalizeKey(currentCompany)
  );
  const incomingTitle = String(incoming.position || '').trim();
  const currentTitle = String(existing.title || '').trim();
  const titleChanged = Boolean(incomingTitle && normalizeKey(incomingTitle) !== normalizeKey(currentTitle));

  if (companyChanged || titleChanged) {
    const employmentHistory = Array.isArray(existing.employmentHistory)
      ? existing.employmentHistory.map((item) => ({ ...item }))
      : [];
    if (currentCompany || currentTitle) {
      const previousRole = {
        companyName: currentCompany,
        title: currentTitle,
        accountId: existing.accountId || '',
        firstObservedAt: existing.sourceMetadata?.currentEmploymentObservedAt || existing.createdAt || '',
        lastObservedAt: timestamp,
        source: 'linkedin_csv',
      };
      const previousKey = `${normalizeKey(previousRole.companyName)}|${normalizeKey(previousRole.title)}`;
      const latest = employmentHistory[employmentHistory.length - 1];
      const latestKey = latest ? `${normalizeKey(latest.companyName)}|${normalizeKey(latest.title)}` : '';
      if (previousKey !== latestKey) employmentHistory.push(previousRole);
    }
    patch.employmentHistory = employmentHistory;
  }

  if (companyChanged) {
    patch.companyName = incomingCompany;
    patch.accountId = targetAccount.id;
  } else if (incomingCompany && incomingCompany !== currentCompany && normalizeKey(incomingCompany) === normalizeKey(currentCompany)) {
    patch.companyName = incomingCompany;
  }
  if (incomingTitle && incomingTitle !== currentTitle) patch.title = incomingTitle;

  const nextTitle = patch.title || currentTitle;
  const nextEmail = patch.email || existing.email || '';
  const nextSeniority = classifySeniority(nextTitle);
  const nextIsTalent = isTalentTitle(nextTitle);
  const nextPriority = computeContactPriority(nextSeniority, nextIsTalent, nextEmail);
  if (nextSeniority !== existing.seniority) patch.seniority = nextSeniority;
  if (nextIsTalent !== Boolean(existing.isTalentLeader)) patch.isTalentLeader = nextIsTalent;
  if (nextPriority !== Number(existing.priorityScore || 0)) patch.priorityScore = nextPriority;

  if (!Object.keys(patch).length) return null;
  patch.sourceMetadata = {
    ...(existing.sourceMetadata || {}),
    lastLinkedInImportAt: timestamp,
    currentEmploymentObservedAt: companyChanged || titleChanged
      ? timestamp
      : existing.sourceMetadata?.currentEmploymentObservedAt || existing.createdAt || timestamp,
  };
  patch.updatedAt = timestamp;
  return patch;
}

function refreshAccountContactRollups(accountList, contactList, affectedAccountIds, timestamp) {
  const rollups = new Map();
  for (const contactItem of contactList) {
    if (!contactItem.accountId) continue;
    const rollup = rollups.get(contactItem.accountId) || { connections: 0, senior: 0, talent: 0 };
    rollup.connections += 1;
    if (['executive', 'director', 'vp'].includes(String(contactItem.seniority || '').toLowerCase())) rollup.senior += 1;
    if (contactItem.isTalentLeader) rollup.talent += 1;
    rollups.set(contactItem.accountId, rollup);
  }

  for (const accountItem of accountList) {
    if (!affectedAccountIds.has(accountItem.id)) continue;
    const rollup = rollups.get(accountItem.id) || { connections: 0, senior: 0, talent: 0 };
    const targetScore = Math.min(100, Math.round(
      rollup.connections * 8
      + rollup.senior * 15
      + rollup.talent * 20
    ));
    const changed = accountItem.connectionCount !== rollup.connections
      || accountItem.contactCount !== rollup.connections
      || accountItem.seniorContactCount !== rollup.senior
      || accountItem.talentContactCount !== rollup.talent
      || accountItem.targetScore !== targetScore
      || accountItem.dailyScore !== targetScore;
    if (!changed) continue;
    accountItem.connectionCount = rollup.connections;
    accountItem.contactCount = rollup.connections;
    accountItem.seniorContactCount = rollup.senior;
    accountItem.talentContactCount = rollup.talent;
    accountItem.targetScore = targetScore;
    accountItem.dailyScore = targetScore;
    accountItem.updatedAt = timestamp;
  }
}

const PERSONAL_EMAIL_DOMAIN_LABELS = new Set([
  'aol', 'fastmail', 'gmail', 'gmx', 'hey', 'hotmail', 'icloud', 'live', 'mac',
  'mail', 'me', 'msn', 'outlook', 'pm', 'proton', 'protonmail', 'webmail',
  'yahoo', 'yandex', 'zoho',
]);
const PERSONAL_EMAIL_DOMAINS = new Set([
  'bell.net', 'email.com', 'googlemail.com', 'shaw.ca', 'usa.net',
]);

function getUsableCompanyDomain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const emailHost = raw.includes('@') ? raw.split('@').pop() : raw;
    const parsed = new URL(/^https?:\/\//i.test(emailHost) ? emailHost : `https://${emailHost}`);
    const host = parsed.hostname.replace(/^www\./i, '').replace(/\.$/, '');
    if (!host || !host.includes('.') || host === 'localhost' || /^\d+(?:\.\d+){3}$/.test(host)) return '';
    const firstLabel = host.split('.')[0];
    if (PERSONAL_EMAIL_DOMAINS.has(host) || PERSONAL_EMAIL_DOMAIN_LABELS.has(firstLabel)) return '';
    return host;
  } catch {
    return '';
  }
}

function getUsableCareerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!detectAtsTypeFromUrl(parsed.toString()) && !getUsableCompanyDomain(parsed.hostname)) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function inferDomainFromContacts(tenantId, accountId) {
  for (const contactItem of contacts) {
    if (contactItem.tenantId !== tenantId || contactItem.accountId !== accountId || !contactItem.email) continue;
    const domain = getUsableCompanyDomain(contactItem.email);
    if (domain) return domain;
  }
  return '';
}

function buildInferredDomainMap(tenantId) {
  const domainsByAccount = new Map();
  for (const contactItem of contacts) {
    if (contactItem.tenantId !== tenantId || !contactItem.accountId || domainsByAccount.has(contactItem.accountId)) continue;
    const domain = getUsableCompanyDomain(contactItem.email);
    if (domain) domainsByAccount.set(contactItem.accountId, domain);
  }
  return domainsByAccount;
}

function daysSince(value) {
  if (!value) return 999;
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
}

const ATS_FETCHERS = new Map([
  ['greenhouse', fetchGreenhouseJobs],
  ['lever', fetchLeverJobs],
  ['ashby', fetchAshbyJobs],
  ['smartrecruiters', fetchSmartRecruitersJobs],
  ['jobvite', fetchJobviteJobs],
  ['workday', fetchWorkdayJobs],
  ['bamboohr', fetchBamboohrJobs],
  ['workable', fetchWorkableJobs],
  ['recruitee', fetchRecruiteeJobs],
  ['personio', fetchPersonioJobs],
  ['rippling', fetchRipplingJobs],
  ['custom_static', fetchStaticCareersJobs],
]);

const BLIND_PROBE_ATS_TYPES = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jobvite', 'recruitee', 'personio', 'rippling'];

const TRACKING_ONLY_ATS_TYPES = new Set(['icims', 'taleo', 'adp', 'successfactors', 'phenom']);
const BOARD_COVERAGE_META = {
  healthy: {
    label: 'Importing successfully',
    action: 'No action needed.',
  },
  ready_not_run: {
    label: 'Ready for first refresh',
    action: 'Import the latest jobs.',
  },
  failed: {
    label: 'Refresh failed',
    action: 'Check the saved board URL, then retry the job refresh.',
  },
  empty: {
    label: 'No open jobs returned',
    action: 'Confirm the board URL or leave it until the company posts another role.',
  },
  needs_review: {
    label: 'Match needs review',
    action: 'Review the match before using it for live jobs.',
  },
  tracking_only: {
    label: 'Tracking only',
    action: 'Keep the careers link for reference or replace it with a supported public board.',
  },
  careers_page_only: {
    label: 'Careers page needs a source',
    action: 'Add a supported public board URL or try the compatible careers-page option.',
  },
  discovery_needed: {
    label: 'Ready for board search',
    action: 'Run job-board discovery for this company.',
  },
  missing_identity: {
    label: 'Company details missing',
    action: 'Add the company domain or careers URL, then retry discovery.',
  },
  rejected: {
    label: 'Rejected match',
    action: 'No action unless you want to review this decision.',
  },
};

function normalizeAtsType(value) {
  const normalized = normalizeKey(value).replace(/[^a-z0-9]/g, '');
  if (normalized.includes('greenhouse')) return 'greenhouse';
  if (normalized.includes('lever')) return 'lever';
  if (normalized.includes('ashby')) return 'ashby';
  if (normalized.includes('smartrecruiters')) return 'smartrecruiters';
  if (normalized.includes('jobvite')) return 'jobvite';
  if (normalized.includes('workday') || normalized.includes('myworkdayjobs')) return 'workday';
  if (normalized.includes('bamboohr')) return 'bamboohr';
  if (normalized.includes('workable')) return 'workable';
  if (normalized.includes('recruitee')) return 'recruitee';
  if (normalized.includes('personio')) return 'personio';
  if (normalized.includes('rippling')) return 'rippling';
  if (normalized.includes('customstatic') || normalized.includes('staticcareers')) return 'custom_static';
  return normalized;
}

function detectAtsTypeFromUrl(value) {
  const url = String(value || '').toLowerCase();
  if (!url) return '';
  if (url.includes('greenhouse.io')) return 'greenhouse';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('ashbyhq.com')) return 'ashby';
  if (url.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (url.includes('jobvite.com')) return 'jobvite';
  if (url.includes('myworkdayjobs.com')) return 'workday';
  if (url.includes('bamboohr.com')) return 'bamboohr';
  if (url.includes('workable.com')) return 'workable';
  if (url.includes('recruitee.com')) return 'recruitee';
  if (url.includes('jobs.personio.de')) return 'personio';
  if (url.includes('ats.rippling.com')) return 'rippling';
  return '';
}

function getConfigUrlCandidates(config = {}) {
  const urls = [];
  for (const field of CONFIG_ATS_URL_FIELDS) {
    const value = String(config[field] || '').trim();
    if (value && !urls.includes(value)) urls.push(value);
  }
  return urls;
}

function getConfigAtsUrl(config = {}) {
  return getConfigUrlCandidates(config).find((value) => detectAtsTypeFromUrl(value)) || '';
}

function getConfigAtsType(config = {}) {
  const explicit = normalizeAtsType(config.atsType || config.ats);
  if (ATS_FETCHERS.has(explicit)) return explicit;
  return detectAtsTypeFromUrl(getConfigAtsUrl(config));
}

function prioritizeDiscoveryCandidates(configs = [], accountsById = new Map(), accountsByName = new Map(), context = {}) {
  return [...configs].sort((a, b) => {
    const scoreDelta = getDiscoveryCandidateScore(b, accountForConfig(b, accountsById, accountsByName), context)
      - getDiscoveryCandidateScore(a, accountForConfig(a, accountsById, accountsByName), context);
    if (scoreDelta) return scoreDelta;
    const checkedDelta = String(a.lastDiscoveryCheckedAt || '').localeCompare(String(b.lastDiscoveryCheckedAt || ''));
    if (checkedDelta) return checkedDelta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function getDiscoveryCandidateScore(config = {}, accountItem = null, context = {}) {
  let score = 0;
  if (getConfigAtsUrl(config)) score += 1000;
  if (getConfigUrlCandidates(config).some((value) => getUsableCareerUrl(value))) score += 500;
  if (getUsableCompanyDomain(config.domain || config.canonicalDomain)) score += 150;
  if (accountItem) {
    score += Math.min(300, Math.max(0, Number(accountItem.targetScore || accountItem.dailyScore || 0)) * 3);
    score += Math.min(100, Math.max(0, Number(accountItem.connectionCount || accountItem.contactCount || 0)) * 2);
    const focus = context.searchFocus || {};
    const accountText = normalizeSearchText([
      accountItem.industry,
      accountItem.location,
      accountItem.notes,
      ...(Array.isArray(accountItem.tags) ? accountItem.tags : []),
    ].filter(Boolean).join(' '));
    if (parseFocusTerms(focus.targetIndustries).some((term) => phraseMatchesText(term, accountText))) score += 350;
    if (parseFocusTerms(focus.targetRoles).some((term) => phraseMatchesText(term, accountText))) score += 125;
    score += Math.min(300, Number(context.relevantJobsByAccount?.get(accountItem.id) || 0) * 75);
  }
  if (!config.lastDiscoveryCheckedAt) score += 80;
  const lastCheckedMs = Date.parse(config.lastDiscoveryCheckedAt || '');
  if (Number.isFinite(lastCheckedMs)) {
    const ageMs = Date.now() - lastCheckedMs;
    if (ageMs < 24 * 60 * 60 * 1000) score -= 350;
    else if (ageMs < 7 * 24 * 60 * 60 * 1000) score -= 100;
  }
  const status = normalizeKey(config.discoveryStatus || '');
  if (status === 'needs_review') score += 50;
  if (status === 'unresolved') score += 25;
  if (status === 'error') score -= 100;
  if (config.active === false) score -= 25;
  return score;
}

function getConfigBoardId(config = {}) {
  const direct = config.boardId || config.board_id || config.slug || config.boardSlug || '';
  if (direct) return String(direct).trim();
  for (const sourceUrl of getConfigUrlCandidates(config)) {
    const greenhouse = String(sourceUrl).match(/boards(?:-api)?\.greenhouse\.io\/(?:v1\/)?boards\/([^/?#]+)/i);
    if (greenhouse) return decodeURIComponent(greenhouse[1]);
    const greenhouseBoard = String(sourceUrl).match(/boards\.greenhouse\.io\/([^/?#]+)/i);
    if (greenhouseBoard && greenhouseBoard[1].toLowerCase() !== 'embed') return decodeURIComponent(greenhouseBoard[1]);
    // Newer Greenhouse-hosted boards live at job-boards.greenhouse.io/{token}.
    const greenhouseJobBoards = String(sourceUrl).match(/job-boards\.greenhouse\.io\/([^/?#]+)/i);
    if (greenhouseJobBoards && greenhouseJobBoards[1].toLowerCase() !== 'embed') return decodeURIComponent(greenhouseJobBoards[1]);
    const greenhouseEmbed = parseUrlSearchParam(sourceUrl, 'for');
    if (String(sourceUrl).match(/boards\.greenhouse\.io\/embed\/job_board/i) && greenhouseEmbed) return greenhouseEmbed;
    const lever = String(sourceUrl).match(/lever\.co\/(?:v0\/)?postings\/([^/?#]+)/i);
    if (lever) return decodeURIComponent(lever[1]);
    const leverBoard = String(sourceUrl).match(/jobs\.lever\.co\/(?:embed\/)?([^/?#]+)/i);
    if (leverBoard && leverBoard[1].toLowerCase() !== 'embed') return decodeURIComponent(leverBoard[1]);
    const ashbyApi = String(sourceUrl).match(/api\.ashbyhq\.com\/posting-api\/job-board\/([^/?#]+)/i);
    if (ashbyApi) return decodeURIComponent(ashbyApi[1]);
    const ashbyBoard = String(sourceUrl).match(/jobs\.ashbyhq\.com\/([^/?#]+)/i);
    if (ashbyBoard) return decodeURIComponent(ashbyBoard[1]);
    const smartRecruiters = String(sourceUrl).match(/smartrecruiters\.com\/(?:v1\/companies\/)?([^/?#]+)(?:\/postings)?/i);
    if (smartRecruiters && !['jobs', 'careers', 'www', 'api'].includes(smartRecruiters[1].toLowerCase())) return decodeURIComponent(smartRecruiters[1]);
    const jobviteCareers = String(sourceUrl).match(/jobs\.jobvite\.com\/careers\/([^/?#&]+)/i);
    if (jobviteCareers) return decodeURIComponent(jobviteCareers[1]);
    const jobviteApi = String(sourceUrl).match(/jobs\.jobvite\.com\/api\/job-list\?company=([^/?#&]+)/i);
    if (jobviteApi) return decodeURIComponent(jobviteApi[1]);
    const jobvite = String(sourceUrl).match(/jobs\.jobvite\.com\/([^/?#&]+)/i);
    if (jobvite && !['api', 'careers'].includes(jobvite[1].toLowerCase())) return decodeURIComponent(jobvite[1]);
  }
  const workday = getWorkdayDescriptor(config);
  if (workday) return `${workday.tenant}/${workday.site}`;
  for (const sourceUrl of getConfigUrlCandidates(config)) {
    const bamboo = String(sourceUrl).match(/https?:\/\/([^./]+)\.bamboohr\.com/i);
    if (bamboo) return decodeURIComponent(bamboo[1]);
    const workable = String(sourceUrl).match(/(?:apply\.)?workable\.com\/(?:api\/accounts\/)?([^/?#]+)/i);
    if (workable && !['api', 'j', 'jobs', 'www'].includes(workable[1].toLowerCase())) return decodeURIComponent(workable[1]);
    const recruitee = String(sourceUrl).match(/https?:\/\/([^./]+)\.recruitee\.com/i);
    if (recruitee) return decodeURIComponent(recruitee[1]);
    const personio = String(sourceUrl).match(/https?:\/\/([^./]+)\.jobs\.personio\.de/i);
    if (personio) return decodeURIComponent(personio[1]);
    try {
      const parsed = new URL(sourceUrl);
      if (parsed.hostname.toLowerCase() === 'ats.rippling.com') {
        const segments = parsed.pathname.split('/').filter(Boolean);
        const jobsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'jobs');
        if (jobsIndex > 0) return decodeURIComponent(segments[jobsIndex - 1]);
      }
    } catch {
      // Continue to the next URL candidate.
    }
  }
  return '';
}

function parseUrlSearchParam(value, name) {
  try {
    const parsed = new URL(String(value || '').startsWith('http') ? value : `https://${value}`);
    return parsed.searchParams.get(name) || '';
  } catch {
    return '';
  }
}

function repairKnownAtsIdentity(config = {}, options = {}) {
  const corrected = applyKnownBoardCorrection(config);
  const atsType = getConfigAtsType(config);
  const boardId = getConfigBoardId(config);
  if (!ATS_FETCHERS.has(atsType) || !boardId) return corrected;
  const directAtsUrl = getConfigAtsUrl(config);
  const reviewStatus = normalizeKey(config.reviewStatus || '');
  const isUnreviewedNameProbe = config.discoveryMethod === 'public_ats_probe' && reviewStatus !== 'approved';
  const explicitlyRejected = reviewStatus === 'rejected';
  const failedIdentity = normalizeKey(config.lastImportStatus || '') === 'failed';
  const canApprove = options.approveDirect
    && Boolean(directAtsUrl)
    && !isUnreviewedNameProbe
    && !explicitlyRejected
    && !failedIdentity;
  let changed = corrected;

  if (normalizeAtsType(config.atsType || '') !== atsType) {
    config.atsType = atsType;
    changed = true;
  }
  if (normalizeAtsType(config.ats || '') !== atsType) {
    config.ats = atsType;
    changed = true;
  }
  if (String(config.boardId || '').trim() !== boardId) {
    config.boardId = boardId;
    changed = true;
  }
  if (directAtsUrl && !config.resolvedBoardUrl) {
    config.resolvedBoardUrl = directAtsUrl;
    changed = true;
  }
  if (canApprove) {
    if (!['resolved', 'mapped', 'discovered', 'manual'].includes(normalizeKey(config.discoveryStatus || ''))) {
      config.discoveryStatus = 'resolved';
      changed = true;
    }
    if (normalizeKey(config.reviewStatus || '') !== 'approved') {
      config.reviewStatus = 'approved';
      changed = true;
    }
    if (config.active === false) {
      config.active = true;
      changed = true;
    }
    if (config.confidenceBand !== 'high') {
      config.confidenceBand = 'high';
      changed = true;
    }
    if (!config.discoveryMethod || config.discoveryMethod === 'public_ats_probe') {
      config.discoveryMethod = 'direct_ats_url';
      changed = true;
    }
    if (!config.lastImportStatus || ['not ready', 'unresolved'].includes(normalizeKey(config.lastImportStatus))) {
      config.lastImportStatus = 'ready';
      changed = true;
    }
  }
  if (changed) config.updatedAt = now();
  return changed;
}

function applyKnownBoardCorrection(config = {}) {
  const companyKey = normalizeKey(config.companyName || config.normalizedCompanyName || '');
  const domainKey = normalizeKey(config.domain || config.canonicalDomain || config.careersUrl || '');
  const boardKey = normalizeKey(config.boardId || '');
  const looksLikeLightspeedCommerce = (
    ['lightspeed', 'lightspeed commerce', 'lightspeedhq'].includes(companyKey) ||
    domainKey.includes('lightspeedhq.com') ||
    boardKey === 'lightspeedhq'
  );
  if (!looksLikeLightspeedCommerce) return false;
  const preserveReviewDecision = normalizeKey(config.reviewStatus || '') === 'rejected'
    || normalizeKey(config.lastImportStatus || '') === 'failed';

  let changed = false;
  const apply = (field, value) => {
    if (config[field] !== value) {
      config[field] = value;
      changed = true;
    }
  };

  apply('atsType', 'custom_static');
  apply('ats', 'custom_static');
  apply('boardId', 'lightspeedhq');
  apply('domain', 'lightspeedhq.com');
  apply('careersUrl', 'https://www.lightspeedhq.com/careers/openings/');
  apply('sourceUrl', 'https://www.lightspeedhq.com/careers/openings/');
  apply('resolvedBoardUrl', 'https://www.lightspeedhq.com/careers/openings/');
  apply('apiUrl', 'https://www.lightspeedhq.com/careers/openings/');
  if (!preserveReviewDecision) apply('discoveryStatus', 'resolved');
  apply('discoveryMethod', 'known_static_careers_page');
  if (!preserveReviewDecision) {
    apply('reviewStatus', 'approved');
    apply('confidenceBand', 'high');
    apply('active', true);
  }
  if (!config.notes || String(config.notes).includes('Greenhouse')) {
    apply('notes', 'Lightspeed Commerce jobs are listed on a static careers page; the old Greenhouse lightspeedhq board is stale.');
  }
  if (changed) config.updatedAt = now();
  return changed;
}

function hasSupportedBoardIdentity(config = {}) {
  const atsType = getConfigAtsType(config);
  return ATS_FETCHERS.has(atsType) && Boolean(getConfigBoardId(config));
}

function isResolvedBoardConfig(config = {}) {
  if (!hasSupportedBoardIdentity(config)) return false;
  const status = normalizeKey(config.discoveryStatus || '');
  const reviewStatus = normalizeKey(config.reviewStatus || '');
  return (
    ['resolved', 'mapped', 'discovered', 'manual'].includes(status) ||
    reviewStatus === 'approved'
  );
}

function isImportReadyConfig(config = {}) {
  return config.active !== false && isResolvedBoardConfig(config);
}

function classifyBoardCoverage(config = {}) {
  const importStatus = normalizeKey(config.lastImportStatus || 'never');
  const reviewStatus = normalizeKey(config.reviewStatus || '');
  const explicitAtsType = normalizeAtsType(config.atsType || config.ats);
  const atsType = getConfigAtsType(config) || explicitAtsType;
  const boardId = getConfigBoardId(config);
  const supported = ATS_FETCHERS.has(atsType);
  const importReady = isImportReadyConfig(config);

  if (reviewStatus === 'rejected') return 'rejected';
  if (importStatus === 'failed') return 'failed';
  if (importReady) {
    if (importStatus === 'empty') return 'empty';
    if (importStatus === 'success') return 'healthy';
    return 'ready_not_run';
  }
  if (supported && boardId) return 'needs_review';
  if (TRACKING_ONLY_ATS_TYPES.has(explicitAtsType)) return 'tracking_only';
  if (getConfigUrlCandidates(config).some((value) => getUsableCareerUrl(value))) return 'careers_page_only';
  if (getUsableCompanyDomain(config.domain || config.canonicalDomain)) return 'discovery_needed';
  return 'missing_identity';
}

function getBoardCoverageFailureDetail(config = {}) {
  const error = String(config.lastImportError || config.lastDiscoveryError || '');
  if (/HTTP\s+(404|410)\b/i.test(error)) return 'The saved job board is no longer available.';
  if (/timed?\s*out|timeout/i.test(error)) return 'The job board took too long to respond.';
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(error)) return 'The job board could not be reached.';
  return 'The latest refresh did not complete. Check the saved board URL and try again.';
}

function configMatchesAccount(config = {}, account = {}) {
  if (config.accountId && account.id && config.accountId === account.id) return true;
  const configName = normalizeKey(config.normalizedCompanyName || config.companyName || '');
  const accountNames = [
    account.normalizedName,
    account.displayName,
    ...(Array.isArray(account.aliases) ? account.aliases : []),
  ].map((value) => normalizeKey(value)).filter(Boolean);
  return Boolean(configName && accountNames.includes(configName));
}

// DATA-101: tracked targets are the accounts the user selected for fresh
// hiring intelligence; network companies are everything else from imports.
// Records created before the field existed are grandfathered as tracked so
// existing workspaces keep their current behavior until curated.
function isTrackedTarget(item) {
  return Boolean(item) && item.tracked !== false;
}

function rankLinkedInCompanyCandidates(companyMap, existingAccountsMap, availableAccountSlots) {
  const candidates = [...companyMap.entries()].map(([key, company]) => {
    const existingAccount = existingAccountsMap.get(key) || null;
    const seniorContactCount = company.contacts.filter((contactItem) => (
      ['executive', 'vp', 'director'].includes(classifySeniority(contactItem.position))
    )).length;
    const talentContactCount = company.contacts.filter((contactItem) => isTalentTitle(contactItem.position)).length;
    const rankScore = Math.min(100, (
      company.contacts.length * 5
      + seniorContactCount * 12
      + talentContactCount * 18
      + (company.domain ? 5 : 0)
    ));
    const reasons = [];
    if (talentContactCount) reasons.push(talentContactCount + ' talent contact' + (talentContactCount === 1 ? '' : 's'));
    if (seniorContactCount) reasons.push(seniorContactCount + ' senior contact' + (seniorContactCount === 1 ? '' : 's'));
    if (!reasons.length) reasons.push(company.contacts.length + ' connection' + (company.contacts.length === 1 ? '' : 's'));
    return {
      key,
      companyName: company.displayName,
      domain: company.domain || '',
      contactCount: company.contacts.length,
      seniorContactCount,
      talentContactCount,
      rankScore,
      rankReason: reasons.join(', '),
      existing: Boolean(existingAccount),
      alreadyTracked: isTrackedTarget(existingAccount),
      overLimit: false,
      recommended: false,
    };
  });

  candidates.sort((a, b) => (
    Number(b.alreadyTracked) - Number(a.alreadyTracked)
    || b.rankScore - a.rankScore
    || b.contactCount - a.contactCount
    || a.companyName.localeCompare(b.companyName)
  ));

  let remainingSlots = availableAccountSlots;
  let recommendationsRemaining = 10;
  for (const candidate of candidates) {
    if (!candidate.existing) {
      candidate.overLimit = remainingSlots <= 0;
      if (!candidate.overLimit && Number.isFinite(remainingSlots)) remainingSlots -= 1;
    }
    if (!candidate.overLimit && !candidate.alreadyTracked && recommendationsRemaining > 0) {
      candidate.recommended = true;
      recommendationsRemaining -= 1;
    }
  }
  return candidates;
}

// Resolve a board config back to its account: by explicit link first, then by
// normalized company name (real production configs predate account_id links).
function accountForConfig(config, accountsById, accountsByName) {
  if (config.accountId && accountsById.has(config.accountId)) return accountsById.get(config.accountId);
  const key = normalizeKey(config.normalizedCompanyName || config.companyName || '');
  return key ? accountsByName.get(key) : undefined;
}

function getAccountsNeedingResolution(tenantAccounts = [], tenantConfigs = []) {
  // Index resolved configs once (O(C)) so the account pass is O(A); the naive
  // per-account tenantConfigs.some() scan is O(A*C) which at 12k x 12k blocks
  // the event loop for ~16s.
  const resolvedConfigNames = new Set();
  const resolvedConfigAccountIds = new Set();
  for (const config of tenantConfigs) {
    if (!isResolvedBoardConfig(config)) continue;
    if (config.accountId) resolvedConfigAccountIds.add(config.accountId);
    const configName = normalizeKey(config.normalizedCompanyName || config.companyName || '');
    if (configName) resolvedConfigNames.add(configName);
  }
  return tenantAccounts.filter((item) => {
    if (['client', 'paused'].includes(normalizeKey(item.status))) return false;
    const hasDomain = Boolean(item.canonicalDomain || item.domain);
    const hasCareersUrl = Boolean(item.careersUrl);
    if (!hasDomain || !hasCareersUrl) return true;
    if (item.id && resolvedConfigAccountIds.has(item.id)) return false;
    const accountNames = [
      item.normalizedName,
      item.displayName,
      ...(Array.isArray(item.aliases) ? item.aliases : []),
    ];
    const hasResolvedBoard = accountNames.some((value) => {
      const key = normalizeKey(value);
      return key && resolvedConfigNames.has(key);
    });
    return !hasResolvedBoard;
  });
}

function getWorkdayDescriptor(config = {}) {
  const rawUrl = config.apiUrl || config.resolvedBoardUrl || config.careersUrl || config.sourceUrl || config.boardUrl || config.url || '';
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const hostMatch = parsed.hostname.match(/^([^.]+)\.wd\d+\.myworkdayjobs\.com$/i);
  if (!hostMatch) return null;
  const tenant = hostMatch[1];
  const segments = parsed.pathname.split('/').filter(Boolean);
  let site = '';
  const cxsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'cxs');
  if (cxsIndex >= 0 && segments[cxsIndex + 2]) {
    site = segments[cxsIndex + 2];
  } else if (segments[1] && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0])) {
    site = segments[1];
  } else if (segments[0]) {
    site = segments[0];
  }
  if (!site) return null;
  const baseUrl = `${parsed.protocol}//${parsed.hostname}`;
  return {
    tenant,
    site,
    apiUrl: `${baseUrl}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`,
    resolvedBoardUrl: `${baseUrl}/${segments.slice(0, Math.max(1, segments.indexOf(site) + 1)).join('/')}`,
  };
}

async function fetchGreenhouseJobs(config, boardId) {
  const url = config.apiUrl || `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardId)}/jobs?content=true`;
  const payload = await fetchJson(url);
  return { jobs: Array.isArray(payload?.jobs) ? payload.jobs : [] };
}

async function fetchLeverJobs(config, boardId) {
  const url = config.apiUrl || `https://api.lever.co/v0/postings/${encodeURIComponent(boardId)}?mode=json`;
  const payload = await fetchJson(url);
  return { jobs: Array.isArray(payload) ? payload : [] };
}

async function fetchAshbyJobs(config, boardId) {
  const url = config.apiUrl || `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardId)}`;
  const payload = await fetchJson(url);
  return { jobs: Array.isArray(payload?.jobs) ? payload.jobs : [] };
}

async function fetchSmartRecruitersJobs(config, boardId) {
  const pageSize = 100;
  const baseUrl = config.apiUrl || `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(boardId)}/postings`;
  const firstPayload = await fetchJson(setUrlSearchParams(baseUrl, { limit: pageSize, offset: 0 }));
  const firstJobs = firstArray(firstPayload?.content, firstPayload?.postings, firstPayload);
  const jobs = [...firstJobs];
  const reportedTotal = Number(firstPayload?.totalFound || firstPayload?.total || firstPayload?.count || 0);
  const maxRows = pageSize * DEFAULT_ATS_MAX_PAGES;
  const totalRows = reportedTotal > 0 ? Math.min(reportedTotal, maxRows) : (firstJobs.length === pageSize ? maxRows : firstJobs.length);
  const offsets = [];
  for (let offset = pageSize; offset < totalRows; offset += pageSize) offsets.push(offset);
  const pages = await mapSettledWithConcurrency(offsets, ATS_PAGE_FETCH_CONCURRENCY, async (offset) => {
    const payload = await fetchJson(setUrlSearchParams(baseUrl, { limit: pageSize, offset }));
    return firstArray(payload?.content, payload?.postings, payload);
  });
  assertCompleteAtsPages('SmartRecruiters', pages);
  for (const page of pages) {
    jobs.push(...page.value);
  }
  return { jobs };
}

async function fetchJobviteJobs(config, boardId) {
  const url = getJobviteBoardUrl(config, boardId);
  const content = await fetchText(url, 15000);
  return { jobs: parseJobviteJobs(content, url) };
}

async function fetchWorkdayJobs(config) {
  const descriptor = getWorkdayDescriptor(config);
  if (!descriptor) return { jobs: [] };
  const url = descriptor.apiUrl;
  const pageSize = 20;
  const readPage = async (offset) => {
    const payload = await fetchJson(url, 15000, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: pageSize, offset, searchText: '' }),
    });
    return {
      jobs: firstArray(payload?.jobPostings, payload?.jobs, payload?.data?.children),
      total: Number(payload?.total || payload?.totalResults || payload?.count || 0),
    };
  };

  const firstPage = await readPage(0);
  const jobs = [...firstPage.jobs];
  const maxRows = pageSize * DEFAULT_WORKDAY_MAX_PAGES;
  const totalRows = firstPage.total > 0 ? Math.min(firstPage.total, maxRows) : (firstPage.jobs.length === pageSize ? maxRows : firstPage.jobs.length);
  const offsets = [];
  for (let offset = pageSize; offset < totalRows; offset += pageSize) offsets.push(offset);
  const pages = await mapSettledWithConcurrency(offsets, ATS_PAGE_FETCH_CONCURRENCY, readPage);
  assertCompleteAtsPages('Workday', pages);
  for (const page of pages) {
    jobs.push(...page.value.jobs);
  }
  return { jobs };
}

async function fetchBamboohrJobs(config, boardId) {
  const url = getBambooCareersApiUrl(config, boardId);
  const payload = await fetchJson(url);
  return { jobs: firstArray(payload?.result, payload?.jobs, payload) };
}

async function fetchWorkableJobs(config, boardId) {
  const url = getWorkableJobsApiUrl(config, boardId);
  const payload = await fetchJson(url);
  return { jobs: firstArray(payload?.jobs, payload) };
}

async function fetchRecruiteeJobs(config, boardId) {
  const url = getRecruiteeJobsApiUrl(config, boardId);
  const payload = await fetchJson(url);
  return { jobs: firstArray(payload?.offers, payload?.jobs, payload) };
}

async function fetchPersonioJobs(config, boardId) {
  const url = getPersonioJobsFeedUrl(config, boardId);
  const content = await fetchText(url, 15000);
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    processEntities: false,
    trimValues: true,
  });
  const payload = parser.parse(content);
  const positions = payload?.['workzag-jobs']?.position;
  return { jobs: Array.isArray(positions) ? positions : (positions ? [positions] : []) };
}

async function fetchRipplingJobs(config, boardId) {
  const boardUrl = getRipplingBoardUrl(config, boardId);
  const content = await fetchText(boardUrl, 15000);
  const scriptMatch = content.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!scriptMatch?.[1]) return { jobs: [] };

  const payload = JSON.parse(scriptMatch[1]);
  const queries = payload?.props?.pageProps?.dehydratedState?.queries;
  const jobs = [];
  const seen = new Set();
  for (const query of Array.isArray(queries) ? queries : []) {
    const data = query?.state?.data;
    const items = firstArray(data?.items, data?.jobs, data?.results);
    for (const item of items) {
      const id = String(item?.id || item?.url || '');
      const title = item?.name || item?.title || '';
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      jobs.push({
        ...item,
        title,
        location: firstString((Array.isArray(item.locations) ? item.locations : []).map((location) => location?.name)) || '',
        department: item.department?.name || item.department || '',
        jobUrl: item.url || '',
      });
    }
  }
  return { jobs };
}

function getWorkableJobsApiUrl(config = {}, boardId = '') {
  const apiUrl = String(config.apiUrl || '');
  if (/workable\.com\/api\/accounts\//i.test(apiUrl)) return setUrlSearchParams(apiUrl, { details: 'true' });
  return `https://www.workable.com/api/accounts/${encodeURIComponent(boardId)}?details=true`;
}

function getJobviteBoardUrl(config = {}, boardId = '') {
  const jobviteUrl = getConfigUrlCandidates(config).find((value) => /jobs\.jobvite\.com/i.test(value) && !/\/api\/job-list/i.test(value));
  if (jobviteUrl) {
    try {
      const parsed = new URL(jobviteUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const careersIndex = segments.findIndex((segment) => segment.toLowerCase() === 'careers');
      const slug = careersIndex >= 0 ? segments[careersIndex + 1] : segments[0];
      if (slug && !['api', 'careers'].includes(slug.toLowerCase())) {
        return `https://jobs.jobvite.com/${encodeURIComponent(slug)}/jobs`;
      }
    } catch {
      // Fall through to the board identifier.
    }
  }
  return `https://jobs.jobvite.com/${encodeURIComponent(boardId)}/jobs`;
}

function getRecruiteeJobsApiUrl(config = {}, boardId = '') {
  const apiUrl = String(config.apiUrl || '');
  if (/\.recruitee\.com\/api\/offers\/?/i.test(apiUrl)) return apiUrl;
  return `https://${encodeURIComponent(boardId)}.recruitee.com/api/offers/`;
}

function getPersonioJobsFeedUrl(config = {}, boardId = '') {
  const personioUrl = getConfigUrlCandidates(config).find((value) => /\.jobs\.personio\.de/i.test(value));
  if (personioUrl) {
    try {
      const parsed = new URL(personioUrl);
      parsed.pathname = '/xml';
      if (!parsed.searchParams.has('language')) parsed.searchParams.set('language', 'en');
      return parsed.toString();
    } catch {
      // Fall through to the account subdomain.
    }
  }
  return `https://${encodeURIComponent(boardId)}.jobs.personio.de/xml?language=en`;
}

function getPersonioCareerOrigin(config = {}, boardId = '') {
  try {
    return new URL(getPersonioJobsFeedUrl(config, boardId)).origin;
  } catch {
    return `https://${encodeURIComponent(boardId)}.jobs.personio.de`;
  }
}

function getRipplingBoardUrl(config = {}, boardId = '') {
  const ripplingUrl = getConfigUrlCandidates(config).find((value) => /ats\.rippling\.com/i.test(value));
  if (ripplingUrl) {
    try {
      const parsed = new URL(ripplingUrl);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const jobsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'jobs');
      if (jobsIndex > 0) {
        parsed.pathname = `/${segments.slice(0, jobsIndex + 1).join('/')}`;
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
      }
    } catch {
      // Fall through to the standard board URL.
    }
  }
  return `https://ats.rippling.com/${encodeURIComponent(boardId)}/jobs`;
}

function getBambooCareersApiUrl(config = {}, boardId = '') {
  const bambooUrl = getConfigUrlCandidates(config).find((value) => /\.bamboohr\.com/i.test(value));
  if (bambooUrl) {
    try {
      const parsed = new URL(bambooUrl);
      return `${parsed.origin}/careers/list`;
    } catch {
      // Fall through to the board subdomain.
    }
  }
  return `https://${encodeURIComponent(boardId)}.bamboohr.com/careers/list`;
}

async function fetchStaticCareersJobs(config) {
  const url = config.apiUrl || config.sourceUrl || config.resolvedBoardUrl || config.careersUrl || config.boardUrl || config.url;
  if (!url) return { jobs: [] };
  const content = await fetchText(url, DEFAULT_ATS_CAREERS_SCRAPE_TIMEOUT_MS);
  return { jobs: parseStaticCareersJobs(content, url) };
}

async function fetchJson(url, timeoutMs = 15000, init = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= ATS_JSON_REQUEST_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: 'application/json',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent': 'Mozilla/5.0 (compatible; BD-Engine/1.0; +https://bd-engine-production.up.railway.app/)',
          ...(init.headers || {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`ATS request failed with HTTP ${response.status}`);
        error.retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        error.retryAfterMs = readRetryAfterMs(response);
        throw error;
      }

      const body = await response.text();
      try {
        return JSON.parse(body);
      } catch {
        const contentType = response.headers.get('content-type') || 'unknown content type';
        const returnedHtml = /^\s*</.test(body);
        const error = new Error(returnedHtml
          ? `ATS returned HTML instead of JSON (${contentType})`
          : `ATS returned invalid JSON (${contentType})`);
        error.retryable = returnedHtml && /\.myworkdayjobs\.com\b/i.test(String(url));
        throw error;
      }
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable === true || error?.name === 'AbortError' || error?.cause?.code === 'ECONNRESET';
      if (!retryable || attempt === ATS_JSON_REQUEST_ATTEMPTS) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await waitForAtsRetry(lastError, attempt);
  }
  throw lastError || new Error('ATS request failed');
}

async function fetchText(url, timeoutMs = 15000) {
  return (await fetchTextPage(url, timeoutMs)).content;
}

async function fetchTextPage(url, timeoutMs = 15000) {
  let lastError = null;
  for (let attempt = 1; attempt <= ATS_JSON_REQUEST_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xml,text/xml,application/json',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent': 'Mozilla/5.0 (compatible; BD-Engine/1.0; +https://bd-engine-production.up.railway.app/)',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`ATS request failed with HTTP ${response.status}`);
        error.retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
        error.retryAfterMs = readRetryAfterMs(response);
        throw error;
      }
      return {
        content: await response.text(),
        finalUrl: response.url || String(url),
      };
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable === true || error?.name === 'AbortError' || error?.cause?.code === 'ECONNRESET';
      if (!retryable || attempt === ATS_JSON_REQUEST_ATTEMPTS) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await waitForAtsRetry(lastError, attempt);
  }
  throw lastError || new Error('ATS request failed');
}

function assertCompleteAtsPages(providerName, pages) {
  const failedPages = pages.filter((page) => page.status === 'rejected');
  if (!failedPages.length) return;
  const error = new Error(`${providerName} could not load every results page. Retry the refresh; existing jobs were preserved.`);
  error.cause = failedPages[0].reason;
  throw error;
}

function readRetryAfterMs(response) {
  const value = response?.headers?.get?.('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10000, seconds * 1000);
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return null;
  return Math.min(10000, Math.max(0, retryAt - Date.now()));
}

async function waitForAtsRetry(error, attempt) {
  const retryAfterMs = error?.retryAfterMs == null ? Number.NaN : Number(error.retryAfterMs);
  const delayMs = Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : 200 * attempt;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function setUrlSearchParams(value, params = {}) {
  const parsed = new URL(value);
  for (const [key, nextValue] of Object.entries(params)) parsed.searchParams.set(key, String(nextValue));
  return parsed.toString();
}

async function mapSettledWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), Math.max(1, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      try {
        results[currentIndex] = {
          status: 'fulfilled',
          value: await mapper(items[currentIndex], currentIndex),
        };
      } catch (reason) {
        results[currentIndex] = { status: 'rejected', reason };
      }
    }
  }));
  return results;
}

function parseBamboohrJobs(content) {
  const text = String(content || '');
  const jsonMatches = [
    text.match(/"result"\s*:\s*(\[[\s\S]*?\])\s*[,}]/),
    text.match(/"jobs"\s*:\s*(\[[\s\S]*?\])\s*[,}]/),
  ];
  for (const match of jsonMatches) {
    if (!match?.[1]) continue;
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Keep trying other embedded shapes.
    }
  }
  return [];
}

async function discoverAtsBoard(config) {
  const knownAtsType = getConfigAtsType(config);
  const atsTypes = BLIND_PROBE_ATS_TYPES.includes(knownAtsType)
    ? [knownAtsType, ...BLIND_PROBE_ATS_TYPES.filter((item) => item !== knownAtsType)]
    : BLIND_PROBE_ATS_TYPES;
  const candidates = buildBoardCandidates(config);
  const isUnreviewedNameProbe = config.discoveryMethod === 'public_ats_probe'
    && normalizeKey(config.reviewStatus) !== 'approved';
  const trustedUrlCandidates = isUnreviewedNameProbe
    ? [config.careersUrl, config.sourceUrl, config.boardUrl, config.url].filter(Boolean)
    : getConfigUrlCandidates(config);
  const hasTrustedCareerIdentity = Boolean(getUsableCompanyDomain(config.domain || config.canonicalDomain))
    || trustedUrlCandidates.some((value) => Boolean(getUsableCareerUrl(value)));

  if (hasTrustedCareerIdentity) {
    const linkedBoard = await discoverAtsBoardFromCareersPages(config);
    if (linkedBoard) return linkedBoard;
  }

  for (const boardId of candidates) {
    const probes = await mapSettledWithConcurrency(atsTypes, ATS_DISCOVERY_PROBE_CONCURRENCY, async (atsType) => ({
      atsType,
      result: await probeAtsBoard(atsType, boardId),
    }));
    const match = probes.find((probe) => probe.status === 'fulfilled' && probe.value.result)?.value;
    if (match) {
      return {
        atsType: match.atsType,
        boardId,
        apiUrl: match.result.apiUrl,
        resolvedBoardUrl: match.result.resolvedBoardUrl,
        jobCount: match.result.jobCount,
        method: 'public_ats_probe',
      };
    }
  }
  if (!hasTrustedCareerIdentity) {
    const guessedCareerMatch = await discoverAtsBoardFromCareersPages(config);
    return guessedCareerMatch ? { ...guessedCareerMatch, requiresReview: true } : null;
  }
  return null;
}

function buildBoardCandidates(config) {
  const candidates = [];
  const add = (value, { preserve = false } = {}) => {
    const cleaned = String(value || '').trim().toLowerCase();
    if (!cleaned) return;
    const compact = cleaned.replace(/[^a-z0-9]/g, '');
    if (preserve && !candidates.includes(cleaned)) candidates.push(cleaned);
    if (compact && !candidates.includes(compact)) candidates.push(compact);
  };
  const directBoardId = getConfigBoardId(config);
  const hasDirectAtsEvidence = Boolean(getConfigAtsUrl(config)) || ATS_FETCHERS.has(normalizeAtsType(config.atsType || config.ats));
  if (!['unknown', 'n/a', 'none'].includes(normalizeKey(directBoardId))) add(directBoardId, { preserve: hasDirectAtsEvidence });
  const domain = getUsableCompanyDomain(config.domain || config.canonicalDomain);
  const domainRoot = domain.split('.')[0] || '';
  add(domainRoot, { preserve: true });
  const companyName = normalizeKey(config.companyName);
  if (!isGenericCompanyIdentity(companyName)) {
    add(companyName);
    add(companyName.replace(/\([^)]*\)/g, ''));
    add(companyName.replace(/\b(inc|incorporated|corp|corporation|ltd|limited|llc|co|company|technologies|technology|systems|solutions|group|holdings|international)\b/g, ''));
    const acronym = String(config.companyName || '').match(/\(([A-Za-z0-9-]{2,12})\)/)?.[1];
    add(acronym);
  }
  return candidates.filter((value) => value.length >= 2).slice(0, 5);
}

async function discoverAtsBoardFromCareersPages(config) {
  const urls = buildCareerPageUrls(config);
  const batchSize = 3;
  for (let offset = 0; offset < urls.length; offset += batchSize) {
    const batch = urls.slice(offset, offset + batchSize);
    const results = await mapSettledWithConcurrency(batch, batchSize, async (url, batchIndex) => {
      const page = await fetchTextPage(url, DEFAULT_ATS_CAREERS_SCRAPE_TIMEOUT_MS);
      const directResult = await inspectCareerPage(config, page, url, 'careers_page_link');
      if (directResult) return directResult;

      // Rendering is intentionally bounded to the highest-confidence URL for
      // each company. A renderer is optional and receives public careers URLs
      // only; ordinary provider imports never depend on it.
      if (offset === 0 && batchIndex === 0 && ATS_RENDER_SERVICE_URL) {
        const renderedPage = await fetchRenderedCareerPage(url);
        if (renderedPage) {
          return inspectCareerPage(config, renderedPage, url, 'rendered_careers_page');
        }
      }
      return null;
    });
    const match = results.find((result) => result.status === 'fulfilled' && result.value)?.value;
    if (match) return match;
  }
  return null;
}

async function inspectCareerPage(config, page, requestedUrl, method) {
  const finalUrl = page?.finalUrl || requestedUrl;
  const atsLinks = [];
  if (detectAtsTypeFromUrl(finalUrl)) atsLinks.push(finalUrl);
  for (const atsUrl of extractAtsLinks(page?.content || '', finalUrl)) {
    if (!atsLinks.includes(atsUrl)) atsLinks.push(atsUrl);
  }
  for (const atsUrl of atsLinks) {
    const result = await probeAtsUrl(config, atsUrl);
    if (result) return { ...result, method };
  }

  const staticJobs = parseStaticCareersJobs(page?.content || '', finalUrl);
  if (staticJobs.length < STATIC_CAREERS_MIN_JOB_LINKS) return null;
  const boardId = getConfigBoardId(config) || getStaticCareersBoardId(config, finalUrl);
  return {
    atsType: 'custom_static',
    boardId,
    apiUrl: finalUrl,
    resolvedBoardUrl: finalUrl,
    jobCount: staticJobs.length,
    method: method === 'rendered_careers_page' ? method : 'static_careers_page',
  };
}

async function fetchRenderedCareerPage(url) {
  const target = getUsableCareerUrl(url);
  if (!target || !ATS_RENDER_SERVICE_URL) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATS_RENDER_TIMEOUT_MS);
  try {
    const response = await fetch(ATS_RENDER_SERVICE_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json,text/html',
        'content-type': 'application/json',
        ...(ATS_RENDER_SERVICE_TOKEN ? { authorization: `Bearer ${ATS_RENDER_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        url: target,
        waitUntil: 'networkidle',
        timeoutMs: ATS_RENDER_TIMEOUT_MS,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (/json/i.test(contentType)) {
      const payload = await response.json();
      const content = String(payload?.html || payload?.content || payload?.body || '');
      if (!content) return null;
      return { content, finalUrl: payload?.finalUrl || payload?.url || target };
    }
    const content = await response.text();
    return content ? { content, finalUrl: target } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Turn a company name into plausible domains to try when no domain is known.
// Most LinkedIn-imported accounts have no domain/email, so this is the only way
// to reach their careers page and detect the ATS. Skips names too short/generic
// to yield a meaningful domain.
function guessDomainsFromName(companyName) {
  if (isGenericCompanyIdentity(companyName)) return [];
  const literalDomain = getUsableCompanyDomain(companyName);
  const words = normalizeKey(companyName)
    .replace(/\b(inc|incorporated|corp|corporation|ltd|limited|llc|co|company|technologies|technology|systems|solutions|group|holdings|the|a|of|and)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const slug = words.join('');
  if (slug.length < 3) return literalDomain ? [literalDomain] : [];
  const acronym = words.length >= 2 && words.length <= 8 ? words.map((word) => word[0]).join('') : '';
  const firstWord = words[0] || '';
  const firstTwo = words.slice(0, 2).join('');
  return [...new Set([
    literalDomain,
    `${slug}.com`,
    acronym.length >= 2 ? `${acronym}.com` : '',
    firstTwo !== slug && firstTwo.length >= 4 ? `${firstTwo}.com` : '',
    firstWord !== slug && firstWord.length >= 4 ? `${firstWord}.com` : '',
    `${slug}.ca`,
    acronym.length >= 2 ? `${acronym}.ca` : '',
    `${slug}.io`,
  ].filter(Boolean))].slice(0, 8);
}

function isGenericCompanyIdentity(value) {
  const normalized = normalizeKey(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.replace(/[^a-z0-9]/g, '').length < 2) return true;
  return /^(confidential( company)?|independent contractor|n a|nda( .*)?|not disclosed|private company|self employed|stealth( company| startup)?|undisclosed( company)?|freelance|freelancer)$/.test(normalized);
}

function buildCareerPageUrls(config = {}) {
  const urls = [];
  const add = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    try {
      const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      parsed.hash = '';
      const normalized = parsed.toString();
      if (!urls.includes(normalized)) urls.push(normalized);
    } catch {
      // Ignore malformed URLs.
    }
  };
  const untrustedNameProbe = config.discoveryMethod === 'public_ats_probe'
    && normalizeKey(config.reviewStatus || '') !== 'approved';
  const directCareerSources = untrustedNameProbe
    ? [config.careersUrl, config.sourceUrl, config.boardUrl, config.url]
    : getConfigUrlCandidates(config);
  for (const source of directCareerSources) add(getUsableCareerUrl(source));
  const knownDomain = getUsableCompanyDomain(config.domain || config.canonicalDomain);
  const domains = knownDomain ? [knownDomain] : guessDomainsFromName(config.companyName);
  // Companies host careers on both paths (/careers) and subdomains
  // (careers.co, jobs.co) — measured that ~half of loadable sites hid the ATS
  // because only the paths were tried. Subdomains first since they more often
  // point straight at the ATS.
  for (const domain of domains) {
    add(`https://careers.${domain}`);
    add(`https://${domain}/careers`);
    add(`https://${domain}/careers/jobs`);
    add(`https://jobs.${domain}`);
    add(`https://${domain}/jobs`);
    if (knownDomain) {
      add(`https://${domain}/join-us`);
      add(`https://${domain}/open-positions`);
      add(`https://${domain}/company/careers`);
      add(`https://${domain}/about/careers`);
      add(`https://${domain}/job-openings`);
    }
  }
  // Known domain gets a deeper crawl; guessed domains are capped so a batch of
  // unresolved companies does not explode into hundreds of blind fetches.
  return urls.slice(0, knownDomain ? 12 : 15);
}

function extractAtsLinks(content, baseUrl = '') {
  const text = decodeHtmlEntities(String(content || ''))
    .replace(/\\u002f/gi, '/')
    .replace(/\\u003a/gi, ':')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"');
  const candidates = [];
  const add = (value) => {
    const raw = String(value || '').trim().replace(/\\+$/g, '');
    if (!raw) return;
    try {
      const parsed = new URL(raw, baseUrl || undefined);
      parsed.hash = '';
      const normalized = parsed.toString();
      if (detectAtsTypeFromUrl(normalized) && !candidates.includes(normalized)) candidates.push(normalized);
    } catch {
      // Ignore malformed extracted values.
    }
  };
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s"'<>]+/gi)) add(match[0]);
  for (const match of text.matchAll(/(?:^|[\s"'(])\/\/(?:[^\s"'<>]*\.)?(?:greenhouse\.io|lever\.co|ashbyhq\.com|smartrecruiters\.com|jobvite\.com|myworkdayjobs\.com|bamboohr\.com|workable\.com|recruitee\.com|personio\.de|rippling\.com)[^\s"'<>]*/gi)) {
    add(`https:${match[0].trim().replace(/^["'(]/, '')}`);
  }
  for (const match of text.matchAll(/\b(?:href|src|data-url)=["']([^"']+)["']/gi)) add(match[1]);
  return candidates.slice(0, 12);
}

function parseJobviteJobs(content, sourceUrl = '') {
  const jobs = [];
  const seen = new Set();
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const rowMatch of String(content || '').matchAll(rowPattern)) {
    const row = rowMatch[1] || '';
    const nameCell = row.match(/<td\b[^>]*class=["'][^"']*jv-job-list-name[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || '';
    const locationCell = row.match(/<td\b[^>]*class=["'][^"']*jv-job-list-location[^"']*["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] || '';
    const anchor = nameCell.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const url = normalizeAbsoluteUrl(anchor[1], sourceUrl);
    const title = cleanHtmlText(anchor[2]);
    if (!url || !title) continue;
    const id = extractJobIdFromUrl(url);
    if (seen.has(id)) continue;
    seen.add(id);
    jobs.push({
      id,
      title,
      location: cleanHtmlText(locationCell),
      jobUrl: url,
      url,
    });
  }
  return jobs;
}

function parseStaticCareersJobs(content, sourceUrl = '') {
  const jobs = [];
  const seen = new Set();
  const addJob = (item = {}) => {
    const title = cleanHtmlText(item.title || item.name || '');
    const url = normalizeAbsoluteUrl(item.url || item.jobUrl || item.applyUrl || '', sourceUrl);
    if (!title || !url || isGenericCareersLink(title, url)) return;
    const key = `${normalizeKey(title)}|${normalizeKey(url)}`;
    if (seen.has(key)) return;
    seen.add(key);
    jobs.push({
      id: item.id || extractJobIdFromUrl(url) || key,
      title,
      location: cleanHtmlText(item.location || ''),
      department: cleanHtmlText(item.department || ''),
      employmentType: cleanHtmlText(item.employmentType || ''),
      url,
      postedAt: item.postedAt || '',
      sourceUrl,
    });
  };

  for (const item of extractJsonLdJobs(content, sourceUrl)) addJob(item);

  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of String(content || '').matchAll(anchorPattern)) {
    const attrs = match[1] || '';
    const href = readHtmlAttribute(attrs, 'href');
    const url = normalizeAbsoluteUrl(href, sourceUrl);
    if (!url || !looksLikeStaticJobUrl(url)) continue;
    const text = cleanHtmlText(match[2] || '');
    if (!text || isGenericCareersLink(text, url)) continue;
    const parsed = splitStaticJobText(text, url);
    addJob({
      id: extractJobIdFromUrl(url),
      title: parsed.title,
      department: parsed.department,
      location: parsed.location,
      url,
    });
    if (jobs.length >= STATIC_CAREERS_MAX_JOBS) break;
  }

  return jobs.slice(0, STATIC_CAREERS_MAX_JOBS);
}

function extractJsonLdJobs(content, sourceUrl = '') {
  const jobs = [];
  for (const match of String(content || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]));
      const nodes = flattenJsonLd(parsed);
      for (const node of nodes) {
        const type = Array.isArray(node?.['@type']) ? node['@type'].join(' ') : String(node?.['@type'] || '');
        if (!/JobPosting/i.test(type)) continue;
        const locationValue = node.jobLocation || node.applicantLocationRequirements || '';
        jobs.push({
          title: node.title || node.name || '',
          location: readJsonLdLocation(locationValue),
          department: node.industry || node.occupationalCategory || '',
          employmentType: Array.isArray(node.employmentType) ? node.employmentType.join(', ') : node.employmentType || '',
          url: node.url || node.sameAs || sourceUrl,
          postedAt: node.datePosted || '',
        });
      }
    } catch {
      // Ignore malformed structured data and continue with link parsing.
    }
  }
  return jobs;
}

function flattenJsonLd(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value['@graph']) return flattenJsonLd(value['@graph']);
  return [value];
}

function readJsonLdLocation(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(readJsonLdLocation).filter(Boolean).join('; ');
  if (typeof value === 'string') return value;
  const address = value.address || value;
  if (typeof address === 'string') return address;
  return [
    address.addressLocality,
    address.addressRegion,
    address.addressCountry?.name || address.addressCountry,
  ].filter(Boolean).join(', ');
}

function splitStaticJobText(text, url) {
  let title = cleanHtmlText(text);
  let location = '';
  let department = '';
  try {
    const parsed = new URL(url);
    location = cleanHtmlText(parsed.searchParams.get('office') || parsed.searchParams.get('location') || '');
  } catch {
    // Keep empty location.
  }

  if (location) {
    const escaped = escapeRegExp(location);
    title = title.replace(new RegExp(`\\s+${escaped}$`, 'i'), '').trim();
  }

  const departments = [
    'Sales',
    'Technology',
    'Customers',
    'Operations',
    'Marketing',
    'Product',
    'Finance',
    'People',
    'People & Culture',
    'Engineering',
    'Design',
    'Legal',
  ];
  for (const candidate of departments) {
    const escaped = escapeRegExp(candidate);
    if (new RegExp(`\\s+${escaped}$`, 'i').test(title)) {
      department = candidate;
      title = title.replace(new RegExp(`\\s+${escaped}$`, 'i'), '').trim();
      break;
    }
  }

  return { title, department, location };
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&eacute;/g, 'e')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function readHtmlAttribute(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] || '';
}

function normalizeAbsoluteUrl(value, baseUrl = '') {
  const raw = String(value || '').trim();
  if (!raw || raw === '#') return '';
  try {
    const parsed = new URL(raw, baseUrl || undefined);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizePublicHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function looksLikeStaticJobUrl(url) {
  const parsed = new URL(url);
  const path = parsed.pathname.toLowerCase();
  if (/\/careers\/job\//.test(path)) return true;
  if (/\/jobs\/[^/]+/.test(path) && !/\/jobs\/?(search|alerts?|categories?)?\/?$/.test(path)) return true;
  if (/\/careers\/[^/]+\/[a-f0-9-]{16,}/.test(path)) return true;
  return false;
}

function isGenericCareersLink(title, url) {
  const normalizedTitle = normalizeKey(title).replace(/[^a-z0-9 ]/g, '').trim();
  if (!normalizedTitle || normalizedTitle.length < 4) return true;
  if ([
    'career',
    'careers',
    'job',
    'jobs',
    'openings',
    'departments',
    'locations',
    'culture',
    'how we hire',
    'us en',
    'ca en',
  ].includes(normalizedTitle)) return true;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (/\/careers\/openings\/?$/.test(path) || /\/careers\/?$/.test(path) || /\/jobs\/?$/.test(path)) return true;
  } catch {
    return true;
  }
  return false;
}

function extractJobIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    const idMatch = parsed.pathname.match(/\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/?$/i);
    if (idMatch) return idMatch[1];
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || url;
  } catch {
    return url;
  }
}

function getStaticCareersBoardId(config = {}, url = '') {
  const domain = String(config.domain || config.canonicalDomain || '').replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
  if (domain) return domain.split('.')[0] || domain;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '').split('.')[0] || 'static-careers';
  } catch {
    return normalizeKey(config.companyName || 'static-careers').replace(/[^a-z0-9]/g, '') || 'static-careers';
  }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function probeAtsUrl(config, atsUrl) {
  const atsType = detectAtsTypeFromUrl(atsUrl);
  if (!ATS_FETCHERS.has(atsType)) return null;
  const tempConfig = {
    ...config,
    atsType,
    ats: atsType,
    sourceUrl: atsUrl,
    boardUrl: atsUrl,
    careersUrl: atsUrl,
    resolvedBoardUrl: atsUrl,
  };
  const boardId = getConfigBoardId(tempConfig);
  if (!boardId) return null;
  if (['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jobvite', 'recruitee', 'personio', 'rippling'].includes(atsType)) {
    const probed = await probeAtsBoard(atsType, boardId);
    if (probed) {
      return {
        atsType,
        boardId,
        apiUrl: probed.apiUrl,
        resolvedBoardUrl: probed.resolvedBoardUrl,
        jobCount: probed.jobCount,
        method: 'careers_page_link',
      };
    }
  }
  if (atsType === 'workday') {
    const descriptor = getWorkdayDescriptor(tempConfig);
    if (!descriptor) return null;
    // Validate the descriptor actually returns jobs — a malformed tenant/site
    // parse otherwise resolves a board that fetches nothing.
    let jobCount;
    try {
      const payload = await fetchJson(descriptor.apiUrl, 8000, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
      });
      jobCount = Array.isArray(payload?.jobPostings) ? payload.jobPostings.length : 0;
    } catch {
      return null;
    }
    if (jobCount === 0) return null;
    return {
      atsType,
      boardId,
      apiUrl: descriptor.apiUrl,
      resolvedBoardUrl: descriptor.resolvedBoardUrl,
      jobCount,
      method: 'careers_page_link',
    };
  }
  if (atsType === 'bamboohr') {
    const apiUrl = getBambooCareersApiUrl(tempConfig, boardId);
    try {
      const payload = await fetchJson(apiUrl, 8000);
      const jobs = firstArray(payload?.result, payload?.jobs, payload);
      if (!jobs.length) return null;
      return {
        atsType,
        boardId,
        apiUrl,
        resolvedBoardUrl: apiUrl.replace(/\/careers\/list\/?$/i, '/careers'),
        jobCount: jobs.length,
        method: 'careers_page_link',
      };
    } catch {
      return null;
    }
  }
  if (atsType === 'workable') {
    const apiUrl = getWorkableJobsApiUrl(tempConfig, boardId);
    try {
      const payload = await fetchJson(apiUrl, 8000);
      const jobs = firstArray(payload?.jobs, payload);
      if (!jobs.length) return null;
      return {
        atsType,
        boardId,
        apiUrl,
        resolvedBoardUrl: `https://apply.workable.com/${encodeURIComponent(boardId)}/`,
        jobCount: jobs.length,
        method: 'careers_page_link',
      };
    } catch {
      return null;
    }
  }
  return null;
}

async function probeAtsBoard(atsType, boardId) {
  const encoded = encodeURIComponent(boardId);
  if (atsType === 'jobvite') {
    const resolvedBoardUrl = `https://jobs.jobvite.com/${encoded}/jobs`;
    try {
      const result = await fetchJobviteJobs({ resolvedBoardUrl }, boardId);
      if (!result.jobs.length) return null;
      return {
        apiUrl: resolvedBoardUrl,
        resolvedBoardUrl,
        jobCount: result.jobs.length,
      };
    } catch {
      return null;
    }
  }
  if (atsType === 'personio') {
    const apiUrl = `https://${encoded}.jobs.personio.de/xml?language=en`;
    try {
      const result = await fetchPersonioJobs({ apiUrl }, boardId);
      if (!result.jobs.length) return null;
      return {
        apiUrl,
        resolvedBoardUrl: `https://${encoded}.jobs.personio.de/`,
        jobCount: result.jobs.length,
      };
    } catch {
      return null;
    }
  }
  if (atsType === 'rippling') {
    const resolvedBoardUrl = `https://ats.rippling.com/${encoded}/jobs`;
    try {
      const result = await fetchRipplingJobs({ resolvedBoardUrl }, boardId);
      if (!result.jobs.length) return null;
      return {
        apiUrl: resolvedBoardUrl,
        resolvedBoardUrl,
        jobCount: result.jobs.length,
      };
    } catch {
      return null;
    }
  }
  const endpoints = {
    greenhouse: {
      apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encoded}/jobs`,
      resolvedBoardUrl: `https://boards.greenhouse.io/${encoded}`,
      readJobs: (payload) => payload?.jobs,
    },
    lever: {
      apiUrl: `https://api.lever.co/v0/postings/${encoded}?mode=json`,
      resolvedBoardUrl: `https://jobs.lever.co/${encoded}`,
      readJobs: (payload) => payload,
    },
    ashby: {
      apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${encoded}`,
      resolvedBoardUrl: `https://jobs.ashbyhq.com/${encoded}`,
      readJobs: (payload) => payload?.jobs,
    },
    smartrecruiters: {
      apiUrl: `https://api.smartrecruiters.com/v1/companies/${encoded}/postings?limit=1`,
      resolvedBoardUrl: `https://careers.smartrecruiters.com/${encoded}`,
      readJobs: (payload) => payload?.content || payload?.postings,
    },
    recruitee: {
      apiUrl: `https://${encoded}.recruitee.com/api/offers/`,
      resolvedBoardUrl: `https://${encoded}.recruitee.com/`,
      readJobs: (payload) => payload?.offers || payload?.jobs || payload,
    },
  };
  const endpoint = endpoints[atsType];
  if (!endpoint) return null;
  try {
    const payload = await fetchJson(endpoint.apiUrl, 6000);
    const jobs = endpoint.readJobs(payload);
    // Require ACTUAL jobs, not just a 200 with an empty array. SmartRecruiters
    // (and others) return 200 {content:[]} for any invalid slug, so accepting
    // an empty array falsely "resolves" thousands of non-existent boards that
    // then fetch zero jobs.
    if (!Array.isArray(jobs) || jobs.length === 0) return null;
    return {
      apiUrl: endpoint.apiUrl,
      resolvedBoardUrl: endpoint.resolvedBoardUrl,
      jobCount: jobs.length,
    };
  } catch {
    return null;
  }
}

function findAccountForConfig(config, accountsByNormalizedName, accountsById) {
  if (config.accountId && accountsById.has(config.accountId)) return accountsById.get(config.accountId);
  const normalized = normalizeKey(config.normalizedCompanyName || config.companyName);
  return accountsByNormalizedName.get(normalized) || null;
}

function normalizeFetchedAtsJob(raw, config, accountItem, atsType) {
  const retrievedAt = now();
  const companyName = accountItem?.displayName || config.companyName || raw.company || raw.companyName || '';
  const accountId = accountItem?.id || config.accountId || '';
  if (atsType === 'greenhouse') {
    const title = raw.title || raw.name || '';
    if (!title) return null;
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location: raw.location?.name || raw.location || '',
      department: firstString(raw.departments?.map((item) => item.name)) || firstString(raw.offices?.map((item) => item.name)) || '',
      atsType,
      source: 'Greenhouse',
      jobId: String(raw.id || raw.internal_job_id || ''),
      naturalKey: makeJobNaturalKey(config, atsType, raw.id || raw.internal_job_id || title, raw.location?.name || ''),
      jobUrl: raw.absolute_url || raw.url || '',
      url: raw.absolute_url || raw.url || '',
      postedAt: raw.first_published || raw.updated_at || raw.created_at || retrievedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(raw.first_published || raw.updated_at || retrievedAt) <= 7,
      isGta: isGtaLocation(raw.location?.name || ''),
    };
  }
  if (atsType === 'lever') {
    const title = raw.text || raw.title || '';
    if (!title) return null;
    const location = raw.categories?.location || raw.location || '';
    const postedAt = raw.createdAt ? new Date(Number(raw.createdAt)).toISOString() : (raw.updatedAt || retrievedAt);
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.categories?.team || raw.department || '',
      commitment: raw.categories?.commitment || '',
      atsType,
      source: 'Lever',
      jobId: String(raw.id || ''),
      naturalKey: makeJobNaturalKey(config, atsType, raw.id || title, location),
      jobUrl: raw.hostedUrl || raw.applyUrl || '',
      url: raw.hostedUrl || raw.applyUrl || '',
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'ashby') {
    const title = raw.title || '';
    if (!title) return null;
    const location = readAshbyLocation(raw.location);
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department || raw.team || '',
      employmentType: raw.employmentType || '',
      atsType,
      source: 'Ashby',
      jobId: String(raw.id || raw.jobId || ''),
      naturalKey: makeJobNaturalKey(config, atsType, raw.id || raw.jobId || title, location),
      jobUrl: raw.jobUrl || raw.applyUrl || raw.externalLink || '',
      url: raw.jobUrl || raw.applyUrl || raw.externalLink || '',
      postedAt: raw.publishedAt || raw.updatedAt || retrievedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(raw.publishedAt || retrievedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'smartrecruiters') {
    const title = raw.name || raw.title || '';
    if (!title) return null;
    const location = [raw.location?.city, raw.location?.region, raw.location?.country].filter(Boolean).join(', ') || raw.location || '';
    const postedAt = raw.releasedDate || raw.createdOn || raw.updatedOn || retrievedAt;
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department?.label || raw.department?.name || raw.department || '',
      employmentType: raw.typeOfEmployment?.label || raw.typeOfEmployment?.name || raw.typeOfEmployment || '',
      atsType,
      source: 'SmartRecruiters',
      jobId: String(raw.id || raw.ref || title),
      naturalKey: makeJobNaturalKey(config, atsType, raw.id || raw.ref || title, location),
      jobUrl: raw.ref || raw.applyUrl || raw.jobAd?.publicUrl || '',
      url: raw.ref || raw.applyUrl || raw.jobAd?.publicUrl || '',
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'jobvite') {
    const title = raw.title || raw.name || '';
    if (!title) return null;
    const location = raw.location || raw.locationName || raw.jobLocation || raw.city || '';
    const postedAt = raw.postedDate || raw.postedAt || raw.createdDate || retrievedAt;
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department || raw.category || '',
      employmentType: raw.jobType || raw.employmentType || '',
      atsType,
      source: 'Jobvite',
      jobId: String(raw.id || raw.jobId || raw.requisitionId || title),
      naturalKey: makeJobNaturalKey(config, atsType, raw.id || raw.jobId || raw.requisitionId || title, location),
      jobUrl: raw.jobUrl || raw.url || raw.applyUrl || '',
      url: raw.jobUrl || raw.url || raw.applyUrl || '',
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'workday') {
    const title = raw.title || raw.jobTitle || '';
    if (!title) return null;
    const location = raw.locationsText || raw.location || raw.locationText || '';
    const postedAt = raw.postedOn || raw.postedOnDate || raw.startDate || retrievedAt;
    const descriptor = getWorkdayDescriptor(config);
    const externalPath = raw.externalPath || raw.jobPostingUrl || raw.url || '';
    const jobUrl = externalPath && descriptor?.resolvedBoardUrl
      ? new URL(externalPath, descriptor.resolvedBoardUrl).toString()
      : externalPath;
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.jobFamily || raw.department || firstString(raw.bulletFields) || '',
      employmentType: raw.timeType || raw.workerSubType || raw.employmentType || '',
      atsType,
      source: 'Workday',
      jobId: String(raw.externalPath || raw.id || raw.jobPostingId || title),
      naturalKey: makeJobNaturalKey(config, atsType, raw.externalPath || raw.id || raw.jobPostingId || title, location),
      jobUrl,
      url: jobUrl,
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'bamboohr') {
    const title = raw.title || raw.jobTitle || raw.jobOpeningName || raw.name || '';
    if (!title) return null;
    const location = [raw.location?.city, raw.location?.state || raw.location?.province, raw.location?.country].filter(Boolean).join(', ') || (typeof raw.location === 'string' ? raw.location : '');
    const postedAt = raw.postedDate || raw.createdDate || raw.datePosted || retrievedAt;
    const jobId = raw.id || raw.jobId || raw.requisitionId || title;
    const bambooApiUrl = getBambooCareersApiUrl(config, getConfigBoardId(config));
    const jobUrl = raw.url || raw.jobUrl || raw.applyUrl
      || bambooApiUrl.replace(/\/careers\/list\/?$/i, `/careers/${encodeURIComponent(jobId)}`);
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department || raw.departmentLabel || '',
      employmentType: raw.employmentType || raw.employmentStatusLabel || raw.type || '',
      atsType,
      source: 'BambooHR',
      jobId: String(jobId),
      naturalKey: makeJobNaturalKey(config, atsType, jobId, location),
      jobUrl,
      url: jobUrl,
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'workable') {
    const title = raw.title || raw.full_title || '';
    if (!title) return null;
    const firstLocation = Array.isArray(raw.locations) ? raw.locations[0] : null;
    const location = [
      raw.city || firstLocation?.city,
      raw.state || firstLocation?.region,
      raw.country || firstLocation?.country,
    ].filter(Boolean).join(', ') || (raw.telecommuting ? 'Remote' : '');
    const postedAt = raw.published_on || raw.created_at || retrievedAt;
    const jobId = raw.shortcode || raw.id || raw.code || title;
    const jobUrl = raw.url || raw.shortlink || raw.application_url || '';
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department || raw.function || '',
      employmentType: raw.employment_type || raw.employmentType || '',
      atsType,
      source: 'Workable',
      jobId: String(jobId),
      naturalKey: makeJobNaturalKey(config, atsType, jobId, location),
      jobUrl,
      url: jobUrl,
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'recruitee') {
    const title = raw.title || raw.name || '';
    if (!title) return null;
    const location = readRecruiteeLocation(raw);
    const postedAt = raw.published_at || raw.created_at || raw.updated_at || retrievedAt;
    const jobId = raw.id || raw.slug || title;
    const jobUrl = raw.careers_url || raw.careers_apply_url || raw.url || raw.apply_url || '';
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department || raw.department_name || '',
      employmentType: raw.employment_type || raw.employmentType || '',
      atsType,
      source: 'Recruitee',
      jobId: String(jobId),
      naturalKey: makeJobNaturalKey(config, atsType, jobId, location),
      jobUrl,
      url: jobUrl,
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'personio') {
    const title = raw.name || raw.title || '';
    if (!title) return null;
    const location = raw.office || raw.location || '';
    const postedAt = raw.createdAt || raw.created_at || retrievedAt;
    const jobId = raw.id || title;
    const jobUrl = `${getPersonioCareerOrigin(config, getConfigBoardId(config))}/job/${encodeURIComponent(jobId)}`;
    const employmentType = [raw.employmentType, raw.schedule].filter(Boolean).join(', ');
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department || raw.recruitingCategory || '',
      employmentType,
      atsType,
      source: 'Personio',
      jobId: String(jobId),
      naturalKey: makeJobNaturalKey(config, atsType, jobId, location),
      jobUrl,
      url: jobUrl,
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'rippling') {
    const title = raw.title || raw.name || '';
    if (!title) return null;
    const location = raw.location || firstString((Array.isArray(raw.locations) ? raw.locations : []).map((item) => item?.name)) || '';
    const postedAt = raw.createdAt || raw.updatedAt || retrievedAt;
    const jobId = raw.id || raw.jobUrl || raw.url || title;
    const jobUrl = raw.jobUrl || raw.url || '';
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department?.name || raw.department || '',
      employmentType: raw.employmentType || '',
      atsType,
      source: 'Rippling',
      jobId: String(jobId),
      naturalKey: makeJobNaturalKey(config, atsType, jobId, location),
      jobUrl,
      url: jobUrl,
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  if (atsType === 'custom_static') {
    const title = raw.title || raw.name || '';
    if (!title) return null;
    const location = raw.location || '';
    const postedAt = raw.postedAt || retrievedAt;
    const jobUrl = raw.url || raw.jobUrl || raw.applyUrl || '';
    return {
      tenantId: config.tenantId,
      accountId,
      configId: config.id,
      title,
      companyName,
      location,
      department: raw.department || '',
      employmentType: raw.employmentType || '',
      atsType,
      source: 'Careers Page',
      jobId: String(raw.id || jobUrl || title),
      naturalKey: makeJobNaturalKey(config, atsType, raw.id || jobUrl || title, location),
      jobUrl,
      url: jobUrl,
      postedAt,
      retrievedAt,
      importedAt: retrievedAt,
      active: true,
      isNew: daysSince(postedAt) <= 7,
      isGta: isGtaLocation(location),
    };
  }
  return null;
}

function firstString(values = []) {
  return (values || []).find((value) => String(value || '').trim()) || '';
}

function readAshbyLocation(location) {
  if (!location) return '';
  if (typeof location === 'string') return location;
  return location.name || [location.city, location.region, location.country].filter(Boolean).join(', ');
}

function makeJobNaturalKey(config, atsType, jobId, location = '') {
  return [
    config.tenantId,
    config.id || normalizeKey(config.companyName),
    atsType,
    String(jobId || '').trim() || normalizeKey(`${config.companyName}|${location}`),
  ].map((part) => normalizeKey(part)).join('|');
}

function getJobNaturalKey(item) {
  if (item.naturalKey) return item.naturalKey;
  const providerJobId = String(item.jobId || item.providerJobId || '').trim();
  const stableSource = String(item.jobUrl || item.url || item.sourceUrl || '').trim();
  return [
    item.tenantId,
    item.configId || item.accountId || normalizeKey(item.companyName),
    normalizeAtsType(item.atsType || item.source),
    providerJobId || stableSource || normalizeKey(`${item.title}|${item.location}`),
  ].map((part) => normalizeKey(part)).join('|');
}

function readRecruiteeLocation(raw = {}) {
  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const values = locations.map((location) => {
    if (typeof location === 'string') return location;
    return location?.name || [location?.city, location?.state || location?.region, location?.country].filter(Boolean).join(', ');
  }).filter(Boolean);
  if (values.length) return values.join('; ');
  if (typeof raw.location === 'string') return raw.location;
  return raw.location?.name || [raw.location?.city, raw.location?.state || raw.location?.region, raw.location?.country].filter(Boolean).join(', ');
}

function getProviderJobIdentity(item = {}) {
  const tenant = normalizeKey(item.tenantId);
  const atsType = normalizeAtsType(item.atsType || item.source);
  const jobUrl = String(item.jobUrl || item.url || '').trim();
  if (jobUrl) {
    try {
      const parsed = new URL(jobUrl.startsWith('http') ? jobUrl : `https://${jobUrl}`);
      parsed.hash = '';
      const canonicalUrl = `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}${parsed.search}`;
      return `${tenant}|${atsType}|url:${canonicalUrl}`;
    } catch {
      return `${tenant}|${atsType}|url:${jobUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
    }
  }
  const providerJobId = String(item.jobId || item.providerJobId || '').trim();
  if (!providerJobId) return '';
  return `${tenant}|${atsType}|${normalizeKey(item.companyName)}|id:${normalizeKey(providerJobId)}`;
}

function sanitizeFocusText(value) {
  return parseFocusTerms(value).slice(0, 30).join(', ').slice(0, 600);
}

function sanitizeSearchFocus(value = {}, fallback = {}) {
  const workStyle = ['any', 'remote', 'hybrid', 'onsite'].includes(normalizeKey(value.workStyle))
    ? normalizeKey(value.workStyle)
    : (['any', 'remote', 'hybrid', 'onsite'].includes(normalizeKey(fallback.workStyle)) ? normalizeKey(fallback.workStyle) : 'any');
  const minimum = Number(value.minimumRelevanceScore ?? fallback.minimumRelevanceScore ?? 45);
  return {
    targetRoles: sanitizeFocusText(value.targetRoles ?? fallback.targetRoles),
    excludedRoles: sanitizeFocusText(value.excludedRoles ?? fallback.excludedRoles),
    targetIndustries: sanitizeFocusText(value.targetIndustries ?? fallback.targetIndustries),
    workStyle,
    minimumRelevanceScore: Math.max(0, Math.min(100, Number.isFinite(minimum) ? Math.round(minimum) : 45)),
  };
}

function getSearchFocus(settingsValue = {}, personaValue = '') {
  const persona = normalizePersona(personaValue || settingsValue?.persona);
  const byPersona = settingsValue?.searchFocusByPersona || {};
  return sanitizeSearchFocus(byPersona[persona] || {});
}

function parseFocusTerms(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,;\n]+/);
  const seen = new Set();
  const terms = [];
  for (const item of source) {
    const term = normalizeSearchText(item);
    if (!term || term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseMatchesText(phrase, normalizedText) {
  const term = normalizeSearchText(phrase);
  const text = normalizeSearchText(normalizedText);
  if (!term || !text) return false;
  return ` ${text} `.includes(` ${term} `) || text.includes(term);
}

function roleMatchStrength(term, titleText, detailText) {
  const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm) return 0;
  if (phraseMatchesText(normalizedTerm, titleText)) return 60;
  if (phraseMatchesText(normalizedTerm, detailText)) return 35;
  const words = normalizedTerm.split(' ').filter((word) => word.length > 2);
  if (!words.length) return 0;
  const titleTokens = new Set(normalizeSearchText(titleText).split(' ').filter(Boolean));
  const detailTokens = new Set(normalizeSearchText(detailText).split(' ').filter(Boolean));
  const titleCoverage = words.filter((word) => titleTokens.has(word)).length / words.length;
  const detailCoverage = words.filter((word) => detailTokens.has(word)).length / words.length;
  if (titleCoverage === 1) return 52;
  if (titleCoverage >= 0.5) return 30;
  if (detailCoverage === 1) return 25;
  return 0;
}

function classifyWorkStyle(item = {}) {
  const text = normalizeSearchText([item.location, item.title, item.department, item.employmentType, item.commitment].filter(Boolean).join(' '));
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\b(remote|work from home|distributed|anywhere)\b/.test(text)) return 'remote';
  if (/\b(on site|onsite|in office|office based)\b/.test(text)) return 'onsite';
  return 'unknown';
}

function scoreJobRelevance(item = {}, accountItem = null, focusValue = {}) {
  const focus = sanitizeSearchFocus(focusValue);
  const targetRoles = parseFocusTerms(focus.targetRoles);
  const excludedRoles = parseFocusTerms(focus.excludedRoles);
  const targetIndustries = parseFocusTerms(focus.targetIndustries);
  const configured = targetRoles.length || excludedRoles.length || targetIndustries.length || focus.workStyle !== 'any';
  if (!configured) {
    return { relevanceScore: null, relevanceBand: 'unscored', relevanceReasons: ['Set a search focus to rank this role'] };
  }

  const titleText = normalizeSearchText(item.title);
  const detailText = normalizeSearchText([item.title, item.department, item.employmentType, item.commitment].filter(Boolean).join(' '));
  const excluded = excludedRoles.find((term) => phraseMatchesText(term, detailText));
  if (excluded) {
    return { relevanceScore: 5, relevanceBand: 'low', relevanceReasons: [`Excluded role: ${excluded}`] };
  }

  let score = targetRoles.length ? 5 : 25;
  const reasons = [];
  if (targetRoles.length) {
    const matches = targetRoles
      .map((term) => ({ term, strength: roleMatchStrength(term, titleText, detailText) }))
      .sort((a, b) => b.strength - a.strength);
    const best = matches[0];
    if (best?.strength) {
      score += best.strength;
      reasons.push(`Role match: ${best.term}`);
    } else {
      reasons.push('Outside target roles');
    }
  }

  const accountText = normalizeSearchText([
    accountItem?.industry,
    accountItem?.notes,
    ...(Array.isArray(accountItem?.tags) ? accountItem.tags : []),
  ].filter(Boolean).join(' '));
  const industryMatch = targetIndustries.find((term) => phraseMatchesText(term, accountText));
  if (industryMatch) {
    score += 25;
    reasons.push(`Industry match: ${industryMatch}`);
  }

  const workStyle = classifyWorkStyle(item);
  if (focus.workStyle !== 'any') {
    if (workStyle === focus.workStyle) {
      score += 10;
      reasons.push(`${focus.workStyle} preference`);
    } else if (workStyle !== 'unknown') {
      score -= 15;
      reasons.push(`${workStyle} role`);
    }
  }

  const age = daysSince(item.postedAt || item.importedAt || item.retrievedAt);
  if (age <= 7) {
    score += 10;
    reasons.push('Posted recently');
  } else if (age <= 30) {
    score += 5;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    relevanceScore: score,
    relevanceBand: score >= 70 ? 'strong' : score >= focus.minimumRelevanceScore ? 'possible' : 'low',
    relevanceReasons: reasons.slice(0, 3),
  };
}

const CANADA_COUNTRY_RE = /\b(canada|canadian)\b/i;
const US_COUNTRY_RE = /\b(us|usa|u\.s\.a?|united states(?: of america)?)\b/i;
const NORTH_AMERICA_REGION_RE = /\bnorth america\b/i;
const OTHER_REGION_RE = /\b(emea|europe|european union|uk|united kingdom|england|scotland|wales|ireland|netherlands|germany|france|spain|italy|poland|sweden|norway|denmark|finland|switzerland|austria|portugal|belgium|australia|new zealand|india|singapore|japan|china|hong kong|latin america|latam|apac|asia|africa|middle east)\b/i;
const CANADA_PROVINCE_RE = /\b(ontario|british columbia|alberta|quebec|nova scotia|manitoba|saskatchewan|new brunswick|newfoundland(?: and labrador)?|prince edward island|yukon|northwest territories|nunavut)\b/i;
const US_STATE_RE = /\b(california|new york|texas|washington|massachusetts|florida|illinois|georgia|colorado|arizona|virginia|pennsylvania|north carolina|ohio|michigan|new jersey|maryland|oregon|minnesota|tennessee|utah|district of columbia)\b/i;
const CANADA_CITY_RE = /\b(toronto|gta|mississauga|brampton|markham|vaughan|oakville|ottawa|waterloo|kitchener|hamilton|calgary|edmonton|montreal|montr\u00e9al|quebec city|halifax|winnipeg|regina|saskatoon|st\.? john'?s)\b/i;
const US_CITY_RE = /\b(seattle|boston|chicago|austin|denver|atlanta|san francisco|los angeles|new york city|miami|dallas|houston|phoenix|portland|philadelphia|detroit|minneapolis|nashville|salt lake city)\b/i;
const CANADA_CODE_RE = /,\s*(on|bc|ab|qc|ns|mb|sk|nb|pe|pei|yt|nt|nu)(?=\s*(?:,|\/|\||\)|$))/i;
const US_CODE_RE = /,\s*(ca|ny|tx|wa|ma|fl|il|ga|co|az|va|pa|nc|oh|mi|nj|md|or|mn|tn|ut|dc)(?=\s*(?:,|\/|\||\)|$))/i;
const OTHER_COUNTRY_CODE_RE = /,\s*(nl|gb|uk|ie|de|fr|es|it|pl|se|no|dk|fi|ch|at|pt|be|au|nz|in|sg|jp|cn|hk)(?=\s*(?:,|\/|\||\)|$))/i;
const NEWFOUNDLAND_CODE_RE = /\b(st\.? john'?s|corner brook|gander|newfoundland),\s*nl\b/i;

// The tenant's geographyFocus setting (e.g. "Canada + US", "Canada", "US",
// "Global") controls which job locations survive import. Defaults to Canada+US
// to match the seeded default; unrecognized values are treated as permissive so
// we never silently drop everything.
function parseGeographyFocus(geographyFocus) {
  const g = String(geographyFocus || '').toLowerCase().trim();
  if (!g) return { canada: true, us: true, other: false };
  if (/global|anywhere|worldwide|international|\ball\b|every/.test(g)) {
    return { canada: true, us: true, other: true };
  }
  const us = /\b(us|usa|u\.s\.a?|united states|america)\b/.test(g);
  const canada = /canad/.test(g);
  if (!us && !canada) return { canada: true, us: true, other: true };
  return { canada, us, other: false };
}

function classifyJobRegion(item, accountItem = null) {
  const text = [
    item.location,
    item.country,
    item.region,
    item.office,
    !item.location && accountItem?.location,
  ].filter(Boolean).join(' ').trim();
  if (!text.trim()) return 'unknown';

  const canadaCountry = CANADA_COUNTRY_RE.test(text);
  const usCountry = US_COUNTRY_RE.test(text);
  if (NORTH_AMERICA_REGION_RE.test(text)) return 'north_america';
  if (canadaCountry && usCountry) return 'north_america';
  if (canadaCountry) return 'canada';
  if (usCountry) return 'us';

  // Explicit regions take precedence over ambiguous city names and over
  // generic remote wording, such as "Victoria, Australia" or "Remote EMEA".
  if (NEWFOUNDLAND_CODE_RE.test(text)) return 'canada';
  if (OTHER_REGION_RE.test(text) || OTHER_COUNTRY_CODE_RE.test(text)) return 'other';
  if (CANADA_CODE_RE.test(text)) return 'canada';
  if (US_CODE_RE.test(text)) return 'us';
  if (CANADA_PROVINCE_RE.test(text)) return 'canada';
  if (US_STATE_RE.test(text)) return 'us';
  if (CANADA_CITY_RE.test(text)) return 'canada';
  if (US_CITY_RE.test(text)) return 'us';
  if (/remote/i.test(text)) return 'remote';
  return 'other';
}

function jobMatchesGeography(item, accountItem, allow) {
  const allowed = allow || { canada: true, us: true, other: false };
  if (allowed.canada && allowed.us && allowed.other) return true;
  switch (classifyJobRegion(item, accountItem)) {
    case 'canada': return allowed.canada;
    case 'us': return allowed.us;
    case 'north_america': return allowed.canada || allowed.us;
    case 'remote': return allowed.canada || allowed.us || allowed.other;
    case 'other': return allowed.other;
    case 'unknown': return true; // location unknown — keep rather than silently drop
    default: return true;
  }
}

function isGtaLocation(location) {
  return /\b(toronto|gta|mississauga|brampton|markham|vaughan|oakville|scarborough|north york|richmond hill)\b/i.test(String(location || ''));
}

function refreshAccountHiringStats(item, tenantJobs, focusValue = null) {
  const accountJobs = tenantJobs.filter((jobItem) => jobItem.accountId === item.id && jobItem.active !== false);
  const recent30 = accountJobs.filter((jobItem) => daysSince(jobItem.postedAt || jobItem.importedAt) <= 30);
  const recent90 = accountJobs.filter((jobItem) => daysSince(jobItem.postedAt || jobItem.importedAt) <= 90);
  const recent7 = accountJobs.filter((jobItem) => daysSince(jobItem.postedAt || jobItem.importedAt) <= 7);
  item.jobCount = accountJobs.length;
  item.openRoleCount = accountJobs.length;
  item.jobsLast30Days = recent30.length;
  item.jobsLast90Days = recent90.length;
  item.newRoleCount7d = recent7.length;
  const focus = focusValue ? sanitizeSearchFocus(focusValue) : null;
  const hasFocus = Boolean(focus && (parseFocusTerms(focus.targetRoles).length
    || parseFocusTerms(focus.excludedRoles).length
    || parseFocusTerms(focus.targetIndustries).length
    || focus.workStyle !== 'any'));
  const relevantJobs = hasFocus
    ? accountJobs.filter((jobItem) => Number(jobItem.relevanceScore ?? -1) >= focus.minimumRelevanceScore)
    : accountJobs;
  item.relevantRoleCount = hasFocus ? relevantJobs.length : null;
  item.strongFitRoleCount = hasFocus ? accountJobs.filter((jobItem) => jobItem.relevanceBand === 'strong').length : null;
  item.lastJobPostedAt = accountJobs[0]?.postedAt || accountJobs[0]?.importedAt || '';
  item.hiringStatus = accountJobs.length
    ? (hasFocus && !relevantJobs.length ? 'Hiring outside focus' : 'Active hiring')
    : 'No active roles found';
  item.hiringVelocity = Math.min(100, Math.round((recent30.length * 8) + (recent7.length * 10)));
  item.targetScore = Math.min(100, Math.round(
    (Number(item.connectionCount || 0) * 8) +
    (Number(item.seniorContactCount || 0) * 12) +
    (Number(item.talentContactCount || 0) * 16) +
    (Number(hasFocus ? relevantJobs.length : item.jobCount || 0) * 10)
  ));
  item.dailyScore = item.targetScore;
  item.alertPriorityScore = Math.max(item.alertPriorityScore || 0, item.targetScore);
  item.updatedAt = now();
}

function deactivateJobsForConfig(config, tenantJobs, timestamp = now()) {
  let deactivated = 0;
  for (const jobItem of tenantJobs) {
    if (!jobBelongsToConfig(jobItem, config) || jobItem.active === false) continue;
    jobItem.active = false;
    jobItem.isNew = false;
    jobItem.closedAt = jobItem.closedAt || timestamp;
    jobItem.updatedAt = timestamp;
    deactivated++;
  }
  return deactivated;
}

function jobBelongsToConfig(jobItem, config) {
  if (jobItem.configId) return jobItem.configId === config.id;
  const atsMatches = normalizeAtsType(jobItem.atsType || jobItem.source) === getConfigAtsType(config);
  if (!atsMatches) return false;
  if (config.accountId && jobItem.accountId) return config.accountId === jobItem.accountId;
  return normalizeKey(jobItem.companyName) === normalizeKey(config.companyName);
}

function deactivateMissingJobsForConfig(config, tenantJobs, seenJobIds, timestamp = now()) {
  const closed = [];
  for (const jobItem of tenantJobs) {
    if (jobItem.active === false || seenJobIds.has(jobItem.id) || !jobBelongsToConfig(jobItem, config)) continue;
    jobItem.active = false;
    jobItem.isNew = false;
    jobItem.closedAt = jobItem.closedAt || timestamp;
    jobItem.updatedAt = timestamp;
    closed.push(jobItem);
  }
  return closed;
}


// ── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  try {
    const records = parseCsvSync(String(text || ''), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      max_record_size: 1_000_000,
    });
    if (records.length < 2) return [];

    let headerIndex = 0;
    for (let index = 0; index < Math.min(10, records.length); index += 1) {
      const headerText = records[index]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      if (headerText.includes('first name') || headerText.includes('company')) {
        headerIndex = index;
        break;
      }
    }

    const headers = records[headerIndex].map((value) => String(value || '').trim());
    return records.slice(headerIndex + 1).map((values) => {
      const row = {};
      for (let index = 0; index < headers.length; index += 1) {
        row[headers[index]] = String(values[index] || '').trim();
      }
      return row;
    });
  } catch (cause) {
    const error = new Error('CSV could not be parsed. Check the file format and try the original export again.');
    error.status = 400;
    error.code = 'invalid_csv';
    error.cause = cause;
    throw error;
  }
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
