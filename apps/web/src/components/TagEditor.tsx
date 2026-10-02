import { useEffect, useState } from 'react';
import {
  listVideoTags, addVideoTag, removeVideoTag, syncHashtags, suggestTags,
  suggestAutoTags, applyAutoTags, clearAutoTags,
  type VideoTag, type TagWithCount, type AutoTagSuggestion,
} from '../lib/api';

interface Props {
  videoId: string;
  onToast?: (msg: string) => void;
}

export default function TagEditor({ videoId, onToast }: Props) {
  const [tags, setTags] = useState<VideoTag[]>([]);
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<TagWithCount[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<AutoTagSuggestion[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
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

  async function handleAutoSuggest() {
    setAiBusy(true);
    try {
      const res = await suggestAutoTags(videoId, 10);
      setAiSuggestions(res.suggestions);
      if (res.suggestions.length === 0) {
        onToast?.('No auto-tag candidates found');
      }
    } catch (err) {
      onToast?.((err as Error).message || 'Auto-tag failed');
    } finally {
      setAiBusy(false);
    }
  }

  async function handleApplyAuto() {
    setAiBusy(true);
    try {
      const res = await applyAutoTags(videoId);
      onToast?.(`🤖 ${res.added.length} auto tag(s) applied`);
      setAiSuggestions([]);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Apply failed');
    } finally {
      setAiBusy(false);
    }
  }

  async function handleClearAuto() {
    setAiBusy(true);
    try {
      const res = await clearAutoTags(videoId);
      onToast?.(`Removed ${res.removed} auto tag(s)`);
      await load();
    } catch (err) {
      onToast?.((err as Error).message || 'Clear failed');
    } finally {
      setAiBusy(false);
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

      {/* AI Auto-Tag section */}
      <div style={{
        marginTop: 12,
        padding: '10px 12px',
        background: '#f0f4ff',
        border: '1px solid #c7d2fe',
        borderRadius: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#3730a3' }}>
            🤖 AI Auto-Tag
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="mf-btn-text"
              onClick={handleAutoSuggest}
              disabled={aiBusy}
              style={{ fontSize: 12, color: '#4338ca' }}
              title="Preview candidate tags"
            >
              {aiBusy ? 'Working...' : '🔍 Preview'}
            </button>
            <button
              type="button"
              className="mf-btn-text mf-btn-text-primary"
              onClick={handleApplyAuto}
              disabled={aiBusy}
              style={{ fontSize: 12 }}
              title="Save auto-generated tags"
            >
              ⚡ Apply
            </button>
            <button
              type="button"
              className="mf-btn-text"
              onClick={handleClearAuto}
              disabled={aiBusy}
              style={{ fontSize: 12, color: '#dc2626' }}
              title="Remove all auto-generated tags"
            >
              Clear
            </button>
          </div>
        </div>

        {aiSuggestions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {aiSuggestions.map((sg) => (
              <span
                key={sg.tag}
                className="mf-tag-chip"
                style={{
                  background: sg.source === 'title' ? '#e0e7ff' : '#f3f4f6',
                  color: sg.source === 'title' ? '#3730a3' : '#4b5563',
                  fontSize: 12,
                }}
                title={`score ${sg.score} · from ${sg.source}`}
              >
                {sg.tag}
                <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>{sg.score}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ position: 'relative', marginTop: 12 }}>
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
