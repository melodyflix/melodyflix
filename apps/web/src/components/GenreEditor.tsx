import { useEffect, useState } from 'react';
import {
  GENRE_LIST, genreLabel, listVideoGenres, replaceVideoGenres,
  type VideoGenre,
} from '../lib/api';

interface Props {
  videoId: string;
  onToast?: (msg: string) => void;
}

export default function GenreEditor({ videoId, onToast }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!videoId) return;
    listVideoGenres(videoId)
      .then((res) => {
        setSelected(new Set(res.genres.map((g) => g.genre)));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [videoId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setBusy(true);
    try {
      await replaceVideoGenres(videoId, Array.from(selected));
      onToast?.(`Genres saved (${selected.size})`);
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <div style={{ fontSize: 12, color: '#909090' }}>Loading genres...</div>;

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, color: '#606060', marginBottom: 10 }}>
        Select up to 5 genres that describe this video.
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: 12,
        }}
      >
        {GENRE_LIST.map((g) => {
          const active = selected.has(g.id);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              disabled={busy}
              className={`mf-genre-option ${active ? 'mf-genre-option-active' : ''}`}
            >
              {active ? '✓ ' : ''}{g.label}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <span style={{ fontSize: 12, color: '#606060', alignSelf: 'center' }}>
          {selected.size} selected
        </span>
        <button
          type="button"
          className="mf-btn-text mf-btn-text-primary"
          onClick={handleSave}
          disabled={busy}
        >
          {busy ? 'Saving...' : 'Save Genres'}
        </button>
      </div>
    </div>
  );
}
