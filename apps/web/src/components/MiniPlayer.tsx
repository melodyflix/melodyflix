import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePlayer } from './PlayerContext';

type Size = 'small' | 'medium' | 'large';

const SIZES: Record<Size, { w: number; h: number }> = {
  small:  { w: 220, h: 124 },
  medium: { w: 320, h: 180 },
  large:  { w: 480, h: 270 },
};

const SIZE_LABEL: Record<Size, string> = { small: 'S', medium: 'M', large: 'L' };

// Helper: stop all event propagation
function stopAll(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export default function MiniPlayer() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mini, clearMini } = usePlayer();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [playing, setPlaying] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState<Size>('medium');
  const dragRef = useRef({ startX: 0, startY: 0, origX: 0, origY: 0 });

  const shouldHide = location.pathname === `/watch/${mini?.video.id}`;

  useEffect(() => {
    if (!mini || shouldHide) return;
    const video = videoRef.current;
    if (!video) return;

    let hls: any = null;
    let cancelled = false;

    (async () => {
      const src = mini.video.hls_master_url ?? `/api/v1/videos/${mini.video.id}/stream/master.m3u8`;

      if (video.canPlayType('application/vnd.apple.mpegurl') && !('MediaSource' in window)) {
        video.src = src;
      } else {
        const mod = await import('hls.js');
        const Hls = mod.default;
        if (!Hls.isSupported()) return;
        hls = new Hls({ enableWorker: true });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);
      }

      const onLoaded = () => {
        if (cancelled) return;
        video.currentTime = mini.currentTime;
        if (mini.wasPlaying) {
          video.play().catch(() => {});
          setPlaying(true);
        } else {
          setPlaying(false);
        }
      };
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
    })();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      hlsRef.current = null;
    };
  }, [mini?.video.id, shouldHide]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }

  function openFull() {
    if (!mini) return;
    const t = videoRef.current?.currentTime ?? 0;
    const wasPlaying = !videoRef.current?.paused;
    navigate(`/watch/${mini.video.id}`);
    sessionStorage.setItem(`mf_resume_${mini.video.id}`, JSON.stringify({ t, wasPlaying }));
    clearMini();
  }

  function handleClose() {
    // Pause and unload video first
    try {
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    } catch {}
    // Destroy hls if any
    try { hlsRef.current?.destroy?.(); hlsRef.current = null; } catch {}
    // Clear mini state
    clearMini();
  }

  function startDrag(e: React.MouseEvent | React.TouchEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('[data-nodrag]')) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      origX: position.x,
      origY: position.y,
    };
    setDragging(true);
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent | TouchEvent) {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const dx = clientX - dragRef.current.startX;
      const dy = clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    }
    function onUp() { setDragging(false); }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
  }, [dragging]);

  if (!mini || shouldHide) return null;

  const { w: W, h: H } = SIZES[size];
  const isSmall = size === 'small';

  return (
    <div
      style={{
        position: 'fixed',
        right: 20 - position.x,
        bottom: 20 - position.y,
        width: W,
        height: H,
        background: '#000',
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        zIndex: 900,
        cursor: dragging ? 'grabbing' : 'grab',
        transition: dragging ? 'none' : 'width 0.2s, height 0.2s',
      }}
      onMouseDown={startDrag}
      onTouchStart={startDrag}
    >
      <video
        ref={videoRef}
        controls={false}
        playsInline
        muted={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
        }}
      />

      {/* Top bar: title + close */}
      <div
        data-nodrag
        onMouseDown={stopAll}
        onTouchStart={stopAll}
        onPointerDown={stopAll}
        onClick={stopAll}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          padding: '6px 8px',
          background: 'linear-gradient(rgba(0,0,0,0.75), transparent)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#fff',
          fontSize: isSmall ? 10 : 12,
          fontWeight: 500,
          zIndex: 3,
        }}
      >
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginRight: 6,
          }}
        >
          {mini.video.title}
        </div>
        <button
          type="button"
          data-nodrag
          onMouseDown={stopAll}
          onTouchStart={stopAll}
          onPointerDown={stopAll}
          onClick={(e) => { stopAll(e); handleClose(); }}
          onPointerUp={(e) => { stopAll(e); handleClose(); }}
          style={{
            background: 'rgba(0,0,0,0.55)',
            border: 'none',
            color: '#fff',
            width: isSmall ? 28 : 32,
            height: isSmall ? 28 : 32,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: isSmall ? 12 : 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            flexShrink: 0,
          }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Center play button (video area) */}
      <div
        onClick={(e) => { stopAll(e); togglePlay(); }}
        onMouseDown={stopAll}
        onTouchStart={stopAll}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1,
        }}
      >
        {!playing && (
          <div
            style={{
              width: isSmall ? 36 : 50,
              height: isSmall ? 36 : 50,
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isSmall ? 16 : 22,
            }}
          >
            ▶
          </div>
        )}
      </div>

      {/* Bottom bar: play + size + expand */}
      <div
        data-nodrag
        onMouseDown={stopAll}
        onTouchStart={stopAll}
        onPointerDown={stopAll}
        onClick={stopAll}
        style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0,
          padding: '6px 8px',
          background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 4,
          zIndex: 3,
        }}
      >
        <button
          type="button"
          data-nodrag
          onMouseDown={stopAll}
          onTouchStart={stopAll}
          onPointerDown={stopAll}
          onClick={(e) => { stopAll(e); togglePlay(); }}
          style={{
            background: 'rgba(0,0,0,0.55)',
            border: 'none',
            color: '#fff',
            width: isSmall ? 26 : 32,
            height: isSmall ? 26 : 32,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: isSmall ? 12 : 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            flexShrink: 0,
          }}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>

        {/* Size selector: S / M / L */}
        <div style={{ display: 'flex', gap: 3 }}>
          {(['small', 'medium', 'large'] as Size[]).map((s) => (
            <button
              key={s}
              type="button"
              data-nodrag
              onMouseDown={stopAll}
              onTouchStart={stopAll}
              onPointerDown={stopAll}
              onClick={(e) => { stopAll(e); setSize(s); }}
              style={{
                background: size === s ? '#065fd4' : 'rgba(0,0,0,0.55)',
                border: 'none',
                color: '#fff',
                width: isSmall ? 24 : 28,
                height: isSmall ? 24 : 28,
                borderRadius: 5,
                cursor: 'pointer',
                fontSize: isSmall ? 10 : 11,
                fontWeight: 700,
                fontFamily: 'inherit',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title={s}
            >
              {SIZE_LABEL[s]}
            </button>
          ))}
        </div>

        <button
          type="button"
          data-nodrag
          onMouseDown={stopAll}
          onTouchStart={stopAll}
          onPointerDown={stopAll}
          onClick={(e) => { stopAll(e); openFull(); }}
          style={{
            background: 'rgba(0,0,0,0.55)',
            border: 'none',
            color: '#fff',
            width: isSmall ? 26 : 32,
            height: isSmall ? 26 : 32,
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: isSmall ? 12 : 15,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            flexShrink: 0,
          }}
          title="Expand to full player"
        >
          ⛶
        </button>
      </div>
    </div>
  );
}
