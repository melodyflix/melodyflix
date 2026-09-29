// melodyflix videos - models
export type VideoStatus = 'uploading' | 'processing' | 'ready' | 'failed';
export type VideoVisibility = 'public' | 'unlisted' | 'private';

export const VIDEO_CATEGORIES = [
  'music',
  'gaming',
  'education',
  'technology',
  'entertainment',
  'sports',
  'news',
  'comedy',
  'film',
  'vlog',
  'other',
] as const;

export type VideoCategory = typeof VIDEO_CATEGORIES[number];

export interface Video {
  id: string;
  channel_id: string;
  owner_id: string;
  title: string;
  description: string | null;
  visibility: VideoVisibility;
  status: VideoStatus;
  category: string;
  duration_seconds: number;
  file_size_bytes: number;
  original_filename: string | null;
  hls_master_url: string | null;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number;
  dislike_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateVideoInput {
  title: string;
  description?: string;
  visibility?: VideoVisibility;
  category?: string;
}
