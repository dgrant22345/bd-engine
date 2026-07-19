/**
 * CG-006: semantic-integrity checks — business truth, not storage parity.
 *
 * Storage parity (relational-parity) proves two copies of a value are equal;
 * these checks prove the value itself is consistent with the records it claims
 * to summarize. Active jobs are the source of truth for role counts (P0.3).
 *
 * Pure functions over plain record arrays (the app's raw object shapes), so
 * the same logic runs against CI fixtures and against production data loaded
 * by scripts/semantic-integrity.mjs.
 */

const SAMPLE_LIMIT = 5;

function push(check, violation) {
  check.violations += 1;
  if (check.sample.length < SAMPLE_LIMIT) check.sample.push(violation);
}

function isActiveJob(job) {
  return job.active !== false;
}

// Mirrors store.js isResolvedBoardConfig semantics closely enough for
// reporting: a config counts as resolved when its discovery/review state says
// so and it has a provider identity.
function isResolvedConfig(config) {
  const status = String(config.discoveryStatus || '').toLowerCase();
  const review = String(config.reviewStatus || '').toLowerCase();
  const hasIdentity = Boolean(config.boardId || config.resolvedBoardUrl || config.apiUrl);
  return hasIdentity && (['resolved', 'mapped', 'discovered', 'manual'].includes(status) || review === 'approved');
}

function jobIdentity(job) {
  if (job.naturalKey) return String(job.naturalKey);
  const bits = [job.companyName, job.title, job.location, job.jobUrl || job.url || ''];
  return bits.map((v) => String(v || '').trim().toLowerCase()).join('|');
}

/**
 * Run all semantic checks for one workspace.
 * @param {object} data - { accounts, contacts, jobs, configs } plain arrays.
 * @returns {{ checks: object, totalViolations: number }}
 */
