import { useEffect, useState } from 'react';
import {
  listInfluencers, listInfluencerCandidates, listInfluencerTiers,
  markInfluencer, unmarkInfluencer, updateInfluencerTier,
  type InfluencerListItem, type CandidateCreator, type InfluencerTier, type TierInfo,
} from '../lib/api';

const TIER_COLORS: Record<InfluencerTier, { bg: string; fg: string }> = {
  bronze:   { bg: '#fde8d0', fg: '#92400e' },
  silver:   { bg: '#e5e7eb', fg: '#374151' },
  gold:     { bg: '#fef3c7', fg: '#92400e' },
  platinum: { bg: '#e0e7ff', fg: '#4338ca' },
};

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function tierLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export default function AdminInfluencers() {
  const [tab, setTab] = useState<'marked' | 'candidates'>('marked');
  const [influencers, setInfluencers] = useState<InfluencerListItem[]>([]);
  const [candidates, setCandidates] = useState<CandidateCreator[]>([]);
  const [tiers, setTiers] = useState<TierInfo[]>([]);
  const [minSubs, setMinSubs] = useState(1000);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  async function load() {
    setLoading(true);
    try {
      const [tRes] = await Promise.all([listInfluencerTiers()]);
      setTiers(tRes.tiers);
      if (tab === 'marked') {
        const r = await listInfluencers(100);
        setInfluencers(r.influencers);
      } else {
        const r = await listInfluencerCandidates(minSubs);
        setCandidates(r.candidates);
      }
    } catch (err) {
      showToast((err as Error).message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, minSubs]);

  function showToast(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  }

  async function handleMark(userId: string, tier: InfluencerTier) {
    setBusy(true);
    try {
      await markInfluencer(userId, { tier });
      showToast(`Marked as ${tier}`);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUnmark(userId: string) {
    if (!confirm('Remove influencer status?')) return;
    setBusy(true);
    try {
      await unmarkInfluencer(userId);
      showToast('Removed');
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleTierChange(userId: string, tier: InfluencerTier) {
    setBusy(true);
    try {
      await updateInfluencerTier(userId, tier);
      showToast(`Tier: ${tier}`);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mf-page-title" style={{ marginBottom: 20 }}>Influencers</h1>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid #e5e5e5' }}>
        <button
          onClick={() => setTab('marked')}
          style={{
            padding: '10px 16px', background: 'transparent', border: 'none',
            borderBottom: tab === 'marked' ? '2px solid #065fd4' : '2px solid transparent',
            color: tab === 'marked' ? '#065fd4' : '#606060',
            fontWeight: tab === 'marked' ? 600 : 400, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13,
          }}
        >
          ⭐ Marked ({influencers.length})
        </button>
        <button
          onClick={() => setTab('candidates')}
          style={{
            padding: '10px 16px', background: 'transparent', border: 'none',
            borderBottom: tab === 'candidates' ? '2px solid #065fd4' : '2px solid transparent',
            color: tab === 'candidates' ? '#065fd4' : '#606060',
            fontWeight: tab === 'candidates' ? 600 : 400, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13,
          }}
        >
          🔍 Candidates
        </button>
      </div>

      {/* Tier legend */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {tiers.map((t) => (
          <span key={t.id} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 10,
            background: TIER_COLORS[t.id]?.bg ?? '#f3f4f6',
            color: TIER_COLORS[t.id]?.fg ?? '#4b5563',
            fontWeight: 600,
          }}>
            {t.label} ≥ {fmtNum(t.min_subs)} subs
          </span>
        ))}
      </div>

      {/* Candidates filter */}
      {tab === 'candidates' && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 13, color: '#606060' }}>Min subscribers:</label>
          <input
            type="number"
            className="mf-input"
            value={minSubs}
            onChange={(e) => setMinSubs(Math.max(0, parseInt(e.target.value) || 0))}
            style={{ width: 140, padding: '6px 10px', fontSize: 13 }}
          />
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>Loading...</div>
      ) : tab === 'marked' ? (
        influencers.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>
            No influencers marked yet. Check the Candidates tab.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {influencers.map((inf) => (
              <div key={inf.user_id} style={{
                background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
                padding: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '3px 12px',
                    borderRadius: 12, textTransform: 'uppercase',
                    background: TIER_COLORS[inf.tier]?.bg ?? '#f3f4f6',
                    color: TIER_COLORS[inf.tier]?.fg ?? '#4b5563',
                  }}>
                    {tierLabel(inf.tier)}
                  </span>
                  <strong style={{ fontSize: 15 }}>
                    {inf.display_name || inf.username ? `@${inf.username}` : inf.user_id.slice(0, 8)}
                  </strong>
                  <span style={{ fontSize: 12, color: '#909090' }}>{inf.email}</span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <select
                      className="mf-input"
                      value={inf.tier}
                      onChange={(e) => handleTierChange(inf.user_id, e.target.value as InfluencerTier)}
                      disabled={busy}
                      style={{ fontSize: 12, padding: '4px 8px' }}
                    >
                      {tiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <button
                      className="mf-btn-text"
                      onClick={() => handleUnmark(inf.user_id)}
                      disabled={busy}
                      style={{ fontSize: 12, color: '#dc2626' }}
                    >Remove</button>
                  </div>
                </div>

                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                  gap: 8, fontSize: 12,
                }}>
                  <Metric label="Subs" value={fmtNum(inf.subscriber_count)} />
                  <Metric label="Videos" value={inf.video_count} />
                  <Metric label="Views" value={fmtNum(inf.total_views)} />
                  <Metric label="Likes" value={fmtNum(inf.total_likes)} />
                  <Metric label="Comments" value={fmtNum(inf.total_comments)} />
                  <Metric label="Engagement" value={(inf.engagement_rate * 100).toFixed(2) + '%'} />
                  <Metric label="Referrals" value={inf.referral_completed} />
                  <Metric label="Est. earnings" value={'$' + inf.estimated_earnings.toFixed(2)} />
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        candidates.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>
            No candidates with ≥ {minSubs} subscribers.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {candidates.map((c) => (
              <div key={c.user_id} style={{
                background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
                padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <strong>{c.display_name || (c.username ? `@${c.username}` : c.user_id.slice(0, 8))}</strong>
                  <div style={{ fontSize: 12, color: '#606060', marginTop: 2 }}>
                    {fmtNum(c.subscriber_count)} subs · {c.video_count} videos · {fmtNum(c.total_views)} views
                  </div>
                </div>
                {c.is_influencer ? (
                  <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Already marked</span>
                ) : (
                  <>
                    <span style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 10, fontWeight: 600,
                      background: TIER_COLORS[c.suggested_tier]?.bg ?? '#f3f4f6',
                      color: TIER_COLORS[c.suggested_tier]?.fg ?? '#4b5563',
                    }}>
                      Suggest: {tierLabel(c.suggested_tier)}
                    </span>
                    <button
                      className="mf-btn-primary"
                      onClick={() => handleMark(c.user_id, c.suggested_tier)}
                      disabled={busy}
                      style={{ fontSize: 12, padding: '6px 14px' }}
                    >
                      ⭐ Mark
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {toast && <div className="mf-toast">{toast}</div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ background: '#fafafa', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#909090', textTransform: 'uppercase', letterSpacing: 0.2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f0f0f', marginTop: 2 }}>{value}</div>
    </div>
  );
}
