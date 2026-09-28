import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getPlaylist, removeFromPlaylist, deletePlaylist, updatePlaylist,
  formatDuration, formatViews, timeAgo, getCachedUser,
  type Playlist, type PlaylistItem,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function PlaylistDetail({ onSignIn }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const me = getCachedUser();

  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editVis, setEditVis] = useState<'public' | 'unlisted' | 'private'>('public');
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await getPlaylist(id);
      setPlaylist(res.playlist);
      setItems(res.items);
      setIsOwner(res.is_owner);
      setEditName(res.playlist.name);
      setEditDesc(res.playlist.description ?? '');
      setEditVis(res.playlist.visibility as any);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleRemove(e: React.MouseEvent, videoId: string) {
    e.stopPropagation();
    if (!id || !playlist) return;
    if (!confirm('Remove this video from the playlist?')) return;
    try {
      await removeFromPlaylist(id, videoId);
      setItems((prev) => prev.filter((v) => v.id !== videoId));
      setPlaylist({ ...playlist, video_count: Math.max(playlist.video_count - 1, 0) });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleDeletePlaylist() {
    if (!id || !playlist) return;
    if (!confirm(`Delete playlist "${playlist.name}"?`)) return;
    try {
      await deletePlaylist(id);
      navigate('/playlists');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      const updated = await updatePlaylist(id, {
        name: editName.trim(),
        description: editDesc.trim(),
        visibility: editVis,
      });
      setPlaylist(updated);
      setEditing(false);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function playFirstVideo() {
    if (items.length === 0) return;
    navigate(`/watch/${items[0].id}`);
  }

  if (loading) return <div className="mf-loading">Loading...</div>;
  if (error) return <div className="mf-container"><div className="mf-error">{error}</div></div>;
  if (!playlist) return <div className="mf-empty">Playlist not found</div>;

  const totalDuration = items.reduce((s, v) => s + (v.duration_seconds || 0), 0);
  const totalMinutes = Math.round(totalDuration / 60);

  return (
    <div className="mf-container" style={{ maxWidth: 1200 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          marginBottom: 24,
          padding: 20,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #e8f0fe 0%, #f9f9f9 100%)',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            width: 160,
            height: 100,
            borderRadius: 8,
            background: '#dcdcdc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 48,
            flexShrink: 0,
          }}
        >
          📁
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div
            style={{
              fontSize: 12,
              color: '#606060',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            Playlist · {playlist.visibility}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>{playlist.name}</h1>
          {playlist.description && (
            <div style={{ fontSize: 14, color: '#606060', marginBottom: 8, lineHeight: 1.5 }}>
              {playlist.description}
            </div>
          )}
          <div style={{ fontSize: 13, color: '#606060', marginBottom: 14 }}>
            {items.length} {items.length === 1 ? 'video' : 'videos'}
            {totalMinutes > 0 && ` · ${totalMinutes} min total`}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {items.length > 0 && (
              <button
                className="mf-btn-primary"
                style={{ width: 'auto', padding: '10px 24px' }}
                onClick={playFirstVideo}
              >
                ▶ Play all
              </button>
            )}
            {isOwner && (
              <>
                <button
                  className="mf-sub-btn"
                  style={{ background: '#fff', color: '#0f0f0f', border: '1px solid #e5e5e5' }}
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? 'Cancel edit' : '✏️ Edit'}
                </button>
                <button
                  className="mf-sub-btn"
                  style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca' }}
                  onClick={handleDeletePlaylist}
                >
                  🗑 Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Edit form */}
      {editing && isOwner && (
        <form
          onSubmit={handleSaveEdit}
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <label className="mf-label">Name</label>
            <input
              className="mf-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
              maxLength={150}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="mf-label">Description</label>
            <textarea
              className="mf-input"
              style={{ minHeight: 70 }}
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              maxLength={1000}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label className="mf-label">Visibility</label>
            <select
              className="mf-input"
              value={editVis}
              onChange={(e) => setEditVis(e.target.value as any)}
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </div>
          <button className="mf-btn-primary" type="submit" disabled={saving} style={{ width: 'auto', padding: '10px 24px' }}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </form>
      )}

      {/* Video list */}
      {items.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">📭</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>This playlist is empty</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            Add videos by clicking "Save to playlist" on any video
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((v, idx) => (
            <div
              key={v.id}
              style={{
                display: 'flex',
                gap: 12,
                padding: 8,
                borderRadius: 10,
                cursor: 'pointer',
                alignItems: 'flex-start',
              }}
              onClick={() => navigate(`/watch/${v.id}`)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f2f2f2')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Index */}
              <div
                style={{
                  width: 30,
                  fontSize: 13,
                  color: '#606060',
                  textAlign: 'center',
                  alignSelf: 'center',
                  flexShrink: 0,
                }}
              >
                {idx + 1}
              </div>

              {/* Thumbnail */}
              <div
                style={{
                  width: 160,
                  aspectRatio: '16 / 9',
                  background: '#e5e5e5',
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  position: 'relative',
                }}
              >
                {v.status === 'ready' ? (
                  <img
                    src={`/api/v1/videos/${v.id}/thumbnail.jpg`}
                    alt={v.title}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 24,
                      opacity: 0.4,
                    }}
                  >
                    🎬
                  </div>
                )}
                {v.duration_seconds > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 6,
                      right: 6,
                      background: 'rgba(0,0,0,0.8)',
                      color: '#fff',
                      fontSize: 11,
                      padding: '2px 5px',
                      borderRadius: 3,
                      fontWeight: 500,
                    }}
                  >
                    {formatDuration(v.duration_seconds)}
                  </div>
                )}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0, alignSelf: 'center' }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    marginBottom: 4,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.35,
                  }}
                >
                  {v.title}
                </div>
                <div style={{ fontSize: 13, color: '#606060' }}>
                  {formatViews(v.view_count)} · {timeAgo(v.created_at)}
                </div>
              </div>

              {isOwner && (
                <button
                  onClick={(e) => handleRemove(e, v.id)}
                  title="Remove from playlist"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 18,
                    cursor: 'pointer',
                    color: '#909090',
                    padding: 6,
                    flexShrink: 0,
                    alignSelf: 'flex-start',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
