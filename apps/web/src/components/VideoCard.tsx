import type { Video } from '../lib/api';
import { formatDuration, formatViews, timeAgo } from '../lib/api';

interface Props {
  video: Video;
  onClick: (id: string) => void;
}

export default function VideoCard({ video, onClick }: Props) {
  const hasThumb = video.thumbnail_url && video.status === 'ready';
  return (
    <div className="mf-video-card" onClick={() => onClick(video.id)}>
      <div className="mf-thumb">
        {hasThumb ? (
          <img src={`/api/v1/videos/${video.id}/thumbnail.jpg`} alt={video.title} loading="lazy" />
        ) : (
          <div className="mf-thumb-placeholder">
            {video.status === 'processing' ? '⏳' : video.status === 'failed' ? '⚠️' : '🎬'}
          </div>
        )}
        {video.duration_seconds > 0 && (
          <div className="mf-duration">{formatDuration(video.duration_seconds)}</div>
        )}
      </div>
      <div className="mf-video-meta">
        <div className="mf-video-avatar">
          {(video.title[0] ?? 'M').toUpperCase()}
        </div>
        <div className="mf-video-info">
          <div className="mf-video-title">{video.title}</div>
          <div className="mf-video-channel">{video.channel_id.slice(0, 12)}...</div>
          <div className="mf-video-stats">
            {formatViews(video.view_count)} · {timeAgo(video.created_at)}
          </div>
        </div>
      </div>
    </div>
  );
}
