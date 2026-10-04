// melodyflix - desktop left sidebar (YouTube-style)
import { useLocation, useNavigate } from 'react-router-dom';

interface Props {
  collapsed: boolean;
  user: { username: string } | null;
  onSignIn: () => void;
}

interface Item {
  path: string;
  label: string;
  icon: string;
  dividerAfter?: boolean;
  requiresAuth?: boolean;
}

const PRIMARY: Item[] = [
  { path: '/', label: 'Home', icon: '🏠' },
  { path: '/shorts', label: 'Shorts', icon: '📱' },
  { path: '/subscriptions', label: 'Subscriptions', icon: '📬', requiresAuth: true },
];

const LIBRARY: Item[] = [
  { path: '/my-channel', label: 'You', icon: '👤', requiresAuth: true },
  { path: '/history', label: 'History', icon: '🕐', requiresAuth: true },
  { path: '/playlists', label: 'Playlists', icon: '📁', requiresAuth: true },
  { path: '/my-videos', label: 'Your Videos', icon: '🎬', requiresAuth: true },
  { path: '/watch-later', label: 'Watch Later', icon: '🔖', requiresAuth: true },
];

const EXPLORE: Item[] = [
  { path: '/trending', label: 'Trending', icon: '🔥' },
  { path: '/live', label: 'Live', icon: '📡' },
  { path: '/radio', label: 'Radio', icon: '📻' },
  { path: '/sports', label: 'Sports', icon: '⚽' },
  { path: '/podcasts', label: 'Podcasts', icon: '🎙️' },
  { path: '/series', label: 'Series', icon: '📺' },
  { path: '/live-tv', label: 'Live TV', icon: '📺' },
  { path: '/live-tv/recordings', label: 'DVR Recordings', icon: '🎥' },
];

const MORE: Item[] = [
  { path: '/studio', label: 'Creator Studio', icon: '🎨', requiresAuth: true },
  { path: '/analytics', label: 'Analytics', icon: '📊', requiresAuth: true },
  { path: '/settings/preferences', label: 'Settings', icon: '⚙️', requiresAuth: true },
  { path: '/help', label: 'Help', icon: '🆘' },
];

export default function Sidebar({ collapsed, user, onSignIn }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  function handleClick(item: Item) {
    if (item.requiresAuth && !user) { onSignIn(); return; }
    navigate(item.path);
  }

  function isActive(path: string): boolean {
    const current = location.pathname;
    if (path === '/') return current === '/';
    return current === path || current.startsWith(path + '/');
  }

  function renderSection(items: Item[], showDivider = true) {
    return (
      <>
        {items.map((item) => (
          <button
            key={item.path}
            onClick={() => handleClick(item)}
            className={`mf-sb-item ${isActive(item.path) ? 'active' : ''}`}
            title={collapsed ? item.label : undefined}
          >
            <span className="mf-sb-icon">{item.icon}</span>
            {!collapsed && <span className="mf-sb-label">{item.label}</span>}
          </button>
        ))}
        {showDivider && !collapsed && <div className="mf-sb-divider" />}
      </>
    );
  }

  return (
    <aside className={`mf-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Sidebar">
      <div className="mf-sidebar-inner">
        {renderSection(PRIMARY, true)}
        {renderSection(LIBRARY, true)}
        {renderSection(EXPLORE, true)}
        {renderSection(MORE, false)}
      </div>
    </aside>
  );
}
