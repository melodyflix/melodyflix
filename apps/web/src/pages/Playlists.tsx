import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listPlaylists, createPlaylist, deletePlaylist,
  getCachedUser,
  type Playlist,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function Playlists({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await listPlaylists();
      setPlaylists(res.playlists);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!me) { setLoading(false); return; }
    load();
  }, []);

  if (!me) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to see your playlists</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createPlaylist(name.trim(), description.trim() || undefined, visibility);
      setName('');
      setDescription('');
      setVisibility('public');
      setShowCreate(false);
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string, pname: string) {
    e.stopPropagation();
    if (!confirm(`Delete playlist "${pname}"? This cannot be undone.`)) return;
    try {
      await deletePlaylist(id);
      setPlaylists((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <div className="mf-container" style={{ maxWidth: 1100 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 0 }}>
          Playlists
          <span style={{ color: '#606060', fontSize: 14, marginLeft: 10, fontWeight: 400 }}>
            ({playlists.length})
          </span>
        </h1>
        <button className="mf-btn" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? 'Cancel' : '+ New playlist'}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label className="mf-label">Playlist name</label>
              <input
                className="mf-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={150}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mf-label">Description (optional)</label>
              <textarea
                className="mf-input"
                style={{ minHeight: 70 }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
              />
            </div>
            <div>
              <label className="mf-label">Visibility</label>
              <select
                className="mf-input"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as any)}
              >
                <option value="public">Public — anyone can see</option>
                <option value="unlisted">Unlisted — only with link</option>
                <option value="private">Private — only you</option>
              </select>
            </div>
            <button className="mf-btn-primary" type="submit" disabled={creating || !name.trim()}>
              {creating ? 'Creating...' : 'Create playlist'}
            </button>
          </div>
        </form>
      )}

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading...</div>
      ) : playlists.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">📁</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No playlists yet</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            Create your first playlist to organize your videos
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {playlists.map((p) => (
            <div
              key={p.id}
              onClick={() => navigate(`/playlist/${p.id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: 12,
                borderRadius: 12,
                border: '1px solid #e5e5e5',
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 8,
                  background: '#e5e5e5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  flexShrink: 0,
                }}
              >
                📁
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{p.name}</div>
                {p.description && (
                  <div
                    style={{
                      fontSize: 13,
                      color: '#606060',
                      marginBottom: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.description}
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#909090' }}>
                  {p.video_count} {p.video_count === 1 ? 'video' : 'videos'} · {p.visibility}
                </div>
              </div>
              <button
                onClick={(e) => handleDelete(e, p.id, p.name)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 18,
                  cursor: 'pointer',
                  color: '#909090',
                  padding: 6,
                  flexShrink: 0,
                }}
                title="Delete playlist"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
