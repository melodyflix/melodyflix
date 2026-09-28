// melodyflix notifications - models
export type NotificationType =
  | 'comment_on_video'
  | 'reply_to_comment'
  | 'video_like'
  | 'new_subscriber'
  | 'video_uploaded'
  | 'system';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  actor_id: string | null;
  target_id: string | null;
  is_read: number;
  created_at: string;
}

export interface CreateNotificationInput {
  user_id: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  actor_id?: string;
  target_id?: string;
}
