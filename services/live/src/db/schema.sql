-- melodyflix live service schema

CREATE TABLE IF NOT EXISTS live_streams (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  stream_key TEXT NOT NULL UNIQUE,
  category TEXT DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'idle',
  source TEXT NOT NULL DEFAULT 'camera',
  hls_url TEXT,
  viewer_count INTEGER NOT NULL DEFAULT 0,
  peak_viewers INTEGER NOT NULL DEFAULT 0,
  total_views INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_live_user ON live_streams(user_id);
CREATE INDEX IF NOT EXISTS idx_live_channel ON live_streams(channel_id);
CREATE INDEX IF NOT EXISTS idx_live_status ON live_streams(status);
CREATE INDEX IF NOT EXISTS idx_live_key ON live_streams(stream_key);

CREATE TABLE IF NOT EXISTS live_chat (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_stream ON live_chat(stream_id);
CREATE INDEX IF NOT EXISTS idx_chat_created ON live_chat(created_at);

CREATE TABLE IF NOT EXISTS live_viewers (
  id TEXT PRIMARY KEY,
  stream_id TEXT NOT NULL,
  user_id TEXT,
  ip TEXT,
  joined_at TEXT NOT NULL,
  left_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_viewers_stream ON live_viewers(stream_id);
