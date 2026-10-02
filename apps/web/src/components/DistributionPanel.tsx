import { useEffect, useState } from 'react';
import {
  getDistributionPlatforms, listPlatformAccounts, connectPlatform, disconnectPlatform,
  listChannelJobs, createDistributionJob, publishJobNow, cancelJob, deleteJob,
  getAutoShare, setAutoShare, getChannelFeed, createChannelFeed, updateChannelFeed, deleteChannelFeed, feedUrl,
  type Platform, type PlatformAccount, type DistributionJob, type AutoShareRule, type SyndicationFeed,
  type PlatformId, type JobStatus,
} from '../lib/api';

interface Props {
  channelId: string;
  videos: { id: string; title: string }[];
  onToast?: (msg: string) => void;
}

const STATUS_COLORS: Record<JobStatus, { bg: string; fg: string }> = {
  pending:   { bg: '#f3f4f6', fg: '#4b5563' },
  scheduled: { bg: '#dbeafe', fg: '#1e40af' },
  publishing:{ bg: '#fef3c7', fg: '#92400e' },
  published: { bg: '#dcfce7', fg: '#166534' },
  failed:    { bg: '#fee2e2', fg: '#991b1b' },
  cancelled: { bg: '#f3f4f6', fg: '#6b7280' },
};

function fmtDate(s: string | null): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

