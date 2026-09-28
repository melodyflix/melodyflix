import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type User } from '../lib/api';

interface Props {
  user: User | null;
  onSignIn: () => void;
}

export default function CreateChannel({ user, onSignIn }: Props) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!user) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to create a channel</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const ch = await api.createChannel(name, handle, description || undefined);
      navigate(`/channel/${ch.id}`);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="mf-container" style={{ maxWidth: 560, marginTop: 40 }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Create your channel</h1>
      <p style={{ color: '#606060', marginBottom: 24 }}>
        Your channel is where your videos live. You can create only one channel per account.
      </p>

      {error && <div className="mf-error">{error}</div>}

      <form onSubmit={submit}>
        <div className="mf-form-group">
          <label className="mf-label">Channel name</label>
          <input
            className="mf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder="My Awesome Channel"
          />
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Handle (username-style)</label>
          <input
            className="mf-input"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            required
            minLength={3}
            maxLength={30}
            pattern="[a-zA-Z0-9_]+"
            placeholder="mycoolchannel"
          />
          <div style={{ fontSize: 12, color: '#606060', marginTop: 4 }}>
            Letters, numbers, and underscore only. This will be your @handle.
          </div>
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Description (optional)</label>
          <textarea
            className="mf-input"
            style={{ minHeight: 100 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            placeholder="Tell viewers about your channel..."
          />
        </div>

        <button className="mf-btn-primary" type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create channel'}
        </button>
      </form>
    </div>
  );
}
