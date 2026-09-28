-- melodyflix channel service schema
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  description TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  video_count INTEGER NOT NULL DEFAULT 0,
  is_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_channels_handle ON channels(handle);
CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_id);

CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_channel ON follows(channel_id);
