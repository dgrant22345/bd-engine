import { buildJobGeographySql, buildJobWorkStyleSql } from './job-geography.js';

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(maximum, Math.floor(number)) : fallback;
}

// Count and page share a relational source and predicates. Legacy tenant_data is
// deliberately absent: its jobs array may lag the authoritative jobs table.
export function buildTenantJobQueries(tenantId, query = {}) {
  const page = positiveInteger(query.page, 1);
  const pageSize = positiveInteger(query.pageSize, 25, 10000);
  const params = [tenantId];
  const param = (value) => { params.push(value); return `$${params.length}`; };
  const truthy = (value) => value === true || value === 'true';
  const clauses = ['j.tenant_id = $1'];
  const connectionCount = `COALESCE(network.connection_count, 0)`;
  const source = `FROM jobs j
    LEFT JOIN accounts a ON a.id = j.account_id AND a.tenant_id = j.tenant_id
    LEFT JOIN (SELECT account_id, COUNT(*)::int AS connection_count FROM contacts WHERE tenant_id = $1 GROUP BY account_id) network ON network.account_id = a.id`;
  const workStyle = buildJobWorkStyleSql();
  const relevance = `CASE WHEN COALESCE(j.raw->>'relevanceScore', '') ~ '^\\d+(\\.\\d+)?$' THEN (j.raw->>'relevanceScore')::numeric ELSE -1 END`;
  const posted = `COALESCE(NULLIF(j.posted_at, ''), j.raw->>'importedAt', '')`;
  if (truthy(query.pipelineOnly)) clauses.push(`COALESCE(j.raw->>'pipelineStage', '') <> ''`);
  if (query.ids !== undefined) clauses.push(`j.id = ANY(${param(String(query.ids).split(',').filter(Boolean))}::text[])`);
  if (String(query.q || '').trim()) {
    const search = param(`%${String(query.q).trim().replace(/[\\%_]/g, '\\$&')}%`);
    clauses.push(`(j.title ILIKE ${search} ESCAPE '\\' OR j.company_name ILIKE ${search} ESCAPE '\\' OR j.location ILIKE ${search} ESCAPE '\\' OR j.source ILIKE ${search} ESCAPE '\\')`);
  }
  for (const [kind, value] of [['geography', query.geography], ['workStyle', query.workStyle]]) {
    if (!value) continue;
    if (value === 'local_remote') clauses.push(`((${workStyle}) = 'remote' OR ${buildJobGeographySql('gta')} OR ${buildJobGeographySql('canada')})`);
    else if (kind === 'workStyle' || value === 'remote') clauses.push(`(${workStyle}) = ${param(value)}`);
    else clauses.push(buildJobGeographySql(value));
  }
  if (['hasContacts', 'hasConnections', 'networkOnly'].some((key) => truthy(query[key]))) clauses.push(`${connectionCount} > 0`);
  if (Number(query.minConnections) > 0) clauses.push(`${connectionCount} >= ${param(Number(query.minConnections))}`);
  if (query.ats) {
    const ats = String(query.ats).toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalized = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'jobvite', 'workday', 'bamboohr'].find((provider) => ats.includes(provider));
    const expr = `lower(regexp_replace(COALESCE(NULLIF(j.ats_type, ''), j.source), '[^a-zA-Z0-9]', '', 'g'))`;
    if (normalized) clauses.push(`${expr} LIKE ${param(`%${normalized}%`)}`);
    else if (['customstatic', 'staticcareers'].includes(ats)) clauses.push(`${expr} IN ('customstatic', 'staticcareers')`);
    else clauses.push(`${expr} = ${param(ats)}`);
  }
  if (truthy(query.active)) clauses.push('j.active IS NOT FALSE');
  else if (query.active === false || query.active === 'false') clauses.push('j.active IS FALSE');
  if (truthy(query.isNew)) clauses.push(`lower(COALESCE(j.raw->>'isNew', 'false')) IN ('true', '1', 'yes')`);
  else if (query.isNew === false || query.isNew === 'false') clauses.push(`lower(COALESCE(j.raw->>'isNew', 'false')) NOT IN ('true', '1', 'yes')`);
  if (Number(query.recencyDays) > 0) {
    // Workday sometimes supplies relative dates; these are not cast as dates.
    clauses.push(`CASE WHEN j.posted_at ~ '^\\d{4}-\\d{2}-\\d{2}' THEN CURRENT_DATE - to_date(substring(j.posted_at, 1, 10), 'YYYY-MM-DD') <= ${param(Math.floor(Number(query.recencyDays)))} ELSE FALSE END`);
  }
  if (Number(query.minRelevance) > 0) clauses.push(`COALESCE(j.raw->>'matchesSearchFocus', 'true') <> 'false' AND ${relevance} >= ${param(Number(query.minRelevance))}`);
  const where = `WHERE ${clauses.join(' AND ')}`;
  const count = { text: `SELECT COUNT(*)::int AS total,
    (SELECT COUNT(*)::int FROM jobs WHERE tenant_id = $1 AND active IS NOT FALSE) AS active_total,
    (SELECT COUNT(*)::int FROM jobs WHERE tenant_id = $1 AND COALESCE(raw->>'pipelineStage', '') <> '') AS pipeline_total
    ${source} ${where}`, params: [...params] };
  const order = query.sortBy === 'connections' ? `${connectionCount} DESC, ${relevance} DESC, ${posted} DESC, j.id ASC`
    : query.sortBy === 'relevance' ? `${relevance} DESC, ${posted} DESC, j.id ASC`
    : query.sortBy === 'retrieved' ? `COALESCE(j.raw->>'retrievedAt', j.raw->>'importedAt', '') DESC, j.id ASC`
    : `${posted} DESC, j.id ASC`;
  const rows = { text: `SELECT j.raw || jsonb_build_object(
      'accountId', COALESCE(a.id, j.account_id, ''), 'connectionCount', ${connectionCount},
      'hasConnections', ${connectionCount} > 0, 'workStyle', (${workStyle}), 'isRemote', (${workStyle}) = 'remote',
      'isLocal', ${buildJobGeographySql('gta')}, 'seniorContactCount', COALESCE(a.raw->'seniorContactCount', '0'::jsonb),
      'talentContactCount', COALESCE(a.raw->'talentContactCount', '0'::jsonb), 'topContactName', COALESCE(a.raw->>'topContactName', '')
    ) AS raw ${source} ${where} ORDER BY ${order} LIMIT ${param(pageSize)} OFFSET ${param((page - 1) * pageSize)}`, params };
  return { page, pageSize, rows, count };
}
