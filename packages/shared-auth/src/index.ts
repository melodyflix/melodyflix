// melodyflix shared-auth - JWT verification for all services
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadConfig } from '@melodyflix/shared-config';
import type { JwtPayload } from '@melodyflix/shared-types';

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return null;
    const data = `${h}.${p}`;
    const config = loadConfig();
    const expected = base64url(createHmac('sha256', config.JWT_SECRET).update(data).digest());

    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(Buffer.from(p, 'base64').toString()) as JwtPayload & { exp?: number };
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;

    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

export function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  return authorization.slice(7);
}

export function requireAuth(authorization: string | undefined): JwtPayload {
  const token = extractBearerToken(authorization);
  if (!token) throw new Error('Missing or invalid Authorization header');
  const payload = verifyJwt(token);
  if (!payload) throw new Error('Invalid or expired token');
  return payload;
}

export function requireRole(authorization: string | undefined, allowedRoles: string[]): JwtPayload {
  const payload = requireAuth(authorization);
  if (!allowedRoles.includes(payload.role)) {
    throw new Error('Insufficient permissions');
  }
  return payload;
}

// Fastify preHandler: verifies Bearer token, sets req.user
// Usage: app.get('/x', { preHandler: [authGuard] }, handler)
export function authGuard(
  req: { headers: { authorization?: string }; user?: JwtPayload },
  reply: { code: (n: number) => { send: (body: unknown) => void } },
  done: (err?: Error) => void,
): void {
  try {
    req.user = requireAuth(req.headers.authorization);
    done();
  } catch (e) {
    reply.code(401).send({ error: 'Unauthorized', message: (e as Error).message });
  }
}

// Fastify preHandler factory for role-gated routes
export function roleGuard(allowedRoles: string[]) {
  return function (
    req: { headers: { authorization?: string }; user?: JwtPayload },
    reply: { code: (n: number) => { send: (body: unknown) => void } },
    done: (err?: Error) => void,
  ): void {
    try {
      const payload = requireAuth(req.headers.authorization);
      if (!allowedRoles.includes(payload.role)) {
        reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions' });
        return;
      }
      req.user = payload;
      done();
    } catch (e) {
      reply.code(401).send({ error: 'Unauthorized', message: (e as Error).message });
    }
  };
}
