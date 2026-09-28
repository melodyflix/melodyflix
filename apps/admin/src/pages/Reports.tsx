import { useEffect, useState } from 'react';
import { listReports, dismissReport, deleteReportedComment, type Report } from '../lib/api';

const REASON_LABELS: Record<string, string> = {
  spam: 'Spam or misleading',
  harassment: 'Harassment or bullying',
  hate_speech: 'Hate speech',
  misinformation: 'Misinformation',
  other: 'Other',
};

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'resolved' | 'dismissed'>('pending');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await listReports(statusFilter);
      setReports(data.reports);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [statusFilter]);

  async function handleDismiss(id: string) {
    if (!confirm('Dismiss this report? The comment will stay.')) return;
    setBusy(id);
    try {
      await dismissReport(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete the reported comment? This cannot be undone.')) return;
    setBusy(id);
    try {
      await deleteReportedComment(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function authorName(r: Report): string {
    if (!r.comment_author) return 'Unknown';
    return r.comment_author.display_name ?? `@${r.comment_author.username}`;
  }

  function reporterName(r: Report): string {
    return r.reporter.display_name ?? `@${r.reporter.username}`;
  }

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>
          Reports <span className="mf-muted" style={{ fontSize: 14 }}>({reports.length})</span>
        </h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        {(['pending', 'resolved', 'dismissed'] as const).map((s) => (
          <button
            key={s}
            className={`mf-btn ${statusFilter === s ? '' : 'mf-btn-secondary'}`}
            onClick={() => setStatusFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}

      {loading ? (
        <div className="mf-card">Loading...</div>
      ) : reports.length === 0 ? (
        <div className="mf-card" style={{ textAlign: 'center', padding: 40, color: '#606060' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
          No {statusFilter} reports.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {reports.map((r) => (
            <div key={r.id} className="mf-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 12 }}>
                <div>
                  <span className="mf-badge mf-badge-warning">
                    {REASON_LABELS[r.reason] ?? r.reason}
                  </span>
                  <div className="mf-muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Reported by <strong>{reporterName(r)}</strong> · {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
                {statusFilter === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    <button
                      className="mf-btn mf-btn-secondary"
                      disabled={busy === r.id}
                      onClick={() => handleDismiss(r.id)}
                    >
                      Dismiss
                    </button>
                    <button
                      className="mf-btn mf-btn-danger"
                      disabled={busy === r.id || r.comment_is_deleted === 1}
                      onClick={() => handleDelete(r.id)}
                    >
                      {r.comment_is_deleted === 1 ? 'Already deleted' : 'Delete comment'}
                    </button>
                  </div>
                )}
              </div>

              <div
                style={{
                  borderLeft: '4px solid #dba617',
                  background: '#fffbea',
                  padding: '12px 14px',
                  borderRadius: 4,
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 12, color: '#606060', marginBottom: 4 }}>
                  Comment by <strong>{authorName(r)}</strong>
                  {r.comment_is_deleted === 1 && <span style={{ color: '#dc2626' }}> · deleted</span>}
                </div>
                <div style={{ fontSize: 14, color: r.comment_content ? '#0f0f0f' : '#909090', fontStyle: r.comment_content ? 'normal' : 'italic' }}>
                  {r.comment_content ?? '[comment no longer available]'}
                </div>
              </div>

              {r.comment_video_id && (
                <div style={{ fontSize: 12, color: '#606060' }}>
                  Video ID: <code>{r.comment_video_id.slice(0, 16)}...</code>
                </div>
              )}

              {r.note && (
                <div style={{ fontSize: 13, color: '#606060', marginTop: 8, fontStyle: 'italic' }}>
                  Additional note: {r.note}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
