import { useState } from 'react';
import { createVideoClip } from '../lib/api';

interface Props {
  videoId: string;
  videoTitle: string;
  currentTime: number;
  videoDuration: number;
  onClose: () => void;
  onCreated: (clipId: string) => void;
  onToast?: (msg: string) => void;
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

function parseTime(str: string): number | null {
  const trimmed = str.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':').map((p) => p.trim());
  if (parts.length === 1) {
    const s = parseInt(parts[0], 10);
    return Number.isFinite(s) ? s : null;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseInt(parts[1], 10);
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    return m * 60 + s;
  }
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseInt(parts[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
    return h * 3600 + m * 60 + s;
  }
  return null;
}

export default function ClipModal({
  videoId, videoTitle, currentTime, videoDuration, onClose, onCreated, onToast,
}: Props) {
  const defaultStart = Math.max(0, Math.floor(currentTime));
  const defaultEnd = Math.min(Math.max(defaultStart + 30, 5), videoDuration || defaultStart + 30);

  const [title, setTitle] = useState(`${videoTitle.slice(0, 60)} — clip`);
  const [startStr, setStartStr] = useState(fmt(defaultStart));
  const [endStr, setEndStr] = useState(fmt(defaultEnd));
  const [busy, setBusy] = useState(false);

  const startSec = parseTime(startStr);
  const endSec = parseTime(endStr);
  const duration = (startSec !== null && endSec !== null) ? endSec - startSec : 0;
  const valid = startSec !== null && endSec !== null && duration >= 5 && duration <= 60;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || startSec === null || endSec === null) return;
    setBusy(true);
    try {
      const res = await createVideoClip(videoId, title.trim() || 'Clip', startSec, endSec);
      onToast?.('Clip created');
      onCreated(res.clip.id);
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to create clip');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mf-modal-backdrop" onClick={onClose}>
      <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>✂️ Create Clip</h2>
        <p style={{ color: '#606060', fontSize: 13, marginBottom: 18 }}>
          Share a 5–60 second segment of this video.
        </p>

        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 6, fontWeight: 500 }}>Title</label>
          <input
            className="mf-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            disabled={busy}
            style={{ width: '100%', marginBottom: 16, padding: '8px 12px', fontSize: 14 }}
          />

          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 6, fontWeight: 500 }}>Start (mm:ss)</label>
              <input
                className="mf-input"
                value={startStr}
                onChange={(e) => setStartStr(e.target.value)}
                disabled={busy}
                placeholder="0:30"
                style={{ width: '100%', padding: '8px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 6, fontWeight: 500 }}>End (mm:ss)</label>
              <input
                className="mf-input"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                disabled={busy}
                placeholder="1:00"
                style={{ width: '100%', padding: '8px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
          </div>

          <div style={{ fontSize: 12, color: valid ? '#16a34a' : '#dc2626', marginBottom: 16 }}>
            Duration: {duration >= 0 ? duration : 0}s {valid ? '✓' : '(must be 5–60s)'}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="mf-btn-text" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="mf-btn-text mf-btn-text-primary" disabled={busy || !valid}>
              {busy ? 'Creating...' : 'Create Clip'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
