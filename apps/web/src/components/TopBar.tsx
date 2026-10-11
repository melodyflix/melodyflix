// melodyflix web - TopBar (per master UI spec)
// Header: hamburger + logo + search (voice) + 7 category links + create + messenger + settings + sign in
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
  { icon: '🎬', label: 'Movies & Dramas', path: '/genre/movie' },
  { icon: '🎵', label: 'Music & Videos', path: '/genre/music' },
  { icon: '📺', label: 'Web Series', path: '/series' },
  { icon: '📡', label: 'Live TV', path: '/live-tv' },
  { icon: '📻', label: 'Radio', path: '/radio' },
  { icon: '📰', label: 'Article & News', path: '/help' },
];

export default function TopBar({ user, onToggleSidebar, onOpenLogin, onLogout }: TopBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const navigate = useNavigate();

  function doSearch() {
    if (!searchQ.trim()) return;
    navigate(`/search?q=${encodeURIComponent(searchQ.trim())}`);
    setSearchOpen(false);
  }

  function voiceSearch() {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) {
      alert('Voice search not supported in this browser');
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setSearchQ(text);
      navigate(`/search?q=${encodeURIComponent(text)}`);
      setSearchOpen(false);
    };
    rec.start();
  }

  return (
    <>
      {/* SEARCH OVERLAY (mobile / expanded) */}
      {searchOpen && (
        <div className="mf-search-overlay open">
          <button className="mf-icon-btn" onClick={() => setSearchOpen(false)} style={{ fontSize: 16 }}>←</button>
          <input
            type="text"
            placeholder="Search MelodyFlix..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            autoFocus
          />
          <button className="mf-icon-btn" onClick={voiceSearch} title="Voice search">🎤</button>
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
      )}

      {/* MAIN HEADER */}
      <header className="mf-main-header">
        <button className="mf-hamburger" onClick={onToggleSidebar} title="Menu">☰</button>
        <Link to="/" className="mf-logo" style={{ textDecoration: 'none' }}>
          <span className="mf-logo-mark">♪</span>
          <span>MelodyFlix</span>
        </Link>

        {/* SEARCH (desktop inline) */}
        <div className="mf-header-search">
          <input
            type="text"
            placeholder="Search..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          />
          <button onClick={doSearch} title="Search">🔍</button>
          <button onClick={voiceSearch} title="Voice search">🎤</button>
        </div>

        {/* CATEGORY FAST-LINKS */}
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

        {/* RIGHT ACTIONS */}
        <div className="mf-header-actions">
          <button className="mf-icon-btn" onClick={() => setSearchOpen(true)} title="Search" style={{ fontSize: 18 }}>🔍</button>

          <Link to="/upload" style={{ textDecoration: 'none' }}>
            <button className="mf-icon-btn" title="Create">＋</button>
          </Link>

          <Link to="/notifications" style={{ textDecoration: 'none' }}>
            <button className="mf-icon-btn" title="Messenger">💬</button>
          </Link>

          <div style={{ position: 'relative' }}>
            <button className="mf-icon-btn" onClick={() => setSettingsOpen(!settingsOpen)} title="Settings">⋮</button>
            {settingsOpen && (
              <div className="mf-dropdown-menu">
                <button onClick={() => { document.body.classList.toggle('theme-light'); setSettingsOpen(false); }}>
                  🌓 Dark / Light Theme
                </button>
                <button onClick={() => { alert('Language settings'); setSettingsOpen(false); }}>
                  🌐 Language
                </button>
                <button onClick={() => { alert('Location settings'); setSettingsOpen(false); }}>
                  📍 Location
                </button>
                <button onClick={() => { alert('Restricted Mode toggle'); setSettingsOpen(false); }}>
                  🔞 Restricted Mode
                </button>
                <button onClick={() => { alert('Keyboard shortcuts'); setSettingsOpen(false); }}>
                  ⌨️ Keyboard Shortcuts
                </button>
                <Link to="/help" style={{ textDecoration: 'none' }}>
                  <button onClick={() => setSettingsOpen(false)}>❓ Help & Feedback</button>
                </Link>
              </div>
            )}
          </div>

          {!user && (
            <button className="mf-signin" onClick={onOpenLogin}>👤 Sign in</button>
          )}
          {user && (
            <div style={{ position: 'relative' }}>
              <button className="mf-icon-btn" onClick={() => setUserMenuOpen(!userMenuOpen)} style={{ fontSize: 18 }}>👤</button>
              {userMenuOpen && (
                <div className="mf-dropdown-menu" style={{ right: 0 }}>
                  <Link to="/my-channel" style={{ textDecoration: 'none' }}>
                    <button onClick={() => setUserMenuOpen(false)}>📺 Your channel</button>
                  </Link>
                  <Link to="/studio" style={{ textDecoration: 'none' }}>
                    <button onClick={() => setUserMenuOpen(false)}>🎨 Creator Studio</button>
                  </Link>
                  <Link to="/my-videos" style={{ textDecoration: 'none' }}>
                    <button onClick={() => setUserMenuOpen(false)}>🎬 Your videos</button>
                  </Link>
                  <Link to="/preferences" style={{ textDecoration: 'none' }}>
                    <button onClick={() => setUserMenuOpen(false)}>⚙️ Settings</button>
                  </Link>
                  <hr style={{ border: 'none', borderTop: '1px solid #ebe8f0', margin: '4px 0' }} />
                  <button onClick={() => { setUserMenuOpen(false); onLogout(); }} style={{ color: '#b91c1c' }}>
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
