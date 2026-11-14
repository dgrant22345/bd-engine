import { createHash } from 'node:crypto';
import { dbQuery, dbTransaction, isDbEnabled } from './db.js';

export const REMINDER_ID = 'followup-reminders';
// A second, weekly preference that uses the same storage and delivery rules.
export const ROLE_DIGEST_ID = 'weekly-role-digest';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validateReminderPreferences(input, viewType = 'followups') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Provide reminder preferences.');
  if (typeof input?.emailEnabled !== 'boolean') throw fail('Choose whether to receive email reminders.');
  if (!Number.isSafeInteger(input.version) || input.version < 0) throw fail('Reload reminder settings before saving.');
  const timezone = String(input.timezone || '');
  if (!timezone || timezone.length > 100) throw fail('Choose a valid time zone.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); } catch { throw fail('Choose a valid time zone.'); }
  const hour = Number(input.hour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw fail('Choose a reminder hour from 0 to 23.');
  return { viewType, emailEnabled: input.emailEnabled, timezone, hour };
}
export function reminderClock(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}
// Monday of the week containing a YYYY-MM-DD date.
export function weekStartDate(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}
// cadence 'daily' sends once per local day at or after the chosen hour.
// cadence 'weekly' sends once per local week, from Monday at the chosen hour;
// a week with nothing to report is recorded as handled without an email, and
// a new subscription starts with the following week.
export function createReminderStore({ query = dbQuery, transaction = dbTransaction, enabled = isDbEnabled, id = REMINDER_ID, title = 'Follow-up reminders', viewType = 'followups', cadence = 'daily' } = {}) {
  const REMINDER_ID = id;
  const weekly = cadence === 'weekly';
  const firstPeriod = (body, prior, now = new Date()) => prior?.body?.lastSentDate || (weekly && body.emailEnabled ? reminderClock(body.timezone, now).date : '');
  const memory = new Map();
  const key = (tenantId, userId) => JSON.stringify([tenantId, userId]);
  const read = row => ({ version: Number(row?.version || 0), emailEnabled: row?.body?.emailEnabled === true, timezone: row?.body?.timezone || 'UTC', hour: row?.body?.hour ?? 9 });
  return {
    async get(tenantId, userId) {
      const row = enabled() ? (await query("SELECT body,version FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3", [tenantId, userId, REMINDER_ID])).rows[0] : memory.get(key(tenantId, userId));
      return read(row);
    },
    async put(tenantId, userId, input, { now = new Date() } = {}) {
      const body = validateReminderPreferences(input, viewType);
      if (enabled()) {
        return transaction(async tx => {
          const prior = (await tx("SELECT body,version FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3 FOR UPDATE", [tenantId, userId, REMINDER_ID])).rows[0];
          if (Number(prior?.version || 0) !== input.version) throw fail('Reminder settings changed. Reload before saving.', 409);
          // Keep delivery state private and intact when the user changes preferences.
          Object.assign(body, { lastSentDate: firstPeriod(body, prior, now) });
          const params = [tenantId, userId, REMINDER_ID, JSON.stringify(body), new Date().toISOString()];
          const result = prior
            ? await tx("UPDATE saved_work SET body=$4::jsonb,version=version+1,updated_at=$5 WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3 RETURNING body,version", params)
            : await tx("INSERT INTO saved_work (tenant_id,user_id,kind,id,title,body,updated_at) VALUES ($1,$2,'view',$3,$6,$4::jsonb,$5) ON CONFLICT DO NOTHING RETURNING body,version", [...params, title]);
          if (!result.rows[0]) throw fail('Reminder settings changed. Reload before saving.', 409);
          return read(result.rows[0]);
        });
      }
      const prior = memory.get(key(tenantId, userId));
      if (Number(prior?.version || 0) !== input.version) throw fail('Reminder settings changed. Reload before saving.', 409);
      const row = { body: { ...body, lastSentDate: firstPeriod(body, prior, now) }, version: input.version + 1 };
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
          await tx('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${weekly ? `${REMINDER_ID}:` : 'reminder:'}${tenantId}:${userId}`]);
          row = (await tx("SELECT body,version FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3 FOR UPDATE", [tenantId, userId, REMINDER_ID])).rows[0];
        } else row = memory.get(key(tenantId, userId));
        if (!row?.body?.emailEnabled) return { sent: false, reason: 'disabled' };
        const clock = reminderClock(row.body.timezone, now);
        const weekStart = weekly ? weekStartDate(clock.date) : '';
        if (weekly
          ? (row.body.lastSentDate >= weekStart || (clock.date === weekStart && clock.hour < row.body.hour))
          : (clock.hour < row.body.hour || row.body.lastSentDate >= clock.date)) return { sent: false, reason: 'not_due' };
        const markHandled = async () => {
          const body = { ...row.body, lastSentDate: clock.date };
          // Delivery bookkeeping does not invalidate a customer's preference version.
          if (enabled()) await tx("UPDATE saved_work SET body=$4::jsonb WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3", [tenantId, userId, REMINDER_ID, JSON.stringify(body)]);
          else memory.set(key(tenantId, userId), { ...row, body });
        };
        const recipient = await getRecipient(tenantId, userId);
        if (!recipient?.eligible) return { sent: false, reason: 'ineligible' };
        const tasks = await getTasks(tenantId, clock.date);
        if (!tasks.items.length) {
          if (weekly) await markHandled();
          return { sent: false, reason: weekly ? 'nothing_new' : 'no_due_tasks' };
        }
        const idempotencyKey = createHash('sha256').update(JSON.stringify(weekly ? [REMINDER_ID, tenantId, userId, weekStart] : [tenantId, userId, clock.date])).digest('hex');
        const result = await send({ ...recipient, tasks: tasks.items, total: tasks.total, summary: tasks.summary, date: clock.date, idempotencyKey });
        if (!result.sent) return result;
        await markHandled();
        return result;
      };
      return enabled() ? transaction(work) : work();
    },
    async clearTenant(tenantId) { for (const entry of memory.keys()) if (JSON.parse(entry)[0] === tenantId) memory.delete(entry); },
  };
}

// Roles that are new in the past seven days, grouped by company, for the
// weekly digest: newSince is the source posting date, or first sight after the
// board's first import (see getJobNewSince in store.js). One bounded query per
// subscribed workspace per week.
export async function getNewRoleDigest(tenantId, { now = new Date(), query = dbQuery } = {}) {
  const startedAt = performance.now();
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const result = await query(`SELECT company_name, count(*)::int AS new_roles,
      (array_agg(title ORDER BY coalesce(raw->>'newSince',nullif(first_seen_at,''),created_at) DESC, id))[1:3] AS titles,
      count(*) OVER()::int AS company_count, (sum(count(*)) OVER())::int AS total_roles
    FROM jobs WHERE tenant_id=$1 AND active AND company_name<>'' AND coalesce(raw->>'newSince',nullif(first_seen_at,''),created_at)>=$2
    GROUP BY company_name ORDER BY new_roles DESC, company_name LIMIT 8`, [tenantId, since]);
  const elapsed = Math.round(performance.now() - startedAt);
  if (elapsed > 250) console.warn(`Slow role digest: saas/src/followup-reminders.js getNewRoleDigest ${elapsed}ms`);
  return {
    items: result.rows.map(row => ({ companyName: row.company_name, newRoles: Number(row.new_roles), titles: (row.titles || []).filter(Boolean) })),
    total: Number(result.rows[0]?.total_roles || 0),
    summary: { companyCount: Number(result.rows[0]?.company_count || 0) },
  };
}
