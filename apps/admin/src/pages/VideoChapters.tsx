import { useEffect, useState } from 'react';
import { api, adminGetChapters, adminSetChapters, adminClearChapters, type Video } from '../lib/api';

type Draft = { start_seconds: number; title: string };

export default function VideoChapters() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [json, setJson] = useState('[]');
  const [source, setSource] = useState<'manual' | 'auto' | 'none'>('none');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await api.listVideos(100, 0);
      setVideos(data.videos);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function select(v: Video) {
    setSelected(v);
    setError(''); setSuccess('');
    setLoading(true);
    try {
      const data = await adminGetChapters(v.id);
      setSource(data.source);
      setJson(JSON.stringify(data.chapters.map((c) => ({ start_seconds: c.start_seconds, title: c.title })), null, 2));
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!selected) return;
    setError(''); setSuccess('');
    let parsed: Draft[];
    try {
      parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) throw new Error('Top level must be an array');
      for (const c of parsed) {
        if (typeof c.start_seconds !== 'number' || typeof c.title !== 'string') {
          throw new Error('Each chapter must have start_seconds (number) and title (string)');
        }
      }
    } catch (e) { setError('JSON error: ' + (e as Error).message); return; }
    setLoading(true);
    try {
      const data = await adminSetChapters(selected.id, parsed);
      setSource(data.source);
      setJson(JSON.stringify(data.chapters.map((c) => ({ start_seconds: c.start_seconds, title: c.title })), null, 2));
      setSuccess('Saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function clearAll() {
    if (!selected || !confirm('Clear all manual chapters for this video?')) return;
    setError(''); setSuccess('');
    setLoading(true);
    try {
      await adminClearChapters(selected.id);
      setSource('auto');
      setJson('[]');
      setSuccess('Manual chapters cleared');
      setTimeout(() => setSuccess(''), 3000);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  const filtered = videos.filter((v) => search.trim() === '' || v.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Video Chapters</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>Select a video, then edit its chapter list as JSON. Chapters appear on the Watch page and let viewers jump to sections.</p>

      {error && <div style={{ padding: 12, background: '#fee', color: '#c00', borderRadius: 8, marginBottom: 16 }}>{error}</div>}
      {success && <div style={{ padding: 12, background: '#efe', color: '#080', borderRadius: 8, marginBottom: 16 }}>{success}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) 2fr', gap: 24 }}>
        <div>
          <h3 style={{ marginBottom: 12 }}>Videos</h3>
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid #ddd', borderRadius: 6, marginBottom: 12, boxSizing: 'border-box' }}
          />
          <div style={{ maxHeight: 500, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
            {filtered.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => select(v)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: 12,
                  border: 'none', borderBottom: '1px solid #eee',
                  background: selected?.id === v.id ? '#f0e8ff' : 'transparent',
                  cursor: 'pointer', fontSize: 14, color: '#333',
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: 4 }}>{v.title}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{v.id.slice(0, 8)}... &middot; {v.view_count} views</div>
              </button>
            ))}
            {!loading && filtered.length === 0 && <div style={{ padding: 16, color: '#888' }}>No videos</div>}
          </div>
        </div>

        <div>
          {!selected ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#888', border: '2px dashed #ddd', borderRadius: 8 }}>
              Select a video to edit its chapters
            </div>
          ) : (
            <>
              <h3 style={{ marginBottom: 4 }}>{selected.title}</h3>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>Source: <strong>{source}</strong></div>

              <textarea
                value={json}
                onChange={(e) => setJson(e.target.value)}
                spellCheck={false}
                style={{ width: '100%', minHeight: 320, padding: 12, border: '1px solid #ddd', borderRadius: 8, fontFamily: 'monospace', fontSize: 13, boxSizing: 'border-box' }}
              />

              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" onClick={save} disabled={loading}
                  style={{ padding: '10px 20px', border: 'none', borderRadius: 6, background: '#673ab7', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
                  {loading ? 'Saving...' : 'Save chapters'}
                </button>
                {source === 'manual' && (
                  <button type="button" onClick={clearAll} disabled={loading}
                    style={{ padding: '10px 16px', border: '1px solid #c00', borderRadius: 6, background: '#fff', color: '#c00', cursor: 'pointer' }}>
                    Clear manual chapters
                  </button>
                )}
              </div>

              <div style={{ marginTop: 20, padding: 16, background: '#f9f9f9', borderRadius: 8, fontSize: 13, color: '#555' }}>
                <strong>Format example:</strong>
                <pre style={{ margin: '8px 0 0', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>{'[\n  { "start_seconds": 0, "title": "Introduction" },\n  { "start_seconds": 25, "title": "Main topic" },\n  { "start_seconds": 80, "title": "Conclusion" }\n]'}</pre>
                <div style={{ marginTop: 8 }}>Tip: videos with timestamps in their description (e.g. 0:00 Intro) auto-generate chapters if no manual ones exist.</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
