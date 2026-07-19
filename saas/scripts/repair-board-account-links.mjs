import { initDb, dbQuery, dbTransaction, closeDb } from '../src/db.js';
import { requireMaintenanceApproval } from '../src/maintenance-safety.js';

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const tenantId = String(arg('--tenant') || '').trim();
const apply = process.argv.includes('--apply');
const confirmation = String(arg('--confirm') || '');
const backupReference = String(arg('--backup-reference') || '').trim();

const uniqueAccountsSql = `
  SELECT normalized_name, min(id) AS account_id
  FROM accounts
  WHERE tenant_id = $1 AND normalized_name <> ''
  GROUP BY normalized_name
  HAVING count(*) = 1
`;

async function main() {
  if (!tenantId) throw new Error('Provide --tenant <tenant-id>.');
  requireMaintenanceApproval({
    apply,
    tenantId,
    confirmation,
    expectedConfirmation: 'LINK_BOARD_CONFIGS',
    backupReference,
    action: 'Applying the board-link repair',
  });
  if (!await initDb({ migrate: false, readOnly: !apply })) throw new Error('DATABASE_URL is required.');

  const candidates = await dbQuery(`
    WITH unique_accounts AS (${uniqueAccountsSql})
    SELECT count(*)::int AS count
    FROM board_configs config
    JOIN unique_accounts account ON account.normalized_name = config.normalized_company_name
    WHERE config.tenant_id = $1 AND coalesce(config.account_id, '') = ''
  `, [tenantId]);
  const candidateCount = candidates?.rows?.[0]?.count || 0;
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', workspaceCount: 1, candidateCount }, null, 2));
  if (!apply || candidateCount === 0) return;

  const timestamp = new Date().toISOString();
  const result = await dbTransaction(async (query) => {
    const relational = await query(`
      WITH unique_accounts AS (${uniqueAccountsSql})
      UPDATE board_configs config
      SET account_id = account.account_id,
          raw = jsonb_set(
            jsonb_set(coalesce(config.raw, '{}'::jsonb), '{accountId}', to_jsonb(account.account_id), true),
            '{updatedAt}', to_jsonb($2::text), true
          ),
          updated_at = $2
      FROM unique_accounts account
      WHERE config.tenant_id = $1
        AND coalesce(config.account_id, '') = ''
        AND account.normalized_name = config.normalized_company_name
    `, [tenantId, timestamp]);

    await query(`
      WITH unique_accounts AS (${uniqueAccountsSql})
      UPDATE tenant_data data
      SET configs = repaired.configs, updated_at = $2
      FROM (
        SELECT coalesce(jsonb_agg(
          CASE
            WHEN coalesce(config.item->>'accountId', '') = '' AND account.account_id IS NOT NULL
              THEN jsonb_set(
                jsonb_set(config.item, '{accountId}', to_jsonb(account.account_id), true),
                '{updatedAt}', to_jsonb($2::text), true
              )
            ELSE config.item
          END
          ORDER BY config.ordinality
        ), '[]'::jsonb) AS configs
        FROM tenant_data source
        CROSS JOIN LATERAL jsonb_array_elements(source.configs) WITH ORDINALITY AS config(item, ordinality)
        LEFT JOIN unique_accounts account
          ON account.normalized_name = coalesce(config.item->>'normalizedCompanyName', '')
        WHERE source.tenant_id = $1
      ) repaired
      WHERE data.tenant_id = $1
    `, [tenantId, timestamp]);
    const linked = relational.rowCount || 0;
    await query(
      `INSERT INTO audit_log
        (tenant_id, actor_user_id, action, entity_type, entity_id, before, after, metadata, created_at)
       VALUES ($1, '', 'board_config.account_links_repaired', 'tenant', $1, $2, $3, $4, $5)`,
      [
        tenantId,
        JSON.stringify({ unlinked: candidateCount }),
        JSON.stringify({ linked }),
        JSON.stringify({ backupReference, privacySafe: true }),
        timestamp,
      ]
    );
    return linked;
  });
  console.log(JSON.stringify({ mode: 'applied', workspaceCount: 1, linked: result, auditRecorded: true }, null, 2));
}

main()
  .catch((error) => {
    console.error(`Board-link repair failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(closeDb);
