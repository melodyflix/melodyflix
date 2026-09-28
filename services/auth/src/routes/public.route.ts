// melodyflix auth - public user info
import type { FastifyInstance } from 'fastify';
import { getDb } from '@melodyflix/shared-db';
import { toSafeUser, type User } from '../models/user.model.js';

export async function publicUserRoutes(app: FastifyInstance) {
  // GET /api/v1/auth/users/:id/public — public user info
  app.get('/users/:id/public', async (req, reply) => {
    const { id } = req.params as { id: string };
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    if (!user) return reply.code(404).send({ success: false, error: 'User not found' });
    const safe = toSafeUser(user);
    return reply.send({
      success: true,
      data: {
        id: safe.id,
        username: safe.username,
        display_name: safe.display_name,
        avatar_url: safe.avatar_url,
      },
    });
  });

  // POST /api/v1/auth/users/batch — batch lookup (for comment enrichment)
  app.post('/users/batch', async (req, reply) => {
    const body = req.body as { ids?: string[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return reply.send({ success: true, data: { users: [] } });
    }
    if (body.ids.length > 200) {
      return reply.code(400).send({ success: false, error: 'Max 200 ids per request' });
    }

    const db = getDb();
    const placeholders = body.ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, username, display_name, avatar_url FROM users WHERE id IN (${placeholders})`
    ).all(...body.ids) as Array<{ id: string; username: string; display_name: string | null; avatar_url: string | null }>;

    return reply.send({ success: true, data: { users: rows } });
  });
}
