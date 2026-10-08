// melodyflix videos - Website Builder & Customization (Section 43)
//
// JSON-config-driven site builder. The admin stores:
//  - site_settings (name, logo, meta)
//  - themes (colors, fonts, mode)
//  - homepage_layout (ordered list of sections with config)
//  - custom_pages (slug, title, content, published)
//  - navigation (header + footer menus)
//
// Public read endpoints render the config; a frontend renderer walks
// it. Drag-drop editor UI is a separate deliverable.

import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export function ensureWebsiteBuilderSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id TEXT PRIMARY KEY,
      site_name TEXT NOT NULL DEFAULT 'MelodyFlix',
      logo_url TEXT,
      favicon_url TEXT,
      tagline TEXT,
      meta_description TEXT,
      meta_keywords TEXT,
      contact_email TEXT,
      support_url TEXT,
      social_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_themes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT 'dark',
      primary_color TEXT NOT NULL DEFAULT '#e50914',
      secondary_color TEXT NOT NULL DEFAULT '#221f1f',
      accent_color TEXT NOT NULL DEFAULT '#ffffff',
      bg_color TEXT NOT NULL DEFAULT '#0b0b0b',
      text_color TEXT NOT NULL DEFAULT '#f5f5f5',
      heading_font TEXT NOT NULL DEFAULT 'Inter',
      body_font TEXT NOT NULL DEFAULT 'Inter',
      custom_css TEXT,
      tokens_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_theme_active ON site_themes(is_active);

    CREATE TABLE IF NOT EXISTS homepage_layout (
      id TEXT PRIMARY KEY,
      section_key TEXT NOT NULL UNIQUE,
      section_type TEXT NOT NULL,
      title TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_pages (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content_md TEXT,
      content_html TEXT,
      meta_description TEXT,
      is_published INTEGER NOT NULL DEFAULT 0,
      show_in_nav INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_page_slug ON custom_pages(slug);
    CREATE INDEX IF NOT EXISTS idx_page_published ON custom_pages(is_published);

    CREATE TABLE IF NOT EXISTS navigation_menu (
      id TEXT PRIMARY KEY,
      location TEXT NOT NULL,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 100,
      is_external INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_nav_location ON navigation_menu(location);
  `);
}

// ---------- 43.1 Site Settings ----------

export interface SiteSettings {
  id: string;
  site_name: string;
  logo_url: string | null;
  favicon_url: string | null;
  tagline: string | null;
  meta_description: string | null;
  meta_keywords: string | null;
  contact_email: string | null;
  support_url: string | null;
  social: Record<string, string>;
  updated_at: string;
}

const SITE_SETTINGS_ID = 'default';

export function getSiteSettings(): SiteSettings {
  const db = getDb();
  const row = db.prepare('SELECT * FROM site_settings WHERE id = ?').get(SITE_SETTINGS_ID) as
    | { id: string; site_name: string; logo_url: string | null; favicon_url: string | null;
        tagline: string | null; meta_description: string | null; meta_keywords: string | null;
        contact_email: string | null; support_url: string | null; social_json: string; updated_at: string }
    | undefined;

  if (row) {
    let social: Record<string, string> = {};
    try { social = JSON.parse(row.social_json) as Record<string, string>; } catch {}
    return {
      id: row.id, site_name: row.site_name, logo_url: row.logo_url,
      favicon_url: row.favicon_url, tagline: row.tagline,
      meta_description: row.meta_description, meta_keywords: row.meta_keywords,
      contact_email: row.contact_email, support_url: row.support_url,
      social, updated_at: row.updated_at,
    };
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO site_settings (id, site_name, social_json, updated_at) VALUES (?, 'MelodyFlix', '{}', ?)
  `).run(SITE_SETTINGS_ID, now);
  return getSiteSettings();
}

export interface SetSiteSettingsInput {
  site_name?: string;
  logo_url?: string | null;
  favicon_url?: string | null;
  tagline?: string | null;
  meta_description?: string | null;
  meta_keywords?: string | null;
  contact_email?: string | null;
  support_url?: string | null;
  social?: Record<string, string>;
}

export function setSiteSettings(input: SetSiteSettingsInput): SiteSettings {
  const db = getDb();
  const cur = getSiteSettings();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE site_settings SET
      site_name = ?, logo_url = ?, favicon_url = ?, tagline = ?,
      meta_description = ?, meta_keywords = ?, contact_email = ?, support_url = ?,
      social_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.site_name?.trim() || cur.site_name,
    input.logo_url !== undefined ? input.logo_url : cur.logo_url,
    input.favicon_url !== undefined ? input.favicon_url : cur.favicon_url,
    input.tagline !== undefined ? input.tagline : cur.tagline,
    input.meta_description !== undefined ? input.meta_description : cur.meta_description,
    input.meta_keywords !== undefined ? input.meta_keywords : cur.meta_keywords,
    input.contact_email !== undefined ? input.contact_email : cur.contact_email,
    input.support_url !== undefined ? input.support_url : cur.support_url,
    input.social !== undefined ? JSON.stringify(input.social) : JSON.stringify(cur.social),
    now, SITE_SETTINGS_ID,
  );
  return getSiteSettings();
}

