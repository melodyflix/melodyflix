import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useVoiceSearch } from '../hooks/useVoiceSearch';
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

  // 5.6 Voice Search
  const voiceSearch = useVoiceSearch({
    lang: 'en-US',
    onFinal: (transcript) => {
      const t = transcript.trim();
      if (!t) return;
      const sp = new URLSearchParams(params);
      sp.set('q', t);
      navigate('/search?' + sp.toString());
    },
  });

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={voiceSearch.toggle}
            disabled={!voiceSearch.supported}
            title={
              !voiceSearch.supported
                ? 'Voice search not supported in this browser'
                : voiceSearch.listening
                  ? 'Stop listening'
                  : 'Voice search'
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              border: '1px solid ' + (voiceSearch.listening ? '#065fd4' : '#e0e0e0'),
              borderRadius: 999,
              background: voiceSearch.listening ? '#065fd4' : '#fff',
              color: voiceSearch.listening ? '#fff' : '#333',
              fontSize: 13,
              cursor: voiceSearch.supported ? 'pointer' : 'not-allowed',
              opacity: voiceSearch.supported ? 1 : 0.5,
              transition: 'all 0.15s',
            }}
          >
            <span>🎙️</span>
            <span>{voiceSearch.listening ? 'Listening…' : 'Voice'}</span>
          </button>
          <FilterChip active={showFilters} onClick={() => setShowFilters((v) => !v)}>
            ⚙ Filters {showFilters ? '▲' : '▼'}
          </FilterChip>
        </div>
      </div>

      {voiceSearch.listening && (
        <div style={{
          padding: '10px 14px',
          background: '#eef7ff',
          border: '1px solid #c9def0',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🎙️</span>
          <span style={{ color: '#0a5fa7' }}>
            {voiceSearch.interim || 'Listening… speak your search query'}
          </span>
        </div>
      )}

      {voiceSearch.error && voiceSearch.error !== 'aborted' && (
        <div style={{
          padding: '8px 12px',
          background: '#fff4e5',
          border: '1px solid #ffe0b2',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: 13,
          color: '#8a6d3b',
        }}>
          ⚠️ Voice search: {voiceSearch.error === 'not-allowed' ? 'microphone permission denied' : voiceSearch.error}
        </div>
      )}

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
