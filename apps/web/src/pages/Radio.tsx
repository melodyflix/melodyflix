// melodyflix web — Internet Radio list (Section 124)
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listRadioStations, listRadioGenres, RadioStation,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function Radio({ onSignIn: _onSignIn }: Props) {
  const navigate = useNavigate();
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [genres, setGenres] = useState<{ genre: string; count: number }[]>([]);
  const [selectedGenre, setSelectedGenre] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [sRes, gRes] = await Promise.all([
          listRadioStations({ limit: 300 }),
          listRadioGenres().catch(() => ({ genres: [] as { genre: string; count: number }[] })),
        ]);
        if (cancelled) return;
        setStations(sRes.stations);
        setGenres(gRes.genres);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stations.filter((s) => {
      if (selectedGenre && s.genre !== selectedGenre) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) ||
        (s.genre ?? '').toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q);
    });
  }, [stations, selectedGenre, search]);

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>🎙️ Internet Radio</h1>
        <p style={{ color: '#666', marginTop: 4 }}>
          {stations.length} station{stations.length === 1 ? '' : 's'} available
        </p>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Search stations…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8,
            fontSize: 14, minWidth: 240, flex: '0 1 320px',
          }}
        />
        <select
          value={selectedGenre}
          onChange={(e) => setSelectedGenre(e.target.value)}
          style={{ padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
        >
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g.genre} value={g.genre}>{g.genre} ({g.count})</option>
          ))}
        </select>
      </div>

      {loading && <p style={{ color: '#666' }}>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#888', border: '1px dashed #ddd', borderRadius: 12 }}>
          <p style={{ fontSize: 16 }}>No stations found.</p>
          <p style={{ fontSize: 13 }}>Try a different genre or search term.</p>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 16,
      }}>
        {filtered.map((st) => (
          <button
            key={st.id}
            onClick={() => navigate(`/radio/${st.id}`)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 8, padding: 14, background: '#fff', position: 'relative',
              border: '1px solid #eaeaea', borderRadius: 12, cursor: 'pointer',
              textAlign: 'left', transition: 'box-shadow .15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
          >
            <div style={{
              width: '100%', aspectRatio: '1/1', background: '#f5f0e8',
              borderRadius: 8, overflow: 'hidden', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {st.logo_url ? (
                <img src={st.logo_url} alt={st.name}
                  style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <span style={{ fontSize: 42 }}>🎵</span>
              )}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{st.name}</div>
            <div style={{ fontSize: 12, color: '#888', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {st.genre && <span style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>{st.genre}</span>}
              {st.country && <span>· {st.country}</span>}
              {st.bitrate_kbps && <span>· {st.bitrate_kbps}k</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
