import pg from 'pg';
import { requireMaintenanceApproval } from '../src/maintenance-safety.js';

const { Pool } = pg;

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function isTestEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.endsWith('@bd-engine.invalid')) return true;
  if (!email.endsWith('@example.com')) return false;
  return /^(smoke|prod-|railway-|codex-|analytics-|checkout-|referrer-|referred-|final-|https-|referral-link-|test[a-z0-9]*)/.test(email);
}

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  const before = arg('--before');
  const apply = process.argv.includes('--apply');
  const confirm = arg('--confirm');
  if (!before || !Number.isFinite(new Date(before).getTime())) throw new Error('Pass --before <ISO date>.');
  requireMaintenanceApproval({
    apply,
    confirmation: confirm,
    expectedConfirmation: 'DELETE_TEST_DATA',
    backupReference: String(arg('--backup-reference') || ''),
    action: 'Applying test-data cleanup',
    requireTenant: false,
  });
  if (!connectionString) throw new Error('DATABASE_URL is required.');

  const pool = new Pool({
    connectionString,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 2,
    options: apply ? undefined : '-c default_transaction_read_only=on',
  });
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT u.id AS user_id, u.email, t.id AS tenant_id,
              t.stripe_customer_id, t.stripe_subscription_id
       FROM users u
       LEFT JOIN memberships m ON m.user_id = u.id
       LEFT JOIN tenants t ON t.id = m.tenant_id
       WHERE u.created_at < $1
       ORDER BY u.created_at, u.id`,
      [new Date(before).toISOString()]
    );
    const candidates = rows.filter((row) => isTestEmail(row.email));
    const billed = candidates.filter((row) => row.stripe_customer_id || row.stripe_subscription_id);
    if (billed.length) throw new Error(`Refusing cleanup: ${billed.length} candidate workspace(s) have Stripe billing identifiers.`);

    const userIds = [...new Set(candidates.map((row) => row.user_id).filter(Boolean))];
    const tenantIds = [...new Set(candidates.map((row) => row.tenant_id).filter(Boolean))];
    const orphanTenants = await client.query(
      `SELECT t.id
       FROM tenants t
       WHERE t.created_at < $1
         AND t.stripe_customer_id = ''
         AND t.stripe_subscription_id = ''
         AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.tenant_id = t.id)
         AND (LOWER(t.name) LIKE '%smoke%' OR LOWER(t.name) LIKE '%codex test%')`,
      [new Date(before).toISOString()]
    );
    tenantIds.push(...orphanTenants.rows.map((row) => row.id).filter((id) => !tenantIds.includes(id)));

    const summary = {
      before: new Date(before).toISOString(),
      userCount: userIds.length,
      tenantCount: tenantIds.length,
      orphanTenantCount: orphanTenants.rows.length,
    };
    if (!apply) {
      console.log(JSON.stringify({ ok: true, mode: 'dry-run', ...summary }));
      return;
    }

    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM sessions WHERE user_id = ANY($1::text[]) OR tenant_id = ANY($2::text[])', [userIds, tenantIds]);
      await client.query('DELETE FROM password_reset_tokens WHERE user_id = ANY($1::text[])', [userIds]);
      await client.query('DELETE FROM analytics_events WHERE user_id = ANY($1::text[]) OR tenant_id = ANY($2::text[])', [userIds, tenantIds]);
      await client.query('DELETE FROM memberships WHERE user_id = ANY($1::text[]) OR tenant_id = ANY($2::text[])', [userIds, tenantIds]);
      await client.query('DELETE FROM tenant_data WHERE tenant_id = ANY($1::text[])', [tenantIds]);
      const deletedTenants = await client.query('DELETE FROM tenants WHERE id = ANY($1::text[])', [tenantIds]);
      const deletedUsers = await client.query('DELETE FROM users WHERE id = ANY($1::text[])', [userIds]);
      await client.query('COMMIT');
      console.log(JSON.stringify({
        ok: true,
        mode: 'applied',
        before: summary.before,
        userCount: summary.userCount,
        tenantCount: summary.tenantCount,
        orphanTenantCount: summary.orphanTenantCount,
        deletedUsers: deletedUsers.rowCount || 0,
        deletedTenants: deletedTenants.rowCount || 0,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
