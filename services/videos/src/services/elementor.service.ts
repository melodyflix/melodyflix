// melodyflix videos - Elementor-style element tree (Section 43 Phase 2)
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureElementorSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_elements (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      parent_id TEXT,
      element_type TEXT NOT NULL,
      widget_type TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      style_json TEXT NOT NULL DEFAULT '{}',
      responsive_json TEXT NOT NULL DEFAULT '{}',
      advanced_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pe_page ON page_elements(page_id);
    CREATE INDEX IF NOT EXISTS idx_pe_parent ON page_elements(parent_id);
    CREATE INDEX IF NOT EXISTS idx_pe_type ON page_elements(element_type);
    CREATE INDEX IF NOT EXISTS idx_pe_widget ON page_elements(widget_type);

    CREATE TABLE IF NOT EXISTS page_revisions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pr_page ON page_revisions(page_id);
    CREATE INDEX IF NOT EXISTS idx_pr_created ON page_revisions(created_at);

    CREATE TABLE IF NOT EXISTS page_global_styles (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(kind, key)
    );
    CREATE INDEX IF NOT EXISTS idx_pgs_kind ON page_global_styles(kind);
  `);
}

export type ElementType = 'section' | 'column' | 'container' | 'widget';

export interface PageElement {
  id: string;
  page_id: string;
  parent_id: string | null;
  element_type: ElementType;
  widget_type: string | null;
  settings: Record<string, unknown>;
  style: Record<string, unknown>;
  responsive: Record<string, unknown>;
  advanced: Record<string, unknown>;
  sort_order: number;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface PageElementNode extends PageElement {
  children: PageElementNode[];
}

interface PeRow {
  id: string; page_id: string; parent_id: string | null;
  element_type: string; widget_type: string | null;
  settings_json: string; style_json: string; responsive_json: string;
  advanced_json: string; sort_order: number; is_hidden: number;
  created_at: string; updated_at: string;
}

function parseObj(s: string): Record<string, unknown> {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
}

function peRowToObj(row: PeRow): PageElement {
  return {
    id: row.id, page_id: row.page_id, parent_id: row.parent_id,
    element_type: row.element_type as ElementType, widget_type: row.widget_type,
    settings: parseObj(row.settings_json), style: parseObj(row.style_json),
    responsive: parseObj(row.responsive_json), advanced: parseObj(row.advanced_json),
    sort_order: row.sort_order, is_hidden: row.is_hidden === 1,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export interface WidgetDefinition {
  type: string;
  label: string;
  category: 'basic' | 'media' | 'layout' | 'form' | 'pro' | 'dynamic';
  icon?: string;
  default_settings?: Record<string, unknown>;
  default_style?: Record<string, unknown>;
  allowed_children?: ElementType[];
}

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  { type: 'heading',     label: 'Heading',     category: 'basic', default_settings: { text: 'Your heading', tag: 'h2' } },
  { type: 'text',        label: 'Text Editor', category: 'basic', default_settings: { html: '<p>Add your text here.</p>' } },
  { type: 'button',      label: 'Button',      category: 'basic', default_settings: { text: 'Click me', url: '#', target: '_self' } },
  { type: 'divider',     label: 'Divider',     category: 'basic' },
  { type: 'spacer',      label: 'Spacer',      category: 'basic', default_settings: { height: 40 } },
  { type: 'icon',        label: 'Icon',        category: 'basic', default_settings: { icon: 'star', size: 24 } },
  { type: 'icon_list',   label: 'Icon List',   category: 'basic', default_settings: { items: [] } },
  { type: 'image',       label: 'Image',       category: 'media', default_settings: { src: '', alt: '' } },
  { type: 'gallery',     label: 'Gallery',     category: 'media', default_settings: { images: [] } },
  { type: 'video',       label: 'Video',       category: 'media', default_settings: { provider: 'html5', src: '' } },
  { type: 'audio',       label: 'Audio',       category: 'media', default_settings: { src: '' } },
  { type: 'section',     label: 'Section',     category: 'layout', allowed_children: ['column', 'container'] },
  { type: 'column',      label: 'Column',      category: 'layout', allowed_children: ['widget', 'container'] },
  { type: 'container',   label: 'Container',   category: 'layout', allowed_children: ['widget', 'container'] },
  { type: 'columns_2',   label: 'Two Columns', category: 'layout' },
  { type: 'columns_3',   label: 'Three Columns', category: 'layout' },
  { type: 'tabs',        label: 'Tabs',        category: 'layout', default_settings: { tabs: [] } },
  { type: 'accordion',   label: 'Accordion',   category: 'layout', default_settings: { items: [] } },
  { type: 'toggle',      label: 'Toggle',      category: 'layout', default_settings: { items: [] } },
  { type: 'form',        label: 'Form',        category: 'form', default_settings: { fields: [], submit_label: 'Submit' } },
  { type: 'search',      label: 'Search Bar',  category: 'form', default_settings: { placeholder: 'Search...' } },
  { type: 'counter',     label: 'Counter',     category: 'pro', default_settings: { start: 0, end: 100, duration: 2 } },
  { type: 'progress',    label: 'Progress Bar', category: 'pro', default_settings: { value: 50, label: '' } },
  { type: 'testimonial', label: 'Testimonial', category: 'pro', default_settings: { quote: '', author: '', role: '' } },
  { type: 'social_icons', label: 'Social Icons', category: 'pro', default_settings: { icons: [] } },
  { type: 'alert',       label: 'Alert',       category: 'pro', default_settings: { type: 'info', text: '' } },
  { type: 'html',        label: 'Custom HTML', category: 'pro', default_settings: { html: '' } },
  { type: 'shortcode',   label: 'Shortcode',   category: 'pro', default_settings: { code: '' } },
  { type: 'menu',        label: 'Nav Menu',    category: 'pro', default_settings: { location: 'header' } },
  { type: 'breadcrumbs', label: 'Breadcrumbs', category: 'pro' },
  { type: 'post_title',  label: 'Page Title',  category: 'pro' },
  { type: 'post_content', label: 'Page Content', category: 'pro' },
  { type: 'dyn_video_title',     label: 'Dynamic: Video Title',     category: 'dynamic' },
  { type: 'dyn_video_thumbnail', label: 'Dynamic: Video Thumbnail', category: 'dynamic' },
  { type: 'dyn_channel_name',    label: 'Dynamic: Channel Name',    category: 'dynamic' },
  { type: 'dyn_category_list',   label: 'Dynamic: Categories',      category: 'dynamic' },
  { type: 'dyn_trending_grid',   label: 'Dynamic: Trending Grid',   category: 'dynamic', default_settings: { content_type: 'video', per_page: 12 } },
  { type: 'dyn_content_type_grid', label: 'Dynamic: Content-Type Grid', category: 'dynamic', default_settings: { content_type: 'movie', per_page: 12 } },
];

export function listWidgets(category?: string): WidgetDefinition[] {
  return category ? WIDGET_REGISTRY.filter((w) => w.category === category) : WIDGET_REGISTRY;
}

export function getWidgetDefinition(type: string): WidgetDefinition | null {
  return WIDGET_REGISTRY.find((w) => w.type === type) ?? null;
}

// ---------- Element CRUD ----------

export function getElement(id: string): PageElement | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM page_elements WHERE id = ?').get(id) as PeRow | undefined;
  return row ? peRowToObj(row) : null;
}

export interface AddElementInput {
  page_id: string;
  parent_id?: string | null;
  element_type: ElementType;
  widget_type?: string | null;
  settings?: Record<string, unknown>;
  style?: Record<string, unknown>;
  responsive?: Record<string, unknown>;
  advanced?: Record<string, unknown>;
  sort_order?: number;
}

export function addElement(input: AddElementInput): PageElement {
  const db = getDb();
  const now = new Date().toISOString();

  // Widget type validation against registry
  if (input.element_type === 'widget') {
    if (!input.widget_type) throw new Error('widget_type required for widget element');
    if (!getWidgetDefinition(input.widget_type)) {
      throw new Error(`unknown widget_type: ${input.widget_type}`);
    }
  }

  // Parent validation
  if (input.parent_id) {
    const parent = getElement(input.parent_id);
    if (!parent) throw new Error('parent element not found');
    if (parent.page_id !== input.page_id) throw new Error('parent belongs to different page');
  }

  // Sort order: max + 10 within parent
  let sortOrder = input.sort_order;
  if (sortOrder === undefined) {
    const row = input.parent_id
      ? db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM page_elements WHERE page_id = ? AND parent_id = ?').get(input.page_id, input.parent_id) as { m: number }
      : db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM page_elements WHERE page_id = ? AND parent_id IS NULL').get(input.page_id) as { m: number };
    sortOrder = row.m + 10;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO page_elements (id, page_id, parent_id, element_type, widget_type,
      settings_json, style_json, responsive_json, advanced_json, sort_order, is_hidden,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id, input.page_id, input.parent_id ?? null, input.element_type, input.widget_type ?? null,
    JSON.stringify(input.settings ?? {}), JSON.stringify(input.style ?? {}),
    JSON.stringify(input.responsive ?? {}), JSON.stringify(input.advanced ?? {}),
    sortOrder, now, now,
  );
  return getElement(id)!;
}

export interface UpdateElementInput {
  settings?: Record<string, unknown>;
  style?: Record<string, unknown>;
  responsive?: Record<string, unknown>;
  advanced?: Record<string, unknown>;
  sort_order?: number;
  is_hidden?: boolean;
  widget_type?: string | null;
}

export function updateElement(id: string, patch: UpdateElementInput): PageElement | null {
  const db = getDb();
  const cur = getElement(id);
  if (!cur) return null;
  const now = new Date().toISOString();

  // Deep-merge settings/style maps if caller provides partials
  const mergeObjs = (base: Record<string, unknown>, patch: Record<string, unknown> | undefined) =>
    patch === undefined ? base : { ...base, ...patch };

  db.prepare(`
    UPDATE page_elements SET
      widget_type = ?, settings_json = ?, style_json = ?, responsive_json = ?, advanced_json = ?,
      sort_order = ?, is_hidden = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.widget_type !== undefined ? patch.widget_type : cur.widget_type,
    JSON.stringify(mergeObjs(cur.settings, patch.settings)),
    JSON.stringify(mergeObjs(cur.style, patch.style)),
    JSON.stringify(mergeObjs(cur.responsive, patch.responsive)),
    JSON.stringify(mergeObjs(cur.advanced, patch.advanced)),
    patch.sort_order ?? cur.sort_order,
    patch.is_hidden !== undefined ? (patch.is_hidden ? 1 : 0) : (cur.is_hidden ? 1 : 0),
    now, id,
  );
  return getElement(id);
}

