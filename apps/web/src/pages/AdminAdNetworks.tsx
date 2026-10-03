// melodyflix web — VAST Ad Networks admin (Section 51.13)
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adminListAdNetworks, adminCreateAdNetwork, adminUpdateAdNetwork,
  adminDeleteAdNetwork,
  AdNetwork, AdNetworkType,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

const TYPE_LABELS: Record<AdNetworkType, string> = {
  'pre-roll': 'Pre-Roll',
  'mid-roll': 'Mid-Roll',
  'post-roll': 'Post-Roll',
};

export default function AdminAdNetworks({ onSignIn }: Props) {
  const navigate = useNavigate();
  const [networks, setNetworks] = useState<AdNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [fName, setFName] = useState('');
  const [fUrl, setFUrl] = useState('');
  const [fType, setFType] = useState<AdNetworkType>('pre-roll');
  const [fWeight, setFWeight] = useState(1);
  const [fPriority, setFPriority] = useState(0);
  const [fError, setFError] = useState<string | null>(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await adminListAdNetworks();
      setNetworks(r.networks);
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to load';
      if (String(msg).toLowerCase().includes('unauth') || String(msg).toLowerCase().includes('admin')) {
        onSignIn();
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const doCreate = async () => {
    setFError(null);
    if (!fName.trim()) { setFError('Name required'); return; }
    if (!fUrl.trim() || !/^https?:\/\//i.test(fUrl)) {
      setFError('VAST tag URL must start with http(s)://');
      return;
    }
    setBusy('create');
    try {
      await adminCreateAdNetwork({
        name: fName.trim(),
        vast_tag_url: fUrl.trim(),
        type: fType,
        weight: fWeight,
        priority: fPriority,
      });
      setFName(''); setFUrl(''); setFType('pre-roll');
      setFWeight(1); setFPriority(0);
      setShowForm(false);
      await reload();
    } catch (e: any) {
      setFError(e?.message ?? 'Create failed');
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = async (n: AdNetwork) => {
    setBusy(n.id);
    try {
      await adminUpdateAdNetwork(n.id, { active: n.active ? 0 : 1 });
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  const doEditNumber = async (n: AdNetwork, field: 'weight' | 'priority') => {
    const cur = n[field];
    const input = prompt(`New ${field} (current: ${cur}):`, String(cur));
    if (input === null) return;
    const val = parseInt(input, 10);
    if (isNaN(val) || val < 0) { setError('Invalid number'); return; }
    setBusy(n.id);
    try {
      await adminUpdateAdNetwork(n.id, { [field]: val });
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (n: AdNetwork) => {
    if (!confirm(`Delete ad network "${n.name}"?`)) return;
    setBusy(n.id);
    try {
      await adminDeleteAdNetwork(n.id);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <button onClick={() => navigate('/admin/ads')} style={backBtn}>← Ad Management</button>
          <h1 style={{ margin: '12px 0 4px', fontSize: 24, fontWeight: 700 }}>📡 VAST Ad Networks</h1>
          <p style={{ color: '#666', margin: 0, fontSize: 13 }}>
            External ad network integrations (fallback when internal campaigns don't fill)
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            padding: '10px 20px', borderRadius: 10,
            background: showForm ? '#fff' : '#0a7',
            color: showForm ? '#333' : '#fff',
            border: showForm ? '1px solid #ddd' : 'none',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {showForm ? 'Cancel' : '+ Add network'}
        </button>
      </div>

      {error && (
        <div style={{
          padding: 12, background: '#fff0f0', border: '1px solid #f5c6c6',
          borderRadius: 8, color: 'crimson', fontSize: 13, marginBottom: 16,
        }}>{error}</div>
      )}

      {/* Create form */}
      {showForm && (
        <div style={{ padding: 16, border: '1px solid #cde7d9', borderRadius: 12, background: '#f4fbf7', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>New ad network</h3>
          {fError && (
            <div style={{
              padding: 8, background: '#fff0f0', color: 'crimson',
              fontSize: 13, borderRadius: 6, marginBottom: 12,
            }}>{fError}</div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Name</label>
              <input value={fName} onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Google Ad Manager" style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>VAST Tag URL</label>
              <input value={fUrl} onChange={(e) => setFUrl(e.target.value)}
                placeholder="https://pubads.g.doubleclick.net/gampad/ads?..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Break type</label>
              <select value={fType} onChange={(e) => setFType(e.target.value as AdNetworkType)} style={inputStyle}>
                <option value="pre-roll">Pre-Roll</option>
                <option value="mid-roll">Mid-Roll</option>
                <option value="post-roll">Post-Roll</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle}>Weight</label>
                <input type="number" min={1} max={100} value={fWeight}
                  onChange={(e) => setFWeight(parseInt(e.target.value) || 1)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Priority</label>
                <input type="number" min={0} max={1000} value={fPriority}
                  onChange={(e) => setFPriority(parseInt(e.target.value) || 0)} style={inputStyle} />
              </div>
            </div>
          </div>
          <button
            onClick={doCreate}
            disabled={busy === 'create'}
            style={{
              marginTop: 12, padding: '10px 20px', borderRadius: 8,
              background: '#0a7', color: '#fff', border: 'none',
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {busy === 'create' ? 'Creating…' : 'Create'}
          </button>
        </div>
      )}

      {loading && <p style={{ color: '#666' }}>Loading…</p>}

      {!loading && networks.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#888', border: '1px dashed #ddd', borderRadius: 12 }}>
          <p style={{ fontSize: 16 }}>No ad networks configured.</p>
          <p style={{ fontSize: 13 }}>Add a VAST tag URL to enable external ad fallback.</p>
        </div>
      )}

      {networks.map((n) => (
        <div key={n.id} style={{
          padding: 14, border: `1px solid ${n.active ? '#cde7d9' : '#eee'}`,
          background: n.active ? '#fff' : '#fafafa',
          borderRadius: 10, marginBottom: 10,
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{
              width: 10, height: 10, borderRadius: 5, marginTop: 6,
              background: n.active ? '#0a7' : '#ccc', flexShrink: 0,
              boxShadow: n.active ? '0 0 0 3px rgba(0,170,119,0.15)' : 'none',
            }} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14 }}>{n.name}</strong>
                <span style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: '#eef7ff', color: '#0a5fa7',
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3,
                }}>{TYPE_LABELS[n.type]}</span>
                {n.active === 0 && (
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 10,
                    background: '#f0f0f0', color: '#888',
                    fontWeight: 700, textTransform: 'uppercase',
                  }}>disabled</span>
                )}
              </div>
              <div style={{
                fontSize: 11, color: '#666', marginTop: 4,
                fontFamily: 'monospace', wordBreak: 'break-all',
              }}>
                {n.vast_tag_url.length > 100
                  ? n.vast_tag_url.slice(0, 100) + '…'
                  : n.vast_tag_url}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 6, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>Weight: <strong>{n.weight}</strong></span>
                <span>Priority: <strong>{n.priority}</strong></span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => toggleActive(n)} disabled={busy === n.id}
                style={actionBtn('#fff', n.active ? '#888' : '#0a7', n.active ? '#ddd' : '#0a7')}>
                {n.active ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => doEditNumber(n, 'weight')} disabled={busy === n.id}
                style={actionBtn('#fff', '#333', '#ddd')}>Weight</button>
              <button onClick={() => doEditNumber(n, 'priority')} disabled={busy === n.id}
                style={actionBtn('#fff', '#333', '#ddd')}>Priority</button>
              <button onClick={() => doDelete(n)} disabled={busy === n.id}
                style={actionBtn('#fff', 'crimson', '#f5c6c6')}>Delete</button>
            </div>
          </div>
        </div>
      ))}
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
  width: '100%', padding: '8px 10px', border: '1px solid #ddd',
  borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box',
};

function actionBtn(bg: string, color: string, border: string): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 6, background: bg, color,
    border: `1px solid ${border}`, fontSize: 12, cursor: 'pointer', fontWeight: 500,
  };
}
