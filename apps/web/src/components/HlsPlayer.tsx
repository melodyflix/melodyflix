import { useEffect, useRef, useState } from 'react';
import { usePlayerKeyboard } from '../hooks/usePlayerKeyboard';
import { useHdrDetect } from '../hooks/useHdrDetect';
import { useChromecast } from '../hooks/useChromecast';
import { listVideoSubtitles, type SubtitleTrack, listVideoAudioTracks, setAudioTrackPreference, type AudioTrack } from '../lib/api';
import { getVideoVr, type VrMetadata, getChannelCustomization, type PlayerCustomization, listChannelIntros, type ChannelIntro } from '../lib/api';
import { lazy, Suspense } from 'react';
const VrPlayer = lazy(() => import('./VrPlayer'));
import { useAudioEngine, type AudioEngineSettings } from './useAudioEngine';
import AudioSettings from './AudioSettings';

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
  videoId?: string;
  subtitlesEnabled?: boolean;
  // Media Session metadata (45.2)
  mediaTitle?: string;
  mediaArtist?: string;
  mediaArtwork?: string;
  mediaAlbum?: string;
  // Player customization (30.x)
  customization?: PlayerCustomization | null;
  channelId?: string;
}

type QualityLevel = { index: number; height: number; bitrate: number };

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const SLEEP_OPTIONS = [10, 20, 30, 60, 120];