export function checkTenantIntegrity({ accounts = [], contacts = [], jobs = [], configs = [] } = {}) {
  const checks = {
    role_count_mismatch: { violations: 0, sample: [], description: 'account openRoleCount/jobCount disagrees with its active jobs' },
    connection_count_mismatch: { violations: 0, sample: [], description: 'account connectionCount disagrees with its linked contacts' },
    orphan_contact: { violations: 0, sample: [], description: 'contact.accountId points at a missing account' },
    orphan_job: { violations: 0, sample: [], description: 'job.accountId points at a missing account' },
    job_lifecycle_contradiction: { violations: 0, sample: [], description: 'job is active but has a closedAt timestamp' },
    active_job_unresolved_board: { violations: 0, sample: [], description: 'active job is linked to a missing or unresolved board config' },
    duplicate_job_identity: { violations: 0, sample: [], description: 'two jobs share the same natural identity' },
    duplicate_account_identity: { violations: 0, sample: [], description: 'two accounts share the same normalized name' },
    duplicate_board_identity: { violations: 0, sample: [], description: 'two board configs share company+provider+board identity' },
    unlinked_board_config: { violations: 0, sample: [], description: 'board config has no accountId although a matching account exists' },
  };

  const accountById = new Map(accounts.map((item) => [item.id, item]));
  const accountByNormalizedName = new Map();
  for (const item of accounts) {
    if (item.normalizedName) {
      if (accountByNormalizedName.has(item.normalizedName)) {
        push(checks.duplicate_account_identity, {
          normalizedName: item.normalizedName,
          ids: [accountByNormalizedName.get(item.normalizedName).id, item.id],
        });
      } else {
        accountByNormalizedName.set(item.normalizedName, item);
      }
    }
  }

  const activeJobsByAccount = new Map();
  const contactsByAccount = new Map();
  for (const job of jobs) {
    if (job.accountId && !accountById.has(job.accountId)) {
      push(checks.orphan_job, { jobId: job.id, accountId: job.accountId, title: job.title });
    }
    if (isActiveJob(job) && (job.closedAt || job.closed_at)) {
      push(checks.job_lifecycle_contradiction, { jobId: job.id, closedAt: job.closedAt || job.closed_at });
    }
    if (job.accountId && isActiveJob(job)) {
      activeJobsByAccount.set(job.accountId, (activeJobsByAccount.get(job.accountId) || 0) + 1);
    }
  }
  for (const contact of contacts) {
    if (contact.accountId) {
      if (!accountById.has(contact.accountId)) {
        push(checks.orphan_contact, { contactId: contact.id, accountId: contact.accountId, fullName: contact.fullName });
      } else {
        contactsByAccount.set(contact.accountId, (contactsByAccount.get(contact.accountId) || 0) + 1);
      }
    }
  }

  for (const item of accounts) {
    const activeJobs = activeJobsByAccount.get(item.id) || 0;
    const storedRoles = Number(item.openRoleCount || 0);
    const storedJobs = Number(item.jobCount || 0);
    if (storedRoles !== activeJobs || storedJobs !== activeJobs) {
      push(checks.role_count_mismatch, {
        accountId: item.id,
        displayName: item.displayName,
        openRoleCount: storedRoles,
        jobCount: storedJobs,
        activeJobs,
      });
    }
    const linkedContacts = contactsByAccount.get(item.id) || 0;
    const storedConnections = Number(item.connectionCount || 0);
    if (storedConnections !== linkedContacts) {
      push(checks.connection_count_mismatch, {
        accountId: item.id,
        displayName: item.displayName,
        connectionCount: storedConnections,
        linkedContacts,
      });
    }
  }

  const configById = new Map(configs.map((config) => [config.id, config]));
  const boardIdentities = new Map();
  for (const config of configs) {
    const identity = [config.normalizedCompanyName, config.atsType || config.ats, config.boardId]
      .map((v) => String(v || '').trim().toLowerCase())
      .join('|');
    if (config.boardId) {
      if (boardIdentities.has(identity)) {
        push(checks.duplicate_board_identity, { identity, ids: [boardIdentities.get(identity), config.id] });
      } else {
        boardIdentities.set(identity, config.id);
      }
    }
    if (!config.accountId && config.normalizedCompanyName && accountByNormalizedName.has(config.normalizedCompanyName)) {
      push(checks.unlinked_board_config, {
        configId: config.id,
        normalizedCompanyName: config.normalizedCompanyName,
        matchingAccountId: accountByNormalizedName.get(config.normalizedCompanyName).id,
      });
    }
  }

  const jobIdentities = new Map();
  for (const job of jobs) {
    const identity = jobIdentity(job);
    if (identity) {
      if (jobIdentities.has(identity)) {
        push(checks.duplicate_job_identity, { identity, ids: [jobIdentities.get(identity), job.id] });
      } else {
        jobIdentities.set(identity, job.id);
      }
    }
    if (isActiveJob(job) && job.configId) {
      const config = configById.get(job.configId);
      if (!config || !isResolvedConfig(config) || config.active === false) {
        push(checks.active_job_unresolved_board, {
          jobId: job.id,
          configId: job.configId,
          reason: !config ? 'missing_config' : (config.active === false ? 'inactive_config' : 'unresolved_config'),
        });
      }
    }
  }

  const totalViolations = Object.values(checks).reduce((sum, check) => sum + check.violations, 0);
  return { checks, totalViolations };
}

export function summarizeIntegrityResult(result) {
  return {
    totalViolations: Number(result?.totalViolations || 0),
    checks: Object.fromEntries(Object.entries(result?.checks || {}).map(([name, check]) => [name, {
      violations: Number(check?.violations || 0),
      description: String(check?.description || ''),
    }])),
  };
}

/** Human-readable aggregate summary. Samples may contain customer data. */
export function formatIntegrityReport(workspaceLabel, result) {
  const summary = summarizeIntegrityResult(result);
  const lines = [`${workspaceLabel}: ${summary.totalViolations} violation(s)`];
  for (const [name, check] of Object.entries(summary.checks)) {
    if (!check.violations) continue;
    lines.push(`  ${name}: ${check.violations} — ${check.description}`);
  }
  return lines.join('\n');
}
