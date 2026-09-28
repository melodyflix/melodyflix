import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, uploadChannelAvatar, uploadChannelBanner, getCachedUser,
  type User, type Channel,
} from '../lib/api';

interface Props {
  user: User | null;
  onSignIn: () => void;
}

export default function EditChannel({ user, onSignIn }: Props) {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [avatarCacheBust, setAvatarCacheBust] = useState(Date.now());
  const [bannerCacheBust, setBannerCacheBust] = useState(Date.now());
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    api.getMyChannel()
      .then((ch) => {
        setChannel(ch);
        setName(ch.name);
        setDescription(ch.description ?? '');
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to edit your channel</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="mf-loading">Loading...</div>;

  if (!channel) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">📺</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>You don't have a channel yet</div>
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

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !channel) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be smaller than 5 MB');
      return;
    }

    setUploadingAvatar(true);
    setError('');
    try {
      await uploadChannelAvatar(channel.id, file);
      setAvatarCacheBust(Date.now());
      setSuccess('Avatar updated!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  }

  async function handleBannerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !channel) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Image must be smaller than 10 MB');
      return;
    }

    setUploadingBanner(true);
    setError('');
    try {
      await uploadChannelBanner(channel.id, file);
      setBannerCacheBust(Date.now());
      setSuccess('Banner updated!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploadingBanner(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!channel) return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await api.updateChannel(channel.id, { name, description });
      setSuccess('Saved! Redirecting...');
      setTimeout(() => navigate('/channel/me'), 800);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mf-container" style={{ maxWidth: 700, marginTop: 20 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Edit channel</h1>
      <p style={{ color: '#606060', marginBottom: 24 }}>
        Customize your channel's identity
      </p>

      {error && <div className="mf-error">{error}</div>}
      {success && (
        <div style={{
          background: '#d1fadf', color: '#054f31',
          padding: '10px 14px', borderRadius: 6, marginBottom: 16,
        }}>
          {success}
        </div>
      )}

      {/* Banner */}
      <div style={{ marginBottom: 24 }}>
        <label className="mf-label" style={{ marginBottom: 8 }}>Banner image</label>
        <div
          style={{
            width: '100%',
            aspectRatio: '16 / 6',
            background: '#f2f2f2',
            borderRadius: 12,
            overflow: 'hidden',
            position: 'relative',
            cursor: 'pointer',
          }}
          onClick={() => !uploadingBanner && bannerInputRef.current?.click()}
        >
          <img
            src={`/api/v1/channels/${channel.id}/banner.jpg?t=${bannerCacheBust}`}
            alt="Banner"
            onError={(e) => (e.currentTarget.style.display = 'none')}
            onLoad={(e) => (e.currentTarget.style.display = 'block')}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 6,
              background: 'rgba(0,0,0,0.05)',
              color: '#606060',
              pointerEvents: 'none',
            }}
          >
            <div style={{ fontSize: 28 }}>🖼</div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {uploadingBanner ? 'Uploading...' : 'Click to change banner'}
            </div>
            <div style={{ fontSize: 11 }}>Recommended 2560×800 · Max 10 MB</div>
          </div>
        </div>
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleBannerUpload}
        />
      </div>

      {/* Avatar */}
      <div style={{ marginBottom: 24 }}>
        <label className="mf-label" style={{ marginBottom: 8 }}>Profile picture</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 100,
              height: 100,
              borderRadius: '50%',
              background: '#dc2626',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              fontWeight: 600,
              overflow: 'hidden',
              cursor: 'pointer',
              position: 'relative',
              flexShrink: 0,
            }}
            onClick={() => !uploadingAvatar && avatarInputRef.current?.click()}
          >
            <img
              src={`/api/v1/channels/${channel.id}/avatar.jpg?t=${avatarCacheBust}`}
              alt="Avatar"
              onError={(e) => (e.currentTarget.style.display = 'none')}
              onLoad={(e) => (e.currentTarget.style.display = 'block')}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                position: 'absolute',
                inset: 0,
                display: 'none',
              }}
            />
            {channel.name[0].toUpperCase()}
          </div>
          <div>
            <button
              type="button"
              className="mf-sub-btn"
              style={{ background: '#f2f2f2', color: '#0f0f0f' }}
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
            >
              {uploadingAvatar ? 'Uploading...' : 'Change avatar'}
            </button>
            <div style={{ fontSize: 12, color: '#606060', marginTop: 6 }}>
              Square image · Max 5 MB
            </div>
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarUpload}
          />
        </div>
      </div>

      {/* Text fields */}
      <form onSubmit={handleSubmit}>
        <div className="mf-form-group" style={{ marginBottom: 14 }}>
          <label className="mf-label">Channel name</label>
          <input
            className="mf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </div>

        <div className="mf-form-group" style={{ marginBottom: 14 }}>
          <label className="mf-label">Description</label>
          <textarea
            className="mf-input"
            style={{ minHeight: 120 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="mf-sub-btn"
            style={{ background: '#fff', color: '#0f0f0f', border: '1px solid #e5e5e5' }}
            onClick={() => navigate('/channel/me')}
          >
            Cancel
          </button>
          <button className="mf-btn-primary" type="submit" disabled={saving} style={{ flex: 1 }}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
