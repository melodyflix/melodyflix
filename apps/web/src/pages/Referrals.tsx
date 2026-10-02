import { useEffect, useState } from 'react';
import {
  getReferralMe, listMyReferrals, getReferralShareLink, regenerateReferralCode,
  type ReferralMe, type Referral,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}

export default function Referrals({ onSignIn }: Props) {
  const [me, setMe] = useState<ReferralMe | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [shareLink, setShareLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [meRes, listRes, shareRes] = await Promise.all([
        getReferralMe(),
        listMyReferrals(100),
        getReferralShareLink(),
      ]);
      setMe(meRes);
      setReferrals(listRes.referrals);
      setShareLink(shareRes.link);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        setError('signin');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function showToast(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareLink);
      showToast('Link copied!');
    } catch {
      showToast(shareLink);
    }
  }

  async function handleRegenerate() {
    if (!confirm('Generate a new code? The old link will stop working.')) return;
    setBusy(true);
    try {
      const res = await regenerateReferralCode();
      await load();
      showToast(`New code: ${res.code}`);
    } catch (err) {
      showToast((err as Error).message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="mf-page" style={{ padding: 60, textAlign: 'center', color: '#606060' }}>Loading...</div>;
  }

  if (error === 'signin') {
    return (
      <div className="mf-page" style={{ padding: 60, textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Sign in required</h2>
        <p style={{ color: '#606060', marginBottom: 20 }}>You need to be signed in to see your referrals.</p>
        <button className="mf-btn-primary" onClick={onSignIn} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#065fd4', color: '#fff', cursor: 'pointer' }}>
          Sign in
        </button>
      </div>
    );
  }

  if (!me) {
    return <div className="mf-page" style={{ padding: 60, textAlign: 'center', color: '#dc2626' }}>{error || 'Failed to load'}</div>;
  }

  return (
    <div className="mf-page" style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>🎁 Invite Friends</h1>
      <p style={{ color: '#606060', marginBottom: 24 }}>
        Share your link. You get <strong>{me.reward_info.referrer} credits</strong> per signup,
        they get <strong>{me.reward_info.referred} bonus</strong>.
      </p>

      {/* Stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginBottom: 24,
      }}>
        <StatCard label="Total invited" value={me.stats.total_invited} icon="👥" />
        <StatCard label="Completed" value={me.stats.completed} icon="✅" />
        <StatCard label="Credits earned" value={me.stats.total_earned} icon="💎" color="#7c3aed" />
        <StatCard label="Credits balance" value={me.credits.balance} icon="💠" color="#065fd4" />
      </div>

      {/* Share link */}
      <div style={{
        background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12,
        padding: 18, marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, color: '#606060', marginBottom: 8, fontWeight: 600 }}>
          Your referral link
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="mf-input"
            value={shareLink}
            readOnly
            onFocus={(e) => e.target.select()}
            style={{
              flex: 1, minWidth: 240, padding: '10px 14px', fontSize: 13,
              fontFamily: 'monospace', background: '#fafafa',
            }}
          />
          <button
            className="mf-btn-primary"
            onClick={copyLink}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#065fd4', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
          >
            🔗 Copy
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: '#909090' }}>
            Your code: <strong style={{ fontFamily: 'monospace', fontSize: 13, color: '#0f0f0f' }}>{me.stats.code}</strong>
          </div>
          <button
            className="mf-btn-text"
            onClick={handleRegenerate}
            disabled={busy}
            style={{ fontSize: 12, color: '#dc2626' }}
          >
            {busy ? 'Working...' : '🔄 Regenerate code'}
          </button>
        </div>
      </div>

      {/* Referrals list */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '12px 18px', background: '#fafafa', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 14 }}>
          Your referrals ({referrals.length})
        </div>

        {referrals.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#909090', fontSize: 13 }}>
            No referrals yet. Share your link to get started!
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>User</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '10px 14px' }}>Joined</th>
                <th style={{ textAlign: 'right', padding: '10px 14px' }}>Reward</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 500 }}>
                    {r.referred_username ? `@${r.referred_username}` : (r.referred_email ?? 'User')}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 10,
                      background: r.status === 'rewarded' ? '#dcfce7' : r.status === 'completed' ? '#dbeafe' : '#f3f4f6',
                      color: r.status === 'rewarded' ? '#166534' : r.status === 'completed' ? '#1e40af' : '#4b5563',
                    }}>{r.status}</span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#606060' }}>{fmtDate(r.created_at)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#7c3aed' }}>
                    +{r.reward_amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div className="mf-toast">{toast}</div>}
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color?: string }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
      padding: 14, textAlign: 'center',
    }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#0f0f0f' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#909090', textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
