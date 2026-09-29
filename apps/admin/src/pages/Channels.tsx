import { useEffect, useState } from 'react';
import {
  api, verifyChannel, unverifyChannel,
  type Channel,
} from '../lib/api';

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'verified' | 'unverified'>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listChannels();
      setChannels(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggleVerify(ch: Channel) {
    setBusy(ch.id);
    try {
      if (ch.is_verified) {
        await unverifyChannel(ch.id);
      } else {
        await verifyChannel(ch.id);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const filtered = filter === 'all'
    ? channels
    : filter === 'verified'
    ? channels.filter((c) => c.is_verified === 1)
    : channels.filter((c) => c.is_verified !== 1);

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>
          Channels <span className="mf-muted" style={{ fontSize: 14 }}>({channels.length})</span>
        </h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        {(['all', 'verified', 'unverified'] as const).map((f) => (
          <button
            key={f}
            className={`mf-btn ${filter === f ? '' : 'mf-btn-secondary'}`}
            onClick={() => setFilter(f)}
            style={{ textTransform: 'capitalize' }}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}

      {loading ? (
        <div className="mf-card">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="mf-card">No channels found.</div>
      ) : (
        <table className="mf-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Handle</th>
              <th>Subscribers</th>
              <th>Videos</th>
              <th>Status</th>
              <th>Created</th>
              <th style={{ width: 140 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.name}</strong>
                  {c.is_verified === 1 && (
                    <span
                      title="Verified"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginLeft: 6,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: '#065fd4',
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 700,
                        verticalAlign: 'middle',
                      }}
                    >
                      ✓
                    </span>
                  )}
                </td>
                <td><span className="mf-muted">@{c.handle}</span></td>
                <td>{c.subscriber_count}</td>
                <td>{c.video_count}</td>
                <td>
                  {c.is_verified === 1 ? (
                    <span className="mf-badge mf-badge-success">✓ Verified</span>
                  ) : (
                    <span className="mf-badge">Not verified</span>
                  )}
                </td>
                <td className="mf-muted">{new Date(c.created_at).toLocaleDateString()}</td>
                <td>
                  <button
                    className={`mf-btn ${c.is_verified ? 'mf-btn-secondary' : ''}`}
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    disabled={busy === c.id}
                    onClick={() => toggleVerify(c)}
                  >
                    {busy === c.id
                      ? '...'
                      : c.is_verified
                      ? 'Unverify'
                      : '✓ Verify'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
