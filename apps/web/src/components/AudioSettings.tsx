import { useEffect, useState } from 'react';
import type { AudioEngineSettings } from './useAudioEngine';

interface Props {
  settings: AudioEngineSettings;
  onChange: (patch: Partial<AudioEngineSettings>) => void;
  onClose: () => void;
  audioTracks?: { id: string; label: string; lang?: string }[];
  activeAudioTrack?: string;
  onSelectAudioTrack?: (id: string) => void;
}

const PRESETS: { id: string; label: string; settings: Partial<AudioEngineSettings> }[] = [
  { id: 'flat', label: 'Flat', settings: { bass: 0, mid: 0, treble: 0, enhancement: 0, noiseReduction: 0, normalization: false } },
  { id: 'music', label: 'Music', settings: { bass: 4, mid: 0, treble: 3, enhancement: 0.6, noiseReduction: 0.1, normalization: true } },
  { id: 'speech', label: 'Speech', settings: { bass: -2, mid: 3, treble: 2, enhancement: 0.4, noiseReduction: 0.7, normalization: true } },
  { id: 'night', label: 'Night', settings: { bass: 5, mid: -1, treble: 1, enhancement: 0.2, noiseReduction: 0.3, normalization: true, masterGain: 0.7 } },
  { id: 'bass', label: 'Bass Boost', settings: { bass: 8, mid: -1, treble: 0, enhancement: 0.3, noiseReduction: 0, normalization: true } },
  { id: 'vocal', label: 'Vocal', settings: { bass: -3, mid: 5, treble: 2, enhancement: 0.5, noiseReduction: 0.2, normalization: true } },
];

function Slider({
  label, value, min, max, step, onChange, unit,
}: {
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
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#065fd4' }}
      />
    </div>
  );
}

