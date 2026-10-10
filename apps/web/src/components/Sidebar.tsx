// melodyflix web - Sidebar (based on mockups/homepage.html)
import { Link, useLocation } from 'react-router-dom';

interface SidebarProps {
  expanded: boolean;
}

const MAIN_ITEMS = [
  { icon: '🏠', label: 'Home', path: '/' },
  { icon: '⚡', label: 'Shorts', path: '/shorts' },
  { icon: '📬', label: 'Subscriptions', path: '/subscriptions' },
];

const YOU_ITEMS = [
  { icon: '👤', label: 'You', path: '/my-channel' },
  { icon: '📺', label: 'Your channel', path: '/my-channel' },
  { icon: '🕐', label: 'History', path: '/history' },
  { icon: '📁', label: 'Playlists', path: '/playlists' },
  { icon: '🔖', label: 'Watch later', path: '/watch-later' },
  { icon: '👍', label: 'Liked videos', path: '/history' },
  { icon: '🎬', label: 'Your videos', path: '/my-videos' },
  { icon: '⬇️', label: 'Downloads', path: '/watch-later' },
];

const EXPLORE_ITEMS = [
  { icon: '🎓', label: 'Study', path: '/genre/education' },
  { icon: '🎬', label: 'Movies', path: '/genre/movie' },
  { icon: '🎭', label: 'Drama', path: '/genre/drama' },
  { icon: '📺', label: 'Web Series', path: '/series' },
  { icon: '🎵', label: 'Video Song', path: '/genre/music' },
  { icon: '🎧', label: 'Audio Song', path: '/podcasts' },
  { icon: '📡', label: 'Live TV', path: '/live-tv' },
  { icon: '📻', label: 'Radio', path: '/radio' },
  { icon: '🔴', label: 'Live Streaming', path: '/live' },
  { icon: '📰', label: 'Article', path: '/help' },
  { icon: '🎵', label: 'Music', path: '/genre/music' },
  { icon: '⚽', label: 'Sports', path: '/sports' },
  { icon: '🎮', label: 'Gaming', path: '/genre/gaming' },
  { icon: '🎮', label: 'Playables', path: '/shorts' },
];

const MORE_ITEMS = [
  { icon: '💎', label: 'MelodyFlix Premium', path: '/memberships' },
  { icon: '🎵', label: 'MelodyFlix Music', path: '/genre/music' },
  { icon: '👶', label: 'MelodyFlix Kids', path: '/genre/family' },
];

const FOOTER_LINKS_1 = ['About', 'Press', 'Copyright', 'Contact us', 'Creators', 'Advertise', 'Developers'];
const FOOTER_LINKS_2 = ['Terms', 'Privacy', 'Policy & Safety', 'How MelodyFlix works'];

function SidebarItem({ icon, label, path, expanded }: { icon: string; label: string; path: string; expanded: boolean }) {
  const location = useLocation();
  const active = location.pathname === path;
  return (
    <Link to={path} style={{ textDecoration: 'none' }}>
      <button className={`mf-sb-item ${active ? 'active' : ''}`} type="button">
        <span className="mf-sb-icon">{icon}</span>
        <span className="mf-sb-label">{label}</span>
      </button>
    </Link>
  );
}

export default function Sidebar({ expanded }: SidebarProps) {
  return (
    <aside className={`mf-sidebar-wrap ${expanded ? 'expanded' : ''}`}>
      <div className="mf-sidebar">
        {MAIN_ITEMS.map((it) => <SidebarItem key={it.label} {...it} expanded={expanded} />)}
        <div className="mf-sb-divider" />

        <div className="mf-sb-section-title">You</div>
        {YOU_ITEMS.map((it, i) => <SidebarItem key={`${it.label}-${i}`} {...it} expanded={expanded} />)}
        <div className="mf-sb-divider" />

        <div className="mf-sb-section-title">Explore</div>
        {EXPLORE_ITEMS.map((it, i) => <SidebarItem key={`${it.label}-${i}`} {...it} expanded={expanded} />)}
        <div className="mf-sb-divider" />

        <div className="mf-sb-section-title">More from MelodyFlix</div>
        {MORE_ITEMS.map((it) => <SidebarItem key={it.label} {...it} expanded={expanded} />)}
        <div className="mf-sb-divider" />

        <SidebarItem icon="📊" label="Report history" path="/help" expanded={expanded} />

        <div className="mf-sb-footer">
          <div>
            {FOOTER_LINKS_1.map((l) => <a key={l}>{l}</a>)}
          </div>
          <div style={{ marginTop: 10 }}>
            {FOOTER_LINKS_2.map((l) => <a key={l}>{l}</a>)}
          </div>
          <div className="mf-sb-copyright">© Melodyflix Technologies 2026</div>
        </div>
      </div>
    </aside>
  );
}