// ---------- 43.2 Themes ----------

export interface SiteTheme {
  id: string;
  name: string;
  is_active: boolean;
  mode: 'dark' | 'light' | 'auto';
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  bg_color: string;
  text_color: string;
  heading_font: string;
  body_font: string;
  custom_css: string | null;
  tokens: Record<string, string>;
  updated_at: string;
}

interface ThemeRow {
  id: string; name: string; is_active: number; mode: string;
  primary_color: string; secondary_color: string; accent_color: string;
  bg_color: string; text_color: string; heading_font: string; body_font: string;
  custom_css: string | null; tokens_json: string; updated_at: string;
}

function themeRowToObj(row: ThemeRow): SiteTheme {
  let tokens: Record<string, string> = {};
  try { tokens = JSON.parse(row.tokens_json) as Record<string, string>; } catch {}
  return {
    id: row.id, name: row.name, is_active: row.is_active === 1,
    mode: row.mode as SiteTheme['mode'],
    primary_color: row.primary_color, secondary_color: row.secondary_color,
    accent_color: row.accent_color, bg_color: row.bg_color, text_color: row.text_color,
    heading_font: row.heading_font, body_font: row.body_font,
    custom_css: row.custom_css, tokens, updated_at: row.updated_at,
  };
}

export function listThemes(): SiteTheme[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM site_themes ORDER BY is_active DESC, updated_at DESC')
    .all() as ThemeRow[];
  return rows.map(themeRowToObj);
}

export function getActiveTheme(): SiteTheme {
  const db = getDb();
  let row = db.prepare('SELECT * FROM site_themes WHERE is_active = 1 LIMIT 1').get() as ThemeRow | undefined;
  if (!row) {
    // seed default
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO site_themes (id, name, is_active, mode, primary_color, secondary_color,
        accent_color, bg_color, text_color, heading_font, body_font, tokens_json, updated_at)
      VALUES (?, 'Default Dark', 1, 'dark', '#e50914', '#221f1f', '#ffffff', '#0b0b0b', '#f5f5f5', 'Inter', 'Inter', '{}', ?)
    `).run(id, now);
    row = db.prepare('SELECT * FROM site_themes WHERE id = ?').get(id) as ThemeRow;
  }
  return themeRowToObj(row);
}

export interface CreateThemeInput {
  name: string;
  mode?: 'dark' | 'light' | 'auto';
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  bg_color?: string;
  text_color?: string;
  heading_font?: string;
  body_font?: string;
  custom_css?: string | null;
  tokens?: Record<string, string>;
}

export function createTheme(input: CreateThemeInput): SiteTheme {
  const db = getDb();
  if (!input.name?.trim()) throw new Error('name required');
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO site_themes (id, name, is_active, mode, primary_color, secondary_color,
      accent_color, bg_color, text_color, heading_font, body_font, custom_css, tokens_json, updated_at)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.name.trim(), input.mode ?? 'dark',
    input.primary_color ?? '#e50914', input.secondary_color ?? '#221f1f',
    input.accent_color ?? '#ffffff', input.bg_color ?? '#0b0b0b', input.text_color ?? '#f5f5f5',
    input.heading_font ?? 'Inter', input.body_font ?? 'Inter',
    input.custom_css ?? null, JSON.stringify(input.tokens ?? {}), now,
  );
  const row = db.prepare('SELECT * FROM site_themes WHERE id = ?').get(id) as ThemeRow;
  return themeRowToObj(row);
}

export interface UpdateThemeInput extends Partial<CreateThemeInput> {
  is_active?: boolean;
}

export function updateTheme(id: string, patch: UpdateThemeInput): SiteTheme | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM site_themes WHERE id = ?').get(id) as ThemeRow | undefined;
  if (!row) return null;
  const cur = themeRowToObj(row);
  const now = new Date().toISOString();

  if (patch.is_active) {
    db.prepare('UPDATE site_themes SET is_active = 0').run();
  }

  db.prepare(`
    UPDATE site_themes SET
      name = ?, is_active = ?, mode = ?, primary_color = ?, secondary_color = ?,
      accent_color = ?, bg_color = ?, text_color = ?, heading_font = ?, body_font = ?,
      custom_css = ?, tokens_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    patch.name?.trim() || cur.name,
    patch.is_active !== undefined ? (patch.is_active ? 1 : 0) : (cur.is_active ? 1 : 0),
    patch.mode ?? cur.mode,
    patch.primary_color ?? cur.primary_color,
    patch.secondary_color ?? cur.secondary_color,
    patch.accent_color ?? cur.accent_color,
    patch.bg_color ?? cur.bg_color,
    patch.text_color ?? cur.text_color,
    patch.heading_font ?? cur.heading_font,
    patch.body_font ?? cur.body_font,
    patch.custom_css !== undefined ? patch.custom_css : cur.custom_css,
    patch.tokens !== undefined ? JSON.stringify(patch.tokens) : JSON.stringify(cur.tokens),
    now, id,
  );
  const updated = db.prepare('SELECT * FROM site_themes WHERE id = ?').get(id) as ThemeRow;
  return themeRowToObj(updated);
}

