// melodyflix - banner shown to unverified users
import { useState } from 'react';
import { getCachedUser } from '../lib/api';

export default function VerifyEmailBanner() {
  const me = getCachedUser();
  const [hidden, setHidden] = useState(false);
  const [info, setInfo] = useState('');

  if (!me || hidden) return null;
  // @ts-ignore — email_verified may not be in cached user shape
  if ((me as any).email_verified === 1) return null;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #fffbea 0%, #fef3c7 100%)',
        border: '1px solid #fde68a',
        borderRadius: 10,
        padding: '12px 16px',
        margin: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 24, flexShrink: 0 }}>📧</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Please verify your email</strong>
        {info ? (
          <span style={{ color: '#065f46', marginLeft: 6 }}>{info}</span>
        ) : (
          <span style={{ color: '#664d03' }}>
            {' '}Check your inbox for the verification link to unlock all features.
          </span>
        )}
      </div>
      <button
        onClick={() => {
          setInfo('Please check your inbox. If you did not receive it, contact support.');
        }}
        style={{
          background: 'transparent',
          border: '1px solid #dba617',
          color: '#664d03',
          padding: '6px 12px',
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        How to verify?
      </button>
      <button
        onClick={() => setHidden(true)}
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: 18,
          cursor: 'pointer',
          color: '#909090',
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
