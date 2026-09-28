import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function Dashboard() {
  const [channelCount, setChannelCount] = useState<number>(0);
  const [authOk, setAuthOk] = useState<string>('...');
  const [channelOk, setChannelOk] = useState<string>('...');

  useEffect(() => {
    api.listChannels().then((c) => setChannelCount(c.length)).catch(() => {});
    api.healthAuth().then(() => setAuthOk('online')).catch(() => setAuthOk('offline'));
    api.healthChannel().then(() => setChannelOk('online')).catch(() => setChannelOk('offline'));
  }, []);

  return (
    <>
      <h1 className="mf-page-title">Dashboard</h1>

      <div className="mf-cards">
        <div className="mf-card">
          <div className="mf-card-label">Channels</div>
          <div className="mf-card-value">{channelCount}</div>
          <div className="mf-card-hint">Total channels</div>
        </div>
        <div className="mf-card">
          <div className="mf-card-label">Auth Service</div>
          <div className="mf-card-value" style={{ fontSize: 18 }}>
            <span className={`mf-badge ${authOk === 'online' ? 'mf-badge-success' : 'mf-badge-warning'}`}>
              {authOk}
            </span>
          </div>
          <div className="mf-card-hint">port 4001</div>
        </div>
        <div className="mf-card">
          <div className="mf-card-label">Channel Service</div>
          <div className="mf-card-value" style={{ fontSize: 18 }}>
            <span className={`mf-badge ${channelOk === 'online' ? 'mf-badge-success' : 'mf-badge-warning'}`}>
              {channelOk}
            </span>
          </div>
          <div className="mf-card-hint">port 4002</div>
        </div>
      </div>

      <h2 className="mf-page-title" style={{ fontSize: 18 }}>Welcome to melodyflix Admin</h2>
      <div className="mf-card">
        <p>Manage everything from here:</p>
        <ul style={{ marginLeft: 20, marginTop: 10, lineHeight: 1.9 }}>
          <li><strong>Channels</strong> — view all channels, verify creators</li>
          <li><strong>Users</strong> — manage users and roles</li>
          <li><strong>Settings</strong> — platform configuration</li>
        </ul>
        <p className="mf-muted mf-mt-16">More pages coming: Videos, Live, Analytics, Monetization...</p>
      </div>
    </>
  );
}
