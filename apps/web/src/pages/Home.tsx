// melodyflix web - Home page (YouTube-style, based on mockups/homepage.html)
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import '../styles/mockup.css';

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

const CATEGORY_CHIPS = [
  { icon: '🎓', label: 'Study' },
  { icon: '🎬', label: 'Movies' },
  { icon: '🎭', label: 'Drama' },
  { icon: '📺', label: 'Web Series' },
  { icon: '🎵', label: 'Video Song' },
  { icon: '🎧', label: 'Audio Song' },
  { icon: '📡', label: 'Live TV' },
  { icon: '📻', label: 'Radio' },
  { icon: '🔴', label: 'Live Streaming' },
  { icon: '📰', label: 'Article' },
  { icon: '🎵', label: 'Music' },
  { icon: '⚽', label: 'Sports' },
  { icon: '🎮', label: 'Gaming' },
  { icon: '💎', label: 'Memberships' },
];

const HERO_SLIDES = [
  { emoji: '🎓', title: 'Study Room', sub: 'Featured course', cls: 's1' },
  { emoji: '🎬', title: 'Movies', sub: 'Now trending', cls: 's2' },
  { emoji: '📻', title: 'Radio', sub: 'Listen live', cls: 's3' },
  { emoji: '📺', title: 'Live TV', sub: 'Broadcasting now', cls: 's4' },
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
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K views`;
  return `${n} views`;
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
  return `${mo} month${mo > 1 ? 's' : ''} ago`;
}


export default function Home() {
  const [trending, setTrending] = useState<VideoCard[]>([]);
  const [shorts, setShorts] = useState<VideoCard[]>([]);
  const [liveNow, setLiveNow] = useState<VideoCard[]>([]);
  const [music, setMusic] = useState<VideoCard[]>([]);
  const [sports, setSports] = useState<VideoCard[]>([]);
  const [news, setNews] = useState<VideoCard[]>([]);
  const [study, setStudy] = useState<VideoCard[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Auto-rotate hero
  useEffect(() => {
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % HERO_SLIDES.length), 4000);
    return () => clearInterval(t);
  }, []);

  // Fetch all sections in parallel
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [tR, sR, lR, mR, spR, nR, stR] = await Promise.all([
          fetch('/api/v1/videos/trending?limit=8').then((r) => r.json()).catch(() => ({})),
          fetch('/api/v1/videos/content-type/short?limit=6').then((r) => r.json()).catch(() => ({})),
          fetch('/api/v1/videos/live-tv/channels').then((r) => r.json()).catch(() => ({})),
          fetch('/api/v1/videos/content-type/music_video?limit=6').then((r) => r.json()).catch(() => ({})),
          fetch('/api/v1/videos/genres/sports/videos?limit=6').then((r) => r.json()).catch(() => ({})),
          fetch('/api/v1/videos/content-type/news?limit=6').then((r) => r.json()).catch(() => ({})),
          fetch('/api/v1/videos/content-type/video?limit=6').then((r) => r.json()).catch(() => ({})),
        ]);
        if (cancelled) return;
        setTrending(tR?.data?.videos ?? []);
        setShorts(sR?.data?.videos ?? []);
        setLiveNow(lR?.data?.channels ?? []);
        setMusic(mR?.data?.videos ?? []);
        setSports(spR?.data?.videos ?? []);
        setNews(nR?.data?.videos ?? []);
        setStudy(stR?.data?.videos ?? []);
      } catch (e: any) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="mf-content">
      {/* HERO CAROUSEL */}
      <div className="mf-hero">
        {HERO_SLIDES.map((s, i) => (
          <div
            key={i}
            className={`mf-hero-slide ${s.cls} ${i === heroIdx ? 'active' : ''}`}
          >
            {s.emoji} {s.title}<span className="sub">{s.sub}</span>
          </div>
        ))}
        <div className="mf-hero-controls">
          {HERO_SLIDES.map((_, i) => (
            <button
              key={i}
              className={`mf-hero-dot ${i === heroIdx ? 'active' : ''}`}
              onClick={() => setHeroIdx(i)}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {err && <div style={{ padding: 16, color: '#b91c1c' }}>⚠️ {err}</div>}

      {/* TRENDING */}
      <h2 className="mf-grid-section-title">Trending</h2>
      <div className="mf-grid">
        {trending.length === 0 && !loading && (
          <div className="mf-vcard">
            <div className="mf-thumb">🎬<span className="mf-dur">—</span></div>
            <div className="mf-vmeta"><div className="mf-vavatar">V</div><div>
              <div className="mf-vtitle">No trending videos yet</div>
              <div className="mf-vchannel">Be the first to upload</div>
              <div className="mf-vstats">0 views</div>
            </div></div>
          </div>
        )}
        {trending.map((v) => (
          <Link to={`/watch/${v.id}`} key={v.id} className="mf-vcard" style={{ textDecoration: 'none' }}>
            <div
              className="mf-thumb"
              style={v.thumbnail_url ? { backgroundImage: `url(${v.thumbnail_url})`, backgroundSize: 'cover', color: 'transparent' } : {}}
            >
              {!v.thumbnail_url && '🎬'}
              {v.duration_seconds > 0 && <span className="mf-dur">{formatDuration(v.duration_seconds)}</span>}
            </div>
            <div className="mf-vmeta">
              <div className="mf-vavatar">{(v.channel_name ?? 'V').charAt(0).toUpperCase()}</div>
              <div>
                <div className="mf-vtitle">{v.title}</div>
                <div className="mf-vchannel">{v.channel_name ?? 'Channel'}</div>
                <div className="mf-vstats">{formatViews(v.view_count ?? 0)} · {formatAgo(v.created_at)}</div>
              </div>
            </div>
          </Link>
        ))}

        <div className="mf-highlight-card">
          <div className="mf-highlight-content">
            <div className="mf-highlight-icon">🎓</div>
            <div>
              <div className="mf-highlight-title">Study Room — Explore More</div>
              <div className="mf-highlight-sub">1000+ free courses, tutorials, and classes</div>
            </div>
          </div>
          <Link to="/genre/education" className="mf-highlight-cta" style={{ textDecoration: 'none' }}>Explore →</Link>
        </div>
      </div>

      {/* SHORTS */}
      <h2 className="mf-grid-section-title">Shorts</h2>
      <div className="mf-grid">
        {shorts.length === 0 && !loading && (
          <div className="mf-vcard">
            <div className="mf-thumb" style={{ aspectRatio: '9/16' }}>⚡<span className="mf-dur">0:30</span></div>
            <div className="mf-vmeta"><div className="mf-vavatar">S</div><div>
              <div className="mf-vtitle">No shorts yet</div>
              <div className="mf-vchannel">Upload your first short!</div>
              <div className="mf-vstats">0 views</div>
            </div></div>
          </div>
        )}
        {shorts.map((v) => (
          <Link to={`/watch/${v.id}`} key={v.id} className="mf-vcard" style={{ textDecoration: 'none' }}>
            <div className="mf-thumb" style={{ aspectRatio: '9/16' }}>
              ⚡
              {v.duration_seconds > 0 && <span className="mf-dur">{formatDuration(v.duration_seconds)}</span>}
            </div>
            <div className="mf-vmeta"><div className="mf-vavatar">{(v.channel_name ?? 'S').charAt(0)}</div><div>
              <div className="mf-vtitle">{v.title}</div>
              <div className="mf-vchannel">{v.channel_name ?? 'Shorts Channel'}</div>
              <div className="mf-vstats">{formatViews(v.view_count ?? 0)}</div>
            </div></div>
          </Link>
        ))}
      </div>

      {/* LIVE NOW */}
      <h2 className="mf-grid-section-title">Live Now</h2>
      <div className="mf-grid">
        {liveNow.length === 0 && !loading && (
          <div className="mf-vcard">
            <div className="mf-thumb" style={{ background: 'linear-gradient(135deg,#dc2626,#f87171)', color: '#fff' }}>🔴<span className="mf-dur">LIVE</span></div>
            <div className="mf-vmeta"><div className="mf-vavatar">L</div><div>
              <div className="mf-vtitle">No live channels</div>
              <div className="mf-vchannel">Nothing broadcasting now</div>
              <div className="mf-vstats">0 watching</div>
            </div></div>
          </div>
        )}
        {liveNow.map((c: any) => (
          <Link to={`/live-tv/${c.id}`} key={c.id} className="mf-vcard" style={{ textDecoration: 'none' }}>
            <div className="mf-thumb" style={{ background: 'linear-gradient(135deg,#dc2626,#f87171)', color: '#fff' }}>
              🔴<span className="mf-dur">LIVE</span>
            </div>
            <div className="mf-vmeta"><div className="mf-vavatar">L</div><div>
              <div className="mf-vtitle">{c.name ?? c.title}</div>
              <div className="mf-vchannel">{c.region ?? 'Live Channel'}</div>
              <div className="mf-vstats">{c.viewer_count ?? 0} watching</div>
            </div></div>
          </Link>
        ))}
      </div>


      {/* STUDY ROOM */}
      <h2 className="mf-grid-section-title">Study Room — Recommended</h2>
      <div className="mf-grid">
        {study.length === 0 && !loading && (
          <div className="mf-vcard">
            <div className="mf-thumb">🎓<span className="mf-dur">—</span></div>
            <div className="mf-vmeta"><div className="mf-vavatar">E</div><div>
              <div className="mf-vtitle">No courses yet</div>
              <div className="mf-vchannel">Study Room</div>
              <div className="mf-vstats">0 views</div>
            </div></div>
          </div>
        )}
        {study.slice(0, 4).map((v) => (
          <Link to={`/watch/${v.id}`} key={v.id} className="mf-vcard" style={{ textDecoration: 'none' }}>
            <div className="mf-thumb">🎓{v.duration_seconds > 0 && <span className="mf-dur">{formatDuration(v.duration_seconds)}</span>}</div>
            <div className="mf-vmeta"><div className="mf-vavatar">E</div><div>
              <div className="mf-vtitle">{v.title}</div>
              <div className="mf-vchannel">{v.channel_name ?? 'Study Room'}</div>
              <div className="mf-vstats">{formatViews(v.view_count ?? 0)}</div>
            </div></div>
          </Link>
        ))}
      </div>

      {/* MUSIC */}
      <h2 className="mf-grid-section-title">Music Videos</h2>
      <div className="mf-grid">
        {music.length === 0 && !loading && (
          <div className="mf-vcard">
            <div className="mf-thumb">🎵<span className="mf-dur">—</span></div>
            <div className="mf-vmeta"><div className="mf-vavatar">M</div><div>
              <div className="mf-vtitle">No music videos yet</div>
              <div className="mf-vchannel">Music Label</div>
              <div className="mf-vstats">0 views</div>
            </div></div>
          </div>
        )}
        {music.slice(0, 4).map((v) => (
          <Link to={`/watch/${v.id}`} key={v.id} className="mf-vcard" style={{ textDecoration: 'none' }}>
            <div className="mf-thumb">🎵{v.duration_seconds > 0 && <span className="mf-dur">{formatDuration(v.duration_seconds)}</span>}</div>
            <div className="mf-vmeta"><div className="mf-vavatar">M</div><div>
              <div className="mf-vtitle">{v.title}</div>
              <div className="mf-vchannel">{v.channel_name ?? 'Music Label'}</div>
              <div className="mf-vstats">{formatViews(v.view_count ?? 0)}</div>
            </div></div>
          </Link>
        ))}
      </div>

      {/* SPORTS */}
      <h2 className="mf-grid-section-title">Sports</h2>
      <div className="mf-grid">
        {sports.length === 0 && !loading && (
          <div className="mf-vcard">
            <div className="mf-thumb">⚽<span className="mf-dur">—</span></div>
            <div className="mf-vmeta"><div className="mf-vavatar">S</div><div>
              <div className="mf-vtitle">No sports videos yet</div>
              <div className="mf-vchannel">Sports</div>
              <div className="mf-vstats">0 views</div>
            </div></div>
          </div>
        )}
        {sports.slice(0, 4).map((v) => (
          <Link to={`/watch/${v.id}`} key={v.id} className="mf-vcard" style={{ textDecoration: 'none' }}>
            <div className="mf-thumb">⚽{v.duration_seconds > 0 && <span className="mf-dur">{formatDuration(v.duration_seconds)}</span>}</div>
            <div className="mf-vmeta"><div className="mf-vavatar">S</div><div>
              <div className="mf-vtitle">{v.title}</div>
              <div className="mf-vchannel">{v.channel_name ?? 'Sports'}</div>
              <div className="mf-vstats">{formatViews(v.view_count ?? 0)}</div>
            </div></div>
          </Link>
        ))}
      </div>

      {/* NEWS */}
      <h2 className="mf-grid-section-title">News &amp; Articles</h2>
      <div className="mf-grid">
        {news.length === 0 && !loading && (
          <div className="mf-vcard">
            <div className="mf-thumb">📰<span className="mf-dur">—</span></div>
            <div className="mf-vmeta"><div className="mf-vavatar">N</div><div>
              <div className="mf-vtitle">No news yet</div>
              <div className="mf-vchannel">News</div>
              <div className="mf-vstats">0 views</div>
            </div></div>
          </div>
        )}
        {news.slice(0, 4).map((v) => (
          <Link to={`/watch/${v.id}`} key={v.id} className="mf-vcard" style={{ textDecoration: 'none' }}>
            <div className="mf-thumb">📰{v.duration_seconds > 0 && <span className="mf-dur">{formatDuration(v.duration_seconds)}</span>}</div>
            <div className="mf-vmeta"><div className="mf-vavatar">N</div><div>
              <div className="mf-vtitle">{v.title}</div>
              <div className="mf-vchannel">{v.channel_name ?? 'News'}</div>
              <div className="mf-vstats">{formatViews(v.view_count ?? 0)}</div>
            </div></div>
          </Link>
        ))}
      </div>
    </main>
  );
}
