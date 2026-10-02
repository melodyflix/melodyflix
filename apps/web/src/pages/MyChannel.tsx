import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type User, type Channel as ChannelType, type Video } from '../lib/api';
import VideoCard from '../components/VideoCard';
import CustomizationEditor from '../components/CustomizationEditor';
import IntroOutroEditor from '../components/IntroOutroEditor';
import OverlaysEditor from '../components/OverlaysEditor';
import DistributionPanel from '../components/DistributionPanel';

interface Props {
  user: User | null;
  onSignIn: () => void;
}

export default function MyChannel({ user, onSignIn }: Props) {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<ChannelType | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasChannel, setHasChannel] = useState(false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    api.getMyChannel()
      .then(async (ch) => {
        setChannel(ch);
        setHasChannel(true);
        const list = await api.listVideos(50, 0);
        setVideos(list.videos.filter((v) => v.channel_id === ch.id));
      })
      .catch((err) => {
        // 404 means no channel — user needs to create one
        const msg = (err as Error).message;
        if (msg.includes('No channel') || msg.includes('not found')) {
          setHasChannel(false);
        } else {
          setError(msg);
        }
      })
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to see your channel</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="mf-loading">Loading...</div>;

  if (error) return <div className="mf-container"><div className="mf-error">{error}</div></div>;

  if (!hasChannel || !channel) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">📺</div>
          <div style={{ fontSize: 20, marginBottom: 8 }}>You don't have a channel yet</div>
          <div style={{ marginBottom: 20, color: '#606060' }}>Create one to start uploading videos</div>
          <button
            className="mf-btn-primary"
            style={{ width: 'auto', padding: '10px 24px' }}
            onClick={() => navigate('/channel/new')}
          >
            Create channel
          </button>
        </div>
      </div>
    );
  }

  const [showCustomization, setShowCustomization] = useState(false);
  const [showIntroOutro, setShowIntroOutro] = useState(false);
  const [showOverlays, setShowOverlays] = useState(false);
  const [showDistribution, setShowDistribution] = useState(false);
  const initial = channel.name[0].toUpperCase();

  return (
    <>
      <div className="mf-channel-header">
        <div className="mf-channel-avatar-lg">{initial}</div>
        <div className="mf-channel-info-lg">
          <div className="mf-channel-name-lg">{channel.name}</div>
          <div className="mf-channel-stats">
            @{channel.handle} · {channel.subscriber_count} subscribers · {videos.length} videos
          </div>
          {channel.description && (
            <div className="mf-channel-desc">{channel.description}</div>
          )}
          <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
            <button
              className="mf-sub-btn"
              onClick={() => navigate('/channel/me/edit')}
            >
              Edit channel
            </button>
            <button
              className="mf-sub-btn"
              style={{ background: '#fff', color: '#0f0f0f', border: '1px solid #e5e5e5' }}
              onClick={() => navigate(`/channel/${channel.id}`)}
            >
              View public page
            </button>
          </div>
        </div>
      </div>

      <div className="mf-container">
        <div style={{ marginBottom: 24, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>🎨 Player & Branding</div>
            <div style={{ fontSize: 12, color: '#606060' }}>
              Customize how your videos look: colors, logo, filters, color grading.
            </div>
          </div>
          <button
            className="mf-btn-secondary"
            onClick={() => setShowCustomization((v) => !v)}
            style={{ fontSize: 13, padding: '8px 16px' }}
          >
            {showCustomization ? 'Close' : 'Customize'}
          </button>
        </div>
        {showCustomization && (
          <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <CustomizationEditor
              channelId={channel.id}
              onToast={(m) => alert(m)}
            />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>🎬 Intro & Outro</div>
            <div style={{ fontSize: 12, color: '#606060' }}>
              Add a branded intro at the start and an end-card outro to every video.
            </div>
          </div>
          <button
            className="mf-btn-secondary"
            onClick={() => setShowIntroOutro((v) => !v)}
            style={{ fontSize: 13, padding: '8px 16px' }}
          >
            {showIntroOutro ? 'Close' : 'Configure'}
          </button>
        </div>
        {showIntroOutro && (
          <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <IntroOutroEditor
              channelId={channel.id}
              onToast={(m) => alert(m)}
            />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>📊 Overlays & Transitions</div>
            <div style={{ fontSize: 12, color: '#606060' }}>
              Add timed lower thirds (name plates, sponsor tags) and pick transitions between intro → video → outro.
            </div>
          </div>
          <button
            className="mf-btn-secondary"
            onClick={() => setShowOverlays((v) => !v)}
            style={{ fontSize: 13, padding: '8px 16px' }}
          >
            {showOverlays ? 'Close' : 'Configure'}
          </button>
        </div>
        {showOverlays && (
          <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <OverlaysEditor
              channelId={channel.id}
              onToast={(m) => alert(m)}
            />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24, background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>📡 Distribution</div>
            <div style={{ fontSize: 12, color: '#606060' }}>
              Publish videos to YouTube, Facebook, Instagram and more. Auto-share on publish + RSS feed.
            </div>
          </div>
          <button
            className="mf-btn-secondary"
            onClick={() => setShowDistribution((v) => !v)}
            style={{ fontSize: 13, padding: '8px 16px' }}
          >
            {showDistribution ? 'Close' : 'Manage'}
          </button>
        </div>
        {showDistribution && (
          <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            <DistributionPanel
              channelId={channel.id}
              videos={videos.map((v) => ({ id: v.id, title: v.title }))}
              onToast={(m) => alert(m)}
            />
          </div>
        )}
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Your videos</h2>
        {videos.length === 0 ? (
          <div className="mf-empty">
            <div className="mf-empty-icon">📭</div>
            <div style={{ fontSize: 16 }}>No videos yet</div>
            <div style={{ fontSize: 13, marginTop: 8, color: '#606060' }}>
              Upload videos from the admin panel
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
    </>
  );
}
