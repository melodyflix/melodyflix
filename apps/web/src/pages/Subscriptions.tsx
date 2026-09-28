import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listMySubscriptions, getCachedUser, type Channel } from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function Subscriptions({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) { setLoading(false); return; }
    setLoading(true);
    setError('');
    listMySubscriptions()
      .then((data) => setChannels(data.channels))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (!me) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to see your subscriptions</div>
          <button
            className="mf-btn-primary"
            style={{ width: 'auto', padding: '10px 24px' }}
            onClick={onSignIn}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mf-container">
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Subscriptions</h1>
      <p style={{ color: '#606060', marginBottom: 24 }}>
        {channels.length} {channels.length === 1 ? 'channel' : 'channels'}
      </p>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading...</div>
      ) : channels.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">📭</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No subscriptions yet</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            Subscribe to channels to see them here
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 20,
          }}
        >
          {channels.map((ch) => (
            <div
              key={ch.id}
              onClick={() => navigate(`/channel/${ch.id}`)}
              style={{
                cursor: 'pointer',
                textAlign: 'center',
                padding: 20,
                borderRadius: 12,
              }}
              className="mf-sub-channel-card"
            >
              <div
                className="mf-video-avatar"
                style={{
                  width: 80,
                  height: 80,
                  fontSize: 32,
                  margin: '0 auto 12px',
                }}
              >
                {ch.name[0].toUpperCase()}
              </div>
              <div style={{ fontWeight: 500, fontSize: 15, marginBottom: 4 }}>
                {ch.name}
              </div>
              <div style={{ fontSize: 12, color: '#606060' }}>
                @{ch.handle}
              </div>
              <div style={{ fontSize: 12, color: '#606060' }}>
                {ch.subscriber_count} subscribers
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
