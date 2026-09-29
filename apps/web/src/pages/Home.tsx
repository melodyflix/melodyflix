import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  api, listTrending, listCategories, listVideosByCategory,
  type Video, type CategoryStat,
} from '../lib/api';
import VideoCard from '../components/VideoCard';
import StoryBar from '../components/StoryBar';
import LoginModal from '../components/LoginModal';
import { getCachedUser } from '../lib/api';

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  trending: '🔥 Trending',
  music: '🎵 Music',
  gaming: '🎮 Gaming',
  education: '📚 Education',
  technology: '💻 Technology',
  entertainment: '🎬 Entertainment',
  sports: '⚽ Sports',
  news: '📰 News',
  comedy: '😂 Comedy',
  film: '🎥 Film',
  vlog: '📹 Vlog',
  other: '📦 Other',
};

const BASE_TABS = ['all', 'trending', 'music', 'gaming', 'education', 'technology', 'entertainment'];

export default function Home() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('category') || 'all';

  const [videos, setVideos] = useState<Video[]>([]);
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Load categories once
  useEffect(() => {
    listCategories().then((res) => setCategories(res.categories)).catch(() => {});
  }, []);

  // Load videos based on tab
  useEffect(() => {
    setLoading(true);
    setError('');
    (async () => {
      try {
        if (activeTab === 'all') {
          const data = await api.listVideos(50, 0);
          setVideos(data.videos);
        } else if (activeTab === 'trending') {
          const data = await listTrending(50, 0, 7);
          setVideos(data.videos);
        } else {
          const data = await listVideosByCategory(activeTab, 50, 0);
          setVideos(data.videos);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeTab]);

  // Build tab list — base tabs + categories that have videos
  const categoryTabs = new Set<string>(BASE_TABS);
  for (const c of categories) {
    categoryTabs.add(c.category);
  }
  const tabs = Array.from(categoryTabs);

  function selectTab(tab: string) {
    if (tab === 'all') {
      setSearchParams({});
    } else {
      setSearchParams({ category: tab });
    }
  }

  return (
    <div>
      <StoryBar onSignIn={() => setShowLoginModal(true)} />

      {/* Category tabs (sticky) */}
      <div
        style={{
          position: 'sticky',
          top: 56,
          background: '#fff',
          borderBottom: '1px solid #e5e5e5',
          padding: '10px 0',
          zIndex: 50,
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        <div style={{ display: 'inline-flex', gap: 8, padding: '0 24px' }}>
          {tabs.map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => selectTab(tab)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 18,
                  border: `1px solid ${active ? '#0f0f0f' : '#e5e5e5'}`,
                  background: active ? '#0f0f0f' : '#f2f2f2',
                  color: active ? '#fff' : '#0f0f0f',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  transition: 'all 0.15s',
                }}
              >
                {CATEGORY_LABELS[tab] ?? tab}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mf-container">
        {/* Trending subtitle */}
        {activeTab === 'trending' && (
          <p style={{ color: '#606060', fontSize: 13, marginBottom: 16 }}>
            🔥 Most viewed videos in the last 7 days
          </p>
        )}

        {error && <div className="mf-error">{error}</div>}

        {loading ? (
          <div className="mf-loading">Loading videos...</div>
        ) : videos.length === 0 ? (
          <div className="mf-empty">
            <div className="mf-empty-icon">🎬</div>
            <div style={{ fontSize: 18, marginBottom: 8 }}>
              {activeTab === 'all'
                ? 'No videos yet'
                : activeTab === 'trending'
                ? 'No trending videos this week'
                : `No videos in ${CATEGORY_LABELS[activeTab] ?? activeTab}`}
            </div>
            <div style={{ fontSize: 14, color: '#606060' }}>
              {activeTab === 'all' ? 'Be the first to upload!' : 'Try another category'}
            </div>
          </div>
        ) : (
          <div className="mf-grid">
            {videos.map((v) => (
              <VideoCard key={v.id} video={v} onClick={(id) => navigate(`/watch/${id}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
