// melodyflix web — Radio Player (Section 124)
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getRadioStation, getRadioNowPlaying, listRadioHistory,
  getRadioHistoryStats, listRadioSchedule, getRadioScheduleNow,
  RadioStation, RadioTrackPlay, RadioScheduleSlot,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function RadioPlayer({ onSignIn: _onSignIn }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);

  const [station, setStation] = useState<RadioStation | null>(null);
  const [nowPlaying, setNowPlaying] = useState<RadioTrackPlay | null>(null);
  const [history, setHistory] = useState<RadioTrackPlay[]>([]);
  const [scheduleNow, setScheduleNow] = useState<{
    now: RadioScheduleSlot | null;
    next: RadioScheduleSlot | null;
  } | null>(null);
  const [stats, setStats] = useState<{
    total_plays: number;
    last_24h_plays: number;
    top_artists: { artist: string; count: number }[];
  } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [sRes, npRes, hRes, stRes, scRes] = await Promise.all([
          getRadioStation(id),
          getRadioNowPlaying(id).catch(() => ({ play: null })),
          listRadioHistory(id, { limit: 20 }).catch(() => ({ plays: [], count: 0 })),
          getRadioHistoryStats(id).catch(() => null),
          getRadioScheduleNow(id).catch(() => null),
        ]);
        if (cancelled) return;
        setStation(sRes.station);
        setNowPlaying(npRes.play);
        setHistory(hRes.plays);
        setStats(stRes);
        setScheduleNow(scRes);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Refresh "now playing" every 15s
  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => {
      getRadioNowPlaying(id).then((r) => setNowPlaying(r.play)).catch(() => {});
    }, 15_000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      a.play().then(() => setPlaying(true)).catch((e) => setError(e?.message ?? 'Play failed'));
    }
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const fmtMinute = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  if (loading) return <div style={{ padding: 40, color: '#666' }}>Loading station…</div>;
  if (error || !station) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: 'crimson' }}>{error ?? 'Station not found'}</p>
        <button onClick={() => navigate('/radio')} style={backBtn}>← Back to radio</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <button onClick={() => navigate('/radio')} style={backBtn}>← All stations</button>

      {/* Player card */}
      <div style={{
        marginTop: 12, padding: 24,
        background: 'linear-gradient(135deg, #f5f0e8, #efe5d5)',
        border: '1px solid #e8dcc8', borderRadius: 16,
      }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{
            width: 120, height: 120, background: '#fff',
            borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', flexShrink: 0,
          }}>
            {station.logo_url ? (
              <img src={station.logo_url} alt={station.name}
                style={{ maxWidth: '85%', maxHeight: '85%', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 56 }}>🎵</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{station.name}</h1>
            <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
              {station.genre && <span>{station.genre}</span>}
              {station.country && <span> · {station.country}</span>}
              {station.bitrate_kbps && <span> · {station.bitrate_kbps} kbps</span>}
            </div>
            {nowPlaying && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(255,255,255,0.7)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Now Playing</div>
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>
                  {nowPlaying.artist ? `${nowPlaying.artist} — ` : ''}{nowPlaying.title}
                </div>
                {nowPlaying.album && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{nowPlaying.album}</div>
                )}
              </div>
            )}
            {!nowPlaying && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>No track info yet.</div>
            )}

            {/* Controls */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              <button
                onClick={togglePlay}
                style={{
                  padding: '12px 24px', borderRadius: 24, border: 'none',
                  background: '#1a1a1a', color: '#fff', fontSize: 15, fontWeight: 600,
                  cursor: 'pointer', minWidth: 100,
                }}
              >
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#666' }}>
                <span>🔊</span>
                <input
                  type="range"
                  min="0" max="1" step="0.05"
                  value={volume}
                  onChange={(e) => setVolume(parseFloat(e.target.value))}
                  style={{ width: 100 }}
                />
                <span>{Math.round(volume * 100)}%</span>
              </div>
            </div>

            <audio ref={audioRef} src={station.stream_url} preload="none" />
          </div>
        </div>
      </div>

      {/* Schedule now/next */}
      {scheduleNow && (scheduleNow.now || scheduleNow.next) && (
        <section style={{ marginTop: 24, padding: 16, border: '1px solid #eee', borderRadius: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, marginBottom: 12 }}>📅 On Air Now</h2>
          {scheduleNow.now && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: '#0a7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>● Live</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{scheduleNow.now.title}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {fmtMinute(scheduleNow.now.start_minute)} — {fmtMinute(scheduleNow.now.start_minute + scheduleNow.now.duration_minutes)}
                {' · '}{scheduleNow.now.kind}
              </div>
            </div>
          )}
          {scheduleNow.next && (
            <div>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Up Next</div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{scheduleNow.next.title}</div>
              <div style={{ fontSize: 12, color: '#888' }}>
                {fmtMinute(scheduleNow.next.start_minute)} — {fmtMinute(scheduleNow.next.start_minute + scheduleNow.next.duration_minutes)}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Stats */}
      {stats && (
        <section style={{ marginTop: 24, padding: 16, border: '1px solid #eee', borderRadius: 12, background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Total plays</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.total_plays}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Last 24h</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.last_24h_plays}</div>
            </div>
            {stats.top_artists.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', marginBottom: 4 }}>Top artist</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{stats.top_artists[0].artist}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{stats.top_artists[0].count} plays</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* History */}
      {history.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, marginBottom: 12 }}>🎼 Recently played</h2>
          <div style={{ border: '1px solid #eee', borderRadius: 12 }}>
            {history.map((p, idx) => (
              <div key={p.id} style={{
                padding: '10px 14px',
                borderBottom: idx < history.length - 1 ? '1px solid #f0f0f0' : 'none',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.title}
                  </div>
                  <div style={{ fontSize: 12, color: '#888' }}>
                    {p.artist ?? 'Unknown artist'}{p.album ? ` · ${p.album}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#aaa', whiteSpace: 'nowrap' }}>
                  {fmtTime(p.played_at)}
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
