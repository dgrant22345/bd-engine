import { dbQuery, isDbReady } from './db.js';

// Aggregate only customer signup cohorts; never return identities or message text.
export const GROWTH_SQL = `WITH signups AS (
  SELECT DISTINCT ON (e.tenant_id) e.tenant_id,e.created_at::timestamptz AS signup_at,
    CASE WHEN coalesce(e.metadata->>'firstTouchSource','') ~ '^[a-z0-9_.-]{1,32}$' THEN e.metadata->>'firstTouchSource' ELSE 'direct' END AS source,
    CASE WHEN coalesce(e.metadata->>'firstTouchCampaign','') ~ '^[a-z0-9_.-]{1,32}$' THEN e.metadata->>'firstTouchCampaign' ELSE '' END AS campaign,
    CASE WHEN e.metadata->>'persona' IN ('bd','jobseeker') THEN e.metadata->>'persona' ELSE '' END AS persona
  FROM analytics_events e LEFT JOIN users u ON u.id=e.user_id LEFT JOIN tenants t ON t.id=e.tenant_id
  WHERE e.event_type='signup_completed' AND e.day >= $1 AND e.tenant_id<>''
    AND coalesce(e.metadata->>'trafficClass','customer')='customer'
    AND coalesce(t.slug,'')<>'bd-engine-demo'
    AND NOT (lower(coalesce(u.email,''))=ANY($2::text[]))
    AND lower(coalesce(u.email,'')) !~ '@(example\\.(com|org|net)|[^@]*\\.test)$'
  ORDER BY e.tenant_id,e.created_at::timestamptz
), flags AS (
  SELECT s.*,s.signup_at<=$3::timestamptz-INTERVAL '14 days' AS eligible,
    EXISTS (SELECT 1 FROM analytics_events a WHERE a.tenant_id=s.tenant_id AND a.event_type='subscription_started'
      AND coalesce(a.metadata->>'trafficClass','customer')='customer' AND a.created_at::timestamptz>=s.signup_at AND a.created_at::timestamptz<=$3::timestamptz) AS paid,
    EXISTS (SELECT 1 FROM analytics_events a WHERE a.tenant_id=s.tenant_id AND a.event_type='workspace_visited'
      AND coalesce(a.metadata->>'trafficClass','customer')='customer' AND a.created_at::timestamptz>=s.signup_at+INTERVAL '7 days'
      AND a.created_at::timestamptz<s.signup_at+INTERVAL '14 days' AND a.created_at::timestamptz<=$3::timestamptz) AS returned
  FROM signups s
)
SELECT source,campaign,persona,GROUPING(source) AS is_total,count(*)::int AS signups,
  count(*) FILTER (WHERE paid)::int AS paid,
  count(*) FILTER (WHERE eligible)::int AS eligible,
  count(*) FILTER (WHERE eligible AND returned)::int AS returned
FROM flags GROUP BY GROUPING SETS ((source,campaign,persona),())
ORDER BY is_total DESC,signups DESC,source,campaign,persona`;

export function summarizeGrowthRows(rows) {
  const convert = row => ({ source: row.source || 'direct', campaign: row.campaign || '', persona: row.persona || '', signups: Number(row.signups || 0), paid: Number(row.paid || 0), eligible: Number(row.eligible || 0), returned: Number(row.returned || 0), pending: Number(row.signups || 0) - Number(row.eligible || 0) });
  const total = convert(rows.find(row => Number(row.is_total) === 1) || {});
  return { available: true, lookbackDays: 30, returnWindow: 'Days 7–13 after signup; reported once the full 14-day window closes', totals: { signups: total.signups, paid: total.paid, eligible: total.eligible, returned: total.returned, pending: total.pending }, bySource: rows.filter(row => !Number(row.is_total)).slice(0, 12).map(convert) };
}
export async function getGrowthOutcomes({ excludedEmails = [], now = new Date(), query = dbQuery, ready = isDbReady } = {}) {
  if (!ready()) return { available: false, reason: 'Customer cohort reporting requires the hosted database.' };
  const startedAt = performance.now();
  const since = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const result = await query(GROWTH_SQL, [since, [...new Set(excludedEmails.map(value => String(value).trim().toLowerCase()))], now.toISOString()]);
  const elapsed = Math.round(performance.now() - startedAt);
  if (elapsed > 250) console.warn(`Slow growth cohorts: saas/src/growth-outcomes.js getGrowthOutcomes ${elapsed}ms`);
  return summarizeGrowthRows(result.rows);
}
