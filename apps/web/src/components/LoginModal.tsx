import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, setAuth, completeTwoFALogin, type User } from '../lib/api';

interface Props {
  onClose: () => void;
  onSuccess: (user: User) => void;
}

type Mode = 'signin' | 'signup' | '2fa';

export default function LoginModal({ onClose, onSuccess }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function finishLogin(user: User) {
    onSuccess(user);
    try {
      const returnTo = sessionStorage.getItem('mf_return_to');
      if (returnTo) {
        sessionStorage.removeItem('mf_return_to');
        if (returnTo !== location.pathname + location.search) {
          navigate(returnTo);
        }
      }
    } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        const res = await api.login(email, password);
        // Check if 2FA is required
        if ('requires_2fa' in (res as any) && (res as any).requires_2fa) {
          setTempToken((res as any).temp_token);
          setCode('');
          setMode('2fa');
          setLoading(false);
          return;
        }
        setAuth(res.token, res.user);
        finishLogin(res.user);
      } else if (mode === '2fa') {
        const res = await completeTwoFALogin(tempToken, code);
        setAuth(res.token, res.user);
        finishLogin(res.user);
      } else {
        await api.signup(email, username, password, username);
        const res = await api.login(email, password);
        setAuth(res.token, res.user);
        finishLogin(res.user);
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
        <h2>
          {mode === 'signin' && 'Sign in to melodyflix'}
          {mode === 'signup' && 'Create your account'}
          {mode === '2fa' && 'Two-factor authentication'}
        </h2>

        {error && <div className="mf-error-small">{error}</div>}

        {mode === '2fa' && (
          <p style={{ fontSize: 13, color: '#606060', marginBottom: 14, textAlign: 'center' }}>
            Enter the 6-digit code from your authenticator app, or a backup code.
          </p>
        )}

        <form onSubmit={submit}>
          {mode !== '2fa' && (
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
          )}

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

          {mode === 'signin' || mode === 'signup' ? (
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
          ) : (
            <div className="mf-form-group">
              <label className="mf-label">Authentication code</label>
              <input
                className="mf-input"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="123456"
                style={{
                  fontSize: 20,
                  letterSpacing: 4,
                  textAlign: 'center',
                  fontFamily: 'monospace',
                }}
                maxLength={20}
              />
            </div>
          )}

          <button className="mf-btn-primary" type="submit" disabled={loading}>
            {loading
              ? 'Please wait...'
              : mode === 'signin'
              ? 'Sign in'
              : mode === 'signup'
              ? 'Create account'
              : 'Verify'}
          </button>
        </form>

        {mode === '2fa' && (
          <button
            className="mf-btn-secondary"
            onClick={() => { setMode('signin'); setCode(''); setTempToken(''); setError(''); }}
          >
            ← Back to sign in
          </button>
        )}
        {mode !== '2fa' && (
          <button
            className="mf-btn-secondary"
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}
          >
            {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        )}
      </div>
    </div>
  );
}
