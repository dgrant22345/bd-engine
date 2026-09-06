import { initDb, dbQuery, closeDb } from '../src/db.js';
import { locationMatchesGeography } from '../src/job-geography.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function aggregate(query, tenantId) {
  const result = await dbQuery(query, [tenantId]);
  return result?.rows || [];
}

async function main() {
  let tenantId = String(arg('--tenant') || '').trim();
  const email = String(arg('--email') || '').trim().toLowerCase();
  const auditAll = process.argv.includes('--all');
  const populatedOnly = process.argv.includes('--populated');
  if (!tenantId && !email && !auditAll) {
    throw new Error('Provide --tenant <tenant-id>, --email <owner-email>, or --all. This report never prints customer records.');
  }
  if (!await initDb({ migrate: false, readOnly: true })) throw new Error('DATABASE_URL is required.');

  let tenantIds;
  if (auditAll) {
    const result = await dbQuery('SELECT id FROM tenants ORDER BY created_at, id');
    tenantIds = (result?.rows || []).map((row) => row.id);
  } else if (!tenantId) {
    const result = await dbQuery(`
      SELECT m.tenant_id
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE lower(u.email) = $1
      ORDER BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.created_at
    `, [email]);
    if (!result?.rows?.length) throw new Error('No workspace was found for that email.');
    if (result.rows.length > 1) throw new Error('That email belongs to multiple workspaces. Use --tenant to select one.');
    tenantId = result.rows[0].tenant_id;
    tenantIds = [tenantId];
  } else {
    tenantIds = [tenantId];
  }

  const workspaces = [];
  for (const [index, id] of tenantIds.entries()) workspaces.push(await auditWorkspace(id, index));
  const reported = populatedOnly
    ? workspaces.filter((item) => item.account.hasSubscription || item.counts.accounts || item.counts.configs || item.counts.jobs)
    : workspaces;
  console.log(JSON.stringify({ workspaceCount: workspaces.length, reportedCount: reported.length, workspaces: reported }, null, 2));
}

async function auditWorkspace(tenantId, index) {
  const workspaceResult = await dbQuery(`
    SELECT t.persona, t.plan, t.status, td.settings,
      (t.stripe_subscription_id <> '') AS has_subscription,
      (SELECT count(*)::int FROM memberships m WHERE m.tenant_id = t.id) AS members,
      (SELECT count(*)::int
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.tenant_id = t.id AND u.email_verified_at <> '') AS verified_members
    FROM tenants t
    LEFT JOIN tenant_data td ON td.tenant_id = t.id
    WHERE t.id = $1
  `, [tenantId]);
  const workspace = workspaceResult?.rows?.[0];
  if (!workspace) throw new Error('Workspace not found.');
  const settings = workspace.settings && typeof workspace.settings === 'object' ? workspace.settings : {};
  const persona = String(workspace.persona || settings.persona || 'bd').toLowerCase();
  const focus = settings.searchFocusByPersona?.[persona] || {};
  const minimumRelevanceScore = Math.max(1, Math.min(100, Number(focus.minimumRelevanceScore) || 45));

  const [counts] = await aggregate(`
    SELECT
      (SELECT count(*)::int FROM accounts WHERE tenant_id = $1) AS accounts,
      (SELECT count(*)::int FROM board_configs WHERE tenant_id = $1) AS configs,
      (SELECT count(*)::int FROM jobs WHERE tenant_id = $1) AS jobs,
      (SELECT count(*)::int FROM jobs WHERE tenant_id = $1 AND active) AS active_jobs
  `, tenantId);
  const [boards] = await aggregate(`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE account_id IS NOT NULL AND account_id <> '')::int AS linked,
      count(*) FILTER (WHERE board_id <> '')::int AS with_board,
      count(*) FILTER (WHERE careers_url <> '')::int AS with_careers,
      count(*) FILTER (WHERE active)::int AS active
    FROM board_configs WHERE tenant_id = $1
  `, tenantId);
  const statuses = await aggregate(`
    SELECT discovery_status, review_status, count(*)::int AS count
    FROM board_configs WHERE tenant_id = $1
    GROUP BY discovery_status, review_status ORDER BY count DESC
  `, tenantId);
  const providers = await aggregate(`
    SELECT ats_type, count(*)::int AS boards
    FROM board_configs WHERE tenant_id = $1 AND board_id <> ''
    GROUP BY ats_type ORDER BY boards DESC
  `, tenantId);
  const activeJobSources = await aggregate(`
    SELECT ats_type, count(*)::int AS jobs
    FROM jobs WHERE tenant_id = $1 AND active
    GROUP BY ats_type ORDER BY jobs DESC
  `, tenantId);
  const targetFlags = await aggregate(`
    SELECT coalesce(raw->>'tracked', 'missing') AS value, count(*)::int AS accounts
    FROM accounts WHERE tenant_id = $1
    GROUP BY value ORDER BY accounts DESC
  `, tenantId);
  const activeJobRows = await aggregate(`
    SELECT j.location, j.raw, a.location AS account_location
    FROM jobs j
    LEFT JOIN accounts a ON a.id = j.account_id AND a.tenant_id = j.tenant_id
    WHERE j.tenant_id = $1 AND j.active
  `, tenantId);

  const activeJobs = activeJobRows.map((row) => ({
    ...(row.raw && typeof row.raw === 'object' ? row.raw : {}),
    location: row.location || row.raw?.location || '',
    accountLocation: row.account_location || '',
  }));
  const scoredJobs = activeJobs.filter((job) => job.relevanceScore !== null && job.relevanceScore !== undefined && job.relevanceScore !== '' && Number.isFinite(Number(job.relevanceScore)));
  const matchingJobs = scoredJobs.filter((job) => job.matchesSearchFocus !== false && Number(job.relevanceScore) >= minimumRelevanceScore);
  const canadaJobs = activeJobs.filter((job) => locationMatchesGeography(job, 'canada'));
  const canadaMatchingJobs = matchingJobs.filter((job) => locationMatchesGeography(job, 'canada'));
  const focusSummary = {
    configured: Boolean(termCount(focus.targetRoles)
      || termCount(focus.excludedRoles)
      || termCount(focus.targetIndustries)
      || (focus.workStyle && focus.workStyle !== 'any')),
    targetRoleTerms: termCount(focus.targetRoles),
    excludedRoleTerms: termCount(focus.excludedRoles),
    targetIndustryTerms: termCount(focus.targetIndustries),
    workStyle: focus.workStyle || 'any',
    minimumRelevanceScore,
  };

  return {
    workspace: index + 1,
    account: {
      persona,
      plan: workspace.plan,
      status: workspace.status,
      hasSubscription: Boolean(workspace.has_subscription),
      members: Number(workspace.members || 0),
      verifiedMembers: Number(workspace.verified_members || 0),
    },
    focus: focusSummary,
    counts,
    matching: {
      active: activeJobs.length,
      scored: scoredJobs.length,
      atOrAboveThreshold: matchingJobs.length,
      canada: canadaJobs.length,
      canadaAtOrAboveThreshold: canadaMatchingJobs.length,
    },
    boards,
    statuses,
    providers,
    activeJobSources,
    targetFlags,
  };
}

function termCount(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,;\n]+/);
  return new Set(source.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)).size;
}

main()
  .catch((error) => {
    console.error(`Job coverage report failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
