// melodyflix web — Live TV watch page (Section 40.3, 40.10, 40.2)
// Raw <video> + hls.js + native Picture-in-Picture + EPG sidebar.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Hls from 'hls.js';
import {
  getLiveTvChannel, LiveTvChannel,
  getLiveTvEpg, getLiveTvNowPlaying, getLiveTvUpNext,
  LiveTvEpgEntry,
  switchLiveTvChannel, clearLiveTvState, updateLiveTvPosition,
} from '../lib/api';
import { usePictureInPicture } from '../hooks/usePictureInPicture';

interface Props {
  onSignIn: () => void;
}

export default function LiveTVWatch({ onSignIn: _onSignIn }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [channel, setChannel] = useState<LiveTvChannel | null>(null);
  const [now, setNow] = useState<LiveTvEpgEntry | null>(null);
  const [upNext, setUpNext] = useState<LiveTvEpgEntry[]>([]);
  const [epg, setEpg] = useState<LiveTvEpgEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const pip = usePictureInPicture(videoRef);

  // Load channel + EPG + register switch
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [chRes, nowRes, upRes, epgRes] = await Promise.all([
          getLiveTvChannel(id),
          getLiveTvNowPlaying(id).catch(() => ({ entry: null })),
          getLiveTvUpNext(id, 5).catch(() => ({ entries: [] })),
          getLiveTvEpg(id).catch(() => ({ entries: [], count: 0 })),
        ]);
        if (cancelled) return;
        setChannel(chRes.channel);
        setNow(nowRes.entry);
        setUpNext(upRes.entries);
        setEpg(epgRes.entries);

        // Register switch server-side (best-effort)
        switchLiveTvChannel(id, { device: 'web' }).catch(() => {});
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load channel');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Attach HLS (or native) to the video element
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !channel) return;

    const src = channel.stream_url;
    const isHls = /\.m3u8(\?|$)/i.test(src);

    if (!isHls) {
      // MP3 / direct — use native
      v.src = src;
      v.load();
      return;
    }

    if (v.canPlayType('application/vnd.apple.mpegurl') && !Hls.isSupported()) {
      // Safari native HLS
      v.src = src;
      v.load();
      return;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(v);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          // eslint-disable-next-line no-console
          console.warn('[HLS] fatal:', data.type, data.details);
        }
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
  }, [channel]);

  // Heartbeat: update position every 15s (best-effort)
  useEffect(() => {
    if (!channel) return;
    const t = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) {
        updateLiveTvPosition(v.currentTime).catch(() => {});
      }
    }, 15_000);
    return () => clearInterval(t);
  }, [channel]);

  // On unmount: clear server state
  useEffect(() => {
    return () => { clearLiveTvState().catch(() => {}); };
  }, []);

  const goBack = () => {
    clearLiveTvState().catch(() => {});
    navigate('/live-tv');
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return <div style={{ padding: 40, color: '#666' }}>Loading channel…</div>;
  }

  if (error || !channel) {
    return (
      <div style={{ padding: 40 }}>
        <p style={{ color: 'crimson' }}>{error ?? 'Channel not found'}</p>
        <button onClick={goBack} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>
          ← Back to channels
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <button
        onClick={goBack}
        style={{ marginBottom: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 }}
      >
        ← All channels
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
        {/* Left: player */}
        <div>
          <div style={{ position: 'relative', background: '#000', borderRadius: 12, overflow: 'hidden', aspectRatio: '16/9' }}>
            <video
              ref={videoRef}
              controls
              autoPlay
              playsInline
              disablePictureInPicture={false}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 12, marginTop: 12, alignItems: 'center' }}>
            {pip.supported && (
              <button
                onClick={() => { setSwitching(true); pip.toggle().finally(() => setSwitching(false)); }}
                disabled={switching}
                title={pip.active ? 'Exit Picture-in-Picture' : 'Enter Picture-in-Picture'}
                style={{
                  padding: '8px 14px', borderRadius: 8,
                  border: '1px solid #ddd',
                  background: pip.active ? '#e8f0ff' : '#fff',
                  cursor: switching ? 'wait' : 'pointer',
                  fontSize: 13, fontWeight: 500,
                }}
              >
                {pip.active ? '⤵ Exit PiP' : '⧉ Picture-in-Picture'}
              </button>
            )}
            {!pip.supported && (
              <span style={{ fontSize: 12, color: '#999' }}>PiP not supported by this browser</span>
            )}
            {pip.error && <span style={{ fontSize: 12, color: 'crimson' }}>{pip.error}</span>}
            <span style={{ fontSize: 12, color: '#888' }}>
              Stream: {channel.stream_url.length > 60 ? channel.stream_url.slice(0, 60) + '…' : channel.stream_url}
            </span>
          </div>

          {/* Channel info */}
          <div style={{ marginTop: 20, padding: 16, border: '1px solid #eee', borderRadius: 12 }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              {channel.logo_url && (
                <img src={channel.logo_url} alt="" style={{ width: 56, height: 56, objectFit: 'contain', borderRadius: 8, background: '#f3f3f3' }} />
              )}
              <div>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{channel.name}</h1>
                <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>
                  {channel.category && <span>{channel.category}</span>}
                  {channel.country && <span> · {channel.country}</span>}
                  {channel.language && <span> · {channel.language}</span>}
                </div>
              </div>
            </div>
            {channel.description && (
              <p style={{ marginTop: 12, fontSize: 14, color: '#555' }}>{channel.description}</p>
            )}
          </div>
        </div>

        {/* Right: EPG sidebar */}
        <aside style={{ border: '1px solid #eee', borderRadius: 12, padding: 16, background: '#fafafa' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>📅 Schedule</h2>

          {now && (
            <div style={{ padding: 12, background: '#fff', borderRadius: 10, border: '1px solid #e5e5e5', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#0a7', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>● Now Playing</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{now.title}</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                {fmtTime(now.start_ts)} – {fmtTime(now.stop_ts)}
              </div>
              {now.description && (
                <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>{now.description}</div>
              )}
            </div>
          )}

          {!now && (
            <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>No EPG data for this channel yet.</p>
          )}

          {upNext.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 8 }}>Up Next</div>
              {upNext.map((e) => (
                <div key={e.id} style={{ padding: 10, borderBottom: '1px solid #eee' }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{e.title}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{fmtTime(e.start_ts)} – {fmtTime(e.stop_ts)}</div>
                </div>
              ))}
            </>
          )}

          {epg.length > 0 && upNext.length === 0 && (
            <>
              <div style={{ fontSize: 11, color: '#666', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 8 }}>Today</div>
              {epg.slice(0, 10).map((e) => (
                <div key={e.id} style={{ padding: 8, borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: 13 }}>{e.title}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{fmtTime(e.start_ts)} – {fmtTime(e.stop_ts)}</div>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
