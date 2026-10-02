import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listVideoTags, type VideoTag } from '../lib/api';

interface Props {
  videoId: string;
  limit?: number;
}

export default function TagChips({ videoId, limit = 15 }: Props) {
  const navigate = useNavigate();
  const [tags, setTags] = useState<VideoTag[]>([]);

  useEffect(() => {
    if (!videoId) return;
    listVideoTags(videoId)
      .then((res) => setTags(res.tags))
      .catch(() => setTags([]));
  }, [videoId]);

  if (tags.length === 0) return null;

  const visible = tags.slice(0, limit);
  const hasMore = tags.length > limit;

  return (
    <div className="mf-tag-chips">
      {visible.map((t) => (
        <button
          key={t.id}
          className={`mf-tag-chip ${t.source === 'hashtag' ? 'mf-tag-hash' : ''}`}
          onClick={() => navigate(`/tag/${encodeURIComponent(t.tag_normalized)}`)}
          title={t.source === 'hashtag' ? 'Hashtag' : t.source === 'auto' ? 'Auto-tag' : 'Tag'}
        >
          {t.source === 'hashtag' && '#'}
          {t.tag}
        </button>
      ))}
      {hasMore && (
        <span className="mf-tag-more">+{tags.length - limit} more</span>
      )}
    </div>
  );
}
