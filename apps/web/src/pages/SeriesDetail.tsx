import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getSeries, createSeason, deleteSeason, deleteSeries,
  formatDuration, timeAgo, getCachedUser,
  type SeriesWithSeasons, type Episode,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function SeriesDetail({ onSignIn }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = getCachedUser();

  const [data, setData] = useState<SeriesWithSeasons | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeSeasonId, setActiveSeasonId] = useState<string | null>(null);
  const [showAddSeason, setShowAddSeason] = useState(false);
  const [newSeasonNum, setNewSeasonNum] = useState(1);
  const [newSeasonTitle, setNewSeasonTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await getSeries(id);
      setData(res);
      if (res.seasons.length > 0 && !activeSeasonId) {
        setActiveSeasonId(res.seasons[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  const isOwner = !!(me && data && data.series.channel_id && data.is_owner);

  async function handleAddSeason(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !newSeasonTitle || newSeasonNum < 1) return;
    setBusy(true);
    setError('');
    try {
      await createSeason(id, newSeasonNum, newSeasonTitle.trim());
      setNewSeasonTitle('');
      setShowAddSeason(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function handleDeleteSeason(seasonId: string, num: number) {
    if (!confirm(`Delete Season ${num} and all its episodes?`)) return;
    try {
      await deleteSeason(seasonId);
      await load();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleDeleteSeries() {
    if (!id || !data) return;
    if (!confirm(`Delete "${data.series.title}" and all its seasons/episodes?`)) return;
    try {
      await deleteSeries(id);
      navigate('/series');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  if (loading) return <div className="mf-loading">Loading...</div>;
  if (error) return <div className="mf-container"><div className="mf-error">{error}</div></div>;
  if (!data) return <div className="mf-empty">Series not found</div>;

  const { series, seasons } = data;
  const activeSeason = seasons.find((s) => s.id === activeSeasonId);

  return (
    <div className="mf-container" style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: 24,
          marginBottom: 28,
          flexWrap: 'wrap',
          padding: 24,
          borderRadius: 14,
          background: 'linear-gradient(135deg, #f5f3ff 0%, #faf5ff 100%)',
        }}
      >
        <div
          style={{
            width: 180,
            aspectRatio: '1 / 1',
            borderRadius: 12,
            background: 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 50%, #a855f7 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 64,
            color: '#fff',
            flexShrink: 0,
            boxShadow: '0 6px 24px rgba(124,58,237,0.3)',
          }}
        >
          📺
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div
            style={{
              fontSize: 12,
              color: '#7c3aed',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            {series.status} · {series.category}
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 700, marginBottom: 10, lineHeight: 1.2 }}>
            {series.title}
          </h1>
          {series.description && (
            <p style={{ fontSize: 14, color: '#606060', lineHeight: 1.6, marginBottom: 14 }}>
              {series.description}
            </p>
          )}
          <div style={{ fontSize: 13, color: '#606060', marginBottom: 16 }}>
            {series.total_seasons} season{series.total_seasons === 1 ? '' : 's'} · {series.total_episodes} episode{series.total_episodes === 1 ? '' : 's'}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {activeSeason && activeSeason.episodes.length > 0 && (
              <button
                className="mf-btn-primary"
                style={{ width: 'auto', padding: '10px 24px' }}
                onClick={() => navigate(`/watch/${activeSeason.episodes[0].video_id}`)}
              >
                ▶ Play first episode
              </button>
            )}
            {isOwner && (
              <button
                className="mf-btn-secondary"
                style={{ width: 'auto', padding: '10px 20px', background: '#fff', color: '#dc2626', borderColor: '#fecaca' }}
                onClick={handleDeleteSeries}
              >
                🗑 Delete series
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Season selector */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 12,
          marginBottom: 20,
          borderBottom: '1px solid #e5e5e5',
        }}
      >
        {seasons.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSeasonId(s.id)}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: 'transparent',
              color: activeSeasonId === s.id ? '#0f0f0f' : '#606060',
              fontWeight: 600,
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: 'pointer',
              borderBottom: activeSeasonId === s.id ? '3px solid #7c3aed' : '3px solid transparent',
              marginBottom: -13,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {s.title || `Season ${s.season_number}`}
          </button>
        ))}
        {isOwner && (
          <button
            onClick={() => {
              setShowAddSeason((v) => !v);
              setNewSeasonNum((seasons.length > 0 ? Math.max(...seasons.map((s) => s.season_number)) : 0) + 1);
            }}
            style={{
              padding: '10px 16px',
              border: '1px dashed #7c3aed',
              background: 'transparent',
              color: '#7c3aed',
              fontWeight: 600,
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
              borderRadius: 6,
              marginLeft: 4,
              whiteSpace: 'nowrap',
            }}
          >
            + Add season
          </button>
        )}
      </div>

      {/* Add season form */}
      {showAddSeason && isOwner && (
        <form
          onSubmit={handleAddSeason}
          style={{
            background: '#f9f5ff',
            border: '1px solid #e9d5ff',
            borderRadius: 10,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ width: 100 }}>
              <label className="mf-label">Season #</label>
              <input
                type="number"
                className="mf-input"
                min={1}
                max={100}
                value={newSeasonNum}
                onChange={(e) => setNewSeasonNum(Number(e.target.value))}
                required
              />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="mf-label">Season title</label>
              <input
                className="mf-input"
                placeholder="e.g. Season 1"
                value={newSeasonTitle}
                onChange={(e) => setNewSeasonTitle(e.target.value)}
                required
                maxLength={200}
                autoFocus
              />
            </div>
            <button
              className="mf-btn-primary"
              type="submit"
              disabled={busy || !newSeasonTitle.trim()}
              style={{ width: 'auto', padding: '10px 24px' }}
            >
              {busy ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      )}

      {/* Episodes list */}
      {!activeSeason || activeSeason.episodes.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🎬</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>
            {!activeSeason ? 'No seasons yet' : 'No episodes in this season'}
          </div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            {isOwner ? 'Add a season, then attach episodes' : 'Check back later'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activeSeason.episodes.map((ep) => (
            <div
              key={ep.id}
              onClick={() => navigate(`/watch/${ep.video_id}`)}
              style={{
                display: 'flex',
                gap: 14,
                padding: 12,
                borderRadius: 10,
                background: '#fff',
                border: '1px solid #f0f0f0',
                cursor: 'pointer',
                alignItems: 'flex-start',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#fafafa')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
            >
              <div
                style={{
                  width: 40,
                  fontSize: 18,
                  fontWeight: 600,
                  color: '#7c3aed',
                  textAlign: 'center',
                  paddingTop: 12,
                  flexShrink: 0,
                }}
              >
                {ep.episode_number}
              </div>
              <div
                style={{
                  width: 160,
                  aspectRatio: '16 / 9',
                  background: '#e5e5e5',
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  position: 'relative',
                }}
              >
                <img
                  src={`/api/v1/videos/${ep.video_id}/thumbnail.jpg`}
                  alt={ep.title}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, lineHeight: 1.35 }}>
                  {ep.title}
                </div>
                {ep.description && (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#606060',
                      lineHeight: 1.5,
                      marginBottom: 6,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {ep.description}
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#909090' }}>
                  {ep.air_date ? `Aired ${ep.air_date} · ` : ''}
                  {timeAgo(ep.created_at)}
                </div>
              </div>
              {isOwner && (
                <button
                  onClick={(e) => { e.stopPropagation(); /* future edit */ }}
                  title="Episode options"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 18,
                    cursor: 'pointer',
                    color: '#909090',
                    padding: 4,
                    flexShrink: 0,
                  }}
                >
                  ⋮
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
