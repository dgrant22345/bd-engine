/**
 * SQL-backed read paths against the rel_* tables. Drop-in equivalents for the
 * in-memory store read methods — same output shape ({ items, page, pageSize,
 * total }) and same filter/sort/pagination semantics, so they can be swapped in
 * behind the BD_USE_RELATIONAL flag once writes also update rel_* (dual-write).
 *
 * `db` is any object with `.query(sql, params)` (a pg Pool or Client).
 */

function likeParam(value) {
  // Escape LIKE wildcards so the match is literal, matching JS `.includes()`.
  return `%${String(value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function pageParams(query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const pageSize = Math.max(1, Math.min(10000, Number(query.pageSize || 25)));
  return { page, pageSize, offset: (page - 1) * pageSize, limit: pageSize };
}

// Build the "q" text-search clause across the given columns/JSONB fields.
function textSearch(q, fields, params) {
  const trimmed = String(q || '').trim();
  if (!trimmed) return '';
  params.push(likeParam(trimmed));
  const p = `$${params.length}`;
  return ' AND (' + fields.map((f) => `${f} ILIKE ${p}`).join(' OR ') + ')';
}

export async function findAccounts(db, tenantId, query = {}) {
  const { page, pageSize, offset, limit } = pageParams(query);
  const params = [tenantId];
  // filterText fields: displayName, domain, industry, location, owner, notes.
  const where = 'tenant_id = $1' + textSearch(query.q, [
    'display_name', 'domain', "data->>'industry'", "data->>'location'", "data->>'owner'", "data->>'notes'",
  ], params);
  const total = (await db.query(`SELECT count(*)::int AS c FROM rel_accounts WHERE ${where}`, params)).rows[0].c;
  const rows = (await db.query(
    `SELECT data FROM rel_accounts WHERE ${where} ORDER BY target_score DESC, ord ASC LIMIT ${limit} OFFSET ${offset}`,
    params)).rows;
  return { items: rows.map((r) => r.data), page, pageSize, total };
}

export async function findContacts(db, tenantId, query = {}) {
  const { page, pageSize, offset, limit } = pageParams(query);
  const params = [tenantId];
  // filterText fields: fullName, companyName, title, email, notes.
  const where = 'tenant_id = $1' + textSearch(query.q, [
    'full_name', 'company_name', 'title', 'email', "data->>'notes'",
  ], params);
  const total = (await db.query(`SELECT count(*)::int AS c FROM rel_contacts WHERE ${where}`, params)).rows[0].c;
  const rows = (await db.query(
    `SELECT data FROM rel_contacts WHERE ${where} ORDER BY priority_score DESC, ord ASC LIMIT ${limit} OFFSET ${offset}`,
    params)).rows;
  return { items: rows.map((r) => r.data), page, pageSize, total };
}
