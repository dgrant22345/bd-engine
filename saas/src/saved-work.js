import { dbQuery, isDbEnabled } from './db.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const kinds = new Set(['draft', 'view']);
function text(value, max) {
  if (typeof value !== 'string' || value.length > max) throw fail(`Use text of no more than ${max} characters.`);
  return value;
}
export function validateSavedWork(kind, input = {}) {
  if (!kinds.has(kind)) throw fail('Unknown saved item type.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Provide a saved item object.');
  const title = text(input.title, 160).trim();
  if (!title) throw fail('Give this saved item a name.');
  const version = Number(input.version);
  if (!Number.isSafeInteger(version) || version < 0) throw fail('A valid saved version is required.');
  const source = input.body || {};
  let body;
  if (kind === 'draft') {
    body = { text: text(source.text, 12000) };
    if (!body.text.trim()) throw fail('Write a message before saving.');
    for (const key of ['contactId', 'accountId', 'jobId', 'recipient']) body[key] = text(source[key] || '', 300);
    for (const [key, max] of [['roleTitle', 500], ['companyName', 300], ['goal', 60], ['background', 1000]]) {
      if (source[key] !== undefined) body[key] = text(source[key], max);
    }
  } else {
    const allowedSorts = ['name', 'name_desc', 'company', 'recent', 'priority'];
    const allowedStages = ['', 'not_started', 'researching', 'ready_to_contact', 'contacted', 'replied', 'opportunity'];
    body = { q: text(source.q || '', 240), outreachStatus: source.outreachStatus || '', sortBy: source.sortBy || 'name', minScore: String(source.minScore || '') };
    if (!allowedSorts.includes(body.sortBy) || !allowedStages.includes(body.outreachStatus) || (body.minScore && !/^\d{1,3}$/.test(body.minScore))) throw fail('Invalid People filters.');
  }
  return { title, body, version };
}

// Separate from the legacy workspace snapshot: each write is durable and scoped,
// and optimistic versions reject stale edits from another tab or device.
export function createSavedWorkStore({ query = dbQuery, enabled = isDbEnabled } = {}) {
  const memory = new Map();
  const scope = (tenantId, userId, kind, id = '') => {
    if (!tenantId || !userId || !kinds.has(kind) || (id && !/^[a-zA-Z0-9_-]{1,160}$/.test(id))) throw fail('Invalid saved item.');
    return JSON.stringify([tenantId, userId, kind, id]);
  };
  const publicItem = row => row && ({ id: row.id, kind: row.kind, title: row.title, body: row.body, version: row.version, updatedAt: row.updated_at });
  return {
    async list(tenantId, userId, kind, { page = 1, q = '', summary = '' } = {}) {
      scope(tenantId, userId, kind);
      page = Math.min(1000000, Math.max(1, Math.floor(Number(page) || 1)));
      q = String(q).slice(0, 240).toLowerCase();
      const startedAt = performance.now();
      let rows;
      let total;
      if (enabled()) {
        if (summary === '1') {
          const result = await query('SELECT count(*) AS total FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind=$3', [tenantId, userId, kind]);
          const elapsed = Math.round(performance.now() - startedAt);
          if (elapsed > 150) console.warn(`Slow saved work: saas/src/saved-work.js summary ${elapsed}ms`);
          return { total: Number(result.rows[0]?.total || 0) };
        }
        const result = await query(`SELECT *, count(*) OVER() AS total FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind=$3 AND strpos(lower(title), $4)>0 ORDER BY updated_at DESC, id LIMIT 50 OFFSET $5`, [tenantId, userId, kind, q, (page - 1) * 50]);
        rows = result.rows;
        if (!rows.length && page > 1) {
          const count = await query('SELECT count(*) AS total FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind=$3 AND strpos(lower(title), $4)>0', [tenantId, userId, kind, q]);
          return this.list(tenantId, userId, kind, { page: Math.max(1, Math.ceil(Number(count.rows[0]?.total || 0) / 50)), q });
        }
        total = Number(rows[0]?.total || 0);
      } else {
        const all = [...memory.values()].filter(row => row.tenant_id === tenantId && row.user_id === userId && row.kind === kind && row.title.toLowerCase().includes(q)).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
        total = all.length; page = Math.min(page, Math.max(1, Math.ceil(total / 50))); rows = all.slice((page - 1) * 50, page * 50);
      }
      const elapsed = Math.round(performance.now() - startedAt);
      if (elapsed > 150) console.warn(`Slow saved work: saas/src/saved-work.js list ${elapsed}ms`);
      return summary === '1' ? { total } : { items: structuredClone(rows.map(publicItem)), total, page, pageSize: 50 };
    },
    async get(tenantId, userId, kind, id) {
      const key = scope(tenantId, userId, kind, id);
      const row = enabled() ? (await query('SELECT * FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind=$3 AND id=$4', [tenantId, userId, kind, id])).rows[0] : memory.get(key);
      return structuredClone(publicItem(row) || null);
    },
    async put(tenantId, userId, kind, id, input) {
      const key = scope(tenantId, userId, kind, id);
      const item = validateSavedWork(kind, input);
      const updatedAt = new Date().toISOString();
      const startedAt = performance.now();
      let row;
      if (enabled()) {
        const params = [tenantId, userId, kind, id, item.title, JSON.stringify(item.body), updatedAt];
        row = item.version === 0
          ? (await query(`INSERT INTO saved_work (tenant_id,user_id,kind,id,title,body,updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT DO NOTHING RETURNING *`, params)).rows[0]
          : (await query(`UPDATE saved_work SET title=$5,body=$6::jsonb,updated_at=$7,version=version+1 WHERE tenant_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND version=$8 RETURNING *`, [...params, item.version])).rows[0];
      } else if ((memory.get(key)?.version || 0) === item.version) {
        row = { tenant_id: tenantId, user_id: userId, kind, id, title: item.title, body: structuredClone(item.body), version: item.version + 1, updated_at: updatedAt };
        memory.set(key, row);
      }
      if (!row) throw fail('This item changed on another device or was removed. Reload the saved copy before saving again. Your current text has not been replaced.', 409);
      const elapsed = Math.round(performance.now() - startedAt);
      if (elapsed > 150) console.warn(`Slow saved work: saas/src/saved-work.js put ${elapsed}ms`);
      return structuredClone(publicItem(row));
    },
    async remove(tenantId, userId, kind, id, version) {
      const key = scope(tenantId, userId, kind, id);
      if (!Number.isSafeInteger(version) || version < 1) throw fail('A saved version is required.');
      const removed = enabled() ? (await query('DELETE FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND version=$5 RETURNING id', [tenantId, userId, kind, id, version])).rows.length : memory.get(key)?.version === version && memory.delete(key);
      if (!removed) throw fail('The saved item changed or was already removed. Reload before deleting.', 409);
      return { ok: true };
    },
    async export(tenantId, userId) {
      return enabled() ? (await query('SELECT * FROM saved_work WHERE tenant_id=$1 AND user_id=$2 ORDER BY kind,id', [tenantId, userId])).rows.map(publicItem) : [...memory.values()].filter(row => row.tenant_id === tenantId && row.user_id === userId).map(publicItem);
    },
    async clearTenant(tenantId) {
      if (enabled()) await query('DELETE FROM saved_work WHERE tenant_id=$1', [tenantId]);
      else for (const [key, row] of memory) if (row.tenant_id === tenantId) memory.delete(key);
    },
  };
}
