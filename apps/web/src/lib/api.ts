// melodyflix web - API client
const TOKEN_KEY = 'melodyflix_token';
const USER_KEY = 'melodyflix_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuth(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCachedUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Always send JSON content-type + at least {} body for POST/PATCH/PUT
  const method = (options.method ?? 'GET').toUpperCase();
  let body = options.body;
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    headers['Content-Type'] = 'application/json';
    if (body === undefined || body === null) body = '{}';
  }

  const res = await fetch(url, { ...options, method, headers, body });

  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok || (data && data.success === false)) {
    throw new Error((data && data.error) || `HTTP ${res.status}`);
  }
  return data?.data ?? data;
}

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  role: string;
  created_at: string;
}

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
}

export interface Video {
  id: string;
  channel_id: string;
  owner_id: string;
  title: string;
  description: string | null;
  visibility: string;
  status: string;
  duration_seconds: number;
  file_size_bytes: number;
  hls_master_url: string | null;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number;
  dislike_count: number;
  user_reaction?: 'like' | 'dislike' | null;
  created_at: string;
}

export interface VideosListResponse {
  videos: Video[];
  total: number;
}

export const api = {
  // auth
  login: (email: string, password: string) =>
    request<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  signup: (email: string, username: string, password: string, displayName?: string) =>
    request<User>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, username, password, displayName }),
    }),
  me: () => request<User>('/api/auth/me'),

  // videos
  listVideos: (limit = 50, offset = 0) =>
    request<VideosListResponse>(`/api/v1/videos?limit=${limit}&offset=${offset}`),
  getVideo: (id: string) =>
    request<Video>(`/api/v1/videos/${id}`),

  // channels
  getChannel: (id: string) =>
    request<Channel>(`/api/channels/${id}`),
  getChannelByHandle: (handle: string) =>
    request<Channel>(`/api/channels/handle/${handle}`),
  getMyChannel: () =>
    request<Channel>('/api/channels/me'),
  listChannels: (limit = 50, offset = 0) =>
    request<Channel[]>(`/api/channels?limit=${limit}&offset=${offset}`),
  createChannel: (name: string, handle: string, description?: string) =>
    request<Channel>('/api/channels', {
      method: 'POST',
      body: JSON.stringify({ name, handle, description }),
    }),
  updateChannel: (id: string, updates: { name?: string; description?: string; avatar_url?: string; banner_url?: string }) =>
    request<Channel>(`/api/channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }),
};

export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}:${sec.toString().padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${mm.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export function formatViews(n: number): string {
  if (n < 1000) return `${n} views`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K views`;
  return `${(n / 1_000_000).toFixed(1)}M views`;
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
  return `${Math.floor(diff / 31536000)} years ago`;
}

// reactions & views
export interface LikeResult {
  likeCount: number;
  dislikeCount: number;
  userReaction: 'like' | 'dislike' | null;
}

export async function likeVideo(id: string, type: 'like' | 'dislike' | 'none'): Promise<LikeResult> {
  return request<LikeResult>(`/api/v1/videos/${id}/reaction`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
}

export async function recordView(id: string): Promise<{ view_count: number }> {
  return request<{ view_count: number }>(`/api/v1/videos/${id}/view`, {
    method: 'POST',
  });
}

export async function followChannel(channelId: string): Promise<{ following: boolean; subscriberCount: number }> {
  return request<{ following: boolean; subscriberCount: number }>(`/api/channels/${channelId}/follow`, {
    method: 'POST',
  });
}

export async function unfollowChannel(channelId: string): Promise<{ following: boolean; subscriberCount: number }> {
  return request<{ following: boolean; subscriberCount: number }>(`/api/channels/${channelId}/follow`, {
    method: 'DELETE',
  });
}

export async function isFollowing(channelId: string): Promise<{ following: boolean }> {
  return request<{ following: boolean }>(`/api/channels/${channelId}/following`);
}

// upload video (multipart with progress)
export function uploadVideo(
  file: File,
  meta: { title: string; description?: string; channelId: string; visibility?: string },
  onProgress?: (pct: number) => void
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('title', meta.title);
    if (meta.description) form.append('description', meta.description);
    form.append('channelId', meta.channelId);
    form.append('visibility', meta.visibility ?? 'public');
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'http://127.0.0.1:4003/api/v1/videos/upload');
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) resolve(data.data);
        else reject(new Error(data.error || `HTTP ${xhr.status}`));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
}

