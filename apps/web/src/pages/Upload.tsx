import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, uploadVideo, type User, type Channel } from '../lib/api';

interface Props {
  user: User | null;
  onSignIn: () => void;
}

export default function Upload({ user, onSignIn }: Props) {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [channelLoading, setChannelLoading] = useState(true);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [category, setCategory] = useState<string>('other');
  const [contentType, setContentType] = useState<'video' | 'podcast' | 'short'>('video');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) { setChannelLoading(false); return; }
    api.getMyChannel()
      .then(setChannel)
      .catch(() => setChannel(null))
      .finally(() => setChannelLoading(false));
  }, [user]);

  if (!user) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to upload videos</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (channelLoading) return <div className="mf-loading">Loading...</div>;

  if (!channel) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">📺</div>
          <div style={{ fontSize: 20, marginBottom: 8 }}>You need a channel to upload</div>
          <div style={{ marginBottom: 20, color: '#606060' }}>Create your channel first</div>
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

  function pickFile(f: File | null) {
    if (!f) return;
    setFile(f);
    if (!title) {
      const base = f.name.replace(/\.[^.]+$/, '');
      setTitle(base.slice(0, 100));
    }
    setError('');
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pickFile(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Please select a video file'); return; }
    if (!title.trim()) { setError('Title is required'); return; }
    setBusy(true);
    setError('');
    setProgress(0);
    try {
      const video = await uploadVideo(
        file,
        { title: title.trim(), description: description.trim(), channelId: channel!.id, visibility },
        (p) => setProgress(p)
      );
      setProgress(100);
      // Transcode runs in background; go to watch page
      setTimeout(() => navigate(`/watch/${video.id}`), 500);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const fileSizeMB = file ? (file.size / (1024 * 1024)).toFixed(1) : '0';

  return (
    <div className="mf-container" style={{ maxWidth: 900, marginTop: 30 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Upload video</h1>
      <p style={{ color: '#606060', marginBottom: 24 }}>
        Uploading to <strong>{channel.name}</strong>
      </p>

      {error && <div className="mf-error">{error}</div>}

      <form onSubmit={submit}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? '#065fd4' : '#c3c4c7'}`,
            background: dragOver ? '#e8f0fe' : '#f9f9f9',
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
            cursor: 'pointer',
            marginBottom: 20,
            transition: 'all 0.15s',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🎬</div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>{file.name}</div>
              <div style={{ fontSize: 13, color: '#606060' }}>{fileSizeMB} MB</div>
              <div style={{ fontSize: 12, color: '#065fd4', marginTop: 12 }}>Click to change</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.6 }}>⬆️</div>
              <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>Drag & drop your video here</div>
              <div style={{ fontSize: 13, color: '#606060' }}>or click to select a file (max 2 GB)</div>
            </>
          )}
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Title (required)</label>
          <input
            className="mf-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            disabled={busy}
          />
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Description (optional)</label>
          <textarea
            className="mf-input"
            style={{ minHeight: 120 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            disabled={busy}
          />
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Visibility</label>
          <select
            className="mf-input"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as any)}
            disabled={busy}
          >
            <option value="public">Public — everyone can see</option>
            <option value="unlisted">Unlisted — only with link</option>
            <option value="private">Private — only you</option>
          </select>
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Content type</label>
          <select
            className="mf-input"
            value={contentType}
            onChange={(e) => setContentType(e.target.value as 'video' | 'podcast' | 'short')}
            disabled={busy}
          >
            <option value="video">🎬 Video — visual content</option>
            <option value="short">📱 Short — vertical, max 60s</option>
            <option value="podcast">🎙️ Podcast — audio-first episode</option>
          </select>
          <div style={{ fontSize: 12, color: '#606060', marginTop: 4 }}>
            {contentType === 'podcast' && 'Podcast episodes appear in the Podcasts section with audio-first UI'}
            {contentType === 'short' && 'Shorts appear in the vertical Shorts feed. Keep under 60 seconds.'}
            {contentType === 'video' && 'Standard video with player'}
          </div>
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Category</label>
          <select
            className="mf-input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={busy}
          >
            <option value="music">Music</option>
            <option value="gaming">Gaming</option>
            <option value="education">Education</option>
            <option value="technology">Technology</option>
            <option value="entertainment">Entertainment</option>
            <option value="sports">Sports</option>
            <option value="news">News</option>
            <option value="comedy">Comedy</option>
            <option value="film">Film</option>
            <option value="vlog">Vlog</option>
            <option value="other">Other</option>
          </select>
        </div>

        {busy && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ height: 8, background: '#e5e5e5', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: '#065fd4',
                  transition: 'width 0.2s',
                }}
              />
            </div>
            <div style={{ fontSize: 13, color: '#606060', marginTop: 6, textAlign: 'center' }}>
              {progress < 100 ? `Uploading... ${progress}%` : 'Processing on server...'}
            </div>
          </div>
        )}

        <button className="mf-btn-primary" type="submit" disabled={busy || !file}>
          {busy ? 'Uploading...' : 'Publish'}
        </button>
      </form>
    </div>
  );
}
