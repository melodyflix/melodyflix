import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TagEditor from '../components/TagEditor';
import GenreEditor from '../components/GenreEditor';
import CastCrewEditor from '../components/CastCrewEditor';
import SubtitleManager from '../components/SubtitleManager';
import VrEditor from '../components/VrEditor';
import {
  listMyVideos, updateVideo, deleteVideo, getCachedUser,
  formatDuration, formatViews, timeAgo,
  type Video,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

export default function MyVideos({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Video | null>(null);
  const [editTab, setEditTab] = useState<'basic' | 'tags' | 'genres' | 'credits' | 'subtitles' | 'vr'>('basic');
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editVis, setEditVis] = useState<'public' | 'unlisted' | 'private'>('public');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'public' | 'unlisted' | 'private'>('all');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await listMyVideos();
      setVideos(res.videos);
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
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to manage your videos</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  function openEdit(v: Video) {
    setEditing(v);
    setEditTitle(v.title);
    setEditDesc(v.description ?? '');
    setEditVis(v.visibility as any);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await updateVideo(editing.id, {
        title: editTitle.trim(),
        description: editDesc.trim(),
        visibility: editVis,
      });
      setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      setEditing(null);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(v: Video) {
    if (!confirm(`Delete "${v.title}" permanently? This cannot be undone.`)) return;
    try {
      await deleteVideo(v.id);
      setVideos((prev) => prev.filter((x) => x.id !== v.id));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const filtered = filter === 'all' ? videos : videos.filter((v) => v.visibility === filter);

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
          My Videos
          <span style={{ color: '#606060', fontSize: 14, marginLeft: 10, fontWeight: 400 }}>
            ({videos.length})
          </span>
        </h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['all', 'public', 'unlisted', 'private'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 14px',
                borderRadius: 16,
                border: `1px solid ${filter === f ? '#065fd4' : '#d0d0d0'}`,
                background: filter === f ? '#065fd4' : '#fff',
                color: filter === f ? '#fff' : '#0f0f0f',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'inherit',
                textTransform: 'capitalize',
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🎬</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>
            {filter === 'all' ? 'No videos yet' : `No ${filter} videos`}
          </div>
          {filter === 'all' && (
            <button
              className="mf-btn-primary"
              style={{ width: 'auto', padding: '10px 24px', marginTop: 8 }}
              onClick={() => navigate('/upload')}
            >
              Upload your first video
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((v) => (
            <div
              key={v.id}
              style={{
                display: 'flex',
                gap: 12,
                padding: 10,
                borderRadius: 10,
                alignItems: 'flex-start',
                border: '1px solid #f0f0f0',
                background: '#fff',
              }}
            >
              <div
                onClick={() => navigate(`/watch/${v.id}`)}
                style={{
                  width: 160,
                  aspectRatio: '16 / 9',
                  background: '#e5e5e5',
                  borderRadius: 8,
                  overflow: 'hidden',
                  flexShrink: 0,
                  position: 'relative',
                  cursor: 'pointer',
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

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 500,
                    marginBottom: 6,
                    cursor: 'pointer',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    lineHeight: 1.35,
                  }}
                  onClick={() => navigate(`/watch/${v.id}`)}
                >
                  {v.title}
                </div>
                <div style={{ fontSize: 13, color: '#606060', marginBottom: 8 }}>
                  {formatViews(v.view_count)} · {timeAgo(v.created_at)} ·{' '}
                  <span className={`mf-badge ${
                    v.visibility === 'public' ? 'mf-badge-success' :
                    v.visibility === 'unlisted' ? 'mf-badge-info' : ''
                  }`}
                  style={{ fontSize: 11, padding: '1px 6px' }}>
                    {v.visibility}
                  </span>
                  {' '}· <span className={`mf-badge ${
                    v.status === 'ready' ? 'mf-badge-success' :
                    v.status === 'processing' ? 'mf-badge-info' : 'mf-badge-warning'
                  }`} style={{ fontSize: 11, padding: '1px 6px' }}>
                    {v.status}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={() => openEdit(v)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 16,
                      border: '1px solid #e5e5e5',
                      background: '#fff',
                      color: '#0f0f0f',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                      fontFamily: 'inherit',
                    }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => handleDelete(v)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 16,
                      border: '1px solid #fecaca',
                      background: '#fff',
                      color: '#dc2626',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 500,
                      fontFamily: 'inherit',
                    }}
                  >
                    🗑 Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="mf-modal-backdrop" onClick={() => setEditing(null)}>
          <div
            className="mf-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520 }}
          >
            <h2 style={{ fontSize: 18, marginBottom: 14 }}>Edit video</h2>

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid #e5e5e5', paddingBottom: 0 }}>
              {([
                { id: 'basic', label: '📝 Basic' },
                { id: 'tags', label: '🏷️ Tags' },
                { id: 'genres', label: '🎬 Genres' },
                { id: 'credits', label: '🎭 Cast & Crew' },
                { id: 'subtitles', label: '💬 Subtitles' },
                { id: 'vr', label: '🥽 VR / 360' },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setEditTab(t.id)}
                  style={{
                    padding: '8px 14px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: editTab === t.id ? '2px solid #065fd4' : '2px solid transparent',
                    color: editTab === t.id ? '#065fd4' : '#606060',
                    fontWeight: editTab === t.id ? 600 : 400,
                    fontSize: 13,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {editTab === 'basic' && (
            <form onSubmit={handleSaveEdit}>
              <div className="mf-form-group">
                <label className="mf-label">Title</label>
                <input
                  className="mf-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </div>
              <div className="mf-form-group">
                <label className="mf-label">Description</label>
                <textarea
                  className="mf-input"
                  style={{ minHeight: 100 }}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  maxLength={5000}
                />
              </div>
              <div className="mf-form-group">
                <label className="mf-label">Visibility</label>
                <select
                  className="mf-input"
                  value={editVis}
                  onChange={(e) => setEditVis(e.target.value as any)}
                >
                  <option value="public">Public — everyone can see</option>
                  <option value="unlisted">Unlisted — only with link</option>
                  <option value="private">Private — only you</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  type="button"
                  className="mf-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setEditing(null)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="mf-btn-primary"
                  style={{ flex: 1 }}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
            )}

            {editTab === 'tags' && editing && (
              <div>
                <TagEditor videoId={editing.id} onToast={(m) => alert(m)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                  <button
                    type="button"
                    className="mf-btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setEditing(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {editTab === 'genres' && editing && (
              <div>
                <GenreEditor videoId={editing.id} onToast={(m) => alert(m)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                  <button
                    type="button"
                    className="mf-btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setEditing(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {editTab === 'credits' && editing && (
              <div>
                <CastCrewEditor videoId={editing.id} onToast={(m) => alert(m)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                  <button
                    type="button"
                    className="mf-btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setEditing(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {editTab === 'subtitles' && editing && (
              <div>
                <SubtitleManager videoId={editing.id} onToast={(m) => alert(m)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                  <button
                    type="button"
                    className="mf-btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setEditing(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {editTab === 'vr' && editing && (
              <div>
                <VrEditor videoId={editing.id} onToast={(m) => alert(m)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                  <button
                    type="button"
                    className="mf-btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setEditing(null)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
