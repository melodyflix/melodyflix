// melodyflix web — Sports Match Detail (Section 68)
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getSportsMatch, listSportsTimeline, listSportsTeams, listSportsReplays,
  SportsMatch, SportsTimelineEvent, SportsTeam, SportsReplayClip,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

const EVENT_ICON: Record<string, string> = {
  goal: '⚽', own_goal: '⚽', yellow_card: '🟨', red_card: '🟥',
  substitution: '🔄', penalty: '🎯', var: '📺',
  kickoff: '▶️', halftime: '⏸️', fulltime: '⏹️', info: 'ℹ️',
};

export default function SportsMatchDetail({ onSignIn: _onSignIn }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [match, setMatch] = useState<SportsMatch | null>(null);
  const [teams, setTeams] = useState<SportsTeam[]>([]);
  const [events, setEvents] = useState<SportsTimelineEvent[]>([]);
  const [replays, setReplays] = useState<SportsReplayClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [mRes, eRes, tRes, rRes] = await Promise.all([
          getSportsMatch(id),
          listSportsTimeline(id, 200).catch(() => ({ events: [], count: 0 })),
          listSportsTeams(200).catch(() => ({ teams: [], count: 0 })),
          listSportsReplays(id, 100).catch(() => ({ replays: [], count: 0 })),
        ]);
        if (cancelled) return;
        setMatch(mRes.match);
        setEvents(eRes.events);
        setTeams(tRes.teams);
        setReplays(rRes.replays);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load match');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const teamName = (tid: string | null) => tid ? (teams.find((t) => t.id === tid)?.name ?? '—') : '—';
  const teamShort = (tid: string) => teams.find((t) => t.id === tid)?.short_name ?? teamName(tid).slice(0, 3).toUpperCase();

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (loading) return <div style={{ padding: 40, color: '#666' }}>Loading match…</div>;
  if (error || !match) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: 'crimson' }}>{error ?? 'Match not found'}</p>
        <button onClick={() => navigate('/sports')} style={backBtn}>← Back to sports</button>
      </div>
    );
  }

  const isLive = match.status === 'live' || match.status === 'halftime';

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <button onClick={() => navigate('/sports')} style={backBtn}>← All matches</button>

      {/* Score header */}
      <div style={{
        marginTop: 12,
        padding: 24,
        background: isLive ? 'linear-gradient(135deg, #fff8f8, #ffeaea)' : '#fafafa',
        border: `1px solid ${isLive ? '#fdd' : '#eee'}`,
        borderRadius: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, fontSize: 12, color: '#666', marginBottom: 8 }}>
          {match.league && <span>{match.league}</span>}
          {match.venue && <span>· {match.venue}</span>}
          <span>· {fmtTime(match.start_ts)}</span>
        </div>

        {isLive && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <span style={{
              padding: '4px 10px', background: '#d00', color: '#fff', borderRadius: 12,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
            }}>
              ● LIVE{match.minute !== null ? ` ${match.minute}'` : ''}
            </span>
            {match.period && <span style={{ marginLeft: 8, fontSize: 11, color: '#d00' }}>{match.period}</span>}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 20 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{teamName(match.home_team_id)}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{teamShort(match.home_team_id)}</div>
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: 2 }}>
            {match.home_score} – {match.away_score}
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{teamName(match.away_team_id)}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{teamShort(match.away_team_id)}</div>
          </div>
        </div>

        {match.status === 'finished' && (
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: '#666' }}>Full time</div>
        )}
        {match.status === 'scheduled' && (
          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: '#666' }}>Scheduled</div>
        )}
      </div>

      {/* Timeline */}
      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>📋 Match Timeline</h2>
        {events.length === 0 && (
          <p style={{ fontSize: 13, color: '#888' }}>No events yet.</p>
        )}
        <div style={{ borderLeft: '2px solid #eee', paddingLeft: 16 }}>
          {events.map((e) => (
            <div key={e.id} style={{ display: 'flex', gap: 12, padding: '8px 0', position: 'relative' }}>
              <span style={{ fontSize: 18, width: 24 }}>{EVENT_ICON[e.event_type] ?? '•'}</span>
              <div style={{ minWidth: 40, fontSize: 12, color: '#666', fontWeight: 600 }}>
                {e.minute !== null ? `${e.minute}'` : '—'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  {e.player_name ?? e.event_type.replace(/_/g, ' ')}
                </div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  {e.team_id ? teamName(e.team_id) : ''}
                  {e.description ? ` · ${e.description}` : ''}
                  {e.player_out ? ` (for ${e.player_out})` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Replays */}
      {replays.length > 0 && (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>🎬 Saved Replays</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {replays.map((r) => (
              <div key={r.id} style={{ padding: 12, border: '1px solid #eee', borderRadius: 10, background: '#fafafa' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.label}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                  {r.duration_seconds}s · {new Date(r.start_ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const backBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid #ddd',
  background: '#fff', cursor: 'pointer', fontSize: 13,
};
