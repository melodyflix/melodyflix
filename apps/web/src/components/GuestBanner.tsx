// melodyflix - guest mode banner (shown on watch page when not signed in)
import { getCachedUser } from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function GuestBanner({ onSignIn }: Props) {
  const me = getCachedUser();
  if (me) return null;

  return (
    <div
      style={{
        background: '#e8f0fe',
        border: '1px solid #c2d9f5',
        borderRadius: 10,
        padding: '12px 16px',
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
      }}
    >
      <div style={{ fontSize: 24, flexShrink: 0 }}>👋</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>You're browsing as a guest.</strong>{' '}
        <span style={{ color: '#606060' }}>Sign in to like, comment, subscribe, and save videos.</span>
      </div>
      <button
        onClick={onSignIn}
        className="mf-btn-primary"
        style={{ width: 'auto', padding: '8px 16px', whiteSpace: 'nowrap' }}
      >
        Sign in
      </button>
    </div>
  );
}
