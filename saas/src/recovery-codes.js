import { randomBytes, createHash } from 'node:crypto';
import { dbTransaction, isDbEnabled, isDbReady } from './db.js';
import { hashPassword, verifyPassword, forgetUserSessions } from './auth.js';

const memoryCodes = new Map();

function requireRecoveryStorage() {
  if (isDbEnabled() && !isDbReady()) throw new Error('Recovery storage is temporarily unavailable.');
}

export async function generateUserRecoveryCodes(user, password) {
  requireRecoveryStorage();
  if (!user || user.status !== 'active' || !verifyPassword(password, user.passwordHash)) return null;
  const expectedPasswordHash = user.passwordHash;
  const result = createRecoveryCodes(user.id);
  const saved = isDbEnabled() ? await dbTransaction(async (query) => {
    const current = await query('SELECT password_hash, status FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    if (current.rows[0]?.status !== 'active' || current.rows[0]?.password_hash !== expectedPasswordHash) return false;
    await query('DELETE FROM account_recovery_codes WHERE user_id = $1', [user.id]);
    for (const digest of result.hashes) {
      await query('INSERT INTO account_recovery_codes (user_id, code_hash, created_at) VALUES ($1, $2, $3)', [user.id, digest, new Date().toISOString()]);
    }
    return true;
  }) : (memoryCodes.set(user.id, new Set(result.hashes)), true);
  return saved ? result.codes : null;
}

export async function recoverUserWithCode(user, code, password) {
  requireRecoveryStorage();
  const digest = hashRecoveryCode(user?.id || '', code);
  if (!user || user.status !== 'active' || !digest) return false;
  const passwordHash = hashPassword(password);
  const timestamp = new Date().toISOString();
  const recovered = isDbEnabled() ? await dbTransaction(async (query) => {
    // Serialize issuance and redemption across processes. The code and password
    // update commit together, so a failed write cannot burn a recovery code.
    const current = await query('SELECT id FROM users WHERE id = $1 AND status = $2 FOR UPDATE', [user.id, 'active']);
    if (!current.rowCount) return false;
    const consumed = await query('DELETE FROM account_recovery_codes WHERE user_id = $1 AND code_hash = $2 RETURNING code_hash', [user.id, digest]);
    if (!consumed.rowCount) return false;
    await query('UPDATE users SET password_hash = $2, updated_at = $3 WHERE id = $1', [user.id, passwordHash, timestamp]);
    await query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
    return true;
  }) : Boolean(memoryCodes.get(user.id)?.delete(digest));
  if (!recovered) return false;
  user.passwordHash = passwordHash;
  user.updatedAt = timestamp;
  forgetUserSessions(user.id);
  return true;
}

export function normalizeRecoveryCode(value) {
  const code = String(value || '').replace(/[\s-]/g, '').toUpperCase();
  return /^[A-F0-9]{32}$/.test(code) ? code : '';
}

export function hashRecoveryCode(userId, value) {
  const code = normalizeRecoveryCode(value);
  return code ? createHash('sha256').update(`recovery-v1:${userId}:${code}`).digest('hex') : '';
}

export function createRecoveryCodes(userId) {
  const codes = Array.from({ length: 8 }, () => randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
  return { codes, hashes: codes.map((code) => hashRecoveryCode(userId, code)) };
}
