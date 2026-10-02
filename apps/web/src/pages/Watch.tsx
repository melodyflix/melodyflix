import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  api, formatViews, timeAgo,
  likeVideo, recordView, followChannel, unfollowChannel, isFollowing,
  toggleSaveVideo, isVideoSaved,
  recordHistory, getResumePosition,
  getEpisodeInfo,
  getAdConfig,
  recordAdImpression,
  getCachedUser,
  addToQueue as addToQueueApi,
  getPreferences,
  type AdConfig,
  type Video, type Channel, type Episode, type Series,
} from '../lib/api';
import HlsPlayer from '../components/HlsPlayer';
import CommentSection from '../components/CommentSection';
import ShareMenu from '../components/ShareMenu';
import GuestBanner from '../components/GuestBanner';
import AdPlayer from '../components/AdPlayer';
import VerifiedBadge from '../components/VerifiedBadge';
import SaveToPlaylistModal from '../components/SaveToPlaylistModal';
import Chapters from '../components/Chapters';
import WatchQueue from '../components/WatchQueue';
import StarRating from '../components/StarRating';
import VideoPoll from '../components/VideoPoll';
import VideoQuiz from '../components/VideoQuiz';
import ClipModal from '../components/ClipModal';
import TagChips from '../components/TagChips';
import GenreChips from '../components/GenreChips';
import CastCrewList from '../components/CastCrewList';
import TranscriptPanel from '../components/TranscriptPanel';
import { usePlayer } from '../components/PlayerContext';

type Reaction = 'like' | 'dislike' | null;

interface Props {
  onSignIn: () => void;
}

