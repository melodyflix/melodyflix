// melodyflix videos - user preferences (autoplay, quality, theme, etc.)
import { getDb } from '@melodyflix/shared-db';

export interface Preferences {
  user_id: string;
  autoplay_next: number;
  autoplay_playlist: number;
  default_quality: string;
  default_speed: number;
  theme: string;
  language: string;
  reduced_motion: number;
  captions_on: number;
  updated_at: string;
}

export function ensurePreferencesSchema(): void {
  const db = getDb();
  db.exec(
    'CREATE TABLE IF NOT EXISTS user_preferences (' +
    '  user_id TEXT PRIMARY KEY,' +
    '  autoplay_next INTEGER NOT NULL DEFAULT 1,' +
    '  autoplay_playlist INTEGER NOT NULL DEFAULT 1,' +
    '  default_quality TEXT NOT NULL DEFAULT "auto",' +
    '  default_speed REAL NOT NULL DEFAULT 1.0,' +
    '  theme TEXT NOT NULL DEFAULT "system",' +
    '  language TEXT NOT NULL DEFAULT "en",' +
    '  reduced_motion INTEGER NOT NULL DEFAULT 0,' +
    '  captions_on INTEGER NOT NULL DEFAULT 0,' +
    '  updated_at TEXT NOT NULL' +
    ');'
  );
}

const DEFAULT_PREFS = {
  autoplay_next: 1,
  autoplay_playlist: 1,
  default_quality: 'auto',
  default_speed: 1.0,
  theme: 'system',
  language: 'en',
  reduced_motion: 0,
  captions_on: 0,
};

export function getPreferences(userId: string): Preferences {
  const db = getDb();
  const row = db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(userId) as Preferences | undefined;
  if (row) return row;
  // Return defaults without inserting
  return {
    user_id: userId,
    ...DEFAULT_PREFS,
    updated_at: new Date().toISOString(),
  } as Preferences;
}

export function updatePreferences(userId: string, patch: Partial<Omit<Preferences, 'user_id' | 'updated_at'>>): Preferences {
  const db = getDb();
  const current = getPreferences(userId);
  const merged = { ...current, ...patch };
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT user_id FROM user_preferences WHERE user_id = ?').get(userId);
  if (existing) {
    db.prepare(
      'UPDATE user_preferences SET autoplay_next = ?, autoplay_playlist = ?, default_quality = ?, default_speed = ?, theme = ?, language = ?, reduced_motion = ?, captions_on = ?, updated_at = ? WHERE user_id = ?'
    ).run(
      merged.autoplay_next, merged.autoplay_playlist, merged.default_quality, merged.default_speed,
      merged.theme, merged.language, merged.reduced_motion, merged.captions_on, now, userId
    );
  } else {
    db.prepare(
      'INSERT INTO user_preferences (user_id, autoplay_next, autoplay_playlist, default_quality, default_speed, theme, language, reduced_motion, captions_on, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      userId, merged.autoplay_next, merged.autoplay_playlist, merged.default_quality, merged.default_speed,
      merged.theme, merged.language, merged.reduced_motion, merged.captions_on, now
    );
  }
  return getPreferences(userId);
}

export function resetPreferences(userId: string): Preferences {
  const db = getDb();
  db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);
  return getPreferences(userId);
}
