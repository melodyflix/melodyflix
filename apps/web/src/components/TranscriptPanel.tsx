import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getVideoTranscript, searchVideoTranscript, getTranscriptLanguages,
  transcriptDownloadUrl,
  type Transcript, type TranscriptSearchHit,
} from '../lib/api';

interface Props {
  videoId: string;
  currentTime: number;
  onSeek: (seconds: number) => void;
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export default function TranscriptPanel({ videoId, currentTime, onSeek }: Props) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [languages, setLanguages] = useState<{ language: string; label: string }[]>([]);
  const [activeLang, setActiveLang] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<TranscriptSearchHit[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const cueRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  async function load(lang?: string) {
    setLoading(true);
    try {
      const [tRes, lRes] = await Promise.all([
        getVideoTranscript(videoId, lang),
        getTranscriptLanguages(videoId).catch(() => ({ languages: [] as any[] })),
      ]);
      setTranscript(tRes.transcript);
      setLanguages(lRes.languages ?? []);
      setActiveLang(tRes.transcript.language);
      setHits(null);
      setQuery('');
    } catch {
      setTranscript(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [videoId]);

  // Active cue based on currentTime
  const activeIdx = useMemo(() => {
    if (!transcript) return -1;
    for (let i = transcript.cues.length - 1; i >= 0; i--) {
      if (currentTime >= transcript.cues[i].start) return i;
    }
    return -1;
  }, [transcript, currentTime]);

  // Auto-scroll active cue into view
  useEffect(() => {
    if (!autoScroll || activeIdx < 0) return;
    const el = cueRefs.current.get(activeIdx);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIdx, autoScroll]);

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const q = query.trim();
    if (!q) { setHits(null); return; }
    setSearchBusy(true);
    try {
      const res = await searchVideoTranscript(videoId, q, activeLang);
      setHits(res.hits);
    } catch {
      setHits([]);
    } finally {
      setSearchBusy(false);
    }
  }

  function clearSearch() {
    setQuery('');
    setHits(null);
  }

  if (loading) {
    return <div className="mf-transcript-panel"><div style={{ padding: 20, color: '#909090', textAlign: 'center' }}>Loading transcript...</div></div>;
  }

  if (!transcript || transcript.cues.length === 0) {
    return (
      <div className="mf-transcript-panel">
        <div className="mf-transcript-header">
          <span className="mf-transcript-title">📝 Transcript</span>
        </div>
        <div style={{ padding: 20, color: '#909090', textAlign: 'center', fontSize: 13 }}>
          No transcript available for this video.
        </div>
      </div>
    );
  }

  const isSearchMode = hits !== null;
  const displayCues = isSearchMode
    ? hits!.map((h) => ({ ...h, index: h.index }))
    : transcript.cues.map((c) => ({ ...c, snippet: undefined as any }));

  return (
    <div className="mf-transcript-panel">
      <div className="mf-transcript-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span className="mf-transcript-title">📝 Transcript</span>
          <span className="mf-transcript-badge">{transcript.label}</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="mf-btn-text"
            onClick={() => setAutoScroll((v) => !v)}
            style={{ fontSize: 11, color: autoScroll ? '#065fd4' : '#909090' }}
            title="Auto-scroll with playback"
          >
            {autoScroll ? '🔒 Scroll' : '🔓 Scroll'}
          </button>
          <select
            className="mf-select"
            value={activeLang ?? ''}
            onChange={(e) => { const v = e.target.value; setActiveLang(v); load(v); }}
            style={{ fontSize: 11, padding: '4px 8px' }}
          >
            {languages.map((l) => (
              <option key={l.language} value={l.language}>{l.label}</option>
            ))}
            {languages.length === 0 && (
              <option value={transcript.language}>{transcript.label}</option>
            )}
          </select>
        </div>
      </div>

      <form onSubmit={handleSearch} className="mf-transcript-search">
        <input
          className="mf-input"
          placeholder="Search in transcript..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
        />
        {isSearchMode ? (
          <button type="button" className="mf-btn-text" onClick={clearSearch} style={{ fontSize: 12 }}>✕</button>
        ) : (
          <button type="submit" className="mf-btn-text" disabled={searchBusy || !query.trim()} style={{ fontSize: 12 }}>
            {searchBusy ? '...' : '🔍'}
          </button>
        )}
      </form>

      {isSearchMode && (
        <div className="mf-transcript-meta">
          {hits!.length} match{hits!.length === 1 ? '' : 'es'} for "{query}"
        </div>
      )}

      <div className="mf-transcript-cues">
        {displayCues.length === 0 ? (
          <div style={{ padding: 20, color: '#909090', textAlign: 'center', fontSize: 13 }}>
            No matches found.
          </div>
        ) : (
          displayCues.map((c) => {
            const active = !isSearchMode && activeIdx === c.index;
            const snippet = (c as any).snippet as string | undefined;
            return (
              <div
                key={c.index}
                ref={(el) => { if (el) cueRefs.current.set(c.index, el); }}
                className={`mf-transcript-cue ${active ? 'mf-transcript-cue-active' : ''}`}
                onClick={() => onSeek(c.start)}
              >
                <span className="mf-transcript-time">{fmt(c.start)}</span>
                <span className="mf-transcript-text">
                  {snippet
                    ? snippet.split(/\[\[|\]\]/).map((part, i) =>
                        i % 2 === 1
                          ? <mark key={i} className="mf-transcript-mark">{part}</mark>
                          : <span key={i}>{part}</span>
                      )
                    : c.text}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="mf-transcript-footer">
        <span>{transcript.word_count} words · {fmt(transcript.duration)}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <a className="mf-btn-text" href={transcriptDownloadUrl(videoId, 'txt', activeLang)} download style={{ fontSize: 11 }}>⬇ txt</a>
          <a className="mf-btn-text" href={transcriptDownloadUrl(videoId, 'srt', activeLang)} download style={{ fontSize: 11 }}>⬇ srt</a>
          <a className="mf-btn-text" href={transcriptDownloadUrl(videoId, 'vtt', activeLang)} download style={{ fontSize: 11 }}>⬇ vtt</a>
        </div>
      </div>
    </div>
  );
}
