// melodyflix live - models
export type StreamStatus = 'idle' | 'connecting' | 'live' | 'ended';
export type StreamSource = 'camera' | 'rtmp';

export interface LiveStream {
  id: string;
  user_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  stream_key: string;
  category: string;
  status: StreamStatus;
  source: StreamSource;
  hls_url: string | null;
  viewer_count: number;
  peak_viewers: number;
  total_views: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LiveChat {
  id: string;
  stream_id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
}

export interface LiveViewer {
  id: string;
  stream_id: string;
  user_id: string | null;
  ip: string | null;
  joined_at: string;
  left_at: string | null;
}
