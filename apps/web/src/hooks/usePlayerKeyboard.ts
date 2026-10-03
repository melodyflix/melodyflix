// melodyflix web — Frame-by-frame + extended keyboard shortcuts (Section 4.11)
import { useEffect } from 'react';

export interface UsePlayerKeyboardOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef?: React.RefObject<HTMLElement | null>;
  fps?: number;
  enabled?: boolean;
}

export function usePlayerKeyboard({
  videoRef,
  containerRef,
  fps = 30,
  enabled = true,
}: UsePlayerKeyboardOptions) {
  useEffect(() => {
    if (!enabled) return;
    const frameDelta = 1 / Math.max(1, fps);

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
      const v = videoRef.current;
      if (!v) return;

      switch (e.key) {
        case ',':
          e.preventDefault(); v.pause();
          v.currentTime = Math.max(0, v.currentTime - frameDelta);
          break;
        case '.':
          e.preventDefault(); v.pause();
          v.currentTime = Math.min(v.duration || v.currentTime, v.currentTime + frameDelta);
          break;
        case 'm':
          e.preventDefault(); v.muted = !v.muted;
          break;
        case 'f':
          e.preventDefault();
          {
            const el = containerRef?.current ?? v;
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            else (el as HTMLElement).requestFullscreen?.().catch(() => {});
          }
          break;
        case 'k':
        case ' ':
          e.preventDefault();
          if (v.paused) v.play().catch(() => {});
          else v.pause();
          break;
        case 'j':
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 10);
          break;
        case 'l':
          e.preventDefault();
          v.currentTime = Math.min(v.duration || v.currentTime, v.currentTime + 10);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          v.currentTime = Math.min(v.duration || v.currentTime, v.currentTime + 5);
          break;
        default:
          if (/^[0-9]$/.test(e.key) && v.duration) {
            e.preventDefault();
            v.currentTime = (parseInt(e.key) / 10) * v.duration;
          }
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [videoRef, containerRef, fps, enabled]);
}
