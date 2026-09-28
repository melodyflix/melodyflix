// melodyflix auth - password hashing & JWT using node:crypto only
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = scryptSync(password, salt, 64);
  const orig = Buffer.from(hash, 'hex');
  if (check.length !== orig.length) return false;
  return timingSafeEqual(check, orig);
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signJwt(payload: Record<string, unknown>, secret: string, expiresInSec: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(body));
  const data = `${h}.${p}`;
  const sig = base64url(createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  try {
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return null;
    const data = `${h}.${p}`;
    const expected = base64url(createHmac('sha256', secret).update(data).digest());
    if (expected !== sig) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64').toString());
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
