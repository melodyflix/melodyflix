import { useState } from 'react';
import { api, setToken } from '../lib/api';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('admin@melodyflix.com');
  const [password, setPassword] = useState('admin12345');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login(email, password);
      setToken(result.token);
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mf-login-wrap">
      <form className="mf-login-box" onSubmit={handleSubmit}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <svg width="72" height="72" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="login-mf-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#7c3aed" />
                <stop offset="55%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="18" fill="url(#login-mf-grad)" />
            <rect x="2" y="2" width="60" height="30" rx="16" fill="rgba(255,255,255,0.12)" />
            <path d="M25 20 L47 32 L25 44 Z" fill="#fff" />
          </svg>
        </div>
        <div style={{ textAlign: 'center', fontSize: 26, fontWeight: 700, letterSpacing: -0.6, marginBottom: 4 }}>
          melody<span style={{ color: '#a855f7' }}>flix</span>
        </div>
        <p className="mf-muted" style={{ textAlign: 'center', marginBottom: 20 }}>
          Admin Panel
        </p>

        {error && <div className="mf-alert mf-alert-error">{error}</div>}

        <div className="mf-form-group">
          <label className="mf-label">Email</label>
          <input
            className="mf-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Password</label>
          <input
            className="mf-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button className="mf-btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <p className="mf-muted mf-mt-16" style={{ textAlign: 'center' }}>
          melodyflix © 2026
        </p>
      </form>
    </div>
  );
}
