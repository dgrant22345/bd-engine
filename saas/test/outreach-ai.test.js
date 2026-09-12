import test from 'node:test';
import assert from 'node:assert/strict';
import { isOutreachAiConfigured, rewriteOutreach } from '../src/outreach-ai.js';
const env = { BD_OUTREACH_AI_ENABLED: 'true', OPENAI_API_KEY: 'test-only', BD_OUTREACH_AI_MODEL: 'test-model' };

test('AI is opt-in and requires a key and model', async () => {
  assert.equal(isOutreachAiConfigured({}), false);
  assert.equal(isOutreachAiConfigured({ ...env, BD_OUTREACH_AI_ENABLED: 'false' }), false);
  await assert.rejects(rewriteOutreach({ draft: 'Hello' }, { env }), /Confirm sharing/);
  await assert.rejects(rewriteOutreach({ draft: 'x'.repeat(6001), consent: true }, { env }), /6,000/);
});
test('AI sends only the bounded draft and disables response storage', async () => {
  const result = await rewriteOutreach({ draft: 'Hi Alex, would a summary help?', consent: true, privateNotes: 'not shared' }, { env, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(options.body);
    assert.equal(request.store, false);
    assert.equal(request.max_output_tokens, 900);
    assert.doesNotMatch(request.input, /not shared/);
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi Alex, is a brief summary useful?' }] }] }) };
  } });
  assert.equal(result.generatedBy, 'ai');
  assert.match(result.text, /Alex/);
});
test('provider failures and incomplete output never masquerade as successful drafts', async () => {
  for (const response of [{ ok: false }, { ok: true, json: async () => ({ status: 'incomplete', output: [] }) }]) {
    await assert.rejects(rewriteOutreach({ draft: 'Hello', consent: true }, { env, fetchImpl: async () => response }), /existing draft is unchanged/);
  }
});
