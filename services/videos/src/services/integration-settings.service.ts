// melodyflix videos — Integration Settings (centralized external API config)
// All external API keys stored here, editable via admin panel.
// Keys are never returned in plaintext via GET — only masked.
import { randomUUID, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type IntegrationId =
  | 'tmdb' | 'omdb' | 'giphy' | 'tenor' | 'newsapi' | 'rss_generic'
  | 'openai' | 'anthropic' | 'gemini' | 'azure_tts' | 'elevenlabs'
  | 'turn_server' | 'smtp' | 'bkash' | 'nagad' | 'sslcommerz'
  | 'stripe' | 'paypal' | 'razorpay'
  | 'maxmind';

export interface IntegrationSetting {
  id: IntegrationId;
  label: string;
  category: string;
  is_enabled: number;
  config_json: string;   // JSON with keys — masked on read
  has_credentials: number;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

interface IntegrationDefault {
  id: IntegrationId;
  label: string;
  category: string;
  config: Record<string, string>;
}

const DEFAULTS: IntegrationDefault[] = [
  // Metadata
  { id: 'tmdb', label: 'TMDB (The Movie Database)', category: 'metadata',
    config: { api_key: '', base_url: 'https://api.themoviedb.org/3', language: 'en-US' } },
  { id: 'omdb', label: 'OMDb (IMDb ratings)', category: 'metadata',
    config: { api_key: '', base_url: 'https://www.omdbapi.com' } },
  // Emoji / stickers
  { id: 'giphy', label: 'Giphy (animated GIFs)', category: 'rich_media',
    config: { api_key: '', rating: 'pg-13' } },
  { id: 'tenor', label: 'Tenor (GIFs, Google)', category: 'rich_media',
    config: { api_key: '', locale: 'en_US' } },
  // News
  { id: 'newsapi', label: 'NewsAPI.org', category: 'news',
    config: { api_key: '', base_url: 'https://newsapi.org/v2' } },
  { id: 'rss_generic', label: 'Generic RSS Feeds', category: 'news',
    config: { feed_urls: '', fetch_interval_minutes: '30' } },
  // AI
  { id: 'openai', label: 'OpenAI', category: 'ai',
    config: { api_key: '', model: 'gpt-4o-mini', base_url: 'https://api.openai.com/v1' } },
  { id: 'anthropic', label: 'Anthropic Claude', category: 'ai',
    config: { api_key: '', model: 'claude-3-5-sonnet-latest' } },
  { id: 'gemini', label: 'Google Gemini', category: 'ai',
    config: { api_key: '', model: 'gemini-1.5-flash' } },
  // TTS / Voice
  { id: 'azure_tts', label: 'Azure TTS', category: 'voice',
    config: { api_key: '', region: 'eastus' } },
  { id: 'elevenlabs', label: 'ElevenLabs', category: 'voice',
    config: { api_key: '' } },
  // WebRTC / Calls
  { id: 'turn_server', label: 'TURN Server (coturn)', category: 'webrtc',
    config: { url: '', username: '', credential: '', stun_url: 'stun:stun.l.google.com:19302' } },
  // Email
  { id: 'smtp', label: 'SMTP Email', category: 'email',
    config: { host: '', port: '587', secure: 'false', user: '', pass: '', from_email: '' } },
  // Payments
  { id: 'bkash', label: 'bKash', category: 'payment',
    config: { app_key: '', app_secret: '', username: '', password: '', sandbox: 'true' } },
  { id: 'nagad', label: 'Nagad', category: 'payment',
    config: { merchant_id: '', merchant_key: '', sandbox: 'true' } },
  { id: 'sslcommerz', label: 'SSLCommerz', category: 'payment',
    config: { store_id: '', store_passwd: '', sandbox: 'true' } },
  { id: 'stripe', label: 'Stripe', category: 'payment',
    config: { secret_key: '', publishable_key: '', webhook_secret: '' } },
  { id: 'paypal', label: 'PayPal', category: 'payment',
    config: { client_id: '', client_secret: '', mode: 'sandbox' } },
  { id: 'razorpay', label: 'Razorpay', category: 'payment',
    config: { key_id: '', key_secret: '' } },
  // Security / Geo (Section 11)
  { id: 'maxmind', label: 'MaxMind GeoIP2', category: 'security',
    config: { account_id: '', license_key: '', db_path: '' } },
];

// Keys considered sensitive → mask on read
const SENSITIVE_KEYS = new Set([
  'api_key', 'app_key', 'app_secret', 'password', 'pass', 'passwd',
  'secret_key', 'key_secret', 'client_secret', 'credential',
  'store_passwd', 'merchant_key', 'webhook_secret',
]);

export function ensureIntegrationSettingsSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS integration_settings (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      category TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL,
      has_credentials INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_integ_category ON integration_settings(category);
    CREATE INDEX IF NOT EXISTS idx_integ_enabled ON integration_settings(is_enabled);
  `);

  const now = new Date().toISOString();
  const ins = db.prepare(`
    INSERT OR IGNORE INTO integration_settings
      (id, label, category, is_enabled, config_json, has_credentials, updated_by, updated_at, created_at)
    VALUES (?, ?, ?, 0, ?, 0, NULL, ?, ?)
  `);
  for (const d of DEFAULTS) {
    ins.run(d.id, d.label, d.category, JSON.stringify(d.config), now, now);
  }
}

function hasAnyCredential(config: Record<string, unknown>): boolean {
  return Object.entries(config).some(([k, v]) =>
    SENSITIVE_KEYS.has(k) && typeof v === 'string' && v.length > 0
  );
}

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (SENSITIVE_KEYS.has(k) && typeof v === 'string' && v.length > 0) {
      out[k] = '••••••' + v.slice(-4);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function decryptForUse(_id: IntegrationId): Record<string, unknown> {
  // Placeholder for future encryption — currently reads plaintext
  // (will be encrypted-at-rest when we add a KMS)
  throw new Error('Not used yet');
}

// ============================================================
// Public API
// ============================================================

export interface IntegrationView {
  id: IntegrationId;
  label: string;
  category: string;
  is_enabled: boolean;
  has_credentials: boolean;
  config: Record<string, unknown>;   // masked
  updated_at: string;
}

export function listIntegrations(opts: { category?: string; enabledOnly?: boolean } = {}): IntegrationView[] {
  const db = getDb();
  const filters: string[] = [];
  const params: any[] = [];
  if (opts.category) { filters.push('category = ?'); params.push(opts.category); }
  if (opts.enabledOnly) { filters.push('is_enabled = 1'); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM integration_settings ${where} ORDER BY category ASC, label ASC`
  ).all(...params) as IntegrationSetting[];

  return rows.map((r) => {
    const cfg = JSON.parse(r.config_json) as Record<string, unknown>;
    return {
      id: r.id as IntegrationId,
      label: r.label,
      category: r.category,
      is_enabled: r.is_enabled === 1,
      has_credentials: r.has_credentials === 1,
      config: maskConfig(cfg),
      updated_at: r.updated_at,
    };
  });
}

export function getIntegration(id: IntegrationId): IntegrationView | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM integration_settings WHERE id = ?').get(id) as IntegrationSetting | undefined;
  if (!r) return null;
  const cfg = JSON.parse(r.config_json) as Record<string, unknown>;
  return {
    id: r.id as IntegrationId,
    label: r.label,
    category: r.category,
    is_enabled: r.is_enabled === 1,
    has_credentials: r.has_credentials === 1,
    config: maskConfig(cfg),
    updated_at: r.updated_at,
  };
}

