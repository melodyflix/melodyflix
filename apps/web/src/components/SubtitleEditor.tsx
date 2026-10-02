import { useEffect, useState } from 'react';
import {
  getSubtitleCues, updateSubtitleCues,
  type SubtitleCue,
} from '../lib/api';

interface Props {
  trackId: string;
  onClose: () => void;
  onToast?: (msg: string) => void;
}

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, '0');
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`
    : `${String(m).padStart(2, '0')}:${sec}`;
}

function parseTime(str: string): number | null {
  const parts = str.trim().split(':').map((p) => parseFloat(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

export default function SubtitleEditor({ trackId, onClose, onToast }: Props) {
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [original, setOriginal] = useState<SubtitleCue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [trackInfo, setTrackInfo] = useState<any>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await getSubtitleCues(trackId);
      setCues(res.cues);
      setOriginal(res.cues);
      setTrackInfo(res.track);
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to load cues');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [trackId]);

  function updateCue(idx: number, patch: Partial<SubtitleCue>) {
    setCues((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function deleteCue(idx: number) {
    if (!confirm('Delete this cue?')) return;
    setCues((prev) => prev.filter((_, i) => i !== idx));
  }

  function insertAfter(idx: number) {
    const c = cues[idx];
    const newCue: SubtitleCue = {
      start: c.end,
      end: c.end + 2,
      text: '',
    };
    setCues((prev) => [...prev.slice(0, idx + 1), newCue, ...prev.slice(idx + 1)]);
  }

  async function handleSave() {
    setBusy(true);
    try {
      await updateSubtitleCues(trackId, cues);
      onToast?.('Cues saved');
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  function handleRevert() {
    setCues(original);
  }

  const dirty = JSON.stringify(cues) !== JSON.stringify(original);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: '#606060', marginBottom: 10 }}>
        {trackInfo && `${trackInfo.label} · ${trackInfo.language} · ${trackInfo.kind}`}
        {' · '}{cues.length} cue{cues.length === 1 ? '' : 's'}
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#909090' }}>Loading cues...</div>
      ) : cues.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#909090' }}>No cues.</div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid #e5e5e5', borderRadius: 8 }}>
          {cues.map((c, idx) => {
            const startOk = c.start < c.end;
            return (
              <div
                key={idx}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid #f0f0f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  background: startOk ? '#fff' : '#fef2f2',
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#909090', minWidth: 24 }}>#{idx + 1}</span>
                  <input
                    className="mf-input"
                    value={fmt(c.start)}
                    onChange={(e) => {
                      const v = parseTime(e.target.value);
                      if (v !== null) updateCue(idx, { start: v });
                    }}
                    style={{ width: 110, padding: '4px 8px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                  />
                  <span style={{ color: '#909090' }}>→</span>
                  <input
                    className="mf-input"
                    value={fmt(c.end)}
                    onChange={(e) => {
                      const v = parseTime(e.target.value);
                      if (v !== null) updateCue(idx, { end: v });
                    }}
                    style={{ width: 110, padding: '4px 8px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                  />
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button
                      className="mf-btn-text"
                      onClick={() => insertAfter(idx)}
                      title="Insert cue after"
                      style={{ fontSize: 11, color: '#065fd4' }}
                    >+ Insert</button>
                    <button
                      className="mf-btn-text"
                      onClick={() => deleteCue(idx)}
                      title="Delete cue"
                      style={{ fontSize: 12, color: '#dc2626' }}
                    >×</button>
                  </div>
                </div>
                <textarea
                  className="mf-input"
                  value={c.text}
                  onChange={(e) => updateCue(idx, { text: e.target.value })}
                  style={{ width: '100%', minHeight: 44, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit' }}
                />
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
        {dirty && (
          <span style={{ fontSize: 12, color: '#d97706', flex: 1 }}>⚠️ Unsaved changes</span>
        )}
        {!dirty && <span style={{ flex: 1 }} />}
        <button
          className="mf-btn-text"
          onClick={handleRevert}
          disabled={busy || !dirty}
          style={{ fontSize: 13 }}
        >Revert</button>
        <button
          className="mf-btn-text mf-btn-text-primary"
          onClick={handleSave}
          disabled={busy || !dirty}
          style={{ fontSize: 13 }}
        >
          {busy ? 'Saving...' : '💾 Save cues'}
        </button>
        <button
          className="mf-btn-secondary"
          onClick={onClose}
          disabled={busy}
          style={{ fontSize: 13 }}
        >Close</button>
      </div>
    </div>
  );
}
