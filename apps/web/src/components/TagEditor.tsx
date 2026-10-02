import { useEffect, useState } from 'react';
import {
  listVideoTags, addVideoTag, removeVideoTag, syncHashtags, suggestTags,
  type VideoTag, type TagWithCount,
} from '../lib/api';

interface Props {
  videoId: string;
  onToast?: (msg: string) => void;
}

export default function TagEditor({ videoId, onToast }: Props) {
  const [tags, setTags] = useState<VideoTag[]>([]);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<TagWithCount[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await listVideoTags(videoId);
      setTags(res.tags);
    } catch {}
  }

  useEffect(() => { load(); }, [videoId]);

  useEffect(() => {
    const q = input.trim().replace(/^#/, '');
    if (q.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      suggestTags(q, 6).then((r) => setSuggestions(r.tags)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [input]);

  async function handleAdd(rawTag?: string) {
    const tag = (rawTag ?? input).trim().replace(/^#/, '');
    if (!tag) return;
    setBusy(true);
    try {
      await addVideoTag(videoId, tag);
      setInput('');
      setSuggestions([]);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to add tag');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(tag: string) {
    setBusy(true);
    try {
      await removeVideoTag(videoId, tag);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to remove');
    } finally {
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    try {
      const res = await syncHashtags(videoId);
      onToast?.(`Scanned: ${res.added.length} hashtag(s) added`);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {tags.map((t) => (
          <span key={t.id} className={`mf-tag-chip ${t.source === 'hashtag' ? 'mf-tag-hash' : ''}`}>
            {t.source === 'hashtag' && '#'}{t.tag}
            <button
              className="mf-tag-remove"
              onClick={() => handleRemove(t.tag)}
              disabled={busy}
              title="Remove"
            >×</button>
          </span>
        ))}
        {tags.length === 0 && (
          <span style={{ fontSize: 12, color: '#909090' }}>No tags yet.</span>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="mf-input"
            value={input}
            placeholder="Add tag (press Enter)"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
            }}
            disabled={busy}
            style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
          />
          <button
            type="button"
            className="mf-btn-text mf-btn-text-primary"
            onClick={() => handleAdd()}
            disabled={busy || !input.trim()}
          >
            Add
          </button>
          <button
            type="button"
            className="mf-btn-text"
            onClick={handleSync}
            disabled={busy}
            title="Scan title + description for #hashtags"
            style={{ fontSize: 12 }}
          >
            #Sync
          </button>
        </div>

        {suggestions.length > 0 && (
          <div className="mf-tag-suggestions">
            {suggestions.map((s) => (
              <div
                key={s.tag_normalized}
                className="mf-tag-suggestion"
                onClick={() => handleAdd(s.tag)}
              >
                #{s.tag} <span className="mf-tag-count">{s.video_count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
