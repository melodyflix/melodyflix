import { useEffect, useState } from 'react';
import {
  getChannelCustomization, setChannelCustomization, resetChannelCustomization,
  getCustomizationPresets,
  type PlayerCustomization, type CustomizationInput,
} from '../lib/api';

interface Props {
  channelId: string;
  onToast?: (msg: string) => void;
  onCustomizationChange?: (c: PlayerCustomization) => void;
}

type Tab = 'skin' | 'filters' | 'grading' | 'logo';

const LOGO_POSITIONS: { id: PlayerCustomization['logo_position']; label: string }[] = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-right', label: 'Bottom Right' },
];

function Slider({ label, value, min, max, step, onChange, unit }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: '#0f0f0f', fontWeight: 500 }}>{label}</span>
        <span style={{ color: '#606060', fontVariantNumeric: 'tabular-nums' }}>
          {value}{unit ?? ''}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#065fd4' }}
      />
    </div>
  );
}

export default function CustomizationEditor({ channelId, onToast, onCustomizationChange }: Props) {
  const [c, setC] = useState<PlayerCustomization | null>(null);
  const [filterPresets, setFilterPresets] = useState<{ id: string; label: string }[]>([]);
  const [gradingPresets, setGradingPresets] = useState<{ id: string; label: string }[]>([]);
  const [tab, setTab] = useState<Tab>('skin');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [res, presets] = await Promise.all([
        getChannelCustomization(channelId),
        getCustomizationPresets().catch(() => ({ filters: [], grading: [] })),
      ]);
      setC(res.customization);
      setFilterPresets(presets.filters);
      setGradingPresets(presets.grading);
      onCustomizationChange?.(res.customization);
    } catch (err) {
      onToast?.((err as Error).message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channelId]);

  // Debounced save
  async function patch(update: CustomizationInput) {
    if (!c) return;
    const optimistic = { ...c, ...update } as PlayerCustomization;
    setC(optimistic);
    onCustomizationChange?.(optimistic);
    setBusy(true);
    try {
      const res = await setChannelCustomization(channelId, update);
      setC(res.customization);
      onCustomizationChange?.(res.customization);
    } catch (err) {
      onToast?.((err as Error).message || 'Save failed');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!confirm('Reset player customization to defaults?')) return;
    setBusy(true);
    try {
      const res = await resetChannelCustomization(channelId);
      setC(res.customization);
      onCustomizationChange?.(res.customization);
      onToast?.('Reset to defaults');
    } catch (err) {
      onToast?.((err as Error).message || 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !c) {
    return <div style={{ fontSize: 12, color: '#909090' }}>Loading customization...</div>;
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#606060', marginBottom: 12 }}>
        Brand your player and apply video filters that all viewers will see.
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e5e5e5' }}>
        {([
          { id: 'skin', label: '🎨 Skin' },
          { id: 'logo', label: '🖼️ Logo & Watermark' },
          { id: 'filters', label: '✨ Filters' },
          { id: 'grading', label: '🎬 Color Grading' },
        ] as { id: Tab; label: string }[]).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 12px', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid #065fd4' : '2px solid transparent',
              color: tab === t.id ? '#065fd4' : '#606060',
              fontWeight: tab === t.id ? 600 : 400,
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
              marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Skin */}
      {tab === 'skin' && (
        <div>
          <ColorRow label="Accent color (buttons, hover)" value={c.accent_color} onChange={(v) => patch({ accent_color: v })} />
          <ColorRow label="Progress bar color" value={c.progress_color} onChange={(v) => patch({ progress_color: v })} />
          <ColorRow label="Controls background" value={c.background_color} onChange={(v) => patch({ background_color: v })} />

          <div style={{ marginTop: 16, padding: 14, background: '#0f0f0f', borderRadius: 10 }}>
            <div style={{ color: '#fff', fontSize: 11, marginBottom: 8, opacity: 0.6 }}>Preview</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{
                color: '#fff', background: c.accent_color,
                padding: '5px 12px', borderRadius: 16, fontSize: 12, fontWeight: 600,
              }}>Subscribe</span>
              <span style={{
                color: c.accent_color, fontSize: 18,
              }}>👍</span>
              <div style={{
                flex: 1, height: 4, background: 'rgba(255,255,255,0.2)',
                borderRadius: 2, position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', top: 0, left: 0, height: '100%', width: '42%',
                  background: c.progress_color, borderRadius: 2,
                }} />
              </div>
              <span style={{ color: '#fff', fontSize: 11 }}>4:32 / 10:18</span>
            </div>
          </div>
        </div>
      )}

      {/* Logo & Watermark */}
      {tab === 'logo' && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Logo URL</label>
            <input
              className="mf-input"
              value={c.logo_url ?? ''}
              onChange={(e) => patch({ logo_url: e.target.value || null })}
              placeholder="https://..."
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Logo position</label>
            <select
              className="mf-input"
              value={c.logo_position}
              onChange={(e) => patch({ logo_position: e.target.value as PlayerCustomization['logo_position'] })}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            >
              {LOGO_POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          <Slider
            label="Logo opacity"
            value={Math.round(c.logo_opacity * 100)}
            min={0} max={100} step={5} unit="%"
            onChange={(v) => patch({ logo_opacity: v / 100 })}
          />

          <div style={{ marginTop: 8 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Watermark text</label>
            <input
              className="mf-input"
              value={c.watermark_text ?? ''}
              onChange={(e) => patch({ watermark_text: e.target.value || null })}
              placeholder="e.g. @yourchannel"
              maxLength={100}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            />
          </div>
        </div>
      )}

      {/* Filters */}
      {tab === 'filters' && (
        <div>
          <div style={{ fontSize: 12, color: '#606060', marginBottom: 10 }}>Choose a preset or tune manually.</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {filterPresets.map((p) => {
              const active = c.filter_preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => patch({ filter_preset: p.id })}
                  className={`mf-audio-preset ${active ? 'active' : ''}`}
                  style={{
                    padding: '6px 12px', borderRadius: 14, fontSize: 12,
                    background: active ? '#e8f0fe' : '#f2f2f2',
                    color: active ? '#065fd4' : '#0f0f0f',
                    border: active ? '1.5px solid #065fd4' : '1.5px solid transparent',
                    cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 600 : 400,
                  }}
                >{p.label}</button>
              );
            })}
          </div>

          <Slider label="Brightness" value={c.brightness} min={0.5} max={1.5} step={0.05} onChange={(v) => patch({ filter_preset: 'custom', brightness: v })} />
          <Slider label="Contrast" value={c.contrast} min={0.5} max={1.5} step={0.05} onChange={(v) => patch({ filter_preset: 'custom', contrast: v })} />
          <Slider label="Saturation" value={c.saturation} min={0} max={2} step={0.05} onChange={(v) => patch({ filter_preset: 'custom', saturation: v })} />
          <Slider label="Hue rotation" value={Math.round(c.hue_rotate)} min={-180} max={180} step={5} unit="°" onChange={(v) => patch({ filter_preset: 'custom', hue_rotate: v })} />
          <Slider label="Sepia" value={Math.round(c.sepia * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => patch({ filter_preset: 'custom', sepia: v / 100 })} />
          <Slider label="Blur" value={c.blur} min={0} max={5} step={0.5} unit="px" onChange={(v) => patch({ filter_preset: 'custom', blur: v })} />

          <div style={{
            marginTop: 12, padding: 12, background: '#f8f8f8', borderRadius: 8,
            fontSize: 11, color: '#606060',
          }}>
            💡 Effects shown live in the player preview below.
          </div>
        </div>
      )}

      {/* Color Grading */}
      {tab === 'grading' && (
        <div>
          <div style={{ fontSize: 12, color: '#606060', marginBottom: 10 }}>
            Apply a color tint overlay on top of the video (subtle color grading).
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {gradingPresets.map((p) => {
              const active = c.color_grading_preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => patch({ color_grading_preset: p.id })}
                  style={{
                    padding: '6px 12px', borderRadius: 14, fontSize: 12,
                    background: active ? '#ede9fe' : '#f2f2f2',
                    color: active ? '#6d28d9' : '#0f0f0f',
                    border: active ? '1.5px solid #7c3aed' : '1.5px solid transparent',
                    cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 600 : 400,
                  }}
                >{p.label}</button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <ColorRow label="Tint R" value={`rgb(${c.tint_r},${c.tint_g},${c.tint_b})`} onChange={(v) => patch({ tint_r: parseInt(v.slice(4, v.indexOf(','))) || 255, color_grading_preset: 'custom' })} compact />
          </div>

          <Slider
            label="Tint R"
            value={c.tint_r} min={0} max={255} step={1}
            onChange={(v) => patch({ tint_r: v, color_grading_preset: 'custom' })}
          />
          <Slider
            label="Tint G"
            value={c.tint_g} min={0} max={255} step={1}
            onChange={(v) => patch({ tint_g: v, color_grading_preset: 'custom' })}
          />
          <Slider
            label="Tint B"
            value={c.tint_b} min={0} max={255} step={1}
            onChange={(v) => patch({ tint_b: v, color_grading_preset: 'custom' })}
          />
          <Slider
            label="Tint strength"
            value={Math.round(c.tint_alpha * 100)} min={0} max={50} step={1} unit="%"
            onChange={(v) => patch({ tint_alpha: v / 100, color_grading_preset: 'custom' })}
          />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16, gap: 10 }}>
        {busy && <span style={{ fontSize: 11, color: '#909090' }}>saving...</span>}
        <button
          type="button"
          className="mf-btn-text"
          onClick={handleReset}
          disabled={busy}
          style={{ color: '#dc2626', fontSize: 12 }}
        >Reset to defaults</button>
      </div>
    </div>
  );
}

function ColorRow({ label, value, onChange, compact }: {
  label: string; value: string; onChange: (v: string) => void; compact?: boolean;
}) {
  return (
    <div style={{ marginBottom: compact ? 0 : 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={value.startsWith('#') ? value : '#065fd4'}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 40, height: 28, border: '1px solid #e5e5e5', borderRadius: 4, cursor: 'pointer' }}
        />
        <input
          className="mf-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 100, padding: '4px 8px', fontSize: 12, fontFamily: 'monospace' }}
        />
      </div>
    </div>
  );
}
