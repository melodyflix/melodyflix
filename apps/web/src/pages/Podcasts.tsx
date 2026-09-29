import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listPodcasts, formatDuration, timeAgo,
  type Video,
} from '../lib/api';

export default function Podcasts() {
  const navigate = useNavigate();
  const [podcasts, setPodcasts] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    listPodcasts(50, 0)
      .then((data) => {
        setPodcasts(data.podcasts);
        setTotal(data.total);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mf-container">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 40 }}>🎙️</div>
        <div>
          <h1 style={{ fontSize: 26, marginBottom: 4 }}>Podcasts</h1>
          <div style={{ color: '#606060', fontSize: 14 }}>
            {total} episode{total === 1 ? '' : 's'} · Listen anywhere
          </div>
        </div>
      </div>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading podcasts...</div>
      ) : podcasts.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🎙️</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No podcasts yet</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            Upload an audio file and mark it as Podcast when uploading
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 24,
          }}
        >
          {podcasts.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/watch/${p.id}`)}
              style={{ cursor: 'pointer' }}
            >
              {/* Cover art — square for podcast */}
              <div
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 55%, #ec4899 100%)',
                  borderRadius: 12,
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 16px rgba(124,58,237,0.25)',
                }}
              >
                {p.thumbnail_url ? (
                  <img
                    src={`/api/v1/videos/${p.id}/thumbnail.jpg`}
                    alt={p.title}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ fontSize: 60, color: '#fff', opacity: 0.9 }}>🎙️</div>
                )}
                <div
                  style={{
                    position: 'absolute',
                    bottom: 10,
                    right: 10,
                    background: 'rgba(0,0,0,0.75)',
                    color: '#fff',
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {formatDuration(p.duration_seconds)}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    lineHeight: 1.35,
                    marginBottom: 6,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {p.title}
                </div>
                <div style={{ fontSize: 12, color: '#606060' }}>
                  {timeAgo(p.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
