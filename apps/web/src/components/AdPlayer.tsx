// melodyflix - Ad Player using Google IMA SDK + VAST fallback
import { useEffect, useRef, useState } from 'react';

interface Props {
  /** VAST tag URL from external ad network (Adsterra, Monetag, etc.) */
  vastTagUrl?: string;
  /** Fallback: internal ad video URL */
  fallbackVideoUrl?: string;
  fallbackClickUrl?: string;
  /** Seconds before Skip button appears */
  skipAfter?: number;
  /** Called when ad finishes or is skipped */
  onComplete: () => void;
  /** Called on ad error — skip to content */
  onError?: () => void;
}

/**
 * Strategy:
 * 1. Try Google IMA SDK (for AdSense/Ad Manager)
 * 2. Fallback to rmp-vast (for other VAST networks)
 * 3. Fallback to internal video ad
 * 4. Fallback to no ad
 */
export default function AdPlayer({
  vastTagUrl,
  fallbackVideoUrl,
  fallbackClickUrl,
  skipAfter = 5,
  onComplete,
  onError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const adDisplayRef = useRef<HTMLDivElement>(null);
  const [countdown, setCountdown] = useState(skipAfter);
  const [canSkip, setCanSkip] = useState(false);
  const [mode, setMode] = useState<'loading' | 'ima' | 'vast' | 'internal' | 'error'>('loading');
  const [error, setError] = useState('');

  // Countdown timer
  useEffect(() => {
    if (canSkip) return;
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          setCanSkip(true);
          clearInterval(t);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [canSkip]);

  // Strategy 1: Google IMA SDK
  useEffect(() => {
    if (!vastTagUrl) {
      // No external tag → try internal
      if (fallbackVideoUrl) setMode('internal');
      else handleComplete();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Load IMA SDK dynamically
        await loadScript('https://imasdk.googleapis.com/js/sdkloader/ima3.js');
        // @ts-ignore
        if (!window.google?.ima) throw new Error('IMA not available');

        // @ts-ignore
        const ima = window.google.ima;
        const adDisplayContainer = new ima.AdDisplayContainer(adDisplayRef.current, videoRef.current);
        const adsLoader = new ima.AdsLoader(adDisplayContainer);

        adsLoader.addEventListener(
          ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
          // @ts-ignore
          (e: any) => {
            if (cancelled) return;
            const adsManager = e.getAdsManager(videoRef.current);
            adsManager.addEventListener(ima.AdEvent.Type.SKIPPED, handleComplete);
            adsManager.addEventListener(ima.AdEvent.Type.COMPLETE, handleComplete);
            adsManager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, handleComplete);
            adsManager.addEventListener(ima.AdErrorEvent.Type.AD_ERROR, (err: any) => {
              setError(err?.getError?.()?.toString?.() ?? 'Ad error');
              if (fallbackVideoUrl) setMode('internal');
              else handleError();
            });
            try {
              adsManager.init(
                containerRef.current!.clientWidth,
                containerRef.current!.clientHeight,
                ima.ViewMode.NORMAL
              );
              adsManager.start();
              setMode('ima');
            } catch (initErr) {
              if (fallbackVideoUrl) setMode('internal');
              else handleError();
            }
          }
        );

        const adsRequest = new ima.AdsRequest();
        adsRequest.adTagUrl = vastTagUrl;
        adsRequest.linearAdSlotWidth = containerRef.current?.clientWidth ?? 640;
        adsRequest.linearAdSlotHeight = 360;
        adsLoader.requestAds(adsRequest);
      } catch (err) {
        if (fallbackVideoUrl) setMode('internal');
        else handleError();
      }
    })();

    return () => { cancelled = true; };
  }, [vastTagUrl]);

  // Strategy 2: rmp-vast for VAST networks (fallback)
  useEffect(() => {
    if (mode !== 'vast' || !vastTagUrl) return;
    let rmpVast: any = null;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@pavloniym/rmp-vast');
        const RmpVast = mod.default || mod;
        // This requires specific HTML structure — simplified usage
        // (Real integration needs rmp-container class)
        if (fallbackVideoUrl) setMode('internal');
      } catch {
        if (fallbackVideoUrl) setMode('internal');
      }
    })();
    return () => { cancelled = true; };
  }, [mode, vastTagUrl, fallbackVideoUrl]);

  // Strategy 3: Internal video ad
  useEffect(() => {
    if (mode !== 'internal') return;
    const v = videoRef.current;
    if (!v) return;
    v.src = fallbackVideoUrl!;
    v.play().catch(() => handleComplete());
    const onEnd = () => handleComplete();
    v.addEventListener('ended', onEnd);
    return () => v.removeEventListener('ended', onEnd);
  }, [mode, fallbackVideoUrl]);

  function handleComplete() {
    onComplete();
  }

  function handleError() {
    onError?.();
    onComplete();
  }

  function handleSkip() {
    // If IMA is running, skip will be handled by the SDK
    if (mode === 'internal') {
      videoRef.current?.pause();
    }
    handleComplete();
  }

  function handleClick() {
    if (fallbackClickUrl) {
      window.open(fallbackClickUrl, '_blank');
    }
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#000',
        overflow: 'hidden',
      }}
    >
      {/* Ad display container for IMA */}
      <div ref={adDisplayRef} style={{ width: '100%', height: '100%' }} />

      {/* Video element for IMA + internal ads */}
      <video
        ref={videoRef}
        playsInline
        muted={false}
        onClick={handleClick}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          cursor: fallbackClickUrl ? 'pointer' : 'default',
        }}
      />

      {/* Ad badge */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          background: '#dba617',
          color: '#000',
          padding: '3px 8px',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 700,
          zIndex: 10,
        }}
      >
        AD
      </div>

      {/* Skip button */}
      {canSkip && (
        <button
          onClick={handleSkip}
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.5)',
            padding: '10px 18px',
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            zIndex: 10,
            fontFamily: 'inherit',
          }}
        >
          Skip Ad ▶▶
        </button>
      )}

      {!canSkip && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 600,
            zIndex: 10,
          }}
        >
          Skip in {countdown}s
        </div>
      )}

      {error && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: '#dc2626',
            color: '#fff',
            padding: '4px 10px',
            borderRadius: 4,
            fontSize: 11,
            zIndex: 10,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Script load failed'));
    document.head.appendChild(s);
  });
}
