import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getVideosByGenre, genreLabel, formatViews, timeAgo, type Video } from '../lib/api';

export default function GenreView() {
  const { genre } = useParams<{ genre: string }>();
  const navigate = useNavigate();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!genre) return;
    setLoading(true);
    setError('');
    getVideosByGenre(genre, 60)
      .then((res) => setVideos(res.videos as Video[]))
      .catch((err) => setError((err as Error).message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [genre]);

  return (
    <div className="mf-page" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: 20 }}>
        <span className="mf-genre-badge-large">🎬 {genreLabel(genre ?? '')}</span>
        <span style={{ fontSize: 13, color: '#606060', marginLeft: 12 }}>
          {loading ? '...' : `${videos.length} video${videos.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#606060' }}>Loading...</div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>
      ) : videos.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#606060' }}>
          No videos in this genre yet.
        </div>
      ) : (
        <div className="mf-video-grid">
          {videos.map((v) => (
            <div
              key={v.id}
              className="mf-video-card"
              onClick={() => navigate(`/watch/${v.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <div className="mf-video-thumb">
                {v.status === 'ready' ? (
                  <img
                    src={v.thumbnail_url || `/api/v1/videos/${v.id}/thumbnail.jpg`}
                    alt={v.title}
                    loading="lazy"
                  />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: '#e5e5e5' }} />
                )}
              </div>
              <div className="mf-video-meta">
                <div className="mf-video-title">{v.title}</div>
                <div className="mf-video-sub">
                  {formatViews(v.view_count)} · {timeAgo(v.created_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
