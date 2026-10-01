import { useEffect, useRef, useState } from 'react';

export interface PlayerState {
  currentTime: number;
  playing: boolean;
  ended: boolean;
}

interface Props {
  src: string;
  poster?: string;
  startTime?: number;
  seekTo?: { time: number; nonce: number } | null;
  onStateChange?: (state: PlayerState) => void;
  onEnded?: () => void;
}

type QualityLevel = { index: number; height: number; bitrate: number };

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [10, 20, 30, 60, 120];

export default function HlsPlayer({ src, poster, startTime = 0, seekTo, onStateChange, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [error, setError] = useState('');
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [speed, setSpeed] = useState(1);
  const [showQuality, setShowQuality] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  const didSeekRef = useRef(false);

  // External seek (e.g. from chapters)
  useEffect(() => {
    if (seekTo == null) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seekTo.time;
    video.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTo?.nonce]);

  // Loop
  const [loop, setLoop] = useState(false);

  // A-B Repeat
  const [aPoint, setAPoint] = useState<number | null>(null);
  const [bPoint, setBPoint] = useState<number | null>(null);

  // Sleep timer
  const [sleepEndAt, setSleepEndAt] = useState<number | null>(null);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setError('');
    setLevels([]);
    setCurrentLevel(-1);
    didSeekRef.current = false;

    let hls: any = null;
    let cancelled = false;

    (async () => {
      if (video.canPlayType('application/vnd.apple.mpegurl') && !('MediaSource' in window)) {
        video.src = src;
        return;
      }

      const mod = await import('hls.js');
      const Hls = mod.default;
      if (!Hls.isSupported()) {
        setError('Your browser does not support HLS playback.');
        return;
      }

      hls = new Hls({ enableWorker: true, lowLatencyMode: false, capLevelToPlayerSize: false });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_evt: any, data: any) => {
        if (cancelled) return;
        const lvls: QualityLevel[] = (data.levels ?? []).map((l: any, i: number) => ({
          index: i,
          height: l.height ?? 0,
          bitrate: l.bitrate ?? 0,
        }));
        lvls.sort((a, b) => b.height - a.height);
        setLevels(lvls);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt: any, data: any) => {
        if (cancelled) return;
        if (hls.autoLevelEnabled) setCurrentLevel(-1);
        else setCurrentLevel(data.level);
      });

      hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
        if (data.fatal) setError(`Playback error: ${data.details}`);
      });
    })();

    const onLoadedMetadata = () => {
      if (cancelled) return;
      if (!didSeekRef.current && startTime > 1) {
        try {
          video.currentTime = startTime;
          didSeekRef.current = true;
        } catch {}
      }
    };
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      if (hls) hls.destroy();
      hlsRef.current = null;
    };
  }, [src]);

  // Report player state every second
  useEffect(() => {
    if (!onStateChange) return;
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v) return;
      onStateChange({
        currentTime: v.currentTime,
        playing: !v.paused && !v.ended,
        ended: v.ended,
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [onStateChange]);

  // Speed change
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  // Loop + A-B repeat handler
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onTimeUpdate() {
      if (!video) return;
      // A-B Repeat
      if (aPoint !== null && bPoint !== null && bPoint > aPoint) {
        if (video.currentTime >= bPoint) {
          video.currentTime = aPoint;
        }
      }
    }

    function onEnded() {
      if (!video) return;
      if (loop) {
        video.currentTime = 0;
        video.play().catch(() => {});
      } else {
        onEnded?.();
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('ended', onEnded);
    };
  }, [loop, aPoint, bPoint, onEnded]);

  // Sleep timer ticker
  useEffect(() => {
    if (!sleepEndAt) {
      setSleepRemaining(null);
      return;
    }
    const t = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((sleepEndAt - now) / 1000));
      setSleepRemaining(remaining);
      if (remaining <= 0) {
        const v = videoRef.current;
        if (v && !v.paused) v.pause();
        setSleepEndAt(null);
        setSleepRemaining(null);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [sleepEndAt]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      const video = videoRef.current;
      if (!video) return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          if (video.paused) video.play().catch(() => {});
          else video.pause();
          break;
        case 'm':
          video.muted = !video.muted;
          break;
        case 'f':
          if (!document.fullscreenElement) video.requestFullscreen?.().catch(() => {});
          else document.exitFullscreen?.().catch(() => {});
          break;
        case 'arrowleft':
          video.currentTime = Math.max(video.currentTime - 5, 0);
          break;
        case 'arrowright':
          video.currentTime = Math.min(video.currentTime + 5, video.duration || 0);
          break;
        case 'j':
          video.currentTime = Math.max(video.currentTime - 10, 0);
          break;
        case 'l':
          video.currentTime = Math.min(video.currentTime + 10, video.duration || 0);
          break;
        case 'arrowup':
          e.preventDefault();
          video.volume = Math.min(video.volume + 0.05, 1);
          break;
        case 'arrowdown':
          e.preventDefault();
          video.volume = Math.max(video.volume - 0.05, 0);
          break;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function selectLevel(index: number) {
    const hls = hlsRef.current;
    if (hls) hls.currentLevel = index === -1 ? -1 : index;
    setCurrentLevel(index);
    setShowQuality(false);
  }

  function selectSpeed(s: number) {
    setSpeed(s);
    setShowSpeed(false);
  }

  async function togglePiP() {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    } catch {}
  }

  function markA() {
    const v = videoRef.current;
    if (!v) return;
    setAPoint(v.currentTime);
    // If B is before A, clear it
    if (bPoint !== null && bPoint <= v.currentTime) {
      setBPoint(null);
    }
  }

  function markB() {
    const v = videoRef.current;
    if (!v) return;
    if (aPoint === null) {
      setAPoint(v.currentTime);
      return;
    }
    if (v.currentTime > aPoint) {
      setBPoint(v.currentTime);
    } else {
      // If user marks B before A, swap
      setBPoint(aPoint);
      setAPoint(v.currentTime);
    }
  }

  function clearAB() {
    setAPoint(null);
    setBPoint(null);
  }

  function setSleep(minutes: number) {
    if (minutes === 0) {
      setSleepEndAt(null);
      setShowSleep(false);
      return;
    }
    setSleepEndAt(Date.now() + minutes * 60 * 1000);
    setShowSleep(false);
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  const currentLevelObj = levels.find((l) => l.index === currentLevel);
  const qualityLabel = currentLevel === -1
    ? 'Auto'
    : (currentLevelObj?.height ? `${currentLevelObj.height}p` : 'Auto');

  const abActive = aPoint !== null && bPoint !== null;

  return (
    <div className="mf-player">
      <video
        ref={videoRef}
        controls
        poster={poster}
        playsInline
        preload="metadata"
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {error && <div className="mf-player-status">⚠️ {error}</div>}

      {/* Top-right controls */}
      <div className="mf-player-controls">
        {/* Loop */}
        <button
          className="mf-player-btn"
          onClick={() => setLoop((v) => !v)}
          title={loop ? 'Loop on' : 'Loop off'}
          style={{ background: loop ? '#065fd4' : 'rgba(0,0,0,0.65)' }}
        >
          ♾
        </button>

        {/* A-B Repeat */}
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            className="mf-player-btn"
            onClick={markA}
            title="Set A point"
            style={{
              background: aPoint !== null ? '#dba617' : 'rgba(0,0,0,0.65)',
              minWidth: 28,
            }}
          >
            A
          </button>
          <button
            className="mf-player-btn"
            onClick={markB}
            title="Set B point"
            style={{
              background: bPoint !== null ? '#dba617' : 'rgba(0,0,0,0.65)',
              minWidth: 28,
            }}
          >
            B
          </button>
          {abActive && (
            <button
              className="mf-player-btn"
              onClick={clearAB}
              title="Clear A-B repeat"
              style={{ minWidth: 24, background: '#dc2626' }}
            >
              ×
            </button>
          )}
        </div>

        {/* Sleep Timer */}
        <div style={{ position: 'relative' }}>
          <button
            className="mf-player-btn"
            onClick={() => { setShowSleep((v) => !v); setShowQuality(false); setShowSpeed(false); }}
            title="Sleep timer"
            style={{ background: sleepRemaining ? '#065fd4' : 'rgba(0,0,0,0.65)' }}
          >
            {sleepRemaining ? `${Math.floor(sleepRemaining / 60)}m` : '⏰'}
          </button>
          {showSleep && (
            <div className="mf-player-menu" style={{ bottom: '100%', marginBottom: 6 }}>
              <div className="mf-player-menu-item" onClick={() => setSleep(0)} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                Off
              </div>
              {SLEEP_OPTIONS.map((m) => (
                <div
                  key={m}
                  className="mf-player-menu-item"
                  onClick={() => setSleep(m)}
                >
                  {m} minutes
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Speed */}
        <div style={{ position: 'relative' }}>
          <button
            className="mf-player-btn"
            onClick={() => { setShowSpeed((v) => !v); setShowQuality(false); setShowSleep(false); }}
            title="Playback speed"
          >
            {speed === 1 ? '1x' : `${speed}x`}
          </button>
          {showSpeed && (
            <div className="mf-player-menu" style={{ bottom: '100%', marginBottom: 6 }}>
              {SPEEDS.map((s) => (
                <div
                  key={s}
                  className={`mf-player-menu-item ${speed === s ? 'active' : ''}`}
                  onClick={() => selectSpeed(s)}
                >
                  {s === 1 ? 'Normal' : `${s}x`}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quality */}
        {levels.length > 1 && (
          <div style={{ position: 'relative' }}>
            <button
              className="mf-player-btn"
              onClick={() => { setShowQuality((v) => !v); setShowSpeed(false); setShowSleep(false); }}
              title="Quality"
            >
              {qualityLabel}
            </button>
            {showQuality && (
              <div className="mf-player-menu" style={{ bottom: '100%', marginBottom: 6 }}>
                <div
                  className={`mf-player-menu-item ${currentLevel === -1 ? 'active' : ''}`}
                  onClick={() => selectLevel(-1)}
                >
                  Auto
                </div>
                {levels.map((l) => (
                  <div
                    key={l.index}
                    className={`mf-player-menu-item ${currentLevel === l.index ? 'active' : ''}`}
                    onClick={() => selectLevel(l.index)}
                  >
                    {l.height}p
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PiP */}
        {'pictureInPictureEnabled' in document && (
          <button className="mf-player-btn" onClick={togglePiP} title="Picture-in-Picture">
            ⧉
          </button>
        )}
      </div>

      {/* Bottom-left: A-B indicator */}
      {abActive && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            left: 12,
            background: 'rgba(219,166,23,0.9)',
            color: '#000',
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            zIndex: 10,
          }}
        >
          🔁 A: {formatTime(aPoint!)} → B: {formatTime(bPoint!)}
        </div>
      )}

      {/* Bottom-right: Sleep indicator */}
      {sleepRemaining !== null && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            right: 12,
            background: 'rgba(6,95,212,0.9)',
            color: '#fff',
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            zIndex: 10,
          }}
        >
          ⏰ Pausing in {formatTime(sleepRemaining)}
        </div>
      )}
    </div>
  );
}
