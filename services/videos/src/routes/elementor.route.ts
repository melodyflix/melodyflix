// melodyflix videos - Elementor-style builder routes (Section 43 Phase 2)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, requireAuth } from '@melodyflix/shared-auth';
import {
  ensureElementorSchema,
  listWidgets, getWidgetDefinition,
  addElement, getElement, updateElement, deleteElement, moveElement,
  duplicateElement, reorderElements, getPageTree, listPageElements,
  createRevision, listRevisions, getRevision, deleteRevision, restoreRevision,
  getGlobalStyles, listGlobalStyles, setGlobalStyle, deleteGlobalStyle,
  createTemplate, savePageAsTemplate, listTemplates, getTemplate,
  applyTemplate, deleteTemplate,
  submitForm, listFormSubmissions, updateFormSubmission, deleteFormSubmission,
  collectPageCssJs,
} from '../services/elementor.service.js';

export async function elementorRoutes(app: FastifyInstance) {
  ensureElementorSchema();

  const isAdmin = async (req: any, reply: any) => {
    try { requireRole(req.headers.authorization, ['admin']); return true; }
    catch (err) { reply.code(403).send({ success: false, error: (err as Error).message }); return false; }
  };

  // ============ Widget registry (43.8) ============
  app.get('/builder/widgets', async (_req, reply) => {
    return reply.send({ success: true, data: { widgets: listWidgets(), categories: ['basic', 'media', 'layout', 'form', 'pro', 'dynamic'] } });
  });

  app.get('/builder/widgets/:type', async (req, reply) => {
    const { type } = req.params as { type: string };
    const w = getWidgetDefinition(type);
    if (!w) return reply.code(404).send({ success: false, error: 'Widget not found' });
    return reply.send({ success: true, data: w });
  });

  // ============ Element tree (43.7) ============
  app.get('/builder/pages/:pageId/tree', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { pageId } = req.params as { pageId: string };
    return reply.send({ success: true, data: { tree: getPageTree(pageId) } });
  });

  app.get('/builder/pages/:pageId/elements', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { pageId } = req.params as { pageId: string };
    return reply.send({ success: true, data: { elements: listPageElements(pageId) } });
  });

  app.post('/builder/pages/:pageId/elements', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { pageId } = req.params as { pageId: string };
    const BodySchema = z.object({
      parent_id: z.string().nullable().optional(),
      element_type: z.enum(['section', 'column', 'container', 'widget']),
      widget_type: z.string().max(80).nullable().optional(),
      settings: z.record(z.unknown()).optional(),
      style: z.record(z.unknown()).optional(),
      responsive: z.record(z.unknown()).optional(),
      advanced: z.record(z.unknown()).optional(),
      sort_order: z.number().int().min(0).max(100000).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const el = addElement({ page_id: pageId, ...parsed.data });
      return reply.code(201).send({ success: true, data: el });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.get('/builder/elements/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const el = getElement(id);
    if (!el) return reply.code(404).send({ success: false, error: 'Element not found' });
    return reply.send({ success: true, data: el });
  });

  app.patch('/builder/elements/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      widget_type: z.string().max(80).nullable().optional(),
      settings: z.record(z.unknown()).optional(),
      style: z.record(z.unknown()).optional(),
      responsive: z.record(z.unknown()).optional(),
      advanced: z.record(z.unknown()).optional(),
      sort_order: z.number().int().min(0).max(100000).optional(),
      is_hidden: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const el = updateElement(id, parsed.data);
    if (!el) return reply.code(404).send({ success: false, error: 'Element not found' });
    return reply.send({ success: true, data: el });
  });

  app.delete('/builder/elements/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const n = deleteElement(id);
    if (n === 0) return reply.code(404).send({ success: false, error: 'Element not found' });
    return reply.send({ success: true, data: { deleted: n } });
  });

  app.post('/builder/elements/:id/move', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      new_parent_id: z.string().nullable().optional(),
      new_sort_order: z.number().int().min(0).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const el = moveElement(id, parsed.data);
      if (!el) return reply.code(404).send({ success: false, error: 'Element not found' });
      return reply.send({ success: true, data: el });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/builder/elements/:id/duplicate', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const { parent_id } = (req.body ?? {}) as { parent_id?: string | null };
    const el = duplicateElement(id, parent_id);
    if (!el) return reply.code(404).send({ success: false, error: 'Element not found' });
    return reply.code(201).send({ success: true, data: el });
  });

  app.post('/builder/reorder', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      parent_id: z.string().nullable(),
      order: z.array(z.string()).min(1),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    reorderElements(parsed.data.parent_id, parsed.data.order);
    return reply.send({ success: true, data: { ok: true } });
  });

  // ============ Revisions (43.11) ============
  app.post('/builder/pages/:pageId/revisions', async (req, reply) => {
    const admin = await isAdmin(req, reply);
    if (!admin) return;
    const { pageId } = req.params as { pageId: string };
    const { note } = (req.body ?? {}) as { note?: string };
    let userId: string | undefined;
    try { userId = requireAuth(req.headers.authorization).sub; } catch {}
    return reply.code(201).send({ success: true, data: createRevision(pageId, note, userId) });
  });

  app.get('/builder/pages/:pageId/revisions', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { pageId } = req.params as { pageId: string };
    const q = req.query as { limit?: string };
    const limit = q.limit ? Math.min(parseInt(q.limit), 200) : 50;
    return reply.send({ success: true, data: { revisions: listRevisions(pageId, limit) } });
  });

  app.get('/builder/revisions/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const r = getRevision(id);
    if (!r) return reply.code(404).send({ success: false, error: 'Revision not found' });
    return reply.send({ success: true, data: r });
  });

  app.post('/builder/revisions/:id/restore', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    try { return reply.send({ success: true, data: restoreRevision(id) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.delete('/builder/revisions/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteRevision(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Revision not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ Global styles (43.12) ============
  app.get('/builder/global-styles', async (_req, reply) => {
    return reply.send({ success: true, data: { grouped: getGlobalStyles(), list: listGlobalStyles() } });
  });

  app.put('/builder/global-styles', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      kind: z.string().min(1).max(40),
      key: z.string().min(1).max(80),
      value: z.string().min(1).max(2000),
      label: z.string().max(80).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    return reply.send({ success: true, data: setGlobalStyle(parsed.data) });
  });

  app.delete('/builder/global-styles/:kind/:key', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { kind, key } = req.params as { kind: string; key: string };
    const ok = deleteGlobalStyle(kind, key);
    if (!ok) return reply.code(404).send({ success: false, error: 'Style not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ Templates (43.13) ============
  app.get('/builder/templates', async (_req, reply) => {
    const q = _req.query as { category?: string };
    return reply.send({ success: true, data: { templates: listTemplates(q.category) } });
  });

  app.post('/builder/templates', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const BodySchema = z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      thumbnail_url: z.string().max(500).optional(),
      category: z.string().max(60).optional(),
      snapshot: z.array(z.record(z.unknown())),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createTemplate(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/builder/pages/:pageId/save-as-template', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { pageId } = req.params as { pageId: string };
    const BodySchema = z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      category: z.string().max(60).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      return reply.code(201).send({ success: true, data: savePageAsTemplate(pageId, parsed.data.name, parsed.data.description, parsed.data.category) });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.post('/builder/pages/:pageId/apply-template/:templateId', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { pageId, templateId } = req.params as { pageId: string; templateId: string };
    const { replace } = (req.body ?? {}) as { replace?: boolean };
    try { return reply.send({ success: true, data: applyTemplate(pageId, templateId, replace === true) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.delete('/builder/templates/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteTemplate(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Template not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ CSS/JS bundle (43.14) ============
  app.get('/builder/pages/:pageId/css-js', async (req, reply) => {
    const { pageId } = req.params as { pageId: string };
    return reply.send({ success: true, data: collectPageCssJs(pageId) });
  });

  // ============ Form submissions (43.15) ============
  // Public submit
  app.post('/site/pages/:pageId/forms/:elementId/submit', async (req, reply) => {
    const { pageId, elementId } = req.params as { pageId: string; elementId: string };
    let userId: string | undefined;
    try { userId = requireAuth(req.headers.authorization).sub; } catch {}
    try {
      const s = submitForm({
        page_id: pageId, element_id: elementId,
        data: (req.body ?? {}) as Record<string, unknown>,
        submitter_ip: req.ip, submitter_user_id: userId,
      });
      return reply.code(201).send({ success: true, data: { id: s.id, submitted: true } });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // Admin list / update / delete
  app.get('/builder/pages/:pageId/form-submissions', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { pageId } = req.params as { pageId: string };
    const q = req.query as { status?: string; limit?: string };
    return reply.send({ success: true, data: { submissions: listFormSubmissions(pageId, { status: q.status, limit: q.limit ? parseInt(q.limit) : undefined }) } });
  });

  app.patch('/builder/form-submissions/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      status: z.enum(['new', 'read', 'replied', 'spam', 'archived']).optional(),
      notes: z.string().max(2000).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    const s = updateFormSubmission(id, parsed.data);
    if (!s) return reply.code(404).send({ success: false, error: 'Submission not found' });
    return reply.send({ success: true, data: s });
  });

  app.delete('/builder/form-submissions/:id', async (req, reply) => {
    if (!(await isAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteFormSubmission(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Submission not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });
}
