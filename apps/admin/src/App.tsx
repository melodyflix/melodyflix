import { useEffect, useState } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Videos from './pages/Videos';
import Users from './pages/Users';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import { api, getToken, clearToken, type User } from './lib/api';

type Page = 'dashboard' | 'channels' | 'videos' | 'users' | 'reports' | 'settings';

export default function App() {
  const [loggedIn, setLoggedIn] = useState<boolean>(!!getToken());
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>('dashboard');

  useEffect(() => {
    if (!loggedIn) return;
    api.me().then(setUser).catch(() => {
      clearToken();
      setLoggedIn(false);
    });
  }, [loggedIn]);

  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  function logout() {
    clearToken();
    setLoggedIn(false);
    setUser(null);
  }

  const menu: { key: Page; label: string; icon: string }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: '🏠' },
    { key: 'channels', label: 'Channels', icon: '📺' },
    { key: 'videos', label: 'Videos', icon: '🎬' },
    { key: 'users', label: 'Users', icon: '👥' },
    { key: 'reports', label: 'Reports', icon: '🚩' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <div className="mf-layout">
      <aside className="mf-sidebar">
        <div className="mf-sidebar-logo">melody<span>flix</span></div>
        <ul className="mf-menu">
          {menu.map((m) => (
            <li
              key={m.key}
              className={`mf-menu-item ${page === m.key ? 'active' : ''}`}
              onClick={() => setPage(m.key)}
            >
              <span className="mf-icon">{m.icon}</span>
              <span>{m.label}</span>
            </li>
          ))}
        </ul>
        <div className="mf-sidebar-footer">v0.0.1 · admin</div>
      </aside>

      <div className="mf-main">
        <header className="mf-topbar">
          <div className="mf-topbar-left">
            <span>{menu.find((m) => m.key === page)?.label}</span>
          </div>
          <div className="mf-topbar-right">
            <span className="mf-user">👤 {user?.username ?? '...'}</span>
            <a onClick={logout} style={{ cursor: 'pointer' }}>Log out</a>
          </div>
        </header>

        <main className="mf-content">
          {page === 'dashboard' && <Dashboard />}
          {page === 'channels' && <Channels />}
          {page === 'videos' && <Videos />}
          {page === 'users' && <Users />}
          {page === 'reports' && <Reports />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
