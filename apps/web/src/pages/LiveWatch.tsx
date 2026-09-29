import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getLiveStream, postLiveChat, listLiveChat,
  liveViewerWsUrl,
  getChatUsage,
  getCachedUser, getToken,
  type LiveStream, type LiveChat, type ChatUsage,
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
  const [chatUsage, setChatUsage] = useState<ChatUsage | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showSuperChatModal, setShowSuperChatModal] = useState(false);
  const [pinnedChats, setPinnedChats] = useState<any[]>([]);

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

        try {
          const scRes = await listSuperChats(id, 20);
          if (scRes.pinned) setPinnedChats(scRes.pinned);
        } catch {}
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Fetch initial chat usage
  useEffect(() => {
    if (!me) return;
    getChatUsage().then(setChatUsage).catch(() => {});
  }, [me?.id]);

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
        } else if (msg.type === 'limit_reached') {
          if (msg.usage) setChatUsage(msg.usage);
          setShowLimitModal(true);
        } else if (msg.type === 'superchat' && msg.superchat) {
          setPinnedChats((prev) => [msg.superchat, ...prev].slice(0, 5));
        } else if (msg.type === 'usage_update') {
          if (msg.usage) setChatUsage(msg.usage);
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {me && chatUsage && (
                <span
                  title={`${chatUsage.free_remaining} free · ${chatUsage.paid_balance} paid`}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: chatUsage.requires_payment ? '#fef2f2' : '#e8f0fe',
                    color: chatUsage.requires_payment ? '#dc2626' : '#065fd4',
                    fontWeight: 600,
                  }}
                >
                  💬 {chatUsage.free_remaining + chatUsage.paid_balance}
                </span>
              )}
              <span style={{ fontSize: 12, color: wsConnected ? '#00a32a' : '#999' }}>
                {wsConnected ? '● connected' : '○ offline'}
              </span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

            {pinnedChats.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {pinnedChats.map((sc: any) => (
                  <div
                    key={sc.id}
                    style={{
                      background: sc.color,
                      color: '#fff',
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '2px solid ' + sc.color,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>💎 {sc.username}</span>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>৳{sc.amount}</span>
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.4 }}>{sc.content}</div>
                  </div>
                ))}
              </div>
            )}

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

          <form onSubmit={sendChat} style={{ padding: 12, borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8, flexDirection: 'column' }}>
            {me && chatUsage && chatUsage.requires_payment && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 12,
                  color: '#991b1b',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>Free messages শেষ। এখন paid messages: {chatUsage.paid_balance}</span>
                <button
                  type="button"
                  onClick={() => setShowLimitModal(true)}
                  style={{
                    background: '#dc2626', color: '#fff', border: 'none',
                    padding: '4px 10px', borderRadius: 6, fontSize: 12,
                    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                  }}
                >
                  Buy
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="mf-input"
                placeholder={me ? 'Say something...' : 'Sign in to chat'}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onClick={() => !me && onSignIn()}
                maxLength={500}
                disabled={!!(me && chatUsage && chatUsage.requires_payment)}
              />
              <button
                type="submit"
                className="mf-btn-primary"
                style={{ width: 'auto', padding: '8px 16px' }}
                disabled={!chatInput.trim() || !!(me && chatUsage && chatUsage.requires_payment)}
              >
                Send
              </button>
              <button
                type="button"
                onClick={() => me ? setShowSuperChatModal(true) : onSignIn()}
                title="Send Super Chat"
                style={{
                  background: '#7c3aed',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                💎 Super
              </button>
            </div>
          </form>
        </div>
      </div>
      {showSuperChatModal && id && (
        <SuperChatModal
          streamId={id}
          onClose={() => setShowSuperChatModal(false)}
          onSignIn={onSignIn}
          onSent={(sc) => {
            setPinnedChats((prev) => [sc, ...prev].slice(0, 5));
          }}
        />
      )}

      {showLimitModal && chatUsage && (
        <div
          onClick={() => setShowLimitModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 14, padding: 28,
              width: '100%', maxWidth: 420, textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 50, marginBottom: 10 }}>💬</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              Message limit reached
            </div>
            <div style={{ fontSize: 14, color: '#606060', lineHeight: 1.6, marginBottom: 20 }}>
              আপনি আপনার {chatUsage.free_limit}টি free message ব্যবহার করেছেন।
              আরও message পাঠাতে হলে একটি pack কিনুন।
            </div>

            <div
              style={{
                background: '#f5f3ff', padding: 16, borderRadius: 10,
                marginBottom: 16, display: 'flex', justifyContent: 'space-between',
                fontSize: 15, fontWeight: 600,
              }}
            >
              <span>{chatUsage.pack_size} messages</span>
              <span style={{ color: '#7c3aed' }}>৳{chatUsage.pack_price}</span>
            </div>

            {chatUsage.paid_balance > 0 && (
              <div
                style={{
                  background: '#d1fadf', padding: 10, borderRadius: 8,
                  marginBottom: 12, fontSize: 13, color: '#054f31',
                }}
              >
                আপনার কাছে এখন {chatUsage.paid_balance}টি paid message আছে।
              </div>
            )}

            <button
              className="mf-btn-primary"
              style={{ width: '100%', padding: 12, marginBottom: 8 }}
              onClick={() => { setShowLimitModal(false); navigate('/buy-messages'); }}
            >
              Buy message pack →
            </button>
            <button
              className="mf-btn-secondary"
              style={{ width: '100%' }}
              onClick={() => setShowLimitModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
