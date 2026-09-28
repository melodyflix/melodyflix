// melodyflix channel - models
export interface Channel {
  id: string;
  owner_id: string;
  name: string;
  handle: string;
  description: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  subscriber_count: number;
  video_count: number;
  is_verified: number;
  created_at: string;
  updated_at: string;
}

export interface Follow {
  id: string;
  user_id: string;
  channel_id: string;
  created_at: string;
}

export interface CreateChannelInput {
  name: string;
  handle: string;
  description?: string;
}
