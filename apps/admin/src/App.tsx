import { useEffect, useState } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Videos from './pages/Videos';
import Users from './pages/Users';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import AdNetworks from './pages/AdNetworks';
import AdminPayments from './pages/AdminPayments';
import AdminSupport from './pages/AdminSupport';
import { api, getToken, clearToken, type User } from './lib/api';

type Page = 'dashboard' | 'channels' | 'videos' | 'users' | 'reports' | 'ads' | 'payments' | 'support' | 'settings';

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
    { key: 'ads', label: 'Ads', icon: '💰' },
    { key: 'payments', label: 'Payments', icon: '💳' },
    { key: 'reports', label: 'Reports', icon: '🚩' },
    { key: 'support', label: 'Support', icon: '🎫' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <div className="mf-layout">
      <aside className="mf-sidebar">
        <div className="mf-sidebar-logo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="24" height="24" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <defs>
              <linearGradient id="admin-mf-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7c3aed" />
                <stop offset="55%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="18" fill="url(#admin-mf-grad)" />
            <path d="M25 20 L47 32 L25 44 Z" fill="#fff" />
          </svg>
          <span>melody<span style={{ color: '#a855f7' }}>flix</span></span>
        </div>
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
          {page === 'ads' && <AdNetworks />}
          {page === 'payments' && <AdminPayments />}
          {page === 'reports' && <Reports />}
          {page === 'support' && <AdminSupport />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
