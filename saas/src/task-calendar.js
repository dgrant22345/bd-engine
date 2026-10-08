import { createHash } from 'node:crypto';

function escape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

function fold(line) {
  const parts = []; let current = ''; let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > 75) { parts.push(current); current = ' '; bytes = 1; }
    current += char; bytes += size;
  }
  parts.push(current); return parts.join('\r\n');
}

function dateKey(value) {
  const key = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : '';
}

export function buildTaskCalendar(tenantId, tasks, { origin, now = new Date() } = {}) {
  const base = new URL(origin);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BD Engine//Follow-ups//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:BD Engine follow-ups'];
  for (const task of tasks) {
    const key = dateKey(task.dueDate);
    if (task.status !== 'pending' || !key) continue;
    const next = new Date(`${key}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    const uid = createHash('sha256').update(JSON.stringify([tenantId, task.id])).digest('hex').slice(0, 40);
    const link = new URL('/app/#/tasks', base).href;
    lines.push('BEGIN:VEVENT', `UID:${uid}@${base.hostname}`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${key.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`,
      `SUMMARY:${escape(task.summary || task.title || 'Follow-up')}`,
      `DESCRIPTION:${escape([task.contactName, task.accountName, 'Open BD Engine to review, reschedule, or mark this task done.', link].filter(Boolean).join('\n'))}`,
      `URL:${link}`, 'STATUS:CONFIRMED', 'TRANSP:TRANSPARENT', 'BEGIN:VALARM', 'ACTION:DISPLAY',
      'TRIGGER:PT9H', `DESCRIPTION:${escape(task.summary || task.title || 'BD Engine follow-up')}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
