import { useEffect, useRef, useState } from 'react';
import { api, uploadVideo, type Video } from '../lib/api';

export default function Videos() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [channelId, setChannelId] = useState('');
  const [myChannel, setMyChannel] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await api.listVideos();
      setVideos(data.videos);
      setTotal(data.total);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMyChannel() {
    try {
      const ch = await api.getMyChannel();
      setMyChannel(ch.id);
      setChannelId(ch.id);
    } catch {
      // admin has no channel — fine
    }
  }

  useEffect(() => {
    load();
    loadMyChannel();
  }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!fileRef.current?.files?.[0]) {
      setError('Please select a file');
      return;
    }
    if (!channelId) {
      setError('Channel ID required. Create a channel first (Channels page uses your account).');
      return;
    }
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const file = fileRef.current.files[0];
      const video = await uploadVideo(
        file,
        { title, description, channelId, visibility: 'public' },
        (pct) => setProgress(pct)
      );
      setTitle('');
      setDescription('');
      if (fileRef.current) fileRef.current.value = '';
      setProgress(100);
      setTimeout(() => { setBusy(false); setProgress(0); }, 600);
      await load();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove(id: string, ttl: string) {
    if (!confirm(`Delete "${ttl}"?`)) return;
    try {
      await api.deleteVideo(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>
          Videos <span className="mf-muted" style={{ fontSize: 14 }}>({total} total)</span>
        </h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}

      <div className="mf-card mf-mb-16">
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Upload new video</h3>
        <form onSubmit={handleUpload}>
          <div className="mf-form-group">
            <label className="mf-label">Title</label>
            <input className="mf-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Description</label>
            <textarea className="mf-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Channel ID {myChannel && <span className="mf-muted">(yours: {myChannel.slice(0, 8)}...)</span>}</label>
            <input className="mf-input" value={channelId} onChange={(e) => setChannelId(e.target.value)} required />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Video file</label>
            <input className="mf-input" type="file" accept="video/*" ref={fileRef} required />
          </div>

          {busy && progress > 0 && (
            <div className="mf-alert mf-alert-info">Uploading... {progress}%</div>
          )}

          <button className="mf-btn" type="submit" disabled={busy}>
            {busy ? 'Uploading...' : 'Upload'}
          </button>
        </form>
      </div>

      {loading ? (
        <div className="mf-card">Loading...</div>
      ) : videos.length === 0 ? (
        <div className="mf-card">No videos yet. Upload one above.</div>
      ) : (
        <table className="mf-table">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Thumb</th>
              <th>Title</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Size</th>
              <th>Views</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {videos.map((v) => (
              <tr key={v.id}>
                <td>
                  {v.thumbnail_url ? (
                    <img
                      src={`/api/v1/videos/${v.id}/thumbnail.jpg`}
                      alt=""
                      style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 2 }}
                    />
                  ) : (
                    <div style={{ width: 80, height: 45, background: '#f0f0f1', borderRadius: 2 }} />
                  )}
                </td>
                <td><strong>{v.title}</strong></td>
                <td>
                  <span className={`mf-badge ${
                    v.status === 'ready' ? 'mf-badge-success' :
                    v.status === 'processing' ? 'mf-badge-info' :
                    v.status === 'failed' ? 'mf-badge-warning' : ''
                  }`}>{v.status}</span>
                </td>
                <td>{Math.round(v.duration_seconds)}s</td>
                <td className="mf-muted">{Math.round(v.file_size_bytes / 1024)} KB</td>
                <td>{v.view_count}</td>
                <td className="mf-muted">{new Date(v.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="mf-btn mf-btn-danger" style={{ padding: '4px 8px' }} onClick={() => remove(v.id, v.title)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
