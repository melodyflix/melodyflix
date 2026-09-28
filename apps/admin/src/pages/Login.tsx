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
        <div className="mf-login-logo">melody<span>flix</span></div>
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