// ============ Comments ============
export interface Comment {
  id: string;
  video_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  like_count: number;
  reply_count: number;
  is_edited: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
  user_reaction?: boolean;
  user?: CommentUser;
  replies?: Comment[];
}

export interface CommentsResponse {
  comments: Comment[];
  total: number;
}

export async function listComments(videoId: string): Promise<CommentsResponse> {
  return request<CommentsResponse>(`/api/v1/videos/${videoId}/comments`);
}

export async function createComment(videoId: string, content: string, parentId?: string | null): Promise<Comment> {
  return request<Comment>(`/api/v1/videos/${videoId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ content, parentId: parentId ?? null }),
  });
}

export async function updateComment(commentId: string, content: string): Promise<Comment> {
  return request<Comment>(`/api/v1/videos/comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export async function deleteComment(commentId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/comments/${commentId}`, { method: 'DELETE' });
}

export async function likeComment(commentId: string): Promise<{ liked: boolean; likeCount: number }> {
  return request<{ liked: boolean; likeCount: number }>(`/api/v1/videos/comments/${commentId}/like`, {
    method: 'POST',
  });
}

export async function reportComment(commentId: string, reason: string, note?: string): Promise<{ reported: boolean }> {
  return request<{ reported: boolean }>(`/api/v1/videos/comments/${commentId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, note }),
  });
}

// ============ Save video ============
export async function toggleSaveVideo(videoId: string): Promise<{ saved: boolean }> {
  return request<{ saved: boolean }>(`/api/v1/videos/${videoId}/save`, { method: 'POST' });
}

export async function isVideoSaved(videoId: string): Promise<{ saved: boolean }> {
  return request<{ saved: boolean }>(`/api/v1/videos/${videoId}/saved`);
}

// (Comment user info from batch lookup)
export interface CommentUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

// Watch Later
export async function listWatchLater(): Promise<{ videos: Video[]; total: number }> {
  return request<{ videos: Video[]; total: number }>('/api/v1/videos/watch-later/list');
}

// Subscriptions (my following channels)
export async function listMySubscriptions(): Promise<{ channels: Channel[]; total: number }> {
  return request<{ channels: Channel[]; total: number }>('/api/channels/me/following');
}

// ============ Notifications ============
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

export interface NotificationsResponse {
  notifications: Notification[];
  unread: number;
}

export async function listNotifications(limit = 20, offset = 0): Promise<NotificationsResponse> {
  return request<NotificationsResponse>(`/api/notifications?limit=${limit}&offset=${offset}`);
}

export async function getUnreadCount(): Promise<{ count: number }> {
  return request<{ count: number }>('/api/notifications/unread-count');
}

export async function markNotificationRead(id: string): Promise<{ read: boolean }> {
  return request<{ read: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<{ marked: number }> {
  return request<{ marked: number }>('/api/notifications/read-all', { method: 'POST' });
}

export async function deleteNotification(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/notifications/${id}`, { method: 'DELETE' });
}

export async function clearAllNotifications(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/api/notifications', { method: 'DELETE' });
}

// ============ Search ============
export type SearchSort = 'relevance' | 'date' | 'views';
export type DurationFilter = 'any' | 'short' | 'medium' | 'long';

export interface SearchResponse {
  videos: Video[];
  total: number;
  query: string;
  sort: SearchSort;
  duration: DurationFilter;
}

export async function searchVideos(params: {
  q: string;
  sort?: SearchSort;
  channel?: string;
  duration?: DurationFilter;
  limit?: number;
  offset?: number;
}): Promise<SearchResponse> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.sort) sp.set('sort', params.sort);
  if (params.channel) sp.set('channel', params.channel);
  if (params.duration && params.duration !== 'any') sp.set('duration', params.duration);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  return request<SearchResponse>(`/api/v1/videos/search?${sp.toString()}`);
}

// ============ History ============
export interface HistoryVideo extends Video {
  watched_at: string;
  resume_position: number;
}

export interface HistoryResponse {
  videos: HistoryVideo[];
  total: number;
}

export async function listHistory(limit = 100, offset = 0): Promise<HistoryResponse> {
  return request<HistoryResponse>(`/api/v1/videos/history/list?limit=${limit}&offset=${offset}`);
}

export async function recordHistory(videoId: string, position: number): Promise<{ recorded: boolean }> {
  return request<{ recorded: boolean }>(`/api/v1/videos/${videoId}/history`, {
    method: 'POST',
    body: JSON.stringify({ position }),
  });
}

export async function getResumePosition(videoId: string): Promise<{ position: number }> {
  return request<{ position: number }>(`/api/v1/videos/${videoId}/resume`);
}

export async function removeHistory(videoId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/${videoId}/history`, { method: 'DELETE' });
}

export async function clearHistory(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/api/v1/videos/history/all', { method: 'DELETE' });
}

// ============ Playlists ============
export interface Playlist {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  visibility: string;
  video_count: number;
  created_at: string;
  updated_at: string;
}

export interface PlaylistItem extends Video {
  position: number;
  item_added_at: string;
}

export interface PlaylistDetailResponse {
  playlist: Playlist;
  items: PlaylistItem[];
  total: number;
  is_owner: boolean;
}

export async function listPlaylists(): Promise<{ playlists: Playlist[] }> {
  return request<{ playlists: Playlist[] }>('/api/v1/videos/playlists');
}

export async function createPlaylist(name: string, description?: string, visibility?: string): Promise<Playlist> {
  return request<Playlist>('/api/v1/videos/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description, visibility }),
  });
}

