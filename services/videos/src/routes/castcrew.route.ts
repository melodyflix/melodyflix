// melodyflix videos - cast & crew routes
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import { getDb } from '@melodyflix/shared-db';
import {
  ROLES, listPeopleForVideo, replaceCastCrew, addPerson, removePerson, listVideosByPerson,
} from '../services/castcrew.service.js';

const PersonSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(40),
  character_name: z.string().max(120).nullable().optional(),
});

const AddSchema = PersonSchema;

const ReplaceSchema = z.object({
  people: z.array(PersonSchema).max(100),
});

function checkVideoOwner(videoId: string, userId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT owner_id FROM videos WHERE id = ?').get(videoId) as { owner_id: string } | undefined;
  return row?.owner_id === userId;
}

export async function castCrewRoutes(app: FastifyInstance) {
  // GET /roles — predefined role list
  app.get('/roles', async (_req, reply) => {
    return reply.send({ success: true, data: { roles: ROLES } });
  });

  // GET /:videoId/credits
  app.get('/:videoId/credits', async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const people = listPeopleForVideo(videoId);
    return reply.send({ success: true, data: { people } });
  });

  // POST /:videoId/credits  { name, role, character_name? }
  app.post('/:videoId/credits', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = AddSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    try {
      const person = addPerson(videoId, parsed.data);
      return reply.send({ success: true, data: { person } });
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message });
    }
  });

  // PUT /:videoId/credits  { people: [...] } — replace all
  app.put('/:videoId/credits', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId } = req.params as { videoId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const parsed = ReplaceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: 'Invalid body' });
    const people = replaceCastCrew(videoId, parsed.data.people);
    return reply.send({ success: true, data: { people } });
  });

  // DELETE /:videoId/credits/:personId
  app.delete('/:videoId/credits/:personId', { preHandler: [requireAuth] }, async (req, reply) => {
    const { videoId, personId } = req.params as { videoId: string; personId: string };
    const userId = (req as any).user?.id ?? (req as any).user?.sub;
    if (!userId) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    if (!checkVideoOwner(videoId, userId)) {
      return reply.code(403).send({ success: false, error: 'Not your video' });
    }
    const removed = removePerson(videoId, personId);
    return reply.send({ success: true, data: { removed } });
  });

  // GET /people/:name/videos — all videos a person appears in
  app.get('/people/:name/videos', async (req, reply) => {
    const { name } = req.params as { name: string };
    const decoded = decodeURIComponent(name);
    const videos = listVideosByPerson(decoded, 50);
    return reply.send({ success: true, data: { name: decoded, videos } });
  });
}
