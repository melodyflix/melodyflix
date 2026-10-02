// melodyflix web — Live TV channel browse (Section 40.1, 40.6, 40.15)
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listLiveTvChannels, listLiveTvCategories,
  LiveTvChannel,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function LiveTV({ onSignIn: _onSignIn }: Props) {
  const navigate = useNavigate();

  const [channels, setChannels] = useState<LiveTvChannel[]>([]);
  const [categories, setCategories] = useState<{ category: string; count: number }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [chRes, catRes] = await Promise.all([
          listLiveTvChannels({ limit: 300 }),
          listLiveTvCategories().catch(() => ({ categories: [] as { category: string; count: number }[] })),
        ]);
        if (cancelled) return;
        setChannels(chRes.channels);
        setCategories(catRes.categories);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load channels');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return channels.filter((c) => {
      if (selectedCategory && c.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.tvg_name ?? '').toLowerCase().includes(q) ||
        (c.tvg_id ?? '').toLowerCase().includes(q)
      );
    });
  }, [channels, selectedCategory, search]);

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>📺 Live TV</h1>
        <p style={{ color: '#666', marginTop: 4 }}>
          {channels.length} channel{channels.length === 1 ? '' : 's'} available
        </p>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Search channels…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8,
            fontSize: 14, minWidth: 240, flex: '0 1 320px',
          }}
        />
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          style={{ padding: '10px 14px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.category} value={c.category}>
              {c.category} ({c.count})
            </option>
          ))}
        </select>
      </div>

      {loading && <p style={{ color: '#666' }}>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#888', border: '1px dashed #ddd', borderRadius: 12 }}>
          <p style={{ fontSize: 16 }}>No channels found.</p>
          <p style={{ fontSize: 13 }}>Try a different category or search term.</p>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 16,
      }}>
        {filtered.map((ch) => (
          <button
            key={ch.id}
            onClick={() => navigate(`/live-tv/${ch.id}`)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: 8, padding: 12, background: '#fff',
              border: '1px solid #eaeaea', borderRadius: 12, cursor: 'pointer',
              textAlign: 'left', transition: 'box-shadow .15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'none')}
          >
            <div style={{
              width: '100%', aspectRatio: '16/9', background: '#f3f3f3',
              borderRadius: 8, overflow: 'hidden', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {ch.logo_url ? (
                <img
                  src={ch.logo_url}
                  alt={ch.name}
                  style={{ maxWidth: '80%', maxHeight: '80%', objectFit: 'contain' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <span style={{ fontSize: 32, color: '#bbb' }}>📺</span>
              )}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{ch.name}</div>
            <div style={{ fontSize: 12, color: '#888', display: 'flex', gap: 8 }}>
              {ch.category && <span>{ch.category}</span>}
              {ch.country && <span>· {ch.country}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
