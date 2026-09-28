import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listHistory, clearHistory, removeHistory, getCachedUser,
  formatDuration, formatViews, timeAgo,
  type HistoryVideo,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function History({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [videos, setVideos] = useState<HistoryVideo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await listHistory(100, 0);
      setVideos(res.videos);
      setTotal(res.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!me) { setLoading(false); return; }
    load();
  }, []);

  if (!me) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to see your watch history</div>
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

  async function handleClearAll() {
    if (!confirm('Clear all watch history? This cannot be undone.')) return;
    setClearing(true);
    try {
      await clearHistory();
      setVideos([]);
      setTotal(0);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setClearing(false);
    }
  }

  async function handleRemove(e: React.MouseEvent, videoId: string) {
    e.stopPropagation();
    try {
      await removeHistory(videoId);
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
      setTotal((t) => Math.max(t - 1, 0));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="mf-container" style={{ maxWidth: 1100 }}>
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
          Watch History
          <span style={{ color: '#606060', fontSize: 14, marginLeft: 10, fontWeight: 400 }}>
            ({total} {total === 1 ? 'video' : 'videos'})
          </span>
        </h1>
        {videos.length > 0 && (
          <button
            onClick={handleClearAll}
            disabled={clearing}
            style={{
              padding: '8px 16px',
              borderRadius: 18,
              border: '1px solid #e5e5e5',
              background: '#fff',
              color: '#dc2626',
              fontSize: 13,
              fontWeight: 500,
              cursor: clearing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: clearing ? 0.5 : 1,
            }}
          >
            🗑 Clear all history
          </button>
        )}
      </div>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading...</div>
      ) : videos.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">📺</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No watch history yet</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            Videos you watch will appear here
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {videos.map((v) => (
            <div
              key={v.id}
              onClick={() => navigate(`/watch/${v.id}`)}
              style={{
                display: 'flex',
                gap: 14,
                cursor: 'pointer',
                padding: 10,
                borderRadius: 12,
                alignItems: 'flex-start',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f2f2f2')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Thumbnail */}
              <div
                style={{
                  width: 200,
                  aspectRatio: '16 / 9',
                  background: '#e5e5e5',
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  position: 'relative',
                }}
              >
                {v.status === 'ready' ? (
                  <img
                    src={`/api/v1/videos/${v.id}/thumbnail.jpg`}
                    alt={v.title}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 28,
                      opacity: 0.4,
                    }}
                  >
                    🎬
                  </div>
                )}
                {v.duration_seconds > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 6,
                      right: 6,
                      background: 'rgba(0,0,0,0.8)',
                      color: '#fff',
                      fontSize: 11,
                      padding: '2px 5px',
                      borderRadius: 3,
                      fontWeight: 500,
                    }}
                  >
                    {formatDuration(v.duration_seconds)}
                  </div>
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    marginBottom: 6,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.35,
                  }}
                >
                  {v.title}
                </div>
                <div style={{ fontSize: 13, color: '#606060', marginBottom: 4 }}>
                  {formatViews(v.view_count)} · {timeAgo(v.created_at)}
                </div>
                <div style={{ fontSize: 12, color: '#909090' }}>
                  Watched {timeAgo(v.watched_at)}
                </div>
              </div>

              {/* Remove button */}
              <button
                onClick={(e) => handleRemove(e, v.id)}
                title="Remove from history"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 18,
                  cursor: 'pointer',
                  color: '#909090',
                  padding: 6,
                  flexShrink: 0,
                  alignSelf: 'flex-start',
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
