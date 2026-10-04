// melodyflix auth - admin routes
import type { FastifyInstance } from 'fastify';
import { requireRole } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import { toSafeUser, type User } from '../models/user.model.js';

export async function adminRoutes(app: FastifyInstance) {
  // GET /api/v1/admin/users - list all users (admin only)
  app.get('/users', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    const offset = Number(q.offset ?? 0);

    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset) as User[];

    const total = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;

    return reply.send({ success: true, data: { users: rows.map(toSafeUser), total } });
  });

  // PATCH /api/v1/admin/users/:id/role - change role
  app.patch('/users/:id/role', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const body = req.body as { role?: string };
    const allowed = ['user', 'creator', 'admin'];
    if (!body.role || !allowed.includes(body.role)) {
      return reply.code(400).send({ success: false, error: 'Role must be user, creator, or admin' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ success: false, error: 'User not found' });

    db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
      .run(body.role, new Date().toISOString(), id);

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User;
    return reply.send({ success: true, data: toSafeUser(updated) });
  });

  // POST /api/v1/admin/users/:id/verify-email
  app.post('/users/:id/verify-email', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ success: false, error: 'User not found' });

    db.prepare('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User;
    return reply.send({ success: true, data: toSafeUser(updated) });
  });

  // POST /api/v1/admin/users/:id/unverify-email
  app.post('/users/:id/unverify-email', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ success: false, error: 'User not found' });

    db.prepare('UPDATE users SET email_verified = 0, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User;
    return reply.send({ success: true, data: toSafeUser(updated) });
  });

  // DELETE /api/v1/admin/users/:id
  app.delete('/users/:id', async (req, reply) => {
    let payload;
    try { payload = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    if (id === payload.sub) {
      return reply.code(400).send({ success: false, error: 'Cannot delete yourself' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!existing) return reply.code(404).send({ success: false, error: 'User not found' });

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return reply.send({ success: true, data: { deleted: true } });
  });
}
