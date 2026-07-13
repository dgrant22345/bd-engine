import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSupportCustomerReplyEmail, sendSupportOperatorEmail } from '../src/email.js';

function withEmailProvider(run) {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.BD_EMAIL_FROM;
  const previousFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.BD_EMAIL_FROM = 'BD Engine <support@example.com>';
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
  };
  return Promise.resolve(run(requests)).finally(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.BD_EMAIL_FROM;
    else process.env.BD_EMAIL_FROM = previousFrom;
  });
}

test('support operator notifications deduplicate recipients and escape customer content', async () => {
  await withEmailProvider(async (requests) => {
    const result = await sendSupportOperatorEmail({
      to: ['Owner@Example.com', 'owner@example.com', 'support@example.com'],
      requesterName: '<Dana>',
      requesterEmail: 'dana@example.com',
      workspaceName: 'Acme & Co',
      ticket: { id: 'support-123', subject: 'Jobs are missing', category: 'job_discovery' },
      message: '<script>alert(1)</script>\nPlease help.',
      supportUrl: 'https://bdengine.example/',
    });

    assert.equal(result.sent, true);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body.to, ['owner@example.com', 'support@example.com']);
    assert.match(requests[0].body.subject, /Jobs are missing/);
    assert.doesNotMatch(requests[0].body.html, /<script>/);
    assert.match(requests[0].body.html, /&lt;script&gt;/);
    assert.match(requests[0].body.text, /support-123/);
  });
});

test('customer notifications include the support reply and conversation link', async () => {
  await withEmailProvider(async (requests) => {
    const result = await sendSupportCustomerReplyEmail({
      to: 'dana@example.com',
      name: 'Dana',
      ticket: { id: 'support-123', subject: 'Jobs are missing' },
      message: 'We refreshed your board and the jobs are visible now.',
      supportUrl: 'https://bdengine.example/',
    });

    assert.equal(result.sent, true);
    assert.deepEqual(requests[0].body.to, ['dana@example.com']);
    assert.match(requests[0].body.subject, /Reply from BD Engine support/);
    assert.match(requests[0].body.text, /jobs are visible now/);
    assert.match(requests[0].body.html, /View the conversation and reply/);
  });
});