export default function DistributionPanel({ channelId, videos, onToast }: Props) {
  const [tab, setTab] = useState<'platforms' | 'jobs' | 'auto'>('platforms');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [jobs, setJobs] = useState<DistributionJob[]>([]);
  const [rule, setRule] = useState<AutoShareRule | null>(null);
  const [feed, setFeed] = useState<SyndicationFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  // Connect form
  const [connectForm, setConnectForm] = useState<{ platform: PlatformId; account: string; token: string } | null>(null);

  // New job form
  const [jobForm, setJobForm] = useState<{ videoId: string; platform: PlatformId; title: string; scheduledAt: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [p, a, j, r, f] = await Promise.all([
        getDistributionPlatforms().catch(() => ({ platforms: [] })),
        listPlatformAccounts(channelId).catch(() => ({ accounts: [] })),
        listChannelJobs(channelId, 100).catch(() => ({ jobs: [] })),
        getAutoShare(channelId).catch(() => ({ rule: null as any })),
        getChannelFeed(channelId).catch(() => ({ feed: null })),
      ]);
      setPlatforms(p.platforms);
      setAccounts(a.accounts);
      setJobs(j.jobs);
      setRule(r.rule);
      setFeed(f.feed);
    } catch (err) {
      showToast((err as Error).message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channelId]);

  function showToast(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  }

  function isConnected(platformId: PlatformId): boolean {
    return accounts.some((a) => a.platform === platformId);
  }

  // ---------- Platform connections ----------
  async function handleConnect() {
    if (!connectForm) return;
    if (!connectForm.account.trim() || !connectForm.token.trim()) return;
    setBusy(true);
    try {
      await connectPlatform(channelId, connectForm.platform, connectForm.account.trim(), connectForm.token.trim());
      showToast('Platform connected');
      setConnectForm(null);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Connect failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect(platformId: PlatformId) {
    if (!confirm(`Disconnect ${platformId}?`)) return;
    setBusy(true);
    try {
      await disconnectPlatform(channelId, platformId);
      showToast('Disconnected');
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Disconnect failed');
    } finally {
      setBusy(false);
    }
  }

  // ---------- Jobs ----------
  async function handleCreateJob() {
    if (!jobForm || !jobForm.videoId) return;
    setBusy(true);
    try {
      await createDistributionJob(channelId, {
        video_id: jobForm.videoId,
        platform: jobForm.platform,
        title: jobForm.title.trim() || undefined,
        scheduled_at: jobForm.scheduledAt ? new Date(jobForm.scheduledAt).toISOString() : null,
      });
      showToast('Job created');
      setJobForm(null);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function handlePublishNow(id: string) {
    setBusy(true);
    try {
      await publishJobNow(id);
      showToast('Published (simulated)');
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Publish failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    setBusy(true);
    try {
      await cancelJob(id);
      showToast('Cancelled');
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteJob(id: string) {
    if (!confirm('Delete this job?')) return;
    setBusy(true);
    try {
      await deleteJob(id);
      showToast('Deleted');
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  // ---------- Auto-share ----------
  async function handleTogglePlatform(pid: PlatformId) {
    if (!rule) return;
    const has = rule.platforms.includes(pid);
    const next = has ? rule.platforms.filter((p) => p !== pid) : [...rule.platforms, pid];
    setBusy(true);
    try {
      const res = await setAutoShare(channelId, { platforms: next });
      setRule(res.rule);
    } catch (err) {
      showToast((err as Error).message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAutoShare() {
    if (!rule) return;
    setBusy(true);
    try {
      const res = await setAutoShare(channelId, { share_on_publish: rule.share_on_publish !== 1 });
      setRule(res.rule);
      showToast(res.rule.share_on_publish === 1 ? 'Auto-share enabled' : 'Auto-share disabled');
    } catch (err) {
      showToast((err as Error).message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveMessage(msg: string) {
    setBusy(true);
    try {
      const res = await setAutoShare(channelId, { auto_message: msg || null });
      setRule(res.rule);
    } catch (err) {
      showToast((err as Error).message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  // ---------- Feed ----------
  async function handleCreateFeed() {
    setBusy(true);
    try {
      await createChannelFeed(channelId);
      showToast('Feed created');
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleFeed() {
    if (!feed) return;
    setBusy(true);
    try {
      await updateChannelFeed(channelId, { is_enabled: feed.is_enabled !== 1 });
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteFeed() {
    if (!confirm('Delete syndication feed?')) return;
    setBusy(true);
    try {
      await deleteChannelFeed(channelId);
      setFeed(null);
      showToast('Feed deleted');
    } catch (err) {
      showToast((err as Error).message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  function copyFeedUrl() {
    if (!feed) return;
    const url = `${window.location.origin}${feedUrl(feed.slug)}`;
    navigator.clipboard.writeText(url).then(() => showToast('URL copied!')).catch(() => showToast(url));
  }

  if (loading) return <div style={{ fontSize: 12, color: '#909090' }}>Loading distribution...</div>;

  return (
    <div style={{ marginTop: 12 }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e5e5e5' }}>
        {([
          { id: 'platforms', label: '🔗 Platforms' },
          { id: 'jobs', label: '📤 Jobs' },
          { id: 'auto', label: '⚡ Auto & Feed' },
        ] as { id: 'platforms' | 'jobs' | 'auto'; label: string }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid #065fd4' : '2px solid transparent',
              color: tab === t.id ? '#065fd4' : '#606060',
              fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12, marginBottom: -1,
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* Platforms tab */}
      {tab === 'platforms' && (
        <div>
          <div style={{ fontSize: 13, color: '#606060', marginBottom: 12 }}>
            Connect accounts to enable multi-platform publishing.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {platforms.map((p) => {
              const connected = isConnected(p.id);
              const acc = accounts.find((a) => a.platform === p.id);
              return (
                <div
                  key={p.id}
                  style={{
                    background: '#fff', border: connected ? '1.5px solid #065fd4' : '1px solid #e5e5e5',
                    borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 22 }}>{p.icon}</span>
                    <strong style={{ fontSize: 14 }}>{p.label}</strong>
                    {connected && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#16a34a', fontWeight: 700 }}>✓ Connected</span>}
                  </div>
                  {connected && acc?.account_name && (
                    <div style={{ fontSize: 11, color: '#606060' }}>@{acc.account_name}</div>
                  )}
                  {!connected ? (
                    <button
                      onClick={() => setConnectForm({ platform: p.id, account: '', token: '' })}
                      disabled={busy}
                      style={{
                        padding: '6px 12px', borderRadius: 8, border: '1px solid #065fd4',
                        background: '#fff', color: '#065fd4', cursor: 'pointer',
                        fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
                      }}
                    >Connect</button>
                  ) : (
                    <button
                      onClick={() => handleDisconnect(p.id)}
                      disabled={busy}
                      style={{
                        padding: '6px 12px', borderRadius: 8, border: '1px solid #fecaca',
                        background: '#fff', color: '#dc2626', cursor: 'pointer',
                        fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
                      }}
                    >Disconnect</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Jobs tab */}
      {tab === 'jobs' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#606060' }}>Publish videos to connected platforms.</div>
            <button
              className="mf-btn-text mf-btn-text-primary"
              onClick={() => setJobForm({ videoId: videos[0]?.id ?? '', platform: platforms[0]?.id ?? 'youtube', title: '', scheduledAt: '' })}
              disabled={videos.length === 0 || platforms.length === 0}
              style={{ fontSize: 12 }}
            >+ New job</button>
          </div>

          {jobs.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#909090', fontSize: 13 }}>
              No distribution jobs yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {jobs.map((j) => {
                const sc = STATUS_COLORS[j.status];
                const platformInfo = platforms.find((p) => p.id === j.platform);
                return (
                  <div key={j.id} style={{
                    background: '#fff', border: '1px solid #e5e5e5', borderRadius: 8,
                    padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: 20 }}>{platformInfo?.icon ?? '🌐'}</span>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{platformInfo?.label ?? j.platform}</div>
                      <div style={{ fontSize: 11, color: '#606060' }}>
                        Video: {j.video_id.slice(0, 8)} · {fmtDate(j.scheduled_at ?? j.created_at)}
                      </div>
                      {j.external_url && (
                        <div style={{ fontSize: 11, color: '#065fd4', marginTop: 2 }}>
                          <a href={j.external_url} target="_blank" rel="noopener noreferrer" style={{ color: '#065fd4' }}>
                            {j.external_url}
                          </a>
                        </div>
                      )}
                    </div>
                    <span style={{
                      fontSize: 10, padding: '3px 10px', borderRadius: 10,
                      background: sc.bg, color: sc.fg, fontWeight: 700, textTransform: 'uppercase',
                    }}>{j.status}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(j.status === 'pending' || j.status === 'scheduled') && (
                        <>
                          <button
                            className="mf-btn-text"
                            onClick={() => handlePublishNow(j.id)}
                            disabled={busy}
                            style={{ fontSize: 11, color: '#065fd4' }}
                          >Publish now</button>
                          <button
                            className="mf-btn-text"
                            onClick={() => handleCancel(j.id)}
                            disabled={busy}
                            style={{ fontSize: 11, color: '#d97706' }}
                          >Cancel</button>
                        </>
                      )}
                      <button
                        className="mf-btn-text"
                        onClick={() => handleDeleteJob(j.id)}
                        disabled={busy}
                        style={{ fontSize: 11, color: '#dc2626' }}
                      >×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Auto & Feed tab */}
      {tab === 'auto' && rule && (
        <div>
          {/* Auto-share */}
          <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Auto-share on publish</div>
                <div style={{ fontSize: 11, color: '#909090' }}>
                  Auto-create distribution jobs when a new video is published
                </div>
              </div>
              <button
                onClick={handleToggleAutoShare}
                disabled={busy}
                aria-pressed={rule.share_on_publish === 1}
                style={{
                  width: 42, height: 24, borderRadius: 12, border: 'none',
                  background: rule.share_on_publish === 1 ? '#065fd4' : '#ccc',
                  position: 'relative', cursor: 'pointer', padding: 0,
                }}
              >
                <span style={{
                  position: 'absolute', top: 3, left: rule.share_on_publish === 1 ? 21 : 3,
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </button>
            </div>

            {rule.share_on_publish === 1 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Platforms</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {platforms.map((p) => {
                    const active = rule.platforms.includes(p.id);
                    const connected = isConnected(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => connected && handleTogglePlatform(p.id)}
                        disabled={busy || !connected}
                        style={{
                          padding: '5px 12px', borderRadius: 14, fontSize: 12,
                          background: active ? '#e8f0fe' : '#f2f2f2',
                          color: active ? '#065fd4' : (connected ? '#0f0f0f' : '#909090'),
                          border: active ? '1.5px solid #065fd4' : '1.5px solid transparent',
                          cursor: connected ? 'pointer' : 'not-allowed',
                          fontFamily: 'inherit', fontWeight: active ? 600 : 400,
                          opacity: connected ? 1 : 0.5,
                        }}
                      >
                        {p.icon} {p.label} {!connected && '(not connected)'}
                      </button>
                    );
                  })}
                </div>

                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Auto message</div>
                <textarea
                  className="mf-input"
                  value={rule.auto_message ?? ''}
                  onChange={(e) => setRule({ ...rule, auto_message: e.target.value })}
                  onBlur={(e) => handleSaveMessage(e.target.value)}
                  placeholder="Posted as description on each platform..."
                  maxLength={500}
                  style={{ width: '100%', minHeight: 60, padding: '8px 12px', fontSize: 12 }}
                />
              </>
            )}
          </div>

          {/* Syndication feed */}
          <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Syndication feed (RSS)</div>
            <div style={{ fontSize: 11, color: '#909090', marginBottom: 12 }}>
              Public RSS feed others can subscribe to.
            </div>

            {!feed ? (
              <button
                className="mf-btn-text mf-btn-text-primary"
                onClick={handleCreateFeed}
                disabled={busy}
                style={{ fontSize: 12 }}
              >Create feed</button>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <input
                    className="mf-input"
                    value={`${window.location.origin}${feedUrl(feed.slug)}`}
                    readOnly
                    onFocus={(e) => e.target.select()}
                    style={{ flex: 1, padding: '8px 12px', fontSize: 12, fontFamily: 'monospace', background: '#fafafa' }}
                  />
                  <button
                    className="mf-btn-text"
                    onClick={copyFeedUrl}
                    style={{ fontSize: 12, color: '#065fd4' }}
                  >Copy</button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 12 }}>
                    Status: {feed.is_enabled === 1 ? '✅ Enabled' : '⏸ Disabled'}
                  </div>
                  <button
                    className="mf-btn-text"
                    onClick={handleToggleFeed}
                    disabled={busy}
                    style={{ fontSize: 12 }}
                  >{feed.is_enabled === 1 ? 'Disable' : 'Enable'}</button>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <a
                    href={feedUrl(feed.slug)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mf-btn-text"
                    style={{ fontSize: 12, color: '#065fd4' }}
                  >Preview →</a>
                  <div style={{ flex: 1 }} />
                  <button
                    className="mf-btn-text"
                    onClick={handleDeleteFeed}
                    disabled={busy}
                    style={{ fontSize: 12, color: '#dc2626' }}
                  >Delete</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Connect modal */}
      {connectForm && (
        <div className="mf-modal-backdrop" onClick={() => setConnectForm(null)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2 style={{ fontSize: 17, marginBottom: 14 }}>
              Connect {platforms.find((p) => p.id === connectForm.platform)?.label}
            </h2>
            <div style={{ fontSize: 12, color: '#606060', marginBottom: 14 }}>
              Real OAuth flows require platform API keys. For this environment, credentials are simulated and stored locally.
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Account name / handle</label>
              <input
                className="mf-input"
                value={connectForm.account}
                onChange={(e) => setConnectForm({ ...connectForm, account: e.target.value })}
                placeholder="myhandle"
                style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Access token (simulated)</label>
              <input
                className="mf-input"
                value={connectForm.token}
                onChange={(e) => setConnectForm({ ...connectForm, token: e.target.value })}
                placeholder="any-string"
                style={{ width: '100%', padding: '8px 12px', fontSize: 13, fontFamily: 'monospace' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="mf-btn-secondary" onClick={() => setConnectForm(null)} disabled={busy}>Cancel</button>
              <button
                className="mf-btn-text mf-btn-text-primary"
                onClick={handleConnect}
                disabled={busy || !connectForm.account.trim() || !connectForm.token.trim()}
              >{busy ? 'Connecting...' : 'Connect'}</button>
            </div>
          </div>
        </div>
      )}

      {/* New job modal */}
      {jobForm && (
        <div className="mf-modal-backdrop" onClick={() => setJobForm(null)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h2 style={{ fontSize: 17, marginBottom: 14 }}>New distribution job</h2>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Video</label>
              <select
                className="mf-input"
                value={jobForm.videoId}
                onChange={(e) => setJobForm({ ...jobForm, videoId: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
              >
                {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Platform</label>
              <select
                className="mf-input"
                value={jobForm.platform}
                onChange={(e) => setJobForm({ ...jobForm, platform: e.target.value as PlatformId })}
                style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
              >
                {platforms.filter((p) => isConnected(p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Title override (optional)</label>
              <input
                className="mf-input"
                value={jobForm.title}
                onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })}
                placeholder="Leave empty to use video title"
                style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Schedule (optional)</label>
              <input
                type="datetime-local"
                className="mf-input"
                value={jobForm.scheduledAt}
                onChange={(e) => setJobForm({ ...jobForm, scheduledAt: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
              />
              <div style={{ fontSize: 11, color: '#909090', marginTop: 4 }}>
                Leave empty to queue as pending (publish manually).
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="mf-btn-secondary" onClick={() => setJobForm(null)} disabled={busy}>Cancel</button>
              <button
                className="mf-btn-text mf-btn-text-primary"
                onClick={handleCreateJob}
                disabled={busy || !jobForm.videoId}
              >{busy ? 'Creating...' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="mf-toast">{toast}</div>}
    </div>
  );
}
