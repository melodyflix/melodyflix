import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { verifyEmailToken } from '../lib/api';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No verification token provided');
      return;
    }
    verifyEmailToken(token)
      .then((res) => {
        setEmail(res.email);
        setStatus('success');
      })
      .catch((err) => {
        setError((err as Error).message);
        setStatus('error');
      });
  }, [token]);

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 56px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'linear-gradient(135deg, #f5f3ff 0%, #fdf2f8 100%)',
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 40,
          maxWidth: 440,
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 8px 30px rgba(124,58,237,0.1)',
        }}
      >
        {status === 'loading' && (
          <>
            <div style={{ fontSize: 60, marginBottom: 16 }}>⏳</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              Verifying your email...
            </div>
            <div style={{ color: '#606060', fontSize: 14 }}>
              This will only take a moment
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <div style={{ fontSize: 70, marginBottom: 16 }}>✅</div>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 8, color: '#054f31' }}>
              Email verified!
            </div>
            <div style={{ color: '#606060', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
              Your email <strong>{email}</strong> has been successfully verified.
              You now have full access to melodyflix.
            </div>
            <button
              onClick={() => navigate('/')}
              className="mf-btn-primary"
              style={{ width: 'auto', padding: '12px 32px', fontSize: 15 }}
            >
              Start watching →
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ fontSize: 70, marginBottom: 16 }}>❌</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#991b1b' }}>
              Verification failed
            </div>
            <div style={{ color: '#606060', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
              {error}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => navigate('/')}
                className="mf-btn-secondary"
                style={{ width: 'auto', padding: '10px 24px' }}
              >
                Go home
              </button>
              <button
                onClick={() => navigate('/help')}
                className="mf-btn-primary"
                style={{ width: 'auto', padding: '10px 24px' }}
              >
                Get help
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
