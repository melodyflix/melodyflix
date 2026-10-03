// melodyflix web — Time-Shift seek slider (Section 40.5)
import { useEffect, useState } from 'react';
import {
  getLiveTvTimeshiftWindow, seekLiveTvTimeshift,
  TimeshiftWindow, TimeshiftSeekResult,
} from '../lib/api';

interface Props {
  channelId: string;
  onSeek?: (result: TimeshiftSeekResult) => void;
}

export default function TimeshiftSlider({ channelId, onSeek }: Props) {
  const [win, setWin] = useState<TimeshiftWindow | null>(null);
  const [offsetSeconds, setOffsetSeconds] = useState(0); // seconds behind live
  const [seekResult, setSeekResult] = useState<TimeshiftSeekResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const w = await getLiveTvTimeshiftWindow(channelId);
        if (!cancelled) setWin(w);
      } catch {
        if (!cancelled) setWin(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [channelId]);

  // Refresh window every 30s
  useEffect(() => {
    const t = setInterval(() => {
      getLiveTvTimeshiftWindow(channelId).then(setWin).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [channelId]);

  const doSeek = async (offset: number) => {
    setOffsetSeconds(offset);
    if (offset === 0) {
      setSeekResult(null);
      onSeek?.({ allowed: true, reason: 'ok', at_ts: new Date().toISOString(), earliest_ts: null, latest_ts: null, segments: [] });
      return;
    }
    const at = new Date(Date.now() - offset * 1000).toISOString();
    try {
      const res = await seekLiveTvTimeshift(channelId, at);
      setSeekResult(res);
      onSeek?.(res);
    } catch (e) {
      setSeekResult(null);
    }
  };

  const fmtOffset = (s: number) => {
    if (s === 0) return 'LIVE';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `-${h}h ${m}m`;
    if (m > 0) return `-${m}m ${sec}s`;
    return `-${sec}s`;
  };

  if (loading) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: '#888' }}>
        Loading time-shift…
      </div>
    );
  }

  if (!win || win.segment_count === 0) {
    return (
      <div style={{
        padding: 12, fontSize: 12, color: '#888',
        background: '#fafafa', borderRadius: 8,
        border: '1px solid #eee',
      }}>
        ⏪ Time-shift: no buffer available for this channel yet.
      </div>
    );
  }

  const maxOffset = win.window_seconds;
  const disabled = !win.earliest_ts;

  return (
    <div style={{
      padding: 12, background: '#fafafa', border: '1px solid #eee', borderRadius: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>
          ⏪ Time-Shift
        </div>
        <div style={{
          fontSize: 12, fontWeight: 700,
          color: offsetSeconds === 0 ? '#d00' : '#0a7',
          background: offsetSeconds === 0 ? '#ffeaea' : '#e6f7f0',
          padding: '2px 8px', borderRadius: 6,
        }}>
          {fmtOffset(offsetSeconds)}
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={maxOffset}
        step={5}
        value={offsetSeconds}
        disabled={disabled}
        onChange={(e) => doSeek(parseInt(e.target.value))}
        style={{ width: '100%', accentColor: '#0a7' }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginTop: 4 }}>
        <span>{fmtOffset(maxOffset)}</span>
        <span>LIVE</span>
      </div>

      {seekResult && !seekResult.allowed && (
        <div style={{ fontSize: 11, color: 'crimson', marginTop: 6 }}>
          {seekResult.reason === 'before_window' ? 'Cannot seek further back than available buffer'
            : seekResult.reason === 'future' ? 'Cannot seek into the future'
            : 'Seek unavailable'}
        </div>
      )}

      {seekResult && seekResult.allowed && offsetSeconds > 0 && (
        <div style={{ fontSize: 11, color: '#0a7', marginTop: 6 }}>
          ✓ Seeking to {new Date(seekResult.at_ts).toLocaleTimeString()} ({seekResult.segments.length} segments)
        </div>
      )}

      <button
        onClick={() => doSeek(0)}
        disabled={offsetSeconds === 0}
        style={{
          marginTop: 8, padding: '4px 10px', borderRadius: 6,
          fontSize: 11, cursor: offsetSeconds === 0 ? 'default' : 'pointer',
          background: offsetSeconds === 0 ? '#eee' : '#fff',
          color: offsetSeconds === 0 ? '#999' : '#d00',
          border: `1px solid ${offsetSeconds === 0 ? '#eee' : '#f5c6c6'}`,
        }}
      >
        ⏵ Jump to live
      </button>
    </div>
  );
}