/** Recursively delete an element and its subtree. Returns count deleted. */
export function deleteElement(id: string): number {
  const db = getDb();
  const el = getElement(id);
  if (!el) return 0;
  const children = db.prepare('SELECT id FROM page_elements WHERE parent_id = ?').all(id) as Array<{ id: string }>;
  let n = 0;
  for (const c of children) n += deleteElement(c.id);
  db.prepare('DELETE FROM page_elements WHERE id = ?').run(id);
  return n + 1;
}

export interface MoveElementInput {
  new_parent_id?: string | null;
  new_sort_order?: number;
}

export function moveElement(id: string, input: MoveElementInput): PageElement | null {
  const db = getDb();
  const el = getElement(id);
  if (!el) return null;
  if (input.new_parent_id) {
    const parent = getElement(input.new_parent_id);
    if (!parent) throw new Error('new parent not found');
    if (parent.page_id !== el.page_id) throw new Error('new parent in different page');
    // prevent cycle: cannot move under self/descendant
    let cursor: PageElement | null = parent;
    while (cursor) {
      if (cursor.id === id) throw new Error('cannot move into own subtree');
      cursor = cursor.parent_id ? getElement(cursor.parent_id) : null;
    }
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE page_elements SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?')
    .run(input.new_parent_id ?? null, input.new_sort_order ?? el.sort_order, now, id);
  return getElement(id);
}

/** Deep clone an element + subtree under a new parent (or same parent). */
export function duplicateElement(id: string, newParentId?: string | null): PageElement | null {
  const el = getElement(id);
  if (!el) return null;
  const parent = newParentId === undefined ? el.parent_id : newParentId;
  const clone = addElement({
    page_id: el.page_id,
    parent_id: parent,
    element_type: el.element_type,
    widget_type: el.widget_type,
    settings: el.settings,
    style: el.style,
    responsive: el.responsive,
    advanced: el.advanced,
    sort_order: el.sort_order + 5,
  });
  // recursively clone children
  const db = getDb();
  const children = db.prepare('SELECT id FROM page_elements WHERE parent_id = ? ORDER BY sort_order').all(id) as Array<{ id: string }>;
  for (const c of children) duplicateElement(c.id, clone.id);
  return clone;
}

export function reorderElements(parentId: string | null, order: string[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  for (let i = 0; i < order.length; i++) {
    db.prepare('UPDATE page_elements SET sort_order = ?, updated_at = ? WHERE id = ?')
      .run(i * 10, now, order[i]);
  }
  void parentId;
}

/** Load entire tree for a page as nested nodes (sections at top level). */
export function getPageTree(pageId: string): PageElementNode[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM page_elements WHERE page_id = ? ORDER BY sort_order ASC, created_at ASC')
    .all(pageId) as PeRow[];
  const nodes = new Map<string, PageElementNode>();
  for (const r of rows) nodes.set(r.id, { ...peRowToObj(r), children: [] });
  const roots: PageElementNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    if (r.parent_id && nodes.has(r.parent_id)) {
      nodes.get(r.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function listPageElements(pageId: string): PageElement[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM page_elements WHERE page_id = ? ORDER BY sort_order').all(pageId) as PeRow[];
  return rows.map(peRowToObj);
}

// ---------- Revisions (43.11) ----------

export interface PageRevision {
  id: string;
  page_id: string;
  snapshot: Record<string, unknown>;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

interface RevRow {
  id: string; page_id: string; snapshot_json: string;
  note: string | null; created_by: string | null; created_at: string;
}

function revRowToObj(row: RevRow): PageRevision {
  let snap: Record<string, unknown> = {};
  try { snap = JSON.parse(row.snapshot_json) as Record<string, unknown>; } catch {}
  return {
    id: row.id, page_id: row.page_id, snapshot: snap,
    note: row.note, created_by: row.created_by, created_at: row.created_at,
  };
}

export function createRevision(pageId: string, note?: string, createdBy?: string): PageRevision {
  const db = getDb();
  const tree = getPageTree(pageId);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO page_revisions (id, page_id, snapshot_json, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, pageId, JSON.stringify(tree), note ?? null, createdBy ?? null, now);
  return revRowToObj(db.prepare('SELECT * FROM page_revisions WHERE id = ?').get(id) as RevRow);
}

export function listRevisions(pageId: string, limit = 50): PageRevision[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM page_revisions WHERE page_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(pageId, limit) as RevRow[];
  return rows.map(revRowToObj);
}

export function getRevision(id: string): PageRevision | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM page_revisions WHERE id = ?').get(id) as RevRow | undefined;
  return row ? revRowToObj(row) : null;
}

export function deleteRevision(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM page_revisions WHERE id = ?').run(id).changes > 0;
}

/** Restore a revision: wipe current tree, reinsert from snapshot. */
export function restoreRevision(revisionId: string): { restored_elements: number } {
  const db = getDb();
  const rev = getRevision(revisionId);
  if (!rev) throw new Error('revision not found');
  const pageId = rev.page_id;

  // Wipe existing elements
  db.prepare('DELETE FROM page_elements WHERE page_id = ?').run(pageId);

  // Recursively reinsert from snapshot (which stores nested nodes)
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO page_elements (id, page_id, parent_id, element_type, widget_type,
      settings_json, style_json, responsive_json, advanced_json, sort_order, is_hidden,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  function walk(nodes: Array<Record<string, unknown>>, parentId: string | null) {
    for (const n of nodes) {
      const id = (n.id as string) ?? randomUUID();
      stmt.run(
        id, pageId, parentId,
        (n.element_type as string) ?? 'section',
        (n.widget_type as string) ?? null,
        JSON.stringify(n.settings ?? {}),
        JSON.stringify(n.style ?? {}),
        JSON.stringify(n.responsive ?? {}),
        JSON.stringify(n.advanced ?? {}),
        (n.sort_order as number) ?? 100,
        n.is_hidden ? 1 : 0,
        now, now,
      );
      count++;
      const kids = (n.children as Array<Record<string, unknown>>) ?? [];
      if (kids.length) walk(kids, id);
    }
  }
  walk(rev.snapshot as unknown as Array<Record<string, unknown>>, null);
  return { restored_elements: count };
}

// ---------- Global styles (43.12) ----------

export interface GlobalStyle {
  id: string;
  kind: string;
  key: string;
  value: string;
  label: string | null;
  updated_at: string;
}

interface GsRow {
  id: string; kind: string; key: string; value: string;
  label: string | null; updated_at: string;
}

function gsRowToObj(row: GsRow): GlobalStyle {
  return { id: row.id, kind: row.kind, key: row.key, value: row.value, label: row.label, updated_at: row.updated_at };
}

export function getGlobalStyles(): Record<string, GlobalStyle[]> {
  const all = listGlobalStyles();
  const grouped: Record<string, GlobalStyle[]> = {};
  for (const g of all) {
    (grouped[g.kind] ??= []).push(g);
  }
  return grouped;
}

export function listGlobalStyles(kind?: string): GlobalStyle[] {
  const db = getDb();
  const rows = kind
    ? db.prepare('SELECT * FROM page_global_styles WHERE kind = ? ORDER BY key').all(kind) as GsRow[]
    : db.prepare('SELECT * FROM page_global_styles ORDER BY kind, key').all() as GsRow[];
  return rows.map(gsRowToObj);
}

export interface SetGlobalStyleInput {
  kind: string;   // 'color' | 'font' | 'spacing' | 'shadow' ...
  key: string;    // semantic id e.g. 'primary', 'heading_font'
  value: string;
  label?: string;
}

export function setGlobalStyle(input: SetGlobalStyleInput): GlobalStyle {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM page_global_styles WHERE kind = ? AND key = ?')
    .get(input.kind, input.key) as GsRow | undefined;
  if (existing) {
    db.prepare('UPDATE page_global_styles SET value = ?, label = COALESCE(?, label), updated_at = ? WHERE id = ?')
      .run(input.value, input.label ?? null, now, existing.id);
    return gsRowToObj(db.prepare('SELECT * FROM page_global_styles WHERE id = ?').get(existing.id) as GsRow);
  }
  const id = randomUUID();
  db.prepare('INSERT INTO page_global_styles (id, kind, key, value, label, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.kind, input.key, input.value, input.label ?? null, now);
  return gsRowToObj(db.prepare('SELECT * FROM page_global_styles WHERE id = ?').get(id) as GsRow);
}

export function deleteGlobalStyle(kind: string, key: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM page_global_styles WHERE kind = ? AND key = ?').run(kind, key).changes > 0;
}

// ---------- Template library (43.13) ----------

export function ensureTemplatesSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      thumbnail_url TEXT,
      category TEXT,
      snapshot_json TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pt_category ON page_templates(category);
  `);
}

export interface PageTemplate {
  id: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  category: string | null;
  snapshot: Array<Record<string, unknown>>;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

interface TplRow {
  id: string; name: string; description: string | null; thumbnail_url: string | null;
  category: string | null; snapshot_json: string; is_builtin: number;
  created_at: string; updated_at: string;
}

function tplRowToObj(row: TplRow): PageTemplate {
  let snap: Array<Record<string, unknown>> = [];
  try { snap = JSON.parse(row.snapshot_json) as Array<Record<string, unknown>>; } catch {}
  return {
    id: row.id, name: row.name, description: row.description,
    thumbnail_url: row.thumbnail_url, category: row.category,
    snapshot: snap, is_builtin: row.is_builtin === 1,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function createTemplate(input: {
  name: string; description?: string; thumbnail_url?: string;
  category?: string; snapshot: Array<Record<string, unknown>>;
}): PageTemplate {
  const db = getDb();
  ensureTemplatesSchema();
  if (!input.name?.trim()) throw new Error('name required');
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO page_templates (id, name, description, thumbnail_url, category, snapshot_json, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, input.name.trim(), input.description ?? null, input.thumbnail_url ?? null,
    input.category ?? null, JSON.stringify(input.snapshot), now, now);
  return tplRowToObj(db.prepare('SELECT * FROM page_templates WHERE id = ?').get(id) as TplRow);
}

export function savePageAsTemplate(pageId: string, name: string, description?: string, category?: string): PageTemplate {
  const tree = getPageTree(pageId);
  return createTemplate({ name, description, category, snapshot: tree as unknown as Array<Record<string, unknown>> });
}

export function listTemplates(category?: string): PageTemplate[] {
  const db = getDb();
  ensureTemplatesSchema();
  const rows = category
    ? db.prepare('SELECT * FROM page_templates WHERE category = ? ORDER BY updated_at DESC').all(category) as TplRow[]
    : db.prepare('SELECT * FROM page_templates ORDER BY updated_at DESC').all() as TplRow[];
  return rows.map(tplRowToObj);
}

export function getTemplate(id: string): PageTemplate | null {
  const db = getDb();
  ensureTemplatesSchema();
  const row = db.prepare('SELECT * FROM page_templates WHERE id = ?').get(id) as TplRow | undefined;
  return row ? tplRowToObj(row) : null;
}

export function applyTemplate(pageId: string, templateId: string, replace = false): { applied_elements: number } {
  const db = getDb();
  const tpl = getTemplate(templateId);
  if (!tpl) throw new Error('template not found');
  if (replace) db.prepare('DELETE FROM page_elements WHERE page_id = ?').run(pageId);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO page_elements (id, page_id, parent_id, element_type, widget_type,
      settings_json, style_json, responsive_json, advanced_json, sort_order, is_hidden,
      created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let count = 0;
  function walk(nodes: Array<Record<string, unknown>>, parentId: string | null) {
    for (const n of nodes) {
      const id = randomUUID();
      stmt.run(
        id, pageId, parentId,
        (n.element_type as string) ?? 'section',
        (n.widget_type as string) ?? null,
        JSON.stringify(n.settings ?? {}),
        JSON.stringify(n.style ?? {}),
        JSON.stringify(n.responsive ?? {}),
        JSON.stringify(n.advanced ?? {}),
        (n.sort_order as number) ?? 100,
        n.is_hidden ? 1 : 0,
        now, now,
      );
      count++;
      const kids = (n.children as Array<Record<string, unknown>>) ?? [];
      if (kids.length) walk(kids, id);
    }
  }
  walk(tpl.snapshot, null);
  return { applied_elements: count };
}

export function deleteTemplate(id: string): boolean {
  const db = getDb();
  ensureTemplatesSchema();
  return db.prepare('DELETE FROM page_templates WHERE id = ?').run(id).changes > 0;
}

// ---------- Form submissions (43.15) ----------

export function ensureFormsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_form_submissions (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      element_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      submitter_ip TEXT,
      submitter_user_id TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pfs_page ON page_form_submissions(page_id);
    CREATE INDEX IF NOT EXISTS idx_pfs_element ON page_form_submissions(element_id);
    CREATE INDEX IF NOT EXISTS idx_pfs_status ON page_form_submissions(status);
  `);
}

export interface FormSubmission {
  id: string;
  page_id: string;
  element_id: string;
  data: Record<string, unknown>;
  submitter_ip: string | null;
  submitter_user_id: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface FsRow {
  id: string; page_id: string; element_id: string; data_json: string;
  submitter_ip: string | null; submitter_user_id: string | null;
  status: string; notes: string | null; created_at: string;
}

function fsRowToObj(row: FsRow): FormSubmission {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(row.data_json) as Record<string, unknown>; } catch {}
  return {
    id: row.id, page_id: row.page_id, element_id: row.element_id,
    data, submitter_ip: row.submitter_ip, submitter_user_id: row.submitter_user_id,
    status: row.status, notes: row.notes, created_at: row.created_at,
  };
}

export function submitForm(input: {
  page_id: string;
  element_id: string;
  data: Record<string, unknown>;
  submitter_ip?: string;
  submitter_user_id?: string;
}): FormSubmission {
  const db = getDb();
  ensureFormsSchema();
  // validate element is a form widget on that page
  const el = getElement(input.element_id);
  if (!el) throw new Error('form element not found');
  if (el.widget_type !== 'form') throw new Error('element is not a form');
  if (el.page_id !== input.page_id) throw new Error('element/page mismatch');

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO page_form_submissions (id, page_id, element_id, data_json, submitter_ip, submitter_user_id, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'new', NULL, ?)
  `).run(
    id, input.page_id, input.element_id, JSON.stringify(input.data),
    input.submitter_ip ?? null, input.submitter_user_id ?? null, now,
  );
  return fsRowToObj(db.prepare('SELECT * FROM page_form_submissions WHERE id = ?').get(id) as FsRow);
}

export function listFormSubmissions(pageId: string, opts: { status?: string; limit?: number } = {}): FormSubmission[] {
  const db = getDb();
  ensureFormsSchema();
  const limit = Math.min(opts.limit ?? 100, 500);
  const rows = opts.status
    ? db.prepare('SELECT * FROM page_form_submissions WHERE page_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?').all(pageId, opts.status, limit) as FsRow[]
    : db.prepare('SELECT * FROM page_form_submissions WHERE page_id = ? ORDER BY created_at DESC LIMIT ?').all(pageId, limit) as FsRow[];
  return rows.map(fsRowToObj);
}

export function updateFormSubmission(id: string, patch: { status?: string; notes?: string }): FormSubmission | null {
  const db = getDb();
  ensureFormsSchema();
  const row = db.prepare('SELECT * FROM page_form_submissions WHERE id = ?').get(id) as FsRow | undefined;
  if (!row) return null;
  db.prepare('UPDATE page_form_submissions SET status = COALESCE(?, status), notes = COALESCE(?, notes) WHERE id = ?')
    .run(patch.status ?? null, patch.notes ?? null, id);
  return fsRowToObj(db.prepare('SELECT * FROM page_form_submissions WHERE id = ?').get(id) as FsRow);
}

export function deleteFormSubmission(id: string): boolean {
  const db = getDb();
  ensureFormsSchema();
  return db.prepare('DELETE FROM page_form_submissions WHERE id = ?').run(id).changes > 0;
}

// ---------- Element-level CSS/JS injection (43.14) ----------

export interface PageCssJsBundle {
  page_id: string;
  css: string;
  js: string;
  per_element: Array<{ element_id: string; css: string; js: string }>;
}

/** Collect custom CSS/JS from every element on a page for render-time injection. */
export function collectPageCssJs(pageId: string): PageCssJsBundle {
  const elements = listPageElements(pageId);
  const perElement: PageCssJsBundle['per_element'] = [];
  let css = '';
  let js = '';
  for (const el of elements) {
    const customCss = (el.advanced.custom_css as string | undefined) ?? '';
    const customJs = (el.advanced.custom_js as string | undefined) ?? '';
    if (customCss || customJs) {
      // scoped CSS: wrap with .mf-el-<id> selector
      const scopedCss = customCss ? `.mf-el-${el.id} { ${customCss} }` : '';
      const scopedJs = customJs
        ? `document.querySelectorAll('.mf-el-${el.id}').forEach(function(el){ try { ${customJs} } catch(e) {} });`
        : '';
      css += scopedCss + '\n';
      js += scopedJs + '\n';
      perElement.push({ element_id: el.id, css: scopedCss, js: scopedJs });
    }
  }
  return { page_id: pageId, css, js, per_element: perElement };
}
