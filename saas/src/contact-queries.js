// Shared query contract: global filtering/sorting, not client-side page sorting.
export const CONTACT_STAGES = ['not_started', 'researching', 'ready_to_contact', 'contacted', 'replied', 'opportunity'];

export function normalizeContactQuery(query = {}) {
  const bounded = (value, fallback, max) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(max, Math.floor(Number(value))) : fallback;
  return {
    page: bounded(query.page, 1, 1000000), pageSize: bounded(query.pageSize, 25, 10000),
    q: String(query.q || '').trim(), id: String(query.id || '').trim(),
    minScore: Number.isFinite(Number(query.minScore)) ? Math.max(0, Number(query.minScore)) : 0,
    outreachStatus: String(query.outreachStatus || '').trim().toLowerCase(),
    sortBy: ['name', 'name_desc', 'company', 'recent', 'priority'].includes(query.sortBy) ? query.sortBy : 'priority',
  };
}

export function compareContacts(a, b, sortBy = 'priority') {
  const name = () => String(a.fullName || '').toLowerCase().localeCompare(String(b.fullName || '').toLowerCase()) || String(a.id).localeCompare(String(b.id));
  if (sortBy === 'name') return name();
  if (sortBy === 'name_desc') return -name();
  if (sortBy === 'company') return String(a.companyName || '').toLowerCase().localeCompare(String(b.companyName || '').toLowerCase()) || name();
  if (sortBy === 'recent') return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || name();
  return Number(b.priorityScore || 0) - Number(a.priorityScore || 0) || name();
}

export function buildContactQuerySql(tenantId, input = {}) {
  const query = normalizeContactQuery(input);
  const params = [tenantId];
  const where = ['tenant_id = $1'];
  const bind = value => { params.push(value); return `$${params.length}`; };
  if (query.id) where.push(`id = ${bind(query.id)}`);
  if (query.q) {
    const value = bind(`%${query.q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(${['full_name', 'company_name', 'title', 'email', 'notes'].map(column => `${column} ILIKE ${value} ESCAPE '\\'`).join(' OR ')})`);
  }
  if (query.minScore) where.push(`priority_score >= ${bind(query.minScore)}`);
  if (query.outreachStatus) where.push(`LOWER(COALESCE(raw->>'outreachStatus', 'not_started')) = ${bind(query.outreachStatus)}`);
  const name = "LOWER(COALESCE(full_name, '')) ASC, id ASC";
  const orders = { name, name_desc: "LOWER(COALESCE(full_name, '')) DESC, id DESC", company: `LOWER(COALESCE(company_name, '')) ASC, ${name}`, recent: `updated_at DESC, ${name}`, priority: `priority_score DESC, ${name}` };
  const countParams = [...params];
  const limit = bind(query.pageSize);
  const offset = bind((query.page - 1) * query.pageSize);
  return { ...query, params, countParams, where: where.join(' AND '), order: orders[query.sortBy], limit, offset };
}

export function validateContactInput(input, { create = false } = {}) {
  const fail = message => { const error = new Error(message); error.status = 400; throw error; };
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Provide contact fields.');
  const fields = { fullName: 200, title: 300, email: 320, linkedinUrl: 2000, notes: 20000, outreachStatus: 40 };
  if (create) fields.companyName = 300;
  const result = {};
  for (const [key, max] of Object.entries(fields)) {
    if (!Object.hasOwn(input, key)) continue;
    if (typeof input[key] !== 'string' || input[key].length > max) fail(`${key} must be text no longer than ${max} characters.`);
    result[key] = key === 'notes' ? input[key] : input[key].trim();
  }
  // Preserve first/last-name callers without bypassing the name validation.
  if (create && !Object.hasOwn(result, 'fullName')) {
    for (const key of ['firstName', 'lastName']) {
      if (input[key] != null && (typeof input[key] !== 'string' || input[key].length > 200)) fail('Name fields must be text no longer than 200 characters.');
    }
    result.fullName = `${input.firstName || ''} ${input.lastName || ''}`.trim();
    if (result.fullName.length > 200) fail('Full name must be no longer than 200 characters.');
  }
  if ((create || Object.hasOwn(result, 'fullName')) && !result.fullName) fail('Enter a full name.');
  if (result.outreachStatus && !CONTACT_STAGES.includes(result.outreachStatus)) fail('Choose a valid outreach stage.');
  if (result.linkedinUrl) {
    let url;
    try { url = new URL(result.linkedinUrl); } catch { fail('Enter a complete HTTPS profile URL.'); }
    if (!['https:', 'http:'].includes(url.protocol)) fail('Use an HTTP or HTTPS profile URL.');
  }
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) fail('Enter a valid email address.');
  return result;
}
