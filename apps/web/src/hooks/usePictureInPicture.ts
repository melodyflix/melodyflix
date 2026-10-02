// melodyflix web — Picture-in-Picture hook (40.10)
// Wraps the native Document Picture-in-Picture API (video element).
// Reusable across players: pass a ref to any <video> element.

import { useCallback, useEffect, useState } from 'react';

export interface UsePipResult {
  /** Whether the current browser supports video PiP. */
  supported: boolean;
  /** True while our video element is currently in PiP mode. */
  active: boolean;
  /** True if we're using the newer Document PiP (window) API. */
  documentPip: boolean;
  /** Request PiP for the referenced video element. Throws if unsupported. */
  enter: () => Promise<void>;
  /** Exit PiP if active. Safe no-op otherwise. */
  exit: () => Promise<void>;
  /** Toggle PiP state. */
  toggle: () => Promise<void>;
  /** Last error (if any). */
  error: string | null;
}

export function usePictureInPicture(
  videoRef: React.RefObject<HTMLVideoElement | null>
): UsePipResult {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported =
    typeof document !== 'undefined' &&
    typeof window !== 'undefined' &&
    'pictureInPictureEnabled' in document &&
    (document as any).pictureInPictureEnabled === true;

  const documentPip =
    typeof window !== 'undefined' &&
    'documentPictureInPicture' in window;

  // Track enter/leave events fired by the browser's PiP UI
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);

    v.addEventListener('enterpictureinpicture', onEnter);
    v.addEventListener('leavepictureinpicture', onLeave);

    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter);
      v.removeEventListener('leavepictureinpicture', onLeave);
    };
  });

  const enter = useCallback(async () => {
    setError(null);
    const v = videoRef.current;
    if (!v) {
      setError('No video element');
      return;
    }
    if (!supported) {
      setError('Picture-in-Picture not supported in this browser');
      return;
    }
    try {
      // Some browsers require the video to have metadata loaded.
      if (v.readyState < 1) {
        await new Promise<void>((resolve) => {
          const once = () => { v.removeEventListener('loadedmetadata', once); resolve(); };
          v.addEventListener('loadedmetadata', once);
          // Safety timeout — don't hang forever
          setTimeout(resolve, 1500);
        });
      }
      await (v as any).requestPictureInPicture();
      setActive(true);
    } catch (e: any) {
      const msg = e?.message ?? 'PiP failed';
      setError(msg);
      // eslint-disable-next-line no-console
      console.warn('[PiP] enter failed:', msg);
    }
  }, [videoRef, supported]);

  const exit = useCallback(async () => {
    try {
      if (typeof document !== 'undefined' && (document as any).pictureInPictureElement) {
        await (document as any).exitPictureInPicture();
      }
      setActive(false);
    } catch (e: any) {
      setError(e?.message ?? 'Exit PiP failed');
    }
  }, []);

  const toggle = useCallback(async () => {
    if (active) await exit();
    else await enter();
  }, [active, enter, exit]);

  return { supported, active, documentPip, enter, exit, toggle, error };
}
