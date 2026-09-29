// melodyflix - community post card
import { useState } from 'react';
import {
  toggleCommunityPostLike, deleteCommunityPost, updateCommunityPost,
  getCachedUser, timeAgo,
  type CommunityPost,
  type Channel,
} from '../lib/api';

interface Props {
  post: CommunityPost;
  channel: Channel;
  isOwner: boolean;
  onChanged: () => void;
  onSignIn: () => void;
}

export default function PostCard({ post, channel, isOwner, onChanged, onSignIn }: Props) {
  const me = getCachedUser();
  const [liked, setLiked] = useState<boolean>(!!post.user_reaction);
  const [likeCount, setLikeCount] = useState(post.like_count);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.content);
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLike() {
    if (!me) { onSignIn(); return; }
    if (busy) return;
    setBusy(true);
    try {
      const res = await toggleCommunityPostLike(post.id);
      setLiked(res.liked);
      setLikeCount(res.likeCount);
    } catch {}
    setBusy(false);
  }

  async function handleSaveEdit() {
    if (!editText.trim()) return;
    setBusy(true);
    try {
      await updateCommunityPost(post.id, editText.trim());
      setEditing(false);
      onChanged();
    } catch (err) {
      alert((err as Error).message);
    }
    setBusy(false);
  }

  async function handleDelete() {
    if (!confirm('Delete this post?')) return;
    try {
      await deleteCommunityPost(post.id);
      onChanged();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const initial = channel.name[0].toUpperCase();

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 12,
        padding: 16,
        marginBottom: 14,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
        <div
          className="mf-video-avatar"
          style={{ width: 40, height: 40, flexShrink: 0, fontSize: 16 }}
        >
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14 }}>{channel.name}</div>
          <div style={{ fontSize: 12, color: '#606060' }}>{timeAgo(post.created_at)}</div>
        </div>

        {isOwner && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 18,
                cursor: 'pointer',
                color: '#909090',
                padding: 4,
              }}
            >
              ⋮
            </button>
            {menuOpen && (
              <div
                onMouseLeave={() => setMenuOpen(false)}
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  background: '#fff',
                  border: '1px solid #e5e5e5',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  minWidth: 140,
                  padding: '4px 0',
                  zIndex: 20,
                }}
              >
                <div
                  onClick={() => { setMenuOpen(false); setEditing(true); }}
                  style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}
                >
                  ✏️ Edit
                </div>
                <div
                  onClick={() => { setMenuOpen(false); handleDelete(); }}
                  style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 13, color: '#dc2626' }}
                >
                  🗑 Delete
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {editing ? (
        <>
          <textarea
            className="mf-input"
            style={{ minHeight: 80, fontSize: 14, marginBottom: 8 }}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            maxLength={2000}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              className="mf-btn-text"
              onClick={() => { setEditing(false); setEditText(post.content); }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              className="mf-btn-text mf-btn-text-primary"
              onClick={handleSaveEdit}
              disabled={busy || !editText.trim()}
            >
              {busy ? 'Saving...' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            marginBottom: 12,
          }}
        >
          {post.content}
        </div>
      )}

      {/* Actions */}
      {!editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={handleLike}
            disabled={busy}
            style={{
              background: liked ? '#e8f0fe' : 'transparent',
              border: 'none',
              padding: '6px 12px',
              borderRadius: 16,
              cursor: busy ? 'wait' : 'pointer',
              fontSize: 13,
              fontFamily: 'inherit',
              color: liked ? '#065fd4' : '#0f0f0f',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {liked ? '❤️' : '🤍'} {likeCount}
          </button>
        </div>
      )}
    </div>
  );
}
