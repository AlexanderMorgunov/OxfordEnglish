import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.TOTP_ENC_KEY ?? '', 'base64');
  if (key.length !== 32)
    throw new Error('Account-access encryption is unavailable');
  return key;
}
export function accessEncryptionReady(): boolean {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}
export function sealAccess(value: unknown, context: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(`dayenglish/access/v1:${context}`));
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return [nonce, body, cipher.getAuthTag()]
    .map((part) => part.toString('base64url'))
    .join('.');
}
export function openAccess<V>(value: string, context: string): V {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid account-access receipt');
  const [nonce, body, tag] = parts.map((part) =>
    Buffer.from(part, 'base64url')
  );
  if (!nonce || nonce.length !== 12 || !body || !tag || tag.length !== 16)
    throw new Error('Invalid account-access receipt');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), nonce);
  decipher.setAAD(Buffer.from(`dayenglish/access/v1:${context}`));
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  ) as V;
}