export function deleteTheme(id: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT is_active FROM site_themes WHERE id = ?').get(id) as { is_active: number } | undefined;
  if (!row) return false;
  if (row.is_active === 1) throw new Error('Cannot delete the active theme');
  return db.prepare('DELETE FROM site_themes WHERE id = ?').run(id).changes > 0;
}

// ---------- 43.3 Homepage Layout ----------

export interface HomepageSection {
  id: string;
  section_key: string;
  section_type: string;
  title: string | null;
  config: Record<string, unknown>;
  sort_order: number;
  enabled: boolean;
  updated_at: string;
}

interface HpRow {
  id: string; section_key: string; section_type: string; title: string | null;
  config_json: string; sort_order: number; enabled: number; updated_at: string;
}

function hpRowToObj(row: HpRow): HomepageSection {
  let config: Record<string, unknown> = {};
  try { config = JSON.parse(row.config_json) as Record<string, unknown>; } catch {}
  return {
    id: row.id, section_key: row.section_key, section_type: row.section_type,
    title: row.title, config, sort_order: row.sort_order,
    enabled: row.enabled === 1, updated_at: row.updated_at,
  };
}

export function listHomepageSections(opts: { enabledOnly?: boolean } = {}): HomepageSection[] {
  const db = getDb();
  const where = opts.enabledOnly ? 'WHERE enabled = 1' : '';
  const rows = db.prepare(
    `SELECT * FROM homepage_layout ${where} ORDER BY sort_order ASC, section_key ASC`
  ).all() as HpRow[];
  return rows.map(hpRowToObj);
}

export interface UpsertHomepageSectionInput {
  section_key: string;
  section_type: string;
  title?: string | null;
  config?: Record<string, unknown>;
  sort_order?: number;
  enabled?: boolean;
}

