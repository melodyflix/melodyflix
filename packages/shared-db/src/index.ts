// melodyflix shared db - uses Node.js 22 built-in node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from '@melodyflix/shared-config';

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const config = loadConfig();

  if (config.DB_TYPE !== 'sqlite') {
    throw new Error('Only sqlite enabled. Set DB_TYPE=sqlite');
  }

  mkdirSync(dirname(config.DB_PATH), { recursive: true });
  db = new DatabaseSync(config.DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// Run migration SQL
export function migrate(sql: string): void {
  getDb().exec(sql);
}
