// melodyflix videos - Section 11.12 IP Blocking
// CIDR-based IP blocklist with expiry, reason, scope (global/api/login).
// Supports IPv4 + IPv6 CIDR. Checks incoming IP against active rules.
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type BlockScope = 'global' | 'api' | 'login' | 'upload' | 'comment';
export type BlockSource = 'manual' | 'auto_brute_force' | 'auto_abuse' | 'auto_fraud' | 'integration';

export interface IpBlock {
  id: string;
  cidr: string;                 // e.g., "1.2.3.0/24" or "2001:db8::/32"
  ip_version: 4 | 6;
  reason: string;
  scope: BlockScope;
  source: BlockSource;
  is_active: number;
  expires_at: string | null;
  hit_count: number;
  last_hit_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IpBlockEvent {
  id: string;
  block_id: string;
  actor_id: string | null;
  event_type: string;
  note: string | null;
  metadata: string | null;
  created_at: string;
}

const VALID_SCOPES: BlockScope[] = ['global', 'api', 'login', 'upload', 'comment'];
const VALID_SOURCES: BlockSource[] = ['manual', 'auto_brute_force', 'auto_abuse', 'auto_fraud', 'integration'];

export function ensureIpBlockingSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ip_blocks (
      id TEXT PRIMARY KEY,
      cidr TEXT NOT NULL,
      ip_version INTEGER NOT NULL CHECK (ip_version IN (4,6)),
      reason TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global'
        CHECK (scope IN ('global','api','login','upload','comment')),
      source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual','auto_brute_force','auto_abuse','auto_fraud','integration')),
      is_active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      hit_count INTEGER NOT NULL DEFAULT 0,
      last_hit_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ipblock_active ON ip_blocks(is_active, expires_at);
    CREATE INDEX IF NOT EXISTS idx_ipblock_cidr ON ip_blocks(cidr);
    CREATE INDEX IF NOT EXISTS idx_ipblock_scope ON ip_blocks(scope, is_active);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ipblock_cidr_scope ON ip_blocks(cidr, scope);

    CREATE TABLE IF NOT EXISTS ip_block_events (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      actor_id TEXT,
      event_type TEXT NOT NULL,
      note TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ipblock_event_block ON ip_block_events(block_id);
    CREATE INDEX IF NOT EXISTS idx_ipblock_event_created ON ip_block_events(created_at);
  `);
}

function rowToBlock(r: any): IpBlock {
  return r as IpBlock;
}

function logEvent(blockId: string, actorId: string | null, eventType: string, note?: string | null, metadata?: Record<string, unknown> | null): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO ip_block_events (id, block_id, actor_id, event_type, note, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), blockId, actorId, eventType, note ?? null,
    metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
}

// ============================================================
// IP / CIDR parsing
// ============================================================

function isIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

function isIPv6(ip: string): boolean {
  // Simplified: allow hex groups with optional ::
  return /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':');
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

function ipv6ToBigInt(ip: string): bigint {
  // Expand :: to full form
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  const full = [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  let n = 0n;
  for (const g of full) n = (n << 16n) + BigInt(parseInt(g || '0', 16));
  return n;
}

export interface ParsedCidr {
  ip_version: 4 | 6;
  network_int: bigint;
  mask_int: bigint;
  prefix: number;
}

export function parseCidr(cidr: string): ParsedCidr {
  const trimmed = cidr.trim();
  const parts = trimmed.split('/');
  if (parts.length !== 2) throw new Error('CIDR must be IP/prefix format');
  const [ip, prefixStr] = parts;
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix)) throw new Error('Invalid prefix');

  if (isIPv4(ip)) {
    if (prefix < 0 || prefix > 32) throw new Error('IPv4 prefix must be 0-32');
    const net = ipv4ToInt(ip);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const networkUnsigned = (net & mask) >>> 0;
    return { ip_version: 4, network_int: BigInt(networkUnsigned), mask_int: BigInt(mask), prefix };
  }
  if (isIPv6(ip)) {
    if (prefix < 0 || prefix > 128) throw new Error('IPv6 prefix must be 0-128');
    const net = ipv6ToBigInt(ip);
    const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
    return { ip_version: 6, network_int: net & mask, mask_int: mask, prefix };
  }
  throw new Error('Not a valid IPv4 or IPv6 address');
}

function ipInCidr(ip: string, cidr: ParsedCidr): boolean {
  try {
    if (cidr.ip_version === 4) {
      if (!isIPv4(ip)) return false;
      const target = BigInt(ipv4ToInt(ip));
      return (target & cidr.mask_int) === cidr.network_int;
    }
    if (cidr.ip_version === 6) {
      if (!isIPv6(ip)) return false;
      const target = ipv6ToBigInt(ip);
      return (target & cidr.mask_int) === cidr.network_int;
    }
  } catch {
    return false;
  }
  return false;
}

// ============================================================
// CRUD
// ============================================================

export interface CreateBlockInput {
  cidr: string;
  reason: string;
  scope?: BlockScope;
  source?: BlockSource;
  expires_at?: string | null;
  created_by?: string | null;
}

export function createBlock(input: CreateBlockInput): IpBlock {
  const parsed = parseCidr(input.cidr);
  const reason = (input.reason || '').trim();
  if (reason.length < 3 || reason.length > 500) throw new Error('reason must be 3-500 chars');

  const scope = input.scope ?? 'global';
  if (!VALID_SCOPES.includes(scope)) throw new Error(`Invalid scope: ${scope}`);
  const source = input.source ?? 'manual';
  if (!VALID_SOURCES.includes(source)) throw new Error(`Invalid source: ${source}`);

  if (input.expires_at && new Date(input.expires_at).getTime() <= Date.now()) {
    throw new Error('expires_at must be in the future');
  }

  const db = getDb();
  const normalizedCidr = normalizeCidr(input.cidr, parsed);
  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ip_blocks
      (id, cidr, ip_version, reason, scope, source, is_active, expires_at,
       hit_count, last_hit_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, 0, NULL, ?, ?, ?)
  `).run(id, normalizedCidr, parsed.ip_version, reason, scope, source,
    input.expires_at ?? null, input.created_by ?? null, now, now);

  logEvent(id, input.created_by ?? null, 'created', `Block created for ${normalizedCidr}`, {
    metadata: { scope, source, expires_at: input.expires_at ?? null },
  });

  return getBlock(id)!;
}

function normalizeCidr(cidr: string, parsed: ParsedCidr): string {
  if (parsed.ip_version === 4) {
    const net = Number(parsed.network_int);
    const a = (net >>> 24) & 0xff;
    const b = (net >>> 16) & 0xff;
    const c = (net >>> 8) & 0xff;
    const d = net & 0xff;
    return `${a}.${b}.${c}.${d}/${parsed.prefix}`;
  }
  // For IPv6, just echo the trimmed input (canonical form is non-trivial)
  return cidr.trim().toLowerCase();
}

export function getBlock(id: string): IpBlock | null {
  const db = getDb();
  const r = db.prepare('SELECT * FROM ip_blocks WHERE id = ?').get(id) as any;
  return r ? rowToBlock(r) : null;
}

export interface ListBlocksOpts {
  scope?: BlockScope;
  source?: BlockSource;
  active_only?: boolean;
  limit?: number;
  offset?: number;
}

export function listBlocks(opts: ListBlocksOpts = {}): { blocks: IpBlock[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: any[] = [];

  if (opts.scope) { where.push('scope = ?'); params.push(opts.scope); }
  if (opts.source) { where.push('source = ?'); params.push(opts.source); }
  if (opts.active_only) where.push('is_active = 1');

  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const total = (db.prepare(`SELECT COUNT(*) as c FROM ip_blocks ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM ip_blocks ${w} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as any[];
  return { blocks: rows.map(rowToBlock), total };
}

export function deactivateBlock(id: string, actorId: string | null, note?: string): boolean {
  const db = getDb();
  const existing = getBlock(id);
  if (!existing) return false;
  if (existing.is_active === 0) return true;

  const now = new Date().toISOString();
  db.prepare('UPDATE ip_blocks SET is_active = 0, updated_at = ? WHERE id = ?').run(now, id);
  logEvent(id, actorId, 'deactivated', note ?? 'Block deactivated');
  return true;
}

export function deleteBlock(id: string): boolean {
  const db = getDb();
  const info = db.prepare('DELETE FROM ip_blocks WHERE id = ?').run(id);
  return info.changes > 0;
}

// ============================================================
// Access check
// ============================================================

export interface CheckResult {
  blocked: boolean;
  matched_block_id: string | null;
  matched_cidr: string | null;
  reason: string | null;
  scope: BlockScope | null;
}

/** Check whether an IP is blocked for a given scope. */
export function checkIp(ip: string, scope: BlockScope = 'global'): CheckResult {
  const db = getDb();
  const now = new Date().toISOString();

  const rows = db.prepare(`
    SELECT * FROM ip_blocks
    WHERE is_active = 1
      AND (scope = 'global' OR scope = ?)
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at ASC
  `).all(scope, now) as IpBlock[];

  for (const b of rows) {
    try {
      const parsed = parseCidr(b.cidr);
      if (ipInCidr(ip, parsed)) {
        // Increment hit
        db.prepare('UPDATE ip_blocks SET hit_count = hit_count + 1, last_hit_at = ? WHERE id = ?')
          .run(now, b.id);
        return {
          blocked: true,
          matched_block_id: b.id,
          matched_cidr: b.cidr,
          reason: b.reason,
          scope: b.scope,
        };
      }
    } catch {
      // skip malformed
    }
  }

  return { blocked: false, matched_block_id: null, matched_cidr: null, reason: null, scope: null };
}

// ============================================================
// Stats & Maintenance
// ============================================================

export interface IpBlockStats {
  total: number;
  active: number;
  expired_pending: number;
  by_scope: Record<string, number>;
  by_source: Record<string, number>;
  top_hits: Array<{ cidr: string; hit_count: number }>;
}

export function getIpBlockStats(): IpBlockStats {
  const db = getDb();
  const now = new Date().toISOString();

  const total = (db.prepare('SELECT COUNT(*) as c FROM ip_blocks').get() as { c: number }).c;
  const active = (db.prepare(
    "SELECT COUNT(*) as c FROM ip_blocks WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > ?)"
  ).get(now) as { c: number }).c;
  const expiredPending = (db.prepare(
    "SELECT COUNT(*) as c FROM ip_blocks WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at <= ?"
  ).get(now) as { c: number }).c;

  const byScope: Record<string, number> = {};
  for (const r of db.prepare(
    "SELECT scope, COUNT(*) as c FROM ip_blocks WHERE is_active = 1 GROUP BY scope"
  ).all() as Array<{ scope: string; c: number }>) byScope[r.scope] = r.c;

  const bySource: Record<string, number> = {};
  for (const r of db.prepare(
    "SELECT source, COUNT(*) as c FROM ip_blocks WHERE is_active = 1 GROUP BY source"
  ).all() as Array<{ source: string; c: number }>) bySource[r.source] = r.c;

  const topHits = db.prepare(`
    SELECT cidr, hit_count FROM ip_blocks
    WHERE is_active = 1 AND hit_count > 0
    ORDER BY hit_count DESC LIMIT 10
  `).all() as Array<{ cidr: string; hit_count: number }>;

  return { total, active, expired_pending: expiredPending, by_scope: byScope, by_source: bySource, top_hits: topHits };
}

export function expireOldBlocks(): { expired: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db.prepare(
    "SELECT id FROM ip_blocks WHERE is_active = 1 AND expires_at IS NOT NULL AND expires_at <= ?"
  ).all(now) as Array<{ id: string }>;

  if (rows.length === 0) return { expired: 0 };
  const stmt = db.prepare("UPDATE ip_blocks SET is_active = 0, updated_at = ? WHERE id = ?");
  for (const r of rows) {
    stmt.run(now, r.id);
    logEvent(r.id, null, 'expired', 'Auto-expired');
  }
  return { expired: rows.length };
}

export function pruneOldBlocks(olderThanDays = 180): { pruned: number } {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const info = db.prepare('DELETE FROM ip_blocks WHERE is_active = 0 AND updated_at < ?').run(cutoff);
  return { pruned: info.changes };
}

export function listEvents(blockId: string): IpBlockEvent[] {
  const db = getDb();
  return db.prepare('SELECT * FROM ip_block_events WHERE block_id = ? ORDER BY created_at ASC')
    .all(blockId) as IpBlockEvent[];
}
