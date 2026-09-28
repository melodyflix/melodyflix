import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { searchVideos, type Video, type SearchSort, type DurationFilter } from '../lib/api';
import VideoCard from '../components/VideoCard';

const SORTS: { key: SearchSort; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'date', label: 'Upload date' },
  { key: 'views', label: 'View count' },
];

const DURATIONS: { key: DurationFilter; label: string }[] = [
  { key: 'any', label: 'Any' },
  { key: 'short', label: 'Under 4 min' },
  { key: 'medium', label: '4–20 min' },
  { key: 'long', label: 'Over 20 min' },
];

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '7px 14px',
        fontSize: 13,
        fontWeight: 500,
        borderRadius: 18,
        border: `1px solid ${active ? '#065fd4' : '#d0d0d0'}`,
        background: active ? '#065fd4' : '#fff',
        color: active ? '#fff' : '#0f0f0f',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        width: 'auto',
        flexShrink: 0,
        transition: 'all 0.15s',
        lineHeight: 1.2,
      }}
    >
      {children}
    </button>
  );
}

export default function Search() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get('q') ?? '';
  const sortParam = (params.get('sort') as SearchSort) || 'relevance';
  const durationParam = (params.get('duration') as DurationFilter) || 'any';
  const channelParam = params.get('channel') ?? undefined;

  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    searchVideos({
      q,
      sort: sortParam,
      duration: durationParam,
      channel: channelParam,
    })
      .then((data) => {
        setVideos(data.videos);
        setTotal(data.total);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [q, sortParam, durationParam, channelParam]);

  function updateFilter(key: string, value: string) {
    const sp = new URLSearchParams(params);
    if (value === 'any' || value === 'relevance') {
      sp.delete(key);
    } else {
      sp.set(key, value);
    }
    navigate(`/search?${sp.toString()}`);
  }

  return (
    <div className="mf-container">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 20, marginBottom: 0 }}>
          {q ? (
            <>
              Search results for: <strong>{q}</strong>
              <span style={{ color: '#606060', fontSize: 14, marginLeft: 8, fontWeight: 400 }}>
                ({total} {total === 1 ? 'result' : 'results'})
              </span>
            </>
          ) : (
            <>
              All videos
              <span style={{ color: '#606060', fontSize: 14, marginLeft: 8, fontWeight: 400 }}>
                ({total})
              </span>
            </>
          )}
        </h1>
        <FilterChip active={showFilters} onClick={() => setShowFilters((v) => !v)}>
          ⚙ Filters {showFilters ? '▲' : '▼'}
        </FilterChip>
      </div>

      {showFilters && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#606060',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Sort by
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SORTS.map((s) => (
                <FilterChip
                  key={s.key}
                  active={sortParam === s.key}
                  onClick={() => updateFilter('sort', s.key)}
                >
                  {s.label}
                </FilterChip>
              ))}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#606060',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Duration
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DURATIONS.map((d) => (
                <FilterChip
                  key={d.key}
                  active={durationParam === d.key}
                  onClick={() => updateFilter('duration', d.key)}
                >
                  {d.label}
                </FilterChip>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Searching...</div>
      ) : videos.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🔍</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No videos found</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            Try a different search or clear filters
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
