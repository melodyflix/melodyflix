// melodyflix videos - local storage helper
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_ROOT = process.env.VIDEO_DATA_ROOT ?? '/root/melodyflix/data/videos';

export function ensureStorage(): void {
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(join(DATA_ROOT, 'uploads'), { recursive: true });
  mkdirSync(join(DATA_ROOT, 'processed'), { recursive: true });
  mkdirSync(join(DATA_ROOT, 'thumbnails'), { recursive: true });
}

export function uploadsDir(): string {
  return join(DATA_ROOT, 'uploads');
}

export function processedDir(videoId: string): string {
  const dir = join(DATA_ROOT, 'processed', videoId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function thumbnailsDir(): string {
  return join(DATA_ROOT, 'thumbnails');
}

export function dataRoot(): string {
  return DATA_ROOT;
}
