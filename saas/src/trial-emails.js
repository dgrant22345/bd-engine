import { createHash } from 'node:crypto';
import { dbQuery, dbTransaction, isDbEnabled } from './db.js';

// Three emails during a free trial, each sent at most once to the workspace
// owner, and only with a verified address:
// - welcome: within two days of signup (later signups that predate this
//   feature are not welcomed after the fact);
// - add_companies: from day 3, only while the workspace has no companies;
// - trial_ending: in the last three days of the trial.
// The owner can stop them from Settings; every message says why it was sent
// and links there. State lives in saved_work beside the other email settings.
export const TRIAL_EMAILS_ID = 'trial-emails';
export const TRIAL_EMAIL_KINDS = ['welcome', 'add_companies', 'trial_ending'];
const DAY = 86_400_000;

// Which trial email, if any, is due now for one owner.
export function dueTrialEmail({ createdAt, now = new Date(), sent = {}, companyCount = 0, trialDays = 14 }) {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return '';
  const age = (now.getTime() - created) / DAY;
  const left = trialDays - age;
  if (age < 0 || left <= 0) return '';
  if (!sent.welcome && age < 2) return 'welcome';
  if (!sent.add_companies && age >= 3 && left > 3 && Number(companyCount) === 0) return 'add_companies';
  if (!sent.trial_ending && left <= 3) return 'trial_ending';
  return '';
}

export function trialEndDate(createdAt, trialDays = 14) {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) ? new Date(created + trialDays * DAY) : null;
}

const formatDate = (date) => date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

