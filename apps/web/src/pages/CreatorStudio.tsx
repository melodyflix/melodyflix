import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import {
  getStudioSummary, getGrowthInsights, getMilestones, markMilestoneNotified,
  getEndScreenTemplates, getEndScreen, setEndScreen, deleteEndScreen,
  listCompetitors, trackCompetitor, untrackCompetitor, getCompetitorAnalysis,
  listABTests, createABTest, getABTestDetail, completeABTest, cancelABTest,
  getCachedUser,
  type StudioSummary, type GrowthInsight, type ChannelMilestone, type EndScreenElement,
  type EndScreenTemplate, type VideoEndScreen, type CompetitorSnapshot, type CompetitorAnalysis,
  type ABTest, type ABVariantScore,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

interface VideoLite { id: string; title: string; duration?: number; thumbnail_url?: string | null; }

type Tab = 'dashboard' | 'insights' | 'milestones' | 'end-screens' | 'ab-tests' | 'competitors' | 'recorder';

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: '🏠 Dashboard' },
  { id: 'insights', label: '💡 Insights' },
  { id: 'milestones', label: '🏆 Milestones' },
  { id: 'end-screens', label: '🎬 End Screens' },
  { id: 'ab-tests', label: '🧪 A/B Tests' },
  { id: 'competitors', label: '🔍 Competitors' },
  { id: 'recorder', label: '📹 Screen Recorder' },
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
}
function fmtPct(n: number): string { return (n * 100).toFixed(2) + '%'; }

