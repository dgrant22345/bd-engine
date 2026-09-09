import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryCodes, hashRecoveryCode, generateUserRecoveryCodes, recoverUserWithCode } from '../src/recovery-codes.js';
import { createUser } from '../src/users.js';
import { createSession, extractSession, verifyPassword } from '../src/auth.js';

test('recovery secrets are random, user-bound, and only hashes are persisted', () => {
  const { codes, hashes } = createRecoveryCodes('alice');
  assert.equal(new Set(codes).size, 8);
  assert.equal(hashes.length, 8);
  for (const [i, code] of codes.entries()) {
    assert.match(code, /^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);
    assert.equal(hashRecoveryCode('alice', code.toLowerCase()), hashes[i]);
    assert.notEqual(hashRecoveryCode('bob', code), hashes[i]);
    assert.equal(hashes[i].includes(code), false);
  }
  assert.equal(hashRecoveryCode('alice', 'guess'), '');
});

test('issuance requires current password; regeneration revokes old codes; redemption is single-use', async () => {
  const { user } = createUser({ email: 'recovery-unit@example.test', password: 'original-password', name: 'Recovery' });
  assert.equal(await generateUserRecoveryCodes(user, 'wrong'), null);
  const old = await generateUserRecoveryCodes(user, 'original-password');
  const codes = await generateUserRecoveryCodes(user, 'original-password');
  assert.equal(await recoverUserWithCode(user, old[0], 'new-password-123'), false);
  const session = await createSession(user.id, 'fixture');
  const results = await Promise.all([recoverUserWithCode(user, codes[0], 'new-password-123'), recoverUserWithCode(user, codes[0], 'another-password')]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(verifyPassword('new-password-123', user.passwordHash), true);
  assert.equal(extractSession({ headers: { cookie: session.cookie } }), null);
  assert.equal(await recoverUserWithCode(user, codes[0], 'again-password'), false);
  assert.equal(await recoverUserWithCode(null, codes[1], 'again-password'), false);
  user.status = 'disabled';
  assert.equal(await recoverUserWithCode(user, codes[1], 'again-password'), false);
});
