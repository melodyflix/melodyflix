import { useEffect, useState } from 'react';
import {
  listCampaigns, getCampaign, createCampaign, updateCampaign,
  deleteCampaign, sendCampaign, listCampaignRecipients, listAudiences,
  type EmailCampaign, type AudienceInfo, type CampaignStats,
  type CampaignRecipient, type AudienceType,
} from '../lib/api';

const STATUS_COLORS: Record<string, string> = {
  draft: '#9ca3af',
  scheduled: '#3b82f6',
  sending: '#f59e0b',
  sent: '#16a34a',
  cancelled: '#6b7280',
  failed: '#dc2626',
};

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default function AdminCampaigns() {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [audiences, setAudiences] = useState<AudienceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('<p>Hello {{email}},</p>\n<p>...</p>\n{{tracking_pixel}}');
  const [bodyText, setBodyText] = useState('');
  const [audience, setAudience] = useState<AudienceType>('all');
  const [busy, setBusy] = useState(false);

  // Detail view
  const [detail, setDetail] = useState<{
    campaign: EmailCampaign;
    stats: CampaignStats;
    recipients: CampaignRecipient[];
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [c, a] = await Promise.all([listCampaigns(), listAudiences()]);
      setCampaigns(c.campaigns);
      setAudiences(a.audiences);
    } catch (err) {
      showToast((err as Error).message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !subject.trim() || !bodyHtml.trim()) return;
    setBusy(true);
    try {
      await createCampaign({
        title: title.trim(),
        subject: subject.trim(),
        body_html: bodyHtml,
        body_text: bodyText || null,
        audience,
      });
      showToast('Campaign created');
      setTitle(''); setSubject(''); setBodyText('');
      setShowCreate(false);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(c: EmailCampaign) {
    if (!confirm(`Send "${c.title}" to ~${c.total_recipients || '?'} recipients?\nThis cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await sendCampaign(c.id);
      showToast(`Sent: ${res.sent} / ${res.total} (${res.failed} failed)`);
      await load();
      if (detail?.campaign.id === c.id) {
        await openDetail(c.id);
      }
    } catch (err) {
      showToast((err as Error).message || 'Send failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this campaign?')) return;
    setBusy(true);
    try {
      await deleteCampaign(id);
      showToast('Deleted');
      if (detail?.campaign.id === id) setDetail(null);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(c: EmailCampaign) {
    if (!confirm('Cancel this campaign?')) return;
    setBusy(true);
    try {
      await updateCampaign(c.id, { status: 'cancelled' });
      showToast('Cancelled');
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(id: string) {
    try {
      const [info, rec] = await Promise.all([
        getCampaign(id),
        listCampaignRecipients(id, 500),
      ]);
      setDetail({
        campaign: info.campaign,
        stats: info.stats,
        recipients: rec.recipients,
      });
    } catch (err) {
      showToast((err as Error).message || 'Load detail failed');
    }
  }

  const totalAudienceSize = audiences.find((a) => a.id === audience)?.size ?? 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>Email Campaigns</h1>
        <button
          className="mf-btn-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? 'Cancel' : '+ New Campaign'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          style={{
            background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12,
            padding: 20, marginBottom: 20,
          }}
        >
          <h2 style={{ fontSize: 15, marginBottom: 14 }}>New Campaign</h2>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Title</label>
            <input
              className="mf-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. September Newsletter"
              required
              maxLength={200}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Subject line</label>
            <input
              className="mf-input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What recipients will see in inbox"
              required
              maxLength={200}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Audience ({totalAudienceSize} users)
            </label>
            <select
              className="mf-input"
              value={audience}
              onChange={(e) => setAudience(e.target.value as AudienceType)}
              style={{ width: '100%' }}
            >
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} — {a.desc} ({a.size})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              HTML body
            </label>
            <textarea
              className="mf-input"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              required
              style={{ width: '100%', minHeight: 140, fontFamily: 'monospace', fontSize: 12 }}
            />
            <div style={{ fontSize: 11, color: '#909090', marginTop: 4 }}>
              Placeholders: <code>{'{{email}}'}</code> · <code>{'{{tracking_pixel}}'}</code>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Plain text (optional)
            </label>
            <textarea
              className="mf-input"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              style={{ width: '100%', minHeight: 60, fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="mf-btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" className="mf-btn-primary" disabled={busy}>
              {busy ? 'Creating...' : 'Create Draft'}
            </button>
          </div>
        </form>
      )}

      {/* Campaign list */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>Loading...</div>
      ) : campaigns.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>
          No campaigns yet. Create your first one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {campaigns.map((c) => (
            <div
              key={c.id}
              style={{
                background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10,
                padding: 14, display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: '#fff',
                  background: STATUS_COLORS[c.status] ?? '#666',
                  padding: '3px 10px', borderRadius: 10, textTransform: 'uppercase',
                }}>
                  {c.status}
                </span>
                <strong style={{ fontSize: 15, flex: 1 }}>{c.title}</strong>
                <span style={{ fontSize: 12, color: '#909090' }}>
                  {fmtDate(c.created_at)}
                </span>
              </div>

              <div style={{ fontSize: 13, color: '#606060' }}>
                <strong>Subject:</strong> {c.subject} · <strong>Audience:</strong> {c.audience}
              </div>

              <div style={{ fontSize: 12, color: '#606060', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>Total: <strong>{c.total_recipients}</strong></span>
                <span style={{ color: '#16a34a' }}>Sent: <strong>{c.sent_count}</strong></span>
                {c.failed_count > 0 && <span style={{ color: '#dc2626' }}>Failed: <strong>{c.failed_count}</strong></span>}
                <span>Opens: <strong>{c.open_count}</strong></span>
                <span>Clicks: <strong>{c.click_count}</strong></span>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                {(c.status === 'draft' || c.status === 'scheduled') && (
                  <button
                    className="mf-btn-primary"
                    onClick={() => handleSend(c)}
                    disabled={busy}
                    style={{ fontSize: 12, padding: '5px 14px' }}
                  >
                    📤 Send Now
                  </button>
                )}
                {c.status === 'sending' && (
                  <button
                    className="mf-btn-secondary"
                    onClick={() => handleCancel(c)}
                    disabled={busy}
                    style={{ fontSize: 12, padding: '5px 14px' }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="mf-btn-secondary"
                  onClick={() => openDetail(c.id)}
                  style={{ fontSize: 12, padding: '5px 14px' }}
                >
                  📊 Stats
                </button>
                <button
                  className="mf-btn-secondary"
                  onClick={() => handleDelete(c.id)}
                  disabled={busy}
                  style={{ fontSize: 12, padding: '5px 14px', color: '#dc2626' }}
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="mf-modal-backdrop" onClick={() => setDetail(null)}>
          <div
            className="mf-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 760, maxHeight: '85vh', overflow: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 18, marginBottom: 4 }}>{detail.campaign.title}</h2>
                <div style={{ fontSize: 12, color: '#909090' }}>{detail.campaign.subject}</div>
              </div>
              <button className="mf-btn-text" onClick={() => setDetail(null)} style={{ fontSize: 18 }}>✕</button>
            </div>

            {/* Stats grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: 10, marginBottom: 20,
            }}>
              <StatCard label="Total" value={detail.stats.total} />
              <StatCard label="Sent" value={detail.stats.sent} color="#16a34a" />
              <StatCard label="Failed" value={detail.stats.failed} color="#dc2626" />
              <StatCard label="Opens" value={`${detail.stats.open_count} (${fmtPct(detail.stats.open_rate)})`} color="#3b82f6" />
              <StatCard label="Clicks" value={`${detail.stats.click_count} (${fmtPct(detail.stats.click_rate)})`} color="#8b5cf6" />
            </div>

            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Recipients</h3>
            <div style={{
              maxHeight: 340, overflowY: 'auto', border: '1px solid #e5e5e5', borderRadius: 8,
            }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead style={{ background: '#fafafa', position: 'sticky', top: 0 }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Sent</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recipients.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 20, textAlign: 'center', color: '#909090' }}>
                      No recipients yet.
                    </td></tr>
                  ) : detail.recipients.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                      <td style={{ padding: 8 }}>{r.email}</td>
                      <td style={{ padding: 8 }}>
                        <span style={{
                          fontSize: 10, padding: '2px 8px', borderRadius: 8,
                          background: r.status === 'sent' ? '#dcfce7' : r.status === 'failed' ? '#fee2e2' : r.status === 'clicked' ? '#ede9fe' : r.status === 'opened' ? '#dbeafe' : '#f3f4f6',
                          color: r.status === 'sent' ? '#166534' : r.status === 'failed' ? '#991b1b' : r.status === 'clicked' ? '#5b21b6' : r.status === 'opened' ? '#1e40af' : '#4b5563',
                        }}>{r.status}</span>
                      </td>
                      <td style={{ padding: 8, color: '#606060' }}>{r.sent_at ? fmtDate(r.sent_at) : '—'}</td>
                      <td style={{ padding: 8, color: '#606060' }}>{r.opened_at ? fmtDate(r.opened_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="mf-toast">{toast}</div>}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div style={{
      background: '#fafafa', border: '1px solid #e5e5e5', borderRadius: 8,
      padding: 10, textAlign: 'center',
    }}>
      <div style={{ fontSize: 11, color: '#909090', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? '#0f0f0f', marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}
