// melodyflix web — Catch-Up TV tab (Section 40.8)
import { useEffect, useState } from 'react';
import {
  getLiveTvCatchUp, getLiveTvCatchUpSummary,
  CatchUpEntry, CatchUpSummary,
} from '../lib/api';

interface Props {
  channelId: string;
}

export default function CatchUpTab({ channelId }: Props) {
  const [entries, setEntries] = useState<CatchUpEntry[]>([]);
  const [summary, setSummary] = useState<CatchUpSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'available'>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [eRes, sRes] = await Promise.all([
          getLiveTvCatchUp(channelId, { limit: 100 }),
          getLiveTvCatchUpSummary(channelId).catch(() => null),
        ]);
        if (cancelled) return;
        setEntries(eRes.entries);
        setSummary(sRes);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load catch-up');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  const filtered = filter === 'available'
    ? entries.filter((e) => e.available)
    : entries;

  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const fmtDuration = (s: number) => {
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  if (loading) {
    return <div style={{ padding: 16, fontSize: 12, color: '#888' }}>Loading catch-up…</div>;
  }

  if (error) {
    return <div style={{ padding: 16, fontSize: 12, color: 'crimson' }}>{error}</div>;
  }

  return (
    <div>
      {summary && (
        <div style={{
          padding: 10, background: '#f7f4ff', border: '1px solid #e5dff5',
          borderRadius: 8, marginBottom: 12, fontSize: 12,
        }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <span style={{ color: '#666' }}>Programs: </span>
              <span style={{ fontWeight: 600 }}>{summary.program_count}</span>
            </div>
            <div>
              <span style={{ color: '#666' }}>With replay: </span>
              <span style={{ fontWeight: 600, color: '#7c5bff' }}>{summary.available_count}</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 6,
            background: filter === 'all' ? '#7c5bff' : '#fff',
            color: filter === 'all' ? '#fff' : '#333',
            border: `1px solid ${filter === 'all' ? '#7c5bff' : '#ddd'}`,
            cursor: 'pointer',
          }}
        >
          All ({entries.length})
        </button>
        <button
          onClick={() => setFilter('available')}
          style={{
            padding: '4px 10px', fontSize: 11, borderRadius: 6,
            background: filter === 'available' ? '#7c5bff' : '#fff',
            color: filter === 'available' ? '#fff' : '#333',
            border: `1px solid ${filter === 'available' ? '#7c5bff' : '#ddd'}`,
            cursor: 'pointer',
          }}
        >
          Replay available ({entries.filter((e) => e.available).length})
        </button>
      </div>

      {filtered.length === 0 && (
        <p style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: 20 }}>
          {filter === 'available'
            ? 'No replays available yet for these programs.'
            : 'No past programs found. Catch-up covers the last 7 days.'}
        </p>
      )}

      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {filtered.map((e) => (
          <div key={e.program_id} style={{
            padding: 10,
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 500,
                display: 'flex', gap: 6, alignItems: 'baseline',
              }}>
                <span style={{
                  whiteSpace: 'nowrap', overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {e.title}
                </span>
                {e.available && (
                  <span style={{
                    fontSize: 9, color: '#7c5bff', fontWeight: 700,
                    background: '#efe9ff', padding: '1px 5px', borderRadius: 4,
                    flexShrink: 0, textTransform: 'uppercase', letterSpacing: 0.3,
                  }}>
                    replay
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                {fmt(e.start_ts)} → {fmt(e.stop_ts)} · {fmtDuration(e.duration_seconds)}
                {e.category && ` · ${e.category}`}
              </div>
              {e.description && (
                <div style={{
                  fontSize: 11, color: '#666', marginTop: 4,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {e.description}
                </div>
              )}
            </div>
            {e.available && e.replay_url && (
              <a
                href={e.replay_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  padding: '4px 10px', fontSize: 11, borderRadius: 6,
                  background: '#7c5bff', color: '#fff', textDecoration: 'none',
                  fontWeight: 600, flexShrink: 0,
                }}
              >
                ▶ Play
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
