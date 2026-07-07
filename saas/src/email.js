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

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getEmailFrom(),
      to: [recipient],
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Email provider rejected password reset message (${response.status}): ${body.slice(0, 240)}`);
  }

  return { sent: true };
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
