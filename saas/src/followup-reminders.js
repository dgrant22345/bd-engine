import { createHash } from 'node:crypto';
import { dbQuery, dbTransaction, isDbEnabled } from './db.js';

export const REMINDER_ID = 'followup-reminders';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validateReminderPreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Provide reminder preferences.');
  if (typeof input?.emailEnabled !== 'boolean') throw fail('Choose whether to receive email reminders.');
  if (!Number.isSafeInteger(input.version) || input.version < 0) throw fail('Reload reminder settings before saving.');
  const timezone = String(input.timezone || '');
  if (!timezone || timezone.length > 100) throw fail('Choose a valid time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw fail('Choose a valid time zone.'); }
  const hour = Number(input.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw fail('Choose a reminder hour from 0 to 23.');
  return { viewType: 'followups', emailEnabled: input.emailEnabled, timezone, hour };
}
export function reminderClock(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}
export function createReminderStore({ query = dbQuery, transaction = dbTransaction, enabled = isDbEnabled } = {}) {
  const memory = new Map();
  const key = (tenantId, userId) => JSON.stringify([tenantId, userId]);
  const read = row => ({ version: Number(row?.version || 0), emailEnabled: row?.body?.emailEnabled === true, timezone: row?.body?.timezone || 'UTC', hour: row?.body?.hour ?? 9 });
  return {
    async get(tenantId, userId) {
      const row = enabled() ? (await query("SELECT body,version FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3", [tenantId, userId, REMINDER_ID])).rows[0] : memory.get(key(tenantId, userId));
      return read(row);
    },
    async put(tenantId, userId, input) {
      const body = validateReminderPreferences(input);
      if (enabled()) {
        return transaction(async tx => {
          const prior = (await tx("SELECT body,version FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3 FOR UPDATE", [tenantId, userId, REMINDER_ID])).rows[0];
          if (Number(prior?.version || 0) !== input.version) throw fail('Reminder settings changed. Reload before saving.', 409);
          // Keep delivery state private and intact when the user changes preferences.
          Object.assign(body, { lastSentDate: prior?.body?.lastSentDate || '' });
          const params = [tenantId, userId, REMINDER_ID, JSON.stringify(body), new Date().toISOString()];
          const result = prior
            ? await tx("UPDATE saved_work SET body=$4::jsonb,version=version+1,updated_at=$5 WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3 RETURNING body,version", params)
            : await tx("INSERT INTO saved_work (tenant_id,user_id,kind,id,title,body,updated_at) VALUES ($1,$2,'view',$3,'Follow-up reminders',$4::jsonb,$5) ON CONFLICT DO NOTHING RETURNING body,version", params);
          if (!result.rows[0]) throw fail('Reminder settings changed. Reload before saving.', 409);
          return read(result.rows[0]);
        });
      }
      const prior = memory.get(key(tenantId, userId));
      if (Number(prior?.version || 0) !== input.version) throw fail('Reminder settings changed. Reload before saving.', 409);
      const row = { body: { ...body, lastSentDate: prior?.body?.lastSentDate || '' }, version: input.version + 1 };
      memory.set(key(tenantId, userId), row); return read(row);
    },
    async candidates(cursor = '') {
      if (!enabled()) return [];
      // No snapshot loads. Rotate through opted-in recipients in bounded batches.
      return (await query(`SELECT s.tenant_id,s.user_id FROM saved_work s
        JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=s.tenant_id
        JOIN memberships m ON m.tenant_id=s.tenant_id AND m.user_id=s.user_id
        WHERE s.kind='view' AND s.id=$1 AND s.body->>'emailEnabled'='true'
        AND u.status='active' AND coalesce(u.email_verified_at,'')<>''
        AND t.status IN ('active','trialing') AND t.slug<>$2 AND m.role IN ('owner','admin','member')
        AND (s.tenant_id || ':' || s.user_id)>$3 ORDER BY s.tenant_id,s.user_id LIMIT 20`, [REMINDER_ID, 'bd-engine-demo', cursor])).rows;
    },
    async deliver(tenantId, userId, { now = new Date(), getRecipient, getTasks, send }) {
      const work = async tx => {
        let row;
        if (enabled()) {
          await tx('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`reminder:${tenantId}:${userId}`]);
          row = (await tx("SELECT body,version FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3 FOR UPDATE", [tenantId, userId, REMINDER_ID])).rows[0];
        } else row = memory.get(key(tenantId, userId));
        if (!row?.body?.emailEnabled) return { sent: false, reason: 'disabled' };
        const clock = reminderClock(row.body.timezone, now);
        if (clock.hour < row.body.hour || row.body.lastSentDate >= clock.date) return { sent: false, reason: 'not_due' };
        const recipient = await getRecipient(tenantId, userId);
        if (!recipient?.eligible) return { sent: false, reason: 'ineligible' };
        const tasks = await getTasks(tenantId, clock.date);
        if (!tasks.items.length) return { sent: false, reason: 'no_due_tasks' };
        const idempotencyKey = createHash('sha256').update(JSON.stringify([tenantId, userId, clock.date])).digest('hex');
        const result = await send({ ...recipient, tasks: tasks.items, total: tasks.total, date: clock.date, idempotencyKey });
        if (!result.sent) return result;
        const body = { ...row.body, lastSentDate: clock.date };
        // Delivery bookkeeping does not invalidate a customer's preference version.
        if (enabled()) await tx("UPDATE saved_work SET body=$4::jsonb WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3", [tenantId, userId, REMINDER_ID, JSON.stringify(body)]);
        else memory.set(key(tenantId, userId), { ...row, body });
        return result;
      };
      return enabled() ? transaction(work) : work();
    },
    async clearTenant(tenantId) { for (const entry of memory.keys()) if (JSON.parse(entry)[0] === tenantId) memory.delete(entry); },
  };
}
