/**
 * AES-256-GCM helpers — mirror of packages/shared/crypto.js, inlined so Vercel
 * tracing doesn't need to reach outside the Next app root.
 */
import crypto from 'crypto';

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY missing');
  let buf;
  if (/^[A-Fa-f0-9]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}`);
  return buf;
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(blob) {
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

export function randomSecret(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}
