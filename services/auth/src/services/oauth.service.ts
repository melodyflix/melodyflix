// melodyflix auth — Social Login / OAuth (Section 1.3)
// Supports Google, GitHub, Facebook. State (CSRF) protection,
// PKCE ready, account linking, unlink.

import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

export type OAuthProvider = 'google' | 'github' | 'facebook';

export interface OAuthAccount {
  id: string;
  user_id: string;
  provider: OAuthProvider;
  provider_user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  linked_at: string;
}

export interface OAuthState {
  id: string;
  provider: OAuthProvider;
  state: string;
  code_verifier: string | null;
  redirect_uri: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export function ensureOAuthSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('google','github','facebook')),
      provider_user_id TEXT NOT NULL,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      linked_at TEXT NOT NULL,
      UNIQUE (provider, provider_user_id),
      UNIQUE (user_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_accounts(provider, provider_user_id);

    CREATE TABLE IF NOT EXISTS oauth_states (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('google','github','facebook')),
      state TEXT NOT NULL UNIQUE,
      code_verifier TEXT,
      redirect_uri TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);
    CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
  `);
}

// ---------- State (CSRF) ----------

const STATE_TTL_SECONDS = 600; // 10 min

export interface CreatedState {
  state: string;
  code_verifier: string | null;
  expires_at: string;
}

export function createOAuthState(
  provider: OAuthProvider,
  opts: { usePkce?: boolean; redirect_uri?: string } = {}
): CreatedState {
  const db = getDb();
  const now = new Date();
  const expires = new Date(now.getTime() + STATE_TTL_SECONDS * 1000);

  const state = randomBytes(24).toString('base64url');
  let code_verifier: string | null = null;
  if (opts.usePkce) {
    code_verifier = randomBytes(32).toString('base64url');
  }

  db.prepare(`
    INSERT INTO oauth_states (id, provider, state, code_verifier, redirect_uri,
      created_at, expires_at, used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `).run(
    randomUUID(), provider, state, code_verifier,
    opts.redirect_uri ?? null, now.toISOString(), expires.toISOString()
  );

  return { state, code_verifier, expires_at: expires.toISOString() };
}

export function consumeOAuthState(state: string): OAuthState | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM oauth_states WHERE state = ?')
    .get(state) as OAuthState | undefined;
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  db.prepare('UPDATE oauth_states SET used_at = ? WHERE id = ?')
    .run(new Date().toISOString(), row.id);
  return { ...row, used_at: new Date().toISOString() };
}

export function cleanupExpiredStates(): number {
  const cutoff = new Date(Date.now() - STATE_TTL_SECONDS * 1000).toISOString();
  const r = getDb().prepare('DELETE FROM oauth_states WHERE expires_at < ?').run(cutoff);
  return r.changes;
}

// PKCE: SHA-256(verifier) base64url
export function computeCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

// ---------- Provider info (URL builders; real config via env) ----------

export interface ProviderConfig {
  client_id: string;
  client_secret: string;
  auth_url: string;
  token_url: string;
  userinfo_url: string;
  scope: string;
}

export function isOAuthFetchEnabled(): boolean {
  return process.env.MELODYFLIX_OAUTH_MOCK !== '1';
}

export function getProviderConfig(provider: OAuthProvider): ProviderConfig {
  switch (provider) {
    case 'google':
      return {
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        auth_url: 'https://accounts.google.com/o/oauth2/v2/auth',
        token_url: 'https://oauth2.googleapis.com/token',
        userinfo_url: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: 'openid email profile',
      };
    case 'github':
      return {
        client_id: process.env.GITHUB_CLIENT_ID ?? '',
        client_secret: process.env.GITHUB_CLIENT_SECRET ?? '',
        auth_url: 'https://github.com/login/oauth/authorize',
        token_url: 'https://github.com/login/oauth/access_token',
        userinfo_url: 'https://api.github.com/user',
        scope: 'read:user user:email',
      };
    case 'facebook':
      return {
        client_id: process.env.FACEBOOK_CLIENT_ID ?? '',
        client_secret: process.env.FACEBOOK_CLIENT_SECRET ?? '',
        auth_url: 'https://www.facebook.com/v19.0/dialog/oauth',
        token_url: 'https://graph.facebook.com/v19.0/oauth/access_token',
        userinfo_url: 'https://graph.facebook.com/me?fields=id,name,email,picture',
        scope: 'email public_profile',
      };
  }
}

export function buildAuthUrl(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
  codeChallenge?: string | null
): string {
  const cfg = getProviderConfig(provider);
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state,
  });
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  return `${cfg.auth_url}?${params.toString()}`;
}

// ---------- Token exchange + userinfo ----------

export interface OAuthProfile {
  provider_user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
  codeVerifier?: string | null
): Promise<{ access_token: string }> {
  if (!isOAuthFetchEnabled()) {
    // Mock mode (tests) — deterministic token
    return { access_token: `mock-token-${provider}-${code}` };
  }

  const cfg = getProviderConfig(provider);
  const body = new URLSearchParams({
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);

  const res = await fetch(cfg.token_url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  const json = await res.json() as any;
  if (!json.access_token) throw new Error('No access_token in response');
  return { access_token: json.access_token };
}

export async function fetchUserProfile(
  provider: OAuthProvider,
  accessToken: string
): Promise<OAuthProfile> {
  if (!isOAuthFetchEnabled()) {
    // Mock profile — encode provider in id for test determinism
    const suffix = accessToken.slice(-6);
    return {
      provider_user_id: `mock-${provider}-${suffix}`,
      email: `mock-${suffix}@example.com`,
      display_name: `Mock ${provider} user`,
      avatar_url: `https://mock.example.com/${suffix}.jpg`,
    };
  }

  const cfg = getProviderConfig(provider);
  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
  };
  const res = await fetch(cfg.userinfo_url, { headers });
  if (!res.ok) throw new Error(`Userinfo failed (${res.status})`);
  const json = await res.json() as any;

  // Normalize per provider
  if (provider === 'github') {
    // GitHub may not return email in /user; that's fine
    return {
      provider_user_id: String(json.id),
      email: typeof json.email === 'string' ? json.email : null,
      display_name: typeof json.name === 'string' ? json.name : (json.login ?? null),
      avatar_url: typeof json.avatar_url === 'string' ? json.avatar_url : null,
    };
  }
  if (provider === 'facebook') {
    return {
      provider_user_id: String(json.id),
      email: typeof json.email === 'string' ? json.email : null,
      display_name: typeof json.name === 'string' ? json.name : null,
      avatar_url: json.picture?.data?.url ?? null,
    };
  }
  // google
  return {
    provider_user_id: String(json.sub ?? json.id),
    email: typeof json.email === 'string' ? json.email : null,
    display_name: typeof json.name === 'string' ? json.name : null,
    avatar_url: typeof json.picture === 'string' ? json.picture : null,
  };
}

