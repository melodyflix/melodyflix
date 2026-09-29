import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getLiveStream, postLiveChat, listLiveChat,
  liveViewerWsUrl,
  getCachedUser, getToken,
  type LiveStream, type LiveChat,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function LiveWatch({ onSignIn }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = getCachedUser();

  const [stream, setStream] = useState<LiveStream | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const [chat, setChat] = useState<LiveChat[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [wsConnected, setWsConnected] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Load stream + initial chat
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const s = await getLiveStream(id);
        setStream(s);
        setViewerCount(s.viewer_count);

        const chatRes = await listLiveChat(id, 100);
        setChat(chatRes.chat);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Connect WS for chat
  useEffect(() => {
    if (!id) return;
    const token = getToken() ?? undefined;
    const url = liveViewerWsUrl(id, token);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'chat' && msg.chat) {
          setChat((prev) => [...prev, msg.chat]);
        } else if (msg.type === 'joined') {
          setViewerCount(msg.viewerCount ?? 0);
        }
      } catch {}
    };

    return () => {
      try { ws.close(); } catch {}
      wsRef.current = null;
    };
  }, [id]);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length]);

  // HLS playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream || stream.status !== 'live' || !id) return;

    const src = `/api/v1/live/${id}/hls/index.m3u8`;
    let hls: any = null;
    let cancelled = false;

    (async () => {
      if (video.canPlayType('application/vnd.apple.mpegurl') && !('MediaSource' in window)) {
        video.src = src;
        return;
      }
      const mod = await import('hls.js');
      const Hls = mod.default;
      if (!Hls.isSupported()) return;
      hls = new Hls({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 6,
        enableWorker: true,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (data.fatal && !cancelled) {
          // Retry once after delay
          setTimeout(() => {
            if (!cancelled && hls) {
              hls.loadSource(src);
            }
          }, 3000);
        }
      });
    })();

    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      hlsRef.current = null;
    };
  }, [stream?.id, stream?.status, id]);

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!me) { onSignIn(); return; }
    if (!chatInput.trim()) return;
    const content = chatInput.trim();
    setChatInput('');
    try {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'chat', content, username: me.username }));
      } else {
        // Fallback: HTTP
        await postLiveChat(id!, content);
        const r = await listLiveChat(id!, 100);
        setChat(r.chat);
      }
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function timeShort(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  if (loading) return <div className="mf-loading">Loading live stream...</div>;
  if (error) return <div className="mf-container"><div className="mf-error">{error}</div></div>;
  if (!stream) return <div className="mf-empty">Stream not found</div>;

  const isLive = stream.status === 'live';

  return (
    <div className="mf-container" style={{ maxWidth: 1400 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 380px',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        {/* Left: player + info */}
        <div>
          <div className="mf-player" style={{ background: '#000', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
            {isLive ? (
              <video
                ref={videoRef}
                controls
                autoPlay
                muted
                playsInline
                style={{ width: '100%', height: '100%', display: 'block' }}
              />
            ) : (
              <div className="mf-player-status">
                {stream.status === 'ended' ? 'Stream has ended' : 'Stream is offline'}
              </div>
            )}

            {isLive && (
              <div
                style={{
                  position: 'absolute', top: 12, left: 12,
                  background: '#dc2626', color: '#fff',
                  padding: '4px 10px', borderRadius: 4,
                  fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6,
                  zIndex: 10,
                }}
              >
                <span style={{ animation: 'mf-blink 1s infinite' }}>●</span> LIVE
              </div>
            )}
            {isLive && (
              <div
                style={{
                  position: 'absolute', top: 12, right: 12,
                  background: 'rgba(0,0,0,0.7)', color: '#fff',
                  padding: '4px 10px', borderRadius: 4,
                  fontSize: 12, fontWeight: 500,
                  zIndex: 10,
                }}
              >
                👁 {viewerCount}
              </div>
            )}
          </div>

          <h1 style={{ fontSize: 20, fontWeight: 600, margin: '16px 0 10px' }}>{stream.title}</h1>
          {stream.description && (
            <div className="mf-watch-desc" style={{ marginTop: 10 }}>{stream.description}</div>
          )}
        </div>

        {/* Right: chat */}
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 120px)',
            maxHeight: 700,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
              fontWeight: 600,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>💬 Live chat</span>
            <span style={{ fontSize: 12, color: wsConnected ? '#00a32a' : '#999' }}>
              {wsConnected ? '● connected' : '○ offline'}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {chat.length === 0 ? (
              <div style={{ color: '#606060', fontSize: 13, textAlign: 'center', marginTop: 30 }}>
                No messages yet — be the first!
              </div>
            ) : (
              chat.map((c) => (
                <div key={c.id} style={{ fontSize: 13 }}>
                  <span style={{ color: '#065fd4', fontWeight: 600 }}>{c.username}</span>
                  <span style={{ color: '#909090', fontSize: 11, marginLeft: 6 }}>{timeShort(c.created_at)}</span>
                  <div style={{ marginTop: 2, lineHeight: 1.4 }}>{c.content}</div>
                </div>
              ))
            )}
            <div ref={chatBottomRef} />
          </div>

          <form onSubmit={sendChat} style={{ padding: 12, borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
            <input
              className="mf-input"
              placeholder={me ? 'Say something...' : 'Sign in to chat'}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onClick={() => !me && onSignIn()}
              maxLength={500}
            />
            <button
              type="submit"
              className="mf-btn-primary"
              style={{ width: 'auto', padding: '8px 16px' }}
              disabled={!chatInput.trim()}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
