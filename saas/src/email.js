const DEFAULT_FROM = 'BD Engine <support@bdengine.io>';

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && (process.env.BD_EMAIL_FROM || process.env.RESEND_FROM));
}

export function getEmailFrom() {
  return String(process.env.BD_EMAIL_FROM || process.env.RESEND_FROM || DEFAULT_FROM).trim();
}

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const recipient = String(to || '').trim();
  if (!recipient || !resetUrl || !isEmailConfigured()) {
    return { sent: false, reason: 'email_not_configured' };
  }

  const subject = 'Reset your BD Engine password';
  const safeName = String(name || 'there').trim() || 'there';
  const text = [
    `Hi ${safeName},`,
    '',
    'Use this link to reset your BD Engine password:',
    resetUrl,
    '',
    'This link expires in 60 minutes. If you did not request it, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(safeName)},</p>
    <p>Use this link to reset your BD Engine password:</p>
    <p><a href="${escapeAttr(resetUrl)}">Reset password</a></p>
    <p>This link expires in 60 minutes. If you did not request it, you can ignore this email.</p>
  `;

  return sendEmail({ recipient, subject, text, html, kind: 'password reset' });
}

export async function sendEmailVerificationEmail({ to, name, verificationUrl }) {
  const recipient = String(to || '').trim();
  if (!recipient || !verificationUrl || !isEmailConfigured()) {
    return { sent: false, reason: 'email_not_configured' };
  }

  const subject = 'Verify your BD Engine email';
  const safeName = String(name || 'there').trim() || 'there';
  const text = [
    `Hi ${safeName},`,
    '',
    'Confirm this email address for your BD Engine account:',
    verificationUrl,
    '',
    'This link expires in 24 hours. If you did not create this account, you can ignore this email.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(safeName)},</p>
    <p>Confirm this email address for your BD Engine account:</p>
    <p><a href="${escapeAttr(verificationUrl)}">Verify email address</a></p>
    <p>This link expires in 24 hours. If you did not create this account, you can ignore this email.</p>
  `;

  return sendEmail({ recipient, subject, text, html, kind: 'email verification' });
}

export async function sendSupportOperatorEmail({ to, requesterName, requesterEmail, workspaceName, ticket, message, supportUrl }) {
  const recipients = normalizeRecipients(to);
  if (!recipients.length || !ticket?.id || !isEmailConfigured()) {
    return { sent: false, reason: 'email_not_configured' };
  }
  const safeSubject = String(ticket.subject || 'Support request').trim().replace(/\s+/g, ' ');
  const safeRequesterName = String(requesterName || 'Customer').trim();
  const safeRequesterEmail = String(requesterEmail || '').trim();
  const safeWorkspace = String(workspaceName || ticket.tenantId || 'Unknown workspace').trim();
  const safeMessage = String(message || '').trim().slice(0, 5000);
  const subject = `[Support] ${safeSubject}`;
  const text = [
    `${safeRequesterName}${safeRequesterEmail ? ` <${safeRequesterEmail}>` : ''} sent a support message.`,
    `Workspace: ${safeWorkspace}`,
    `Ticket: ${ticket.id}`,
    `Category: ${ticket.category || 'other'}`,
    '',
    safeMessage,
    '',
    supportUrl ? `Open the support inbox: ${supportUrl}` : '',
  ].filter(Boolean).join('\n');
  const html = `
    <p><strong>${escapeHtml(safeRequesterName)}</strong>${safeRequesterEmail ? ` &lt;${escapeHtml(safeRequesterEmail)}&gt;` : ''} sent a support message.</p>
    <p>Workspace: ${escapeHtml(safeWorkspace)}<br>Ticket: ${escapeHtml(ticket.id)}<br>Category: ${escapeHtml(ticket.category || 'other')}</p>
    <blockquote>${escapeHtml(safeMessage).replace(/\n/g, '<br>')}</blockquote>
    ${supportUrl ? `<p><a href="${escapeAttr(supportUrl)}">Open the support inbox</a></p>` : ''}
  `;
  return sendEmail({ recipients, subject, text, html, kind: 'support operator notification' });
}

export async function sendSupportCustomerReplyEmail({ to, name, ticket, message, supportUrl }) {
  const recipient = String(to || '').trim();
  if (!recipient || !ticket?.id || !isEmailConfigured()) {
    return { sent: false, reason: 'email_not_configured' };
  }
  const safeName = String(name || 'there').trim() || 'there';
  const safeSubject = String(ticket.subject || 'your support request').trim().replace(/\s+/g, ' ');
  const safeMessage = String(message || '').trim().slice(0, 5000);
  const subject = `Reply from BD Engine support: ${safeSubject}`;
  const text = [
    `Hi ${safeName},`,
    '',
    `BD Engine support replied to ${safeSubject}:`,
    '',
    safeMessage,
    '',
    supportUrl ? `View the conversation and reply: ${supportUrl}` : 'Sign in to BD Engine to view the conversation and reply.',
  ].join('\n');
  const html = `
    <p>Hi ${escapeHtml(safeName)},</p>
    <p>BD Engine support replied to <strong>${escapeHtml(safeSubject)}</strong>:</p>
    <blockquote>${escapeHtml(safeMessage).replace(/\n/g, '<br>')}</blockquote>
    ${supportUrl ? `<p><a href="${escapeAttr(supportUrl)}">View the conversation and reply</a></p>` : '<p>Sign in to BD Engine to view the conversation and reply.</p>'}
  `;
  return sendEmail({ recipient, subject, text, html, kind: 'support customer notification' });
}

async function sendEmail({ recipient, recipients, subject, text, html, kind }) {
  const to = normalizeRecipients(recipients || recipient);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getEmailFrom(),
      to,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email provider rejected ${kind} message (${response.status}): ${body.slice(0, 240)}`);
  }

  return { sent: true };
}

function normalizeRecipients(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => String(item || '').trim().toLowerCase()).filter((item) => item.includes('@')))];
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