// The messages, in the company's voice. Plain text and simple HTML; every
// message ends with why it was sent and how to stop these emails.
export function buildTrialEmail(kind, { name = '', createdAt, appUrl, companiesUrl, billingUrl, settingsUrl, persona = 'bd', trialDays = 14 }) {
  const hello = `Hi ${String(name || '').trim().split(/\s+/)[0] || 'there'},`;
  const ends = trialEndDate(createdAt, trialDays);
  const endsOn = ends ? formatDate(ends) : 'the end of your trial';
  const jobSeeker = persona === 'jobseeker';
  const footer = 'You are receiving this because you started a BD Engine trial.';
  let subject; let paragraphs; let link;
  if (kind === 'welcome') {
    subject = jobSeeker ? 'Welcome to BD Engine: a plan for your search in three steps' : 'Welcome to BD Engine: your first call list in three steps';
    paragraphs = jobSeeker
      ? ['Your BD Engine trial has started. Three steps give your search a plan:',
        ['Add five companies you would like to work for. BD Engine reads their public job boards.',
          'Import your LinkedIn Connections.csv so the people you know are linked to those companies.',
          'Open Hiring activity to see the relevant roles, and who you know at each company.'],
        `Your trial runs until ${endsOn}. No card is needed during the trial.`]
      : ['Your BD Engine trial has started. Three steps get you to your first call list:',
        ['Add five companies you would like to work with. BD Engine reads their public job boards.',
          'Import your LinkedIn Connections.csv so people are linked to those companies.',
          'Open Today to see who to call, with the open roles at their company.'],
        `Your trial runs until ${endsOn}. No card is needed during the trial.`];
    link = { href: appUrl, label: 'Open your workspace' };
  } else if (kind === 'add_companies') {
    subject = 'BD Engine needs a few companies to watch';
    paragraphs = [
      'Your workspace has no companies yet, so BD Engine has no job boards to read.',
      'Paste five company domains or careers pages and BD Engine will look for their open roles within a few minutes. Starter lists for fintech, cybersecurity, AI and health tech are there if you want a quick start.',
    ];
    link = { href: companiesUrl, label: 'Add companies' };
  } else if (kind === 'trial_ending') {
    subject = `Your BD Engine trial ends on ${endsOn}`;
    paragraphs = [
      `Your free trial ends on ${endsOn}. To keep using your workspace after that, choose a plan before then.`,
      jobSeeker ? 'Job Seeker is $5 USD a month.' : 'Recruiter Pro is $10 USD a month.',
    ];
    link = { href: billingUrl, label: 'Choose a plan' };
  } else {
    throw new Error(`Unknown trial email: ${kind}`);
  }
  const textLines = [hello, ''];
  for (const part of paragraphs) {
    if (Array.isArray(part)) part.forEach((step, index) => textLines.push(`${index + 1}. ${step}`));
    else textLines.push(part);
    textLines.push('');
  }
  textLines.push(`${link.label}: ${link.href}`, '', footer, `Stop trial emails: ${settingsUrl}`);
  const html = [`<p>${escapeHtml(hello)}</p>`,
    ...paragraphs.map(part => Array.isArray(part) ? `<ol>${part.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : `<p>${escapeHtml(part)}</p>`),
    `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`,
    `<p style="color:#526272;font-size:13px">${escapeHtml(footer)} <a href="${escapeHtml(settingsUrl)}">Stop trial emails</a>.</p>`].join('');
  return { subject, text: textLines.join('\n'), html };
}

export function createTrialEmailStore({ query = dbQuery, transaction = dbTransaction, enabled = isDbEnabled } = {}) {
  const memory = new Map();
  const key = (tenantId, userId) => JSON.stringify([tenantId, userId]);
  const read = row => ({ version: Number(row?.version || 0), optedOut: row?.body?.optedOut === true, sent: { ...(row?.body?.sent || {}) } });
  const selectRow = (run, tenantId, userId, lock = '') => run(`SELECT body,version FROM saved_work WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3${lock}`, [tenantId, userId, TRIAL_EMAILS_ID]);
  const writeBody = async (run, tenantId, userId, prior, body, { bumpVersion = false } = {}) => {
    const now = new Date().toISOString();
    if (prior) {
      return (await run(`UPDATE saved_work SET body=$4::jsonb,updated_at=$5${bumpVersion ? ',version=version+1' : ''} WHERE tenant_id=$1 AND user_id=$2 AND kind='view' AND id=$3 RETURNING body,version`,
        [tenantId, userId, TRIAL_EMAILS_ID, JSON.stringify(body), now])).rows[0];
    }
    return (await run(`INSERT INTO saved_work (tenant_id,user_id,kind,id,title,body,updated_at) VALUES ($1,$2,'view',$3,'Trial emails',$4::jsonb,$5) ON CONFLICT DO NOTHING RETURNING body,version`,
      [tenantId, userId, TRIAL_EMAILS_ID, JSON.stringify(body), now])).rows[0];
  };
  const bodyOf = (row, patch) => ({ viewType: TRIAL_EMAILS_ID, optedOut: row?.body?.optedOut === true, sent: { ...(row?.body?.sent || {}) }, ...patch });

  return {
    async get(tenantId, userId) {
      const row = enabled() ? (await selectRow(query, tenantId, userId)).rows[0] : memory.get(key(tenantId, userId));
      return read(row);
    },
    // The owner's choice: optedOut true stops every trial email.
    async put(tenantId, userId, input) {
      if (typeof input?.optedOut !== 'boolean' || !Number.isInteger(input?.version)) throw Object.assign(new Error('Send optedOut (true or false) and the settings version.'), { status: 400 });
      if (!enabled()) {
        const prior = memory.get(key(tenantId, userId));
        if (Number(prior?.version || 0) !== input.version) throw Object.assign(new Error('Email settings changed. Reload before saving.'), { status: 409 });
        const row = { body: bodyOf(prior, { optedOut: input.optedOut }), version: input.version + 1 };
        memory.set(key(tenantId, userId), row);
        return read(row);
      }
      return transaction(async tx => {
        const prior = (await selectRow(tx, tenantId, userId, ' FOR UPDATE')).rows[0];
        if (Number(prior?.version || 0) !== input.version) throw Object.assign(new Error('Email settings changed. Reload before saving.'), { status: 409 });
        const row = await writeBody(tx, tenantId, userId, prior, bodyOf(prior, { optedOut: input.optedOut }), { bumpVersion: true });
        if (!row) throw Object.assign(new Error('Email settings changed. Reload before saving.'), { status: 409 });
        return read(row);
      });
    },
    // Trial owners with a verified email whose trial is still running, in
    // bounded batches. Opted-out owners and finished sequences are left out.
    async candidates(cursor = '', { now = new Date(), trialDays = 14, demoSlug = 'bd-engine-demo' } = {}) {
      if (!enabled()) return [];
      const since = new Date(now.getTime() - trialDays * DAY).toISOString();
      return (await query(`SELECT t.id AS tenant_id, u.id AS user_id FROM tenants t
        JOIN memberships m ON m.tenant_id=t.id AND m.role='owner'
        JOIN users u ON u.id=m.user_id
        LEFT JOIN saved_work s ON s.tenant_id=t.id AND s.user_id=u.id AND s.kind='view' AND s.id=$1
        WHERE t.plan='trial' AND t.status IN ('trialing','active') AND t.slug<>$2 AND t.created_at>$3
        AND u.status='active' AND coalesce(u.email_verified_at,'')<>''
        AND coalesce(s.body->>'optedOut','false')<>'true' AND coalesce(s.body->'sent'->>'trial_ending','')=''
        AND (t.id || ':' || u.id)>$4 ORDER BY t.id,u.id LIMIT 20`, [TRIAL_EMAILS_ID, demoSlug, since, cursor])).rows;
    },
    // Sends the one email due, if any, under a per-owner lock so two servers
    // cannot send it twice; records it only after the provider accepts it.
    async deliver(tenantId, userId, { now = new Date(), getRecipient, getCompanyCount, send, trialDays = 14 }) {
      const work = async tx => {
        let row;
        if (enabled()) {
          await tx('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`${TRIAL_EMAILS_ID}:${tenantId}:${userId}`]);
          row = (await selectRow(tx, tenantId, userId, ' FOR UPDATE')).rows[0];
        } else row = memory.get(key(tenantId, userId));
        if (row?.body?.optedOut === true) return { sent: false, reason: 'opted_out' };
        const recipient = await getRecipient(tenantId, userId);
        if (!recipient?.eligible) return { sent: false, reason: 'ineligible' };
        let sent = row?.body?.sent || {};
        let kind = dueTrialEmail({ createdAt: recipient.tenantCreatedAt, now, sent, companyCount: 0, trialDays });
        // Count companies only when the reminder to add them is due, once: a
        // workspace that has companies never needs it.
        if (kind === 'add_companies' && Number(await getCompanyCount(tenantId)) > 0) {
          sent = { ...sent, add_companies: 'not_needed' };
          const body = bodyOf(row, { sent });
          if (enabled()) row = await writeBody(tx, tenantId, userId, row, body);
          else memory.set(key(tenantId, userId), row = { body, version: Number(row?.version || 0) });
          kind = dueTrialEmail({ createdAt: recipient.tenantCreatedAt, now, sent, companyCount: 1, trialDays });
        }
        if (!kind) return { sent: false, reason: 'not_due' };
        const idempotencyKey = createHash('sha256').update(JSON.stringify([TRIAL_EMAILS_ID, tenantId, userId, kind])).digest('hex');
        const result = await send({ ...recipient, kind, idempotencyKey });
        if (!result?.sent) return result || { sent: false, reason: 'not_sent' };
        const body = bodyOf(row, { sent: { ...sent, [kind]: now.toISOString() } });
        if (enabled()) await writeBody(tx, tenantId, userId, row, body);
        else memory.set(key(tenantId, userId), { body, version: Number(row?.version || 0) });
        return { sent: true, kind };
      };
      return enabled() ? transaction(work) : work();
    },
    async clearTenant(tenantId) { for (const entry of memory.keys()) if (JSON.parse(entry)[0] === tenantId) memory.delete(entry); },
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
