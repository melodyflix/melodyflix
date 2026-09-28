-- melodyflix videos service schema
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT 'uploading',
  duration_seconds REAL DEFAULT 0,
  file_size_bytes INTEGER DEFAULT 0,
  original_filename TEXT,
  hls_master_url TEXT,
  thumbnail_url TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  dislike_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);

CREATE TABLE IF NOT EXISTS video_likes (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('like', 'dislike')),
  created_at TEXT NOT NULL,
  UNIQUE (video_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_video_likes_video ON video_likes(video_id);
CREATE INDEX IF NOT EXISTS idx_video_likes_user ON video_likes(user_id);

CREATE TABLE IF NOT EXISTS video_views (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  user_id TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_video_views_video ON video_views(video_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  parent_id TEXT,
  content TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  is_edited INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);

CREATE TABLE IF NOT EXISTS comment_likes (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON comment_likes(comment_id);

CREATE TABLE IF NOT EXISTS comment_reports (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comment_reports_comment ON comment_reports(comment_id);

CREATE TABLE IF NOT EXISTS saved_videos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_videos_user ON saved_videos(user_id);
