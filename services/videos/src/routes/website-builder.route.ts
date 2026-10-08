// melodyflix videos - Website Builder routes (Section 43)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '@melodyflix/shared-auth';
import {
  ensureWebsiteBuilderSchema,
  getSiteSettings, setSiteSettings,
  listThemes, getActiveTheme, createTheme, updateTheme, deleteTheme,
  listHomepageSections, upsertHomepageSection, reorderHomepageSections, deleteHomepageSection,
  createCustomPage, listCustomPages, getCustomPageBySlug, updateCustomPage, deleteCustomPage,
  listNavItems, upsertNavItem, deleteNavItem,
  getPublicRenderConfig,
} from '../services/website-builder.service.js';

export async function websiteBuilderRoutes(app: FastifyInstance) {
  ensureWebsiteBuilderSchema();

  const admin = async (req: any, reply: any) => {
    try { requireRole(req.headers.authorization, ['admin']); }
    catch (err) { reply.code(403).send({ success: false, error: (err as Error).message }); return false; }
    return true;
  };

  // ============ 43.6 PUBLIC RENDER ============

  app.get('/site/config', async (_req, reply) => {
    return reply.send({ success: true, data: getPublicRenderConfig() });
  });

  app.get('/site/pages/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const page = getCustomPageBySlug(slug);
    if (!page || !page.is_published) return reply.code(404).send({ success: false, error: 'Page not found' });
    return reply.send({ success: true, data: page });
  });

  // ============ 43.1 SITE SETTINGS (admin) ============

  app.get('/admin/site/settings', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ success: true, data: getSiteSettings() });
  });

  app.put('/admin/site/settings', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const BodySchema = z.object({
      site_name: z.string().min(1).max(100).optional(),
      logo_url: z.string().max(500).nullable().optional(),
      favicon_url: z.string().max(500).nullable().optional(),
      tagline: z.string().max(200).nullable().optional(),
      meta_description: z.string().max(500).nullable().optional(),
      meta_keywords: z.string().max(500).nullable().optional(),
      contact_email: z.string().email().nullable().optional(),
      support_url: z.string().max(500).nullable().optional(),
      social: z.record(z.string()).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    return reply.send({ success: true, data: setSiteSettings(parsed.data) });
  });

  // ============ 43.2 THEMES ============

  app.get('/admin/site/themes', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ success: true, data: { themes: listThemes(), active: getActiveTheme() } });
  });

  app.post('/admin/site/themes', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const BodySchema = z.object({
      name: z.string().min(1).max(80),
      mode: z.enum(['dark', 'light', 'auto']).optional(),
      primary_color: z.string().max(20).optional(),
      secondary_color: z.string().max(20).optional(),
      accent_color: z.string().max(20).optional(),
      bg_color: z.string().max(20).optional(),
      text_color: z.string().max(20).optional(),
      heading_font: z.string().max(80).optional(),
      body_font: z.string().max(80).optional(),
      custom_css: z.string().max(20000).nullable().optional(),
      tokens: z.record(z.string()).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createTheme(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.patch('/admin/site/themes/:id', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      name: z.string().min(1).max(80).optional(),
      is_active: z.boolean().optional(),
      mode: z.enum(['dark', 'light', 'auto']).optional(),
      primary_color: z.string().max(20).optional(),
      secondary_color: z.string().max(20).optional(),
      accent_color: z.string().max(20).optional(),
      bg_color: z.string().max(20).optional(),
      text_color: z.string().max(20).optional(),
      heading_font: z.string().max(80).optional(),
      body_font: z.string().max(80).optional(),
      custom_css: z.string().max(20000).nullable().optional(),
      tokens: z.record(z.string()).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const t = updateTheme(id, parsed.data);
      if (!t) return reply.code(404).send({ success: false, error: 'Theme not found' });
      return reply.send({ success: true, data: t });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.delete('/admin/site/themes/:id', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const { id } = req.params as { id: string };
    try {
      const ok = deleteTheme(id);
      if (!ok) return reply.code(404).send({ success: false, error: 'Theme not found' });
      return reply.send({ success: true, data: { deleted: true } });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  // ============ 43.3 HOMEPAGE LAYOUT ============

  app.get('/admin/site/homepage', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ success: true, data: { sections: listHomepageSections() } });
  });

  app.post('/admin/site/homepage', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const BodySchema = z.object({
      section_key: z.string().min(1).max(80),
      section_type: z.string().min(1).max(80),
      title: z.string().max(200).nullable().optional(),
      config: z.record(z.unknown()).optional(),
      sort_order: z.number().int().min(0).max(10000).optional(),
      enabled: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: upsertHomepageSection(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.put('/admin/site/homepage/reorder', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const BodySchema = z.object({ order: z.array(z.string()).min(1) });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    return reply.send({ success: true, data: { sections: reorderHomepageSections(parsed.data.order) } });
  });

  app.delete('/admin/site/homepage/:sectionKey', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const { sectionKey } = req.params as { sectionKey: string };
    const ok = deleteHomepageSection(sectionKey);
    if (!ok) return reply.code(404).send({ success: false, error: 'Section not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ 43.4 CUSTOM PAGES ============

  app.get('/admin/site/pages', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ success: true, data: { pages: listCustomPages() } });
  });

  app.post('/admin/site/pages', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const BodySchema = z.object({
      slug: z.string().max(80).optional(),
      title: z.string().min(1).max(200),
      content_md: z.string().max(200000).nullable().optional(),
      content_html: z.string().max(500000).nullable().optional(),
      meta_description: z.string().max(500).nullable().optional(),
      is_published: z.boolean().optional(),
      show_in_nav: z.boolean().optional(),
      sort_order: z.number().int().min(0).max(10000).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: createCustomPage(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.patch('/admin/site/pages/:id', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const { id } = req.params as { id: string };
    const BodySchema = z.object({
      slug: z.string().max(80).optional(),
      title: z.string().min(1).max(200).optional(),
      content_md: z.string().max(200000).nullable().optional(),
      content_html: z.string().max(500000).nullable().optional(),
      meta_description: z.string().max(500).nullable().optional(),
      is_published: z.boolean().optional(),
      show_in_nav: z.boolean().optional(),
      sort_order: z.number().int().min(0).max(10000).optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try {
      const p = updateCustomPage(id, parsed.data);
      if (!p) return reply.code(404).send({ success: false, error: 'Page not found' });
      return reply.send({ success: true, data: p });
    } catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.delete('/admin/site/pages/:id', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteCustomPage(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Page not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============ 43.5 NAVIGATION ============

  app.get('/admin/site/nav', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const q = req.query as { location?: string };
    return reply.send({ success: true, data: { items: listNavItems({ location: q.location as any }) } });
  });

  app.post('/admin/site/nav', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const BodySchema = z.object({
      id: z.string().optional(),
      location: z.enum(['header', 'footer', 'sidebar']),
      label: z.string().min(1).max(80),
      url: z.string().min(1).max(500),
      parent_id: z.string().nullable().optional(),
      sort_order: z.number().int().min(0).max(10000).optional(),
      is_external: z.boolean().optional(),
      enabled: z.boolean().optional(),
    });
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.issues[0].message });
    try { return reply.code(201).send({ success: true, data: upsertNavItem(parsed.data) }); }
    catch (err) { return reply.code(400).send({ success: false, error: (err as Error).message }); }
  });

  app.delete('/admin/site/nav/:id', async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const { id } = req.params as { id: string };
    const ok = deleteNavItem(id);
    if (!ok) return reply.code(404).send({ success: false, error: 'Nav item not found' });
    return reply.send({ success: true, data: { deleted: true } });
  });
}
