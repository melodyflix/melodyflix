import { useEffect, useState } from 'react';
import {
  listAdminSupportTickets, adminReplyTicket, updateTicketStatus,
  getSupportTicketDetail,
  type SupportTicket, type SupportMessage, type SupportStats,
} from '../lib/api';

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export default function AdminSupport() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [filter, setFilter] = useState<'all' | TicketStatus>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openTicket, setOpenTicket] = useState<{ ticket: SupportTicket; messages: SupportMessage[] } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const status = filter === 'all' ? undefined : filter;
      const res = await listAdminSupportTickets(status);
      setTickets(res.tickets);
      setStats(res.stats);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [filter]);

  async function openDetail(id: string) {
    try {
      const res = await getSupportTicketDetail(id);
      setOpenTicket(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!openTicket || !replyText.trim()) return;
    setBusy(true);
    try {
      await adminReplyTicket(openTicket.ticket.id, replyText.trim());
      setReplyText('');
      await openDetail(openTicket.ticket.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function setStatus(status: TicketStatus) {
    if (!openTicket) return;
    setBusy(true);
    try {
      await updateTicketStatus(openTicket.ticket.id, status);
      await openDetail(openTicket.ticket.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  const statusColors: Record<string, string> = {
    open: 'mf-badge-warning',
    in_progress: 'mf-badge-info',
    resolved: 'mf-badge-success',
    closed: '',
  };

  // Detail view
  if (openTicket) {
    return (
      <>
        <button
          onClick={() => setOpenTicket(null)}
          style={{ background: 'transparent', border: 'none', color: '#065fd4', cursor: 'pointer', fontSize: 14, marginBottom: 16, padding: 0, fontFamily: 'inherit' }}
        >
          ← Back to tickets
        </button>

        {error && <div className="mf-alert mf-alert-error">{error}</div>}

        <div className="mf-card mf-mb-16">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>{openTicket.ticket.subject}</div>
              <div className="mf-muted" style={{ fontSize: 12 }}>
                #{openTicket.ticket.id.slice(0, 8)} · {openTicket.ticket.category} · {openTicket.ticket.priority}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['open', 'in_progress', 'resolved', 'closed'] as TicketStatus[]).map((s) => (
                <button
                  key={s}
                  className={`mf-btn ${openTicket.ticket.status === s ? '' : 'mf-btn-secondary'}`}
                  style={{ padding: '4px 10px', fontSize: 12, textTransform: 'capitalize' }}
                  disabled={busy || openTicket.ticket.status === s}
                  onClick={() => setStatus(s)}
                >
                  {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {openTicket.messages.map((m) => (
            <div
              key={m.id}
              style={{
                background: m.sender_type === 'admin' ? '#f5f3ff' : '#fff',
                border: '1px solid #e5e5e5',
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: m.sender_type === 'admin' ? '#7c3aed' : '#0f0f0f', marginBottom: 4 }}>
                {m.sender_name} {m.sender_type === 'admin' ? '(You)' : ''}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.content}</div>
              <div className="mf-muted" style={{ fontSize: 11, marginTop: 6 }}>
                {new Date(m.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {openTicket.ticket.status !== 'closed' && (
          <form onSubmit={sendReply} className="mf-card">
            <label className="mf-label">Reply as Support</label>
            <textarea
              className="mf-input"
              placeholder="Type your reply..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              required
              style={{ minHeight: 90, fontSize: 14 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="submit" className="mf-btn" disabled={busy || !replyText.trim()}>
                {busy ? 'Sending...' : 'Send reply'}
              </button>
            </div>
          </form>
        )}
      </>
    );
  }

  // List view
  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>Support</h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      {stats && (
        <div className="mf-cards mf-mb-16">
          <div className="mf-card">
            <div className="mf-card-label">Total Tickets</div>
            <div className="mf-card-value">{stats.total_tickets}</div>
          </div>
          <div className="mf-card">
            <div className="mf-card-label">Open</div>
            <div className="mf-card-value" style={{ color: '#dba617' }}>{stats.open_tickets}</div>
          </div>
          <div className="mf-card">
            <div className="mf-card-label">In Progress</div>
            <div className="mf-card-value" style={{ color: '#065fd4' }}>{stats.in_progress_tickets}</div>
          </div>
          <div className="mf-card">
            <div className="mf-card-label">Resolved</div>
            <div className="mf-card-value" style={{ color: '#00a32a' }}>{stats.resolved_tickets}</div>
          </div>
          <div className="mf-card">
            <div className="mf-card-label">Today</div>
            <div className="mf-card-value">{stats.today_tickets}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['all', 'open', 'in_progress', 'resolved', 'closed'] as const).map((f) => (
          <button
            key={f}
            className={`mf-btn ${filter === f ? '' : 'mf-btn-secondary'}`}
            style={{ textTransform: 'capitalize', padding: '6px 14px', fontSize: 13 }}
            onClick={() => setFilter(f)}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}

      {loading ? (
        <div className="mf-card">Loading...</div>
      ) : tickets.length === 0 ? (
        <div className="mf-card" style={{ textAlign: 'center', padding: 40, color: '#606060' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎫</div>
          No tickets found
        </div>
      ) : (
        <table className="mf-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Subject</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Last message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} onClick={() => openDetail(t.id)} style={{ cursor: 'pointer' }}>
                <td><code style={{ fontSize: 11 }}>{t.id.slice(0, 8)}</code></td>
                <td><strong>{t.subject}</strong></td>
                <td><span className="mf-badge">{t.category}</span></td>
                <td>
                  <span className={`mf-badge ${
                    t.priority === 'urgent' ? 'mf-badge-danger' :
                    t.priority === 'high' ? 'mf-badge-warning' : ''
                  }`}>{t.priority}</span>
                </td>
                <td>
                  <span className={`mf-badge ${statusColors[t.status] ?? ''}`}>
                    {t.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="mf-muted" style={{ fontSize: 12 }}>
                  {new Date(t.last_message_at).toLocaleString()}
                </td>
                <td>
                  <button className="mf-btn mf-btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }}>
                    Open →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
