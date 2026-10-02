import { useEffect, useState } from 'react';
import {
  VR_PROJECTIONS, VR_STEREOS,
  getVideoVr, updateVideoVr, clearVideoVr,
  type VrMetadata, type VrProjection, type VrStereo,
} from '../lib/api';

interface Props {
  videoId: string;
  onToast?: (msg: string) => void;
}

export default function VrEditor({ videoId, onToast }: Props) {
  const [meta, setMeta] = useState<VrMetadata | null>(null);
  const [projection, setProjection] = useState<VrProjection>('none');
  const [stereo, setStereo] = useState<VrStereo>('mono');
  const [fov, setFov] = useState(75);
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [spatialAudio, setSpatialAudio] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await getVideoVr(videoId);
      setMeta(res.vr);
      setProjection(res.vr.projection);
      setStereo(res.vr.stereo);
      setFov(res.vr.fov);
      setYaw(res.vr.initial_yaw);
      setPitch(res.vr.initial_pitch);
      setSpatialAudio(res.vr.has_spatial_audio === 1);
    } catch {
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [videoId]);

  async function handleSave() {
    setBusy(true);
    try {
      const res = await updateVideoVr(videoId, {
        projection, stereo, fov,
        initial_yaw: yaw, initial_pitch: pitch,
        has_spatial_audio: spatialAudio,
      });
      setMeta(res.vr);
      onToast?.(projection === 'none' ? 'VR disabled' : 'VR metadata saved');
    } catch (err) {
      onToast?.((err as Error).message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!confirm('Reset VR metadata?')) return;
    setBusy(true);
    try {
      const res = await clearVideoVr(videoId);
      setMeta(res.vr);
      setProjection('none'); setStereo('mono');
      setFov(75); setYaw(0); setPitch(0); setSpatialAudio(false);
      onToast?.('VR metadata cleared');
    } catch (err) {
      onToast?.((err as Error).message || 'Clear failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div style={{ fontSize: 12, color: '#909090' }}>Loading VR info...</div>;

  const isVr = projection !== 'none';

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#606060', marginBottom: 10 }}>
        Mark this video as 360° / VR. Viewers get an immersive viewer with drag + device-orientation controls.
      </div>

      <div className="mf-form-group">
        <label className="mf-label">Projection</label>
        <select
          className="mf-input"
          value={projection}
          onChange={(e) => setProjection(e.target.value as VrProjection)}
          disabled={busy}
        >
          {VR_PROJECTIONS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
      </div>

      {isVr && (
        <>
          <div className="mf-form-group">
            <label className="mf-label">Stereo layout</label>
            <select
              className="mf-input"
              value={stereo}
              onChange={(e) => setStereo(e.target.value as VrStereo)}
              disabled={busy}
            >
              {VR_STEREOS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="mf-form-group">
            <label className="mf-label">Default FOV: {fov}°</label>
            <input
              type="range" min={30} max={120} step={5} value={fov}
              onChange={(e) => setFov(parseInt(e.target.value, 10))}
              disabled={busy}
              style={{ width: '100%', accentColor: '#065fd4' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div className="mf-form-group" style={{ flex: 1 }}>
              <label className="mf-label">Initial yaw: {Math.round(yaw)}°</label>
              <input
                type="range" min={0} max={360} step={5} value={yaw}
                onChange={(e) => setYaw(parseInt(e.target.value, 10))}
                disabled={busy}
                style={{ width: '100%', accentColor: '#065fd4' }}
              />
            </div>
            <div className="mf-form-group" style={{ flex: 1 }}>
              <label className="mf-label">Initial pitch: {Math.round(pitch)}°</label>
              <input
                type="range" min={-90} max={90} step={5} value={pitch}
                onChange={(e) => setPitch(parseInt(e.target.value, 10))}
                disabled={busy}
                style={{ width: '100%', accentColor: '#065fd4' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Spatial audio</div>
              <div style={{ fontSize: 11, color: '#909090' }}>Mark so viewers know to wear headphones</div>
            </div>
            <button
              type="button"
              onClick={() => setSpatialAudio((v) => !v)}
              disabled={busy}
              aria-pressed={spatialAudio}
              style={{
                width: 42, height: 24, borderRadius: 12, border: 'none',
                background: spatialAudio ? '#065fd4' : '#ccc',
                position: 'relative', cursor: 'pointer', padding: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: spatialAudio ? 21 : 3,
                width: 18, height: 18, borderRadius: '50%', background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }} />
            </button>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {meta && meta.projection !== 'none' && (
          <button
            type="button"
            className="mf-btn-text"
            onClick={handleClear}
            disabled={busy}
            style={{ color: '#dc2626', fontSize: 13 }}
          >Reset</button>
        )}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="mf-btn-text mf-btn-text-primary"
          onClick={handleSave}
          disabled={busy}
          style={{ fontSize: 13 }}
        >
          {busy ? 'Saving...' : '💾 Save VR settings'}
        </button>
      </div>
    </div>
  );
}