export default function HlsPlayer({ src, poster, startTime = 0, seekTo, onStateChange, onEnded, videoId, subtitlesEnabled = true, mediaTitle, mediaArtist, mediaArtwork, mediaAlbum, customization, channelId }: Props) {
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

  // ==== Section 4.x: keyboard / HDR / Cast ====
  const containerRef = useRef<HTMLDivElement>(null);
  usePlayerKeyboard({ videoRef, containerRef, fps: 30 });
  const hdrDetection = useHdrDetect({
    videoRef,
    manifestUrl: src ?? null,
    serverIsHdr: undefined,
    serverHdrFormat: undefined,
  });
  const castCtl = useChromecast();

  // A-B Repeat
  const [aPoint, setAPoint] = useState<number | null>(null);
  const [bPoint, setBPoint] = useState<number | null>(null);

  // Sleep timer
  const [sleepEndAt, setSleepEndAt] = useState<number | null>(null);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);
  // Gesture controls state
  const [gestureFeedback, setGestureFeedback] = useState<{
    type: 'seek-fwd' | 'seek-back' | 'volume' | 'brightness' | 'play' | 'pause';
    value?: number;
    visible: boolean;
  } | null>(null);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    startVolume: number;
    startBrightness: number;
    side: 'left' | 'right' | null;
    mode: 'none' | 'seek' | 'volume' | 'brightness';
    lastTap: number;
    initialTime: number;
    moved: boolean;
  }>({
    startX: 0, startY: 0, startTime: 0,
    startVolume: 1, startBrightness: 1,
    side: null, mode: 'none',
    lastTap: 0, initialTime: 0, moved: false,
  });
  const [brightness, setBrightness] = useState(1);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [audioSettings, setAudioSettings] = useState<AudioEngineSettings>(() => {
    try {
      const raw = localStorage.getItem('mf-audio-settings');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const [showAudioPanel, setShowAudioPanel] = useState(false);
  const [localCustomization, setLocalCustomization] = useState<PlayerCustomization | null>(customization ?? null);
  const [introBundle, setIntroBundle] = useState<{ intro: ChannelIntro | null; outro: ChannelIntro | null }>({ intro: null, outro: null });
  const [introPlaying, setIntroPlaying] = useState<'intro' | 'outro' | null>(null);
  const [introSkippable, setIntroSkippable] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<string | null>(null);
  const [vrMeta, setVrMeta] = useState<VrMetadata | null>(null);
  const [vrMode, setVrMode] = useState(false);

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

  // Fetch audio tracks for this video
  useEffect(() => {
    if (!videoId) return;
    listVideoAudioTracks(videoId)
      .then((res) => {
        setAudioTracks(res.tracks);
        setActiveAudioTrack(res.preference ?? res.defaultTrack ?? null);
      })
      .catch(() => setAudioTracks([]));
  }, [videoId]);

  // Persist audio settings
  useEffect(() => {
    try { localStorage.setItem('mf-audio-settings', JSON.stringify(audioSettings)); } catch {}
  }, [audioSettings]);

  function updateAudioSettings(patch: Partial<AudioEngineSettings>) {
    setAudioSettings((prev) => ({ ...prev, ...patch }));
  }

  async function handleSelectAudioTrack(trackId: string) {
    setActiveAudioTrack(trackId);
    if (videoId) {
      try { await setAudioTrackPreference(videoId, trackId); } catch {}
    }
  }

  // Hook up Web Audio engine (builds graph lazily on first play)
  useAudioEngine(videoRef.current, audioSettings);

  // Fetch channel customization if not passed as prop
  useEffect(() => {
    if (customization !== undefined) {
      setLocalCustomization(customization ?? null);
      return;
    }
    if (!channelId) { setLocalCustomization(null); return; }
    getChannelCustomization(channelId)
      .then((res) => setLocalCustomization(res.customization))
      .catch(() => setLocalCustomization(null));
  }, [channelId, customization]);

  // Fetch intro/outro bundle
  useEffect(() => {
    if (!channelId) { setIntroBundle({ intro: null, outro: null }); return; }
    listChannelIntros(channelId)
      .then((res) => setIntroBundle(res.bundle))
      .catch(() => setIntroBundle({ intro: null, outro: null }));
  }, [channelId]);

  // Start intro when video first loads (only once per video)
  useEffect(() => {
    if (!videoId || !introBundle.intro || introBundle.intro.is_enabled !== 1) return;
    // only if not already played for this video this session
    const key = `mf-intro-played-${videoId}`;
    if (sessionStorage.getItem(key)) return;
    setIntroPlaying('intro');
    setIntroSkippable(false);
    sessionStorage.setItem(key, '1');
  }, [videoId, introBundle.intro]);

  // Intro skip timer
  useEffect(() => {
    if (!introPlaying) return;
    const current = introPlaying === 'intro' ? introBundle.intro : introBundle.outro;
    if (!current) { setIntroPlaying(null); return; }
    setIntroSkippable(false);
    if (current.skip_after_seconds > 0) {
      const t = window.setTimeout(() => setIntroSkippable(true), current.skip_after_seconds * 1000);
      return () => window.clearTimeout(t);
    }
  }, [introPlaying, introBundle]);

  // Fetch VR metadata for this video
  useEffect(() => {
    if (!videoId) return;
    getVideoVr(videoId)
      .then((res) => setVrMeta(res.vr))
      .catch(() => setVrMeta(null));
  }, [videoId]);

  // Fetch subtitle tracks for this video
  useEffect(() => {
    if (!videoId || !subtitlesEnabled) { setSubtitleTracks([]); return; }
    listVideoSubtitles(videoId)
      .then((res) => setSubtitleTracks(res.subtitles))
      .catch(() => setSubtitleTracks([]));
  }, [videoId, subtitlesEnabled]);

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
        case ',':
          e.preventDefault();
          if (!video.paused) video.pause();
          video.currentTime = Math.max(video.currentTime - (e.shiftKey ? 10 : 1) / 30, 0);
          break;
        case '.':
          e.preventDefault();
          if (!video.paused) video.pause();
          video.currentTime = Math.min(video.currentTime + (e.shiftKey ? 10 : 1) / 30, video.duration || 0);
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

  // ============ Media Session API (45.2 Background Audio) ============
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const v = videoRef.current;
    if (!v) return;
    const ms = (navigator as any).mediaSession as MediaSession;

    // Metadata
    try {
      const artwork: MediaImage[] = [];
      if (mediaArtwork) {
        artwork.push({ src: mediaArtwork, sizes: '512x512', type: 'image/jpeg' });
        artwork.push({ src: mediaArtwork, sizes: '256x256', type: 'image/jpeg' });
      } else if (poster) {
        artwork.push({ src: poster, sizes: '512x512' });
      }
      ms.metadata = new (window as any).MediaMetadata({
        title: mediaTitle ?? 'MelodyFlix',
        artist: mediaArtist ?? 'MelodyFlix',
        album: mediaAlbum ?? 'MelodyFlix',
        artwork,
      });
    } catch {}

    // Action handlers
    const setHandler = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try { ms.setActionHandler(action, fn); } catch {}
    };

    setHandler('play', () => { v.play().catch(() => {}); });
    setHandler('pause', () => { v.pause(); });
    setHandler('seekbackward', (d) => {
      v.currentTime = Math.max(v.currentTime - (d?.seekOffset ?? 10), 0);
    });
    setHandler('seekforward', (d) => {
      v.currentTime = Math.min(v.currentTime + (d?.seekOffset ?? 10), v.duration || 0);
    });
    setHandler('seekto', (d) => {
      if (typeof d?.seekTime === 'number') v.currentTime = d.seekTime;
    });
    setHandler('stop', () => {
      v.pause();
      v.currentTime = 0;
    });

    // Update playback state + position
    const onPlay = () => { try { ms.playbackState = 'playing'; } catch {} };
    const onPause = () => { try { ms.playbackState = 'paused'; } catch {} };
    const onEndedEv = () => { try { ms.playbackState = 'none'; } catch {} };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEndedEv);

    // Periodic position state sync
    const syncPos = () => {
      try {
        if (!v.duration || !isFinite(v.duration)) return;
        if (typeof (ms as any).setPositionState === 'function') {
          (ms as any).setPositionState({
            duration: v.duration,
            playbackRate: v.playbackRate,
            position: Math.max(0, Math.min(v.currentTime, v.duration)),
          });
        }
      } catch {}
    };
    const posInt = window.setInterval(syncPos, 2000);
    syncPos();

    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEndedEv);
      window.clearInterval(posInt);
      try {
        ms.setActionHandler('play', null);
        ms.setActionHandler('pause', null);
        ms.setActionHandler('seekbackward', null);
        ms.setActionHandler('seekforward', null);
        ms.setActionHandler('seekto', null);
        ms.setActionHandler('stop', null);
      } catch {}
    };
  }, [mediaTitle, mediaArtist, mediaArtwork, mediaAlbum, poster]);

  // ============ Gesture Controls ============
  function showGesture(fb: { type: 'seek-fwd' | 'seek-back' | 'volume' | 'brightness' | 'play' | 'pause'; value?: number }) {
    setGestureFeedback({ ...fb, visible: true });
    window.clearTimeout((showGesture as any)._t);
    (showGesture as any)._t = window.setTimeout(() => {
      setGestureFeedback((g) => g ? { ...g, visible: false } : null);
    }, 600);
  }

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v) return;
    const t = e.touches[0];
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const relX = (t.clientX - rect.left) / rect.width;
    const now = Date.now();

    gestureRef.current.startX = t.clientX;
    gestureRef.current.startY = t.clientY;
    gestureRef.current.startTime = now;
    gestureRef.current.startVolume = v.volume;
    gestureRef.current.startBrightness = brightness;
    gestureRef.current.initialTime = v.currentTime;
    gestureRef.current.side = relX < 0.5 ? 'left' : 'right';
    gestureRef.current.mode = 'none';
    gestureRef.current.moved = false;

    // Detect double-tap
    const timeSinceLast = now - gestureRef.current.lastTap;
    if (timeSinceLast < 300) {
      // Double tap
      const jump = 10;
      if (relX < 0.5) {
        v.currentTime = Math.max(v.currentTime - jump, 0);
        showGesture({ type: 'seek-back', value: jump });
      } else {
        v.currentTime = Math.min(v.currentTime + jump, v.duration || 0);
        showGesture({ type: 'seek-fwd', value: jump });
      }
      gestureRef.current.lastTap = 0; // Reset to avoid triple-tap
      e.preventDefault();
      return;
    }
    gestureRef.current.lastTap = now;
  }

  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v) return;
    const t = e.touches[0];
    const dx = t.clientX - gestureRef.current.startX;
    const dy = t.clientY - gestureRef.current.startY;

    // Determine mode on first significant movement
    if (gestureRef.current.mode === 'none' && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      if (Math.abs(dx) > Math.abs(dy)) {
        gestureRef.current.mode = 'seek';
      } else {
        gestureRef.current.mode = gestureRef.current.side === 'left' ? 'brightness' : 'volume';
      }
      gestureRef.current.moved = true;
    }

    if (gestureRef.current.mode === 'seek') {
      e.preventDefault();
      const secondsPerPx = (v.duration || 60) / 400;
      const delta = dx * secondsPerPx;
      const target = Math.max(0, Math.min(v.duration || 0, gestureRef.current.initialTime + delta));
      v.currentTime = target;
      showGesture({ type: delta >= 0 ? 'seek-fwd' : 'seek-back', value: Math.abs(Math.round(delta)) });
    } else if (gestureRef.current.mode === 'volume') {
      e.preventDefault();
      const delta = -dy / 200;
      v.volume = Math.max(0, Math.min(1, gestureRef.current.startVolume + delta));
      showGesture({ type: 'volume', value: Math.round(v.volume * 100) });
    } else if (gestureRef.current.mode === 'brightness') {
      e.preventDefault();
      const delta = -dy / 200;
      const newB = Math.max(0.2, Math.min(1, gestureRef.current.startBrightness + delta));
      setBrightness(newB);
      showGesture({ type: 'brightness', value: Math.round(newB * 100) });
    }
  }

  function onTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    const v = videoRef.current;
    if (!v) return;
    // Single tap (no movement, not double-tap) → toggle play/pause
    if (!gestureRef.current.moved && gestureRef.current.mode === 'none') {
      // Only trigger if lastTap was not recent enough for double-tap
      const timeSinceStart = Date.now() - gestureRef.current.startTime;
      if (timeSinceStart < 250) {
        if (v.paused) {
          v.play().catch(() => {});
          showGesture({ type: 'play' });
        } else {
          v.pause();
          showGesture({ type: 'pause' });
        }
      }
    }
    gestureRef.current.mode = 'none';
    gestureRef.current.moved = false;
  }

  return (
    <div
      className="mf-player"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ touchAction: 'pan-y' }}
    >
      <video
        ref={videoRef}
        controls
        poster={poster}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          visibility: audioSettings.audioOnlyMode ? 'hidden' : 'visible',
          filter: [
            brightness !== 1 ? `brightness(${brightness})` : '',
            localCustomization && localCustomization.filter_preset !== 'none'
              ? `brightness(${localCustomization.brightness}) contrast(${localCustomization.contrast}) saturate(${localCustomization.saturation}) hue-rotate(${localCustomization.hue_rotate}deg) sepia(${localCustomization.sepia}) blur(${localCustomization.blur}px)`
              : '',
          ].filter(Boolean).join(' ') || undefined,
        }}
      >
        {subtitleTracks.map((t) => (
          <track
            key={t.id}
            kind={t.kind === 'captions' ? 'captions' : 'subtitles'}
            src={`/api/v1/videos/subtitles/${t.id}.vtt`}
            srcLang={t.language}
            label={t.label}
            default={t.is_default === 1}
          />
        ))}
      </video>

      {/* VR mode — replaces normal video view with 360 canvas */}
      {vrMode && vrMeta && vrMeta.projection !== 'none' && (
        <Suspense fallback={
          <div style={{
            position: 'absolute', inset: 0, background: '#000', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 14, fontFamily: 'inherit',
          }}>
            🥽 Loading VR viewer...
          </div>
        }>
          <VrPlayer
            videoEl={videoRef.current}
            vr={vrMeta}
            onExit={() => setVrMode(false)}
          />
        </Suspense>
      )}

      {/* VR button (only if this video has VR metadata) */}
      {vrMeta && vrMeta.projection !== 'none' && !vrMode && (
        <button
          type="button"
          className="mf-vr-toggle-btn"
          onClick={() => setVrMode(true)}
          title="Enter 360° VR mode"
        >
          🥽
        </button>
      )}

      {/* Intro/Outro overlay (30.3) */}
      {introPlaying && (() => {
        const current = introPlaying === 'intro' ? introBundle.intro : introBundle.outro;
        if (!current) return null;
        return (
          <div className="mf-intro-overlay" style={{
            position: 'absolute', inset: 0, background: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 40,
          }}>
            <video
              src={current.video_url}
              poster={current.thumbnail_url ?? undefined}
              autoPlay
              playsInline
              onEnded={() => setIntroPlaying(null)}
              onError={() => setIntroPlaying(null)}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
            {introSkippable && (
              <button
                type="button"
                onClick={() => setIntroPlaying(null)}
                className="mf-intro-skip"
                style={{
                  position: 'absolute', bottom: 20, right: 20,
                  background: 'rgba(0,0,0,0.75)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)',
                  padding: '8px 16px', borderRadius: 4,
                  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                  fontWeight: 500,
                }}
              >
                Skip {introPlaying === 'intro' ? 'intro' : 'outro'} →
              </button>
            )}
          </div>
        );
      })()}

      {/* Color grading tint overlay (30.8) */}
      {localCustomization && localCustomization.tint_alpha > 0 && (
        <div
          className="mf-customization-tint"
          style={{
            position: 'absolute',
            inset: 0,
            background: `rgba(${localCustomization.tint_r}, ${localCustomization.tint_g}, ${localCustomization.tint_b}, ${localCustomization.tint_alpha})`,
            pointerEvents: 'none',
            zIndex: 2,
            mixBlendMode: 'multiply',
          }}
        />
      )}

      {/* Logo overlay (30.2) */}
      {localCustomization?.logo_url && (
        <div
          className="mf-customization-logo"
          style={{
            position: 'absolute',
            [localCustomization.logo_position.includes('top') ? 'top' : 'bottom']: 12,
            [localCustomization.logo_position.includes('left') ? 'left' : 'right']: 12,
            opacity: localCustomization.logo_opacity,
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <img
            src={localCustomization.logo_url}
            alt="Channel logo"
            style={{ maxWidth: 80, maxHeight: 80, display: 'block' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* Watermark text (30.2) */}
      {localCustomization?.watermark_text && (
        <div
          className="mf-customization-watermark"
          style={{
            position: 'absolute',
            bottom: 12,
            right: 12,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            opacity: 0.7,
            textShadow: '0 1px 3px rgba(0,0,0,0.7)',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          {localCustomization.watermark_text}
        </div>
      )}

      {/* Audio-only mode overlay */}
      {audioSettings.audioOnlyMode && (
        <div className="mf-audio-only-overlay">
          <div style={{ fontSize: 64 }}>🎵</div>
          <div style={{ fontSize: 13, color: '#fff', marginTop: 8 }}>Audio-only mode</div>
        </div>
      )}

      {/* Audio settings button (top-left) */}
      <button
        type="button"
        className="mf-audio-toggle-btn"
        onClick={() => setShowAudioPanel((v) => !v)}
        title="Audio settings"
      >
        🎚️
      </button>

      {/* Audio settings panel */}
      {showAudioPanel && (
        <AudioSettings
          settings={audioSettings}
          onChange={updateAudioSettings}
          onClose={() => setShowAudioPanel(false)}
          audioTracks={audioTracks.map((t) => ({ id: t.id, label: t.label, lang: t.language }))}
          activeAudioTrack={activeAudioTrack ?? undefined}
          onSelectAudioTrack={handleSelectAudioTrack}
        />
      )}

      {/* Gesture feedback overlay */}
      {gestureFeedback && gestureFeedback.visible && (
        <div className="mf-gesture-feedback">
          {gestureFeedback.type === 'seek-fwd' && (
            <div className="mf-gesture-bubble">
              <span style={{ fontSize: 22 }}>⏩</span>
              <span>{gestureFeedback.value}s</span>
            </div>
          )}
          {gestureFeedback.type === 'seek-back' && (
            <div className="mf-gesture-bubble">
              <span style={{ fontSize: 22 }}>⏪</span>
              <span>{gestureFeedback.value}s</span>
            </div>
          )}
          {gestureFeedback.type === 'volume' && (
            <div className="mf-gesture-bubble">
              <span style={{ fontSize: 22 }}>{gestureFeedback.value === 0 ? '🔇' : '🔊'}</span>
              <span>{gestureFeedback.value}%</span>
            </div>
          )}
          {gestureFeedback.type === 'brightness' && (
            <div className="mf-gesture-bubble">
              <span style={{ fontSize: 22 }}>☀️</span>
              <span>{gestureFeedback.value}%</span>
            </div>
          )}
          {gestureFeedback.type === 'play' && (
            <div className="mf-gesture-bubble mf-gesture-center">
              <span style={{ fontSize: 40 }}>▶️</span>
            </div>
          )}
          {gestureFeedback.type === 'pause' && (
            <div className="mf-gesture-bubble mf-gesture-center">
              <span style={{ fontSize: 40 }}>⏸️</span>
            </div>
          )}
        </div>
      )}
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

        {/* Frame step (4.11) */}
        <button
          className="mf-player-btn"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            v.pause();
            v.currentTime = Math.max(0, v.currentTime - 1 / 30);
          }}
          title="Previous frame (,) — frame-by-frame"
          style={{ background: 'rgba(0,0,0,0.65)' }}
        >
          ⟨
        </button>
        <button
          className="mf-player-btn"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            v.pause();
            v.currentTime = Math.min(v.duration || v.currentTime, v.currentTime + 1 / 30);
          }}
          title="Next frame (.) — frame-by-frame"
          style={{ background: 'rgba(0,0,0,0.65)' }}
        >
          ⟩
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

      {/* Cast button (4.7) */}
      {castCtl.supported && castCtl.available && (
        <button
          className="mf-player-btn"
          onClick={async () => {
            if (castCtl.connected) {
              castCtl.disconnect();
            } else if (src) {
              await castCtl.cast({
                contentId: src,
                contentType: 'application/x-mpegurl',
                title: mediaTitle ?? undefined,
                poster: poster ?? undefined,
              });
            }
          }}
          title={castCtl.connected ? 'Disconnect cast' : 'Cast to device'}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            background: castCtl.connected ? '#065fd4' : 'rgba(0,0,0,0.65)',
            zIndex: 15,
          }}
        >
          📺
        </button>
      )}

      {/* HDR badge (4.8) */}
      {hdrDetection.isHdr && (
        <div
          title={`HDR: ${hdrDetection.format ?? 'detected'}`}
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.5,
            color: '#fff',
            background: 'linear-gradient(135deg, #d4af37, #b8860b)',
            zIndex: 15,
            textTransform: 'uppercase',
          }}
        >
          HDR{hdrDetection.format === 'dolby_vision' ? ' DV' : hdrDetection.format === 'hlg' ? ' HLG' : ''}
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
