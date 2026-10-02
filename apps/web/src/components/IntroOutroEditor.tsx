import { useEffect, useState } from 'react';
import {
  listChannelIntros, setChannelIntro, removeChannelIntro, getIntroTemplates,
  type ChannelIntro, type IntroTemplate, type IntroKind, type IntroInput,
} from '../lib/api';

interface Props {
  channelId: string;
  onToast?: (msg: string) => void;
}

function fmtDuration(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export default function IntroOutroEditor({ channelId, onToast }: Props) {
  const [intro, setIntro] = useState<ChannelIntro | null>(null);
  const [outro, setOutro] = useState<ChannelIntro | null>(null);
  const [templates, setTemplates] = useState<IntroTemplate[]>([]);
  const [activeKind, setActiveKind] = useState<IntroKind>('intro');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Form state
  const [url, setUrl] = useState('');
  const [thumb, setThumb] = useState('');
  const [duration, setDuration] = useState(3);
  const [skipAfter, setSkipAfter] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [res, tpl] = await Promise.all([
        listChannelIntros(channelId),
        getIntroTemplates().catch(() => ({ templates: [] })),
      ]);
      setIntro(res.bundle.intro);
      setOutro(res.bundle.outro);
      setTemplates(tpl.templates);
    } catch (err) {
      onToast?.((err as Error).message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channelId]);

  // Populate form when kind switches
  useEffect(() => {
    const current = activeKind === 'intro' ? intro : outro;
    if (current) {
      setUrl(current.video_url);
      setThumb(current.thumbnail_url ?? '');
      setDuration(current.duration_seconds);
      setSkipAfter(current.skip_after_seconds);
      setEnabled(current.is_enabled === 1);
      setTemplateId(current.template_id);
    } else {
      setUrl(''); setThumb(''); setDuration(3); setSkipAfter(0); setEnabled(true); setTemplateId(null);
    }
  }, [activeKind, intro, outro]);

  function applyTemplate(tpl: IntroTemplate) {
    setTemplateId(tpl.id);
    setDuration(tpl.duration_seconds);
    if (!url) onToast?.(`Template "${tpl.label}" applied. Now upload/link your intro video.`);
  }

  async function handleSave() {
    if (!url.trim()) {
      onToast?.('Video URL is required');
      return;
    }
    setBusy(true);
    try {
      const input: IntroInput = {
        kind: activeKind,
        video_url: url.trim(),
        thumbnail_url: thumb.trim() || null,
        duration_seconds: duration,
        skip_after_seconds: skipAfter,
        is_enabled: enabled,
        template_id: templateId,
      };
      const res = await setChannelIntro(channelId, input);
      if (activeKind === 'intro') setIntro(res.intro); else setOutro(res.intro);
      onToast?.(`${activeKind === 'intro' ? 'Intro' : 'Outro'} saved`);
    } catch (err) {
      onToast?.((err as Error).message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!confirm(`Remove this ${activeKind}?`)) return;
    setBusy(true);
    try {
      await removeChannelIntro(channelId, activeKind);
      if (activeKind === 'intro') setIntro(null); else setOutro(null);
      onToast?.('Removed');
    } catch (err) {
      onToast?.((err as Error).message || 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div style={{ fontSize: 12, color: '#909090' }}>Loading intros...</div>;
  }

  const current = activeKind === 'intro' ? intro : outro;
  const relevantTemplates = templates.filter((t) => t.kind === activeKind);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#606060', marginBottom: 12 }}>
        Intro plays at the start of every video. Outro plays at the end (can be a subscribe end-card).
      </div>

      {/* Kind tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['intro', 'outro'] as IntroKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setActiveKind(k)}
            style={{
              padding: '8px 18px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              fontFamily: 'inherit',
              background: activeKind === k ? '#065fd4' : '#f2f2f2',
              color: activeKind === k ? '#fff' : '#0f0f0f',
              border: 'none',
              fontWeight: activeKind === k ? 600 : 400,
            }}
          >
            {k === 'intro' ? '▶️ Intro' : '🔚 Outro'}
            {((k === 'intro' ? intro : outro)?.is_enabled === 1) && ' ✓'}
          </button>
        ))}
      </div>

      {/* Templates grid */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Templates</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {relevantTemplates.map((tpl) => {
            const active = templateId === tpl.id;
            return (
              <button
                key={tpl.id}
                onClick={() => applyTemplate(tpl)}
                disabled={busy}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6,
                  padding: 12, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                  background: active ? '#e8f0fe' : '#fff',
                  border: active ? '2px solid #065fd4' : '1px solid #e5e5e5',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 8,
                  background: tpl.preview_color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>{tpl.preview_icon}</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{tpl.label}</div>
                <div style={{ fontSize: 11, color: '#606060', lineHeight: 1.35 }}>{tpl.description}</div>
                <div style={{ fontSize: 10, color: '#909090' }}>{fmtDuration(tpl.duration_seconds)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Video URL */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Video URL (MP4 or HLS)
        </label>
        <input
          className="mf-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://cdn.example.com/intro.mp4"
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, fontFamily: 'monospace' }}
          disabled={busy}
        />
      </div>

      {/* Thumbnail */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          Thumbnail URL (optional)
        </label>
        <input
          className="mf-input"
          value={thumb}
          onChange={(e) => setThumb(e.target.value)}
          placeholder="https://..."
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, fontFamily: 'monospace' }}
          disabled={busy}
        />
      </div>

      {/* Duration + Skip */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Duration: {fmtDuration(duration)}
          </label>
          <input
            type="range" min={1} max={60} step={1} value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value))}
            disabled={busy}
            style={{ width: '100%', accentColor: '#065fd4' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            Skip button after: {skipAfter > 0 ? fmtDuration(skipAfter) : 'hidden'}
          </label>
          <input
            type="range" min={0} max={duration} step={1} value={skipAfter}
            onChange={(e) => setSkipAfter(parseInt(e.target.value))}
            disabled={busy}
            style={{ width: '100%', accentColor: '#065fd4' }}
          />
        </div>
      </div>

      {/* Enable toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Enable on videos</div>
          <div style={{ fontSize: 11, color: '#909090' }}>
            When off, no {activeKind} will play even if saved
          </div>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          disabled={busy}
          aria-pressed={enabled}
          style={{
            width: 42, height: 24, borderRadius: 12, border: 'none',
            background: enabled ? '#065fd4' : '#ccc',
            position: 'relative', cursor: 'pointer', padding: 0,
          }}
        >
          <span style={{
            position: 'absolute', top: 3, left: enabled ? 21 : 3,
            width: 18, height: 18, borderRadius: '50%', background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }} />
        </button>
      </div>

      {/* Preview (thumbnail or video) */}
      {(url || thumb) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#909090', marginBottom: 4 }}>Preview</div>
          <div style={{
            background: '#000', borderRadius: 8, overflow: 'hidden',
            aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center',
            maxWidth: 340, position: 'relative',
          }}>
            {thumb ? (
              <img src={thumb} alt="Intro preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div style={{ color: '#fff', fontSize: 12 }}>🎬 {fmtDuration(duration)}</div>
            )}
            {skipAfter > 0 && skipAfter < duration && (
              <div style={{
                position: 'absolute', bottom: 8, right: 8,
                background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 11,
                padding: '3px 8px', borderRadius: 4,
              }}>Skip available after {skipAfter}s</div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {current && (
          <button
            type="button"
            className="mf-btn-text"
            onClick={handleRemove}
            disabled={busy}
            style={{ color: '#dc2626', fontSize: 13 }}
          >Remove</button>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="mf-btn-secondary"
          onClick={load}
          disabled={busy}
          style={{ fontSize: 13 }}
        >Reload</button>
        <button
          type="button"
          className="mf-btn-text mf-btn-text-primary"
          onClick={handleSave}
          disabled={busy || !url.trim()}
          style={{ fontSize: 13 }}
        >
          {busy ? 'Saving...' : `💾 Save ${activeKind}`}
        </button>
      </div>
    </div>
  );
}
