// melodyflix web - Home (7 categories × 6×2 grid, per master UI spec)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

interface VideoCard {
  id: string;
  title: string;
  thumbnail_url: string | null;
  channel_id: string;
  channel_name?: string;
  duration_seconds: number;
  view_count: number;
  created_at: string;
  content_type?: string;
}

interface CategoryDef {
  key: string;
  label: string;
  icon: string;
  path: string;
  contentType?: string;
  genre?: string;
  subcats: string[];
}

// Order per spec: Movies & Dramas → Music & Videos → Web Series → Live TV → Radio → Study → Article & News
const CATEGORIES: CategoryDef[] = [
  {
    key: 'movies',
    label: 'Movies & Dramas',
    icon: '🎬',
    path: '/genre/movie',
    contentType: 'movie',
    subcats: ['Action', 'Romantic', 'Comedy', 'Thriller', 'Horror'],
  },
  {
    key: 'music',
    label: 'Music & Videos',
    icon: '🎵',
    path: '/genre/music',
    contentType: 'music_video',
    subcats: ['Pop', 'Rock', 'Folk', 'Classical', 'Hip Hop'],
  },
  {
    key: 'web_series',
    label: 'Web Series',
    icon: '📺',
    path: '/series',
    contentType: 'web_series',
    subcats: ['Drama', 'Thriller', 'Comedy', 'Documentary'],
  },
  {
    key: 'livetv',
    label: 'Live TV',
    icon: '📡',
    path: '/live-tv',
    contentType: 'video',
    subcats: ['News', 'Sports', 'Entertainment', 'Kids'],
  },
  {
    key: 'radio',
    label: 'Radio',
    icon: '📻',
    path: '/radio',
    contentType: 'podcast',
    subcats: ['FM', 'Podcast', 'Music', 'Talk'],
  },
  {
    key: 'study',
    label: 'Study',
    icon: '📚',
    path: '/genre/education',
    contentType: 'video',
    genre: 'education',
    subcats: ['Courses', 'Tutorials', 'Science', 'Math', 'Language'],
  },
  {
    key: 'news',
    label: 'Article & News',
    icon: '📰',
    path: '/help',
    contentType: 'news',
    subcats: ['Breaking', 'Politics', 'Tech', 'Sports', 'Business'],
  },
];

const TOPIC_CHIPS = [
  'All', 'Action Movies', 'Web Development', 'Classical Music',
  'Tech News', 'Romantic Drama', 'Spoken English', 'Live Sports',
  'Comedy Skits', 'Devotional', 'Documentary',
];

function formatDuration(sec: number): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
  const mo = Math.floor(d / 30);
  return `${mo} mo ago`;
}

