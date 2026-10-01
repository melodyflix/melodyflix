import { useEffect, useState } from 'react';
import { getVideoRating, rateVideo, deleteVideoRating, getCachedUser } from '../lib/api';

interface Props {
  videoId: string;
  onSignIn: () => void;
  onToast?: (msg: string) => void;
  size?: number;
}

export default function StarRating({ videoId, onSignIn, onToast, size = 20 }: Props) {
  const me = getCachedUser();
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await getVideoRating(videoId);
      setAvg(res.avg);
      setCount(res.count);
      setUserRating(res.userRating);
    } catch {
      // ignore
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [videoId]);

  async function handleClick(star: number) {
    if (!me) { onSignIn(); return; }
    if (busy) return;
    setBusy(true);
    try {
      if (userRating === star) {
        // Click on same star → remove rating
        const res = await deleteVideoRating(videoId);
        setAvg(res.ratingAvg);
        setCount(res.ratingCount);
        setUserRating(null);
        onToast?.('Rating removed');
      } else {
        const res = await rateVideo(videoId, star);
        setAvg(res.ratingAvg);
        setCount(res.ratingCount);
        setUserRating(res.userRating);
        onToast?.(`Rated ${star} star${star > 1 ? 's' : ''}`);
      }
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to rate');
    } finally {
      setBusy(false);
      setHover(null);
    }
  }

  const display = hover ?? userRating ?? 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{ display: 'flex', gap: 2 }}
        onMouseLeave={() => setHover(null)}
        role="radiogroup"
        aria-label="Rate this video"
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const filled = star <= display;
          return (
            <button
              key={star}
              type="button"
              disabled={busy}
              onClick={() => handleClick(star)}
              onMouseEnter={() => me && setHover(star)}
              onFocus={() => me && setHover(star)}
              title={`${star} star${star > 1 ? 's' : ''}`}
              aria-label={`Rate ${star}`}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: me ? 'pointer' : 'pointer',
                fontSize: size,
                lineHeight: 1,
                color: filled ? '#f5a623' : '#c8c8c8',
                transition: 'color 0.1s, transform 0.1s',
                transform: hover === star ? 'scale(1.15)' : 'scale(1)',
                fontFamily: 'inherit',
              }}
            >
              ★
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: '#606060', minWidth: 90 }}>
        {count > 0 ? (
          <>
            <strong style={{ color: '#0f0f0f' }}>{avg.toFixed(1)}</strong>
            <span> · {count} {count === 1 ? 'rating' : 'ratings'}</span>
          </>
        ) : (
          <span>No ratings yet</span>
        )}
      </div>
    </div>
  );
}
