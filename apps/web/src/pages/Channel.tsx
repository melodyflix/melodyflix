import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  api, followChannel, unfollowChannel, isFollowing, getCachedUser,
  type Channel as ChannelType, type Video,
} from '../lib/api';
import VideoCard from '../components/VideoCard';

export default function Channel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = getCachedUser();

  const [channel, setChannel] = useState<ChannelType | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [busySub, setBusySub] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError('');
    Promise.all([
      api.getChannel(id),
      api.listVideos(50, 0),
    ])
      .then(async ([ch, list]) => {
        setChannel(ch);
        setSubscriberCount(ch.subscriber_count);
        setVideos(list.videos.filter((v) => v.channel_id === id));

        if (me && ch.owner_id !== me.id) {
          try {
            const res = await isFollowing(ch.id);
            setSubscribed(res.following);
          } catch {}
        }
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSubscribe() {
    if (!channel || busySub) return;
    if (!me) { alert('Sign in to subscribe'); return; }
    setBusySub(true);
    try {
      if (subscribed) {
        const res = await unfollowChannel(channel.id);
        setSubscribed(false);
        setSubscriberCount(res.subscriberCount);
      } else {
        const res = await followChannel(channel.id);
        setSubscribed(true);
        setSubscriberCount(res.subscriberCount);
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusySub(false);
    }
  }

  if (loading) return <div className="mf-loading">Loading...</div>;
  if (error) return <div className="mf-container"><div className="mf-error">{error}</div></div>;
  if (!channel) return <div className="mf-empty">Channel not found</div>;

  const initial = channel.name[0].toUpperCase();
  const isOwnChannel = me && channel.owner_id === me.id;

  return (
    <>
      <div className="mf-channel-header">
        <div className="mf-channel-avatar-lg">{initial}</div>
        <div className="mf-channel-info-lg">
          <div className="mf-channel-name-lg">{channel.name}</div>
          <div className="mf-channel-stats">
            @{channel.handle} · {subscriberCount} subscribers · {videos.length} videos
          </div>
          {channel.description && (
            <div className="mf-channel-desc">{channel.description}</div>
          )}
          {!isOwnChannel && (
            <button
              className={`mf-sub-btn ${subscribed ? 'subscribed' : ''}`}
              style={{ marginTop: 14 }}
              onClick={handleSubscribe}
              disabled={busySub}
            >
              {subscribed ? 'Subscribed' : 'Subscribe'}
            </button>
          )}
          {isOwnChannel && (
            <button
              className="mf-sub-btn"
              style={{ marginTop: 14, background: '#fff', color: '#0f0f0f', border: '1px solid #e5e5e5' }}
              onClick={() => navigate('/channel/me/edit')}
            >
              Edit channel
            </button>
          )}
        </div>
      </div>

      <div className="mf-container">
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Videos</h2>
        {videos.length === 0 ? (
          <div className="mf-empty">
            <div className="mf-empty-icon">📭</div>
            <div>No videos yet</div>
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
