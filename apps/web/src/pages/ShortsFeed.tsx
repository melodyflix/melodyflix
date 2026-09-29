import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  listShorts, likeVideo, getCachedUser, formatViews,
  type Video,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function ShortsFeed({ onSignIn }: Props) {
  const navigate = useNavigate();
  const { id: startId } = useParams<{ id?: string }>();
  const me = getCachedUser();

  const [shorts, setShorts] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [reactions, setReactions] = useState<Record<string, { likeCount: number; userReaction: 'like' | 'dislike' | null }>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    listShorts(50, 0)
      .then((data) => {
        setShorts(data.shorts);
        const initial: Record<string, any> = {};
        for (const v of data.shorts) {
          initial[v.id] = {
            likeCount: v.like_count,
            userReaction: (v as any).user_reaction ?? null,
          };
        }
        setReactions(initial);
        // Start at requested short if exists
        if (startId) {
          const idx = data.shorts.findIndex((s) => s.id === startId);
          if (idx >= 0) setIndex(idx);
        }
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [startId]);

  async function handleLike(videoId: string) {
    if (!me) { onSignIn(); return; }
    const cur = reactions[videoId];
    const next = cur?.userReaction === 'like' ? 'none' : 'like';
    try {
      const res = await likeVideo(videoId, next as any);
      setReactions((prev) => ({
        ...prev,
        [videoId]: { likeCount: res.likeCount, userReaction: res.userReaction },
      }));
    } catch {}
  }

  async function handleShare(videoId: string) {
    const url = window.location.origin + '/shorts/' + videoId;
    if (navigator.share) {
      try { await navigator.share({ url }); } catch {}
    } else {
      navigator.clipboard.writeText(url).then(() => alert('Link copied')).catch(() => {});
    }
  }

  function scrollBy(dir: 1 | -1) {
    const el = containerRef.current;
    if (!el) return;
    const nextIdx = index + dir;
    if (nextIdx < 0 || nextIdx >= shorts.length) return;
    el.scrollTo({ top: nextIdx * el.clientHeight, behavior: 'smooth' });
    setIndex(nextIdx);
  }

  function onScroll() {
    const el = containerRef.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== index) setIndex(i);
    // Update URL quietly
    if (shorts[i]) {
      window.history.replaceState({}, '', '/shorts/' + shorts[i].id);
    }
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#fff', background: '#000', minHeight: '100vh' }}>Loading shorts...</div>;
  }
  if (error) {
    return <div style={{ padding: 60, textAlign: 'center', color: '#dc2626', background: '#000', minHeight: '100vh' }}>{error}</div>;
  }
  if (shorts.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', background: '#000', minHeight: '100vh', color: '#fff' }}>
        <div style={{ fontSize: 60, marginBottom: 16 }}>📱</div>
        <div style={{ fontSize: 20, marginBottom: 8 }}>No shorts yet</div>
        <div style={{ color: '#909090', marginBottom: 24 }}>Upload a short to get started</div>
        <button
          onClick={() => navigate('/upload')}
          className="mf-btn-primary"
          style={{ width: 'auto', padding: '10px 24px' }}
        >
          Upload short
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      style={{
        height: 'calc(100vh - 56px)',
        overflowY: 'scroll',
        scrollSnapType: 'y mandatory',
        background: '#000',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}
    >
      {/* Fixed header (Reels label) */}
      <div
        style={{
          position: 'fixed',
          top: 56,
          left: 0,
          right: 0,
          padding: '12px 20px',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(rgba(0,0,0,0.6), transparent)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: -0.3 }}>
          Shorts
        </div>
        <div style={{ color: '#fff', fontSize: 20, pointerEvents: 'auto' }}>
          📷 🔍 ⋯
        </div>
      </div>

      {shorts.map((s, i) => {
        const r = reactions[s.id];
        const isActive = i === index;
        return (
          <ShortItem
            key={s.id}
            video={s}
            active={isActive}
            reaction={r?.userReaction ?? null}
            likeCount={r?.likeCount ?? s.like_count}
            onLike={() => handleLike(s.id)}
            onComment={() => navigate(`/watch/${s.id}`)}
            onShare={() => handleShare(s.id)}
            onChannel={() => navigate(`/channel/${s.channel_id}`)}
            formatTime={formatTime}
          />
        );
      })}
    </div>
  );
}

function ShortItem({
  video, active, reaction, likeCount, onLike, onComment, onShare, onChannel, formatTime,
}: {
  video: Video;
  active: boolean;
  reaction: 'like' | 'dislike' | null;
  likeCount: number;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onChannel: () => void;
  formatTime: (s: number) => string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || video.status !== 'ready') return;
    let hls: any = null;
    let cancelled = false;

    const src = video.hls_master_url ?? `/api/v1/videos/${video.id}/stream/master.m3u8`;

    (async () => {
      if (v.canPlayType('application/vnd.apple.mpegurl') && !('MediaSource' in window)) {
        v.src = src;
        return;
      }
      const mod = await import('hls.js');
      const Hls = mod.default;
      if (!Hls.isSupported()) return;
      hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(v);
    })();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      hlsRef.current = null;
    };
  }, [video.id]);

  // Autoplay when active, pause when not
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active) {
      v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      v.pause();
      setPlaying(false);
    }
  }, [active]);

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }

  const initial = (video.title[0] ?? 'M').toUpperCase();

  return (
    <div
      style={{
        height: 'calc(100vh - 56px)',
        scrollSnapAlign: 'start',
        position: 'relative',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <video
        ref={videoRef}
        loop
        muted={false}
        playsInline
        onClick={togglePlay}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          background: '#000',
        }}
      />

      {!playing && (
        <div
          onClick={togglePlay}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: 70,
              height: 70,
              borderRadius: '50%',
              background: 'rgba(0,0,0,0.55)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 30,
            }}
          >
            ▶
          </div>
        </div>
      )}

      {/* Right action bar */}
      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 100,
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          alignItems: 'center',
          zIndex: 10,
        }}
      >
        <ActionButton
          icon={reaction === 'like' ? '❤️' : '👍'}
          label={String(likeCount)}
          onClick={onLike}
          active={reaction === 'like'}
        />
        <ActionButton icon="💬" label="1" onClick={onComment} />
        <ActionButton icon="↗" label="6" onClick={onShare} />
        <ActionButton icon="🔖" label="22" onClick={() => {}} />
      </div>

      {/* Bottom info */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 80,
          bottom: 20,
          zIndex: 10,
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div
            onClick={onChannel}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #7c3aed, #ec4899)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {initial}
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, cursor: 'pointer' }} onClick={onChannel}>
            {video.title.slice(0, 24)}
          </div>
          <button
            style={{
              background: 'transparent',
              border: '1px solid #fff',
              color: '#fff',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Follow
          </button>
        </div>

        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            display: '-webkit-box',
            WebkitLineClamp: expanded ? 10 : 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textShadow: '0 1px 2px rgba(0,0,0,0.7)',
          }}
        >
          {video.description ?? video.title}
          {!expanded && (video.description ?? video.title).length > 80 && (
            <span
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              style={{ cursor: 'pointer', color: '#ddd', marginLeft: 4 }}
            >
              … more
            </span>
          )}
        </div>

        <div style={{ fontSize: 12, color: '#ddd', marginTop: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span>🎵 Original audio</span>
          <span>·</span>
          <span>⏱ {formatTime(video.duration_seconds)}</span>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon, label, onClick, active,
}: { icon: string; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        cursor: 'pointer',
        fontFamily: 'inherit',
        padding: 4,
      }}
    >
      <span
        style={{
          fontSize: 30,
          filter: active ? 'drop-shadow(0 0 6px rgba(236,72,153,0.9))' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))',
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: 12, fontWeight: 600, textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}>
        {label}
      </span>
    </button>
  );
}
