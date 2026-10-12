// melodyflix web - Sidebar (two-mode: fixed icon bar + hamburger drawer)
// Per master UI spec: 72px icon bar always visible; 240px drawer overlay on ☰
import { Link, useLocation } from 'react-router-dom';

interface SidebarProps {
  expanded: boolean;   // when true → drawer open (overlay)
}

// Compact icon bar (always visible, 72px)
const ICON_BAR_ITEMS = [
  { icon: '🏠', label: 'Home', path: '/' },
  { icon: '⚡', label: 'Shorts', path: '/shorts' },
  { icon: '🔔', label: 'Subscriptions', path: '/subscriptions' },
  { icon: '💬', label: 'Messenger', path: '/notifications' },
  { icon: '📚', label: 'Study', path: '/genre/education' },
  { icon: '🎬', label: 'Movies', path: '/genre/movie' },
  { icon: '🎵', label: 'Music', path: '/genre/music' },
  { icon: '📻', label: 'Radio', path: '/radio' },
  { icon: '👤', label: 'You', path: '/my-channel' },
];

// Full drawer sections
const DRAWER_PRIMARY = [
  { icon: '🏠', label: 'Home', path: '/' },
  { icon: '⚡', label: 'Shorts', path: '/shorts' },
  { icon: '🔔', label: 'Subscriptions', path: '/subscriptions' },
];

const DRAWER_MESSENGER = [
  { icon: '💬', label: 'Quick Chat', path: '/notifications' },
  { icon: '📇', label: 'Saved Contacts', path: '/notifications' },
];

const DRAWER_YOU = [
  { icon: '🕐', label: 'History', path: '/history' },
  { icon: '📁', label: 'Playlists', path: '/playlists' },
  { icon: '🔖', label: 'Watch Later', path: '/watch-later' },
  { icon: '👍', label: 'Liked Videos', path: '/history' },
];

const DRAWER_CATEGORIES = [
  { icon: '📚', label: 'Study', path: '/genre/education' },
  { icon: '🎬', label: 'Movies & Dramas', path: '/genre/movie' },
  { icon: '🎵', label: 'Music & Videos', path: '/genre/music' },
  { icon: '📺', label: 'Web Series', path: '/series' },
  { icon: '📡', label: 'Live TV', path: '/live-tv' },
  { icon: '📻', label: 'Radio', path: '/radio' },
  { icon: '📰', label: 'Article & News', path: '/help' },
];

const DRAWER_SYSTEM = [
  { icon: '⚙️', label: 'Settings', path: '/preferences' },
  { icon: '📊', label: 'Report History', path: '/help' },
  { icon: '❓', label: 'Help & Send Feedback', path: '/help' },
];

const FOOTER_LINKS_1 = ['About', 'Press', 'Copyright', 'Contact us', 'Creators', 'Advertise', 'Developers'];
const FOOTER_LINKS_2 = ['Terms', 'Privacy', 'Policy & Safety', 'How MelodyFlix works'];

function Item({ icon, label, path }: { icon: string; label: string; path: string }) {
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

function IconBarItem({ icon, label, path }: { icon: string; label: string; path: string }) {
  const location = useLocation();
  const active = location.pathname === path;
  return (
    <Link to={path} style={{ textDecoration: 'none' }} title={label}>
      <button className={`mf-icon-bar-item ${active ? 'active' : ''}`} type="button" aria-label={label}>
        <span className="mf-icon-bar-emoji">{icon}</span>
        <span className="mf-icon-bar-label">{label}</span>
      </button>
    </Link>
  );
}

export default function Sidebar({ expanded }: SidebarProps) {
  return (
    <>
      {/* FIXED ICON BAR (72px, always visible) */}
      <aside className="mf-icon-bar">
        {ICON_BAR_ITEMS.map((it) => (
          <IconBarItem key={it.label} {...it} />
        ))}
      </aside>

      {/* OVERLAY BACKDROP (only when drawer open) */}
      {expanded && (
        <div
          className="mf-drawer-backdrop"
          onClick={() => {
            // close by simulating toggle — handled by parent via context; fallback: remove class
            document.body.classList.remove('sidebar-expanded');
          }}
        />
      )}

      {/* HAMBURGER DRAWER (240px, overlay) */}
      <aside className={`mf-drawer ${expanded ? 'open' : ''}`}>
        {/* Primary */}
        {DRAWER_PRIMARY.map((it) => <Item key={it.label} {...it} />)}
        <div className="mf-sb-divider" />

        {/* Messenger */}
        <div className="mf-sb-section-title">Messenger</div>
        {DRAWER_MESSENGER.map((it) => <Item key={it.label} {...it} />)}
        <div className="mf-sb-divider" />

        {/* You */}
        <div className="mf-sb-section-title">You</div>
        {DRAWER_YOU.map((it) => <Item key={it.label} {...it} />)}
        <div className="mf-sb-divider" />

        {/* Categories */}
        <div className="mf-sb-section-title">Categories</div>
        {DRAWER_CATEGORIES.map((it) => <Item key={it.label} {...it} />)}
        <div className="mf-sb-divider" />

        {/* System */}
        {DRAWER_SYSTEM.map((it) => <Item key={it.label} {...it} />)}

        {/* Footer */}
        <div className="mf-sb-footer">
          <div>{FOOTER_LINKS_1.map((l) => <a key={l}>{l}</a>)}</div>
          <div style={{ marginTop: 10 }}>{FOOTER_LINKS_2.map((l) => <a key={l}>{l}</a>)}</div>
          <div className="mf-sb-copyright">© Melodyflix Technologies 2026</div>
        </div>
      </aside>
    </>
  );
}
