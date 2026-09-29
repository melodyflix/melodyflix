import { useEffect, useState } from 'react';
import {
  listChannelTiers, joinMembership, startCheckout, verifyPayment,
  getCachedUser,
  type MembershipTier, type Membership,
} from '../lib/api';

interface Props {
  channelId: string;
  channelName: string;
  onClose: () => void;
  onJoined: (m: Membership, tier: MembershipTier) => void;
  onSignIn: () => void;
}

type Step = 'choose' | 'paying' | 'joining' | 'done';

export default function MembershipModal({ channelId, channelName, onClose, onJoined, onSignIn }: Props) {
  const me = getCachedUser();
  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MembershipTier | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listChannelTiers(channelId)
      .then((res) => {
        setTiers(res.tiers);
        if (res.tiers.length > 0) setSelected(res.tiers[0]);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId]);

  async function handleJoin() {
    if (!me) { onSignIn(); return; }
    if (!selected) return;
    setBusy(true);
    setError('');

    try {
      setStep('paying');
      const checkout = await startCheckout({
        purpose: 'membership',
        amount: selected.price,
        reference_id: selected.id,
        metadata: { tier_id: selected.id, tier_name: selected.name },
      });

      await verifyPayment(checkout.transaction_id, 'completed', 'MEM_SIM_' + Date.now());

      setStep('joining');
      const res = await joinMembership(selected.id, checkout.transaction_id);
      setStep('done');
      onJoined(res.membership, res.tier);
      setTimeout(() => onClose(), 1400);
    } catch (err) {
      setError((err as Error).message);
      setStep('choose');
    }
    setBusy(false);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, padding: 24,
          width: '100%', maxWidth: 500, maxHeight: '92vh', overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>🏅 Join {channelName}</h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', fontSize: 22,
              cursor: 'pointer', padding: 4, color: '#606060',
            }}
          >
            ✕
          </button>
        </div>

        {step === 'choose' && (
          <>
            {error && (
              <div style={{
                background: '#fef2f2', color: '#991b1b',
                padding: '10px 14px', borderRadius: 8,
                fontSize: 13, marginBottom: 14,
              }}>
                {error}
              </div>
            )}

            {loading ? (
              <div style={{ textAlign: 'center', padding: 30, color: '#606060' }}>Loading tiers...</div>
            ) : tiers.length === 0 ? (
              <div style={{
                background: '#fffbea', border: '1px solid #ffe8a3',
                padding: '14px 16px', borderRadius: 8,
                fontSize: 13, color: '#664d03', textAlign: 'center',
              }}>
                ⚠️ This channel has no membership tiers yet.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
                  {tiers.map((t) => {
                    const active = selected?.id === t.id;
                    return (
                      <div
                        key={t.id}
                        onClick={() => setSelected(t)}
                        style={{
                          cursor: 'pointer',
                          border: `2px solid ${active ? t.color : '#e5e5e5'}`,
                          background: active ? t.color + '14' : '#fff',
                          borderRadius: 12,
                          padding: 16,
                          transition: 'all 0.15s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 28 }}>{t.badge_emoji}</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: t.color }}>
                              {t.name}
                            </span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 20, fontWeight: 700, color: t.color }}>
                              ৳{t.price}
                            </div>
                            <div style={{ fontSize: 11, color: '#606060' }}>per month</div>
                          </div>
                        </div>
                        {t.description && (
                          <div style={{ fontSize: 13, color: '#606060', lineHeight: 1.5 }}>
                            {t.description}
                          </div>
                        )}
                        <div style={{ fontSize: 12, color: '#909090', marginTop: 8 }}>
                          {t.subscriber_count} members
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{
                  background: '#f9fafb', borderRadius: 10, padding: 14,
                  marginBottom: 16, fontSize: 13, lineHeight: 1.7, color: '#606060',
                }}>
                  <strong style={{ color: '#0f0f0f' }}>Benefits:</strong>
                  <ul style={{ marginLeft: 20, marginTop: 4 }}>
                    <li>{selected?.badge_emoji} Member badge in chat</li>
                    <li>📺 Access to member-only videos</li>
                    <li>💬 Exclusive live chat access</li>
                    <li>🔄 Auto-renews monthly (cancel anytime)</li>
                  </ul>
                </div>

                <button
                  onClick={handleJoin}
                  disabled={busy || !selected}
                  style={{
                    width: '100%',
                    padding: 14,
                    fontSize: 15,
                    fontWeight: 700,
                    background: selected?.color ?? '#7c3aed',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    cursor: busy ? 'wait' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {busy ? 'Processing...' : `Join for ৳${selected?.price}/month`}
                </button>
              </>
            )}
          </>
        )}

        {step === 'paying' && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>💳</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Processing payment...
            </div>
            <div style={{ fontSize: 13, color: '#606060' }}>
              ৳{selected?.price} · Test mode
            </div>
          </div>
        )}

        {step === 'joining' && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏅</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              Activating membership...
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ fontSize: 60, marginBottom: 12 }}>🎉</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#054f31', marginBottom: 8 }}>
              Welcome, member!
            </div>
            <div style={{ fontSize: 14, color: '#606060' }}>
              You're now a {selected?.badge_emoji} {selected?.name} member of {channelName}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
