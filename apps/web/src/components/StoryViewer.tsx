// melodyflix - full-screen story viewer (Instagram-style)
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  markStoryViewed, deleteStory, getCachedUser,
  type StoryGroup,
} from '../lib/api';

interface Props {
  groups: StoryGroup[];
  startGroupIndex: number;
  onClose: () => void;
  onSignIn: () => void;
}

const IMAGE_DURATION_MS = 5000;

export default function StoryViewer({ groups, startGroupIndex, onClose, onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [groupIdx, setGroupIdx] = useState(startGroupIndex);
  const [storyIdx, setStoryIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const group = groups[groupIdx];
  const story = group?.stories[storyIdx];
  const isOwner = !!(me && group && me.id === group.user_id);

  // Mark viewed
  useEffect(() => {
    if (!story || !me) return;
    markStoryViewed(story.id).catch(() => {});
  }, [story?.id, me?.id]);

  // Timer for images (videos use onTimeUpdate)
  useEffect(() => {
    if (!story) return;
    if (paused) return;

    if (story.media_type === 'image') {
      const total = IMAGE_DURATION_MS;
      startTimeRef.current = Date.now();
      function tick() {
        const elapsed = Date.now() - startTimeRef.current;
        const pct = Math.min(100, (elapsed / total) * 100);
        setProgress(pct);
        if (pct >= 100) {
          next();
        } else {
          timerRef.current = window.setTimeout(tick, 50);
        }
      }
      tick();
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current);
      };
    } else {
      // Video — reset progress; video onTimeUpdate will drive it
      setProgress(0);
    }
  }, [story?.id, paused]);

  // Keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [groupIdx, storyIdx]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  function next() {
    if (!group) return;
    if (storyIdx < group.stories.length - 1) {
      setStoryIdx(storyIdx + 1);
      setProgress(0);
    } else if (groupIdx < groups.length - 1) {
      setGroupIdx(groupIdx + 1);
      setStoryIdx(0);
      setProgress(0);
    } else {
      onClose();
    }
  }

  function prev() {
    if (!group) return;
    if (storyIdx > 0) {
      setStoryIdx(storyIdx - 1);
      setProgress(0);
    } else if (groupIdx > 0) {
      const prevGroupIdx = groupIdx - 1;
      setGroupIdx(prevGroupIdx);
      setStoryIdx(groups[prevGroupIdx].stories.length - 1);
      setProgress(0);
    }
  }

  async function handleDelete() {
    if (!story) return;
    if (!confirm('Delete this story?')) return;
    setBusy(true);
    try {
      await deleteStory(story.id);
      onClose();
    } catch (err) {
      alert((err as Error).message);
    }
    setBusy(false);
  }

  if (!group || !story) return null;

  const mediaUrl = story.media_url;
  const initial = group.user_id.slice(0, 1).toUpperCase();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.95)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Progress bars at top */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          right: 12,
          display: 'flex',
          gap: 3,
          zIndex: 20,
        }}
      >
        {group.stories.map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 3,
              background: 'rgba(255,255,255,0.3)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: i < storyIdx ? '100%' : i === storyIdx ? `${progress}%` : '0%',
                background: '#fff',
                transition: i === storyIdx ? 'width 50ms linear' : 'none',
              }}
            />
          </div>
        ))}
      </div>

      {/* Header — user info + close */}
      <div
        style={{
          position: 'absolute',
          top: 24,
          left: 20,
          right: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: '#fff',
          zIndex: 20,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #7c3aed, #ec4899)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {initial}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>@{group.user_id.slice(0, 8)}</div>
          <div style={{ fontSize: 11, color: '#c0c0c0' }}>
            {timeSince(story.created_at)} ago
          </div>
        </div>
        {isOwner && (
          <button
            onClick={handleDelete}
            disabled={busy}
            style={{
              background: 'rgba(0,0,0,0.5)',
              border: 'none',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
            }}
            title="Delete"
          >
            🗑
          </button>
        )}
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: 24,
            cursor: 'pointer',
            padding: 4,
            lineHeight: 1,
          }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Story content */}
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          height: '100%',
          maxHeight: '90vh',
          aspectRatio: '9 / 16',
          position: 'relative',
          background: '#000',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {story.media_type === 'image' ? (
          <img
            src={mediaUrl}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        ) : (
          <video
            ref={videoRef}
            src={mediaUrl}
            autoPlay
            playsInline
            muted={false}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration > 0) {
                setProgress((v.currentTime / v.duration) * 100);
              }
            }}
            onEnded={next}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
          />
        )}

        {/* Caption overlay */}
        {story.caption && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: '40px 20px 20px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
              color: '#fff',
              fontSize: 14,
              lineHeight: 1.5,
              textShadow: '0 1px 2px rgba(0,0,0,0.6)',
            }}
          >
            {story.caption}
          </div>
        )}

        {/* Tap zones — left / right for prev / next, center for pause */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 5 }}>
          <div
            onClick={prev}
            style={{ flex: 1, cursor: 'pointer' }}
          />
          <div
            onClick={() => setPaused((p) => !p)}
            style={{ flex: 1, cursor: 'pointer' }}
          />
          <div
            onClick={next}
            style={{ flex: 1, cursor: 'pointer' }}
          />
        </div>

        {/* Paused indicator */}
        {paused && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.3)',
              zIndex: 6,
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontSize: 60, color: '#fff' }}>⏸</div>
          </div>
        )}
      </div>

      {/* View count footer */}
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: 0,
          right: 0,
          textAlign: 'center',
          color: '#c0c0c0',
          fontSize: 12,
          zIndex: 20,
        }}
      >
        {story.view_count} view{story.view_count === 1 ? '' : 's'}
      </div>
    </div>
  );
}

function timeSince(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}
