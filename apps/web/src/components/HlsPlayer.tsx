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
  onStateChange?: (state: PlayerState) => void;
}

type QualityLevel = { index: number; height: number; bitrate: number };

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export default function HlsPlayer({ src, poster, startTime = 0, onStateChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const [error, setError] = useState('');
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [speed, setSpeed] = useState(1);
  const [showQuality, setShowQuality] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const didSeekRef = useRef(false);

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

    // Seek to startTime once metadata loaded
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

  const currentLevelObj = levels.find((l) => l.index === currentLevel);
  const qualityLabel = currentLevel === -1
    ? 'Auto'
    : (currentLevelObj?.height ? `${currentLevelObj.height}p` : 'Auto');

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

      <div className="mf-player-controls">
        <div style={{ position: 'relative' }}>
          <button
            className="mf-player-btn"
            onClick={() => { setShowSpeed((v) => !v); setShowQuality(false); }}
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

        {levels.length > 1 && (
          <div style={{ position: 'relative' }}>
            <button
              className="mf-player-btn"
              onClick={() => { setShowQuality((v) => !v); setShowSpeed(false); }}
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

        {'pictureInPictureEnabled' in document && (
          <button className="mf-player-btn" onClick={togglePiP} title="Picture-in-Picture">
            ⧉
          </button>
        )}
      </div>
    </div>
  );
}
