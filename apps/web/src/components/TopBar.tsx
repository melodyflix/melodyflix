// melodyflix web - TopBar (based on mockups/homepage.html)
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface TopBarProps {
  user: { username?: string; display_name?: string } | null;
  onToggleSidebar: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}

const NAV_ITEMS = [
  { icon: '🎓', label: 'Study', path: '/genre/education' },
  { icon: '🎬', label: 'Movies', path: '/genre/movie' },
  { icon: '🎭', label: 'Drama', path: '/genre/drama' },
  { icon: '🎵', label: 'Music', path: '/genre/music' },
  { icon: '📻', label: 'Radio', path: '/radio' },
  { icon: '📺', label: 'Live TV', path: '/live-tv' },
  { icon: '📡', label: 'Go Live', path: '/go-live' },
];

export default function TopBar({ user, onToggleSidebar, onOpenLogin, onLogout }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  function doSearch() {
    if (!searchQ.trim()) return;
    navigate(`/search?q=${encodeURIComponent(searchQ.trim())}`);
    setSearchOpen(false);
  }

  return (
    <>
      {/* SEARCH OVERLAY */}
      <div className={`mf-search-overlay ${searchOpen ? 'open' : ''}`}>
        <button className="mf-icon-btn" onClick={() => setSearchOpen(false)} style={{ fontSize: 16 }}>←</button>
        <input
          type="text"
          placeholder="Search MelodyFlix..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          autoFocus={searchOpen}
        />
        <button className="mf-icon-btn">🎤</button>
        <button
          onClick={doSearch}
          style={{
            padding: '0 18px', height: 34, border: 'none', borderRadius: 17,
            background: 'var(--mf-purple)', color: '#fff', fontWeight: 600,
            fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          🔍 Search
        </button>
      </div>

      {/* MAIN HEADER */}
      <header className="mf-main-header">
        <button className="mf-hamburger" onClick={onToggleSidebar}>☰</button>
        <Link to="/" className="mf-logo" style={{ textDecoration: 'none' }}>
          <span className="mf-logo-mark">♪</span>
          <span>MelodyFlix</span>
        </Link>
        <button className="mf-icon-btn" onClick={() => setSearchOpen(true)} title="Search" style={{ fontSize: 18 }}>
          🔍
        </button>

        <nav className="mf-nav-icons">
          {NAV_ITEMS.map((it) => (
            <Link key={it.label} to={it.path} style={{ textDecoration: 'none' }}>
              <button className="mf-nav-icon">
                <span className="emoji">{it.icon}</span>
                <span className="lbl">{it.label}</span>
              </button>
            </Link>
          ))}
        </nav>

        <div className="mf-user-zone">
          {!user && (
            <button className="mf-signin" onClick={onOpenLogin}>👤 Sign in</button>
          )}
          {user && (
            <div style={{ position: 'relative' }}>
              <button
                className="mf-icon-btn"
                onClick={() => setMenuOpen(!menuOpen)}
                style={{ fontSize: 18 }}
              >
                👤
              </button>
              {menuOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 6,
                  background: '#fff', border: '1px solid #ebe8f0', borderRadius: 8,
                  minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  zIndex: 400, padding: '6px 0',
                }}>
                  <Link to="/my-channel" style={{ display: 'block', padding: '10px 16px', color: '#0f0f0f', textDecoration: 'none', fontSize: 13 }}>
                    📺 Your channel
                  </Link>
                  <Link to="/creator-studio" style={{ display: 'block', padding: '10px 16px', color: '#0f0f0f', textDecoration: 'none', fontSize: 13 }}>
                    🎨 Creator Studio
                  </Link>
                  <Link to="/my-videos" style={{ display: 'block', padding: '10px 16px', color: '#0f0f0f', textDecoration: 'none', fontSize: 13 }}>
                    🎬 Your videos
                  </Link>
                  <Link to="/preferences" style={{ display: 'block', padding: '10px 16px', color: '#0f0f0f', textDecoration: 'none', fontSize: 13 }}>
                    ⚙️ Settings
                  </Link>
                  <hr style={{ border: 'none', borderTop: '1px solid #ebe8f0', margin: '4px 0' }} />
                  <button
                    onClick={() => { setMenuOpen(false); onLogout(); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px', color: '#b91c1c', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}
                  >
                    🚪 Log out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>
    </>
  );
}
