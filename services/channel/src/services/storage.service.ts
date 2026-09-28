// melodyflix channel - local storage for avatars and banners
import { mkdirSync, existsSync, createReadStream } from 'node:fs';
import { join } from 'node:path';

const DATA_ROOT = process.env.CHANNEL_DATA_ROOT ?? '/root/melodyflix/data/channels';

export function ensureChannelStorage(): void {
  mkdirSync(DATA_ROOT, { recursive: true });
  mkdirSync(join(DATA_ROOT, 'avatars'), { recursive: true });
  mkdirSync(join(DATA_ROOT, 'banners'), { recursive: true });
}

export function avatarPath(channelId: string): string {
  return join(DATA_ROOT, 'avatars', `${channelId}.jpg`);
}

export function bannerPath(channelId: string): string {
  return join(DATA_ROOT, 'banners', `${channelId}.jpg`);
}

export function avatarExists(channelId: string): boolean {
  return existsSync(avatarPath(channelId));
}

export function bannerExists(channelId: string): boolean {
  return existsSync(bannerPath(channelId));
}

export function readAvatar(channelId: string) {
  return createReadStream(avatarPath(channelId));
}

export function readBanner(channelId: string) {
  return createReadStream(bannerPath(channelId));
}
