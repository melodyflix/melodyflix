import { useEffect, useState } from 'react';
import {
  getDemographics, getTrafficSources, getRevenueReport, getPredictiveAnalytics,
  getChurnRate, getLifetimeValue, getCohortAnalysis, getFunnelAnalysis,
  getCompletionRate, getRewatchAnalytics, getDropOffPoints, getClickTracking,
  getScrollDepth, listRecentSessions, getSessionTimeline, getHeatmap,
  analyticsExportUrl,
  type DemographicsResult, type TrafficReport, type RevenueReport,
  type PredictiveAnalytics, type ChurnAnalysis, type LtvResult,
  type CohortAnalysis, type FunnelAnalysis, type CompletionRateReport,
  type RewatchReport, type DropOffReport, type ClickTrackingReport,
  type ScrollDepthReport, type SessionSummary, type SessionTimeline, type HeatmapReport,
} from '../lib/api';

interface Props {
  channelId: string;
  videos?: { id: string; title: string; duration?: number }[];
  onToast?: (msg: string) => void;
}

type Tab =
  | 'overview' | 'audience' | 'traffic' | 'engagement'
  | 'retention' | 'revenue' | 'sessions' | 'heatmap';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'audience', label: '👥 Audience' },
  { id: 'traffic', label: '🔗 Traffic' },
  { id: 'engagement', label: '🎯 Engagement' },
  { id: 'retention', label: '🔄 Retention' },
  { id: 'revenue', label: '💰 Revenue' },
  { id: 'sessions', label: '📼 Sessions' },
  { id: 'heatmap', label: '🔥 Heatmap' },
];

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + '%';
}
function fmtMoney(n: number): string {
  return '$' + n.toFixed(2);
}
function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
}

export default function AdvancedAnalytics({ channelId, videos = [], onToast }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [days, setDays] = useState(30);

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>🔬 Advanced Analytics</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#606060' }}>Range:</span>
          <select
            className="mf-input"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            style={{ padding: '5px 10px', fontSize: 12 }}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid #e5e5e5', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', background: 'transparent', border: 'none',
              borderBottom: tab === t.id ? '2px solid #065fd4' : '2px solid transparent',
              color: tab === t.id ? '#065fd4' : '#606060',
              fontWeight: tab === t.id ? 600 : 400, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13, marginBottom: -1,
              whiteSpace: 'nowrap',
            }}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab channelId={channelId} days={days} onToast={onToast} />}
      {tab === 'audience' && <AudienceTab channelId={channelId} days={days} onToast={onToast} />}
      {tab === 'traffic' && <TrafficTab channelId={channelId} days={days} onToast={onToast} />}
      {tab === 'engagement' && <EngagementTab channelId={channelId} days={days} onToast={onToast} />}
      {tab === 'retention' && <RetentionTab channelId={channelId} days={days} onToast={onToast} />}
      {tab === 'revenue' && <RevenueTab channelId={channelId} days={days} onToast={onToast} />}
      {tab === 'sessions' && <SessionsTab channelId={channelId} days={days} onToast={onToast} />}
      {tab === 'heatmap' && <HeatmapTab channelId={channelId} videos={videos} days={days} onToast={onToast} />}
    </div>
  );
}

// ============ Tab: Overview ============

