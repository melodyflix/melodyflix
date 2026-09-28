import { useState } from 'react';
import { api, setAuth, type User } from '../lib/api';

interface Props {
  onClose: () => void;
  onSuccess: (user: User) => void;
}

type Mode = 'signin' | 'signup';

export default function LoginModal({ onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        const res = await api.login(email, password);
        setAuth(res.token, res.user);
        onSuccess(res.user);
      } else {
        await api.signup(email, username, password, username);
        const res = await api.login(email, password);
        setAuth(res.token, res.user);
        onSuccess(res.user);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mf-modal-backdrop" onClick={onClose}>
      <div className="mf-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{mode === 'signin' ? 'Sign in to melodyflix' : 'Create your account'}</h2>

        {error && <div className="mf-error-small">{error}</div>}

        <form onSubmit={submit}>
          <div className="mf-form-group">
            <label className="mf-label">Email</label>
            <input
              className="mf-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          {mode === 'signup' && (
            <div className="mf-form-group">
              <label className="mf-label">Username</label>
              <input
                className="mf-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={50}
                pattern="[a-zA-Z0-9_]+"
              />
            </div>
          )}

          <div className="mf-form-group">
            <label className="mf-label">Password</label>
            <input
              className="mf-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>

          <button className="mf-btn-primary" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          className="mf-btn-secondary"
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
