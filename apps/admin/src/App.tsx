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
import EmailSettings from './pages/EmailSettings';
import ContentUpload from './pages/ContentUpload';
import PageBuilder from './pages/PageBuilder';
import VideoChapters from './pages/VideoChapters';
import AdminCampaigns from './pages/AdminCampaigns';
import AdminInfluencers from './pages/AdminInfluencers';
import AdminAdCampaigns from './pages/AdminAdCampaigns';
import { api, getToken, clearToken, type User } from './lib/api';

type Page = 'dashboard' | 'channels' | 'videos' | 'chapters' | 'users' | 'reports' | 'ads' | 'ad-campaigns' | 'payments' | 'support' | 'email' | 'content-upload' | 'campaigns' | 'influencers' | 'settings' | 'builder';

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
    { key: 'chapters', label: 'Chapters', icon: '📑' },
    { key: 'users', label: 'Users', icon: '👥' },
    { key: 'ads', label: 'Ads', icon: '💰' },
    { key: 'ad-campaigns', label: 'Ad Campaigns', icon: '📢' },
    { key: 'payments', label: 'Payments', icon: '💳' },
    { key: 'reports', label: 'Reports', icon: '🚩' },
    { key: 'support', label: 'Support', icon: '🎫' },
    { key: 'email', label: 'Email', icon: '📧' },
    { key: 'content-upload', label: 'Auto Upload', icon: '📥' },
    { key: 'campaigns', label: 'Campaigns', icon: '📨' },
    { key: 'influencers', label: 'Influencers', icon: '⭐' },
    { key: 'builder', label: 'Page Builder', icon: '🎨' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <div className="mf-layout">
      <aside className="mf-sidebar">
        <div className="mf-sidebar-logo" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="28" height="28" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
            <defs>
              <linearGradient id="adm-g1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#c084fc" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
              <linearGradient id="adm-g2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f0abfc" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
              <linearGradient id="adm-g3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ec4899" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
            </defs>
            <polygon points="4,46 18,32 32,46 18,60" fill="url(#adm-g1)" />
            <polygon points="18,32 32,46 18,60" fill="url(#adm-g3)" opacity="0.85" />
            <polygon points="26,10 34,8 34,46 26,48" fill="url(#adm-g1)" />
            <polygon points="34,8 56,18 42,32 34,22" fill="url(#adm-g2)" />
            <polygon points="34,10 48,13 42,16" fill="#fff" opacity="0.18" />
          </svg>
          <span style={{ fontWeight: 800, letterSpacing: -0.4 }}>
            Melody<span style={{ background: 'linear-gradient(135deg, #c084fc, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Flix</span>
          </span>
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
        {page === 'chapters' && <VideoChapters />}
          {page === 'users' && <Users />}
          {page === 'ads' && <AdNetworks />}
          {page === 'ad-campaigns' && <AdminAdCampaigns />}
          {page === 'payments' && <AdminPayments />}
          {page === 'reports' && <Reports />}
          {page === 'support' && <AdminSupport />}
          {page === 'email' && <EmailSettings />}
          {page === 'content-upload' && <ContentUpload />}
          {page === 'campaigns' && <AdminCampaigns />}
          {page === 'influencers' && <AdminInfluencers />}
          {page === 'builder' && <PageBuilder />}
          {page === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
