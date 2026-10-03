// melodyflix web — Live TV DVR (Section 40.4)
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listLiveTvRecordings, getLiveTvRecordingStats, scheduleLiveTvRecording,
  cancelLiveTvRecording, deleteLiveTvRecording,
  listLiveTvChannels,
  LiveTvRecording, RecordingStats, LiveTvChannel,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: '#0a7',
  recording: '#d00',
  completed: '#333',
  failed: 'crimson',
  cancelled: '#888',
};

export default function LiveTvRecordings({ onSignIn }: Props) {
  const navigate = useNavigate();
  const [recordings, setRecordings] = useState<LiveTvRecording[]>([]);
  const [stats, setStats] = useState<RecordingStats | null>(null);
  const [channels, setChannels] = useState<LiveTvChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // schedule form
  const [showForm, setShowForm] = useState(false);
  const [formChannel, setFormChannel] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formStop, setFormStop] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setLoading(true);
      const [recRes, statRes, chRes] = await Promise.all([
        listLiveTvRecordings({ limit: 200 }),
        getLiveTvRecordingStats().catch(() => null),
        listLiveTvChannels({ limit: 300 }).catch(() => ({ channels: [], count: 0 })),
      ]);
      setRecordings(recRes.recordings);
      setStats(statRes);
      setChannels(chRes.channels);
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to load';
      if (String(msg).toLowerCase().includes('unauth')) onSignIn();
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? '(unknown)';

  const fmtTime = (iso: string) => new Date(iso).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const fmtBytes = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const doSchedule = async () => {
    setFormError(null);
    if (!formChannel || !formStart || !formStop) {
      setFormError('Channel, start, and stop are required');
      return;
    }
    setBusy('schedule');
    try {
      await scheduleLiveTvRecording({
        channel_id: formChannel,
        title: formTitle || undefined,
        start_ts: new Date(formStart).toISOString(),
        stop_ts: new Date(formStop).toISOString(),
      });
      setFormChannel(''); setFormTitle(''); setFormStart(''); setFormStop('');
      setShowForm(false);
      await reload();
    } catch (e: any) {
      setFormError(e?.message ?? 'Schedule failed');
    } finally {
      setBusy(null);
    }
  };

  const doCancel = async (id: string) => {
    setBusy(id);
    try { await cancelLiveTvRecording(id); await reload(); }
    catch (e: any) { setError(e?.message ?? 'Cancel failed'); }
    finally { setBusy(null); }
  };

  const doDelete = async (id: string) => {
    if (!confirm('Delete this recording entry?')) return;
    setBusy(id);
    try { await deleteLiveTvRecording(id); await reload(); }
    catch (e: any) { setError(e?.message ?? 'Delete failed'); }
    finally { setBusy(null); }
  };

  const defaultStart = () => {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const defaultStop = () => {
    const d = new Date(Date.now() + 65 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <button onClick={() => navigate('/live-tv')} style={backBtn}>← Live TV</button>
          <h1 style={{ margin: '12px 0 4px', fontSize: 24, fontWeight: 700 }}>🔴 My DVR</h1>
          <p style={{ color: '#666', margin: 0, fontSize: 13 }}>Scheduled and past recordings</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); if (!showForm) { setFormStart(defaultStart()); setFormStop(defaultStop()); } }}
          style={{
            padding: '10px 20px', borderRadius: 10,
            background: showForm ? '#fff' : '#0a7',
            color: showForm ? '#333' : '#fff',
            border: showForm ? '1px solid #ddd' : 'none',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {showForm ? 'Cancel' : '+ Schedule recording'}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12, marginBottom: 20, padding: 16, border: '1px solid #eee', borderRadius: 12, background: '#fafafa',
        }}>
          <Stat label="Total" value={stats.total} />
          <Stat label="Scheduled" value={stats.scheduled} color={STATUS_COLORS.scheduled} />
          <Stat label="Recording" value={stats.recording} color={STATUS_COLORS.recording} />
          <Stat label="Completed" value={stats.completed} />
          <Stat label="Failed" value={stats.failed} color={STATUS_COLORS.failed} />
          <Stat label="Disk usage" value={fmtBytes(stats.total_bytes)} />
        </div>
      )}

      {/* Schedule form */}
      {showForm && (
        <div style={{ padding: 16, border: '1px solid #cde7d9', borderRadius: 12, background: '#f4fbf7', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>New scheduled recording</h3>
          {formError && <div style={{ padding: 8, background: '#fff0f0', color: 'crimson', fontSize: 13, borderRadius: 6, marginBottom: 12 }}>{formError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Channel</label>
              <select value={formChannel} onChange={(e) => setFormChannel(e.target.value)} style={inputStyle}>
                <option value="">Select…</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Title (optional)</label>
              <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Auto from channel" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Start</label>
              <input type="datetime-local" value={formStart} onChange={(e) => setFormStart(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Stop</label>
              <input type="datetime-local" value={formStop} onChange={(e) => setFormStop(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
            <button
              onClick={doSchedule}
              disabled={busy === 'schedule'}
              style={{
                padding: '10px 20px', borderRadius: 8, background: '#0a7', color: '#fff',
                border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {busy === 'schedule' ? 'Scheduling…' : 'Schedule'}
            </button>
            <span style={{ alignSelf: 'center', fontSize: 12, color: '#666' }}>
              Duration: 30 seconds to 4 hours
            </span>
          </div>
        </div>
      )}

      {loading && <p style={{ color: '#666' }}>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!loading && recordings.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#888', border: '1px dashed #ddd', borderRadius: 12 }}>
          <p style={{ fontSize: 16 }}>No recordings yet.</p>
          <p style={{ fontSize: 13 }}>Schedule a recording using the button above.</p>
        </div>
      )}

      {recordings.map((r) => (
        <div key={r.id} style={{
          padding: 14, border: '1px solid #eee', borderRadius: 10, marginBottom: 10,
          display: 'flex', gap: 12, alignItems: 'center',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: 4,
            background: STATUS_COLORS[r.status] ?? '#888',
            flexShrink: 0,
            animation: r.status === 'recording' ? 'pulse 1.5s infinite' : 'none',
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{r.title}</span>
              <span style={{ fontSize: 11, color: STATUS_COLORS[r.status], fontWeight: 700, textTransform: 'uppercase' }}>
                {r.status}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {channelName(r.channel_id)} · {fmtTime(r.start_ts)} → {fmtTime(r.stop_ts)}
              {r.status === 'completed' && r.file_size_bytes > 0 && ` · ${fmtBytes(r.file_size_bytes)}`}
            </div>
            {r.error_message && (
              <div style={{ fontSize: 12, color: 'crimson', marginTop: 2 }}>{r.error_message}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {r.status === 'scheduled' && (
              <button
                onClick={() => doCancel(r.id)}
                disabled={busy === r.id}
                style={actionBtn('#fff', '#333', '#ddd')}
              >
                Cancel
              </button>
            )}
            {(r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled') && (
              <button
                onClick={() => doDelete(r.id)}
                disabled={busy === r.id}
                style={actionBtn('#fff', 'crimson', '#f5c6c6')}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#1a1a1a', marginTop: 2 }}>{value}</div>
    </div>
  );
}

const backBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid #ddd',
  background: '#fff', cursor: 'pointer', fontSize: 13,
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, color: '#666', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13,
  background: '#fff', boxSizing: 'border-box',
};

function actionBtn(bg: string, color: string, border: string): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 6, background: bg, color,
    border: `1px solid ${border}`, fontSize: 12, cursor: 'pointer',
  };
}
