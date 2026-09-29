// melodyflix live - client to check chat limits on videos service
import { createLogger } from '@melodyflix/shared-logger';

const logger = createLogger('chatlimits-client');
const VIDEOS_URL = process.env.VIDEOS_SERVICE_URL ?? 'http://127.0.0.1:4003';

export interface ConsumeResult {
  ok: boolean;
  consumed?: 'free' | 'paid';
  usage?: {
    free_used: number;
    free_remaining: number;
    free_limit: number;
    paid_balance: number;
    can_send: boolean;
    requires_payment: boolean;
    pack_price: number;
    pack_size: number;
  };
  error?: string;
}

export async function consumeMessageCredit(token: string): Promise<ConsumeResult> {
  try {
    const res = await fetch(`${VIDEOS_URL}/api/v1/videos/chat-limits/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: '{}',
    });

    const data = await res.json();

    if (res.status === 402) {
      return { ok: false, error: 'MESSAGE_LIMIT_REACHED', usage: data?.data?.usage };
    }
    if (!res.ok || !data.success) {
      return { ok: false, error: data?.error ?? 'Limit check failed' };
    }
    return { ok: true, consumed: data.data.consumed, usage: data.data.usage };
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'consume credit failed');
    return { ok: false, error: 'Chat service unreachable' };
  }
}

export async function getChatUsage(token: string): Promise<ConsumeResult['usage'] | null> {
  try {
    const res = await fetch(`${VIDEOS_URL}/api/v1/videos/chat-limits/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data ?? null;
  } catch {
    return null;
  }
}
