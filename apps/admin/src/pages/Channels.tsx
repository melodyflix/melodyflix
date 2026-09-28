import { useEffect, useState } from 'react';
import { api, type Channel } from '../lib/api';

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>Channels</h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}

      {loading ? (
        <div className="mf-card">Loading...</div>
      ) : channels.length === 0 ? (
        <div className="mf-card">কোনো চ্যানেল নেই।</div>
      ) : (
        <table className="mf-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Handle</th>
              <th>Subscribers</th>
              <th>Videos</th>
              <th>Verified</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong></td>
                <td><span className="mf-muted">@{c.handle}</span></td>
                <td>{c.subscriber_count}</td>
                <td>{c.video_count}</td>
                <td>
                  {c.is_verified ? (
                    <span className="mf-badge mf-badge-success">✓ Verified</span>
                  ) : (
                    <span className="mf-badge">Not verified</span>
                  )}
                </td>
                <td className="mf-muted">{new Date(c.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
