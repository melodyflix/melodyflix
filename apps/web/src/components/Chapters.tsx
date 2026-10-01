import { useEffect, useState } from 'react';
import { getChapters, formatTime, type Chapter } from '../lib/api';

interface Props {
  videoId: string;
  currentTime: number;
  onSeek: (seconds: number) => void;
}

export default function Chapters({ videoId, currentTime, onSeek }: Props) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [source, setSource] = useState<'manual' | 'auto' | 'none'>('none');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!videoId) return;
    setLoading(true);
    getChapters(videoId)
      .then((res) => {
        setChapters(res.chapters);
        setSource(res.source);
      })
      .catch(() => {
        setChapters([]);
        setSource('none');
      })
      .finally(() => setLoading(false));
  }, [videoId]);

  if (loading || chapters.length === 0) return null;

  // Find active chapter (last chapter whose start_seconds <= currentTime)
  let activeIndex = -1;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start_seconds <= currentTime) activeIndex = i;
    else break;
  }

  const activeChapter = activeIndex >= 0 ? chapters[activeIndex] : null;

  return (
    <div className="mf-chapters">
      <div className="mf-chapters-header" onClick={() => setExpanded(!expanded)}>
        <div className="mf-chapters-title">
          <span className="mf-chapters-icon">📑</span>
          <span>Chapters</span>
          <span className="mf-chapters-count">({chapters.length})</span>
          {source === 'auto' && (
            <span className="mf-chapters-badge mf-chapters-badge-auto" title="Auto-detected from description">
              auto
            </span>
          )}
          {source === 'manual' && (
            <span className="mf-chapters-badge mf-chapters-badge-manual" title="Manually set by creator">
              creator
            </span>
          )}
        </div>
        <span className="mf-chapters-toggle">{expanded ? '▾' : '▸'}</span>
      </div>

      {activeChapter && !expanded && (
        <div className="mf-chapters-current">
          Now: {formatTime(activeChapter.start_seconds)} — {activeChapter.title}
        </div>
      )}

      {expanded && (
        <div className="mf-chapters-list">
          {chapters.map((ch, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={ch.id}
                type="button"
                className={`mf-chapter-item${isActive ? ' mf-chapter-active' : ''}`}
                onClick={() => onSeek(ch.start_seconds)}
              >
                <span className="mf-chapter-time">{formatTime(ch.start_seconds)}</span>
                <span className="mf-chapter-title">{ch.title}</span>
                {isActive && <span className="mf-chapter-playing">▶</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
