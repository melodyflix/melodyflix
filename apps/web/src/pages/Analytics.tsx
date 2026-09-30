import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getMyAnalytics, formatDuration, formatViews, timeAgo,
  getCachedUser,
  type User, type AnalyticsData,
} from '../lib/api';
import { LineChart, BarChart, StatCard } from '../components/charts/Charts';

interface Props {
  user: User | null;
  onSignIn: () => void;
}

function formatWatchTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return `${h}h ${mm}m`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return `${d}d ${hh}h`;
}

export default function Analytics({ user, onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await getMyAnalytics(days);
      setData(res);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('No channel')) {
        setError('NO_CHANNEL');
      } else {
        setError(msg);
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    load();
  }, [user, days]);

  if (!user) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to see your analytics</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="mf-loading">Loading analytics...</div>;

  if (error === 'NO_CHANNEL') {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">📺</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>You need a channel to see analytics</div>
          <button
            className="mf-btn-primary"
            style={{ width: 'auto', padding: '10px 24px' }}
            onClick={() => navigate('/channel/new')}
          >
            Create channel
          </button>
        </div>
      </div>
    );
  }

  if (error) return <div className="mf-container"><div className="mf-error">{error}</div></div>;
  if (!data) return null;

  const { overview, series, top, revenue, growth } = data;

  const viewPoints = series.map((p) => p.views);
  const likePoints = series.map((p) => p.likes);
  const commentPoints = series.map((p) => p.comments);
  const labels = series.map((p) => p.date);
  const totalSeriesViews = viewPoints.reduce((a, b) => a + b, 0);

  return (
    <div className="mf-container" style={{ maxWidth: 1280 }}>
      {/* Header */}
      <div className="mf-flex-between mf-mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, marginBottom: 4 }}>📊 Channel Analytics</h1>
          <div style={{ color: '#606060', fontSize: 13 }}>
            Last {days} days
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                padding: '6px 14px',
                borderRadius: 16,
                border: `1px solid ${days === d ? '#065fd4' : '#e5e5e5'}`,
                background: days === d ? '#065fd4' : '#fff',
                color: days === d ? '#fff' : '#0f0f0f',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'inherit',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard icon="👁️" label="Total Views" value={overview.total_views.toLocaleString()} hint={`+${totalSeriesViews} in ${days}d`} color="#7c3aed" />
        <StatCard icon="⏱️" label="Watch Time" value={formatWatchTime(overview.total_watch_time_seconds)} color="#065fd4" />
        <StatCard icon="👍" label="Likes" value={overview.total_likes.toLocaleString()} color="#00a32a" />
        <StatCard icon="💬" label="Comments" value={overview.total_comments.toLocaleString()} color="#dba617" />
        <StatCard icon="👥" label="Subscribers" value={overview.total_subscribers.toLocaleString()} color="#ec4899" />
        <StatCard icon="🎬" label="Videos" value={overview.total_videos} hint={`${overview.avg_views_per_video} avg views`} color="#909090" />
      </div>

      {/* Revenue section */}
      <div
        style={{
          background: 'linear-gradient(135deg, #f5f3ff 0%, #fdf2f8 100%)',
          borderRadius: 14,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>💰 Revenue (Last {days} days)</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: '#606060' }}>Total</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#7c3aed' }}>
              ৳{revenue.total.toFixed(2)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#606060' }}>Super Chat</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>৳{revenue.super_chat.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#606060' }}>Membership</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>৳{revenue.membership.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#606060' }}>Ads</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>৳{revenue.ads.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Views chart */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>👁️ Views over time</div>
        <LineChart data={viewPoints} labels={labels} color="#7c3aed" height={200} />
      </div>

      {/* Likes + Comments side by side */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>👍 Likes</div>
          <BarChart data={likePoints} labels={labels} color="#00a32a" height={140} />
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>💬 Comments</div>
          <BarChart data={commentPoints} labels={labels} color="#dba617" height={140} />
        </div>
      </div>

      {/* Top videos */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>🏆 Top performing videos</div>
        {top.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: '#606060' }}>
            No videos yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {top.map((v, i) => (
              <div
                key={v.id}
                onClick={() => navigate(`/watch/${v.id}`)}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: 10,
                  borderRadius: 8,
                  cursor: 'pointer',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f9f9f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontSize: 18, fontWeight: 700, color: '#909090', width: 24, textAlign: 'center' }}>
                  {i + 1}
                </div>
                <div
                  style={{
                    width: 100,
                    aspectRatio: '16 / 9',
                    background: '#e5e5e5',
                    borderRadius: 6,
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  {v.thumbnail_url && (
                    <img
                      src={`/api/v1/videos/${v.id}/thumbnail.jpg`}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      marginBottom: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {v.title}
                  </div>
                  <div style={{ fontSize: 12, color: '#606060' }}>
                    {formatViews(v.view_count)} · 👍 {v.like_count} · 💬 {v.comment_count} · {timeAgo(v.created_at)}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#909090' }}>
                  {formatDuration(v.duration_seconds)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
