import { initDb, dbQuery, closeDb } from '../src/db.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function aggregate(query, tenantId) {
  const result = await dbQuery(query, [tenantId]);
  return result?.rows || [];
}

async function main() {
  const tenantId = String(arg('--tenant') || '').trim();
  if (!tenantId) throw new Error('Provide --tenant <tenant-id>. This report never prints customer records.');
  if (!await initDb()) throw new Error('DATABASE_URL is required.');

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

  console.log(JSON.stringify({ tenantId, counts, boards, statuses, providers, activeJobSources, targetFlags }, null, 2));
}

main()
  .catch((error) => {
    console.error(`Job coverage report failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
