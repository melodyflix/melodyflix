// melodyflix web — Ad Management admin dashboard (Section 51)
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adminListAdCampaigns, adminApproveAdCampaign, adminRejectAdCampaign,
  adminSubmitAdCampaign, adminSetAdCampaignStatus, adminDeleteAdCampaign,
  adminGetAdRevenueOverview, adminGetAdRevenueDaily, adminGetAdTopAdvertisers,
  adminGetAdBlockStats, adminListAdBlockEvents,
  adminListAdPods, adminCreateAdPod, adminDeleteAdPod,
  AdminAdCampaign, AdminAdStatus, AdminAdRevenueOverview,
  AdminAdDailyPoint, AdminAdTopAdvertiser,
  AdminAdBlockStats, AdminAdBlockEvent, AdPod,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

type Tab = 'revenue' | 'campaigns' | 'adblock' | 'pods';

const STATUS_COLORS: Record<AdminAdStatus, string> = {
  draft: '#888',
  pending_review: '#e7a800',
  approved: '#0a7',
  rejected: 'crimson',
  active: '#0a7',
  paused: '#e7a800',
  completed: '#333',
  archived: '#bbb',
};

export default function AdminAds({ onSignIn }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('revenue');
  const [error, setError] = useState<string | null>(null);

  // Revenue state
  const [overview, setOverview] = useState<AdminAdRevenueOverview | null>(null);
  const [daily, setDaily] = useState<AdminAdDailyPoint[]>([]);
  const [advertisers, setAdvertisers] = useState<AdminAdTopAdvertiser[]>([]);

  // Campaigns state
  const [campaigns, setCampaigns] = useState<AdminAdCampaign[]>([]);
  const [statusFilter, setStatusFilter] = useState<AdminAdStatus | ''>('pending_review');
  const [busy, setBusy] = useState<string | null>(null);

  // AdBlock state
  const [abStats, setAbStats] = useState<AdminAdBlockStats | null>(null);
  const [abEvents, setAbEvents] = useState<AdminAdBlockEvent[]>([]);

  // Pods state
  const [pods, setPods] = useState<AdPod[]>([]);
  const [newPodName, setNewPodName] = useState('');
  const [newPodMax, setNewPodMax] = useState(3);
  const [newPodDuration, setNewPodDuration] = useState(120);
  const [newPodType, setNewPodType] = useState('mid-roll');

  const handleErr = (e: any) => {
    const msg = e?.message ?? 'Request failed';
    if (String(msg).toLowerCase().includes('unauth') || String(msg).toLowerCase().includes('admin')) {
      setError('Admin access required.');
    } else {
      setError(msg);
    }
  };

  const loadRevenue = async () => {
    try {
      setError(null);
      const [o, d, a] = await Promise.all([
        adminGetAdRevenueOverview(),
        adminGetAdRevenueDaily({ days: 30 }).catch(() => ({ daily: [], count: 0 })),
        adminGetAdTopAdvertisers({ limit: 10 }).catch(() => ({ advertisers: [], count: 0 })),
      ]);
      setOverview(o);
      setDaily(d.daily);
      setAdvertisers(a.advertisers);
    } catch (e) { handleErr(e); }
  };

  const loadCampaigns = async () => {
    try {
      setError(null);
      const r = await adminListAdCampaigns({
        status: statusFilter || undefined,
        limit: 100,
      });
      setCampaigns(r.campaigns);
    } catch (e) { handleErr(e); }
  };

  const loadAdBlock = async () => {
    try {
      setError(null);
      const [s, e] = await Promise.all([
        adminGetAdBlockStats(),
        adminListAdBlockEvents({ limit: 50 }),
      ]);
      setAbStats(s);
      setAbEvents(e.events);
    } catch (err) { handleErr(err); }
  };

  const loadPods = async () => {
    try {
      setError(null);
      const r = await adminListAdPods();
      setPods(r.pods);
    } catch (e) { handleErr(e); }
  };

  useEffect(() => {
    if (tab === 'revenue') loadRevenue();
    else if (tab === 'campaigns') loadCampaigns();
    else if (tab === 'adblock') loadAdBlock();
    else if (tab === 'pods') loadPods();
    // eslint-disable-next-line
  }, [tab, statusFilter]);

  const doApprove = async (id: string) => {
    setBusy(id);
    try { await adminApproveAdCampaign(id); await loadCampaigns(); }
    catch (e) { handleErr(e); }
    finally { setBusy(null); }
  };

  const doReject = async (id: string) => {
    const notes = prompt('Rejection notes (optional):') ?? '';
    setBusy(id);
    try { await adminRejectAdCampaign(id, notes); await loadCampaigns(); }
    catch (e) { handleErr(e); }
    finally { setBusy(null); }
  };

  const doSubmit = async (id: string) => {
    setBusy(id);
    try { await adminSubmitAdCampaign(id); await loadCampaigns(); }
    catch (e) { handleErr(e); }
    finally { setBusy(null); }
  };

  const doToggleActive = async (c: AdminAdCampaign) => {
    const next: AdminAdStatus = c.status === 'active' ? 'paused' : 'active';
    setBusy(c.id);
    try { await adminSetAdCampaignStatus(c.id, next); await loadCampaigns(); }
    catch (e) { handleErr(e); }
    finally { setBusy(null); }
  };

  const doDelete = async (id: string) => {
    if (!confirm('Delete this campaign permanently?')) return;
    setBusy(id);
    try { await adminDeleteAdCampaign(id); await loadCampaigns(); }
    catch (e) { handleErr(e); }
    finally { setBusy(null); }
  };

  const doCreatePod = async () => {
    if (!newPodName.trim()) return;
    setBusy('new-pod');
    try {
      await adminCreateAdPod({
        name: newPodName,
        max_ads: newPodMax,
        max_duration_seconds: newPodDuration,
        ad_break_type: newPodType,
      });
      setNewPodName('');
      await loadPods();
    } catch (e) { handleErr(e); }
    finally { setBusy(null); }
  };

  const doDeletePod = async (id: string) => {
    if (!confirm('Delete this pod?')) return;
    try { await adminDeleteAdPod(id); await loadPods(); }
    catch (e) { handleErr(e); }
  };

  const fmtMoney = (n: number) => `$${n.toFixed(2)}`;
  const fmtNum = (n: number) => n.toLocaleString();
  const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <button onClick={() => navigate('/')} style={backBtn}>← Home</button>
        <h1 style={{ margin: '12px 0 4px', fontSize: 24, fontWeight: 700 }}>💰 Ad Management</h1>
        <p style={{ color: '#666', margin: 0, fontSize: 13 }}>Campaigns, revenue, adblock, and pod configuration</p>
      </header>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #eee', marginBottom: 20 }}>
        <TabBtn active={tab === 'revenue'} onClick={() => setTab('revenue')} label="📊 Revenue" />
        <TabBtn active={tab === 'campaigns'} onClick={() => setTab('campaigns')} label="📢 Campaigns" />
        <TabBtn active={tab === 'adblock'} onClick={() => setTab('adblock')} label="🛡 Ad Block" />
        <TabBtn active={tab === 'pods'} onClick={() => setTab('pods')} label="🎬 Ad Pods" />
      </div>

      {error && (
        <div style={{
          padding: 12, background: '#fff0f0', border: '1px solid #f5c6c6',
          borderRadius: 8, color: 'crimson', fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* REVENUE */}
      {tab === 'revenue' && (
        <div>
          {overview && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12, marginBottom: 24,
            }}>
              <Card label="Total Revenue" value={fmtMoney(overview.total_revenue)} accent="#0a7" />
              <Card label="Net (after 20% fee)" value={fmtMoney(overview.net_revenue)} />
              <Card label="Impressions" value={fmtNum(overview.total_impressions)} />
              <Card label="Clicks" value={fmtNum(overview.total_clicks)} />
              <Card label="CTR" value={fmtPct(overview.ctr)} />
              <Card label="Completion" value={fmtPct(overview.completion_rate)} />
              <Card label="Active Campaigns" value={String(overview.active_campaigns)} />
              <Card label="Pending Review" value={String(overview.pending_review)} accent={overview.pending_review > 0 ? '#e7a800' : undefined} />
            </div>
          )}

          {/* Daily revenue mini-chart */}
          {daily.length > 0 && (
            <section style={{ marginBottom: 24, padding: 16, border: '1px solid #eee', borderRadius: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>Daily revenue (last 30 days)</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 100 }}>
                {daily.map((d) => {
                  const max = Math.max(...daily.map((x) => x.revenue), 0.01);
                  const h = (d.revenue / max) * 100;
                  return (
                    <div
                      key={d.date}
                      title={`${d.date}: ${fmtMoney(d.revenue)}`}
                      style={{
                        flex: 1, minHeight: 2, height: `${Math.max(2, h)}%`,
                        background: 'linear-gradient(180deg, #0a7, #076)',
                        borderRadius: 3,
                      }}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* Top advertisers */}
          {advertisers.length > 0 && (
            <section style={{ padding: 16, border: '1px solid #eee', borderRadius: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>Top advertisers</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#666', borderBottom: '1px solid #eee' }}>
                    <th style={th}>Advertiser</th>
                    <th style={th}>Campaigns</th>
                    <th style={th}>Impressions</th>
                    <th style={th}>Clicks</th>
                    <th style={th}>CTR</th>
                    <th style={th}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {advertisers.map((a) => (
                    <tr key={a.advertiser} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={td}><strong>{a.advertiser}</strong></td>
                      <td style={td}>{a.campaign_count}</td>
                      <td style={td}>{fmtNum(a.impressions)}</td>
                      <td style={td}>{fmtNum(a.clicks)}</td>
                      <td style={td}>{fmtPct(a.ctr)}</td>
                      <td style={td}><strong>{fmtMoney(a.revenue)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}

      {/* CAMPAIGNS */}
      {tab === 'campaigns' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {['', 'pending_review', 'approved', 'active', 'paused', 'draft', 'rejected', 'completed'].map((s) => (
              <button
                key={s || 'all'}
                onClick={() => setStatusFilter(s as any)}
                style={{
                  padding: '5px 12px', fontSize: 12, borderRadius: 20,
                  background: statusFilter === s ? '#1a1a1a' : '#fff',
                  color: statusFilter === s ? '#fff' : '#333',
                  border: `1px solid ${statusFilter === s ? '#1a1a1a' : '#ddd'}`,
                  cursor: 'pointer',
                }}
              >
                {s ? s.replace(/_/g, ' ') : 'All'}
              </button>
            ))}
          </div>

          {campaigns.length === 0 && (
            <p style={{ padding: 40, textAlign: 'center', color: '#888' }}>No campaigns match this filter.</p>
          )}

          {campaigns.map((c) => (
            <div key={c.id} style={{
              padding: 14, border: '1px solid #eee', borderRadius: 10, marginBottom: 10,
              display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 14 }}>{c.name}</strong>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 10,
                    background: STATUS_COLORS[c.status] + '22',
                    color: STATUS_COLORS[c.status],
                    fontWeight: 700, textTransform: 'uppercase',
                  }}>{c.status.replace(/_/g, ' ')}</span>
                  <span style={{ fontSize: 11, color: '#888' }}>{c.format}</span>
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  {c.advertiser} · ${c.budget_spent.toFixed(2)} / ${c.budget_total.toFixed(2)} spent
                  {' · '}{c.impression_count} imp · {c.click_count} clk
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                {c.status === 'draft' && (
                  <button onClick={() => doSubmit(c.id)} disabled={busy === c.id} style={actionBtn('#fff', '#333', '#ddd')}>
                    Submit
                  </button>
                )}
                {c.status === 'pending_review' && (
                  <>
                    <button onClick={() => doApprove(c.id)} disabled={busy === c.id} style={actionBtn('#0a7', '#fff', '#0a7')}>
                      Approve
                    </button>
                    <button onClick={() => doReject(c.id)} disabled={busy === c.id} style={actionBtn('#fff', 'crimson', '#f5c6c6')}>
                      Reject
                    </button>
                  </>
                )}
                {(c.status === 'approved' || c.status === 'active' || c.status === 'paused') && (
                  <button onClick={() => doToggleActive(c)} disabled={busy === c.id} style={actionBtn('#fff', '#333', '#ddd')}>
                    {c.status === 'active' ? 'Pause' : 'Activate'}
                  </button>
                )}
                <button onClick={() => doDelete(c.id)} disabled={busy === c.id} style={actionBtn('#fff', '#888', '#eee')}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AD BLOCK */}
      {tab === 'adblock' && (
        <div>
          {abStats && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12, marginBottom: 24,
            }}>
              <Card label="Total events" value={fmtNum(abStats.total_events)} />
              <Card label="Unique users" value={fmtNum(abStats.unique_users)} />
              <Card label="Detected" value={fmtNum(abStats.detected_count)} accent="crimson" />
              <Card label="Detection rate" value={fmtPct(abStats.detection_rate)} accent="crimson" />
            </div>
          )}

          {abStats && abStats.by_method.length > 0 && (
            <section style={{ padding: 16, border: '1px solid #eee', borderRadius: 12, marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>By method</h3>
              {abStats.by_method.map((m) => (
                <div key={m.detection_method} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
                  <span>{m.detection_method}</span>
                  <strong>{m.count}</strong>
                </div>
              ))}
            </section>
          )}

          {abEvents.length > 0 && (
            <section style={{ padding: 16, border: '1px solid #eee', borderRadius: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>Recent events</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#666', borderBottom: '1px solid #eee' }}>
                    <th style={th}>When</th>
                    <th style={th}>Detected</th>
                    <th style={th}>Method</th>
                    <th style={th}>User</th>
                    <th style={th}>UA</th>
                  </tr>
                </thead>
                <tbody>
                  {abEvents.map((e) => (
                    <tr key={e.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={td}>{new Date(e.created_at).toLocaleString()}</td>
                      <td style={td}>
                        {e.detected ? <span style={{ color: 'crimson', fontWeight: 700 }}>yes</span> : 'no'}
                      </td>
                      <td style={td}>{e.detection_method ?? '—'}</td>
                      <td style={td}>{e.user_id?.slice(0, 8) ?? '—'}</td>
                      <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.user_agent ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {abEvents.length === 0 && !abStats && (
            <p style={{ padding: 40, textAlign: 'center', color: '#888' }}>No adblock data yet.</p>
          )}
        </div>
      )}

      {/* PODS */}
      {tab === 'pods' && (
        <div>
          <section style={{ padding: 16, border: '1px solid #cde7d9', borderRadius: 12, background: '#f4fbf7', marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>Create ad pod</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
              <input placeholder="Name" value={newPodName} onChange={(e) => setNewPodName(e.target.value)} style={inputStyle} />
              <input type="number" min={1} max={10} value={newPodMax} onChange={(e) => setNewPodMax(parseInt(e.target.value))} placeholder="Max ads" style={inputStyle} />
              <input type="number" min={30} max={600} value={newPodDuration} onChange={(e) => setNewPodDuration(parseInt(e.target.value))} placeholder="Max seconds" style={inputStyle} />
              <select value={newPodType} onChange={(e) => setNewPodType(e.target.value)} style={inputStyle}>
                <option value="pre-roll">pre-roll</option>
                <option value="mid-roll">mid-roll</option>
                <option value="post-roll">post-roll</option>
              </select>
            </div>
            <button
              onClick={doCreatePod}
              disabled={busy === 'new-pod' || !newPodName.trim()}
              style={{
                marginTop: 12, padding: '8px 16px', borderRadius: 8,
                background: '#0a7', color: '#fff', border: 'none',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {busy === 'new-pod' ? 'Creating…' : 'Create pod'}
            </button>
          </section>

          {pods.length === 0 && <p style={{ color: '#888', textAlign: 'center', padding: 20 }}>No ad pods yet.</p>}

          {pods.map((p) => (
            <div key={p.id} style={{
              padding: 12, border: '1px solid #eee', borderRadius: 10, marginBottom: 8,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                  {p.max_ads} ads max · {p.max_duration_seconds}s · {p.ad_break_type}
                </div>
              </div>
              <button onClick={() => doDeletePod(p.id)} style={actionBtn('#fff', 'crimson', '#f5c6c6')}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px', background: 'none', border: 'none',
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
        color: active ? '#1a1a1a' : '#888',
        borderBottom: `2px solid ${active ? '#0a7' : 'transparent'}`,
      }}
    >
      {label}
    </button>
  );
}

function Card({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ padding: 14, border: '1px solid #eee', borderRadius: 10, background: '#fafafa' }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ?? '#1a1a1a', marginTop: 4 }}>{value}</div>
    </div>
  );
}

const backBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid #ddd',
  background: '#fff', cursor: 'pointer', fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, background: '#fff', boxSizing: 'border-box',
};

const th: React.CSSProperties = { padding: '8px 6px', fontWeight: 600 };
const td: React.CSSProperties = { padding: '8px 6px' };

function actionBtn(bg: string, color: string, border: string): React.CSSProperties {
  return {
    padding: '6px 12px', borderRadius: 6, background: bg, color,
    border: `1px solid ${border}`, fontSize: 12, cursor: 'pointer', fontWeight: 500,
  };
}
