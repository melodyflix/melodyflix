import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listWatchLater, getCachedUser, type Video } from '../lib/api';
import VideoCard from '../components/VideoCard';

interface Props {
  onSignIn: () => void;
}

export default function WatchLater({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) { setLoading(false); return; }
    setLoading(true);
    setError('');
    listWatchLater()
      .then((data) => setVideos(data.videos))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (!me) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to see your Watch Later</div>
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
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Watch Later</h1>
      <p style={{ color: '#606060', marginBottom: 24 }}>
        {videos.length} {videos.length === 1 ? 'video' : 'videos'} saved
      </p>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading...</div>
      ) : videos.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🔖</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No saved videos yet</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            Click the <strong>Save</strong> button on any video to add it here
          </div>
        </div>
      ) : (
        <div className="mf-grid">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} onClick={(id) => navigate(`/watch/${id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
