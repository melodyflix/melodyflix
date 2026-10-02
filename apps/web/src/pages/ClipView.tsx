import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import HlsPlayer from '../components/HlsPlayer';
import {
  getClip, incrementClipView, deleteClip, getCachedUser,
  formatViews, timeAgo,
  type Clip,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export default function ClipView({ onSignIn }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = getCachedUser();
  const [clip, setClip] = useState<Clip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const viewedRef = useRef(false);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getClip(id)
      .then((res) => {
        setClip(res.clip);
        // Count view once
        if (!viewedRef.current) {
          viewedRef.current = true;
          incrementClipView(res.clip.id).catch(() => {});
        }
      })
      .catch((err) => setError((err as Error).message || 'Clip not found'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleCopyLink() {
    if (!clip) return;
    const url = `${window.location.origin}/clip/${clip.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied');
    } catch {
      showToast(url);
    }
  }

  async function handleDelete() {
    if (!clip) return;
    if (!confirm('Delete this clip?')) return;
    try {
      await deleteClip(clip.id);
      showToast('Clip deleted');
      navigate(`/watch/${clip.video_id}`);
    } catch (err) {
      showToast((err as Error).message || 'Delete failed');
    }
  }

  if (loading) {
    return <div className="mf-page" style={{ padding: 60, textAlign: 'center', color: '#606060' }}>Loading clip...</div>;
  }

  if (error || !clip) {
    return (
      <div className="mf-page" style={{ padding: 60, textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Clip not found</h2>
        <p style={{ color: '#606060', marginBottom: 20 }}>{error || 'This clip may have been deleted.'}</p>
        <button className="mf-btn-secondary" onClick={() => navigate('/')}>Go home</button>
      </div>
    );
  }

  const isOwner = !!me && (me.id === clip.creator_user_id || me.id === clip.video_owner_id);
  const duration = clip.duration_seconds;

  // Build HLS URL (assuming videos service serves HLS at /api/v1/videos/:id/hls/master.m3u8)
  const streamSrc = `/api/v1/videos/${clip.video_id}/stream/master.m3u8`;

  return (
    <div className="mf-page" style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <div className="mf-clip-header" style={{ marginBottom: 16 }}>
        <span className="mf-clip-badge">✂️ Clip</span>
        <span style={{ fontSize: 12, color: '#606060', marginLeft: 8 }}>
          {fmt(clip.start_seconds)} → {fmt(clip.end_seconds)} ({duration}s)
        </span>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 12px 0', lineHeight: 1.3 }}>
        {clip.title}
      </h1>

      <div style={{ borderRadius: 12, overflow: 'hidden', background: '#000', marginBottom: 16 }}>
        <HlsPlayer
          src={streamSrc}
          startTime={clip.start_seconds}
          onStateChange={(s) => {
            setCurrentTime(s.currentTime);
            // Enforce clip end boundary — pause when we cross end_seconds
            if (s.currentTime >= clip.end_seconds && s.playing) {
              const vid = document.querySelector('video');
              if (vid && !vid.paused) vid.pause();
            }
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        <button
          className="mf-sub-btn"
          style={{ background: '#f2f2f2', color: '#0f0f0f' }}
          onClick={handleCopyLink}
        >
          🔗 Copy link
        </button>
        <button
          className="mf-sub-btn"
          style={{ background: '#f2f2f2', color: '#0f0f0f' }}
          onClick={() => navigate(`/watch/${clip.video_id}`)}
        >
          ▶️ Watch full video
        </button>
        {isOwner && (
          <button
            className="mf-sub-btn"
            style={{ background: '#fee2e2', color: '#dc2626' }}
            onClick={handleDelete}
          >
            🗑️ Delete clip
          </button>
        )}
      </div>

      <div style={{
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 12,
        padding: '14px 18px',
      }}>
        <div style={{ fontSize: 13, color: '#606060', marginBottom: 6 }}>
          From: <strong style={{ color: '#0f0f0f' }}>{clip.video_title ?? 'Video'}</strong>
        </div>
        <div style={{ fontSize: 12, color: '#909090' }}>
          {formatViews(clip.view_count)} views · {timeAgo(clip.created_at)}
        </div>
      </div>

      {toast && <div className="mf-toast">{toast}</div>}
    </div>
  );
}
