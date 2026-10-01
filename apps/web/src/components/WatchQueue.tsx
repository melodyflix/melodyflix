import { useEffect, useState } from 'react';
import {
  getWatchQueue, removeFromQueue, reorderQueue, clearQueue,
  getCachedUser,
  type QueueItem,
} from '../lib/api';

interface Props {
  onPlay: (videoId: string) => void;
  onSignIn: () => void;
  onClose: () => void;
}

function fmtDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function WatchQueue({ onPlay, onSignIn, onClose }: Props) {
  const me = getCachedUser();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!me) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await getWatchQueue();
      setItems(res.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function handleRemove(videoId: string) {
    setBusy(true);
    try {
      const res = await removeFromQueue(videoId);
      setItems(res.items);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMove(videoId: string, dir: -1 | 1) {
    const idx = items.findIndex((i) => i.video_id === videoId);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(idx, 1);
    reordered.splice(newIdx, 0, moved);
    setItems(reordered);
    setBusy(true);
    try {
      const res = await reorderQueue(reordered.map((i) => i.video_id));
      setItems(res.items);
    } catch (err) {
      alert((err as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!confirm('Clear the entire queue?')) return;
    setBusy(true);
    try {
      await clearQueue();
      setItems([]);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mf-queue-panel">
      <div className="mf-queue-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ fontSize: 15 }}>Watch Queue</strong>
          <span style={{ fontSize: 12, color: '#606060' }}>({items.length})</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {items.length > 0 && (
            <button
              className="mf-btn-text"
              onClick={handleClear}
              disabled={busy}
              style={{ fontSize: 12 }}
            >
              Clear
            </button>
          )}
          <button
            className="mf-btn-text"
            onClick={onClose}
            title="Close"
            style={{ fontSize: 16, padding: '2px 8px' }}
          >
            ✕
          </button>
        </div>
      </div>

      {!me ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#606060' }}>
          <p>Sign in to save videos to your queue.</p>
          <button className="mf-btn-secondary" onClick={onSignIn} style={{ marginTop: 8 }}>
            Sign in
          </button>
        </div>
      ) : loading ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#606060' }}>
          Loading...
        </div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#606060' }}>
          Your queue is empty.<br />Add videos to watch next.
        </div>
      ) : (
        <div className="mf-queue-list">
          {items.map((it, idx) => (
            <div key={it.id} className="mf-queue-item">
              <div
                className="mf-queue-thumb"
                onClick={() => onPlay(it.video_id)}
                style={{ cursor: 'pointer' }}
              >
                {it.thumbnail_url ? (
                  <img src={it.thumbnail_url} alt="" loading="lazy" />
                ) : (
                  <div className="mf-queue-thumb-placeholder">🎬</div>
                )}
                {it.duration_seconds ? (
                  <span className="mf-queue-duration">{fmtDuration(it.duration_seconds)}</span>
                ) : null}
              </div>
              <div className="mf-queue-meta" onClick={() => onPlay(it.video_id)} style={{ cursor: 'pointer' }}>
                <div className="mf-queue-title" title={it.title ?? ''}>
                  {it.title ?? 'Untitled video'}
                </div>
                <div className="mf-queue-sub">{idx + 1} in queue</div>
              </div>
              <div className="mf-queue-actions">
                <button
                  className="mf-btn-text"
                  onClick={() => handleMove(it.video_id, -1)}
                  disabled={busy || idx === 0}
                  title="Move up"
                  style={{ fontSize: 12, padding: '2px 6px' }}
                >▲</button>
                <button
                  className="mf-btn-text"
                  onClick={() => handleMove(it.video_id, 1)}
                  disabled={busy || idx === items.length - 1}
                  title="Move down"
                  style={{ fontSize: 12, padding: '2px 6px' }}
                >▼</button>
                <button
                  className="mf-btn-text"
                  onClick={() => handleRemove(it.video_id)}
                  disabled={busy}
                  title="Remove"
                  style={{ fontSize: 12, padding: '2px 6px', color: '#dc2626' }}
                >✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