/** Raw config for internal service use — DO NOT return this via API. */
export function getIntegrationConfigRaw(id: IntegrationId): Record<string, unknown> | null {
  const db = getDb();
  const r = db.prepare('SELECT config_json FROM integration_settings WHERE id = ?').get(id) as
    { config_json: string } | undefined;
  if (!r) return null;
  return JSON.parse(r.config_json) as Record<string, unknown>;
}

export function updateIntegration(id: IntegrationId, patch: {
  is_enabled?: boolean;
  config?: Record<string, string>;
  updated_by?: string;
}): IntegrationView {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM integration_settings WHERE id = ?').get(id) as IntegrationSetting | undefined;
  if (!existing) throw new Error(`Integration ${id} not found`);

  const currentConfig = JSON.parse(existing.config_json) as Record<string, unknown>;
  let mergedConfig = currentConfig;
  if (patch.config) {
    mergedConfig = { ...currentConfig, ...patch.config };
    // Blank values for sensitive keys → clear them (intentional)
    for (const [k, v] of Object.entries(patch.config)) {
      if (SENSITIVE_KEYS.has(k) && (v === '' || v === null)) {
        mergedConfig[k] = '';
      }
    }
  }
  const hasCreds = hasAnyCredential(mergedConfig);
  const now = new Date().toISOString();

  const fields: string[] = ['config_json = ?', 'has_credentials = ?', 'updated_at = ?'];
  const params: any[] = [JSON.stringify(mergedConfig), hasCreds ? 1 : 0, now];
  if (patch.is_enabled !== undefined) { fields.push('is_enabled = ?'); params.push(patch.is_enabled ? 1 : 0); }
  if (patch.updated_by !== undefined) { fields.push('updated_by = ?'); params.push(patch.updated_by); }
  params.push(id);

  db.prepare(`UPDATE integration_settings SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getIntegration(id)!;
}

export function isIntegrationReady(id: IntegrationId): boolean {
  const db = getDb();
  const r = db.prepare('SELECT is_enabled, has_credentials FROM integration_settings WHERE id = ?').get(id) as
    { is_enabled: number; has_credentials: number } | undefined;
  if (!r) return false;
  return r.is_enabled === 1 && r.has_credentials === 1;
}

export interface IntegrationHealth {
  id: IntegrationId;
  label: string;
  ready: boolean;
  is_enabled: boolean;
  has_credentials: boolean;
  missing_fields: string[];
}

/** Quick check: which fields are still empty for a given integration. */
export function checkIntegrationHealth(id: IntegrationId): IntegrationHealth | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM integration_settings WHERE id = ?').get(id) as IntegrationSetting | undefined;
  if (!r) return null;
  const cfg = JSON.parse(r.config_json) as Record<string, unknown>;

  // Fields that need to be non-empty (sensitive only — non-sensitive have defaults)
  const required = Object.keys(cfg).filter((k) => SENSITIVE_KEYS.has(k));
  const missing = required.filter((k) => !cfg[k] || (typeof cfg[k] === 'string' && (cfg[k] as string).length === 0));

  return {
    id: r.id as IntegrationId,
    label: r.label,
    ready: r.is_enabled === 1 && r.has_credentials === 1 && missing.length === 0,
    is_enabled: r.is_enabled === 1,
    has_credentials: r.has_credentials === 1,
    missing_fields: missing,
  };
}

export function listIntegrationHealth(): IntegrationHealth[] {
  return listIntegrations().map((i) => checkIntegrationHealth(i.id)!).filter(Boolean);
}