function OverviewTab({ channelId, days, onToast }: { channelId: string; days: number; onToast?: (m: string) => void }) {
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [demo, setDemo] = useState<DemographicsResult | null>(null);
  const [predictive, setPredictive] = useState<PredictiveAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getRevenueReport(channelId, days).catch(() => null),
      getDemographics(channelId, days).catch(() => null),
      getPredictiveAnalytics(channelId).catch(() => null),
    ]).then(([r, d, p]) => {
      setRevenue(r); setDemo(d); setPredictive(p);
    }).catch((err) => onToast?.((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId, days]);

  if (loading) return <Loading />;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Stat label="Total views" value={fmtNum(revenue?.total_views ?? 0)} />
        <Stat label="Unique viewers" value={fmtNum(demo?.unique_viewers ?? 0)} />
        <Stat label="Total revenue" value={fmtMoney(revenue?.total_revenue ?? 0)} color="#16a34a" />
        <Stat label="RPM" value={fmtMoney(revenue?.rpm ?? 0)} />
        <Stat label="Events logged" value={fmtNum(demo?.total_events ?? 0)} />
      </div>

      {predictive && (
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>📈 Forecast (next 7 days)</strong>
            <span style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 10,
              background: predictive.trend === 'growing' ? '#dcfce7' : predictive.trend === 'declining' ? '#fee2e2' : '#f3f4f6',
              color: predictive.trend === 'growing' ? '#166534' : predictive.trend === 'declining' ? '#991b1b' : '#4b5563',
              fontWeight: 700, textTransform: 'uppercase',
            }}>
              {predictive.trend} ({predictive.growth_rate >= 0 ? '+' : ''}{(predictive.growth_rate * 100).toFixed(1)}%)
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#606060', marginBottom: 10 }}>
            Confidence: {fmtPct(predictive.confidence)}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80 }}>
            {predictive.next_7_days.map((p) => {
              const max = Math.max(...predictive.next_7_days.map((x) => x.predicted_views), 1);
              return (
                <div key={p.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: '#606060' }}>{fmtNum(p.predicted_views)}</div>
                  <div style={{
                    width: '100%', height: `${(p.predicted_views / max) * 60}px`,
                    background: 'linear-gradient(180deg, #065fd4, #3b82f6)',
                    borderRadius: 4, minHeight: 4,
                  }} />
                  <div style={{ fontSize: 9, color: '#909090' }}>{p.day.slice(5)}</div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: '#606060', marginTop: 10 }}>
            30-day forecast: <strong>{fmtNum(predictive.next_30_days_summary.predicted_views)} views</strong> · <strong>{fmtMoney(predictive.next_30_days_summary.predicted_revenue)}</strong>
          </div>
        </div>
      )}

      {revenue && revenue.by_day.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
          <strong style={{ fontSize: 14 }}>📉 Views & revenue trend</strong>
          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 100, marginTop: 12 }}>
            {revenue.by_day.slice(-30).map((p) => {
              const max = Math.max(...revenue.by_day.map((x) => x.views), 1);
              return (
                <div
                  key={p.day}
                  title={`${p.day}: ${p.views} views · ${fmtMoney(p.revenue)}`}
                  style={{
                    flex: 1, height: `${Math.max(4, (p.views / max) * 100)}px`,
                    background: '#065fd4', borderRadius: 2,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Tab: Audience (26.2) ============

function AudienceTab({ channelId, days, onToast }: { channelId: string; days: number; onToast?: (m: string) => void }) {
  const [data, setData] = useState<DemographicsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getDemographics(channelId, days)
      .then(setData)
      .catch((err) => onToast?.((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId, days]);

  if (loading) return <Loading />;
  if (!data) return <Empty />;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
      <DemoCard title="🌍 Countries" slices={data.by_country} />
      <DemoCard title="🗣️ Languages" slices={data.by_language} />
      <DemoCard title="💻 Devices" slices={data.by_device} />
      <DemoCard title="🌐 Browsers" slices={data.by_browser} />
      <DemoCard title="🖥️ Operating systems" slices={data.by_os} />
      <DemoCard title="🎂 Age groups" slices={data.by_age_group} />
      <DemoCard title="⚧ Gender" slices={data.by_gender} />
      <DemoCard title="📥 Referrers" slices={data.by_referrer} />
    </div>
  );
}

function DemoCard({ title, slices }: { title: string; slices: { key: string; count: number; percent: number }[] }) {
  if (slices.length === 0) return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#909090' }}>No data yet.</div>
    </div>
  );
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{title}</div>
      {slices.slice(0, 8).map((s) => (
        <div key={s.key} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
            <span>{s.key}</span>
            <span style={{ color: '#606060' }}>{fmtNum(s.count)} ({fmtPct(s.percent)})</span>
          </div>
          <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${s.percent * 100}%`, height: '100%', background: '#065fd4', borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============ Tab: Traffic (26.3) ============

function TrafficTab({ channelId, days, onToast }: { channelId: string; days: number; onToast?: (m: string) => void }) {
  const [data, setData] = useState<TrafficReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTrafficSources(channelId, days)
      .then(setData)
      .catch((err) => onToast?.((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId, days]);

  if (loading) return <Loading />;
  if (!data) return <Empty />;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>🔗 Top referrers</strong>
        {data.sources.length === 0 ? (
          <div style={{ fontSize: 12, color: '#909090', marginTop: 10 }}>No traffic sources recorded yet.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {data.sources.map((s) => (
              <div key={s.source} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>{s.source}</span>
                  <span style={{ color: '#606060' }}>{fmtNum(s.visits)} ({fmtPct(s.percent)})</span>
                </div>
                <div style={{ height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${s.percent * 100}%`, height: '100%', background: 'linear-gradient(90deg, #065fd4, #3b82f6)' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data.by_utm_campaign.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
          <strong style={{ fontSize: 14 }}>📢 UTM campaigns</strong>
          <div style={{ marginTop: 10 }}>
            {data.by_utm_campaign.map((c) => (
              <div key={c.campaign} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{c.campaign}</span>
                <span style={{ color: '#606060' }}>{fmtNum(c.visits)} visits</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Loading() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#909090', fontSize: 13 }}>Loading...</div>;
}
function Empty() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#909090', fontSize: 13 }}>No data available yet.</div>;
}
function Stat({ label, value, color }: { label: string; value: any; color?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 14, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#909090', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#0f0f0f', marginTop: 4 }}>{value}</div>
    </div>
  );
}

// ============ Tab: Engagement (26.12, 26.13, 26.14, 26.15, 26.16) ============

function EngagementTab({ channelId, days, onToast }: { channelId: string; days: number; onToast?: (m: string) => void }) {
  const [completion, setCompletion] = useState<CompletionRateReport | null>(null);
  const [rewatch, setRewatch] = useState<RewatchReport | null>(null);
  const [dropoff, setDropoff] = useState<DropOffReport | null>(null);
  const [clicks, setClicks] = useState<ClickTrackingReport | null>(null);
  const [scroll, setScroll] = useState<ScrollDepthReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getCompletionRate(channelId, days).catch(() => null),
      getRewatchAnalytics(channelId, days).catch(() => null),
      getDropOffPoints(channelId, days).catch(() => null),
      getClickTracking(channelId, days).catch(() => null),
      getScrollDepth(channelId, days).catch(() => null),
    ]).then(([c, r, d, cl, s]) => {
      setCompletion(c); setRewatch(r); setDropoff(d); setClicks(cl); setScroll(s);
    }).catch((err) => onToast?.((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId, days]);

  if (loading) return <Loading />;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Completion rate */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>✅ Completion rate</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12 }}>
          <Stat label="Overall" value={fmtPct(completion?.overall_completion_rate ?? 0)} color="#16a34a" />
          <Stat label="Videos tracked" value={completion?.by_video.length ?? 0} />
        </div>
        {completion && completion.by_video.length > 0 && (
          <div style={{ marginTop: 14, maxHeight: 240, overflowY: 'auto' }}>
            {completion.by_video.slice(0, 10).map((v) => (
              <div key={v.video_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{v.title ?? v.video_id.slice(0, 8)}</span>
                <span style={{ color: '#606060' }}>{v.completions}/{v.starts} ({fmtPct(v.rate)})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drop-off */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>📉 Drop-off distribution (avg watch: {fmtPct((dropoff?.avg_watch_percent ?? 0) / 100)})</strong>
        {dropoff && dropoff.buckets.length > 0 ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 100, marginTop: 12 }}>
            {dropoff.buckets.map((b) => {
              const max = Math.max(...dropoff.buckets.map((x) => x.drops), 1);
              return (
                <div key={b.percent_bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: '#606060' }}>{b.drops}</div>
                  <div style={{
                    width: '100%', height: `${Math.max(4, (b.drops / max) * 70)}px`,
                    background: 'linear-gradient(180deg, #dc2626, #f59e0b)', borderRadius: 3,
                  }} />
                  <div style={{ fontSize: 9, color: '#909090', transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>{b.percent_bucket}</div>
                </div>
              );
            })}
          </div>
        ) : <div style={{ fontSize: 12, color: '#909090', marginTop: 8 }}>No progress events yet.</div>}
        {dropoff?.worst_drop_bucket && (
          <div style={{ fontSize: 12, color: '#606060', marginTop: 12 }}>
            ⚠️ Biggest drop-off at: <strong>{dropoff.worst_drop_bucket}</strong>
          </div>
        )}
      </div>

      {/* Rewatch */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>🔄 Re-watch analytics</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12 }}>
          <Stat label="Total rewatches" value={fmtNum(rewatch?.total_rewatches ?? 0)} />
          <Stat label="Rewatch rate" value={fmtPct(rewatch?.rewatch_rate ?? 0)} color="#7c3aed" />
        </div>
        {rewatch && rewatch.top_rewatched.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#606060' }}>Top re-watched</div>
            {rewatch.top_rewatched.slice(0, 8).map((v) => (
              <div key={v.video_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{v.title ?? v.video_id.slice(0, 8)}</span>
                <span style={{ color: '#606060' }}>{v.rewatches} rew · {v.unique_viewers} viewers</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Click tracking */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>🖱️ Click tracking ({fmtNum(clicks?.total_clicks ?? 0)} total)</strong>
        {clicks && clicks.by_target.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            {clicks.by_target.slice(0, 10).map((t) => (
              <div key={t.target} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span>{t.target}</span>
                  <span style={{ color: '#606060' }}>{t.clicks} ({fmtPct(t.percent)})</span>
                </div>
                <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${t.percent * 100}%`, height: '100%', background: '#065fd4' }} />
                </div>
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize: 12, color: '#909090', marginTop: 8 }}>No click events yet.</div>}
      </div>

      {/* Scroll depth */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>📜 Scroll depth (avg: {fmtPct((scroll?.avg_max_depth ?? 0) / 100)})</strong>
        {scroll && scroll.total_sessions > 0 ? (
          <>
            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80, marginTop: 12 }}>
              {scroll.buckets.map((b) => {
                const max = Math.max(...scroll.buckets.map((x) => x.sessions), 1);
                return (
                  <div key={b.depth_bucket} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                    <div style={{ fontSize: 10, color: '#606060' }}>{b.sessions}</div>
                    <div style={{
                      width: '100%', height: `${Math.max(3, (b.sessions / max) * 60)}px`,
                      background: 'linear-gradient(180deg, #7c3aed, #a855f7)', borderRadius: 3,
                    }} />
                    <div style={{ fontSize: 9, color: '#909090' }}>{b.depth_bucket}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: '#606060', marginTop: 10 }}>
              Reached 90%+: <strong>{fmtPct(scroll.reached_bottom_rate)}</strong> · Sessions: {scroll.total_sessions}
            </div>
          </>
        ) : <div style={{ fontSize: 12, color: '#909090', marginTop: 8 }}>No scroll events yet.</div>}
      </div>
    </div>
  );
}

// ============ Tab: Retention (26.9, 26.10, 26.7) ============

function RetentionTab({ channelId, days, onToast }: { channelId: string; days: number; onToast?: (m: string) => void }) {
  const [cohort, setCohort] = useState<CohortAnalysis | null>(null);
  const [funnel, setFunnel] = useState<FunnelAnalysis | null>(null);
  const [churn, setChurn] = useState<ChurnAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getCohortAnalysis(channelId).catch(() => null),
      getFunnelAnalysis(channelId, days).catch(() => null),
      getChurnRate(channelId).catch(() => null),
    ]).then(([c, f, ch]) => {
      setCohort(c); setFunnel(f); setChurn(ch);
    }).catch((err) => onToast?.((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId, days]);

  if (loading) return <Loading />;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Funnel */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>🔻 Engagement funnel</strong>
        {funnel ? (
          <div style={{ marginTop: 14 }}>
            {funnel.steps.map((s, i) => {
              const widthPct = Math.max(4, s.conversion_from_start * 100);
              return (
                <div key={s.step} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{s.label}</span>
                    <span style={{ color: '#606060' }}>
                      {fmtNum(s.count)} · {fmtPct(s.conversion_from_start)}
                      {i > 0 && s.drop_from_prev > 0 && ` · -${fmtNum(s.drop_from_prev)}`}
                    </span>
                  </div>
                  <div style={{ height: 24, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      width: `${widthPct}%`, height: '100%',
                      background: `linear-gradient(90deg, #065fd4, #3b82f6)`,
                      transition: 'width 0.4s ease',
                    }} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 12, color: '#606060', marginTop: 10 }}>
              Overall conversion: <strong>{fmtPct(funnel.conversion_rate)}</strong> of {funnel.total_sessions} sessions
            </div>
          </div>
        ) : <div style={{ fontSize: 12, color: '#909090', marginTop: 8 }}>No data yet.</div>}
      </div>

      {/* Cohort */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>🎯 Cohort retention</strong>
        {cohort && cohort.cohorts.length > 0 ? (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 6, color: '#606060' }}>Cohort</th>
                  <th style={{ textAlign: 'right', padding: 6, color: '#606060' }}>Users</th>
                  {Array.from({ length: cohort.cohorts[0]?.periods.length ?? 0 }).map((_, i) => (
                    <th key={i} style={{ textAlign: 'center', padding: 4, color: '#606060', fontSize: 10 }}>M{i}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohort.cohorts.map((c) => (
                  <tr key={c.cohort_month}>
                    <td style={{ padding: 6, fontWeight: 500 }}>{c.cohort_month}</td>
                    <td style={{ padding: 6, textAlign: 'right', color: '#606060' }}>{c.users}</td>
                    {c.periods.map((p, i) => {
                      const intensity = Math.min(1, p);
                      return (
                        <td key={i} style={{
                          padding: 4, textAlign: 'center', fontSize: 10,
                          background: `rgba(6, 95, 212, ${intensity * 0.8})`,
                          color: intensity > 0.5 ? '#fff' : '#0f0f0f',
                          borderRadius: 3,
                        }}>
                          {i === 0 ? '100%' : (p * 100).toFixed(0) + '%'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ fontSize: 12, color: '#909090', marginTop: 8 }}>No cohort data yet.</div>}
      </div>

      {/* Churn */}
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>📉 Churn & retention</strong>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginTop: 12 }}>
          <Stat label="Total subs" value={fmtNum(churn?.total_subscribers ?? 0)} />
          <Stat label="New (30d)" value={fmtNum(churn?.new_30d ?? 0)} color="#16a34a" />
          <Stat label="Churned (30d)" value={fmtNum(churn?.churned_30d ?? 0)} color="#dc2626" />
          <Stat label="Churn rate" value={fmtPct(churn?.churn_rate_30d ?? 0)} color="#dc2626" />
          <Stat label="Retention" value={fmtPct(churn?.retention_rate_30d ?? 0)} color="#16a34a" />
          <Stat label="Net growth" value={(churn?.net_growth_30d ?? 0) >= 0 ? '+' + fmtNum(churn?.net_growth_30d ?? 0) : fmtNum(churn?.net_growth_30d ?? 0)} color={(churn?.net_growth_30d ?? 0) >= 0 ? '#16a34a' : '#dc2626'} />
        </div>
      </div>
    </div>
  );
}

// ============ Tab: Revenue (26.4, 26.8) ============

function RevenueTab({ channelId, days, onToast }: { channelId: string; days: number; onToast?: (m: string) => void }) {
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [ltv, setLtv] = useState<LtvResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getRevenueReport(channelId, days).catch(() => null),
      getLifetimeValue(channelId).catch(() => null),
    ]).then(([r, l]) => {
      setRevenue(r); setLtv(l);
    }).catch((err) => onToast?.((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId, days]);

  if (loading) return <Loading />;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <Stat label="Total revenue" value={fmtMoney(revenue?.total_revenue ?? 0)} color="#16a34a" />
        <Stat label="Total views" value={fmtNum(revenue?.total_views ?? 0)} />
        <Stat label="RPM" value={fmtMoney(revenue?.rpm ?? 0)} />
        <Stat label="ARPU" value={fmtMoney(ltv?.arpu ?? 0)} color="#7c3aed" />
        <Stat label="Avg LTV" value={fmtMoney(ltv?.avg_ltv ?? 0)} color="#7c3aed" />
      </div>

      {revenue && revenue.by_day.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
          <strong style={{ fontSize: 14 }}>📈 Daily revenue</strong>
          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 120, marginTop: 14 }}>
            {revenue.by_day.slice(-30).map((p) => {
              const max = Math.max(...revenue.by_day.map((x) => x.revenue), 1);
              return (
                <div
                  key={p.day}
                  title={`${p.day}: ${fmtMoney(p.revenue)} (${p.views} views)`}
                  style={{
                    flex: 1, height: `${Math.max(3, (p.revenue / max) * 110)}px`,
                    background: 'linear-gradient(180deg, #16a34a, #22c55e)',
                    borderRadius: 2,
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {ltv && ltv.by_cohort.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
          <strong style={{ fontSize: 14 }}>💎 LTV by cohort</strong>
          <div style={{ marginTop: 10 }}>
            {ltv.by_cohort.map((c) => (
              <div key={c.cohort_month} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
                <span>{c.cohort_month} ({c.users} users)</span>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>{fmtMoney(c.avg_ltv)} avg</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Tab: Sessions (26.17) ============

function SessionsTab({ channelId, days, onToast }: { channelId: string; days: number; onToast?: (m: string) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionTimeline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listRecentSessions(channelId, days, 100)
      .then((r) => setSessions(r.sessions))
      .catch((err) => onToast?.((err as Error).message))
      .finally(() => setLoading(false));
  }, [channelId, days]);

  async function openTimeline(sessionId: string) {
    try {
      const t = await getSessionTimeline(sessionId);
      setSelected(t);
    } catch (err) {
      onToast?.((err as Error).message);
    }
  }

  if (loading) return <Loading />;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <strong style={{ fontSize: 14 }}>📼 Recent sessions ({sessions.length})</strong>
        {sessions.length === 0 ? (
          <div style={{ fontSize: 12, color: '#909090', marginTop: 8 }}>No sessions recorded yet.</div>
        ) : (
          <div style={{ marginTop: 10, maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead style={{ background: '#fafafa', position: 'sticky', top: 0 }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: 6 }}>Session</th>
                  <th style={{ textAlign: 'right', padding: 6 }}>Events</th>
                  <th style={{ textAlign: 'right', padding: 6 }}>Videos</th>
                  <th style={{ textAlign: 'left', padding: 6 }}>Started</th>
                  <th style={{ padding: 6 }}></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.session_id} style={{ borderTop: '1px solid #f5f5f5' }}>
                    <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{s.session_id.slice(0, 12)}…</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{s.event_count}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>{s.videos_watched}</td>
                    <td style={{ padding: 6, color: '#606060' }}>
                      {new Date(s.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: 6, textAlign: 'right' }}>
                      <button className="mf-btn-text" onClick={() => openTimeline(s.session_id)} style={{ fontSize: 11, color: '#065fd4' }}>Timeline</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="mf-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '85vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: 16, marginBottom: 4 }}>Session timeline</h2>
                <div style={{ fontSize: 11, color: '#909090', fontFamily: 'monospace' }}>{selected.session_id}</div>
              </div>
              <button className="mf-btn-text" onClick={() => setSelected(null)} style={{ fontSize: 18 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
              <Stat label="Duration" value={Math.round(selected.duration_seconds) + 's'} />
              <Stat label="Videos" value={selected.videos_watched} />
              <Stat label="Events" value={selected.events.length} />
              <Stat label="Watch time" value={Math.round(selected.total_watch_seconds) + 's'} />
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #e5e5e5', borderRadius: 8 }}>
              {selected.events.map((e) => (
                <div key={e.id} style={{ padding: '6px 10px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ fontFamily: 'monospace', color: '#065fd4', minWidth: 60 }}>
                    {new Date(e.created_at).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span style={{ flex: 1, padding: '0 10px', fontWeight: 500 }}>{e.event_type}</span>
                  <span style={{ color: '#909090', fontFamily: 'monospace', fontSize: 10, maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.event_data ? JSON.stringify(e.event_data) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ Tab: Heatmap (26.18) ============

function HeatmapTab({ channelId, videos, days, onToast }: { channelId: string; videos: { id: string; title: string; duration?: number }[]; days: number; onToast?: (m: string) => void }) {
  const [selectedVideo, setSelectedVideo] = useState<string>(videos[0]?.id ?? '');
  const [duration, setDuration] = useState<number>(videos[0]?.duration ?? 600);
  const [data, setData] = useState<HeatmapReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!selectedVideo) return;
    setLoading(true);
    try {
      const r = await getHeatmap(channelId, selectedVideo, duration || 600, 15, days);
      setData(r);
    } catch (err) {
      onToast?.((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [selectedVideo, days]);

  if (videos.length === 0) return <Empty />;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Video</label>
            <select
              className="mf-input"
              value={selectedVideo}
              onChange={(e) => {
                setSelectedVideo(e.target.value);
                const v = videos.find((x) => x.id === e.target.value);
                if (v?.duration) setDuration(v.duration);
              }}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            >
              {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
          </div>
          <div style={{ width: 140 }}>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Duration (s)</label>
            <input
              type="number"
              className="mf-input"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value) || 600)}
              style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}
            />
          </div>
          <button className="mf-btn-primary" onClick={load} disabled={loading} style={{ fontSize: 13, padding: '8px 16px' }}>
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>

        {data && data.cells.length > 0 ? (
          <>
            <div style={{ fontSize: 12, color: '#606060', marginBottom: 10 }}>
              Peak intensity at <strong>{data.peak_bucket_start}s</strong> · Bucket size: {data.bucket_size_seconds}s
            </div>
            <div style={{ display: 'flex', gap: 2, height: 60, alignItems: 'flex-end' }}>
              {data.cells.map((c, i) => {
                const intensity = c.avg_intensity / 100;
                const color = intensity > 0.66 ? '#dc2626' : intensity > 0.33 ? '#f59e0b' : '#065fd4';
                return (
                  <div
                    key={i}
                    title={`${c.bucket_start_seconds}s - ${c.bucket_end_seconds}s: ${c.views} views, ${c.clicks} clicks (intensity ${c.avg_intensity.toFixed(0)}%)`}
                    style={{
                      flex: 1, height: `${Math.max(6, intensity * 60)}px`,
                      background: color, borderRadius: 2, opacity: 0.4 + intensity * 0.6,
                    }}
                  />
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#909090', marginTop: 4 }}>
              <span>0s</span>
              <span>{Math.floor(duration / 2)}s</span>
              <span>{duration}s</span>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 14, fontSize: 11, color: '#606060' }}>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#065fd4', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />Low</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#f59e0b', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />Medium</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 12, background: '#dc2626', borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />High</span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: '#909090' }}>No heatmap data for this video yet.</div>
        )}
      </div>
    </div>
  );
}
