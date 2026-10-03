// melodyflix web — Sports Streaming (Section 68)
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listSportsMatches, listLiveSportsMatches,
  listSportsTeams, SportsMatch, SportsTeam,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Upcoming',
  live: 'LIVE',
  halftime: 'HT',
  finished: 'Final',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<string, string> = {
  scheduled: '#666',
  live: '#d00',
  halftime: '#e77',
  finished: '#333',
  postponed: '#888',
  cancelled: '#888',
};

export default function Sports({ onSignIn: _onSignIn }: Props) {
  const navigate = useNavigate();
  const [liveMatches, setLiveMatches] = useState<SportsMatch[]>([]);
  const [upcoming, setUpcoming] = useState<SportsMatch[]>([]);
  const [finished, setFinished] = useState<SportsMatch[]>([]);
  const [teams, setTeams] = useState<SportsTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [liveRes, upRes, finRes, teamsRes] = await Promise.all([
          listLiveSportsMatches().catch(() => ({ matches: [], count: 0 })),
          listSportsMatches({ status: 'scheduled', limit: 50 }).catch(() => ({ matches: [], count: 0 })),
          listSportsMatches({ status: 'finished', limit: 20 }).catch(() => ({ matches: [], count: 0 })),
          listSportsTeams(200).catch(() => ({ teams: [], count: 0 })),
        ]);
        if (cancelled) return;
        setLiveMatches(liveRes.matches);
        setUpcoming(upRes.matches);
        setFinished(finRes.matches);
        setTeams(teamsRes.teams);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '—';
  const teamShort = (id: string) => teams.find((t) => t.id === id)?.short_name ?? teamName(id).slice(0, 3).toUpperCase();

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>⚽ Sports Streaming</h1>
        <p style={{ color: '#666', marginTop: 4 }}>
          Live scores, match timelines, and instant replays
        </p>
      </header>

      {loading && <p style={{ color: '#666' }}>Loading…</p>}
      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {/* LIVE */}
      {!loading && liveMatches.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: '#d00', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
            LIVE now
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {liveMatches.map((m) => (
              <button
                key={m.id}
                onClick={() => navigate(`/sports/match/${m.id}`)}
                style={cardStyle('#fff8f8', '#fdd')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#d00', fontWeight: 700, marginBottom: 8 }}>
                  <span>{STATUS_LABELS[m.status]}</span>
                  {m.minute !== null && <span>{m.minute}'</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600 }}>{teamName(m.home_team_id)}</span>
                  <span style={{ fontSize: 20, fontWeight: 700 }}>{m.home_score}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{teamName(m.away_team_id)}</span>
                  <span style={{ fontSize: 20, fontWeight: 700 }}>{m.away_score}</span>
                </div>
                {m.league && <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{m.league}</div>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* UPCOMING */}
      {!loading && upcoming.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Upcoming</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {upcoming.map((m) => (
              <button
                key={m.id}
                onClick={() => navigate(`/sports/match/${m.id}`)}
                style={cardStyle('#fff', '#eaeaea')}
              >
                <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
                  {fmtTime(m.start_ts)}
                </div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{teamName(m.home_team_id)}</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>vs</div>
                <div style={{ fontWeight: 600 }}>{teamName(m.away_team_id)}</div>
                {m.league && <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{m.league}</div>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* FINISHED */}
      {!loading && finished.length > 0 && (
        <section>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Recently finished</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {finished.slice(0, 8).map((m) => (
              <button
                key={m.id}
                onClick={() => navigate(`/sports/match/${m.id}`)}
                style={cardStyle('#fafafa', '#eee')}
              >
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                  {STATUS_LABELS[m.status]} · {fmtTime(m.start_ts)}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span>{teamName(m.home_team_id)}</span>
                  <span style={{ fontWeight: 700 }}>{m.home_score}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{teamName(m.away_team_id)}</span>
                  <span style={{ fontWeight: 700 }}>{m.away_score}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && liveMatches.length === 0 && upcoming.length === 0 && finished.length === 0 && (
        <div style={{ padding: 60, textAlign: 'center', color: '#888', border: '1px dashed #ddd', borderRadius: 12 }}>
          <p style={{ fontSize: 16 }}>No matches yet.</p>
          <p style={{ fontSize: 13 }}>Check back soon for live scores.</p>
        </div>
      )}
    </div>
  );
}

function cardStyle(bg: string, border: string): React.CSSProperties {
  return {
    display: 'block',
    padding: 16,
    background: bg,
    border: `1px solid ${border}`,
    borderRadius: 12,
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'box-shadow .15s ease',
    color: 'inherit',
    font: 'inherit',
  };
}
