// melodyflix admin — Auto Content Upload (Section 37)
import { useEffect, useState } from 'react';
import {
  listContentSources, createContentSource, approveContentSource,
  rejectContentSource, pauseContentSource, resumeContentSource,
  deleteContentSource, listFetchJobs, runContentWorker,
  getWorkerStats, getIngestStats, ingestQueuedJobs,
  type ContentSource, type ContentSourceType, type ContentKind,
  type SourceStatus, type PublishPolicy, type FetchJob,
  type WorkerStats, type IngestStats,
} from '../lib/api';

type Tab = 'sources' | 'jobs' | 'worker';

const SOURCE_TYPES: ContentSourceType[] = ['rss', 'atom', 'tmdb_list', 'tmdb_search', 'manual'];
const CONTENT_KINDS: ContentKind[] = ['movie', 'tv', 'drama', 'song', 'news', 'web_series', 'podcast', 'other'];
const PUBLISH_POLICIES: PublishPolicy[] = ['auto_publish', 'draft_only', 'requires_approval'];

export default function ContentUpload() {
  const [tab, setTab] = useState<Tab>('sources');
  const [sources, setSources] = useState<ContentSource[]>([]);
  const [jobs, setJobs] = useState<FetchJob[]>([]);
  const [workerStats, setWorkerStats] = useState<WorkerStats | null>(null);
  const [ingestStats, setIngestStats] = useState<IngestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ContentSourceType>('rss');
  const [newKind, setNewKind] = useState<ContentKind>('news');
  const [newUrl, setNewUrl] = useState('');
  const [newInterval, setNewInterval] = useState(60);
  const [newPolicy, setNewPolicy] = useState<PublishPolicy>('draft_only');
  const [newChannelId, setNewChannelId] = useState('');

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [src, jb, ws, is] = await Promise.all([
        listContentSources({ limit: 100 }),
        listFetchJobs({ limit: 50 }),
        getWorkerStats().catch(() => null),
        getIngestStats().catch(() => null),
      ]);
      setSources(src.sources);
      setJobs(jb.jobs);
      if (ws) setWorkerStats(ws);
      if (is) setIngestStats(is);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function handleAdd() {
    if (!newName.trim() || !newUrl.trim()) {
      setError('Name and URL are required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await createContentSource({
        name: newName.trim(),
        source_type: newType,
        content_kind: newKind,
        url: newUrl.trim(),
        fetch_interval_minutes: newInterval,
        publish_policy: newPolicy,
        default_channel_id: newChannelId.trim() || null,
      });
      setNewName(''); setNewUrl(''); setNewChannelId('');
      setShowAddForm(false);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAction(id: string, action: string) {
    setBusy(true);
    setError('');
    try {
      if (action === 'approve') await approveContentSource(id);
      else if (action === 'pause') await pauseContentSource(id);
      else if (action === 'resume') await resumeContentSource(id);
      else if (action === 'reject') {
        const reason = prompt('Rejection reason:');
        if (!reason) { setBusy(false); return; }
        await rejectContentSource(id, reason);
      } else if (action === 'delete') {
        if (!confirm('Delete this source? Existing jobs will remain.')) { setBusy(false); return; }
        await deleteContentSource(id);
      }
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunWorker() {
    setBusy(true);
    setError('');
    try {
      const result = await runContentWorker({ max_sources: 10 });
      alert(`Worker run: processed=${result.sources_processed}, created=${result.jobs_created}, deduped=${result.jobs_deduped}`);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleIngest() {
    setBusy(true);
    setError('');
    try {
      const r = await ingestQueuedJobs(20);
      alert(`Ingested: processed=${r.processed}, completed=${r.completed}, failed=${r.failed}, skipped=${r.skipped}`);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function statusBadge(s: SourceStatus) {
    const colors: Record<SourceStatus, string> = {
      active: 'mf-badge-success',
      pending_approval: 'mf-badge-warning',
      paused: 'mf-badge-info',
      rejected: 'mf-badge-danger',
      error: 'mf-badge-danger',
    };
    return <span className={`mf-badge ${colors[s] || ''}`}>{s.replace('_', ' ')}</span>;
  }

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>
          Auto Content Upload
          <span className="mf-muted" style={{ fontSize: 14, marginLeft: 8 }}>
            Section 37 · Content Sources, Jobs, Worker
          </span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="mf-btn" onClick={loadAll} disabled={busy}>↻ Refresh</button>
          <button className="mf-btn" onClick={handleRunWorker} disabled={busy}>▶ Run Worker</button>
          <button className="mf-btn" onClick={handleIngest} disabled={busy}>📥 Ingest Queued</button>
          <button className="mf-btn mf-btn-primary" onClick={() => setShowAddForm(!showAddForm)} disabled={busy}>
            {showAddForm ? '✕ Cancel' : '+ Add Source'}
          </button>
        </div>
      </div>

      {error && <div className="mf-alert mf-alert-error mf-mb-16">{error}</div>}

      {/* Stats cards */}
      {workerStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
          <div className="mf-card"><div className="mf-muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>ACTIVE SOURCES</div><div style={{ fontSize: 24, fontWeight: 700 }}>{workerStats.active_sources}</div></div>
          <div className="mf-card"><div className="mf-muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>PENDING APPROVAL</div><div style={{ fontSize: 24, fontWeight: 700, color: '#d97706' }}>{workerStats.pending_approval}</div></div>
          <div className="mf-card"><div className="mf-muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>QUEUED JOBS</div><div style={{ fontSize: 24, fontWeight: 700 }}>{workerStats.queued_jobs}</div></div>
          <div className="mf-card"><div className="mf-muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>COMPLETED TODAY</div><div style={{ fontSize: 24, fontWeight: 700, color: '#16a34a' }}>{workerStats.completed_today}</div></div>
          <div className="mf-card"><div className="mf-muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>FAILED JOBS</div><div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{workerStats.failed_jobs}</div></div>
          <div className="mf-card"><div className="mf-muted" style={{ fontSize: 11, letterSpacing: 0.5 }}>ERROR SOURCES</div><div style={{ fontSize: 24, fontWeight: 700, color: '#dc2626' }}>{workerStats.error_sources}</div></div>
        </div>
      )}

      {/* Add source form */}
      {showAddForm && (
        <div className="mf-card mf-mb-16">
          <h3 style={{ marginBottom: 12 }}>Add Content Source</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="mf-muted" style={{ fontSize: 12 }}>Name</label>
              <input className="mf-input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="BBC News RSS" />
            </div>
            <div>
              <label className="mf-muted" style={{ fontSize: 12 }}>Type</label>
              <select className="mf-input" value={newType} onChange={(e) => setNewType(e.target.value as ContentSourceType)}>
                {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mf-muted" style={{ fontSize: 12 }}>Content Kind</label>
              <select className="mf-input" value={newKind} onChange={(e) => setNewKind(e.target.value as ContentKind)}>
                {CONTENT_KINDS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mf-muted" style={{ fontSize: 12 }}>Fetch Interval (minutes)</label>
              <input className="mf-input" type="number" min={5} max={1440} value={newInterval} onChange={(e) => setNewInterval(parseInt(e.target.value) || 60)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="mf-muted" style={{ fontSize: 12 }}>URL (RSS/Atom/TMDB URL)</label>
              <input className="mf-input" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://feeds.bbci.co.uk/news/rss.xml" />
            </div>
            <div>
              <label className="mf-muted" style={{ fontSize: 12 }}>Publish Policy</label>
              <select className="mf-input" value={newPolicy} onChange={(e) => setNewPolicy(e.target.value as PublishPolicy)}>
                {PUBLISH_POLICIES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mf-muted" style={{ fontSize: 12 }}>Default Channel ID (optional)</label>
              <input className="mf-input" value={newChannelId} onChange={(e) => setNewChannelId(e.target.value)} placeholder="uuid of channel where content lands" />
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="mf-btn mf-btn-primary" onClick={handleAdd} disabled={busy}>Create Source</button>
            <button className="mf-btn" onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
          <p className="mf-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Sources require admin approval before becoming active. Approve from the sources list.
          </p>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid #e5e5e5' }}>
        {(['sources', 'jobs', 'worker'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 16px', background: 'transparent', border: 'none',
              borderBottom: tab === t ? '2px solid #065fd4' : '2px solid transparent',
              color: tab === t ? '#065fd4' : '#606060',
              fontWeight: tab === t ? 600 : 400, cursor: 'pointer', fontSize: 14, textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mf-card">Loading...</div>
      ) : tab === 'sources' ? (
        sources.length === 0 ? (
          <div className="mf-card">No content sources yet. Click "+ Add Source" to create one.</div>
        ) : (
          <table className="mf-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Interval</th>
                <th>Imports</th>
                <th>Last Fetch</th>
                <th style={{ width: 260 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong><div className="mf-muted" style={{ fontSize: 11 }}>{s.url.slice(0, 50)}</div></td>
                  <td>{s.source_type}</td>
                  <td>{s.content_kind}</td>
                  <td>{statusBadge(s.status)}</td>
                  <td className="mf-muted">{s.fetch_interval_minutes}m</td>
                  <td>{s.total_imports}</td>
                  <td className="mf-muted" style={{ fontSize: 11 }}>{s.last_fetched_at ? new Date(s.last_fetched_at).toLocaleString() : '—'}</td>
                  <td>
                    {s.status === 'pending_approval' && (
                      <>
                        <button className="mf-btn mf-btn-primary" style={{ padding: '4px 8px', marginRight: 4 }} disabled={busy} onClick={() => handleAction(s.id, 'approve')}>Approve</button>
                        <button className="mf-btn mf-btn-danger" style={{ padding: '4px 8px', marginRight: 4 }} disabled={busy} onClick={() => handleAction(s.id, 'reject')}>Reject</button>
                      </>
                    )}
                    {s.status === 'active' && (
                      <button className="mf-btn" style={{ padding: '4px 8px', marginRight: 4 }} disabled={busy} onClick={() => handleAction(s.id, 'pause')}>Pause</button>
                    )}
                    {s.status === 'paused' && (
                      <button className="mf-btn" style={{ padding: '4px 8px', marginRight: 4 }} disabled={busy} onClick={() => handleAction(s.id, 'resume')}>Resume</button>
                    )}
                    <button className="mf-btn mf-btn-danger" style={{ padding: '4px 8px' }} disabled={busy} onClick={() => handleAction(s.id, 'delete')}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : tab === 'jobs' ? (
        jobs.length === 0 ? (
          <div className="mf-card">No fetch jobs yet. Approve a source and run the worker to fetch content.</div>
        ) : (
          <table className="mf-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Source</th>
                <th>Retries</th>
                <th>Created</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.title ?? '(untitled)'}</td>
                  <td><span className="mf-badge">{j.status}</span></td>
                  <td className="mf-muted" style={{ fontSize: 11 }}>{j.source_id.slice(0, 8)}</td>
                  <td>{j.retry_count}</td>
                  <td className="mf-muted" style={{ fontSize: 11 }}>{new Date(j.created_at).toLocaleString()}</td>
                  <td className="mf-muted" style={{ fontSize: 11 }}>{j.error_message?.slice(0, 60) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        <div className="mf-card">
          <h3>Worker Stats</h3>
          <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 6, marginTop: 8 }}>
            {JSON.stringify({ workerStats, ingestStats }, null, 2)}
          </pre>
          <p className="mf-muted" style={{ fontSize: 12, marginTop: 12 }}>
            Use "Run Worker" to fetch from all active due sources.<br />
            Use "Ingest Queued" to convert fetched jobs into videos/series/tracks/news.
          </p>
        </div>
      )}
    </>
  );
}