export async function getPlaylist(id: string): Promise<PlaylistDetailResponse> {
  return request<PlaylistDetailResponse>(`/api/v1/videos/playlists/${id}`);
}

export async function updatePlaylist(id: string, updates: { name?: string; description?: string; visibility?: string }): Promise<Playlist> {
  return request<Playlist>(`/api/v1/videos/playlists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deletePlaylist(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/playlists/${id}`, { method: 'DELETE' });
}

export async function addToPlaylist(playlistId: string, videoId: string): Promise<{ added: boolean; videoCount: number }> {
  return request<{ added: boolean; videoCount: number }>(`/api/v1/videos/playlists/${playlistId}/items`, {
    method: 'POST',
    body: JSON.stringify({ videoId }),
  });
}

export async function removeFromPlaylist(playlistId: string, videoId: string): Promise<{ removed: boolean; videoCount: number }> {
  return request<{ removed: boolean; videoCount: number }>(`/api/v1/videos/playlists/${playlistId}/items/${videoId}`, {
    method: 'DELETE',
  });
}

export async function listPlaylistsContainingVideo(videoId: string): Promise<{ playlists: Playlist[] }> {
  return request<{ playlists: Playlist[] }>(`/api/v1/videos/${videoId}/playlists`);
}

// ============ Video Edit/Delete ============
export async function updateVideo(id: string, updates: {
  title?: string;
  description?: string;
  visibility?: 'public' | 'unlisted' | 'private';
}): Promise<Video> {
  return request<Video>(`/api/v1/videos/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteVideo(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/${id}`, { method: 'DELETE' });
}

export async function listMyVideos(): Promise<{ videos: Video[]; total: number }> {
  return request<{ videos: Video[]; total: number }>('/api/v1/videos/my/list');
}

// ============ Channel Avatar/Banner Upload ============
export function uploadChannelAvatar(channelId: string, file: File): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `http://127.0.0.1:4002/api/v1/channels/${channelId}/avatar`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) resolve(data.data);
        else reject(new Error(data.error || `HTTP ${xhr.status}`));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
}

export function uploadChannelBanner(channelId: string, file: File): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `http://127.0.0.1:4002/api/v1/channels/${channelId}/banner`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.success) resolve(data.data);
        else reject(new Error(data.error || `HTTP ${xhr.status}`));
      } catch (e) {
        reject(e);
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  });
}

// ============ Trending & Categories ============
export interface CategoryStat {
  category: string;
  video_count: number;
  total_views: number;
}

export async function listTrending(limit = 50, offset = 0, days = 7): Promise<{ videos: Video[]; total: number; days: number }> {
  return request<{ videos: Video[]; total: number; days: number }>(
    `/api/v1/videos/trending?limit=${limit}&offset=${offset}&days=${days}`
  );
}

export async function listCategories(): Promise<{ categories: CategoryStat[] }> {
  return request<{ categories: CategoryStat[] }>('/api/v1/videos/categories');
}

export async function listVideosByCategory(category: string, limit = 50, offset = 0): Promise<{ videos: Video[]; total: number; category: string }> {
  return request<{ videos: Video[]; total: number; category: string }>(
    `/api/v1/videos/category/${category}?limit=${limit}&offset=${offset}`
  );
}

