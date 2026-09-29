// melodyflix - community post composer (only for channel owner)
import { useState } from 'react';
import { createCommunityPost, type CommunityPost } from '../lib/api';

interface Props {
  channelId: string;
  onPosted: (post: CommunityPost) => void;
}

export default function PostComposer({ channelId, onPosted }: Props) {
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    setError('');
    try {
      const post = await createCommunityPost(channelId, content.trim());
      setContent('');
      setExpanded(false);
      onPosted(post);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
      }}
    >
      {error && (
        <div
          style={{
            background: '#fef2f2',
            color: '#991b1b',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      <textarea
        className="mf-input"
        placeholder="Share something with your community..."
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          if (!expanded && e.target.value) setExpanded(true);
        }}
        onFocus={() => setExpanded(true)}
        maxLength={2000}
        style={{
          minHeight: expanded ? 100 : 44,
          fontSize: 14,
          resize: 'vertical',
          transition: 'min-height 0.15s',
        }}
      />

      {expanded && (
        <>
          <div
            style={{
              fontSize: 12,
              color: '#909090',
              textAlign: 'right',
              marginTop: 4,
            }}
          >
            {content.length} / 2000
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              marginTop: 10,
            }}
          >
            <button
              type="button"
              className="mf-btn-secondary"
              style={{ width: 'auto', padding: '8px 20px' }}
              onClick={() => { setContent(''); setExpanded(false); }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="mf-btn-primary"
              style={{ width: 'auto', padding: '8px 20px' }}
              disabled={busy || !content.trim()}
            >
              {busy ? 'Posting...' : 'Post'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
