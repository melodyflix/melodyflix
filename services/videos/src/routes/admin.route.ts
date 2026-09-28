// melodyflix videos - admin report management
import type { FastifyInstance } from 'fastify';
import { requireRole } from '@melodyflix/shared-auth';
import {
  listReports, getReportById, resolveReport, countPendingReports, deleteComment,
} from '../services/comment.service.js';
import { batchLookupUsers, getFallbackUser } from '../services/userlookup.service.js';

export async function adminReportRoutes(app: FastifyInstance) {
  // GET /api/v1/videos/admin/reports?status=pending
  app.get('/reports', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const q = req.query as { status?: string };
    const status = q.status ?? 'pending';
    const reports = listReports(status);

    // Enrich with user info for reporters and comment authors
    const userIds = new Set<string>();
    for (const r of reports) {
      userIds.add(r.reporter_id);
      if (r.comment_author_id) userIds.add(r.comment_author_id);
    }
    const userMap = userIds.size > 0 ? await batchLookupUsers(Array.from(userIds)) : new Map();

    const enriched = reports.map((r) => ({
      ...r,
      reporter: userMap.get(r.reporter_id) ?? getFallbackUser(r.reporter_id),
      comment_author: r.comment_author_id
        ? (userMap.get(r.comment_author_id) ?? getFallbackUser(r.comment_author_id))
        : null,
    }));

    return reply.send({
      success: true,
      data: { reports: enriched, pendingCount: countPendingReports() },
    });
  });

  // POST /api/v1/videos/admin/reports/:id/dismiss
  app.post('/reports/:id/dismiss', async (req, reply) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const report = getReportById(id);
    if (!report) return reply.code(404).send({ success: false, error: 'Report not found' });

    resolveReport(id, 'dismissed');
    return reply.send({ success: true, data: { status: 'dismissed' } });
  });

  // POST /api/v1/videos/admin/reports/:id/delete-comment
  app.post('/reports/:id/delete-comment', async (req, reply) => {
    let payload;
    try { payload = requireRole(req.headers.authorization, ['admin']); }
    catch (err) { return reply.code(403).send({ success: false, error: (err as Error).message }); }

    const { id } = req.params as { id: string };
    const report = getReportById(id);
    if (!report) return reply.code(404).send({ success: false, error: 'Report not found' });

    // Delete the offending comment as admin
    deleteComment(report.comment_id, payload.sub, true);
    resolveReport(id, 'resolved');

    return reply.send({ success: true, data: { status: 'resolved', commentDeleted: true } });
  });
}
