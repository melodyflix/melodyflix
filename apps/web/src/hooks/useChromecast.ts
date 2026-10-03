// melodyflix web — Chromecast / Google Cast (Section 4.7)
import { useCallback, useEffect, useState } from 'react';

export interface UseChromecastResult {
  supported: boolean;
  available: boolean;
  connected: boolean;
  loading: boolean;
  error: string | null;
  cast: (media: { contentId: string; contentType?: string; title?: string; poster?: string }) => Promise<void>;
  disconnect: () => void;
}

declare global {
  interface Window {
    cast?: any;
    chrome?: any;
    __onGCastApiAvailable?: (ok: boolean) => void;
  }
}

const CAST_SCRIPT = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const RECEIVER_APP_ID = 'CC1AD845';

export function useChromecast(): UseChromecastResult {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = typeof navigator !== 'undefined' &&
    /chrome|chromium|edg/i.test(navigator.userAgent) &&
    !/mobile/i.test(navigator.userAgent);

  useEffect(() => {
    if (!supported) return;
    if (window.cast?.framework) { init(); return; }
    (window as any).__onGCastApiAvailable = (ok: boolean) => { if (ok) init(); };
    const s = document.createElement('script');
    s.src = CAST_SCRIPT;
    s.async = true;
    s.onerror = () => setError('Failed to load Cast SDK');
    document.head.appendChild(s);
    // eslint-disable-next-line
  }, [supported]);

  function init() {
    try {
      const cast = window.cast;
      const chrome = window.chrome;
      if (!cast?.framework || !chrome?.cast?.media) return;
      const ctx = cast.framework.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId: RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      setAvailable(true);
      ctx.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        () => setConnected(!!ctx.getCurrentSession())
      );
    } catch (e: any) {
      setError(e?.message ?? 'Cast init failed');
    }
  }

  const cast = useCallback(async (media: {
    contentId: string; contentType?: string; title?: string; poster?: string;
  }) => {
    try {
      setLoading(true); setError(null);
      const cast = window.cast; const chrome = window.chrome;
      if (!cast?.framework || !chrome?.cast?.media) throw new Error('Chromecast not available');
      const ctx = cast.framework.CastContext.getInstance();
      let session = ctx.getCurrentSession();
      if (!session) { await ctx.requestSession(); session = ctx.getCurrentSession(); }
      if (!session) throw new Error('No cast session');
      const mediaInfo = new chrome.cast.media.MediaInfo(media.contentId, media.contentType ?? 'application/x-mpegurl');
      if (media.title) {
        mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
        mediaInfo.metadata.title = media.title;
        if (media.poster) mediaInfo.metadata.images = [{ url: media.poster }];
      }
      await session.loadMedia(new chrome.cast.media.LoadRequest(mediaInfo));
      setConnected(true);
    } catch (e: any) {
      setError(e?.message ?? 'Cast failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    try {
      const ctx = window.cast?.framework?.CastContext?.getInstance?.();
      ctx?.getCurrentSession?.()?.endSession?.(true);
      setConnected(false);
    } catch { /* ignore */ }
  }, []);

  return { supported, available, connected, loading, error, cast, disconnect };
}
