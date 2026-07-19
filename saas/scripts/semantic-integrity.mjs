/**
 * CG-006: semantic-integrity report against the live database. READ-ONLY.
 *
 * Usage:
 *   node scripts/semantic-integrity.mjs                # all workspaces
 *   node scripts/semantic-integrity.mjs --tenant <id>  # one workspace
 *   node scripts/semantic-integrity.mjs --json         # aggregate machine output
 *
 * Exits 1 when any workspace has violations (usable as a gate), 0 otherwise.
 */
import { initDb, dbQuery, closeDb } from '../src/db.js';
import { checkTenantIntegrity, formatIntegrityReport, summarizeIntegrityResult } from '../src/semantic-integrity.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadRaw(table, tenantId) {
  const result = await dbQuery(`SELECT raw FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return (result?.rows || []).map((row) => row.raw).filter(Boolean);
}

async function main() {
  const tenantFilter = arg('--tenant');
  const asJson = process.argv.includes('--json');
  const ready = await initDb({ migrate: false, readOnly: true });
  if (!ready) throw new Error('DATABASE_URL is required for the semantic-integrity report.');

  const tenants = tenantFilter
    ? [{ tenant_id: tenantFilter }]
    : (await dbQuery('SELECT DISTINCT tenant_id FROM accounts ORDER BY tenant_id', [])).rows;

  let totalViolations = 0;
  const reports = [];
  for (const { tenant_id: tenantId } of tenants) {
    const [accounts, contacts, jobs, configs] = await Promise.all([
      loadRaw('accounts', tenantId),
      loadRaw('contacts', tenantId),
      loadRaw('jobs', tenantId),
      loadRaw('board_configs', tenantId),
    ]);
    const result = checkTenantIntegrity({ accounts, contacts, jobs, configs });
    totalViolations += result.totalViolations;
    const workspace = `workspace ${reports.length + 1}`;
    const report = {
      workspace,
      counts: { accounts: accounts.length, contacts: contacts.length, jobs: jobs.length, configs: configs.length },
      ...summarizeIntegrityResult(result),
    };
    reports.push(report);
    if (!asJson) {
      console.log(formatIntegrityReport(workspace, report));
    }
  }

  if (asJson) console.log(JSON.stringify({ totalViolations, reports }, null, 2));
  else console.log(`\nTOTAL: ${totalViolations} violation(s) across ${reports.length} workspace(s)`);
  process.exitCode = totalViolations ? 1 : 0;
}

main()
  .catch((err) => {
    console.error('Semantic-integrity report failed:', err.message);
    process.exitCode = 2;
  })
  .finally(async () => {
    await closeDb();
  });
