import { useEffect, useState } from 'react';
import {
  listAdCampaigns, getAdCampaign, createAdCampaign, updateAdCampaign, deleteAdCampaign,
  submitAdCampaign, approveAdCampaign, rejectAdCampaign, setAdCampaignStatus,
  getAdCampaignAnalytics, getAdBillingReport, listAdFormats, listAdPods, createAdPod, deleteAdPod,
  type AdCampaign, type AdStatus, type AdFormat, type CampaignAnalytics, type DailySeriesPoint,
  type BillingSummary, type BillingLedgerEntry, type AdPod,
} from '../lib/api';

const STATUS_COLORS: Record<AdStatus, { bg: string; fg: string }> = {
  draft:          { bg: '#f3f4f6', fg: '#4b5563' },
  pending_review: { bg: '#fef3c7', fg: '#92400e' },
  approved:       { bg: '#dbeafe', fg: '#1e40af' },
  rejected:       { bg: '#fee2e2', fg: '#991b1b' },
  active:         { bg: '#dcfce7', fg: '#166534' },
  paused:         { bg: '#fef9c3', fg: '#854d0e' },
  completed:      { bg: '#e0e7ff', fg: '#4338ca' },
  archived:       { bg: '#f3f4f6', fg: '#6b7280' },
};

function fmtMoney(n: number): string {
  return '$' + n.toFixed(2);
}
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + '%';
}
function fmtDate(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

const EMPTY_CAMPAIGN: Partial<AdCampaign> & { name: string; advertiser: string; format: AdFormat; creative_url: string; click_url: string } = {
  name: '', advertiser: '', format: 'banner', creative_url: '', click_url: '',
  cta_text: '', thumbnail_url: '',
  budget_total: 100, cpm: 5, cpc: 0.5,
  is_skippable: 1, skip_after_seconds: 5, duration_seconds: 30,
  freq_cap_per_user: 3, freq_cap_window_hours: 24, freq_cap_per_session: 1,
  requires_consent: 0, consent_scope: 'any',
  target_gender: 'any', target_age_min: 0, target_age_max: 120,
};

export default function AdminAdCampaigns() {
  const [tab, setTab] = useState<'campaigns' | 'pods' | 'billing'>('campaigns');
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [formats, setFormats] = useState<{ id: AdFormat; label: string; description: string }[]>([]);
  const [pods, setPods] = useState<AdPod[]>([]);
  const [billing, setBilling] = useState<BillingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [statusFilter, setStatusFilter] = useState<AdStatus | ''>('');

  // Campaign editor
  const [editing, setEditing] = useState<Partial<AdCampaign> | null>(null);

  // Detail modal
  const [detail, setDetail] = useState<{
    campaign: AdCampaign;
    analytics: CampaignAnalytics;
    daily: DailySeriesPoint[];
    ledger: BillingLedgerEntry[];
  } | null>(null);

  // New pod form
  const [podForm, setPodForm] = useState<{ name: string; max_ads: number; max_duration_seconds: number } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [f, p] = await Promise.all([
        listAdFormats().catch(() => ({ formats: [] })),
        listAdPods().catch(() => ({ pods: [] })),
      ]);
      setFormats(f.formats);
      setPods(p.pods);

      if (tab === 'campaigns') {
        const c = await listAdCampaigns({ status: statusFilter || undefined, limit: 200 });
        setCampaigns(c.campaigns);
      } else if (tab === 'billing') {
        const b = await getAdBillingReport(statusFilter ? { status: statusFilter as AdStatus } : {});
        setBilling(b.report);
      }
    } catch (err) {
      showToast((err as Error).message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, statusFilter]);

  function showToast(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 3000);
  }

  // ---------- Campaign CRUD ----------
  async function handleSave() {
    if (!editing) return;
    if (!editing.name?.trim() || !editing.advertiser?.trim() || !editing.creative_url?.trim() || !editing.click_url?.trim()) {
      showToast('Please fill all required fields');
      return;
    }
    setBusy(true);
    try {
      if ((editing as AdCampaign).id) {
        await updateAdCampaign((editing as AdCampaign).id, editing);
        showToast('Campaign updated');
      } else {
        await createAdCampaign(editing as any);
        showToast('Campaign created');
      }
      setEditing(null);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this campaign?')) return;
    setBusy(true);
    try {
      await deleteAdCampaign(id);
      showToast('Deleted');
      if (detail?.campaign.id === id) setDetail(null);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(id: string) {
    setBusy(true);
    try { await submitAdCampaign(id); showToast('Submitted for review'); await load(); }
    catch (err) { showToast((err as Error).message || 'Failed'); }
    finally { setBusy(false); }
  }

  async function handleApprove(id: string) {
    setBusy(true);
    try { await approveAdCampaign(id); showToast('Approved'); await load(); }
    catch (err) { showToast((err as Error).message || 'Failed'); }
    finally { setBusy(false); }
  }

  async function handleReject(id: string) {
    const notes = prompt('Rejection reason (optional):') ?? '';
    setBusy(true);
    try { await rejectAdCampaign(id, notes); showToast('Rejected'); await load(); }
    catch (err) { showToast((err as Error).message || 'Failed'); }
    finally { setBusy(false); }
  }

  async function handleStatus(id: string, status: AdStatus) {
    setBusy(true);
    try { await setAdCampaignStatus(id, status); showToast(`Set to ${status}`); await load(); }
    catch (err) { showToast((err as Error).message || 'Failed'); }
    finally { setBusy(false); }
  }

  async function openDetail(id: string) {
    try {
      const [info, analyticsRes] = await Promise.all([
        getAdCampaign(id),
        getAdCampaignAnalytics(id),
      ]);
      setDetail({
        campaign: info.campaign,
        analytics: analyticsRes.analytics,
        daily: analyticsRes.daily,
        ledger: analyticsRes.ledger,
      });
    } catch (err) {
      showToast((err as Error).message || 'Load detail failed');
    }
  }

  // ---------- Pods ----------
  async function handleCreatePod() {
    if (!podForm || !podForm.name.trim()) return;
    setBusy(true);
    try {
      await createAdPod(podForm);
      showToast('Pod created');
      setPodForm(null);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePod(id: string) {
    if (!confirm('Delete this pod?')) return;
    setBusy(true);
    try { await deleteAdPod(id); showToast('Deleted'); await load(); }
    catch (err) { showToast((err as Error).message || 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>Ads & Campaigns</h1>
        {tab === 'campaigns' && (
          <button className="mf-btn-primary" onClick={() => setEditing({ ...EMPTY_CAMPAIGN })}>
            + New Campaign
          </button>
        )}
        {tab === 'pods' && (
          <button className="mf-btn-primary" onClick={() => setPodForm({ name: '', max_ads: 3, max_duration_seconds: 90 })}>
            + New Pod
          </button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #e5e5e5' }}>
        {([
          { id: 'campaigns', label: '📢 Campaigns' },
          { id: 'pods', label: '📦 Ad Pods' },
          { id: 'billing', label: '💰 Billing' },
        ] as { id: 'campaigns' | 'pods' | 'billing'; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid #065fd4' : '2px solid transparent',
              color: tab === t.id ? '#065fd4' : '#606060',
              fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Filter */}
      {(tab === 'campaigns' || tab === 'billing') && (
        <div style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#606060' }}>Filter:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="mf-input"
            style={{ padding: '6px 12px', fontSize: 13 }}
          >
            <option value="">All statuses</option>
            {(['draft', 'pending_review', 'approved', 'rejected', 'active', 'paused', 'completed', 'archived'] as AdStatus[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>Loading...</div>
      ) : tab === 'campaigns' ? (
        campaigns.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>No campaigns. Create your first one.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {campaigns.map((c) => {
              const sc = STATUS_COLORS[c.status];
              const budgetPct = c.budget_total > 0 ? Math.min(100, (c.budget_spent / c.budget_total) * 100) : 0;
              return (
                <div key={c.id} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10, background: sc.bg, color: sc.fg, textTransform: 'uppercase' }}>
                      {c.status}
                    </span>
                    <strong style={{ fontSize: 15 }}>{c.name}</strong>
                    <span style={{ fontSize: 12, color: '#909090' }}>{c.advertiser}</span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#f3f4f6', color: '#4b5563' }}>
                      {c.format}
                    </span>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <button className="mf-btn-text" onClick={() => openDetail(c.id)} style={{ fontSize: 12, color: '#065fd4' }}>📊 Stats</button>
                      {c.status === 'draft' && (
                        <button className="mf-btn-text" onClick={() => handleSubmit(c.id)} disabled={busy} style={{ fontSize: 12, color: '#d97706' }}>Submit</button>
                      )}
                      {c.status === 'pending_review' && (
                        <>
                          <button className="mf-btn-text" onClick={() => handleApprove(c.id)} disabled={busy} style={{ fontSize: 12, color: '#16a34a' }}>✓ Approve</button>
                          <button className="mf-btn-text" onClick={() => handleReject(c.id)} disabled={busy} style={{ fontSize: 12, color: '#dc2626' }}>✗ Reject</button>
                        </>
                      )}
                      {c.status === 'approved' && (
                        <button className="mf-btn-text" onClick={() => handleStatus(c.id, 'active')} disabled={busy} style={{ fontSize: 12, color: '#16a34a' }}>▶ Activate</button>
                      )}
                      {c.status === 'active' && (
                        <button className="mf-btn-text" onClick={() => handleStatus(c.id, 'paused')} disabled={busy} style={{ fontSize: 12, color: '#d97706' }}>⏸ Pause</button>
                      )}
                      {c.status === 'paused' && (
                        <button className="mf-btn-text" onClick={() => handleStatus(c.id, 'active')} disabled={busy} style={{ fontSize: 12, color: '#16a34a' }}>▶ Resume</button>
                      )}
                      <button className="mf-btn-text" onClick={() => setEditing(c)} style={{ fontSize: 12 }}>✏️</button>
                      <button className="mf-btn-text" onClick={() => handleDelete(c.id)} disabled={busy} style={{ fontSize: 12, color: '#dc2626' }}>🗑</button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, fontSize: 11 }}>
                    <Metric label="Impressions" value={fmtNum(c.impression_count)} />
                    <Metric label="Clicks" value={fmtNum(c.click_count)} />
                    <Metric label="CTR" value={c.impression_count > 0 ? ((c.click_count / c.impression_count) * 100).toFixed(2) + '%' : '—'} />
                    <Metric label="Budget" value={`${fmtMoney(c.budget_spent)} / ${fmtMoney(c.budget_total)}`} />
                    <Metric label="CPM" value={fmtMoney(c.cpm)} />
                    <Metric label="CPC" value={fmtMoney(c.cpc)} />
                  </div>

                  {c.budget_total > 0 && (
                    <div style={{ marginTop: 8, height: 4, background: '#e5e5e5', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${budgetPct}%`, height: '100%', background: budgetPct >= 90 ? '#dc2626' : '#065fd4', transition: 'width 0.3s' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'pods' ? (
        pods.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>No pods. Create one to group multiple ads.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {pods.map((p) => (
              <div key={p.id} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <strong style={{ fontSize: 14 }}>{p.name}</strong>
                  <button className="mf-btn-text" onClick={() => handleDeletePod(p.id)} style={{ color: '#dc2626', fontSize: 12 }}>×</button>
                </div>
                <div style={{ fontSize: 12, color: '#606060' }}>
                  Max {p.max_ads} ads · {p.max_duration_seconds}s · {p.ad_break_type}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        billing.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>No billing data.</div>
        ) : (
          <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10 }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead style={{ background: '#fafafa' }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: 10 }}>Campaign</th>
                  <th style={{ textAlign: 'left', padding: 10 }}>Advertiser</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>Impressions</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>Clicks</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>Budget</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>Spent</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>Revenue</th>
                  <th style={{ textAlign: 'right', padding: 10 }}>CPM eff.</th>
                </tr>
              </thead>
              <tbody>
                {billing.map((b) => (
                  <tr key={b.campaign_id} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td style={{ padding: 10, fontWeight: 500 }}>{b.name}</td>
                    <td style={{ padding: 10, color: '#606060' }}>{b.advertiser}</td>
                    <td style={{ padding: 10, textAlign: 'right' }}>{fmtNum(b.impressions)}</td>
                    <td style={{ padding: 10, textAlign: 'right' }}>{fmtNum(b.clicks)}</td>
                    <td style={{ padding: 10, textAlign: 'right' }}>{fmtMoney(b.budget_total)}</td>
                    <td style={{ padding: 10, textAlign: 'right' }}>{fmtMoney(b.budget_spent)}</td>
                    <td style={{ padding: 10, textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{fmtMoney(b.total_revenue)}</td>
                    <td style={{ padding: 10, textAlign: 'right' }}>{fmtMoney(b.cpm_effective)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Campaign editor modal */}
      {editing && (
        <div className="mf-modal-backdrop" onClick={() => !busy && setEditing(null)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '88vh', overflow: 'auto' }}>
            <h2 style={{ fontSize: 17, marginBottom: 14 }}>{(editing as AdCampaign).id ? 'Edit Campaign' : 'New Campaign'}</h2>

            <SectionLabel>Basic</SectionLabel>
            <Row2>
              <Field label="Name *"><input className="mf-input" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Advertiser *"><input className="mf-input" value={editing.advertiser ?? ''} onChange={(e) => setEditing({ ...editing, advertiser: e.target.value })} /></Field>
            </Row2>

            <Row2>
              <Field label="Format">
                <select className="mf-input" value={editing.format ?? 'banner'} onChange={(e) => setEditing({ ...editing, format: e.target.value as AdFormat })}>
                  {formats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </Field>
              <Field label="Ad Pod (optional)">
                <select className="mf-input" value={editing.pod_id ?? ''} onChange={(e) => setEditing({ ...editing, pod_id: e.target.value || null })}>
                  <option value="">— None —</option>
                  {pods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </Row2>

            <SectionLabel>Creative</SectionLabel>
            <Field label="Creative URL *"><input className="mf-input" value={editing.creative_url ?? ''} onChange={(e) => setEditing({ ...editing, creative_url: e.target.value })} placeholder="https://cdn.example.com/ad.mp4" /></Field>
            <Field label="Click URL *"><input className="mf-input" value={editing.click_url ?? ''} onChange={(e) => setEditing({ ...editing, click_url: e.target.value })} placeholder="https://advertiser.com/offer" /></Field>
            <Row2>
              <Field label="Thumbnail (optional)"><input className="mf-input" value={editing.thumbnail_url ?? ''} onChange={(e) => setEditing({ ...editing, thumbnail_url: e.target.value })} /></Field>
              <Field label="CTA text"><input className="mf-input" value={editing.cta_text ?? ''} onChange={(e) => setEditing({ ...editing, cta_text: e.target.value })} placeholder="Learn more" /></Field>
            </Row2>

            <SectionLabel>Delivery</SectionLabel>
            <Row3>
              <Field label="Skippable">
                <select className="mf-input" value={editing.is_skippable === 1 ? '1' : '0'} onChange={(e) => setEditing({ ...editing, is_skippable: parseInt(e.target.value) })}>
                  <option value="1">Skippable</option>
                  <option value="0">Non-skippable</option>
                </select>
              </Field>
              <Field label="Skip after (s)"><input type="number" className="mf-input" value={editing.skip_after_seconds ?? 5} onChange={(e) => setEditing({ ...editing, skip_after_seconds: parseInt(e.target.value) })} /></Field>
              <Field label="Duration (s)"><input type="number" className="mf-input" value={editing.duration_seconds ?? 0} onChange={(e) => setEditing({ ...editing, duration_seconds: parseInt(e.target.value) })} /></Field>
            </Row3>

            <Row3>
              <Field label="Freq cap per user"><input type="number" className="mf-input" value={editing.freq_cap_per_user ?? 3} onChange={(e) => setEditing({ ...editing, freq_cap_per_user: parseInt(e.target.value) })} /></Field>
              <Field label="Cap window (h)"><input type="number" className="mf-input" value={editing.freq_cap_window_hours ?? 24} onChange={(e) => setEditing({ ...editing, freq_cap_window_hours: parseInt(e.target.value) })} /></Field>
              <Field label="Cap per session"><input type="number" className="mf-input" value={editing.freq_cap_per_session ?? 1} onChange={(e) => setEditing({ ...editing, freq_cap_per_session: parseInt(e.target.value) })} /></Field>
            </Row3>

            <SectionLabel>Budget</SectionLabel>
            <Row3>
              <Field label="Total budget ($)"><input type="number" className="mf-input" value={editing.budget_total ?? 0} onChange={(e) => setEditing({ ...editing, budget_total: parseFloat(e.target.value) })} /></Field>
              <Field label="CPM ($)"><input type="number" className="mf-input" value={editing.cpm ?? 0} onChange={(e) => setEditing({ ...editing, cpm: parseFloat(e.target.value) })} /></Field>
              <Field label="CPC ($)"><input type="number" className="mf-input" value={editing.cpc ?? 0} onChange={(e) => setEditing({ ...editing, cpc: parseFloat(e.target.value) })} /></Field>
            </Row3>

            <SectionLabel>Schedule</SectionLabel>
            <Row2>
              <Field label="Starts at (optional)"><input type="datetime-local" className="mf-input" value={editing.starts_at ? editing.starts_at.slice(0, 16) : ''} onChange={(e) => setEditing({ ...editing, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
              <Field label="Ends at (optional)"><input type="datetime-local" className="mf-input" value={editing.ends_at ? editing.ends_at.slice(0, 16) : ''} onChange={(e) => setEditing({ ...editing, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
            </Row2>

            <SectionLabel>Consent</SectionLabel>
            <Row2>
              <Field label="Requires consent">
                <select className="mf-input" value={editing.requires_consent === 1 ? '1' : '0'} onChange={(e) => setEditing({ ...editing, requires_consent: parseInt(e.target.value) })}>
                  <option value="0">No</option>
                  <option value="1">Yes</option>
                </select>
              </Field>
              <Field label="Consent scope">
                <select className="mf-input" value={editing.consent_scope ?? 'any'} onChange={(e) => setEditing({ ...editing, consent_scope: e.target.value })}>
                  <option value="any">Any</option>
                  <option value="personalized">Personalized</option>
                  <option value="non_personalized">Non-personalized</option>
                </select>
              </Field>
            </Row2>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="mf-btn-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="mf-btn-text mf-btn-text-primary" onClick={handleSave} disabled={busy}>
                {busy ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pod form modal */}
      {podForm && (
        <div className="mf-modal-backdrop" onClick={() => setPodForm(null)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h2 style={{ fontSize: 17, marginBottom: 14 }}>New Ad Pod</h2>
            <Field label="Name"><input className="mf-input" value={podForm.name} onChange={(e) => setPodForm({ ...podForm, name: e.target.value })} /></Field>
            <Row2>
              <Field label="Max ads"><input type="number" className="mf-input" value={podForm.max_ads} onChange={(e) => setPodForm({ ...podForm, max_ads: parseInt(e.target.value) })} /></Field>
              <Field label="Max duration (s)"><input type="number" className="mf-input" value={podForm.max_duration_seconds} onChange={(e) => setPodForm({ ...podForm, max_duration_seconds: parseInt(e.target.value) })} /></Field>
            </Row2>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="mf-btn-secondary" onClick={() => setPodForm(null)} disabled={busy}>Cancel</button>
              <button className="mf-btn-text mf-btn-text-primary" onClick={handleCreatePod} disabled={busy || !podForm.name.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="mf-modal-backdrop" onClick={() => setDetail(null)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, maxHeight: '85vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 18, marginBottom: 4 }}>{detail.campaign.name}</h2>
                <div style={{ fontSize: 12, color: '#909090' }}>{detail.campaign.advertiser} · {detail.campaign.format}</div>
              </div>
              <button className="mf-btn-text" onClick={() => setDetail(null)} style={{ fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 18 }}>
              <Stat label="Impressions" value={fmtNum(detail.analytics.impressions)} />
              <Stat label="Clicks" value={fmtNum(detail.analytics.clicks)} color="#065fd4" />
              <Stat label="CTR" value={fmtPct(detail.analytics.ctr)} />
              <Stat label="Revenue" value={fmtMoney(detail.analytics.revenue)} color="#16a34a" />
              <Stat label="Budget left" value={fmtMoney(detail.analytics.budget_remaining)} />
              <Stat label="Eff. CPM" value={fmtMoney(detail.analytics.avg_cpm_effective)} />
            </div>

            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Daily performance (last 30 days)</h3>
            {detail.daily.length === 0 ? (
              <div style={{ fontSize: 12, color: '#909090', marginBottom: 16 }}>No events recorded yet.</div>
            ) : (
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginBottom: 16 }}>
                <thead style={{ background: '#fafafa' }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 6 }}>Day</th>
                    <th style={{ textAlign: 'right', padding: 6 }}>Impressions</th>
                    <th style={{ textAlign: 'right', padding: 6 }}>Clicks</th>
                    <th style={{ textAlign: 'right', padding: 6 }}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.daily.map((d) => (
                    <tr key={d.day} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ padding: 6 }}>{d.day}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{d.impressions}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{d.clicks}</td>
                      <td style={{ padding: 6, textAlign: 'right' }}>{fmtMoney(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Billing ledger (last {detail.ledger.length})</h3>
            {detail.ledger.length === 0 ? (
              <div style={{ fontSize: 12, color: '#909090' }}>No billing entries.</div>
            ) : (
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e5e5e5', borderRadius: 8 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <tbody>
                    {detail.ledger.map((l) => (
                      <tr key={l.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                        <td style={{ padding: 6 }}>{fmtDate(l.created_at)}</td>
                        <td style={{ padding: 6 }}>{l.entry_type}</td>
                        <td style={{ padding: 6, textAlign: 'right', color: '#16a34a' }}>{fmtMoney(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="mf-toast">{toast}</div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ background: '#fafafa', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#909090', textTransform: 'uppercase', letterSpacing: 0.2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f0f0f', marginTop: 2 }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div style={{ background: '#fafafa', border: '1px solid #e5e5e5', borderRadius: 8, padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: '#909090', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color ?? '#0f0f0f', marginTop: 4 }}>{value}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: '#909090', marginTop: 16, marginBottom: 8 }}>{children}</div>;
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{children}</div>;
}

function Row3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#4b5563' }}>{label}</label>
      {children}
    </div>
  );
}
