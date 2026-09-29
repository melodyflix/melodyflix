// melodyflix - channel community posts feed
import { useEffect, useState } from 'react';
import {
  listChannelPosts, getCachedUser,
  type CommunityPost, type Channel,
} from '../lib/api';
import PostCard from './PostCard';
import PostComposer from './PostComposer';

interface Props {
  channel: Channel;
  onSignIn: () => void;
}

export default function ChannelPosts({ channel, onSignIn }: Props) {
  const me = getCachedUser();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isOwner = !!me && me.id === channel.owner_id;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await listChannelPosts(channel.id, 20, 0);
      setPosts(res.posts);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [channel.id]);

  function handlePosted(post: CommunityPost) {
    setPosts((prev) => [post, ...prev]);
  }

  return (
    <div>
      {isOwner && (
        <PostComposer channelId={channel.id} onPosted={handlePosted} />
      )}

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading posts...</div>
      ) : posts.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">💬</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>
            {isOwner ? 'You haven\'t posted yet' : 'No community posts yet'}
          </div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            {isOwner
              ? 'Post an update to share with your community'
              : 'Check back later'}
          </div>
        </div>
      ) : (
        <div>
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              channel={channel}
              isOwner={isOwner}
              onChanged={load}
              onSignIn={onSignIn}
            />
          ))}
        </div>
      )}
    </div>
  );
}
