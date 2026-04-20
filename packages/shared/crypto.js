/**
 * AES-256-GCM helpers for at-rest secret storage (Telegram bot tokens, etc.)
 *
 * Uses ENCRYPTION_KEY env var — must be exactly 32 bytes of base64 or hex.
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * Storage format: "gcm1:<iv_b64>:<tag_b64>:<ct_b64>"
 * The "gcm1" prefix lets us rotate versions later.
 */
const crypto = require('crypto');

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY missing — required to encrypt/decrypt bot tokens');
  // Accept base64 (44 chars) or hex (64 chars)
  let buf;
  if (/^[A-Fa-f0-9]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}`);
  return buf;
}

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(blob) {
  if (!blob) return null;
  const [version, ivB64, tagB64, ctB64] = String(blob).split(':');
  if (version !== 'gcm1') throw new Error(`Unknown cipher version: ${version}`);
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

function randomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex'); // 48-char for 24 bytes
}

module.exports = { encrypt, decrypt, randomSecret };
