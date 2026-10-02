import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getVideosByPerson, roleLabel, roleEmoji, type VideoCredits } from '../lib/api';

export default function PersonView() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [videos, setVideos] = useState<VideoCredits[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!name) return;
    setLoading(true);
    setError('');
    getVideosByPerson(decodeURIComponent(name))
      .then((res) => setVideos(res.videos))
      .catch((err) => setError((err as Error).message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [name]);

  const displayName = name ? decodeURIComponent(name) : '';

  return (
    <div className="mf-page" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="mf-person-avatar">{displayName[0]?.toUpperCase() ?? '?'}</div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{displayName}</div>
          <div style={{ fontSize: 13, color: '#606060' }}>
            {loading ? '...' : `${videos.length} credit${videos.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#606060' }}>Loading...</div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>
      ) : videos.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#606060' }}>
          No videos found with this person.
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
                <img
                  src={v.thumbnail_url || `/api/v1/videos/${v.id}/thumbnail.jpg`}
                  alt={v.title}
                  loading="lazy"
                />
              </div>
              <div className="mf-video-meta">
                <div className="mf-video-title">{v.title}</div>
                <div className="mf-video-sub">
                  {roleEmoji(v.role)} {roleLabel(v.role)}
                  {v.character_name && ` as ${v.character_name}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
