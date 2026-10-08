import { dbQuery, dbTransaction, isDbEnabled } from './db.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateJobFeedback(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Provide a role feedback object.');
  if (!['', 'relevant', 'not_relevant'].includes(input.vote)) throw fail('Choose Relevant, Not relevant, or clear the feedback.');
  if (typeof input.expectedUpdatedAt !== 'string' || input.expectedUpdatedAt.length > 40) throw fail('Reload the role before updating its feedback.');
  const reason = String(input.reason || '').trim();
  if (reason.length > 300) throw fail('Keep the feedback reason within 300 characters.');
  return { vote: input.vote, reason, expectedUpdatedAt: input.expectedUpdatedAt };
}

// Only the feedback fields change. Reimports and rescoring preserve this
// workspace judgment rather than treating it as an algorithmic relevance score.
export async function persistJobFeedback(tenantId, jobId, feedback, expectedUpdatedAt, { enabled = isDbEnabled, transaction = dbTransaction } = {}) {
  if (!enabled()) return;
  await transaction(async query => {
    // Match the snapshot writer's lock order before touching the relational row.
    await query('SELECT tenant_id FROM tenant_data WHERE tenant_id=$1 FOR UPDATE', [tenantId]);
    const result = await query('SELECT raw FROM jobs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, jobId]);
    let raw = result.rows[0]?.raw;
    if (!raw) {
      const legacy = await query("SELECT item FROM tenant_data, LATERAL jsonb_array_elements(jobs) AS entries(item) WHERE tenant_id=$1 AND item->>'id'=$2", [tenantId, jobId]);
      raw = legacy.rows[0]?.item;
    }
    if (!raw) throw fail('This role is no longer available in the workspace.', 404);
    if ((raw.relevanceFeedback?.updatedAt || '') !== expectedUpdatedAt) throw fail('Feedback changed on another tab or device. Reload the role before saving again.', 409);
    await query("UPDATE jobs SET raw=jsonb_set(raw, '{relevanceFeedback}', $3::jsonb, true) WHERE tenant_id=$1 AND id=$2", [tenantId, jobId, JSON.stringify(feedback)]);
    await query(`UPDATE tenant_data SET jobs=(
      SELECT coalesce(jsonb_agg(CASE WHEN item->>'id'=$2 THEN jsonb_set(item, '{relevanceFeedback}', $3::jsonb, true) ELSE item END ORDER BY ordinal), '[]'::jsonb)
      FROM jsonb_array_elements(jobs) WITH ORDINALITY AS entries(item, ordinal)
    ) WHERE tenant_id=$1`, [tenantId, jobId, JSON.stringify(feedback)]);
  });
}

export async function loadWorkspaceFeedback(tenantId) {
  if (!isDbEnabled()) return [];
  const result = await dbQuery(`SELECT id,raw->'relevanceFeedback' AS feedback FROM jobs WHERE tenant_id=$1 AND raw ? 'relevanceFeedback'
    UNION ALL SELECT item->>'id',item->'relevanceFeedback' FROM tenant_data,
      LATERAL jsonb_array_elements(jobs) AS entries(item) WHERE tenant_id=$1 AND item ? 'relevanceFeedback'
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.tenant_id=$1 AND j.id=item->>'id')`, [tenantId]);
  return result?.rows || [];
}