// ============ Video card ============
function VideoCardItem({ v }: { v: VideoCard }) {
  return (
    <Link to={`/watch/${v.id}`} className="mf-vcard" style={{ textDecoration: 'none' }}>
      <div
        className="mf-thumb"
        style={v.thumbnail_url ? {
          backgroundImage: `url(${v.thumbnail_url})`,
          backgroundSize: 'cover',
          color: 'transparent',
        } : {}}
      >
        {!v.thumbnail_url && '🎬'}
        {v.duration_seconds > 0 && (
          <span className="mf-dur">{formatDuration(v.duration_seconds)}</span>
        )}
      </div>
      <div className="mf-vmeta">
        <div className="mf-vavatar">{(v.channel_name ?? 'V').charAt(0).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div className="mf-vtitle" title={v.title}>{v.title}</div>
          <div className="mf-vchannel">{v.channel_name ?? 'Channel'}</div>
          <div className="mf-vstats">
            {formatViews(v.view_count ?? 0)} views · {formatAgo(v.created_at)}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ============ Category section (3 layers) ============
interface SectionState {
  videos: VideoCard[];
  loading: boolean;
  loaded: number;   // how many videos currently shown
}

function CategorySection({ def, initial }: { def: CategoryDef; initial: SectionState }) {
  const [state, setState] = useState<SectionState>(initial);
  const [subcat, setSubcat] = useState<string>(def.subcats[0] ?? '');

  // Load more (adds 6 more cards)
  function loadMore() {
    if (state.loaded >= state.videos.length) return;
    setState((s) => ({ ...s, loaded: Math.min(s.loaded + 6, s.videos.length) }));
  }

  const visible = state.videos.slice(0, state.loaded);
  const hasMore = state.loaded < state.videos.length;

  return (
    <section className="mf-category-section">
      {/* LAYER 1 — Upper sub-header */}
      <div className="mf-cat-header">
        <div className="mf-cat-title">
          <span className="mf-cat-icon">{def.icon}</span>
          <span className="mf-cat-name">{def.label}</span>
        </div>
        <div className="mf-cat-subcats">
          {def.subcats.map((sc) => (
            <button
              key={sc}
              className={`mf-subcat-chip ${subcat === sc ? 'active' : ''}`}
              onClick={() => setSubcat(sc)}
            >
              {sc}
            </button>
          ))}
        </div>
      </div>

      {/* LAYER 2 — 6×2 grid */}
      {state.loading && visible.length === 0 ? (
        <div className="mf-cat-empty">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="mf-cat-empty">No videos yet in {def.label}</div>
      ) : (
        <div className="mf-grid mf-grid-6x2">
          {visible.map((v) => <VideoCardItem key={v.id} v={v} />)}
        </div>
      )}

      {/* LAYER 3 — Lower sub-header */}
      <div className="mf-cat-footer">
        <Link to={def.path} className="mf-cat-seeall-left">
          <button className="mf-cat-catname-btn">
            {def.label} <span className="arrow">→</span>
          </button>
        </Link>
        <div className="mf-cat-footer-center">
          {hasMore && (
            <button className="mf-loadmore-btn" onClick={loadMore}>
              Load More <span className="arrow">⬇</span>
            </button>
          )}
        </div>
        <Link to={def.path} className="mf-cat-seeall-right">
          <button className="mf-seeall-btn">
            See All <span className="arrow">→</span>
          </button>
        </Link>
      </div>
    </section>
  );
}

// ============ Main Home ============
export default function Home() {
  const [sections, setSections] = useState<Record<string, SectionState>>({});
  const [activeChip, setActiveChip] = useState<string>('All');

  useEffect(() => {
    let cancelled = false;

    async function loadCategory(def: CategoryDef) {
      try {
        // Build API URL — prefer content-type filter, else genre, else trending
        let url = '/api/v1/videos/trending?limit=24';
        if (def.contentType) {
          url = `/api/v1/videos/content-type/${def.contentType}?limit=24`;
        }
        if (def.genre) {
          url = `/api/v1/videos/genre/${def.genre}?limit=24`;
        }
        const r = await fetch(url).then((res) => res.json()).catch(() => ({}));
        const videos: VideoCard[] = r?.data?.videos ?? [];
        if (cancelled) return;
        setSections((s) => ({
          ...s,
          [def.key]: {
            videos,
            loading: false,
            loaded: Math.min(12, videos.length),
          },
        }));
      } catch {
        if (cancelled) return;
        setSections((s) => ({
          ...s,
          [def.key]: { videos: [], loading: false, loaded: 0 },
        }));
      }
    }

    // Initialize all sections with loading=true
    const initial: Record<string, SectionState> = {};
    for (const def of CATEGORIES) {
      initial[def.key] = { videos: [], loading: true, loaded: 0 };
    }
    setSections(initial);

    // Load all categories in parallel
    Promise.all(CATEGORIES.map(loadCategory));

    return () => { cancelled = true; };
  }, []);

  return (
    <main className="mf-content">
      {/* TOPIC FILTER CHIPS */}
      <div className="mf-topics-strip">
        {TOPIC_CHIPS.map((c) => (
          <button
            key={c}
            className={`mf-chip ${activeChip === c ? 'active' : ''}`}
            onClick={() => setActiveChip(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 7 CATEGORY SECTIONS */}
      {CATEGORIES.map((def) => {
        const st = sections[def.key] ?? { videos: [], loading: true, loaded: 0 };
        return <CategorySection key={def.key} def={def} initial={st} />;
      })}
    </main>
  );
}