export function upsertHomepageSection(input: UpsertHomepageSectionInput): HomepageSection {
  const db = getDb();
  const key = input.section_key.trim();
  if (!key) throw new Error('section_key required');
  if (!input.section_type?.trim()) throw new Error('section_type required');
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM homepage_layout WHERE section_key = ?').get(key) as HpRow | undefined;
  if (existing) {
    db.prepare(`
      UPDATE homepage_layout SET section_type = ?, title = ?, config_json = ?,
        sort_order = ?, enabled = ?, updated_at = ? WHERE section_key = ?
    `).run(
      input.section_type, input.title ?? null,
      JSON.stringify(input.config ?? {}),
      input.sort_order ?? existing.sort_order,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled,
      now, key,
    );
    return hpRowToObj(db.prepare('SELECT * FROM homepage_layout WHERE section_key = ?').get(key) as HpRow);
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO homepage_layout (id, section_key, section_type, title, config_json, sort_order, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, key, input.section_type, input.title ?? null,
    JSON.stringify(input.config ?? {}), input.sort_order ?? 100,
    input.enabled === false ? 0 : 1, now);
  return hpRowToObj(db.prepare('SELECT * FROM homepage_layout WHERE id = ?').get(id) as HpRow);
}

export function reorderHomepageSections(order: string[]): HomepageSection[] {
  const db = getDb();
  const now = new Date().toISOString();
  for (let i = 0; i < order.length; i++) {
    db.prepare('UPDATE homepage_layout SET sort_order = ?, updated_at = ? WHERE section_key = ?')
      .run(i * 10, now, order[i]);
  }
  return listHomepageSections();
}

export function deleteHomepageSection(sectionKey: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM homepage_layout WHERE section_key = ?').run(sectionKey).changes > 0;
}

// ---------- 43.4 Custom Pages ----------

export interface CustomPage {
  id: string;
  slug: string;
  title: string;
  content_md: string | null;
  content_html: string | null;
  meta_description: string | null;
  is_published: boolean;
  show_in_nav: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface CpRow {
  id: string; slug: string; title: string; content_md: string | null; content_html: string | null;
  meta_description: string | null; is_published: number; show_in_nav: number;
  sort_order: number; created_at: string; updated_at: string;
}

function cpRowToObj(row: CpRow): CustomPage {
  return {
    id: row.id, slug: row.slug, title: row.title,
    content_md: row.content_md, content_html: row.content_html,
    meta_description: row.meta_description,
    is_published: row.is_published === 1, show_in_nav: row.show_in_nav === 1,
    sort_order: row.sort_order, created_at: row.created_at, updated_at: row.updated_at,
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'page';
}

export interface CreatePageInput {
  slug?: string;
  title: string;
  content_md?: string | null;
  content_html?: string | null;
  meta_description?: string | null;
  is_published?: boolean;
  show_in_nav?: boolean;
  sort_order?: number;
}

export function createCustomPage(input: CreatePageInput): CustomPage {
  const db = getDb();
  if (!input.title?.trim()) throw new Error('title required');
  const slug = slugify(input.slug ?? input.title);
  const existing = db.prepare('SELECT id FROM custom_pages WHERE slug = ?').get(slug);
  if (existing) throw new Error(`slug already exists: ${slug}`);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO custom_pages (id, slug, title, content_md, content_html, meta_description,
      is_published, show_in_nav, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, slug, input.title.trim(), input.content_md ?? null, input.content_html ?? null,
    input.meta_description ?? null, input.is_published ? 1 : 0, input.show_in_nav ? 1 : 0,
    input.sort_order ?? 100, now, now,
  );
  return cpRowToObj(db.prepare('SELECT * FROM custom_pages WHERE id = ?').get(id) as CpRow);
}

export function listCustomPages(opts: { publishedOnly?: boolean } = {}): CustomPage[] {
  const db = getDb();
  const where = opts.publishedOnly ? 'WHERE is_published = 1' : '';
  const rows = db.prepare(
    `SELECT * FROM custom_pages ${where} ORDER BY sort_order ASC, title ASC`
  ).all() as CpRow[];
  return rows.map(cpRowToObj);
}

export function getCustomPageBySlug(slug: string): CustomPage | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM custom_pages WHERE slug = ?').get(slug) as CpRow | undefined;
  return row ? cpRowToObj(row) : null;
}

export interface UpdatePageInput extends Partial<CreatePageInput> {}

export function updateCustomPage(id: string, patch: UpdatePageInput): CustomPage | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM custom_pages WHERE id = ?').get(id) as CpRow | undefined;
  if (!row) return null;
  const cur = cpRowToObj(row);
  const now = new Date().toISOString();
  const newSlug = patch.slug ? slugify(patch.slug) : cur.slug;
  if (newSlug !== cur.slug) {
    const dup = db.prepare('SELECT id FROM custom_pages WHERE slug = ? AND id != ?').get(newSlug, id);
    if (dup) throw new Error(`slug already exists: ${newSlug}`);
  }
  db.prepare(`
    UPDATE custom_pages SET slug = ?, title = ?, content_md = ?, content_html = ?,
      meta_description = ?, is_published = ?, show_in_nav = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    newSlug, patch.title?.trim() || cur.title,
    patch.content_md !== undefined ? patch.content_md : cur.content_md,
    patch.content_html !== undefined ? patch.content_html : cur.content_html,
    patch.meta_description !== undefined ? patch.meta_description : cur.meta_description,
    patch.is_published !== undefined ? (patch.is_published ? 1 : 0) : (cur.is_published ? 1 : 0),
    patch.show_in_nav !== undefined ? (patch.show_in_nav ? 1 : 0) : (cur.show_in_nav ? 1 : 0),
    patch.sort_order ?? cur.sort_order,
    now, id,
  );
  return cpRowToObj(db.prepare('SELECT * FROM custom_pages WHERE id = ?').get(id) as CpRow);
}

export function deleteCustomPage(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM custom_pages WHERE id = ?').run(id).changes > 0;
}

// ---------- 43.5 Navigation Menu ----------

export interface NavItem {
  id: string;
  location: 'header' | 'footer' | 'sidebar';
  label: string;
  url: string;
  parent_id: string | null;
  sort_order: number;
  is_external: boolean;
  enabled: boolean;
  updated_at: string;
}

interface NavRow {
  id: string; location: string; label: string; url: string;
  parent_id: string | null; sort_order: number;
  is_external: number; enabled: number; updated_at: string;
}

function navRowToObj(row: NavRow): NavItem {
  return {
    id: row.id, location: row.location as NavItem['location'],
    label: row.label, url: row.url, parent_id: row.parent_id,
    sort_order: row.sort_order, is_external: row.is_external === 1,
    enabled: row.enabled === 1, updated_at: row.updated_at,
  };
}

export function listNavItems(opts: { location?: NavItem['location']; enabledOnly?: boolean } = {}): NavItem[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.location) { where.push('location = ?'); params.push(opts.location); }
  if (opts.enabledOnly) where.push('enabled = 1');
  const sql = `SELECT * FROM navigation_menu${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY location, sort_order, label`;
  const rows = db.prepare(sql).all(...params) as NavRow[];
  return rows.map(navRowToObj);
}

export interface UpsertNavItemInput {
  id?: string;
  location: NavItem['location'];
  label: string;
  url: string;
  parent_id?: string | null;
  sort_order?: number;
  is_external?: boolean;
  enabled?: boolean;
}

export function upsertNavItem(input: UpsertNavItemInput): NavItem {
  const db = getDb();
  if (!input.label?.trim()) throw new Error('label required');
  if (!input.url?.trim()) throw new Error('url required');
  const now = new Date().toISOString();
  if (input.id) {
    const row = db.prepare('SELECT * FROM navigation_menu WHERE id = ?').get(input.id) as NavRow | undefined;
    if (!row) throw new Error('nav item not found');
    db.prepare(`
      UPDATE navigation_menu SET location = ?, label = ?, url = ?, parent_id = ?,
        sort_order = ?, is_external = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(
      input.location, input.label.trim(), input.url.trim(),
      input.parent_id ?? null, input.sort_order ?? row.sort_order,
      input.is_external !== undefined ? (input.is_external ? 1 : 0) : row.is_external,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : row.enabled,
      now, input.id,
    );
    return navRowToObj(db.prepare('SELECT * FROM navigation_menu WHERE id = ?').get(input.id) as NavRow);
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO navigation_menu (id, location, label, url, parent_id, sort_order, is_external, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, input.location, input.label.trim(), input.url.trim(),
    input.parent_id ?? null, input.sort_order ?? 100,
    input.is_external ? 1 : 0, input.enabled === false ? 0 : 1, now,
  );
  return navRowToObj(db.prepare('SELECT * FROM navigation_menu WHERE id = ?').get(id) as NavRow);
}

export function deleteNavItem(id: string): boolean {
  const db = getDb();
  return db.prepare('DELETE FROM navigation_menu WHERE id = ?').run(id).changes > 0;
}

// ---------- 43.6 Public render ----------

export interface SiteRenderConfig {
  settings: SiteSettings;
  theme: SiteTheme;
  homepage: HomepageSection[];
  header_nav: NavItem[];
  footer_nav: NavItem[];
  nav_pages: Array<{ slug: string; title: string; sort_order: number }>;
}

export function getPublicRenderConfig(): SiteRenderConfig {
  const settings = getSiteSettings();
  const theme = getActiveTheme();
  const homepage = listHomepageSections({ enabledOnly: true });
  const header = listNavItems({ location: 'header', enabledOnly: true });
  const footer = listNavItems({ location: 'footer', enabledOnly: true });
  const navPages = listCustomPages({ publishedOnly: true })
    .filter((p) => p.show_in_nav)
    .map((p) => ({ slug: p.slug, title: p.title, sort_order: p.sort_order }));
  return {
    settings, theme, homepage,
    header_nav: header, footer_nav: footer,
    nav_pages: navPages,
  };
}
