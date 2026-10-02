import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listVideoGenres, genreLabel, type VideoGenre } from '../lib/api';

interface Props {
  videoId: string;
}

export default function GenreChips({ videoId }: Props) {
  const navigate = useNavigate();
  const [genres, setGenres] = useState<VideoGenre[]>([]);

  useEffect(() => {
    if (!videoId) return;
    listVideoGenres(videoId)
      .then((res) => setGenres(res.genres))
      .catch(() => setGenres([]));
  }, [videoId]);

  if (genres.length === 0) return null;

  return (
    <div className="mf-tag-chips" style={{ marginTop: 4 }}>
      {genres.map((g) => (
        <button
          key={g.id}
          className="mf-genre-chip"
          onClick={() => navigate(`/genre/${encodeURIComponent(g.genre)}`)}
          title="Browse this genre"
        >
          🎬 {genreLabel(g.genre)}
        </button>
      ))}
    </div>
  );
}