export const VIDEO_CATEGORIES = [
  'music', 'gaming', 'education', 'technology', 'entertainment',
  'sports', 'news', 'comedy', 'film', 'vlog', 'other',
] as const;

export type VideoCategory = typeof VIDEO_CATEGORIES[number];

// ============ Live Streaming ============
export interface LiveStream {
  id: string;
  user_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  stream_key: string;
  category: string;
  status: 'idle' | 'connecting' | 'live' | 'ended';
  source: 'camera' | 'rtmp';
  hls_url: string | null;
  viewer_count: number;
  peak_viewers: number;
  total_views: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  is_live?: boolean;
}

export interface LiveChat {
  id: string;
  stream_id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
}

export async function listLiveStreams(limit = 50, offset = 0): Promise<{ streams: LiveStream[]; total: number }> {
  return request<{ streams: LiveStream[]; total: number }>(`/api/v1/live/streams?limit=${limit}&offset=${offset}`);
}

export async function getLiveStream(id: string): Promise<LiveStream> {
  return request<LiveStream>(`/api/v1/live/${id}`);
}

export async function getMyActiveStream(): Promise<LiveStream> {
  return request<LiveStream>('/api/v1/live/me/active');
}

export async function listMyStreams(): Promise<{ streams: LiveStream[] }> {
  return request<{ streams: LiveStream[] }>('/api/v1/live/me');
}

export async function createLiveStream(channelId: string, title: string, description?: string, category?: string): Promise<LiveStream> {
  return request<LiveStream>('/api/v1/live/streams', {
    method: 'POST',
    body: JSON.stringify({ channel_id: channelId, title, description, category }),
  });
}

export async function updateLiveStream(id: string, updates: { title?: string; description?: string; category?: string }): Promise<LiveStream> {
  return request<LiveStream>(`/api/v1/live/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteLiveStream(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/live/${id}`, { method: 'DELETE' });
}

export async function listLiveChat(streamId: string, limit = 100, since?: string): Promise<{ chat: LiveChat[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (since) params.set('since', since);
  return request<{ chat: LiveChat[] }>(`/api/v1/live/${streamId}/chat?${params}`);
}

export async function postLiveChat(streamId: string, content: string): Promise<LiveChat> {
  return request<LiveChat>(`/api/v1/live/${streamId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

// WebSocket URLs — uses current host
export function liveBroadcastWsUrl(streamKey: string, token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // When served via nginx on 5174, proxy needs /ws → live service
  return `${proto}://${window.location.host}/ws-live/broadcast?key=${encodeURIComponent(streamKey)}&token=${encodeURIComponent(token)}`;
}

export function liveViewerWsUrl(streamId: string, token?: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const t = token ? `&token=${encodeURIComponent(token)}` : '';
  return `${proto}://${window.location.host}/ws-live/viewer?streamId=${encodeURIComponent(streamId)}${t}`;
}

// ============ Community Posts ============
export interface CommunityPost {
  id: string;
  channel_id: string;
  content: string;
  like_count: number;
  comment_count: number;
  created_at: string;
  updated_at: string;
  user_reaction?: boolean;
}

export interface CommunityPostsResponse {
  posts: CommunityPost[];
  total: number;
}

export async function listChannelPosts(channelId: string, limit = 20, offset = 0): Promise<CommunityPostsResponse> {
  return request<CommunityPostsResponse>(`/api/channels/${channelId}/posts?limit=${limit}&offset=${offset}`);
}

export async function createCommunityPost(channelId: string, content: string): Promise<CommunityPost> {
  return request<CommunityPost>(`/api/channels/${channelId}/posts`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function updateCommunityPost(postId: string, content: string): Promise<CommunityPost> {
  return request<CommunityPost>(`/api/channels/posts/${postId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

export async function deleteCommunityPost(postId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/channels/posts/${postId}`, { method: 'DELETE' });
}

export async function toggleCommunityPostLike(postId: string): Promise<{ liked: boolean; likeCount: number }> {
  return request<{ liked: boolean; likeCount: number }>(`/api/channels/posts/${postId}/like`, {
    method: 'POST',
  });
}

export async function getMyChannelPosts(): Promise<{ posts: CommunityPost[]; total: number; channel: Channel | null }> {
  return request<{ posts: CommunityPost[]; total: number; channel: Channel | null }>('/api/channels/me/posts/own');
}