function Toggle({
  label, checked, onChange, hint,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: '#0f0f0f' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: '#909090', marginTop: 1 }}>{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        style={{
          width: 42, height: 24, borderRadius: 12, border: 'none',
          background: checked ? '#065fd4' : '#ccc', position: 'relative',
          cursor: 'pointer', padding: 0, transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 21 : 3,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </button>
    </div>
  );
}

export default function AudioSettings({
  settings, onChange, onClose, audioTracks, activeAudioTrack, onSelectAudioTrack,
}: Props) {
  const [tab, setTab] = useState<'eq' | 'enhance' | 'spatial' | 'tracks'>('eq');

  const hasTracks = audioTracks && audioTracks.length > 1;

  return (
    <div className="mf-audio-panel">
      <div className="mf-audio-header">
        <span style={{ fontSize: 14, fontWeight: 600 }}>🎚️ Audio Settings</span>
        <button className="mf-btn-text" onClick={onClose} style={{ fontSize: 14, padding: '0 6px' }}>✕</button>
      </div>

      <div className="mf-audio-tabs">
        <button
          className={`mf-audio-tab ${tab === 'eq' ? 'active' : ''}`}
          onClick={() => setTab('eq')}
        >🎵 EQ</button>
        <button
          className={`mf-audio-tab ${tab === 'enhance' ? 'active' : ''}`}
          onClick={() => setTab('enhance')}
        >✨ Enhance</button>
        <button
          className={`mf-audio-tab ${tab === 'spatial' ? 'active' : ''}`}
          onClick={() => setTab('spatial')}
        >🎧 Spatial</button>
        {hasTracks && (
          <button
            className={`mf-audio-tab ${tab === 'tracks' ? 'active' : ''}`}
            onClick={() => setTab('tracks')}
          >🎧 Tracks</button>
        )}
      </div>

      <div className="mf-audio-body">
        {tab === 'eq' && (
          <>
            {/* Presets */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: '#606060', marginBottom: 6, fontWeight: 500 }}>Presets</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className="mf-audio-preset"
                    onClick={() => onChange(p.settings)}
                  >{p.label}</button>
                ))}
              </div>
            </div>

            <Slider label="Bass" value={settings.bass ?? 0} min={-12} max={12} step={1} unit=" dB" onChange={(v) => onChange({ bass: v })} />
            <Slider label="Mid" value={settings.mid ?? 0} min={-12} max={12} step={1} unit=" dB" onChange={(v) => onChange({ mid: v })} />
            <Slider label="Treble" value={settings.treble ?? 0} min={-12} max={12} step={1} unit=" dB" onChange={(v) => onChange({ treble: v })} />
            <Slider label="Volume" value={Math.round((settings.masterGain ?? 1) * 100)} min={0} max={200} step={5} unit="%" onChange={(v) => onChange({ masterGain: v / 100 })} />
          </>
        )}

        {tab === 'enhance' && (
          <>
            <Slider
              label="Audio enhancement"
              value={Math.round((settings.enhancement ?? 0) * 100)}
              min={0} max={100} step={5} unit="%"
              onChange={(v) => onChange({ enhancement: v / 100 })}
            />
            <Slider
              label="Noise reduction"
              value={Math.round((settings.noiseReduction ?? 0) * 100)}
              min={0} max={100} step={5} unit="%"
              onChange={(v) => onChange({ noiseReduction: v / 100 })}
            />
            <Toggle
              label="Volume normalization"
              hint="Smooth out loud / quiet passages"
              checked={!!settings.normalization}
              onChange={(v) => onChange({ normalization: v })}
            />
            <Toggle
              label="Audio-only mode"
              hint="Hide video (audio still plays)"
              checked={!!settings.audioOnlyMode}
              onChange={(v) => onChange({ audioOnlyMode: v })}
            />
          </>
        )}

        {tab === 'spatial' && (
          <>
            <Toggle
              label="3D spatial audio"
              hint="Position sound in 3D space (HRTF panner)"
              checked={!!settings.spatialEnabled}
              onChange={(v) => onChange({ spatialEnabled: v })}
            />
            <Toggle
              label="Binaural (HRTF preview)"
              hint="Headphone-optimized spatial rendering"
              checked={!!settings.binauralEnabled}
              onChange={(v) => onChange({ binauralEnabled: v })}
            />

            <div style={{ borderTop: '1px solid #f0f0f0', margin: '12px 0', paddingTop: 12 }}>
              <div style={{ fontSize: 11, color: '#606060', marginBottom: 8, fontWeight: 500 }}>
                Position {settings.spatialEnabled ? '' : '(enable 3D to activate)'}
              </div>
              <Slider label="Left ← → Right" value={Math.round((settings.spatialX ?? 0) * 100)} min={-100} max={100} step={5} unit="%" onChange={(v) => onChange({ spatialX: v / 100 })} />
              <Slider label="Front ← → Back" value={Math.round((settings.spatialY ?? 0) * 100)} min={-100} max={100} step={5} unit="%" onChange={(v) => onChange({ spatialY: v / 100 })} />
              <Slider label="Below ← → Above" value={Math.round((settings.spatialZ ?? 0) * 100)} min={-100} max={100} step={5} unit="%" onChange={(v) => onChange({ spatialZ: v / 100 })} />
              <Slider label="Distance" value={Math.round((settings.spatialDistance ?? 1) * 100)} min={50} max={500} step={10} unit=" cm" onChange={(v) => onChange({ spatialDistance: v / 100 })} />
            </div>

            <div style={{ borderTop: '1px solid #f0f0f0', margin: '12px 0', paddingTop: 12 }}>
              <Slider
                label="Stereo width"
                value={Math.round((settings.stereoWidth ?? 1) * 100)}
                min={0} max={200} step={5} unit="%"
                onChange={(v) => onChange({ stereoWidth: v / 100 })}
              />
              <div style={{ fontSize: 11, color: '#909090', marginTop: -6, marginBottom: 10 }}>
                0% = mono, 100% = normal, 200% = extra wide
              </div>
            </div>

            {/* 45.12 Spatial QA Check */}
            <div style={{
              borderTop: '1px solid #f0f0f0', marginTop: 12, paddingTop: 12,
              background: settings.spatialQaOn ? '#f0fdf4' : 'transparent',
              borderRadius: 6, padding: settings.spatialQaOn ? 10 : 12,
              paddingTop: settings.spatialQaOn ? 10 : 12,
            }}>
              <Toggle
                label="Spatial quality check"
                hint="Analyze stereo balance & phase issues"
                checked={!!settings.spatialQaOn}
                onChange={(v) => onChange({ spatialQaOn: v })}
              />
              {settings.spatialQaOn && (
                <SpatialQaPanel settings={settings} />
              )}
            </div>
          </>
        )}

        {tab === 'tracks' && hasTracks && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {audioTracks!.map((t) => {
              const active = t.id === activeAudioTrack;
              return (
                <button
                  key={t.id}
                  className={`mf-audio-track ${active ? 'active' : ''}`}
                  onClick={() => onSelectAudioTrack?.(t.id)}
                >
                  <span>{active ? '✓ ' : ''}{t.label}</span>
                  {t.lang && <span style={{ fontSize: 11, color: '#909090' }}>{t.lang}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mf-audio-footer">
        <button
          className="mf-btn-text"
          onClick={() => onChange({
            bass: 0, mid: 0, treble: 0,
            enhancement: 0, noiseReduction: 0,
            normalization: false, masterGain: 1,
            audioOnlyMode: false,
          })}
          style={{ fontSize: 12, color: '#dc2626' }}
        >Reset all</button>
      </div>
    </div>
  );
}

/* ---------- 45.12 Spatial QA Panel ---------- */
function SpatialQaPanel({ settings }: { settings: AudioEngineSettings }) {
  const [status, setStatus] = useState<{ label: string; ok: boolean; hint: string }[]>([]);

  useEffect(() => {
    const s = [
      {
        label: 'Spatial engine',
        ok: !!settings.spatialEnabled,
        hint: settings.spatialEnabled ? 'HRTF panner active' : 'Enable 3D spatial to activate',
      },
      {
        label: 'Stereo balance',
        ok: Math.abs(settings.spatialX ?? 0) < 0.7,
        hint: Math.abs(settings.spatialX ?? 0) < 0.7 ? 'Balanced' : 'Sound pushed far to one side',
      },
      {
        label: 'Stereo width',
        ok: (settings.stereoWidth ?? 1) >= 0.5,
        hint: (settings.stereoWidth ?? 1) < 0.5 ? 'Too narrow — almost mono' : 'OK',
      },
      {
        label: 'Distance',
        ok: (settings.spatialDistance ?? 1) >= 0.5 && (settings.spatialDistance ?? 1) <= 4,
        hint: 'Recommended 0.5–4 m',
      },
      {
        label: 'Binaural preview',
        ok: !!settings.binauralEnabled,
        hint: settings.binauralEnabled ? 'Optimized for headphones' : 'Consider enabling for headphone listeners',
      },
      {
        label: 'Normalization',
        ok: !!settings.normalization,
        hint: settings.normalization ? 'Loudness smoothed' : 'Spatial effects may cause level jumps',
      },
    ];
    setStatus(s);
  }, [settings]);

  return (
    <div style={{ marginTop: 10, fontSize: 12 }}>
      {status.map((row, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
          <span style={{ color: row.ok ? '#16a34a' : '#d97706', fontWeight: 700 }}>
            {row.ok ? '✓' : '!'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, color: '#0f0f0f' }}>{row.label}</div>
            <div style={{ fontSize: 11, color: '#606060' }}>{row.hint}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

