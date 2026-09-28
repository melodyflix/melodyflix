import { useEffect, useState } from 'react';
import {
  listPlaylists, createPlaylist, addToPlaylist, removeFromPlaylist,
  listPlaylistsContainingVideo, getCachedUser,
  type Playlist,
} from '../lib/api';

interface Props {
  videoId: string;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export default function SaveToPlaylistModal({ videoId, onClose, onToast }: Props) {
  const me = getCachedUser();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [containing, setContaining] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [all, contains] = await Promise.all([
        listPlaylists(),
        listPlaylistsContainingVideo(videoId),
      ]);
      setPlaylists(all.playlists);
      setContaining(new Set(contains.playlists.map((p) => p.id)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [videoId]);

  async function toggle(p: Playlist) {
    setBusy(p.id);
    try {
      if (containing.has(p.id)) {
        await removeFromPlaylist(p.id, videoId);
        setContaining((s) => { const n = new Set(s); n.delete(p.id); return n; });
        onToast(`Removed from ${p.name}`);
      } else {
        await addToPlaylist(p.id, videoId);
        setContaining((s) => new Set(s).add(p.id));
        onToast(`Saved to ${p.name}`);
      }
      // update counts
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const p = await createPlaylist(newName.trim());
      // Auto-add current video
      await addToPlaylist(p.id, videoId);
      setNewName('');
      setShowCreate(false);
      onToast(`Created "${p.name}" & saved`);
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (!me) {
    return (
      <div className="mf-modal-backdrop" onClick={onClose}>
        <div className="mf-modal" onClick={(e) => e.stopPropagation()}>
          <h2>Sign in required</h2>
          <p style={{ color: '#606060', textAlign: 'center' }}>Sign in to save videos to playlists.</p>
          <button className="mf-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mf-modal-backdrop" onClick={onClose}>
      <div className="mf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2 style={{ fontSize: 18, marginBottom: 16 }}>Save video to...</h2>

        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#606060' }}>Loading...</div>
        ) : (
          <>
            <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 14 }}>
              {playlists.length === 0 && !showCreate ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#606060', fontSize: 13 }}>
                  No playlists yet.
                </div>
              ) : (
                playlists.map((p) => {
                  const checked = containing.has(p.id);
                  return (
                    <div
                      key={p.id}
                      onClick={() => busy !== p.id && toggle(p)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        borderRadius: 8,
                        cursor: busy === p.id ? 'wait' : 'pointer',
                        background: '#fff',
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          border: '2px solid #909090',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: checked ? '#065fd4' : 'transparent',
                          borderColor: checked ? '#065fd4' : '#909090',
                          flexShrink: 0,
                        }}
                      >
                        {checked && <span style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.name}
                        </div>
                        <div style={{ fontSize: 12, color: '#606060' }}>
                          {p.video_count} {p.video_count === 1 ? 'video' : 'videos'} · {p.visibility}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {showCreate ? (
              <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  className="mf-input"
                  placeholder="New playlist name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  maxLength={150}
                  disabled={creating}
                />
                <button
                  type="submit"
                  className="mf-btn-primary"
                  style={{ width: 'auto', padding: '8px 16px' }}
                  disabled={creating || !newName.trim()}
                >
                  {creating ? '...' : 'Create'}
                </button>
              </form>
            ) : (
              <button
                className="mf-btn-primary"
                style={{ width: '100%', background: 'transparent', color: '#065fd4', border: '1px dashed #065fd4' }}
                onClick={() => setShowCreate(true)}
              >
                + Create new playlist
              </button>
            )}
          </>
        )}

        <button className="mf-btn-secondary" style={{ marginTop: 12 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
