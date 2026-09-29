import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listMyMemberships, cancelMembership, getCachedUser,
  type Membership,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function MyMemberships({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await listMyMemberships();
      setMemberships(res.memberships);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!me) { setLoading(false); return; }
    load();
  }, [me]);

  async function handleCancel(m: Membership) {
    if (!confirm('Cancel this membership? It will stay active until the current period ends.')) return;
    setBusy(m.id);
    try {
      await cancelMembership(m.channel_id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  }

  if (!me) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to see your memberships</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const active = memberships.filter((m) => m.status === 'active');
  const inactive = memberships.filter((m) => m.status !== 'active');

  function daysLeft(iso: string): number {
    const diff = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  }

  return (
    <div className="mf-container" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ fontSize: 34 }}>🏅</div>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>My Memberships</h1>
          <div style={{ color: '#606060', fontSize: 13 }}>
            {active.length} active · {memberships.length} total
          </div>
        </div>
      </div>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading...</div>
      ) : memberships.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🏅</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No memberships yet</div>
          <div style={{ fontSize: 14, color: '#606060', marginBottom: 20 }}>
            Join a channel to support creators and unlock exclusive perks
          </div>
          <button
            className="mf-btn-primary"
            style={{ width: 'auto', padding: '10px 24px' }}
            onClick={() => navigate('/')}
          >
            Browse channels
          </button>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>Active</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {active.map((m) => {
                  const tier = m.tier;
                  const color = tier?.color ?? '#7c3aed';
                  const left = daysLeft(m.expires_at);
                  return (
                    <div
                      key={m.id}
                      style={{
                        background: '#fff',
                        border: `2px solid ${color}40`,
                        borderRadius: 12,
                        padding: 18,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 16,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flex: 1, minWidth: 220 }}>
                        <div
                          style={{
                            width: 50,
                            height: 50,
                            borderRadius: 12,
                            background: color,
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 24,
                            flexShrink: 0,
                          }}
                        >
                          {tier?.badge_emoji ?? '🏅'}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>
                            {tier?.name ?? 'Membership'}
                          </div>
                          <div
                            onClick={() => navigate(`/channel/${m.channel_id}`)}
                            style={{ fontSize: 13, color: '#606060', cursor: 'pointer', textDecoration: 'underline' }}
                          >
                            View channel
                          </div>
                          <div style={{ fontSize: 12, color: '#909090', marginTop: 4 }}>
                            {left > 0 ? `${left} days left` : 'Expiring today'} ·{' '}
                            {m.auto_renew ? 'Auto-renew on' : 'Auto-renew off'}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {m.auto_renew ? (
                          <button
                            className="mf-btn mf-btn-secondary"
                            style={{ padding: '8px 16px', fontSize: 13 }}
                            disabled={busy === m.id}
                            onClick={() => handleCancel(m)}
                          >
                            Cancel auto-renew
                          </button>
                        ) : (
                          <span className="mf-badge mf-badge-warning" style={{ padding: '8px 12px' }}>
                            Won't renew
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {inactive.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, marginBottom: 12, color: '#909090' }}>Past</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {inactive.map((m) => {
                  const tier = m.tier;
                  return (
                    <div
                      key={m.id}
                      style={{
                        background: '#f9f9f9',
                        border: '1px solid #e5e5e5',
                        borderRadius: 10,
                        padding: 14,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        opacity: 0.8,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span style={{ fontSize: 22 }}>{tier?.badge_emoji ?? '🏅'}</span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>
                            {tier?.name ?? 'Membership'}
                          </div>
                          <div style={{ fontSize: 12, color: '#909090' }}>
                            {m.status === 'cancelled' ? 'Cancelled' : 'Expired'} ·{' '}
                            {new Date(m.expires_at).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <button
                        className="mf-btn mf-btn-secondary"
                        style={{ padding: '6px 14px', fontSize: 12 }}
                        onClick={() => navigate(`/channel/${m.channel_id}`)}
                      >
                        Rejoin
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
