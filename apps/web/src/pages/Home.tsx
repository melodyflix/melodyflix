import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Video } from '../lib/api';
import VideoCard from '../components/VideoCard';

export default function Home() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setError('');
    api.listVideos(50, 0)
      .then((data) => setVideos(data.videos))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mf-container">
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Home</h1>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading videos...</div>
      ) : videos.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🎬</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No videos yet</div>
          <div style={{ fontSize: 14 }}>Be the first to upload!</div>
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