export default function Watch({ onSignIn }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = getCachedUser();
  const { setMini, clearMini } = usePlayer();
  const playerWrapRef = useRef<HTMLDivElement>(null);
  const lastPlayerStateRef = useRef<{ currentTime: number; playing: boolean; ended: boolean }>({
    currentTime: 0, playing: false, ended: false,
  });
  const historySavedAtRef = useRef(0);

  const [video, setVideo] = useState<Video | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [related, setRelated] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [viewCount, setViewCount] = useState(0);
  const [likeCount, setLikeCount] = useState(0);
  const [dislikeCount, setDislikeCount] = useState(0);
  const [reaction, setReaction] = useState<Reaction>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [busyReaction, setBusyReaction] = useState(false);
  const [busySub, setBusySub] = useState(false);
  const [toast, setToast] = useState('');
  const [showAd, setShowAd] = useState(true);
  const [adConfig, setAdConfig] = useState<AdConfig | null>(null);
  const [adLoading, setAdLoading] = useState(true);
  const [episodeInfo, setEpisodeInfo] = useState<{ episode: Episode | null; series: Series | null; next_episode: Episode | null; next_video: Video | null } | null>(null);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [autoplayNext, setAutoplayNext] = useState(true);
  const [showClipModal, setShowClipModal] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [resumeAt, setResumeAt] = useState<number>(0);
  const [resumedFrom, setResumedFrom] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [seekTarget, setSeekTarget] = useState<{ time: number; nonce: number } | null>(null);
  const seekNonceRef = useRef(0);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    setVideo(null);
    setChannel(null);
    clearMini();

    Promise.all([
      api.getVideo(id),
      api.listVideos(20, 0),
    ])
      .then(async ([v, list]) => {
        setVideo(v);
        setViewCount(v.view_count);
        setLikeCount(v.like_count);
        setDislikeCount(v.dislike_count ?? 0);
        setReaction((v as any).user_reaction ?? null);
        setRelated(list.videos.filter((x) => x.id !== id).slice(0, 10));

        try {
          const ch = await api.getChannel(v.channel_id);
          setChannel(ch);
          setSubscriberCount(ch.subscriber_count);

          if (me && ch.owner_id !== me.id) {
            try {
              const res = await isFollowing(ch.id);
              setSubscribed(res.following);
            } catch {}
          }
        } catch {}

        if (me) {
          try {
            const res = await isVideoSaved(v.id);
            setSaved(res.saved);
          } catch {}
        }

        recordView(v.id)
          .then((res) => setViewCount(res.view_count))
          .catch(() => {});

        // Fetch ad config (pre-roll)
        getAdConfig(v.id)
          .then(async (cfg) => {
            if (cfg && (cfg.ad || cfg.vast_tag_url)) {
              setAdConfig(cfg);
              setShowAd(true);
              // Record impression for internal ads
              if (cfg.ad?.id) {
                recordAdImpression(cfg.ad.id, v.id).catch(() => {});
              }
            } else {
              setShowAd(false);
            }
          })
          .catch(() => setShowAd(false))
          .finally(() => setAdLoading(false));

        // Fetch episode info (for series navigation)
        getEpisodeInfo(v.id)
          .then((info) => setEpisodeInfo(info))
          .catch(() => {});

        // Fetch resume position (logged-in user)
        if (me) {
          try {
            const rp = await getResumePosition(v.id);
            if (rp.position > 5) {
              setResumeAt(rp.position);
              setResumedFrom(rp.position);
              const mins = Math.floor(rp.position / 60);
              const secs = Math.floor(rp.position % 60);
              const timeStr = mins > 0
                ? `${mins}:${String(secs).padStart(2, '0')}`
                : `${secs}s`;
              showToast(`Resumed from ${timeStr}`);
            }
          } catch {}
        }
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  // Save history every ~10s while watching (if logged in)
  useEffect(() => {
    if (!me || !video) return;
    const interval = setInterval(() => {
      const st = lastPlayerStateRef.current;
      if (st.currentTime < 2) return;
      const now = Date.now();
      if (now - historySavedAtRef.current < 8000) return;
      historySavedAtRef.current = now;
      recordHistory(video.id, st.currentTime).catch(() => {});
    }, 5000);
    useEffect(() => {
    if (!me) return;
    getPreferences()
      .then((p) => setAutoplayNext(p.autoplay_next === 1))
      .catch(() => {});
  }, [me?.id]);

  function handleVideoEnded() {
    // Priority 1: Series next episode
    if (episodeInfo?.next_video) {
      navigate(`/watch/${episodeInfo.next_video.id}`);
      return;
    }
    // Priority 2: Autoplay next related video
    if (autoplayNext && related.length > 0) {
      navigate(`/watch/${related[0].id}`);
    }
  }

  async function handleAddToQueue() {
    if (!me) { onSignIn(); return; }
    if (!video) return;
    try {
      await addToQueueApi(video.id);
      showToast('Added to queue');
      setShowQueue(true);
    } catch (err) {
      showToast((err as Error).message || 'Failed to add to queue');
    }
  }

  return () => clearInterval(interval);
  }, [me?.id, video?.id]);

  // On unmount: save history + set mini player
  useEffect(() => {
    return () => {
      const state = lastPlayerStateRef.current;
      if (!video) return;

      // Save history (if user logged in and watched >1s)
      if (me && !state.ended && state.currentTime > 1) {
        recordHistory(video.id, state.currentTime).catch(() => {});
      }

      // Set mini player if playing
      if (!state.ended && (state.currentTime > 1 || state.playing)) {
        setMini({
          video,
          currentTime: state.currentTime,
          wasPlaying: state.playing,
          active: true,
        });
      }
    };
  }, [video?.id, me?.id]);

  async function handleReaction(type: 'like' | 'dislike') {
    if (!video || busyReaction) return;
    if (!me) { onSignIn(); return; }

    const nextType: 'like' | 'dislike' | 'none' = reaction === type ? 'none' : type;
    setBusyReaction(true);
    try {
      const res = await likeVideo(video.id, nextType);
      setLikeCount(res.likeCount);
      setDislikeCount(res.dislikeCount);
      setReaction(res.userReaction);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusyReaction(false);
    }
  }

  async function handleSubscribe() {
    if (!channel || busySub) return;
    if (!me) { onSignIn(); return; }

    setBusySub(true);
    try {
      if (subscribed) {
        const res = await unfollowChannel(channel.id);
        setSubscribed(false);
        setSubscriberCount(res.subscriberCount);
      } else {
        const res = await followChannel(channel.id);
        setSubscribed(true);
        setSubscriberCount(res.subscriberCount);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusySub(false);
    }
  }

  async function handleSave() {
    if (!video) return;
    if (!me) { onSignIn(); return; }
    try {
      const res = await toggleSaveVideo(video.id);
      setSaved(res.saved);
      showToast(res.saved ? 'Saved to Watch Later' : 'Removed from Watch Later');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  if (loading) return <div className="mf-loading">Loading...</div>;
  if (error) return <div className="mf-container"><div className="mf-error">{error}</div></div>;
  if (!video) return <div className="mf-empty">Video not found</div>;

  const streamSrc = video.hls_master_url ?? `/api/v1/videos/${video.id}/stream/master.m3u8`;
  const poster = video.thumbnail_url ? `/api/v1/videos/${video.id}/thumbnail.jpg` : undefined;

  const isOwnChannel = !!(channel && me && channel.owner_id === me.id);
  const channelName = channel?.name ?? `Channel ${video.channel_id.slice(0, 8)}`;
  const channelInitial = (channelName[0] ?? 'M').toUpperCase();

  return (
    <>
      <div className="mf-watch">
        <div>
          <div ref={playerWrapRef}>
            {video.status === 'ready' && adLoading ? (
              <div className="mf-player">
                <div className="mf-player-status">Loading...</div>
              </div>
            ) : video.status === 'ready' && showAd && adConfig ? (
              <div className="mf-player">
                <AdPlayer
                  vastTagUrl={adConfig.vast_tag_url}
                  fallbackVideoUrl={adConfig.ad?.video_url}
                  fallbackClickUrl={adConfig.ad?.click_url ?? undefined}
                  skipAfter={adConfig.ad?.skip_after_seconds ?? 5}
                  onComplete={() => setShowAd(false)}
                  onError={() => setShowAd(false)}
                />
              </div>
            ) : video.status === 'ready' ? (
              <HlsPlayer
                src={streamSrc}
                poster={poster}
                startTime={resumeAt}
                seekTo={seekTarget}
                videoId={video.id}
            onEnded={handleVideoEnded}
                onStateChange={(s) => { lastPlayerStateRef.current = s; setCurrentTime(s.currentTime); }}
              />
            ) : (
              <div className="mf-player">
                <div className="mf-player-status">
                  {video.status === 'processing' && '⏳ This video is still processing...'}
                  {video.status === 'failed' && '⚠️ Processing failed for this video'}
                  {video.status === 'uploading' && '⬆️ Upload in progress...'}
                </div>
              </div>
            )}
          </div>

          {episodeInfo?.episode && episodeInfo.series && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 14,
                marginBottom: -4,
                fontSize: 13,
                color: '#7c3aed',
                fontWeight: 600,
              }}
            >
              <span
                onClick={() => navigate(`/series/${episodeInfo.series!.id}`)}
                style={{ cursor: 'pointer', textDecoration: 'underline' }}
              >
                {episodeInfo.series.title}
              </span>
              <span style={{ color: '#909090' }}>·</span>
              <span>
                S{episodeInfo.series.total_seasons > 0 ? '?' : '1'} E{episodeInfo.episode.episode_number}
              </span>
            </div>
          )}

          <h1 className="mf-watch-title">{video.title}</h1>

          <div className="mf-watch-row">
            <div className="mf-channel-row">
              <div
                className="mf-video-avatar"
                style={{ width: 40, height: 40, cursor: 'pointer' }}
                onClick={() => navigate(`/channel/${video.channel_id}`)}
              >
                {channelInitial}
              </div>
              <div
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/channel/${video.channel_id}`)}
              >
                <div style={{ fontWeight: 500, display: "flex", alignItems: "center" }}>
                {channelName}
                <VerifiedBadge verified={channel?.is_verified} size={14} />
              </div>
                <div style={{ fontSize: 12, color: '#606060' }}>
                  {subscriberCount} subscribers
                </div>
              </div>
              {isOwnChannel ? (
                <span className="mf-sub-btn subscribed" style={{ marginLeft: 12, cursor: 'default' }}>
                  Your channel
                </span>
              ) : (
                <button
                  className={`mf-sub-btn ${subscribed ? 'subscribed' : ''}`}
                  onClick={handleSubscribe}
                  disabled={busySub}
                  style={{ marginLeft: 12 }}
                >
                  {subscribed ? 'Subscribed' : 'Subscribe'}
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#f2f2f2',
                  borderRadius: 20,
                  overflow: 'hidden',
                }}
              >
                <button
                  onClick={() => handleReaction('like')}
                  disabled={busyReaction}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 14px',
                    cursor: 'pointer',
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'inherit',
                    fontWeight: 500,
                    color: reaction === 'like' ? '#065fd4' : '#0f0f0f',
                    borderRight: '1px solid #e5e5e5',
                  }}
                >
                  👍 {likeCount}
                </button>
                <button
                  onClick={() => handleReaction('dislike')}
                  disabled={busyReaction}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '8px 14px',
                    cursor: 'pointer',
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'inherit',
                    fontWeight: 500,
                    color: reaction === 'dislike' ? '#065fd4' : '#0f0f0f',
                  }}
                >
                  👎 {dislikeCount}
                </button>
              </div>

              <ShareMenu videoId={video.id} title={video.title} onToast={showToast} />

              {episodeInfo?.next_video && (
                <button
                  className="mf-sub-btn"
                  style={{
                    background: '#7c3aed',
                    color: '#fff',
                    border: 'none',
                    fontWeight: 600,
                  }}
                  onClick={() => {
                    if (episodeInfo.next_video) {
                      navigate(`/watch/${episodeInfo.next_video.id}`);
                    }
                  }}
                  title="Play next episode"
                >
                  ⏭ Next episode
                </button>
              )}

              <button
                className="mf-sub-btn"
                style={{ background: '#f2f2f2', color: '#0f0f0f' }}
                onClick={() => me ? setShowPlaylistModal(true) : onSignIn()}
              >
                📁 Save to playlist
              </button>

              <button
                className="mf-sub-btn"
                style={{
                  background: showQueue ? '#e8f0fe' : '#f2f2f2',
                  color: showQueue ? '#065fd4' : '#0f0f0f',
                }}
                onClick={() => me ? setShowQueue((v) => !v) : onSignIn()}
                title="Watch Queue"
              >
                🕒 Queue
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#f2f2f2',
                  borderRadius: 20,
                  padding: '6px 14px',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 13, color: '#606060' }}>Rate:</span>
                <StarRating
                  videoId={video.id}
                  onSignIn={onSignIn}
                  onToast={showToast}
                  size={18}
                />
              </div>

              <button
                className="mf-sub-btn"
                style={{ background: '#f2f2f2', color: '#0f0f0f' }}
                onClick={() => me ? setShowClipModal(true) : onSignIn()}
                title="Create a clip"
              >
                ✂️ Clip
              </button>

              <button
                className="mf-sub-btn"
                style={{
                  background: showTranscript ? '#e8f0fe' : '#f2f2f2',
                  color: showTranscript ? '#065fd4' : '#0f0f0f',
                }}
                onClick={() => setShowTranscript((v) => !v)}
                title="Toggle transcript"
              >
                📝 Transcript
              </button>

              <VideoPoll
                videoId={video.id}
                videoOwnerId={video.owner_id}
                onSignIn={onSignIn}
                onToast={showToast}
              />

              <VideoQuiz
                videoId={video.id}
                videoOwnerId={video.owner_id}
                onSignIn={onSignIn}
                onToast={showToast}
              />

              <button
                className="mf-sub-btn"
                style={{
                  background: saved ? '#e8f0fe' : '#f2f2f2',
                  color: saved ? '#065fd4' : '#0f0f0f',
                }}
                onClick={handleSave}
              >
                {saved ? '🔖 Saved' : '🔖 Save'}
              </button>

              <div
                style={{
                  background: '#f2f2f2',
                  borderRadius: 20,
                  padding: '8px 14px',
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {formatViews(viewCount)}
              </div>
            </div>
          </div>

          {video.description && (
            <div className="mf-watch-desc">{video.description}</div>
          )}

          <Chapters
            videoId={video.id}
            currentTime={currentTime}
            onSeek={(s) => { seekNonceRef.current += 1; setSeekTarget({ time: s, nonce: seekNonceRef.current }); }}
          />

          <GuestBanner onSignIn={onSignIn} />

          <TagChips videoId={video.id} />
          <GenreChips videoId={video.id} />
          <CastCrewList videoId={video.id} />

          <CommentSection videoId={video.id} videoOwnerId={video.owner_id} onSignIn={onSignIn} onSeek={(sec) => setSeekTarget({ time: sec, nonce: seekNonceRef.current += 1 })} />
        </div>

        <div>
          <h3 style={{ fontSize: 16, marginBottom: 14 }}>Up next</h3>
          <div className="mf-sidebar-list">
            {related.map((v) => (
              <div key={v.id} className="mf-sidebar-item" onClick={() => navigate(`/watch/${v.id}`)}>
                <div className="mf-sidebar-thumb">
                  {v.status === 'ready' ? (
                    <img src={`/api/v1/videos/${v.id}/thumbnail.jpg`} alt={v.title} loading="lazy" />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: '#e5e5e5' }} />
                  )}
                </div>
                <div className="mf-sidebar-info">
                  <div className="mf-sidebar-title">{v.title}</div>
                  <div className="mf-sidebar-meta">{formatViews(v.view_count)}</div>
                  <div className="mf-sidebar-meta">{timeAgo(v.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showPlaylistModal && video && (
        <SaveToPlaylistModal
          videoId={video.id}
          onClose={() => setShowPlaylistModal(false)}
          onToast={showToast}
        />
      )}

      {showTranscript && video && (
        <div className="mf-transcript-overlay">
          <TranscriptPanel
            videoId={video.id}
            currentTime={currentTime}
            onSeek={(sec) => setSeekTarget({ time: sec, nonce: seekNonceRef.current += 1 })}
          />
          <button
            className="mf-transcript-close"
            onClick={() => setShowTranscript(false)}
            title="Close transcript"
          >✕</button>
        </div>
      )}

      {showClipModal && video && (
        <ClipModal
          videoId={video.id}
          videoTitle={video.title}
          currentTime={currentTime}
          videoDuration={Number(video.duration_seconds) || 0}
          onClose={() => setShowClipModal(false)}
          onCreated={(clipId) => {
            setShowClipModal(false);
            navigate(`/clip/${clipId}`);
          }}
          onToast={showToast}
        />
      )}

      {showQueue && (
        <WatchQueue
          onPlay={(id) => { setShowQueue(false); navigate(`/watch/${id}`); }}
          onSignIn={onSignIn}
          onClose={() => setShowQueue(false)}
        />
      )}

      {toast && <div className="mf-toast">{toast}</div>}
    </>
  );
}