export default function CreatorStudio({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [channelId, setChannelId] = useState<string>('');
  const [videos, setVideos] = useState<VideoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  function showToast(m: string) {
    setToast(m);
    setTimeout(() => setToast(''), 2500);
  }

  useEffect(() => {
    if (!me) { setLoading(false); setError('signin'); return; }
    setLoading(true);
    Promise.all([
      api.getMyChannel(),
      (api as any).getMyVideos?.() ?? Promise.resolve({ videos: [] }),
    ]).then(([c, vRes]: any) => {
      if (!c?.id) { setError('no_channel'); return; }
      setChannelId(c.id);
      const list = vRes?.videos ?? vRes ?? [];
      if (Array.isArray(list)) {
        setVideos(list.map((v: any) => ({ id: v.id, title: v.title ?? 'Untitled', duration: v.duration_seconds, thumbnail_url: v.thumbnail_url })));
      }
    }).catch((err) => setError((err as Error).message || 'Load failed'))
      .finally(() => setLoading(false));
  }, [me?.id]);

  if (loading) return <div className="mf-page" style={{ padding: 60, textAlign: 'center', color: '#606060' }}>Loading studio...</div>;
  if (error === 'signin') {
    return (
      <div className="mf-page" style={{ padding: 60, textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>Sign in to access Creator Studio</h2>
        <button className="mf-btn-primary" onClick={onSignIn} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#065fd4', color: '#fff', cursor: 'pointer' }}>
          Sign in
        </button>
      </div>
    );
  }
  if (error === 'no_channel') {
    return (
      <div className="mf-page" style={{ padding: 60, textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, marginBottom: 12 }}>You need a channel first</h2>
        <button className="mf-btn-primary" onClick={() => navigate('/channel/new')} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#065fd4', color: '#fff', cursor: 'pointer' }}>
          Create channel
        </button>
      </div>
    );
  }
  if (error) return <div className="mf-page" style={{ padding: 60, textAlign: 'center', color: '#dc2626' }}>{error}</div>;

  return (
    <div className="mf-page" style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>🎬 Creator Studio</h1>
      <p style={{ color: '#606060', marginBottom: 20, fontSize: 13 }}>
        Manage your content, track growth, and experiment with A/B testing.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #e5e5e5', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid #065fd4' : '2px solid transparent',
              color: tab === t.id ? '#065fd4' : '#606060',
              fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, marginBottom: -1, whiteSpace: 'nowrap',
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab channelId={channelId} onToast={showToast} navigate={navigate} />}
      {tab === 'insights' && <InsightsTab channelId={channelId} onToast={showToast} navigate={navigate} />}
      {tab === 'milestones' && <MilestonesTab channelId={channelId} onToast={showToast} />}
      {tab === 'end-screens' && <EndScreensTab videos={videos} onToast={showToast} />}
      {tab === 'ab-tests' && <ABTestsTab channelId={channelId} videos={videos} onToast={showToast} />}
      {tab === 'competitors' && <CompetitorsTab channelId={channelId} onToast={showToast} />}
      {tab === 'recorder' && <RecorderTab onToast={showToast} />}

      {toast && <div className="mf-toast">{toast}</div>}
    </div>
  );
}

// ============ Tab: Dashboard ============

function DashboardTab({ channelId, onToast, navigate }: { channelId: string; onToast: (m: string) => void; navigate: (p: string) => void }) {
  const [summary, setSummary] = useState<StudioSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getStudioSummary(channelId).then(setSummary)
      .catch((err) => onToast((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId]);

  if (loading) return <Loading />;
  if (!summary) return <Empty />;

  const nm = summary.next_milestone;
  const progress = nm ? Math.min(1, nm.current / nm.threshold) : 0;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Stat label="Subscribers" value={fmtNum(summary.subscriber_count)} icon="👥" color="#065fd4" />
        <Stat label="Total views" value={fmtNum(summary.total_views)} icon="📈" />
        <Stat label="Videos" value={fmtNum(summary.total_videos)} icon="🎬" />
        <Stat label="Avg views/video" value={fmtNum(summary.avg_views_per_video)} icon="📊" color="#7c3aed" />
      </div>

      {nm && (
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>🎯 Next milestone: {fmtNum(nm.threshold)} {nm.type}</strong>
            <span style={{ fontSize: 12, color: '#606060' }}>{fmtNum(nm.current)} / {fmtNum(nm.threshold)}</span>
          </div>
          <div style={{ height: 10, background: '#f0f0f0', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{
              width: `${progress * 100}%`, height: '100%',
              background: 'linear-gradient(90deg, #065fd4, #7c3aed)', transition: 'width 0.5s',
            }} />
          </div>
          <div style={{ fontSize: 12, color: '#606060', marginTop: 8 }}>
            {nm.remaining} more to reach the next milestone
          </div>
        </div>
      )}

      {summary.latest_video && (
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 18 }}>
          <strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>🆕 Latest video</strong>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ width: 100, height: 56, background: '#e5e5e5', borderRadius: 6, overflow: 'hidden', flexShrink: 0 }}>
              {summary.latest_video.id && (
                <img src={`/api/v1/videos/${summary.latest_video.id}/thumbnail.jpg`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{summary.latest_video.title}</div>
              <div style={{ fontSize: 11, color: '#606060' }}>{fmtNum(summary.latest_video.view_count)} views · {new Date(summary.latest_video.created_at).toLocaleDateString()}</div>
            </div>
            <button className="mf-btn-secondary" onClick={() => navigate(`/watch/${summary.latest_video!.id}`)} style={{ fontSize: 12 }}>View</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <button
          onClick={() => navigate('/upload')}
          style={{ padding: 16, background: '#065fd4', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 14 }}
        >🎬 Upload new video</button>
        <button
          onClick={() => navigate('/analytics')}
          style={{ padding: 16, background: '#fff', color: '#065fd4', border: '1px solid #065fd4', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 14 }}
        >📊 View detailed analytics</button>
      </div>
    </div>
  );
}

// ============ Tab: Insights (9.10) ============

function InsightsTab({ channelId, onToast, navigate }: { channelId: string; onToast: (m: string) => void; navigate: (p: string) => void }) {
  const [insights, setInsights] = useState<GrowthInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getGrowthInsights(channelId)
      .then((r) => setInsights(r.insights))
      .catch((err) => onToast((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId]);

  if (loading) return <Loading />;

  const COLORS: Record<string, { bg: string; border: string; icon: string }> = {
    warning: { bg: '#fef2f2', border: '#fecaca', icon: '⚠️' },
    opportunity: { bg: '#eff6ff', border: '#bfdbfe', icon: '🚀' },
    success: { bg: '#f0fdf4', border: '#bbf7d0', icon: '🎉' },
    tip: { bg: '#fefce8', border: '#fef08a', icon: '💡' },
  };

  if (insights.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>
        🎯 No insights yet — keep uploading and we'll analyze your growth.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {insights.map((ins) => {
        const c = COLORS[ins.category] ?? COLORS.tip;
        return (
          <div key={ins.id} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 24 }}>{c.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{ins.title}</div>
                <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>{ins.description}</div>
                {ins.action_label && ins.action_url && (
                  <button
                    onClick={() => navigate(ins.action_url!)}
                    style={{ marginTop: 10, padding: '6px 14px', fontSize: 12, background: '#fff', border: '1px solid #d1d5db', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}
                  >{ins.action_label} →</button>
                )}
              </div>
              <span style={{ fontSize: 10, color: '#909090', fontWeight: 600, textTransform: 'uppercase' }}>P{ins.priority}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============ Tab: Milestones (9.9) ============

function MilestonesTab({ channelId, onToast }: { channelId: string; onToast: (m: string) => void }) {
  const [data, setData] = useState<{ achieved: ChannelMilestone[]; all: ChannelMilestone[]; current: any } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getMilestones(channelId).then(setData)
      .catch((err) => onToast((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId]);

  if (loading) return <Loading />;
  if (!data) return <Empty />;

  const ICONS: Record<string, string> = { subscribers: '👥', views: '👀', videos: '🎬', revenue: '💰' };

  const grouped = new Map<string, ChannelMilestone[]>();
  for (const m of data.all) {
    if (!grouped.has(m.milestone_type)) grouped.set(m.milestone_type, []);
    grouped.get(m.milestone_type)!.push(m);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 18 }}>
        <strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>📊 Current stats</strong>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
          <span>👥 <strong>{fmtNum(data.current.subscribers)}</strong> subscribers</span>
          <span>👀 <strong>{fmtNum(data.current.views)}</strong> views</span>
          <span>🎬 <strong>{fmtNum(data.current.videos)}</strong> videos</span>
        </div>
      </div>

      {Array.from(grouped.entries()).map(([type, milestones]) => (
        <div key={type} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 18 }}>
          <strong style={{ fontSize: 14, display: 'block', marginBottom: 14 }}>
            {ICONS[type] ?? '🏆'} {type.charAt(0).toUpperCase() + type.slice(1)}
          </strong>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {milestones.sort((a, b) => a.threshold - b.threshold).map((m) => {
              const achieved = !!m.achieved_at;
              return (
                <div key={m.id} style={{
                  background: achieved ? '#dcfce7' : '#f9fafb',
                  border: `1px solid ${achieved ? '#86efac' : '#e5e7eb'}`,
                  borderRadius: 10, padding: 12,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <span style={{ fontSize: 22 }}>{achieved ? '🏆' : '🎯'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: achieved ? '#166534' : '#0f0f0f' }}>
                      {fmtNum(m.threshold)}
                    </div>
                    {achieved ? (
                      <div style={{ fontSize: 10, color: '#16a34a' }}>
                        Achieved {new Date(m.achieved_at!).toLocaleDateString()}
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, color: '#909090' }}>Not yet</div>
                    )}
                  </div>
                  {achieved && !m.notified && (
                    <button
                      onClick={() => { markMilestoneNotified(m.id).then(() => onToast('Marked as seen')); }}
                      style={{ fontSize: 10, padding: '2px 6px', background: '#fff', border: '1px solid #86efac', borderRadius: 8, cursor: 'pointer' }}
                    >✓</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Loading() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#909090', fontSize: 13 }}>Loading...</div>;
}
function Empty() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#909090', fontSize: 13 }}>No data available.</div>;
}
function Stat({ label, value, icon, color }: { label: string; value: any; icon?: string; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14 }}>
      {icon && <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>}
      <div style={{ fontSize: 11, color: '#909090', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#0f0f0f', marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ============ Tab: End Screens (9.7) ============

function EndScreensTab({ videos, onToast }: { videos: VideoLite[]; onToast: (m: string) => void }) {
  const [selected, setSelected] = useState<VideoLite | null>(videos[0] ?? null);
  const [endScreen, setEndScreenState] = useState<VideoEndScreen | null>(null);
  const [templates, setTemplates] = useState<EndScreenTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [elements, setElements] = useState<Omit<EndScreenElement, 'id'>[]>([]);
  const [startSec, setStartSec] = useState(0);
  const [durationSec, setDurationSec] = useState(20);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getEndScreenTemplates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    getEndScreen(selected.id)
      .then((r) => {
        setEndScreenState(r.end_screen);
        setElements(r.end_screen?.elements.map((e) => ({
          type: e.type, x: e.x, y: e.y, width: e.width, height: e.height,
          label: e.label, target_id: e.target_id, thumbnail_url: e.thumbnail_url,
        })) ?? []);
        setStartSec(r.end_screen?.start_seconds ?? Math.max(0, (selected.duration ?? 20) - 20));
        setDurationSec(r.end_screen?.duration_seconds ?? 20);
      })
      .catch((err) => onToast((err as Error).message))
      .finally(() => setLoading(false));
  }, [selected?.id]);

  function applyTemplate(tpl: EndScreenTemplate) {
    setElements(tpl.elements.map((e) => ({ ...e })));
  }

  async function handleSave() {
    if (!selected) return;
    setBusy(true);
    try {
      await setEndScreen(selected.id, { elements, start_seconds: startSec, duration_seconds: durationSec });
      onToast('End screen saved');
      const r = await getEndScreen(selected.id);
      setEndScreenState(r.end_screen);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selected || !confirm('Delete end screen?')) return;
    setBusy(true);
    try {
      await deleteEndScreen(selected.id);
      setEndScreenState(null);
      setElements([]);
      onToast('Deleted');
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (videos.length === 0) return <Empty />;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Video</label>
          <select
            className="mf-input"
            value={selected?.id ?? ''}
            onChange={(e) => setSelected(videos.find((v) => v.id === e.target.value) ?? null)}
            style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
          >
            {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
        </div>

        {loading ? <Loading /> : (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Templates</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8, marginBottom: 16 }}>
              {templates.map((t) => (
                <button key={t.id} onClick={() => applyTemplate(t)} disabled={busy} style={{
                  padding: 12, border: '1px solid #e5e5e5', borderRadius: 8, background: '#fafafa',
                  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: '#606060' }}>{t.elements.length} element(s)</div>
                </button>
              ))}
            </div>

            {/* Preview grid */}
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Preview (16:9)</div>
            <div style={{ position: 'relative', aspectRatio: '16/9', maxWidth: 500, background: '#000', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
                Video ends here
              </div>
              {elements.map((el, i) => (
                <div key={i} style={{
                  position: 'absolute',
                  left: `${el.x * 100}%`,
                  top: `${el.y * 100}%`,
                  width: `${el.width * 100}%`,
                  height: `${el.height * 100}%`,
                  background: 'rgba(6, 95, 212, 0.65)',
                  border: '2px solid #fff',
                  borderRadius: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 10,
                  padding: 4,
                  textAlign: 'center',
                  overflow: 'hidden',
                }}>
                  <div style={{ fontWeight: 700 }}>{el.label || el.type}</div>
                  <div style={{ opacity: 0.8 }}>{el.type}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Show at (seconds)</label>
                <input type="number" className="mf-input" value={startSec} onChange={(e) => setStartSec(Math.max(0, parseInt(e.target.value) || 0))} style={{ width: '100%', padding: '8px 12px', fontSize: 13 }} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Duration (seconds)</label>
                <input type="number" className="mf-input" value={durationSec} onChange={(e) => setDurationSec(Math.max(5, parseInt(e.target.value) || 20))} style={{ width: '100%', padding: '8px 12px', fontSize: 13 }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              {endScreen && (
                <button className="mf-btn-text" onClick={handleDelete} disabled={busy} style={{ color: '#dc2626', fontSize: 12 }}>Delete</button>
              )}
              <div style={{ flex: 1 }} />
              <button className="mf-btn-text mf-btn-text-primary" onClick={handleSave} disabled={busy || elements.length === 0} style={{ fontSize: 13 }}>
                {busy ? 'Saving...' : 'Save end screen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============ Tab: A/B Tests (9.4) ============

function ABTestsTab({ channelId, videos, onToast }: { channelId: string; videos: VideoLite[]; onToast: (m: string) => void }) {
  const [tests, setTests] = useState<ABTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<{ test: ABTest; scores: ABVariantScore[]; winner: ABVariantScore | null; is_ready: boolean } | null>(null);

  const [form, setForm] = useState({
    video_id: videos[0]?.id ?? '',
    test_type: 'thumbnail' as 'thumbnail' | 'title',
    variants: [
      { label: 'A (Control)', content: '' },
      { label: 'B', content: '' },
    ],
    min_impressions: 1000,
  });

  async function load() {
    setLoading(true);
    try {
      const r = await listABTests(channelId, 100);
      setTests(r.tests);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channelId]);

  async function handleCreate() {
    if (!form.video_id) return onToast('Select a video');
    if (form.variants.some((v) => !v.content.trim())) return onToast('Fill all variant fields');
    try {
      await createABTest(channelId, {
        video_id: form.video_id,
        test_type: form.test_type,
        variants: form.variants.map((v) => ({ label: v.label, content: v.content.trim() })),
        min_impressions: form.min_impressions,
      });
      onToast('A/B test started');
      setShowCreate(false);
      load();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function openDetail(id: string) {
    try {
      const r = await getABTestDetail(id);
      setDetail(r);
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function handleComplete(id: string) {
    try {
      await completeABTest(id, true);
      onToast('Test completed — winner applied');
      await load();
      if (detail?.test.id === id) await openDetail(id);
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this test?')) return;
    try {
      await cancelABTest(id);
      onToast('Cancelled');
      await load();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  if (videos.length === 0) return <Empty />;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: '#606060' }}>Test different thumbnails or titles to boost CTR.</div>
        <button className="mf-btn-primary" onClick={() => setShowCreate(true)} style={{ fontSize: 13 }}>+ New test</button>
      </div>

      {loading ? <Loading /> : tests.length === 0 ? <Empty /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tests.map((t) => (
            <div key={t.id} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {t.test_type === 'thumbnail' ? '🖼️ Thumbnail test' : '📝 Title test'}
                  </div>
                  <div style={{ fontSize: 11, color: '#909090', fontFamily: 'monospace' }}>
                    video: {t.video_id.slice(0, 8)}… · started {new Date(t.starts_at).toLocaleDateString()}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '3px 10px', borderRadius: 10,
                  background: t.status === 'running' ? '#dbeafe' : t.status === 'completed' ? '#dcfce7' : '#f3f4f6',
                  color: t.status === 'running' ? '#1e40af' : t.status === 'completed' ? '#166534' : '#4b5563',
                }}>{t.status}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
                {t.variants.map((v) => (
                  <div key={v.id} style={{ background: '#fafafa', borderRadius: 6, padding: 8, fontSize: 11 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{v.label}</div>
                    <div style={{ color: '#606060' }}>{fmtNum(v.impressions)} imp · {fmtNum(v.clicks)} clicks</div>
                    <div style={{ color: '#065fd4', fontWeight: 600 }}>
                      CTR: {v.impressions > 0 ? fmtPct(v.clicks / v.impressions) : '—'}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button className="mf-btn-text" onClick={() => openDetail(t.id)} style={{ fontSize: 12, color: '#065fd4' }}>📊 Scores</button>
                {t.status === 'running' && (
                  <>
                    <button className="mf-btn-text" onClick={() => handleComplete(t.id)} style={{ fontSize: 12, color: '#16a34a' }}>✓ Complete</button>
                    <button className="mf-btn-text" onClick={() => handleCancel(t.id)} style={{ fontSize: 12, color: '#d97706' }}>Cancel</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="mf-modal-backdrop" onClick={() => setShowCreate(false)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h2 style={{ fontSize: 17, marginBottom: 14 }}>New A/B Test</h2>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Video</label>
              <select className="mf-input" value={form.video_id} onChange={(e) => setForm({ ...form, video_id: e.target.value })} style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}>
                {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Test type</label>
              <select className="mf-input" value={form.test_type} onChange={(e) => setForm({ ...form, test_type: e.target.value as any })} style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}>
                <option value="thumbnail">Thumbnail (URLs)</option>
                <option value="title">Title (text)</option>
              </select>
            </div>
            {form.variants.map((v, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{v.label}</label>
                <input className="mf-input" value={v.content} onChange={(e) => {
                  const nv = [...form.variants];
                  nv[i] = { ...nv[i], content: e.target.value };
                  setForm({ ...form, variants: nv });
                }} placeholder={form.test_type === 'thumbnail' ? 'https://...thumbnail.jpg' : 'New title text'} style={{ width: '100%', padding: '8px 12px', fontSize: 13 }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button className="mf-btn-text" onClick={() => setForm({ ...form, variants: [...form.variants, { label: `Variant ${form.variants.length + 1}`, content: '' }] })} disabled={form.variants.length >= 4} style={{ fontSize: 12 }}>+ Add variant</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="mf-btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button className="mf-btn-text mf-btn-text-primary" onClick={handleCreate}>Start test</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div className="mf-modal-backdrop" onClick={() => setDetail(null)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontSize: 16 }}>Scores — {detail.test.test_type}</h2>
              <button className="mf-btn-text" onClick={() => setDetail(null)} style={{ fontSize: 18 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {detail.scores.map((s, i) => (
                <div key={s.variant_id} style={{
                  background: i === 0 && detail.is_ready ? '#dcfce7' : '#fafafa',
                  border: `1px solid ${i === 0 && detail.is_ready ? '#86efac' : '#e5e5e5'}`,
                  borderRadius: 8, padding: 12,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <strong style={{ fontSize: 13 }}>{s.label}</strong>
                    {i === 0 && detail.is_ready && <span style={{ fontSize: 11, color: '#166534', fontWeight: 700 }}>✓ WINNER</span>}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 11 }}>
                    <div><div style={{ color: '#909090' }}>Impressions</div><strong>{fmtNum(s.impressions)}</strong></div>
                    <div><div style={{ color: '#909090' }}>Clicks</div><strong>{fmtNum(s.clicks)}</strong></div>
                    <div><div style={{ color: '#909090' }}>CTR</div><strong>{fmtPct(s.ctr)}</strong></div>
                    <div><div style={{ color: '#909090' }}>Avg watch</div><strong>{Math.round(s.avg_watch_seconds)}s</strong></div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: '#606060' }}>
              {detail.is_ready ? '✅ Statistically significant — ready to complete.' : '⏳ Not yet significant — keep it running.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Tab: Competitors (9.11) ============

function CompetitorsTab({ channelId, onToast }: { channelId: string; onToast: (m: string) => void }) {
  const [competitors, setCompetitors] = useState<CompetitorSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState('');
  const [analysis, setAnalysis] = useState<CompetitorAnalysis | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await listCompetitors(channelId);
      setCompetitors(r.competitors);
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [channelId]);

  async function handleTrack() {
    if (!newId.trim()) return;
    try {
      await trackCompetitor(channelId, newId.trim());
      onToast('Tracking started');
      setNewId('');
      load();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function handleUntrack(id: string) {
    if (!confirm('Stop tracking?')) return;
    try {
      await untrackCompetitor(channelId, id);
      onToast('Stopped');
      if (analysis?.competitor_channel_id === id) setAnalysis(null);
      load();
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  async function openAnalysis(id: string) {
    try {
      const a = await getCompetitorAnalysis(channelId, id);
      setAnalysis(a);
    } catch (err) {
      onToast((err as Error).message);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Track a competitor</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="mf-input"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
            placeholder="Competitor channel ID"
            style={{ flex: 1, padding: '8px 12px', fontSize: 13, fontFamily: 'monospace' }}
          />
          <button className="mf-btn-primary" onClick={handleTrack} disabled={!newId.trim()} style={{ fontSize: 13 }}>+ Track</button>
        </div>
      </div>

      {loading ? <Loading /> : competitors.length === 0 ? <Empty /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {competitors.map((c) => (
            <div key={c.id} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{c.competitor_name ?? 'Unknown channel'}</div>
                <div style={{ fontSize: 11, color: '#909090', fontFamily: 'monospace' }}>{c.competitor_channel_id.slice(0, 12)}…</div>
              </div>
              <div style={{ fontSize: 12, color: '#606060' }}>
                👥 {fmtNum(c.subscriber_snapshot)} · 🎬 {c.video_count_snapshot}
              </div>
              <button className="mf-btn-text" onClick={() => openAnalysis(c.competitor_channel_id)} style={{ fontSize: 12, color: '#065fd4' }}>View analysis</button>
              <button className="mf-btn-text" onClick={() => handleUntrack(c.competitor_channel_id)} style={{ fontSize: 12, color: '#dc2626' }}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Analysis modal */}
      {analysis && (
        <div className="mf-modal-backdrop" onClick={() => setAnalysis(null)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '85vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontSize: 17 }}>{analysis.competitor_name ?? 'Competitor'}</h2>
              <button className="mf-btn-text" onClick={() => setAnalysis(null)} style={{ fontSize: 18 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
              <Stat label="Subscribers" value={fmtNum(analysis.subscriber_count)} />
              <Stat label="Videos" value={fmtNum(analysis.video_count)} />
              <Stat label="Total views" value={fmtNum(analysis.total_views)} />
              <Stat label="Avg/video" value={fmtNum(analysis.avg_views_per_video)} />
              {analysis.upload_frequency_days !== null && (
                <Stat label="Upload freq." value={`${analysis.upload_frequency_days.toFixed(1)}d`} />
              )}
            </div>

            {analysis.vs_own && (
              <div style={{ background: '#f8f8f8', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>vs your channel</div>
                <div>Subscribers: <strong style={{ color: analysis.vs_own.subscriber_diff >= 0 ? '#dc2626' : '#16a34a' }}>{analysis.vs_own.subscriber_diff >= 0 ? '+' : ''}{fmtNum(analysis.vs_own.subscriber_diff)}</strong></div>
                <div>Videos: <strong>{analysis.vs_own.video_count_diff >= 0 ? '+' : ''}{analysis.vs_own.video_count_diff}</strong></div>
                <div>Avg views: <strong>{analysis.vs_own.avg_views_diff >= 0 ? '+' : ''}{fmtNum(analysis.vs_own.avg_views_diff)}</strong></div>
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Recent uploads</div>
            {analysis.recent_uploads.map((v) => (
              <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>{v.title}</span>
                <span style={{ color: '#606060' }}>{fmtNum(v.view_count)} views</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Tab: Screen Recorder (9.6) ============

function RecorderTab({ onToast }: { onToast: (m: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [withAudio, setWithAudio] = useState(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);

  async function start() {
    try {
      const display = await (navigator.mediaDevices as any).getDisplayMedia({
        video: { frameRate: 30 },
        audio: withAudio,
      });
      const stream = display as MediaStream;

      let finalStream = stream;
      if (withAudio) {
        try {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          finalStream = new MediaStream([...stream.getVideoTracks(), ...mic.getAudioTracks()]);
        } catch { /* mic denied, use display audio only */ }
      }

      const mr = new MediaRecorder(finalStream, { mimeType: 'video/webm;codecs=vp9,opus' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: 'video/webm' });
        setBlob(b);
        if (previewRef.current) previewRef.current.src = URL.createObjectURL(b);
      };
      mr.start(1000);
      recorderRef.current = mr;
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);

      stream.getVideoTracks()[0].addEventListener('ended', () => stop());
    } catch (err) {
      onToast((err as Error).message || 'Recording cancelled');
    }
  }

  function stop() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      recorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
  }

  useEffect(() => () => { stop(); }, []);

  function download() {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `melodyflix-recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function fmt(s: number): string {
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  const supported = typeof navigator !== 'undefined' && !!(navigator.mediaDevices as any)?.getDisplayMedia;

  if (!supported) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#909090' }}>
        Screen recording is not supported in this browser.<br />
        Try Chrome/Edge/Firefox on desktop.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>📹 Screen Recorder</div>
        <div style={{ fontSize: 12, color: '#606060', marginBottom: 16 }}>
          Record your screen + microphone directly in the browser. Download as .webm, then upload as a video.
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 16 }}>
          <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} disabled={recording} />
          Capture microphone audio (in addition to system audio)
        </label>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          {!recording ? (
            <button className="mf-btn-primary" onClick={start} style={{ fontSize: 14, padding: '10px 20px' }}>
              ⏺ Start recording
            </button>
          ) : (
            <>
              <button onClick={stop} style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                ⏹ Stop
              </button>
              <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#dc2626' }}>
                ● {fmt(seconds)}
              </span>
            </>
          )}
        </div>

        {blob && (
          <>
            <video ref={previewRef} controls style={{ width: '100%', maxWidth: 640, borderRadius: 8, background: '#000', display: 'block', marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="mf-btn-primary" onClick={download} style={{ fontSize: 13 }}>⬇ Download .webm</button>
              <span style={{ fontSize: 12, color: '#606060', alignSelf: 'center' }}>
                Size: {(blob.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