// ---------- Linking ----------

export function findByProvider(provider: OAuthProvider, providerUserId: string): OAuthAccount | null {
  const row = getDb().prepare(
    'SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?'
  ).get(provider, providerUserId) as OAuthAccount | undefined;
  return row ?? null;
}

export function listLinkedAccounts(userId: string): OAuthAccount[] {
  return getDb().prepare(
    'SELECT * FROM oauth_accounts WHERE user_id = ? ORDER BY linked_at DESC'
  ).all(userId) as OAuthAccount[];
}

export function getLinkedAccount(userId: string, provider: OAuthProvider): OAuthAccount | null {
  const row = getDb().prepare(
    'SELECT * FROM oauth_accounts WHERE user_id = ? AND provider = ?'
  ).get(userId, provider) as OAuthAccount | undefined;
  return row ?? null;
}

export interface LinkOAuthInput {
  user_id: string;
  provider: OAuthProvider;
  profile: OAuthProfile;
}

export function linkOAuthAccount(input: LinkOAuthInput): OAuthAccount {
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO oauth_accounts
        (id, user_id, provider, provider_user_id, email, display_name, avatar_url, linked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.user_id, input.provider, input.profile.provider_user_id,
      input.profile.email, input.profile.display_name, input.profile.avatar_url, now
    );
  } catch (e: any) {
    const msg = String(e?.message ?? '');
    // SQLite phrases UNIQUE errors as:
    //   "UNIQUE constraint failed: <table>.<col>, <table>.<col>"
    // Check for both column names loosely.
    if (msg.includes('UNIQUE constraint failed')) {
      const hasProviderUnique = msg.includes('provider_user_id');
      const hasUserProviderUnique = msg.includes('user_id') && msg.includes('provider') && !hasProviderUnique;
      if (hasProviderUnique) {
        throw new Error('This social account is already linked to another user');
      }
      if (hasUserProviderUnique) {
        throw new Error(`A ${input.provider} account is already linked to you`);
      }
    }
    throw e;
  }
  return db.prepare('SELECT * FROM oauth_accounts WHERE id = ?').get(id) as OAuthAccount;
}

export function unlinkOAuthAccount(userId: string, provider: OAuthProvider): boolean {
  const r = getDb().prepare(
    'DELETE FROM oauth_accounts WHERE user_id = ? AND provider = ?'
  ).run(userId, provider);
  return r.changes > 0;
}

export function countLinkedProviders(userId: string): number {
  const r = getDb().prepare(
    'SELECT COUNT(*) as n FROM oauth_accounts WHERE user_id = ?'
  ).get(userId) as { n: number };
  return r.n;
}

// List of providers the server is configured for
export function listConfiguredProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (process.env.GOOGLE_CLIENT_ID) providers.push('google');
  if (process.env.GITHUB_CLIENT_ID) providers.push('github');
  if (process.env.FACEBOOK_CLIENT_ID) providers.push('facebook');
  // In mock mode always expose all
  if (process.env.MELODYFLIX_OAUTH_MOCK === '1') return ['google', 'github', 'facebook'];
  return providers;
}
