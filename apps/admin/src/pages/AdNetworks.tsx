import { useEffect, useState } from 'react';
import {
  listAdNetworks, createAdNetwork, updateAdNetwork, deleteAdNetwork,
  listAds, createAd, updateAd, deleteAd,
  type AdNetwork, type Ad,
} from '../lib/api';

type Tab = 'networks' | 'internal';

const PRESETS = [
  { name: 'Google AdSense (IMA)', placeholder: 'https://pubads.g.doubleclick.net/gampad/ads?...', docs: 'https://support.google.com/adsense' },
  { name: 'Google Ad Manager', placeholder: 'https://pubads.g.doubleclick.net/gampad/ads?...', docs: 'https://admanager.google.com' },
  { name: 'Adsterra', placeholder: 'https://www.adsterra.com/vast/?...', docs: 'https://adsterra.com' },
  { name: 'Monetag', placeholder: 'https://monetag.com/vast/...', docs: 'https://monetag.com' },
  { name: 'Custom VAST', placeholder: 'https://your-network.com/vast.xml', docs: '' },
];

export default function AdNetworks() {
  const [tab, setTab] = useState<Tab>('networks');
  const [networks, setNetworks] = useState<AdNetwork[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Network form
  const [showNetForm, setShowNetForm] = useState(false);
  const [netName, setNetName] = useState('');
  const [netUrl, setNetUrl] = useState('');
  const [netType, setNetType] = useState<'pre-roll' | 'mid-roll' | 'post-roll'>('pre-roll');
  const [netPriority, setNetPriority] = useState(0);
  const [netWeight, setNetWeight] = useState(1);

  // Ad form
  const [showAdForm, setShowAdForm] = useState(false);
  const [adTitle, setAdTitle] = useState('');
  const [adVideoUrl, setAdVideoUrl] = useState('');
  const [adClickUrl, setAdClickUrl] = useState('');
  const [adType, setAdType] = useState<'pre-roll' | 'mid-roll' | 'post-roll'>('pre-roll');
  const [adDuration, setAdDuration] = useState(15);
  const [adSkip, setAdSkip] = useState(5);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [netRes, adRes] = await Promise.all([
        listAdNetworks().catch(() => ({ networks: [] })),
        listAds().catch(() => ({ ads: [] })),
      ]);
      setNetworks(netRes.networks);
      setAds(adRes.ads);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreateNetwork(e: React.FormEvent) {
    e.preventDefault();
    setBusy('new-net');
    setError('');
    try {
      await createAdNetwork({
        name: netName.trim(),
        vast_tag_url: netUrl.trim(),
        type: netType,
        priority: netPriority,
        weight: netWeight,
      });
      setNetName('');
      setNetUrl('');
      setNetPriority(0);
      setNetWeight(1);
      setShowNetForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function toggleNetworkActive(n: AdNetwork) {
    setBusy(n.id);
    try {
      await updateAdNetwork(n.id, { active: n.active ? 0 : 1 });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function handleDeleteNetwork(id: string, name: string) {
    if (!confirm(`Delete ad network "${name}"?`)) return;
    setBusy(id);
    try {
      await deleteAdNetwork(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function handleCreateAd(e: React.FormEvent) {
    e.preventDefault();
    setBusy('new-ad');
    setError('');
    try {
      await createAd({
        title: adTitle.trim(),
        video_url: adVideoUrl.trim(),
        click_url: adClickUrl.trim() || undefined,
        type: adType,
        duration_seconds: adDuration,
        skip_after_seconds: adSkip,
      });
      setAdTitle('');
      setAdVideoUrl('');
      setAdClickUrl('');
      setShowAdForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function toggleAdActive(a: Ad) {
    setBusy(a.id);
    try {
      await updateAd(a.id, { active: a.active ? 0 : 1 });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  async function handleDeleteAd(id: string, title: string) {
    if (!confirm(`Delete ad "${title}"?`)) return;
    setBusy(id);
    try {
      await deleteAd(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  function applyPreset(idx: number) {
    setNetName(PRESETS[idx].name);
    setShowNetForm(true);
    // Scroll to form
    setTimeout(() => document.getElementById('net-form')?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>
          Ads & Monetization
        </h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid #e5e5e5' }}>
        <button
          onClick={() => setTab('networks')}
          className={`mf-btn ${tab === 'networks' ? '' : 'mf-btn-secondary'}`}
        >
          🌐 Ad Networks ({networks.length})
        </button>
        <button
          onClick={() => setTab('internal')}
          className={`mf-btn ${tab === 'internal' ? '' : 'mf-btn-secondary'}`}
        >
          🎬 Internal Ads ({ads.length})
        </button>
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}

      {/* ============ AD NETWORKS TAB ============ */}
      {tab === 'networks' && (
        <>
          <div className="mf-card mf-mb-16" style={{ background: '#e7f3ff', borderColor: '#c2d9f5' }}>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <strong>ℹ️ How it works:</strong> Ad networks give you a <strong>VAST Tag URL</strong> from their dashboard.
              Paste that URL here and melodyflix will automatically show ads from the highest priority active network.
              {networks.length === 0 && (
                <div style={{ marginTop: 8 }}>
                  <strong>Quick add:</strong> {PRESETS.map((p, i) => (
                    <button
                      key={i}
                      onClick={() => applyPreset(i)}
                      style={{
                        marginRight: 6, marginTop: 4, padding: '4px 10px',
                        borderRadius: 12, border: '1px solid #065fd4',
                        background: '#fff', color: '#065fd4', fontSize: 12,
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      + {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mf-flex-between mf-mb-16">
            <h2 style={{ fontSize: 16 }}>Connected Networks</h2>
            <button className="mf-btn" onClick={() => setShowNetForm((v) => !v)}>
              {showNetForm ? 'Cancel' : '+ Add network'}
            </button>
          </div>

          {showNetForm && (
            <form
              id="net-form"
              onSubmit={handleCreateNetwork}
              className="mf-card mf-mb-16"
              style={{ background: '#fafbff' }}
            >
              <div className="mf-form-group">
                <label className="mf-label">Network name</label>
                <input
                  className="mf-input"
                  value={netName}
                  onChange={(e) => setNetName(e.target.value)}
                  placeholder="e.g. Adsterra, Monetag, Google AdSense"
                  required
                  maxLength={100}
                />
              </div>
              <div className="mf-form-group">
                <label className="mf-label">VAST Tag URL</label>
                <input
                  className="mf-input"
                  value={netUrl}
                  onChange={(e) => setNetUrl(e.target.value)}
                  placeholder="https://..."
                  required
                  type="url"
                />
                <div style={{ fontSize: 12, color: '#606060', marginTop: 4 }}>
                  Get this from your ad network dashboard. Must return VAST XML.
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="mf-form-group">
                  <label className="mf-label">Type</label>
                  <select className="mf-input" value={netType} onChange={(e) => setNetType(e.target.value as any)}>
                    <option value="pre-roll">Pre-roll (before video)</option>
                    <option value="mid-roll">Mid-roll (during video)</option>
                    <option value="post-roll">Post-roll (after video)</option>
                  </select>
                </div>
                <div className="mf-form-group">
                  <label className="mf-label">Priority (0-100)</label>
                  <input
                    className="mf-input"
                    type="number"
                    min={0}
                    max={100}
                    value={netPriority}
                    onChange={(e) => setNetPriority(Number(e.target.value))}
                  />
                </div>
                <div className="mf-form-group">
                  <label className="mf-label">Weight (1-100)</label>
                  <input
                    className="mf-input"
                    type="number"
                    min={1}
                    max={100}
                    value={netWeight}
                    onChange={(e) => setNetWeight(Number(e.target.value))}
                  />
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#606060', marginBottom: 12 }}>
                <strong>Priority</strong>: higher wins first. <strong>Weight</strong>: among same priority, higher weight is picked more often.
              </div>
              <button className="mf-btn" type="submit" disabled={busy === 'new-net'}>
                {busy === 'new-net' ? 'Adding...' : 'Add network'}
              </button>
            </form>
          )}

          {loading ? (
            <div className="mf-card">Loading...</div>
          ) : networks.length === 0 ? (
            <div className="mf-card" style={{ textAlign: 'center', padding: 40, color: '#606060' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🌐</div>
              No ad networks connected yet.<br />
              Add Google AdSense, Adsterra, Monetag, or any VAST-compatible network above.
            </div>
          ) : (
            <table className="mf-table">
              <thead>
                <tr>
                  <th>Network</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Weight</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {networks.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <strong>{n.name}</strong>
                      <div style={{ fontSize: 11, color: '#606060', marginTop: 2, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {n.vast_tag_url}
                      </div>
                    </td>
                    <td><span className="mf-badge mf-badge-info">{n.type}</span></td>
                    <td>{n.priority}</td>
                    <td>{n.weight}</td>
                    <td>
                      {n.active ? (
                        <span className="mf-badge mf-badge-success">Active</span>
                      ) : (
                        <span className="mf-badge">Paused</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="mf-btn mf-btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }}
                        disabled={busy === n.id}
                        onClick={() => toggleNetworkActive(n)}
                      >
                        {n.active ? 'Pause' : 'Activate'}
                      </button>
                      <button
                        className="mf-btn mf-btn-danger"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        disabled={busy === n.id}
                        onClick={() => handleDeleteNetwork(n.id, n.name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {/* ============ INTERNAL ADS TAB ============ */}
      {tab === 'internal' && (
        <>
          <div className="mf-card mf-mb-16" style={{ background: '#fffbea', borderColor: '#ffe8a3' }}>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>
              <strong>ℹ️ Internal Ads:</strong> Self-hosted ad videos you upload yourself.
              Used as a fallback if no external network is active, or if you prefer running your own ads.
            </div>
          </div>

          <div className="mf-flex-between mf-mb-16">
            <h2 style={{ fontSize: 16 }}>Your Ad Videos</h2>
            <button className="mf-btn" onClick={() => setShowAdForm((v) => !v)}>
              {showAdForm ? 'Cancel' : '+ Add ad'}
            </button>
          </div>

          {showAdForm && (
            <form onSubmit={handleCreateAd} className="mf-card mf-mb-16" style={{ background: '#fafbff' }}>
              <div className="mf-form-group">
                <label className="mf-label">Title</label>
                <input className="mf-input" value={adTitle} onChange={(e) => setAdTitle(e.target.value)} required maxLength={200} />
              </div>
              <div className="mf-form-group">
                <label className="mf-label">Video URL (direct mp4/webm)</label>
                <input className="mf-input" value={adVideoUrl} onChange={(e) => setAdVideoUrl(e.target.value)} required placeholder="https://..." />
              </div>
              <div className="mf-form-group">
                <label className="mf-label">Click URL (optional)</label>
                <input className="mf-input" value={adClickUrl} onChange={(e) => setAdClickUrl(e.target.value)} placeholder="https://advertiser.com" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="mf-form-group">
                  <label className="mf-label">Type</label>
                  <select className="mf-input" value={adType} onChange={(e) => setAdType(e.target.value as any)}>
                    <option value="pre-roll">Pre-roll</option>
                    <option value="mid-roll">Mid-roll</option>
                    <option value="post-roll">Post-roll</option>
                  </select>
                </div>
                <div className="mf-form-group">
                  <label className="mf-label">Duration (sec)</label>
                  <input className="mf-input" type="number" min={1} max={600} value={adDuration} onChange={(e) => setAdDuration(Number(e.target.value))} />
                </div>
                <div className="mf-form-group">
                  <label className="mf-label">Skip after (sec)</label>
                  <input className="mf-input" type="number" min={0} max={600} value={adSkip} onChange={(e) => setAdSkip(Number(e.target.value))} />
                </div>
              </div>
              <button className="mf-btn" type="submit" disabled={busy === 'new-ad'}>
                {busy === 'new-ad' ? 'Adding...' : 'Add ad'}
              </button>
            </form>
          )}

          {loading ? (
            <div className="mf-card">Loading...</div>
          ) : ads.length === 0 ? (
            <div className="mf-card" style={{ textAlign: 'center', padding: 40, color: '#606060' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🎬</div>
              No internal ads yet.
            </div>
          ) : (
            <table className="mf-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Duration</th>
                  <th>Impressions</th>
                  <th>Clicks</th>
                  <th>CTR</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {ads.map((a) => {
                  const ctr = a.impression_count > 0 ? ((a.click_count / a.impression_count) * 100).toFixed(2) : '0.00';
                  return (
                    <tr key={a.id}>
                      <td><strong>{a.title}</strong></td>
                      <td><span className="mf-badge mf-badge-info">{a.type}</span></td>
                      <td>{Math.round(a.duration_seconds)}s</td>
                      <td>{a.impression_count}</td>
                      <td>{a.click_count}</td>
                      <td>{ctr}%</td>
                      <td>
                        {a.active ? (
                          <span className="mf-badge mf-badge-success">Active</span>
                        ) : (
                          <span className="mf-badge">Paused</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="mf-btn mf-btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }}
                          disabled={busy === a.id}
                          onClick={() => toggleAdActive(a)}
                        >
                          {a.active ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          className="mf-btn mf-btn-danger"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          disabled={busy === a.id}
                          onClick={() => handleDeleteAd(a.id, a.title)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
