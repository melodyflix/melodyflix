// melodyflix notifications - listens to platform events
import { subscribe, CHANNELS } from '@melodyflix/shared-events';
import { createLogger } from '@melodyflix/shared-logger';
import { createNotification } from './notification.service.js';

const logger = createLogger('listener');

// ============= Event payload types =============
interface UserCreatedEvent {
  userId: string;
  username: string;
  email: string;
}

interface VideoUploadedEvent {
  videoId: string;
  channelId: string;
  ownerId: string;
  title: string;
}

interface CommentPostedEvent {
  commentId: string;
  videoId: string;
  videoOwnerId: string;
  channelId: string;
  commenterId: string;
  commenterUsername: string;
  parentId: string | null;
  content: string;
  // for replies
  parentCommentAuthorId?: string;
}

interface VideoLikedEvent {
  videoId: string;
  videoOwnerId: string;
  likerId: string;
  likerUsername: string;
  type: 'like' | 'dislike' | 'none';
  videoTitle: string;
}

interface ChannelFollowedEvent {
  channelId: string;
  channelOwnerId: string;
  followerId: string;
  followerUsername: string;
  channelName: string;
}

interface VideoTranscodedEvent {
  videoId: string;
  channelId: string;
  ownerId: string;
  status: 'ready' | 'failed';
  title: string;
}

// ============= Event handlers =============
export function startListeners(): void {
  // Welcome notification on signup
  subscribe<UserCreatedEvent>('user.created', (event) => {
    logger.info({ userId: event.userId }, 'user.created received');
    createNotification({
      user_id: event.userId,
      type: 'system',
      title: 'Welcome to melodyflix! 🎬',
      body: 'Create your channel and start uploading videos.',
      link: '/channel/new',
    });
  });

  // Notify subscribers when a new video is uploaded
  // (Note: subscribers list comes from the channel service — for now notify channel owner only)
  subscribe<VideoUploadedEvent>('video.uploaded', (event) => {
    logger.info({ videoId: event.videoId }, 'video.uploaded received');
    createNotification({
      user_id: event.ownerId,
      type: 'video_uploaded',
      title: 'Video uploaded successfully',
      body: `Your video "${event.title}" is being processed.`,
      link: `/watch/${event.videoId}`,
      target_id: event.videoId,
    });
  });

  // Notify owner when video is ready
  subscribe<VideoTranscodedEvent>('video.transcoded', (event) => {
    logger.info({ videoId: event.videoId, status: event.status }, 'video.transcoded received');
    if (event.status === 'ready') {
      createNotification({
        user_id: event.ownerId,
        type: 'video_uploaded',
        title: 'Your video is ready to watch ✅',
        body: `"${event.title}" is now available.`,
        link: `/watch/${event.videoId}`,
        target_id: event.videoId,
      });
    } else {
      createNotification({
        user_id: event.ownerId,
        type: 'system',
        title: 'Video processing failed',
        body: `"${event.title}" could not be processed.`,
        link: `/watch/${event.videoId}`,
        target_id: event.videoId,
      });
    }
  });

  // Notify video owner when someone comments
  subscribe<CommentPostedEvent>('comment.posted', (event) => {
    logger.info({ commentId: event.commentId }, 'comment.posted received');

    // If it's a reply to a comment, notify the parent comment author
    if (event.parentId && event.parentCommentAuthorId && event.parentCommentAuthorId !== event.commenterId) {
      createNotification({
        user_id: event.parentCommentAuthorId,
        type: 'reply_to_comment',
        title: `${event.commenterUsername} replied to your comment`,
        body: event.content.slice(0, 120),
        link: `/watch/${event.videoId}`,
        actor_id: event.commenterId,
        target_id: event.commentId,
      });
    }

    // Notify video owner (if not self)
    if (event.videoOwnerId !== event.commenterId && !event.parentId) {
      createNotification({
        user_id: event.videoOwnerId,
        type: 'comment_on_video',
        title: `${event.commenterUsername} commented on your video`,
        body: event.content.slice(0, 120),
        link: `/watch/${event.videoId}`,
        actor_id: event.commenterId,
        target_id: event.commentId,
      });
    }
  });

  // Notify video owner on like (only like, not dislike or none)
  subscribe<VideoLikedEvent>('video.liked', (event) => {
    if (event.type !== 'like' || event.videoOwnerId === event.likerId) return;
    logger.info({ videoId: event.videoId }, 'video.liked received');
    createNotification({
      user_id: event.videoOwnerId,
      type: 'video_like',
      title: `${event.likerUsername} liked your video`,
      body: event.videoTitle,
      link: `/watch/${event.videoId}`,
      actor_id: event.likerId,
      target_id: event.videoId,
    });
  });

  // Notify channel owner when someone subscribes
  subscribe<ChannelFollowedEvent>('channel.followed', (event) => {
    if (event.channelOwnerId === event.followerId) return;
    logger.info({ channelId: event.channelId }, 'channel.followed received');
    createNotification({
      user_id: event.channelOwnerId,
      type: 'new_subscriber',
      title: `${event.followerUsername} subscribed to ${event.channelName}`,
      link: `/channel/${event.channelId}`,
      actor_id: event.followerId,
      target_id: event.channelId,
    });
  });

  logger.info('all event listeners started');
}
