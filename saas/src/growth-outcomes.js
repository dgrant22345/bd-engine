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
), events AS (
  -- One pass over the period's product events. Every counted event follows
  -- its workspace's signup, so it falls on or after the first reported day.
  SELECT a.tenant_id,a.event_type,a.created_at::timestamptz AS at
  FROM analytics_events a
  WHERE a.tenant_id<>'' AND a.day >= $1
    AND a.event_type IN ('subscription_started','workspace_visited','setup_completed','target_created','people_added','outreach_generated','outreach_draft_saved')
    AND coalesce(a.metadata->>'trafficClass','customer')='customer'
), flags AS (
  SELECT s.tenant_id,s.source,s.campaign,s.persona,
    s.signup_at<=$3::timestamptz-INTERVAL '14 days' AS eligible,
    coalesce(bool_or(e.event_type='subscription_started'),false) AS paid,
    coalesce(bool_or(e.event_type='workspace_visited' AND e.at>=s.signup_at+INTERVAL '7 days' AND e.at<s.signup_at+INTERVAL '14 days'),false) AS returned,
    coalesce(bool_or(e.event_type='setup_completed'),false) AS setup_completed,
    coalesce(bool_or(e.event_type='target_created'),false) AS target_added,
    coalesce(bool_or(e.event_type='people_added'),false) AS people_added,
    coalesce(bool_or(e.event_type IN ('outreach_generated','outreach_draft_saved')),false) AS outreach_drafted
  FROM signups s
  LEFT JOIN events e ON e.tenant_id=s.tenant_id AND e.at>=s.signup_at AND e.at<=$3::timestamptz
  GROUP BY s.tenant_id,s.signup_at,s.source,s.campaign,s.persona
)
SELECT source,campaign,persona,GROUPING(source) AS is_total,count(*)::int AS signups,
  count(*) FILTER (WHERE paid)::int AS paid,
  count(*) FILTER (WHERE eligible)::int AS eligible,
  count(*) FILTER (WHERE eligible AND returned)::int AS returned,
  count(*) FILTER (WHERE setup_completed)::int AS setup_completed,
  count(*) FILTER (WHERE target_added)::int AS target_added,
  count(*) FILTER (WHERE people_added)::int AS people_added,
  count(*) FILTER (WHERE outreach_drafted)::int AS outreach_drafted
FROM flags GROUP BY GROUPING SETS ((source,campaign,persona),())
ORDER BY is_total DESC,signups DESC,source,campaign,persona`;

export function summarizeGrowthRows(rows) {
  const convert = row => ({ source: row.source || 'direct', campaign: row.campaign || '', persona: row.persona || '', signups: Number(row.signups || 0), paid: Number(row.paid || 0), eligible: Number(row.eligible || 0), returned: Number(row.returned || 0), pending: Number(row.signups || 0) - Number(row.eligible || 0), activation: { setupCompleted: Number(row.setup_completed || 0), targetAdded: Number(row.target_added || 0), peopleAdded: Number(row.people_added || 0), outreachDrafted: Number(row.outreach_drafted || 0) } });
  const total = convert(rows.find(row => Number(row.is_total) === 1) || {});
  return { available: true, lookbackDays: 30, returnWindow: 'Days 7–13 after signup; reported once the full 14-day window closes', totals: { signups: total.signups, paid: total.paid, eligible: total.eligible, returned: total.returned, pending: total.pending, activation: total.activation }, bySource: rows.filter(row => !Number(row.is_total)).slice(0, 12).map(convert) };
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
