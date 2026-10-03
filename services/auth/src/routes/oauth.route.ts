// melodyflix auth — Social Login routes (Section 1.3)
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '@melodyflix/shared-auth';
import {
  createOAuthState, consumeOAuthState, computeCodeChallenge,
  buildAuthUrl, exchangeCode, fetchUserProfile,
  linkOAuthAccount, unlinkOAuthAccount,
  findByProvider, listLinkedAccounts, countLinkedProviders,
  listConfiguredProviders,
  type OAuthProvider,
} from '../services/oauth.service.js';

const PROVIDERS = ['google', 'github', 'facebook'] as const;

function currentUserId(req: any): string | null {
  // Optional auth — may be null on public callback path
  return req.user?.id ?? req.user?.sub ?? null;
}

export async function oauthRoutes(app: FastifyInstance) {
  // ---- Discovery ----

  // GET /oauth/providers — which providers are configured
  app.get('/oauth/providers', async (_req, reply) => {
    return reply.send({
      success: true,
      data: { providers: listConfiguredProviders() },
    });
  });

  // ---- Start flow ----

  const StartSchema = z.object({
    redirect_uri: z.string().url().max(500),
    use_pkce: z.boolean().optional(),
  });

  // POST /oauth/:provider/start — returns auth URL + state
  app.post('/oauth/:provider/start', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!PROVIDERS.includes(provider as OAuthProvider)) {
      return reply.code(400).send({ success: false, error: 'Unsupported provider' });
    }
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }
    const p = provider as OAuthProvider;
    const usePkce = parsed.data.use_pkce !== false;

    try {
      const st = createOAuthState(p, { usePkce, redirect_uri: parsed.data.redirect_uri });
      const challenge = st.code_verifier ? computeCodeChallenge(st.code_verifier) : null;
      const authUrl = buildAuthUrl(p, st.state, parsed.data.redirect_uri, challenge);
      return reply.send({
        success: true,
        data: {
          provider: p,
          auth_url: authUrl,
          state: st.state,
          code_verifier: st.code_verifier,
          expires_at: st.expires_at,
        },
      });
    } catch (e: any) {
      return reply.code(500).send({ success: false, error: e?.message ?? 'Start failed' });
    }
  });

  // ---- Callback ----

  const CallbackSchema = z.object({
    code: z.string().min(1).max(2000),
    state: z.string().min(1).max(200),
    redirect_uri: z.string().url().max(500),
    code_verifier: z.string().max(500).optional(),
  });

  // POST /oauth/:provider/callback — exchange code, link or return login info
  //   - If request is authenticated → links the account and returns linked
  //   - If not authenticated → checks for existing link (login) or returns
  //     signup-required with the fetched profile
  app.post('/oauth/:provider/callback', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    if (!PROVIDERS.includes(provider as OAuthProvider)) {
      return reply.code(400).send({ success: false, error: 'Unsupported provider' });
    }
    const p = provider as OAuthProvider;
    const parsed = CallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid body', issues: parsed.error.issues });
    }

    // 1) Consume CSRF state (single use)
    const stateRow = consumeOAuthState(parsed.data.state);
    if (!stateRow) {
      return reply.code(400).send({ success: false, error: 'Invalid or expired state' });
    }
    if (stateRow.provider !== p) {
      return reply.code(400).send({ success: false, error: 'Provider mismatch' });
    }

    // 2) Exchange + fetch profile
    let profile;
    try {
      const { access_token } = await exchangeCode(p, parsed.data.code, parsed.data.redirect_uri, parsed.data.code_verifier);
      profile = await fetchUserProfile(p, access_token);
    } catch (e: any) {
      return reply.code(400).send({ success: false, error: e?.message ?? 'OAuth exchange failed' });
    }

    const me = currentUserId(req as any);

    // 3a) Authenticated: link this provider to the current account
    if (me) {
      try {
        const existing = listLinkedAccounts(me).find((a) => a.provider === p);
        if (existing) {
          return reply.code(409).send({
            success: false,
            error: `${p} already linked to your account`,
          });
        }
        const linked = linkOAuthAccount({ user_id: me, provider: p, profile });
        return reply.send({
          success: true,
          data: { mode: 'linked', account: linked, profile },
        });
      } catch (e: any) {
        return reply.code(400).send({ success: false, error: e?.message ?? 'Link failed' });
      }
    }

    // 3b) Anonymous: check existing link
    const existing = findByProvider(p, profile.provider_user_id);
    if (existing) {
      return reply.send({
        success: true,
        data: {
          mode: 'login',
          user_id: existing.user_id,
          account_id: existing.id,
          profile,
        },
      });
    }

    // 3c) Anonymous + no link → signup required
    return reply.send({
      success: true,
      data: {
        mode: 'signup_required',
        provider: p,
        profile,
        suggested_email: profile.email,
      },
    });
  });

  // ---- Linked account management ----

  // GET /oauth/linked — list my linked social accounts
  app.get('/oauth/linked', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = currentUserId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const accounts = listLinkedAccounts(me);
    return reply.send({
      success: true,
      data: {
        accounts,
        count: accounts.length,
        // Prevent unlinking last method when there is no password — UI hint
        can_unlink_all: countLinkedProviders(me) > 1,
      },
    });
  });

  // GET /oauth/:provider/status — whether provider is linked
  app.get('/oauth/:provider/status', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = currentUserId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { provider } = req.params as { provider: string };
    if (!PROVIDERS.includes(provider as OAuthProvider)) {
      return reply.code(400).send({ success: false, error: 'Unsupported provider' });
    }
    const linked = listLinkedAccounts(me).find((a) => a.provider === provider);
    return reply.send({ success: true, data: { linked: !!linked, account: linked ?? null } });
  });

  // DELETE /oauth/:provider — unlink
  app.delete('/oauth/:provider', { preHandler: [requireAuth] }, async (req, reply) => {
    const me = currentUserId(req as any);
    if (!me) return reply.code(401).send({ success: false, error: 'Unauthorized' });
    const { provider } = req.params as { provider: string };
    if (!PROVIDERS.includes(provider as OAuthProvider)) {
      return reply.code(400).send({ success: false, error: 'Unsupported provider' });
    }
    // Guard: cannot leave account with zero auth methods if we can't confirm
    // a password — bail out only when it's the only method AND caller
    // passes force=false (default)
    const q = req.query as { force?: string };
    const force = q.force === 'true';
    if (!force && countLinkedProviders(me) === 1) {
      return reply.code(409).send({
        success: false,
        error: 'This is your only sign-in method. Set a password or link another provider first (or pass ?force=true).',
      });
    }
    const removed = unlinkOAuthAccount(me, provider as OAuthProvider);
    return reply.send({ success: true, data: { removed } });
  });
}
