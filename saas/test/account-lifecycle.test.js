import test from 'node:test';
import assert from 'node:assert/strict';

import { isEmailConfigured, sendEmailVerificationEmail } from '../src/email.js';
import { createUser, markUserEmailVerified, safeUser } from '../src/users.js';

test('email verification delivery degrades safely when outbound email is not configured', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.BD_EMAIL_FROM;
  delete process.env.RESEND_API_KEY;
  delete process.env.BD_EMAIL_FROM;
  try {
    assert.equal(isEmailConfigured(), false);
    const result = await sendEmailVerificationEmail({
      to: 'person@example.com',
      name: 'Person',
      verificationUrl: 'https://example.com/?verify=secret',
    });
    assert.deepEqual(result, { sent: false, reason: 'email_not_configured' });
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.BD_EMAIL_FROM;
    else process.env.BD_EMAIL_FROM = previousFrom;
  }
});

test('users can be durably marked verified without exposing password hashes', async () => {
  const email = `lifecycle-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const created = createUser({ email, name: 'Lifecycle User', password: 'secure-password' });
  assert.ok(created.user);
  assert.equal(created.user.emailVerifiedAt, '');

  const verified = await markUserEmailVerified(created.user.id);
  assert.match(verified.user.emailVerifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(safeUser(verified.user).passwordHash, undefined);
});
