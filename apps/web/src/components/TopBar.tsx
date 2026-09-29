import { useState } from 'react';
import type { User } from '../lib/api';
import NotificationBell from './NotificationBell';

interface Props {
  user: User | null;
  onLogoClick: () => void;
  onSearch: (q: string) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onMyChannel: () => void;
  onUpload: () => void;
  onWatchLater: () => void;
  onSubscriptions: () => void;
  onNotifications: () => void;
  onHistory: () => void;
  onPlaylists: () => void;
  onMyVideos: () => void;
  onGoLive: () => void;
  onLive: () => void;
}

export default function TopBar({
  user, onLogoClick, onSearch, onSignIn, onSignOut, onMyChannel, onUpload,
  onWatchLater, onSubscriptions, onHistory, onPlaylists, onMyVideos, onGoLive, onLive,
}: Props) {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSearch(query.trim());
  }

  const initial = user?.display_name?.[0] ?? user?.username?.[0] ?? '?';

  return (
    <header className="mf-topbar">
      <div className="mf-logo" onClick={onLogoClick}>
        <span className="mf-logo-mark">▶</span>
        <span className="mf-logo-text">melodyflix</span>
      </div>

      <form className="mf-search" onSubmit={submit}>
        <input
          type="text"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit">🔍</button>
      </form>

      <div className="mf-topbar-right">
        {/* Live button */}
        <button
          onClick={onLive}
          title="Live streams"
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 22,
            cursor: 'pointer',
            padding: '4px 8px',
            color: '#0f0f0f',
            lineHeight: 1,
            position: 'relative',
          }}
        >
          📡
        </button>

        {/* Go Live button */}
        {user && (
          <button
            onClick={onGoLive}
            title="Go Live"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 22,
              cursor: 'pointer',
              padding: '4px 8px',
              color: '#dc2626',
              lineHeight: 1,
            }}
          >
            🔴
          </button>
        )}

        {user && (
          <button
            onClick={onUpload}
            title="Upload video"
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 22,
              cursor: 'pointer',
              padding: '4px 8px',
              color: '#0f0f0f',
              lineHeight: 1,
            }}
          >
            📤
          </button>
        )}

        <NotificationBell />

        {user ? (
          <div style={{ position: 'relative' }}>
            <div className="mf-avatar" onClick={() => setMenuOpen(!menuOpen)}>{initial}</div>
            {menuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 8,
                  background: '#fff',
                  border: '1px solid #e5e5e5',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  minWidth: 240,
                  padding: '8px 0',
                  zIndex: 200,
                }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ fontWeight: 500 }}>{user.username}</div>
                  <div style={{ fontSize: 12, color: '#606060' }}>{user.email}</div>
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onGoLive(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14, color: '#dc2626', fontWeight: 500 }}
                >
                  🔴 Go Live
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onMyChannel(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14 }}
                >
                  📺 My Channel
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onMyVideos(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14 }}
                >
                  🎬 My Videos
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onSubscriptions(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14 }}
                >
                  📬 Subscriptions
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onHistory(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14 }}
                >
                  🕐 History
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onPlaylists(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14 }}
                >
                  📁 Playlists
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onWatchLater(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14 }}
                >
                  🔖 Watch Later
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onUpload(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14 }}
                >
                  📤 Upload video
                </div>
                <div
                  onClick={() => { setMenuOpen(false); onSignOut(); }}
                  style={{ padding: '10px 16px', cursor: 'pointer', fontSize: 14, borderTop: '1px solid #f0f0f0' }}
                >
                  Sign out
                </div>
              </div>
            )}
          </div>
        ) : (
          <button className="mf-btn-signin" onClick={onSignIn}>Sign in</button>
        )}
      </div>
    </header>
  );
}
