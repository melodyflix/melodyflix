import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, createLiveStream, updateLiveStream, deleteLiveStream, getLiveStream,
  liveBroadcastWsUrl,
  getCachedUser, getToken,
  type User, type LiveStream, type Channel,
} from '../lib/api';

interface Props {
  user: User | null;
  onSignIn: () => void;
}

type Phase = 'setup' | 'preview' | 'live' | 'ended';
type FacingMode = 'user' | 'environment';
type BroadcastMode = 'camera' | 'obs';

export default function GoLive({ user, onSignIn }: Props) {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('setup');
  const [broadcastMode, setBroadcastMode] = useState<BroadcastMode>('camera');
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [duration, setDuration] = useState(0);
  const [facingMode, setFacingMode] = useState<FacingMode>('user');
  const [switching, setSwitching] = useState(false);
  const [hasCam, setHasCam] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<number>(0);
  const [obsConnected, setObsConnected] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    api.getMyChannel()
      .then(setChannel)
      .catch(() => setChannel(null))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    return () => { stopBroadcast(); };
  }, []);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => {
      if (startedAtRef.current) {
        setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Poll live status in OBS mode
  useEffect(() => {
    if (broadcastMode !== 'obs' || !stream) return;
    const t = setInterval(async () => {
      try {
        const s = await getLiveStream(stream.id);
        setObsConnected(s.status === 'live');
        if (s.status === 'live' && phase === 'setup') {
          setPhase('live');
          startedAtRef.current = Date.now();
        }
        if (s.status === 'ended' && phase === 'live') {
          setPhase('ended');
        }
      } catch {}
    }, 4000);
    return () => clearInterval(t);
  }, [broadcastMode, stream?.id, phase]);

  // ============ Camera functions ============
  async function getCameraStream(facing: FacingMode): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: { ideal: facing },
      },
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
    });
  }

  async function enableCamera() {
    setError('');
    try {
      const s = await getCameraStream(facingMode);
      mediaStreamRef.current = s;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === 'videoinput');
        setAvailableCameras(cams.length);
      } catch {}
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.muted = true;
        videoRef.current.style.transform = facingMode === 'user' ? 'scaleX(-1)' : 'none';
        videoRef.current.play().catch(() => {});
      }
      setHasCam(true);
      setPhase('preview');
    } catch (err) {
      setError(`Camera/microphone access denied: ${(err as Error).message}`);
    }
  }

  async function switchCamera() {
    if (!mediaStreamRef.current || switching) return;
    const newFacing: FacingMode = facingMode === 'user' ? 'environment' : 'user';
    setSwitching(true);
    setError('');
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: { exact: newFacing },
        },
        audio: false,
      });
      const newTrack = fresh.getVideoTracks()[0];
      const cur = mediaStreamRef.current;
      for (const t of cur.getVideoTracks()) {
        cur.removeTrack(t);
        t.stop();
      }
      cur.addTrack(newTrack);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
        videoRef.current.srcObject = cur;
        videoRef.current.style.transform = newFacing === 'user' ? 'scaleX(-1)' : 'none';
        videoRef.current.play().catch(() => {});
      }
      setFacingMode(newFacing);
    } catch (err) {
      setError(`Could not switch camera: ${(err as Error).message}`);
    } finally {
      setSwitching(false);
    }
  }

  async function startBroadcast() {
    if (!channel || !mediaStreamRef.current) return;
    setError('');
    try {
      const newStream = await createLiveStream(
        channel.id,
        title.trim() || 'Live stream',
        description.trim() || undefined,
        category
      );
      setStream(newStream);

      const token = getToken() ?? '';
      const wsUrl = liveBroadcastWsUrl(newStream.stream_key, token);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'ready') {
            setPhase('live');
            startedAtRef.current = Date.now();
          } else if (msg.type === 'error') {
            setError(msg.message);
          }
        } catch {}
      };
      ws.onerror = () => setError('WebSocket connection error');
      ws.onclose = () => { if (phase === 'live') setPhase('ended'); };

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
        ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('WS failed')); }, { once: true });
      });

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';

      const recorder = new MediaRecorder(mediaStreamRef.current, {
        mimeType,
        videoBitsPerSecond: 800_000,
        audioBitsPerSecond: 96_000,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ev.data.arrayBuffer().then((buf) => { try { ws.send(buf); } catch {} });
        }
      };
      recorder.start(1000);
    } catch (err) {
      setError((err as Error).message);
      stopBroadcast();
    }
  }

  function stopBroadcast() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch {}
    }
    recorderRef.current = null;
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        wsRef.current.close();
      } catch {}
    }
    wsRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setHasCam(false);
  }

  // ============ OBS functions ============
  async function createObsStream() {
    if (!channel) return;
    setError('');
    try {
      const newStream = await createLiveStream(
        channel.id,
        title.trim() || 'Live stream (OBS)',
        description.trim() || undefined,
        category
      );
      setStream(newStream);
      setPhase('preview');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // ============ End / Reset ============
  async function endStream() {
    stopBroadcast();
    setPhase('ended');
    setObsConnected(false);
    if (stream) {
      try { await updateLiveStream(stream.id, {}); } catch {}
    }
  }

  async function deleteAndReset() {
    if (stream) {
      try { await deleteLiveStream(stream.id); } catch {}
    }
    setStream(null);
    setTitle('');
    setDescription('');
    setDuration(0);
    setFacingMode('user');
    setObsConnected(false);
    setPhase('setup');
  }

  function formatTime(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => alert('Copied!')).catch(() => alert('Failed to copy'));
  }

  // ============ Render ============
  if (!user) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to go live</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="mf-loading">Loading...</div>;

  if (!channel) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">📺</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>You need a channel to go live</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={() => navigate('/channel/new')}>
            Create channel
          </button>
        </div>
      </div>
    );
  }

  const rtmpUrl = `rtmp://${window.location.hostname}:1935/live`;

  return (
    <div className="mf-container" style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>
        {phase === 'live' && <span style={{ color: '#dc2626' }}>● </span>}
        {phase === 'setup' && 'Go Live'}
        {phase === 'preview' && (broadcastMode === 'camera' ? 'Ready to broadcast' : 'Waiting for OBS...')}
        {phase === 'live' && 'You are LIVE'}
        {phase === 'ended' && 'Stream ended'}
      </h1>

      {phase === 'setup' && (
        <p style={{ color: '#606060', marginBottom: 20 }}>
          Choose how you want to broadcast.
        </p>
      )}

      {error && <div className="mf-error">{error}</div>}

      {/* Mode tabs (only in setup) */}
      {phase === 'setup' && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 20,
            background: '#f2f2f2',
            padding: 4,
            borderRadius: 10,
          }}
        >
          <button
            onClick={() => setBroadcastMode('camera')}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 8,
              border: 'none',
              background: broadcastMode === 'camera' ? '#fff' : 'transparent',
              color: broadcastMode === 'camera' ? '#0f0f0f' : '#606060',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: broadcastMode === 'camera' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            📷 Camera
          </button>
          <button
            onClick={() => setBroadcastMode('obs')}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 8,
              border: 'none',
              background: broadcastMode === 'obs' ? '#fff' : 'transparent',
              color: broadcastMode === 'obs' ? '#0f0f0f' : '#606060',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxShadow: broadcastMode === 'obs' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            🎬 OBS / RTMP
          </button>
        </div>
      )}

      {/* Camera preview (only in camera mode) */}
      {broadcastMode === 'camera' && (
        <div
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            background: '#000',
            borderRadius: 12,
            overflow: 'hidden',
            position: 'relative',
            marginBottom: 20,
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: '100%',
              height: '100%',
              display: hasCam ? 'block' : 'none',
              objectFit: 'cover',
              transition: 'transform 0.2s',
            }}
          />
          {!hasCam && phase !== 'ended' && (
            <div
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', color: '#fff', gap: 12,
              }}
            >
              <div style={{ fontSize: 60, opacity: 0.5 }}>🎥</div>
              <div style={{ fontSize: 14, color: '#a0a0a0' }}>
                {phase === 'setup' ? 'Camera preview off' : 'Camera stopped'}
              </div>
            </div>
          )}
          {hasCam && (
            <button
              onClick={switchCamera}
              disabled={switching}
              title="Switch camera"
              style={{
                position: 'absolute', bottom: 12, right: 12,
                width: 46, height: 46, borderRadius: '50%',
                background: 'rgba(0,0,0,0.65)', border: '2px solid rgba(255,255,255,0.5)',
                color: '#fff', fontSize: 20, cursor: switching ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 10, backdropFilter: 'blur(4px)',
              }}
            >
              {switching ? '⟳' : '🔄'}
            </button>
          )}
          {hasCam && (
            <div
              style={{
                position: 'absolute', bottom: 20, left: 12,
                background: 'rgba(0,0,0,0.6)', color: '#fff',
                padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500, zIndex: 10,
              }}
            >
              {facingMode === 'user' ? '🤳 Front' : '📷 Back'}
              {availableCameras > 1 && ' · tap 🔄 to switch'}
            </div>
          )}
          {phase === 'live' && (
            <div
              style={{
                position: 'absolute', top: 12, left: 12,
                background: '#dc2626', color: '#fff',
                padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span>●</span> LIVE
            </div>
          )}
          {phase === 'live' && (
            <div
              style={{
                position: 'absolute', top: 12, right: 12,
                background: 'rgba(0,0,0,0.7)', color: '#fff',
                padding: '4px 10px', borderRadius: 4, fontSize: 12, fontWeight: 500,
              }}
            >
              ⏱ {formatTime(duration)}
            </div>
          )}
        </div>
      )}

      {/* Common: title + desc + category (only in setup) */}
      {phase === 'setup' && (
        <>
          <div className="mf-form-group">
            <label className="mf-label">Stream title</label>
            <input
              className="mf-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. My first live stream"
              maxLength={200}
            />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Description (optional)</label>
            <textarea
              className="mf-input"
              style={{ minHeight: 80 }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Category</label>
            <select className="mf-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="music">Music</option>
              <option value="gaming">Gaming</option>
              <option value="education">Education</option>
              <option value="technology">Technology</option>
              <option value="entertainment">Entertainment</option>
              <option value="sports">Sports</option>
              <option value="news">News</option>
              <option value="comedy">Comedy</option>
              <option value="other">Other</option>
            </select>
          </div>
        </>
      )}

      {/* Camera mode: enable camera button */}
      {phase === 'setup' && broadcastMode === 'camera' && (
        <button
          className="mf-btn-primary"
          style={{ width: '100%', padding: 12, fontSize: 15 }}
          onClick={enableCamera}
        >
          🎥 Enable camera & microphone
        </button>
      )}

      {/* OBS mode: setup instructions */}
      {phase === 'setup' && broadcastMode === 'obs' && (
        <button
          className="mf-btn-primary"
          style={{ width: '100%', padding: 12, fontSize: 15 }}
          onClick={createObsStream}
        >
          🔑 Generate RTMP credentials
        </button>
      )}

      {/* OBS mode: preview — show credentials */}
      {phase === 'preview' && broadcastMode === 'obs' && stream && (
        <>
          <div
            style={{
              background: '#1e1e1e', color: '#fff',
              borderRadius: 12, padding: 20, marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              {obsConnected ? <span style={{ color: '#22c55e' }}>●</span> : <span style={{ color: '#dba617' }}>●</span>}
              {obsConnected ? 'OBS Connected — You are LIVE!' : 'Waiting for OBS...'}
            </div>

            <div style={{ fontSize: 12, color: '#a0a0a0', marginBottom: 4 }}>Stream URL</div>
            <div
              style={{
                background: '#000', padding: '10px 14px', borderRadius: 6,
                fontFamily: 'monospace', fontSize: 13,
                marginBottom: 12, wordBreak: 'break-all',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}
            >
              <span>{rtmpUrl}</span>
              <button
                onClick={() => copyToClipboard(rtmpUrl)}
                style={{
                  background: '#333', border: 'none', color: '#fff',
                  padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, flexShrink: 0,
                }}
              >
                Copy
              </button>
            </div>

            <div style={{ fontSize: 12, color: '#a0a0a0', marginBottom: 4 }}>Stream Key</div>
            <div
              style={{
                background: '#000', padding: '10px 14px', borderRadius: 6,
                fontFamily: 'monospace', fontSize: 13,
                marginBottom: 12, wordBreak: 'break-all',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              }}
            >
              <span>{stream.stream_key}</span>
              <button
                onClick={() => copyToClipboard(stream.stream_key)}
                style={{
                  background: '#333', border: 'none', color: '#fff',
                  padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, flexShrink: 0,
                }}
              >
                Copy
              </button>
            </div>

            <div style={{ fontSize: 12, color: '#a0a0a0', lineHeight: 1.7 }}>
              <strong>OBS Setup:</strong><br />
              1. Open OBS → Settings → Stream<br />
              2. Service: <code>Custom...</code><br />
              3. Server: paste the Stream URL above<br />
              4. Stream Key: paste the Stream Key above<br />
              5. Click <strong>Start Streaming</strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="mf-btn-secondary"
              style={{ flex: 1, padding: 12 }}
              onClick={() => { stopBroadcast(); setPhase('setup'); }}
            >
              Cancel
            </button>
            <button
              className="mf-btn-primary"
              style={{ flex: 1, padding: 12, background: '#dc2626' }}
              onClick={endStream}
            >
              ■ End Stream
            </button>
          </div>
        </>
      )}

      {/* Camera mode: preview buttons */}
      {phase === 'preview' && broadcastMode === 'camera' && (
        <>
          <div style={{ background: '#e8f0fe', padding: 14, borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
            <strong>Ready:</strong> {title || '(no title)'}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="mf-btn-secondary"
              style={{ flex: 1, padding: 12 }}
              onClick={() => { stopBroadcast(); setPhase('setup'); }}
            >
              Cancel
            </button>
            <button
              className="mf-btn-primary"
              style={{ flex: 2, padding: 12, background: '#dc2626' }}
              onClick={startBroadcast}
            >
              🔴 Start Broadcasting
            </button>
          </div>
        </>
      )}

      {/* Live state */}
      {phase === 'live' && (
        <>
          <div
            style={{
              background: '#fef2f2', border: '1px solid #fecaca',
              padding: 14, borderRadius: 8, marginBottom: 16, fontSize: 13,
            }}
          >
            <strong style={{ color: '#dc2626' }}>● You are LIVE!</strong> Viewers can watch at{' '}
            <code>/live/{stream?.id}</code>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="mf-btn-secondary"
              style={{ flex: 1, padding: 12 }}
              onClick={() => stream && navigate(`/live/${stream.id}`)}
            >
              👁 View as viewer
            </button>
            <button
              className="mf-btn-primary"
              style={{ flex: 1, padding: 12, background: '#dc2626' }}
              onClick={endStream}
            >
              ■ End Stream
            </button>
          </div>
        </>
      )}

      {/* Ended state */}
      {phase === 'ended' && (
        <>
          <div style={{ background: '#f9f9f9', padding: 20, borderRadius: 8, textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>Stream ended</div>
            <div style={{ color: '#606060', fontSize: 13, marginTop: 4 }}>
              Duration: {formatTime(duration)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="mf-btn-secondary" style={{ flex: 1, padding: 12 }} onClick={deleteAndReset}>
              Create new stream
            </button>
            <button className="mf-btn-primary" style={{ flex: 1, padding: 12 }} onClick={() => navigate('/')}>
              Go home
            </button>
          </div>
        </>
      )}
    </div>
  );
}
