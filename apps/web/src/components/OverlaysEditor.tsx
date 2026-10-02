import { useEffect, useState } from 'react';
import {
  listLowerThirds, createLowerThird, updateLowerThird, deleteLowerThird,
  getChannelTransition, setChannelTransition, resetChannelTransition,
  getOverlayPresets,
  type LowerThird, type LowerThirdInput, type ChannelTransition,
  type LowerThirdStyle, type LowerThirdAnimation, type LowerThirdPosition,
  type TransitionKind,
} from '../lib/api';

interface Props {
  channelId: string;
  onToast?: (msg: string) => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function OverlaysEditor({ channelId, onToast }: Props) {
  const [tab, setTab] = useState<'lower-thirds' | 'transitions'>('lower-thirds');
  const [items, setItems] = useState<LowerThird[]>([]);
  const [transition, setTransition] = useState<ChannelTransition | null>(null);
  const [styles, setStyles] = useState<{ id: LowerThirdStyle; label: string }[]>([]);
  const [animations, setAnimations] = useState<{ id: LowerThirdAnimation; label: string }[]>([]);
  const [transitionPresets, setTransitionPresets] = useState<{ id: TransitionKind; label: string; icon: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<LowerThirdInput | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [list, tr, p] = await Promise.all([
        listLowerThirds(channelId),
        getChannelTransition(channelId),
        getOverlayPresets().catch(() => null),
      ]);
      setItems(list.lower_thirds);
      setTransition(tr.transition);
      if (p) {
        setStyles(p.lower_third_styles);
        setAnimations(p.lower_third_animations);
        setTransitionPresets(p.transitions);
      }
    } catch (err) {
      onToast?.((err as Error).message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channelId]);

  async function handleSaveLT() {
    if (!editing || !editing.title?.trim()) return;
    setBusy(true);
    try {
      await createLowerThird(channelId, editing);
      onToast?.('Lower third added');
      setEditing(null);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateLT(id: string, patch: Partial<LowerThirdInput>) {
    setBusy(true);
    try {
      await updateLowerThird(channelId, id, patch);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteLT(id: string) {
    if (!confirm('Delete this lower third?')) return;
    setBusy(true);
    try {
      await deleteLowerThird(channelId, id);
      onToast?.('Deleted');
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransition(patch: { intro_to_video?: TransitionKind; video_to_outro?: TransitionKind; duration_ms?: number }) {
    if (!transition) return;
    setBusy(true);
    const prev = transition;
    setTransition({ ...transition, ...patch });
    try {
      const res = await setChannelTransition(channelId, patch);
      setTransition(res.transition);
    } catch (err) {
      onToast?.((err as Error).message || 'Save failed');
      setTransition(prev);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetTransition() {
    if (!confirm('Reset transitions to defaults?')) return;
    setBusy(true);
    try {
      const res = await resetChannelTransition(channelId);
      setTransition(res.transition);
      onToast?.('Reset');
    } catch (err) {
      onToast?.((err as Error).message || 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !transition) {
    return <div style={{ fontSize: 12, color: '#909090' }}>Loading overlays...</div>;
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #e5e5e5' }}>
        {([
          { id: 'lower-thirds', label: '📊 Lower Thirds' },
          { id: 'transitions', label: '🎬 Transitions' },
        ] as { id: 'lower-thirds' | 'transitions'; label: string }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid #065fd4' : '2px solid transparent',
              color: tab === t.id ? '#065fd4' : '#606060',
              fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'lower-thirds' && (
        <div>
          <div style={{ fontSize: 13, color: '#606060', marginBottom: 12 }}>
            Name plates and info graphics that appear at specific times during the video.
          </div>

          {/* List */}
          {items.length === 0 && !editing && (
            <div style={{ fontSize: 12, color: '#909090', marginBottom: 12 }}>No lower thirds yet.</div>
          )}
          {items.map((it) => (
            <div key={it.id} style={{
              background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8,
              padding: 12, marginBottom: 8, display: 'flex', gap: 10, alignItems: 'center',
            }}>
              <div style={{
                width: 4, height: 40, background: it.accent_color, borderRadius: 2,
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{it.title}</div>
                <div style={{ fontSize: 11, color: '#606060' }}>
                  {it.subtitle && <>{it.subtitle} · </>}
                  {fmt(it.start_seconds)} – {fmt(it.end_seconds)} · {it.style}
                  {it.is_enabled === 0 && ' · ⏸ disabled'}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <input
                  type="checkbox"
                  checked={it.is_enabled === 1}
                  onChange={(e) => handleUpdateLT(it.id, { is_enabled: e.target.checked })}
                />
                On
              </label>
              <button
                className="mf-btn-text"
                onClick={() => handleDeleteLT(it.id)}
                disabled={busy}
                style={{ color: '#dc2626', fontSize: 12 }}
              >×</button>
            </div>
          ))}

          {/* Editor form */}
          {editing ? (
            <div style={{
              background: '#f8f8f8', border: '1px solid #e5e5e5', borderRadius: 8,
              padding: 14, marginTop: 12,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>New Lower Third</div>
              <input
                className="mf-input"
                placeholder="Title (e.g. Jane Doe)"
                value={editing.title ?? ''}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 8 }}
              />
              <input
                className="mf-input"
                placeholder="Subtitle (e.g. Director)"
                value={editing.subtitle ?? ''}
                onChange={(e) => setEditing({ ...editing, subtitle: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                  className="mf-input"
                  value={editing.style ?? 'minimal'}
                  onChange={(e) => setEditing({ ...editing, style: e.target.value as LowerThirdStyle })}
                  style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
                >
                  {styles.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <select
                  className="mf-input"
                  value={editing.animation ?? 'slide-up'}
                  onChange={(e) => setEditing({ ...editing, animation: e.target.value as LowerThirdAnimation })}
                  style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
                >
                  {animations.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select
                  className="mf-input"
                  value={editing.position ?? 'left'}
                  onChange={(e) => setEditing({ ...editing, position: e.target.value as LowerThirdPosition })}
                  style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
                <input
                  type="color"
                  value={editing.accent_color ?? '#065fd4'}
                  onChange={(e) => setEditing({ ...editing, accent_color: e.target.value })}
                  title="Accent color"
                  style={{ width: 44, height: 34, borderRadius: 6, border: '1px solid #e5e5e5', cursor: 'pointer' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <label style={{ flex: 1, fontSize: 11, color: '#606060' }}>
                  Start: {editing.start_seconds ?? 0}s
                  <input
                    type="range" min={0} max={120} step={1}
                    value={editing.start_seconds ?? 0}
                    onChange={(e) => setEditing({ ...editing, start_seconds: parseInt(e.target.value) })}
                    style={{ width: '100%', accentColor: '#065fd4' }}
                  />
                </label>
                <label style={{ flex: 1, fontSize: 11, color: '#606060' }}>
                  End: {editing.end_seconds ?? 5}s
                  <input
                    type="range" min={0} max={300} step={1}
                    value={editing.end_seconds ?? 5}
                    onChange={(e) => setEditing({ ...editing, end_seconds: parseInt(e.target.value) })}
                    style={{ width: '100%', accentColor: '#065fd4' }}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="mf-btn-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
                <button className="mf-btn-text mf-btn-text-primary" onClick={handleSaveLT} disabled={busy || !editing.title?.trim()}>
                  {busy ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="mf-btn-text mf-btn-text-primary"
              onClick={() => setEditing({
                title: '', subtitle: '',
                style: 'minimal', animation: 'slide-up', position: 'left',
                accent_color: '#065fd4', text_color: '#ffffff',
                bg_color: 'rgba(0,0,0,0.75)',
                start_seconds: 0, end_seconds: 5,
              })}
              style={{ marginTop: 8, fontSize: 13 }}
            >+ Add lower third</button>
          )}
        </div>
      )}

      {tab === 'transitions' && (
        <div>
          <div style={{ fontSize: 13, color: '#606060', marginBottom: 14 }}>
            How the player transitions from intro → video and video → outro.
          </div>

          {/* Intro → Video */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Intro → Video</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
              {transitionPresets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleTransition({ intro_to_video: p.id })}
                  disabled={busy}
                  style={{
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    background: transition.intro_to_video === p.id ? '#e8f0fe' : '#fff',
                    color: transition.intro_to_video === p.id ? '#065fd4' : '#0f0f0f',
                    border: transition.intro_to_video === p.id ? '1.5px solid #065fd4' : '1px solid #e5e5e5',
                    fontWeight: transition.intro_to_video === p.id ? 600 : 400,
                    fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Video → Outro */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Video → Outro</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
              {transitionPresets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleTransition({ video_to_outro: p.id })}
                  disabled={busy}
                  style={{
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    background: transition.video_to_outro === p.id ? '#e8f0fe' : '#fff',
                    color: transition.video_to_outro === p.id ? '#065fd4' : '#0f0f0f',
                    border: transition.video_to_outro === p.id ? '1.5px solid #065fd4' : '1px solid #e5e5e5',
                    fontWeight: transition.video_to_outro === p.id ? 600 : 400,
                    fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Duration: {transition.duration_ms}ms
            </div>
            <input
              type="range" min={200} max={2000} step={100}
              value={transition.duration_ms}
              onChange={(e) => handleTransition({ duration_ms: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: '#065fd4' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="mf-btn-text"
              onClick={handleResetTransition}
              disabled={busy}
              style={{ color: '#dc2626', fontSize: 12 }}
            >Reset to defaults</button>
          </div>
        </div>
      )}
    </div>
  );
}
