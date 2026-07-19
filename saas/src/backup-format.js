import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const ENCRYPTED_MAGIC = Buffer.from('BDENC001', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseBackupEncryptionKey(value, { required = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    if (required) throw new Error('BD_BACKUP_ENCRYPTION_KEY is required and must contain 32 random bytes.');
    return null;
  }

  let key;
  if (raw.startsWith('base64:')) key = decodeBase64(raw.slice(7));
  else if (raw.startsWith('hex:')) key = decodeHex(raw.slice(4));
  else if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else key = decodeBase64(raw);

  if (key.length !== 32) {
    throw new Error('BD_BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or 64 hex characters).');
  }
  return key;
}

function decodeBase64(value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) return Buffer.alloc(0);
  return Buffer.from(value, 'base64');
}

function decodeHex(value) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return Buffer.alloc(0);
  return Buffer.from(value, 'hex');
}

export function isEncryptedBackup(buffer) {
  const value = Buffer.from(buffer || []);
  return value.length >= ENCRYPTED_MAGIC.length && value.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC);
}

export function serializeBackup(backup, encryptionKey = null) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(backup)));
  if (!encryptionKey) return compressed;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAAD(ENCRYPTED_MAGIC);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENCRYPTED_MAGIC, iv, tag, ciphertext]);
}

export function deserializeBackup(buffer, encryptionKey = null) {
  const value = Buffer.from(buffer || []);
  let compressed = value;

  if (isEncryptedBackup(value)) {
    if (!encryptionKey) throw new Error('This backup is encrypted. Set BD_BACKUP_ENCRYPTION_KEY to decrypt it.');
    const minimumLength = ENCRYPTED_MAGIC.length + IV_BYTES + TAG_BYTES + 1;
    if (value.length < minimumLength) throw new Error('Encrypted backup is truncated.');
    const ivStart = ENCRYPTED_MAGIC.length;
    const tagStart = ivStart + IV_BYTES;
    const dataStart = tagStart + TAG_BYTES;
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(ivStart, tagStart));
    decipher.setAAD(ENCRYPTED_MAGIC);
    decipher.setAuthTag(value.subarray(tagStart, dataStart));
    try {
      compressed = Buffer.concat([decipher.update(value.subarray(dataStart)), decipher.final()]);
    } catch {
      throw new Error('Backup decryption failed. The key is incorrect or the file was modified.');
    }
  }

  try {
    return JSON.parse(gunzipSync(compressed).toString('utf8'));
  } catch (gzipError) {
    try {
      return JSON.parse(compressed.toString('utf8'));
    } catch {
      throw new Error(`Backup payload is unreadable: ${gzipError.message}`);
    }
  }
}
