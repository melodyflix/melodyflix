import { useEffect, useRef, useState } from 'react';
import {
  SUBTITLE_LANGUAGES, listVideoSubtitles, uploadVideoSubtitle,
  setDefaultSubtitle, deleteSubtitleTrack,
  autoGenerateSubtitle,
  type SubtitleTrack,
} from '../lib/api';
import SubtitleEditor from './SubtitleEditor';

interface Props {
  videoId: string;
  onToast?: (msg: string) => void;
}

export default function SubtitleManager({ videoId, onToast }: Props) {
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [language, setLanguage] = useState('en');
  const [label, setLabel] = useState('English');
  const [kind, setKind] = useState<'subtitles' | 'captions'>('subtitles');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  async function load() {
    try {
      const res = await listVideoSubtitles(videoId);
      setTracks(res.subtitles);
    } catch {}
  }

  useEffect(() => { load(); }, [videoId]);

  function onLangChange(code: string) {
    setLanguage(code);
    const found = SUBTITLE_LANGUAGES.find((l) => l.code === code);
    if (found) setLabel(found.label);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500_000) {
      onToast?.('File too large (max 500KB)');
      return;
    }
    const name = file.name.toLowerCase();
    const format: 'srt' | 'vtt' = name.endsWith('.vtt') ? 'vtt' : 'srt';
    if (!name.endsWith('.srt') && !name.endsWith('.vtt')) {
      onToast?.('Only .srt or .vtt files allowed');
      return;
    }
    setBusy(true);
    try {
      const content = await file.text();
      await uploadVideoSubtitle(videoId, {
        language,
        label: label || language,
        format,
        kind,
        content,
        is_default: isDefault,
      });
      onToast?.(`Subtitle "${label}" uploaded`);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault(id: string) {
    setBusy(true);
    try {
      await setDefaultSubtitle(id);
      onToast?.('Default updated');
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this subtitle track?')) return;
    setBusy(true);
    try {
      await deleteSubtitleTrack(id);
      onToast?.('Subtitle deleted');
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoGenerate() {
    setAutoBusy(true);
    try {
      const track = await autoGenerateSubtitle(videoId, language, `${label} (auto)`, kind);
      onToast?.(`🤖 Auto-generated draft "${track.track.label}" — review & edit`);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Auto-generation failed');
    } finally {
      setAutoBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#606060', marginBottom: 10 }}>
        Upload .srt or .vtt subtitle files. Default track auto-loads in the player.
      </div>

      {/* Existing tracks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
        {tracks.map((t) => (
          <div key={t.id} className="mf-castcrew-edit-row">
            <span className="mf-castcrew-role-tag" style={{ background: t.kind === 'captions' ? '#fef3c7' : '#e8f0fe', color: t.kind === 'captions' ? '#92400e' : '#065fd4' }}>
              {t.kind === 'captions' ? '🔠 CC' : '💬 Sub'}
            </span>
            <span style={{ flex: 1, fontWeight: 500 }}>
              {t.label} <span style={{ color: '#909090', fontSize: 11 }}>({t.language} · {t.format})</span>
              {t.is_default === 1 && (
                <span className="mf-badge mf-badge-success" style={{ marginLeft: 8, fontSize: 10 }}>Default</span>
              )}
            </span>
            <button
              className="mf-btn-text"
              onClick={() => setEditingTrackId(t.id === editingTrackId ? null : t.id)}
              disabled={busy}
              style={{ fontSize: 11, color: '#7c3aed' }}
              title="Edit cues"
            >
              {editingTrackId === t.id ? 'Close editor' : '✏️ Edit cues'}
            </button>
            {t.is_default !== 1 && (
              <button
                className="mf-btn-text"
                onClick={() => handleSetDefault(t.id)}
                disabled={busy}
                style={{ fontSize: 11, color: '#065fd4' }}
              >
                Set default
              </button>
            )}
            <button
              className="mf-btn-text"
              onClick={() => handleDelete(t.id)}
              disabled={busy}
              style={{ fontSize: 12, color: '#dc2626' }}
              title="Delete"
            >×</button>
          </div>
        ))}

        {/* Inline cue editor for active track */}
        {editingTrackId && tracks.find((t) => t.id === editingTrackId) && (
          <SubtitleEditor
            trackId={editingTrackId}
            onClose={() => setEditingTrackId(null)}
            onToast={onToast}
          />
        )}
        {tracks.length === 0 && (
          <div style={{ fontSize: 12, color: '#909090' }}>No subtitle tracks yet.</div>
        )}
      </div>

      {/* Auto-generate (draft) block */}
      <div style={{
        marginTop: 4,
        padding: '10px 12px',
        background: '#f0f4ff',
        border: '1px solid #c7d2fe',
        borderRadius: 8,
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#3730a3' }}>
              🤖 Auto-Generate Draft
            </div>
            <div style={{ fontSize: 11, color: '#6366f1', marginTop: 2 }}>
              Uses chapters / description timestamps. Edit after generating.
            </div>
          </div>
          <button
            type="button"
            className="mf-btn-text mf-btn-text-primary"
            onClick={handleAutoGenerate}
            disabled={autoBusy || busy}
            style={{ fontSize: 12 }}
          >
            {autoBusy ? 'Generating...' : '⚡ Generate'}
          </button>
        </div>
      </div>

      {/* Upload form */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select
          className="mf-select"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'subtitles' | 'captions')}
          disabled={busy}
          style={{ padding: '8px 12px', fontSize: 13 }}
        >
          <option value="subtitles">💬 Subtitles</option>
          <option value="captions">🔠 Closed Captions</option>
        </select>
        <select
          className="mf-select"
          value={language}
          onChange={(e) => onLangChange(e.target.value)}
          disabled={busy}
          style={{ padding: '8px 12px', fontSize: 13 }}
        >
          {SUBTITLE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
        <input
          className="mf-input"
          placeholder="Label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
          style={{ flex: '1 1 140px', padding: '8px 12px', fontSize: 13 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#606060' }}>
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            disabled={busy}
          />
          Default
        </label>
        <input
          ref={fileRef}
          type="file"
          accept=".srt,.vtt"
          onChange={handleFile}
          disabled={busy}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="mf-btn-text mf-btn-text-primary"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Uploading...' : '📁 Upload'}
        </button>
      </div>
    </div>
  );
}
