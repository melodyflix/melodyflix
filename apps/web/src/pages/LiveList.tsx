import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listLiveStreams, timeAgo, type LiveStream } from '../lib/api';

export default function LiveList() {
  const navigate = useNavigate();
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await listLiveStreams(50, 0);
      setStreams(res.streams);
      setTotal(res.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Refresh every 15s
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mf-container">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 0 }}>
          <span style={{ color: '#dc2626' }}>● </span>Live now
          <span style={{ color: '#606060', fontSize: 14, marginLeft: 10, fontWeight: 400 }}>
            ({total})
          </span>
        </h1>
        <button
          className="mf-btn-primary"
          style={{ width: 'auto', padding: '10px 20px' }}
          onClick={() => navigate('/go-live')}
        >
          🔴 Go Live
        </button>
      </div>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading live streams...</div>
      ) : streams.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">📺</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No one is live right now</div>
          <div style={{ fontSize: 14, color: '#606060', marginBottom: 20 }}>
            Be the first to start a live stream!
          </div>
          <button
            className="mf-btn-primary"
            style={{ width: 'auto', padding: '10px 24px' }}
            onClick={() => navigate('/go-live')}
          >
            Go Live
          </button>
        </div>
      ) : (
        <div className="mf-grid">
          {streams.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate(`/live/${s.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div
                style={{
                  width: '100%',
                  aspectRatio: '16 / 9',
                  background: 'linear-gradient(135deg, #1a1a1a 0%, #333 100%)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 48,
                }}
              >
                📡
                <div
                  style={{
                    position: 'absolute', top: 8, left: 8,
                    background: '#dc2626', color: '#fff',
                    padding: '3px 8px', borderRadius: 4,
                    fontSize: 11, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  ● LIVE
                </div>
                <div
                  style={{
                    position: 'absolute', bottom: 8, right: 8,
                    background: 'rgba(0,0,0,0.7)', color: '#fff',
                    padding: '2px 6px', borderRadius: 3,
                    fontSize: 11,
                  }}
                >
                  👁 {s.viewer_count}
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.35, marginBottom: 4 }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 12, color: '#606060' }}>
                  Started {s.started_at ? timeAgo(s.started_at) : 'recently'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
