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
  meta: { title: string; description?: string; channelId: string; visibility?: string; contentType?: string },
  onProgress?: (pct: number) => void
): Promise<Video> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('title', meta.title);
    if (meta.description) form.append('description', meta.description);
    form.append('channelId', meta.channelId);
    form.append('visibility', meta.visibility ?? 'public');
    if (meta.contentType) form.append('contentType', meta.contentType);
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
  is_pinned: number;
  creator_heart: number;
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

// ============ Advanced Comments (pagination + pin + heart) ============
export type CommentSort = 'top' | 'newest' | 'oldest';

export interface CommentsPage {
  comments: Comment[];
  total: number;
  has_more: boolean;
  next_offset: number;
}

export async function listCommentsPaginated(
  videoId: string,
  sort: CommentSort = 'top',
  limit = 20,
  offset = 0,
): Promise<CommentsPage> {
  const qs = new URLSearchParams({ sort, limit: String(limit), offset: String(offset) });
  return request<CommentsPage>(`/api/v1/videos/${videoId}/comments/paginated?${qs.toString()}`);
}

export async function pinComment(commentId: string): Promise<{ ok: boolean; pinned: boolean }> {
  return request<{ ok: boolean; pinned: boolean }>(`/api/v1/videos/comments/${commentId}/pin`, {
    method: 'POST',
  });
}

export async function unpinComment(commentId: string): Promise<{ ok: boolean; pinned: boolean }> {
  return request<{ ok: boolean; pinned: boolean }>(`/api/v1/videos/comments/${commentId}/unpin`, {
    method: 'POST',
  });
}

export async function toggleCreatorHeart(commentId: string): Promise<{ ok: boolean; heart: boolean }> {
  return request<{ ok: boolean; heart: boolean }>(`/api/v1/videos/comments/${commentId}/heart`, {
    method: 'POST',
  });
}











// ============ AI Auto-Tagging (46.1) ============
export interface AutoTagSuggestion {
  tag: string;
  score: number;
  source: 'title' | 'body' | 'phrase';
}

export async function suggestAutoTags(videoId: string, max = 10): Promise<{ suggestions: AutoTagSuggestion[] }> {
  return request<{ suggestions: AutoTagSuggestion[] }>(
    `/api/v1/videos/${videoId}/tags/auto-suggest?max=${max}`,
  );
}

export async function applyAutoTags(videoId: string): Promise<{ added: VideoTag[] }> {
  return request<{ added: VideoTag[] }>(`/api/v1/videos/${videoId}/tags/auto-apply`, {
    method: 'POST',
  });
}

export async function clearAutoTags(videoId: string): Promise<{ removed: number }> {
  return request<{ removed: number }>(`/api/v1/videos/${videoId}/tags/auto`, {
    method: 'DELETE',
  });
}

// ============ Video Cast & Crew ============
export const CREW_ROLES = [
  { id: 'actor', label: 'Actor', emoji: '🎭', isCast: true },
  { id: 'director', label: 'Director', emoji: '🎬', isCast: false },
  { id: 'producer', label: 'Producer', emoji: '💼', isCast: false },
  { id: 'writer', label: 'Writer', emoji: '✍️', isCast: false },
  { id: 'composer', label: 'Composer', emoji: '🎵', isCast: false },
  { id: 'cinematographer', label: 'Cinematographer', emoji: '📷', isCast: false },
  { id: 'editor', label: 'Editor', emoji: '✂️', isCast: false },
  { id: 'animator', label: 'Animator', emoji: '🎨', isCast: false },
  { id: 'voice_actor', label: 'Voice Actor', emoji: '🎙️', isCast: true },
  { id: 'presenter', label: 'Presenter', emoji: '📢', isCast: true },
  { id: 'researcher', label: 'Researcher', emoji: '🔍', isCast: false },
  { id: 'other', label: 'Other', emoji: '👤', isCast: false },
] as const;

export interface Person {
  id: string;
  video_id: string;
  name: string;
  role: string;
  character_name: string | null;
  order_index: number;
  created_at: string;
}

export interface PersonInput {
  name: string;
  role: string;
  character_name?: string | null;
}

export interface VideoCredits {
  id: string;
  title: string;
  thumbnail_url: string | null;
  role: string;
  character_name: string | null;
  created_at: string;
}

export function roleLabel(id: string): string {
  const r = CREW_ROLES.find((x) => x.id === id);
  return r?.label ?? id;
}

export function roleEmoji(id: string): string {
  const r = CREW_ROLES.find((x) => x.id === id);
  return r?.emoji ?? '👤';
}

export async function listVideoCredits(videoId: string): Promise<{ people: Person[] }> {
  return request<{ people: Person[] }>(`/api/v1/videos/${videoId}/credits`);
}

export async function replaceVideoCredits(videoId: string, people: PersonInput[]): Promise<{ people: Person[] }> {
  return request<{ people: Person[] }>(`/api/v1/videos/${videoId}/credits`, {
    method: 'PUT',
    body: JSON.stringify({ people }),
  });
}

export async function addVideoCredit(videoId: string, person: PersonInput): Promise<{ person: Person }> {
  return request<{ person: Person }>(`/api/v1/videos/${videoId}/credits`, {
    method: 'POST',
    body: JSON.stringify(person),
  });
}

export async function removeVideoCredit(videoId: string, personId: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/${videoId}/credits/${personId}`, {
    method: 'DELETE',
  });
}

export async function getVideosByPerson(name: string): Promise<{ name: string; videos: VideoCredits[] }> {
  return request<{ name: string; videos: VideoCredits[] }>(
    `/api/v1/videos/people/${encodeURIComponent(name)}/videos`,
  );
}

// ============ Video Genres ============
export const GENRE_LIST = [
  { id: 'action', label: 'Action' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'animation', label: 'Animation' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'crime', label: 'Crime' },
  { id: 'documentary', label: 'Documentary' },
  { id: 'drama', label: 'Drama' },
  { id: 'family', label: 'Family' },
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'history', label: 'History' },
  { id: 'horror', label: 'Horror' },
  { id: 'music', label: 'Music' },
  { id: 'mystery', label: 'Mystery' },
  { id: 'news', label: 'News' },
  { id: 'reality', label: 'Reality' },
  { id: 'romance', label: 'Romance' },
  { id: 'sci-fi', label: 'Sci-Fi' },
  { id: 'sport', label: 'Sport' },
  { id: 'thriller', label: 'Thriller' },
  { id: 'education', label: 'Education' },
] as const;

export interface VideoGenre {
  id: string;
  video_id: string;
  genre: string;
  created_at: string;
}

export interface GenreWithCount {
  genre: string;
  label: string;
  video_count: number;
}

export function genreLabel(id: string): string {
  const g = GENRE_LIST.find((x) => x.id === id);
  return g?.label ?? id;
}

export async function getGenresWithCounts(): Promise<{ genres: GenreWithCount[] }> {
  return request<{ genres: GenreWithCount[] }>('/api/v1/videos/genres');
}

export async function listVideoGenres(videoId: string): Promise<{ genres: VideoGenre[] }> {
  return request<{ genres: VideoGenre[] }>(`/api/v1/videos/${videoId}/genres`);
}

export async function replaceVideoGenres(videoId: string, genres: string[]): Promise<{ genres: VideoGenre[] }> {
  return request<{ genres: VideoGenre[] }>(`/api/v1/videos/${videoId}/genres`, {
    method: 'PUT',
    body: JSON.stringify({ genres }),
  });
}

export async function addVideoGenre(videoId: string, genre: string): Promise<{ genre: VideoGenre }> {
  return request<{ genre: VideoGenre }>(`/api/v1/videos/${videoId}/genres`, {
    method: 'POST',
    body: JSON.stringify({ genre }),
  });
}

export async function removeVideoGenre(videoId: string, genre: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/${videoId}/genres/${encodeURIComponent(genre)}`, {
    method: 'DELETE',
  });
}

export async function getVideosByGenre(genre: string, limit = 60): Promise<{ videos: any[] }> {
  return request<{ videos: any[] }>(`/api/v1/videos/genres/${encodeURIComponent(genre)}/videos?limit=${limit}`);
}














// ============ Distribution (31.1 - 31.4) ============
export type PlatformId = 'youtube' | 'facebook' | 'instagram' | 'twitter' | 'tiktok' | 'linkedin' | 'telegram';
export type JobStatus = 'pending' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface Platform {
  id: PlatformId;
  label: string;
  icon: string;
  supports_video: boolean;
  max_duration_seconds: number | null;
  max_file_size_mb: number | null;
}

export interface PlatformAccount {
  id: string;
  channel_id: string;
  platform: PlatformId;
  account_name: string | null;
  is_connected: number;
  created_at: string;
  updated_at: string;
}

export interface DistributionJob {
  id: string;
  video_id: string;
  channel_id: string;
  platform: PlatformId;
  status: JobStatus;
  title: string | null;
  description: string | null;
  tags: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  external_url: string | null;
  error: string | null;
  retry_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AutoShareRule {
  channel_id: string;
  share_on_publish: number;
  platforms: PlatformId[];
  auto_message: string | null;
  updated_at: string;
}

export interface SyndicationFeed {
  id: string;
  channel_id: string;
  slug: string;
  title: string;
  description: string | null;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

export async function getDistributionPlatforms(): Promise<{ platforms: Platform[] }> {
  return request<{ platforms: Platform[] }>('/api/v1/videos/distribution/platforms');
}

export async function listPlatformAccounts(channelId: string): Promise<{ accounts: PlatformAccount[] }> {
  return request<{ accounts: PlatformAccount[] }>(`/api/v1/videos/channels/${channelId}/platforms`);
}

export async function connectPlatform(channelId: string, platform: PlatformId, accountName: string, accessToken: string): Promise<{ account: PlatformAccount }> {
  return request<{ account: PlatformAccount }>(`/api/v1/videos/channels/${channelId}/platforms`, {
    method: 'POST',
    body: JSON.stringify({ platform, account_name: accountName, access_token: accessToken }),
  });
}

export async function disconnectPlatform(channelId: string, platform: PlatformId): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/channels/${channelId}/platforms/${platform}`, { method: 'DELETE' });
}

export async function listChannelJobs(channelId: string, limit = 100): Promise<{ jobs: DistributionJob[] }> {
  return request<{ jobs: DistributionJob[] }>(`/api/v1/videos/channels/${channelId}/distribution/jobs?limit=${limit}`);
}

export async function listVideoJobs(videoId: string): Promise<{ jobs: DistributionJob[] }> {
  return request<{ jobs: DistributionJob[] }>(`/api/v1/videos/videos/${videoId}/distribution/jobs`);
}

export async function createDistributionJob(channelId: string, input: {
  video_id: string;
  platform: PlatformId;
  title?: string;
  description?: string;
  tags?: string[];
  scheduled_at?: string | null;
}): Promise<{ job: DistributionJob }> {
  return request<{ job: DistributionJob }>(`/api/v1/videos/channels/${channelId}/distribution/jobs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function publishJobNow(jobId: string): Promise<{ job: DistributionJob }> {
  return request<{ job: DistributionJob }>(`/api/v1/videos/distribution/jobs/${jobId}/publish`, { method: 'POST' });
}

export async function cancelJob(jobId: string): Promise<{ job: DistributionJob }> {
  return request<{ job: DistributionJob }>(`/api/v1/videos/distribution/jobs/${jobId}/cancel`, { method: 'POST' });
}

export async function deleteJob(jobId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/distribution/jobs/${jobId}`, { method: 'DELETE' });
}

export async function getAutoShare(channelId: string): Promise<{ rule: AutoShareRule }> {
  return request<{ rule: AutoShareRule }>(`/api/v1/videos/channels/${channelId}/auto-share`);
}

export async function setAutoShare(channelId: string, patch: {
  share_on_publish?: boolean;
  platforms?: PlatformId[];
  auto_message?: string | null;
}): Promise<{ rule: AutoShareRule }> {
  return request<{ rule: AutoShareRule }>(`/api/v1/videos/channels/${channelId}/auto-share`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function triggerAutoShare(videoId: string): Promise<{ created: number }> {
  return request<{ created: number }>(`/api/v1/videos/videos/${videoId}/auto-share`, { method: 'POST' });
}

export async function getChannelFeed(channelId: string): Promise<{ feed: SyndicationFeed | null }> {
  return request<{ feed: SyndicationFeed | null }>(`/api/v1/videos/channels/${channelId}/feed`);
}

export async function createChannelFeed(channelId: string): Promise<{ feed: SyndicationFeed }> {
  return request<{ feed: SyndicationFeed }>(`/api/v1/videos/channels/${channelId}/feed`, { method: 'POST' });
}

export async function updateChannelFeed(channelId: string, patch: { is_enabled?: boolean; description?: string | null }): Promise<{ feed: SyndicationFeed | null }> {
  return request<{ feed: SyndicationFeed | null }>(`/api/v1/videos/channels/${channelId}/feed`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteChannelFeed(channelId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/channels/${channelId}/feed`, { method: 'DELETE' });
}

export function feedUrl(slug: string): string {
  return `/api/v1/videos/feeds/${slug}.xml`;
}

// ============ Lower Thirds + Transitions (30.6, 30.7) ============
export type LowerThirdPosition = 'left' | 'center' | 'right';
export type LowerThirdStyle = 'minimal' | 'solid' | 'glass' | 'accent' | 'bar';
export type LowerThirdAnimation = 'slide-up' | 'slide-left' | 'fade' | 'pop';
export type TransitionKind = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'zoom-in' | 'dissolve' | 'wipe' | 'glitch';

export interface LowerThird {
  id: string;
  channel_id: string;
  title: string;
  subtitle: string | null;
  accent_color: string;
  text_color: string;
  bg_color: string;
  position: LowerThirdPosition;
  style: LowerThirdStyle;
  animation: LowerThirdAnimation;
  start_seconds: number;
  end_seconds: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface LowerThirdInput {
  title: string;
  subtitle?: string | null;
  accent_color?: string;
  text_color?: string;
  bg_color?: string;
  position?: LowerThirdPosition;
  style?: LowerThirdStyle;
  animation?: LowerThirdAnimation;
  start_seconds?: number;
  end_seconds?: number;
  is_enabled?: boolean;
}

export interface ChannelTransition {
  channel_id: string;
  intro_to_video: TransitionKind;
  video_to_outro: TransitionKind;
  duration_ms: number;
  updated_at: string;
}

export interface TransitionResponse {
  transition: ChannelTransition;
  css_intro_to_video?: string;
  css_video_to_outro?: string;
}

export async function getOverlayPresets(): Promise<{
  lower_third_styles: { id: LowerThirdStyle; label: string }[];
  lower_third_animations: { id: LowerThirdAnimation; label: string }[];
  transitions: { id: TransitionKind; label: string; icon: string }[];
}> {
  return request<any>('/api/v1/videos/overlays/presets');
}

export async function listLowerThirds(channelId: string): Promise<{ lower_thirds: LowerThird[] }> {
  return request<{ lower_thirds: LowerThird[] }>(`/api/v1/videos/channels/${channelId}/lower-thirds`);
}

export async function createLowerThird(channelId: string, input: LowerThirdInput): Promise<{ lower_third: LowerThird }> {
  return request<{ lower_third: LowerThird }>(`/api/v1/videos/channels/${channelId}/lower-thirds`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateLowerThird(channelId: string, id: string, input: Partial<LowerThirdInput>): Promise<{ lower_third: LowerThird }> {
  return request<{ lower_third: LowerThird }>(`/api/v1/videos/channels/${channelId}/lower-thirds/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteLowerThird(channelId: string, id: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/channels/${channelId}/lower-thirds/${id}`, {
    method: 'DELETE',
  });
}

export async function getChannelTransition(channelId: string): Promise<TransitionResponse> {
  return request<TransitionResponse>(`/api/v1/videos/channels/${channelId}/transition`);
}

export async function setChannelTransition(channelId: string, input: {
  intro_to_video?: TransitionKind;
  video_to_outro?: TransitionKind;
  duration_ms?: number;
}): Promise<TransitionResponse> {
  return request<TransitionResponse>(`/api/v1/videos/channels/${channelId}/transition`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function resetChannelTransition(channelId: string): Promise<TransitionResponse> {
  return request<TransitionResponse>(`/api/v1/videos/channels/${channelId}/transition`, {
    method: 'DELETE',
  });
}

// ============ Custom Intro/Outro (30.3, 30.5) ============
export type IntroKind = 'intro' | 'outro';

export interface ChannelIntro {
  id: string;
  channel_id: string;
  kind: IntroKind;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number;
  skip_after_seconds: number;
  is_enabled: number;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntroTemplate {
  id: string;
  label: string;
  description: string;
  duration_seconds: number;
  kind: IntroKind;
  preview_color: string;
  preview_icon: string;
}

export interface IntroInput {
  kind: IntroKind;
  video_url: string;
  thumbnail_url?: string | null;
  duration_seconds?: number;
  skip_after_seconds?: number;
  is_enabled?: boolean;
  template_id?: string | null;
}

export interface IntroBundle {
  intro: ChannelIntro | null;
  outro: ChannelIntro | null;
}

export async function getIntroTemplates(): Promise<{ templates: IntroTemplate[] }> {
  return request<{ templates: IntroTemplate[] }>('/api/v1/videos/intros/templates');
}

export async function listChannelIntros(channelId: string): Promise<{ intros: ChannelIntro[]; bundle: IntroBundle }> {
  return request<{ intros: ChannelIntro[]; bundle: IntroBundle }>(`/api/v1/videos/channels/${channelId}/intros`);
}

export async function getChannelIntro(channelId: string, kind: IntroKind): Promise<{ intro: ChannelIntro | null }> {
  return request<{ intro: ChannelIntro | null }>(`/api/v1/videos/channels/${channelId}/intros/${kind}`);
}

export async function setChannelIntro(channelId: string, input: IntroInput): Promise<{ intro: ChannelIntro }> {
  return request<{ intro: ChannelIntro }>(`/api/v1/videos/channels/${channelId}/intros`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function removeChannelIntro(channelId: string, kind: IntroKind): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/channels/${channelId}/intros/${kind}`, {
    method: 'DELETE',
  });
}

// ============ Player Customization (30.1, 30.2, 30.4, 30.8) ============
export interface PlayerCustomization {
  channel_id: string;
  accent_color: string;
  background_color: string;
  progress_color: string;
  logo_url: string | null;
  logo_position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logo_opacity: number;
  watermark_text: string | null;
  filter_preset: string;
  brightness: number;
  contrast: number;
  saturation: number;
  hue_rotate: number;
  sepia: number;
  blur: number;
  color_grading_preset: string;
  tint_r: number;
  tint_g: number;
  tint_b: number;
  tint_alpha: number;
  updated_at: string;
}

export interface CustomizationInput {
  accent_color?: string;
  background_color?: string;
  progress_color?: string;
  logo_url?: string | null;
  logo_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  logo_opacity?: number;
  watermark_text?: string | null;
  filter_preset?: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue_rotate?: number;
  sepia?: number;
  blur?: number;
  color_grading_preset?: string;
  tint_r?: number;
  tint_g?: number;
  tint_b?: number;
  tint_alpha?: number;
}

export interface CustomizationResponse {
  customization: PlayerCustomization;
  css_filter: string;
}

export async function getChannelCustomization(channelId: string): Promise<CustomizationResponse> {
  return request<CustomizationResponse>(`/api/v1/videos/channels/${channelId}/customization`);
}

export async function setChannelCustomization(channelId: string, input: CustomizationInput): Promise<CustomizationResponse> {
  return request<CustomizationResponse>(`/api/v1/videos/channels/${channelId}/customization`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function resetChannelCustomization(channelId: string): Promise<CustomizationResponse> {
  return request<CustomizationResponse>(`/api/v1/videos/channels/${channelId}/customization`, {
    method: 'DELETE',
  });
}

export async function getCustomizationPresets(): Promise<{
  filters: { id: string; label: string }[];
  grading: { id: string; label: string }[];
}> {
  return request<{ filters: { id: string; label: string }[]; grading: { id: string; label: string }[] }>(
    '/api/v1/videos/customizations/presets'
  );
}

// ============ Referral Program (27.2) ============
export interface ReferralCode {
  user_id: string;
  code: string;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_user_id: string;
  referred_user_id: string;
  code: string;
  status: 'pending' | 'completed' | 'rewarded' | 'rejected';
  reward_amount: number;
  referred_bonus: number;
  created_at: string;
  completed_at: string | null;
  rewarded_at: string | null;
  referred_email?: string;
  referred_username?: string;
}

export interface ReferralStats {
  code: string;
  total_invited: number;
  completed: number;
  pending: number;
  total_earned: number;
}

export interface CreditBalance {
  balance: number;
  lifetime_earned: number;
}

export interface ReferralMe {
  stats: ReferralStats;
  credits: CreditBalance;
  reward_info: { referrer: number; referred: number };
}

export async function getReferralMe(): Promise<ReferralMe> {
  return request<ReferralMe>('/api/v1/auth/referrals/me');
}

export async function listMyReferrals(limit = 100): Promise<{ referrals: Referral[] }> {
  return request<{ referrals: Referral[] }>(`/api/v1/auth/referrals/me/list?limit=${limit}`);
}

export async function getMyCredits(): Promise<CreditBalance> {
  return request<CreditBalance>('/api/v1/auth/referrals/credits');
}

export async function getReferralShareLink(): Promise<{ code: string; link: string }> {
  return request<{ code: string; link: string }>('/api/v1/auth/referrals/share');
}

export async function regenerateReferralCode(): Promise<{ code: string }> {
  return request<{ code: string }>('/api/v1/auth/referrals/code/regenerate', { method: 'POST' });
}

// ============ Promotional Banners (27.4) ============
export interface Banner {
  id: string;
  title: string;
  message: string | null;
  cta_label: string | null;
  cta_url: string | null;
  bg_color: string;
  text_color: string;
  placement: 'top' | 'bottom' | 'home' | 'watch';
  is_active: number;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  dismissible: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface BannerInput {
  title: string;
  message?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  bg_color?: string;
  text_color?: string;
  placement?: 'top' | 'bottom' | 'home' | 'watch';
  is_active?: boolean;
  priority?: number;
  starts_at?: string | null;
  ends_at?: string | null;
  dismissible?: boolean;
}

export async function getActiveBanners(placement?: string): Promise<{ banners: Banner[] }> {
  const qs = placement ? `?placement=${encodeURIComponent(placement)}` : '';
  return request<{ banners: Banner[] }>(`/api/v1/videos/banners${qs}`);
}

export async function dismissBanner(id: string): Promise<{ dismissed: boolean }> {
  return request<{ dismissed: boolean }>(`/api/v1/videos/banners/${id}/dismiss`, { method: 'POST' });
}

// Admin
export async function adminListBanners(): Promise<{ banners: Banner[] }> {
  return request<{ banners: Banner[] }>('/api/v1/videos/admin/banners');
}

export async function adminCreateBanner(input: BannerInput): Promise<{ banner: Banner }> {
  return request<{ banner: Banner }>('/api/v1/videos/admin/banners', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function adminUpdateBanner(id: string, patch: Partial<BannerInput>): Promise<{ banner: Banner }> {
  return request<{ banner: Banner }>(`/api/v1/videos/admin/banners/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function adminDeleteBanner(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/admin/banners/${id}`, { method: 'DELETE' });
}

export async function adminClearBannerDismissals(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/videos/admin/banners/${id}/clear-dismissals`, { method: 'POST' });
}

// ============ VR / 360 (3.6) ============
export type VrProjection = 'none' | 'equirectangular' | 'cubemap';
export type VrStereo = 'mono' | 'sbs' | 'ou';

export interface VrMetadata {
  video_id: string;
  projection: VrProjection;
  stereo: VrStereo;
  fov: number;
  initial_yaw: number;
  initial_pitch: number;
  has_spatial_audio: number;
  updated_at: string;
}

export const VR_PROJECTIONS: { id: VrProjection; label: string }[] = [
  { id: 'none', label: 'Standard (2D)' },
  { id: 'equirectangular', label: '360° Equirectangular' },
  { id: 'cubemap', label: '360° Cubemap' },
];

export const VR_STEREOS: { id: VrStereo; label: string }[] = [
  { id: 'mono', label: 'Monoscopic (2D)' },
  { id: 'sbs', label: 'Side-by-Side (VR)' },
  { id: 'ou', label: 'Over-Under (VR)' },
];

export async function getVideoVr(videoId: string): Promise<{ vr: VrMetadata }> {
  return request<{ vr: VrMetadata }>(`/api/v1/videos/${videoId}/vr`);
}

export async function updateVideoVr(
  videoId: string,
  input: Partial<Pick<VrMetadata, 'projection' | 'stereo' | 'fov' | 'initial_yaw' | 'initial_pitch'>> & { has_spatial_audio?: boolean },
): Promise<{ vr: VrMetadata }> {
  return request<{ vr: VrMetadata }>(`/api/v1/videos/${videoId}/vr`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function clearVideoVr(videoId: string): Promise<{ vr: VrMetadata }> {
  return request<{ vr: VrMetadata }>(`/api/v1/videos/${videoId}/vr`, { method: 'DELETE' });
}

export async function listVrVideos(limit = 40): Promise<{ videos: any[] }> {
  return request<{ videos: any[] }>(`/api/v1/videos/vr/videos?limit=${limit}`);
}

// ============ Audio Track Selector (45.8) ============
export interface AudioTrack {
  id: string;
  video_id: string;
  language: string;
  label: string;
  kind: string;
  is_default: number;
  order_index: number;
  created_at: string;
}

export interface AudioTrackResponse {
  tracks: AudioTrack[];
  preference: string | null;
  defaultTrack: string | null;
}

export async function listVideoAudioTracks(videoId: string): Promise<AudioTrackResponse> {
  return request<AudioTrackResponse>(`/api/v1/videos/${videoId}/audio-tracks`);
}

export async function addVideoAudioTrack(
  videoId: string,
  input: { language: string; label?: string; kind?: string; is_default?: boolean },
): Promise<{ track: AudioTrack }> {
  return request<{ track: AudioTrack }>(`/api/v1/videos/${videoId}/audio-tracks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function setDefaultAudioTrack(trackId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/videos/audio-tracks/${trackId}/set-default`, {
    method: 'POST',
  });
}

export async function deleteAudioTrack(trackId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/audio-tracks/${trackId}`, {
    method: 'DELETE',
  });
}

export async function setAudioTrackPreference(videoId: string, trackId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/videos/${videoId}/audio-tracks/preference`, {
    method: 'POST',
    body: JSON.stringify({ track_id: trackId }),
  });
}

// ============ Video Transcript (Section 35) ============
export interface TranscriptCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  video_id: string;
  language: string;
  label: string;
  source: 'subtitle' | 'chapters' | 'placeholder';
  cues: TranscriptCue[];
  plain_text: string;
  word_count: number;
  duration: number;
}

export interface TranscriptSearchHit {
  index: number;
  start: number;
  end: number;
  text: string;
  snippet: string;
}

export async function getVideoTranscript(videoId: string, lang?: string): Promise<{ transcript: Transcript }> {
  const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  return request<{ transcript: Transcript }>(`/api/v1/videos/${videoId}/transcript${qs}`);
}

export async function getTranscriptLanguages(videoId: string): Promise<{ languages: { language: string; label: string }[] }> {
  return request<{ languages: { language: string; label: string }[] }>(`/api/v1/videos/${videoId}/transcript/languages`);
}

export async function searchVideoTranscript(
  videoId: string,
  query: string,
  lang?: string,
): Promise<{ hits: TranscriptSearchHit[]; total: number; language: string; label: string }> {
  const params = new URLSearchParams({ q: query });
  if (lang) params.set('lang', lang);
  return request<{ hits: TranscriptSearchHit[]; total: number; language: string; label: string }>(
    `/api/v1/videos/${videoId}/transcript/search?${params.toString()}`,
  );
}

export function transcriptDownloadUrl(videoId: string, format: 'txt' | 'srt' | 'vtt' = 'txt', lang?: string): string {
  const params = new URLSearchParams({ format });
  if (lang) params.set('lang', lang);
  return `/api/v1/videos/${videoId}/transcript/download?${params.toString()}`;
}

// ============ Subtitle Auto-Generation (38.2) ============
export interface AutoGenCuesResult {
  cues: SubtitleCue[];
  source: 'chapters' | 'description' | 'placeholder';
  draft: boolean;
}

export async function previewAutoSubtitles(videoId: string): Promise<AutoGenCuesResult> {
  return request<AutoGenCuesResult>(`/api/v1/videos/${videoId}/subtitles/auto-preview`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function autoGenerateSubtitle(
  videoId: string,
  language: string,
  label?: string,
  kind: 'subtitles' | 'captions' = 'subtitles',
): Promise<{ track: SubtitleTrackWithContent }> {
  return request<{ track: SubtitleTrackWithContent }>(`/api/v1/videos/${videoId}/subtitles/auto-generate`, {
    method: 'POST',
    body: JSON.stringify({ language, label, kind }),
  });
}

// ============ Subtitle Editor (38.4) ============
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export async function getSubtitleCues(trackId: string): Promise<{ cues: SubtitleCue[]; track: { id: string; language: string; label: string; kind: string; format: string } }> {
  return request<{ cues: SubtitleCue[]; track: any }>(`/api/v1/videos/subtitles/${trackId}/cues`);
}

export async function updateSubtitleCues(trackId: string, cues: SubtitleCue[]): Promise<{ track: SubtitleTrackWithContent }> {
  return request<{ track: SubtitleTrackWithContent }>(`/api/v1/videos/subtitles/${trackId}/cues`, {
    method: 'PUT',
    body: JSON.stringify({ cues }),
  });
}

// ============ Video Subtitles ============
export interface SubtitleTrack {
  id: string;
  video_id: string;
  language: string;
  label: string;
  format: 'srt' | 'vtt';
  kind: 'subtitles' | 'captions';
  is_default: number;
  created_at: string;
}

export interface SubtitleTrackWithContent extends SubtitleTrack {
  content: string;
}

export interface SubtitleUploadInput {
  language: string;
  label: string;
  format: 'srt' | 'vtt';
  kind?: 'subtitles' | 'captions';
  content: string;
  is_default?: boolean;
}

export const SUBTITLE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'bn', label: 'বাংলা (Bangla)' },
  { code: 'hi', label: 'हिन्दी (Hindi)' },
  { code: 'ar', label: 'العربية (Arabic)' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文 (Chinese)' },
  { code: 'ja', label: '日本語 (Japanese)' },
  { code: 'ko', label: '한국어 (Korean)' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'ur', label: 'اردو (Urdu)' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
  { code: 'te', label: 'తెలుగు (Telugu)' },
] as const;

export async function listVideoSubtitles(videoId: string): Promise<{ subtitles: SubtitleTrack[] }> {
  return request<{ subtitles: SubtitleTrack[] }>(`/api/v1/videos/${videoId}/subtitles`);
}

export async function uploadVideoSubtitle(
  videoId: string,
  input: SubtitleUploadInput,
): Promise<{ track: SubtitleTrackWithContent }> {
  return request<{ track: SubtitleTrackWithContent }>(`/api/v1/videos/${videoId}/subtitles`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getSubtitleRaw(trackId: string): Promise<{ track: SubtitleTrackWithContent }> {
  return request<{ track: SubtitleTrackWithContent }>(`/api/v1/videos/subtitles/${trackId}/raw`);
}

export async function setDefaultSubtitle(trackId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/videos/subtitles/${trackId}/set-default`, {
    method: 'POST',
  });
}

export async function deleteSubtitleTrack(trackId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/subtitles/${trackId}`, {
    method: 'DELETE',
  });
}

export function subtitleVttUrl(videoId: string, kind: 'subtitles' | 'captions' = 'subtitles'): string {
  return `/api/v1/videos/${videoId}/subtitles/default.vtt?kind=${kind}`;
}

// ============ Video Tags & Hashtags ============
export interface VideoTag {
  id: string;
  video_id: string;
  tag: string;
  tag_normalized: string;
  source: 'manual' | 'hashtag' | 'auto';
  created_at: string;
}

export interface TagWithCount {
  tag: string;
  tag_normalized: string;
  video_count: number;
}

export async function listVideoTags(videoId: string): Promise<{ tags: VideoTag[] }> {
  return request<{ tags: VideoTag[] }>(`/api/v1/videos/${videoId}/tags`);
}

export async function addVideoTag(videoId: string, tag: string): Promise<{ tag: VideoTag }> {
  return request<{ tag: VideoTag }>(`/api/v1/videos/${videoId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tag }),
  });
}

export async function replaceVideoTags(videoId: string, tags: string[]): Promise<{ tags: VideoTag[] }> {
  return request<{ tags: VideoTag[] }>(`/api/v1/videos/${videoId}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tags }),
  });
}

export async function removeVideoTag(videoId: string, tag: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/${videoId}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  });
}

export async function syncHashtags(videoId: string): Promise<{ added: VideoTag[] }> {
  return request<{ added: VideoTag[] }>(`/api/v1/videos/${videoId}/tags/sync-hashtags`, {
    method: 'POST',
  });
}

export async function getTopTags(limit = 50): Promise<{ tags: TagWithCount[] }> {
  return request<{ tags: TagWithCount[] }>(`/api/v1/videos/tags/top?limit=${limit}`);
}

export async function suggestTags(prefix: string, limit = 10): Promise<{ tags: TagWithCount[] }> {
  return request<{ tags: TagWithCount[] }>(
    `/api/v1/videos/tags/suggest?q=${encodeURIComponent(prefix)}&limit=${limit}`,
  );
}

export async function getVideosByTag(tag: string, limit = 50): Promise<{ videos: any[] }> {
  return request<{ videos: any[] }>(`/api/v1/videos/tags/${encodeURIComponent(tag)}/videos?limit=${limit}`);
}

// ============ Video Clips ============
export interface Clip {
  id: string;
  video_id: string;
  creator_user_id: string;
  title: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number;
  view_count: number;
  created_at: string;
  video_title?: string | null;
  video_thumbnail_url?: string | null;
  video_owner_id?: string | null;
  channel_id?: string | null;
}

export async function listVideoClips(videoId: string): Promise<{ clips: Clip[] }> {
  return request<{ clips: Clip[] }>(`/api/v1/videos/${videoId}/clips`);
}

export async function createVideoClip(
  videoId: string,
  title: string,
  startSeconds: number,
  endSeconds: number,
): Promise<{ clip: Clip }> {
  return request<{ clip: Clip }>(`/api/v1/videos/${videoId}/clips`, {
    method: 'POST',
    body: JSON.stringify({ title, start_seconds: startSeconds, end_seconds: endSeconds }),
  });
}

export async function getClip(clipId: string): Promise<{ clip: Clip }> {
  return request<{ clip: Clip }>(`/api/v1/videos/clips/${clipId}`);
}

export async function incrementClipView(clipId: string): Promise<{ counted: boolean }> {
  return request<{ counted: boolean }>(`/api/v1/videos/clips/${clipId}/view`, { method: 'POST' });
}

export async function listMyClips(): Promise<{ clips: Clip[] }> {
  return request<{ clips: Clip[] }>('/api/v1/videos/clips/mine');
}

export async function deleteClip(clipId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/clips/${clipId}`, { method: 'DELETE' });
}

// ============ Video Quiz ============
export interface QuizOption {
  id: string;
  text: string;
  order_index: number;
  response_count: number;
}

export interface Quiz {
  id: string;
  video_id: string;
  question: string;
  explanation: string | null;
  is_closed: number;
  created_at: string;
  closes_at: string | null;
  options: QuizOption[];
  total_responses: number;
  correct_count: number;
  user_response_option_id: string | null;
  user_was_correct: number | null;
  correct_option_id: string | null;
}

export async function getVideoQuiz(videoId: string): Promise<{ quiz: Quiz | null }> {
  return request<{ quiz: Quiz | null }>(`/api/v1/videos/${videoId}/quiz`);
}

export async function createVideoQuiz(
  videoId: string,
  question: string,
  options: string[],
  correctIndex: number,
  explanation?: string | null,
  closesAt?: string | null,
): Promise<{ quiz: Quiz }> {
  return request<{ quiz: Quiz }>(`/api/v1/videos/${videoId}/quiz`, {
    method: 'POST',
    body: JSON.stringify({
      question,
      options,
      correct_index: correctIndex,
      explanation: explanation ?? null,
      closes_at: closesAt ?? null,
    }),
  });
}

export async function answerQuiz(quizId: string, optionId: string): Promise<{ quiz: Quiz }> {
  return request<{ quiz: Quiz }>(`/api/v1/videos/quizzes/${quizId}/answer`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId }),
  });
}

export async function closeQuiz(quizId: string): Promise<{ quiz: Quiz }> {
  return request<{ quiz: Quiz }>(`/api/v1/videos/quizzes/${quizId}/close`, { method: 'POST' });
}

export async function deleteQuiz(quizId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/quizzes/${quizId}`, { method: 'DELETE' });
}

// ============ Video Poll ============
export interface PollOption {
  id: string;
  text: string;
  order_index: number;
  vote_count: number;
}

export interface Poll {
  id: string;
  video_id: string;
  question: string;
  is_closed: number;
  created_at: string;
  closes_at: string | null;
  options: PollOption[];
  total_votes: number;
  user_vote_option_id: string | null;
}

export async function getVideoPoll(videoId: string): Promise<{ poll: Poll | null }> {
  return request<{ poll: Poll | null }>(`/api/v1/videos/${videoId}/poll`);
}

export async function createVideoPoll(
  videoId: string,
  question: string,
  options: string[],
  closesAt?: string | null,
): Promise<{ poll: Poll }> {
  return request<{ poll: Poll }>(`/api/v1/videos/${videoId}/poll`, {
    method: 'POST',
    body: JSON.stringify({ question, options, closes_at: closesAt ?? null }),
  });
}

export async function votePoll(pollId: string, optionId: string): Promise<{ poll: Poll }> {
  return request<{ poll: Poll }>(`/api/v1/videos/polls/${pollId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ option_id: optionId }),
  });
}

export async function closePoll(pollId: string): Promise<{ poll: Poll }> {
  return request<{ poll: Poll }>(`/api/v1/videos/polls/${pollId}/close`, { method: 'POST' });
}

export async function deletePoll(pollId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/polls/${pollId}`, { method: 'DELETE' });
}

// ============ Video Rating (5-star) ============
export interface RatingStats {
  avg: number;
  count: number;
  userRating: number | null;
}

export interface RatingResult {
  ratingAvg: number;
  ratingCount: number;
  userRating: number | null;
}

export async function getVideoRating(videoId: string): Promise<RatingStats> {
  return request<RatingStats>(`/api/v1/videos/${videoId}/rating`);
}

export async function rateVideo(videoId: string, rating: number): Promise<RatingResult> {
  return request<RatingResult>(`/api/v1/videos/${videoId}/rating`, {
    method: 'POST',
    body: JSON.stringify({ rating }),
  });
}

export async function deleteVideoRating(videoId: string): Promise<RatingResult> {
  return request<RatingResult>(`/api/v1/videos/${videoId}/rating`, { method: 'DELETE' });
}

// ============ User Preferences ============
export type QualityOption = 'auto' | '144' | '240' | '360' | '480' | '720' | '1080' | '1440' | '2160';
export type ThemeOption = 'light' | 'dark' | 'system';

export interface Preferences {
  user_id: string;
  autoplay_next: number;
  autoplay_playlist: number;
  default_quality: QualityOption;
  default_speed: number;
  theme: ThemeOption;
  language: string;
  reduced_motion: number;
  captions_on: number;
  updated_at: string;
}

export interface PreferencesPatch {
  autoplay_next?: boolean | number;
  autoplay_playlist?: boolean | number;
  default_quality?: QualityOption;
  default_speed?: number;
  theme?: ThemeOption;
  language?: string;
  reduced_motion?: boolean | number;
  captions_on?: boolean | number;
}

export async function getPreferences(): Promise<Preferences> {
  return request<Preferences>('/api/v1/videos/preferences');
}

export async function updatePreferences(patch: PreferencesPatch): Promise<Preferences> {
  return request<Preferences>('/api/v1/videos/preferences', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function resetPreferences(): Promise<Preferences> {
  return request<Preferences>('/api/v1/videos/preferences', { method: 'DELETE' });
}

// ============ Watch Queue ============
export interface QueueItem {
  id: string;
  user_id: string;
  video_id: string;
  position: number;
  added_at: string;
  title?: string | null;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  channel_id?: string | null;
  owner_id?: string | null;
}

export interface QueueResponse {
  items: QueueItem[];
  count: number;
}

export async function getWatchQueue(): Promise<QueueResponse> {
  return request<QueueResponse>('/api/v1/videos/queue');
}

export async function addToQueue(videoId: string, atTop = false): Promise<QueueResponse> {
  return request<QueueResponse>('/api/v1/videos/queue', {
    method: 'POST',
    body: JSON.stringify({ video_id: videoId, at_top: atTop }),
  });
}

export async function removeFromQueue(videoId: string): Promise<QueueResponse> {
  return request<QueueResponse>(`/api/v1/videos/queue/${videoId}`, { method: 'DELETE' });
}

export async function reorderQueue(videoIds: string[]): Promise<QueueResponse> {
  return request<QueueResponse>('/api/v1/videos/queue/reorder', {
    method: 'PUT',
    body: JSON.stringify({ video_ids: videoIds }),
  });
}

export async function clearQueue(): Promise<{ removed: number }> {
  return request<{ removed: number }>('/api/v1/videos/queue', { method: 'DELETE' });
}

export async function getNextInQueue(currentVideoId?: string): Promise<{ next: QueueItem | null }> {
  const qs = currentVideoId ? `?current=${encodeURIComponent(currentVideoId)}` : '';
  return request<{ next: QueueItem | null }>(`/api/v1/videos/queue/next${qs}`);
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

// ============ Two-Factor Authentication (2FA) ============
export interface TwoFAStatus {
  enabled: boolean;
  has_backup_codes: number;
}

export interface TwoFASetupResult {
  secret: string;
  qr_data_url: string;
  manual_entry: string;
}

export interface TwoFAConfirmResult {
  enabled: boolean;
  backup_codes: string[];
}

export async function getTwoFAStatus(): Promise<TwoFAStatus> {
  return request<TwoFAStatus>('/api/auth/2fa/status');
}

export async function beginTwoFASetup(): Promise<TwoFASetupResult> {
  return request<TwoFASetupResult>('/api/auth/2fa/setup', { method: 'POST' });
}

export async function confirmTwoFA(code: string): Promise<TwoFAConfirmResult> {
  return request<TwoFAConfirmResult>('/api/auth/2fa/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function disableTwoFA(code: string): Promise<{ disabled: boolean }> {
  return request<{ disabled: boolean }>('/api/auth/2fa/disable', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function regenerateBackupCodes(code: string): Promise<{ backup_codes: string[] }> {
  return request<{ backup_codes: string[] }>('/api/auth/2fa/regenerate-backup-codes', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function completeTwoFALogin(tempToken: string, code: string): Promise<{ user: User; token: string }> {
  return request<{ user: User; token: string }>('/api/auth/2fa/login', {
    method: 'POST',
    body: JSON.stringify({ temp_token: tempToken, code }),
  });
}

// ============ Podcasts ============
export interface PodcastsListResponse {
  podcasts: Video[];
  total: number;
}

export async function listPodcasts(limit = 50, offset = 0): Promise<PodcastsListResponse> {
  return request<PodcastsListResponse>(`/api/v1/videos/podcasts?limit=${limit}&offset=${offset}`);
}

export async function listPodcastsByChannel(channelId: string, limit = 50, offset = 0): Promise<PodcastsListResponse> {
  return request<PodcastsListResponse>(`/api/v1/videos/podcasts?channel=${channelId}&limit=${limit}&offset=${offset}`);
}

export function podcastRssUrl(channelId: string): string {
  return `/api/v1/videos/podcasts/rss/${channelId}`;
}

// Extend Video type with content_type
export interface VideoWithType extends Video {
  content_type?: string;
}

// ============ Series / Seasons / Episodes ============
export interface Series {
  id: string;
  channel_id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  category: string;
  total_seasons: number;
  total_episodes: number;
  status: 'ongoing' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface Season {
  id: string;
  series_id: string;
  season_number: number;
  title: string | null;
  description: string | null;
  episode_count: number;
  created_at: string;
  updated_at: string;
}

export interface Episode {
  id: string;
  series_id: string;
  season_id: string;
  video_id: string;
  episode_number: number;
  title: string;
  description: string | null;
  skip_intro_seconds: number;
  skip_recap_seconds: number;
  skip_credits_seconds: number;
  air_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface SeriesWithSeasons {
  series: Series;
  seasons: (Season & { episodes: Episode[] })[];
  is_owner?: boolean;
}

export interface EpisodeInfo {
  episode: Episode | null;
  series: Series | null;
  next_episode?: Episode | null;
  next_video?: Video | null;
}

export async function listAllSeries(limit = 50, offset = 0): Promise<{ series: Series[]; total: number }> {
  return request<{ series: Series[]; total: number }>(`/api/v1/videos/series?limit=${limit}&offset=${offset}`);
}

export async function listSeriesByChannel(channelId: string): Promise<{ series: Series[]; total: number }> {
  return request<{ series: Series[]; total: number }>(`/api/v1/videos/series?channel=${channelId}`);
}

export async function getSeries(id: string): Promise<SeriesWithSeasons> {
  return request<SeriesWithSeasons>(`/api/v1/videos/series/${id}`);
}

export async function createSeries(input: { title: string; description?: string; cover_url?: string; category?: string }): Promise<Series> {
  return request<Series>('/api/v1/videos/series', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateSeries(id: string, updates: Partial<Series>): Promise<Series> {
  return request<Series>(`/api/v1/videos/series/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteSeries(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/series/${id}`, { method: 'DELETE' });
}

export async function createSeason(seriesId: string, seasonNumber: number, title?: string, description?: string): Promise<Season> {
  return request<Season>(`/api/v1/videos/series/${seriesId}/seasons`, {
    method: 'POST',
    body: JSON.stringify({ season_number: seasonNumber, title, description }),
  });
}

export async function deleteSeason(seasonId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/seasons/${seasonId}`, { method: 'DELETE' });
}

export async function createEpisode(seriesId: string, input: {
  season_id: string;
  video_id: string;
  episode_number: number;
  title: string;
  description?: string;
  skip_intro_seconds?: number;
  skip_recap_seconds?: number;
  skip_credits_seconds?: number;
  air_date?: string;
}): Promise<Episode> {
  return request<Episode>(`/api/v1/videos/series/${seriesId}/episodes`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateEpisode(episodeId: string, updates: Partial<Episode>): Promise<Episode> {
  return request<Episode>(`/api/v1/videos/episodes/${episodeId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteEpisode(episodeId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/episodes/${episodeId}`, { method: 'DELETE' });
}

export async function getEpisodeInfo(videoId: string): Promise<EpisodeInfo> {
  return request<EpisodeInfo>(`/api/v1/videos/${videoId}/episode-info`);
}

// ============ Shorts ============
export interface ShortsListResponse {
  shorts: Video[];
  total: number;
}

export async function listShorts(limit = 50, offset = 0): Promise<ShortsListResponse> {
  return request<ShortsListResponse>(`/api/v1/videos/shorts?limit=${limit}&offset=${offset}`);
}

export async function listShortsByChannel(channelId: string, limit = 50, offset = 0): Promise<ShortsListResponse> {
  return request<ShortsListResponse>(`/api/v1/videos/shorts?channel=${channelId}&limit=${limit}&offset=${offset}`);
}

// ============ Stories (24h ephemeral) ============
export interface Story {
  id: string;
  user_id: string;
  media_type: 'image' | 'video';
  media_url: string;
  caption: string | null;
  duration_seconds: number;
  view_count: number;
  expires_at: string;
  created_at: string;
}

export interface StoryGroup {
  user_id: string;
  stories: Story[];
  has_unseen: boolean;
  latest_at: string;
}

export async function listStoryGroups(): Promise<{ groups: StoryGroup[] }> {
  return request<{ groups: StoryGroup[] }>('/api/v1/videos/stories/groups');
}

export async function listStoriesByUser(userId: string): Promise<{ stories: Story[] }> {
  return request<{ stories: Story[] }>(`/api/v1/videos/stories/user/${userId}`);
}

export async function markStoryViewed(storyId: string): Promise<{ viewed: boolean }> {
  return request<{ viewed: boolean }>(`/api/v1/videos/stories/${storyId}/view`, { method: 'POST' });
}

export async function deleteStory(storyId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/stories/${storyId}`, { method: 'DELETE' });
}

export function uploadStory(
  file: File,
  caption: string | undefined,
  onProgress?: (pct: number) => void,
): Promise<Story> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    if (caption) form.append('caption', caption);
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/videos/stories/upload');
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

// Story media URL helper (used in <img> or <video>)
export function storyMediaUrl(mediaUrl: string): string {
  return mediaUrl; // already absolute path from server
}

// ============ Ad Config ============
export interface AdConfig {
  source: 'internal' | 'external';
  vast_tag_url?: string;
  network_name?: string;
  ad?: {
    id: string;
    title: string;
    video_url: string;
    click_url: string | null;
    type: string;
    duration_seconds: number;
    skip_after_seconds: number;
  };
}

export async function getAdConfig(videoId: string): Promise<AdConfig> {
  return request<AdConfig>(`/api/v1/videos/admin/ad-config/${videoId}`);
}

export async function recordAdImpression(adId: string, videoId: string): Promise<{ recorded: boolean }> {
  return request<{ recorded: boolean }>(`/api/v1/videos/admin/ads/${adId}/impression`, {
    method: 'POST',
    body: JSON.stringify({ video_id: videoId }),
  });
}

export async function recordAdClick(adId: string, videoId: string): Promise<{ recorded: boolean }> {
  return request<{ recorded: boolean }>(`/api/v1/videos/admin/ads/${adId}/click`, {
    method: 'POST',
    body: JSON.stringify({ video_id: videoId }),
  });
}

// ============ Payment Gateways (public) ============
export interface PublicGateway {
  id: string;
  provider: string;
  display_name: string;
  sandbox: number;
  is_default: number;
}

export async function listAvailableGateways(): Promise<{ gateways: PublicGateway[] }> {
  return request<{ gateways: PublicGateway[] }>('/api/v1/videos/payment/available');
}

export interface CheckoutResponse {
  transaction_id: string;
  amount: number;
  currency: string;
  gateway: {
    provider: string;
    display_name: string;
    sandbox: boolean;
    merchant_id: string | null;
    base_url: string | null;
  };
}

export async function startCheckout(input: {
  purpose: 'super_chat' | 'membership' | 'donation' | 'ppv' | 'message_pack';
  amount: number;
  currency?: string;
  reference_id?: string;
  metadata?: Record<string, any>;
  gateway_id?: string;
}): Promise<CheckoutResponse> {
  return request<CheckoutResponse>('/api/v1/videos/payment/checkout', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function verifyPayment(transactionId: string, status?: string, externalId?: string): Promise<any> {
  return request<any>('/api/v1/videos/payment/verify', {
    method: 'POST',
    body: JSON.stringify({ transaction_id: transactionId, status, external_id: externalId }),
  });
}

export interface MyTransaction {
  id: string;
  purpose: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export async function listMyTransactions(): Promise<{ transactions: MyTransaction[] }> {
  return request<{ transactions: MyTransaction[] }>('/api/v1/videos/payment/my-transactions');
}

// ============ Chat Limits ============
export interface ChatUsage {
  free_used: number;
  free_remaining: number;
  free_limit: number;
  paid_balance: number;
  total_messages_sent: number;
  can_send: boolean;
  requires_payment: boolean;
  pack_price: number;
  pack_size: number;
}

export async function getChatUsage(): Promise<ChatUsage> {
  return request<ChatUsage>('/api/v1/videos/chat-limits/me');
}

export async function getChatLimitConstants(): Promise<{ FREE_MESSAGE_LIMIT: number; MESSAGE_PACK_SIZE: number; MESSAGE_PACK_PRICE_BDT: number }> {
  return request<{ FREE_MESSAGE_LIMIT: number; MESSAGE_PACK_SIZE: number; MESSAGE_PACK_PRICE_BDT: number }>('/api/v1/videos/chat-limits/constants');
}

export async function consumeMessageCredit(): Promise<{ consumed: 'free' | 'paid'; usage: ChatUsage }> {
  return request<{ consumed: 'free' | 'paid'; usage: ChatUsage }>('/api/v1/videos/chat-limits/consume', {
    method: 'POST',
  });
}

// ============ Super Chat ============
export interface SuperChat {
  id: string;
  stream_id: string;
  user_id: string;
  username: string;
  content: string;
  amount: number;
  currency: string;
  color: string;
  pinned_until: string;
  transaction_id: string | null;
  created_at: string;
}

export interface SuperChatConfig {
  min_amount: number;
  presets: { amount: number; color: string; pinSeconds: number; label: string }[];
}

export async function getSuperChatConfig(): Promise<SuperChatConfig> {
  return request<SuperChatConfig>('/api/v1/live/superchat-config');
}

export async function listSuperChats(streamId: string, limit = 50): Promise<{ superchats: SuperChat[]; pinned: SuperChat[] }> {
  return request<{ superchats: SuperChat[]; pinned: SuperChat[] }>(
    `/api/v1/live/${streamId}/superchats?limit=${limit}`
  );
}

export async function sendSuperChat(streamId: string, content: string, amount: number, transactionId: string): Promise<SuperChat> {
  return request<SuperChat>(`/api/v1/live/${streamId}/superchats`, {
    method: 'POST',
    body: JSON.stringify({ content, amount, transaction_id: transactionId }),
  });
}

// ============ Channel Membership ============
export interface MembershipTier {
  id: string;
  channel_id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  color: string;
  badge_emoji: string;
  active: number;
  subscriber_count: number;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  channel_id: string;
  tier_id: string;
  status: 'active' | 'expired' | 'cancelled';
  started_at: string;
  expires_at: string;
  auto_renew: number;
  last_payment_at: string | null;
  total_paid: number;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
  tier?: MembershipTier;
}

export async function listChannelTiers(channelId: string): Promise<{ tiers: MembershipTier[] }> {
  return request<{ tiers: MembershipTier[] }>(`/api/v1/videos/memberships/tiers/${channelId}`);
}

export async function getMyMembershipForChannel(channelId: string): Promise<{ membership: Membership | null }> {
  return request<{ membership: Membership | null }>(`/api/v1/videos/memberships/check/${channelId}`);
}

export async function listMyMemberships(): Promise<{ memberships: Membership[] }> {
  return request<{ memberships: Membership[] }>('/api/v1/videos/memberships/me');
}

export async function joinMembership(tierId: string, transactionId: string): Promise<{ membership: Membership; tier: MembershipTier }> {
  return request<{ membership: Membership; tier: MembershipTier }>('/api/v1/videos/memberships/join', {
    method: 'POST',
    body: JSON.stringify({ tier_id: tierId, transaction_id: transactionId }),
  });
}

export async function cancelMembership(channelId: string): Promise<{ cancelled: boolean }> {
  return request<{ cancelled: boolean }>(`/api/v1/videos/memberships/cancel/${channelId}`, { method: 'DELETE' });
}



// ============ Creator Studio (9.1 - 9.11) ============
export interface StudioSummary {
  channel_id: string;
  subscriber_count: number;
  total_views: number;
  total_videos: number;
  total_watch_time_seconds: number;
  avg_views_per_video: number;
  latest_video: { id: string; title: string; created_at: string; view_count: number } | null;
  top_video: { id: string; title: string; view_count: number } | null;
  next_milestone: { type: string; threshold: number; current: number; remaining: number } | null;
  total_insights: number;
  unacknowledged_milestones: number;
}
export async function getStudioSummary(channelId: string): Promise<StudioSummary> {
  return request<StudioSummary>(`/api/v1/videos/studio/channels/${channelId}/summary`);
}

export interface ChannelMilestone {
  id: string;
  channel_id: string;
  milestone_type: string;
  threshold: number;
  achieved_at: string | null;
  notified: number;
  created_at: string;
}
export interface MilestoneCheckResult {
  achieved: ChannelMilestone[];
  all: ChannelMilestone[];
  current: { subscribers: number; views: number; videos: number };
}
export async function getMilestones(channelId: string): Promise<MilestoneCheckResult> {
  return request<MilestoneCheckResult>(`/api/v1/videos/studio/channels/${channelId}/milestones`);
}
export async function markMilestoneNotified(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/videos/studio/milestones/${id}/notify`, { method: 'POST' });
}

export interface GrowthInsight {
  id: string;
  category: 'warning' | 'opportunity' | 'success' | 'tip';
  title: string;
  description: string;
  action_label: string | null;
  action_url: string | null;
  priority: number;
}
export async function getGrowthInsights(channelId: string): Promise<{ insights: GrowthInsight[] }> {
  return request<{ insights: GrowthInsight[] }>(`/api/v1/videos/studio/channels/${channelId}/insights`);
}

export interface EndScreenElement {
  id: string;
  type: 'video' | 'playlist' | 'channel' | 'subscribe' | 'link';
  x: number; y: number; width: number; height: number;
  label: string;
  target_id: string | null;
  thumbnail_url: string | null;
}
export interface VideoEndScreen {
  video_id: string;
  channel_id: string;
  elements: EndScreenElement[];
  start_seconds: number;
  duration_seconds: number;
  updated_at: string;
}
export interface EndScreenTemplate {
  id: string;
  label: string;
  elements: Omit<EndScreenElement, 'id'>[];
}
export async function getEndScreenTemplates(): Promise<{ templates: EndScreenTemplate[] }> {
  return request<{ templates: EndScreenTemplate[] }>('/api/v1/videos/studio/end-screen-templates');
}
export async function getEndScreen(videoId: string): Promise<{ end_screen: VideoEndScreen | null }> {
  return request<{ end_screen: VideoEndScreen | null }>(`/api/v1/videos/studio/videos/${videoId}/end-screen`);
}
export async function setEndScreen(videoId: string, input: {
  elements: Omit<EndScreenElement, 'id'>[];
  start_seconds?: number;
  duration_seconds?: number;
}): Promise<{ end_screen: VideoEndScreen }> {
  return request<{ end_screen: VideoEndScreen }>(`/api/v1/videos/studio/videos/${videoId}/end-screen`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
export async function deleteEndScreen(videoId: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/studio/videos/${videoId}/end-screen`, { method: 'DELETE' });
}

export interface CompetitorSnapshot {
  id: string;
  channel_id: string;
  competitor_channel_id: string;
  competitor_name: string | null;
  subscriber_snapshot: number;
  video_count_snapshot: number;
  last_snapshot_at: string | null;
  created_at: string;
}
export interface CompetitorAnalysis {
  competitor_channel_id: string;
  competitor_name: string | null;
  subscriber_count: number;
  video_count: number;
  avg_views_per_video: number;
  total_views: number;
  upload_frequency_days: number | null;
  recent_uploads: { id: string; title: string; view_count: number; created_at: string }[];
  vs_own: {
    subscriber_diff: number;
    video_count_diff: number;
    avg_views_diff: number;
  } | null;
}
export async function listCompetitors(channelId: string): Promise<{ competitors: CompetitorSnapshot[] }> {
  return request<{ competitors: CompetitorSnapshot[] }>(`/api/v1/videos/studio/channels/${channelId}/competitors`);
}
export async function trackCompetitor(channelId: string, competitorChannelId: string): Promise<{ competitor: CompetitorSnapshot }> {
  return request<{ competitor: CompetitorSnapshot }>(`/api/v1/videos/studio/channels/${channelId}/competitors`, {
    method: 'POST',
    body: JSON.stringify({ competitor_channel_id: competitorChannelId }),
  });
}
export async function untrackCompetitor(channelId: string, competitorChannelId: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/studio/channels/${channelId}/competitors/${competitorChannelId}`, { method: 'DELETE' });
}
export async function getCompetitorAnalysis(channelId: string, competitorChannelId: string): Promise<CompetitorAnalysis> {
  return request<CompetitorAnalysis>(`/api/v1/videos/studio/channels/${channelId}/competitors/${competitorChannelId}/analysis`);
}

export interface ABTestVariant {
  id: string;
  test_id: string;
  label: string;
  content: string;
  impressions: number;
  clicks: number;
  watch_seconds: number;
  created_at: string;
}
export interface ABTest {
  id: string;
  channel_id: string;
  video_id: string;
  test_type: 'thumbnail' | 'title';
  status: 'running' | 'completed' | 'cancelled';
  winner_variant_id: string | null;
  starts_at: string;
  ends_at: string | null;
  min_impressions: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  variants: ABTestVariant[];
}
export interface ABVariantScore {
  variant_id: string;
  label: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_watch_seconds: number;
  score: number;
  is_significant: boolean;
}
export async function listABTests(channelId: string, limit = 50): Promise<{ tests: ABTest[] }> {
  return request<{ tests: ABTest[] }>(`/api/v1/videos/studio/channels/${channelId}/ab-tests?limit=${limit}`);
}
export async function createABTest(channelId: string, input: {
  video_id: string;
  test_type: 'thumbnail' | 'title';
  variants: { label: string; content: string }[];
  min_impressions?: number;
}): Promise<{ test: ABTest }> {
  return request<{ test: ABTest }>(`/api/v1/videos/studio/channels/${channelId}/ab-tests`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export async function getABTestDetail(id: string): Promise<{ test: ABTest; scores: ABVariantScore[]; winner: ABVariantScore | null; is_ready: boolean }> {
  return request<{ test: ABTest; scores: ABVariantScore[]; winner: ABVariantScore | null; is_ready: boolean }>(`/api/v1/videos/studio/ab-tests/${id}`);
}
export async function completeABTest(id: string, force = false): Promise<{ test: ABTest }> {
  return request<{ test: ABTest }>(`/api/v1/videos/studio/ab-tests/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ force }),
  });
}
export async function cancelABTest(id: string): Promise<{ test: ABTest }> {
  return request<{ test: ABTest }>(`/api/v1/videos/studio/ab-tests/${id}/cancel`, { method: 'POST' });
}

// ============ Advanced Analytics (26.2 - 26.18) ============
export type AnalyticsEventType = 'view_start' | 'view_end' | 'progress' | 'pause' | 'resume' | 'seek'
  | 'click' | 'scroll' | 'quality_change' | 'fullscreen' | 'ad_impression' | 'ad_click'
  | 'share' | 'like' | 'subscribe' | 'comment';

export interface AnalyticsTrackInput {
  event_type: AnalyticsEventType;
  channel_id?: string | null;
  video_id?: string | null;
  session_id?: string | null;
  data?: any;
  country?: string | null;
  language?: string | null;
  device_type?: string | null;
  browser?: string | null;
  os?: string | null;
  referrer?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
}

export async function trackAnalyticsEvent(input: AnalyticsTrackInput): Promise<{ id: string }> {
  return request<{ id: string }>('/api/v1/videos/analytics/track', { method: 'POST', body: JSON.stringify(input) });
}

export interface DemographicSlice { key: string; label: string; count: number; percent: number; }
export interface DemographicsResult {
  by_country: DemographicSlice[];
  by_language: DemographicSlice[];
  by_device: DemographicSlice[];
  by_browser: DemographicSlice[];
  by_os: DemographicSlice[];
  by_age_group: DemographicSlice[];
  by_gender: DemographicSlice[];
  by_referrer: DemographicSlice[];
  total_events: number;
  unique_viewers: number;
}
export async function getDemographics(channelId: string, days = 30): Promise<DemographicsResult> {
  return request<DemographicsResult>(`/api/v1/videos/analytics/channels/${channelId}/demographics?days=${days}`);
}

export interface TrafficSource { source: string; visits: number; percent: number; utm_medium: string | null; }
export interface TrafficReport {
  sources: TrafficSource[];
  by_utm_campaign: { campaign: string; visits: number }[];
  by_utm_medium: { medium: string; visits: number }[];
  by_utm_source: { source: string; visits: number }[];
}
export async function getTrafficSources(channelId: string, days = 30): Promise<TrafficReport> {
  return request<TrafficReport>(`/api/v1/videos/analytics/channels/${channelId}/traffic?days=${days}`);
}

export interface RevenuePoint { day: string; revenue: number; views: number; rpm: number; }
export interface RevenueReport {
  total_revenue: number; total_views: number; rpm: number;
  by_day: RevenuePoint[];
  by_source: { source: string; revenue: number }[];
  by_country: { country: string; revenue: number }[];
}
export async function getRevenueReport(channelId: string, days = 30): Promise<RevenueReport> {
  return request<RevenueReport>(`/api/v1/videos/analytics/channels/${channelId}/revenue?days=${days}`);
}

export interface ForecastPoint { day: string; predicted_views: number; predicted_revenue: number; }
export interface PredictiveAnalytics {
  next_7_days: ForecastPoint[];
  next_30_days_summary: { predicted_views: number; predicted_revenue: number };
  trend: 'growing' | 'declining' | 'stable';
  growth_rate: number;
  confidence: number;
}
export async function getPredictiveAnalytics(channelId: string): Promise<PredictiveAnalytics> {
  return request<PredictiveAnalytics>(`/api/v1/videos/analytics/channels/${channelId}/predictive`);
}

export interface ChurnAnalysis {
  total_subscribers: number; churned_30d: number; churn_rate_30d: number;
  retention_rate_30d: number; new_30d: number; net_growth_30d: number;
  monthly_series: { month: string; churned: number; new: number; net: number }[];
}
export async function getChurnRate(channelId: string): Promise<ChurnAnalysis> {
  return request<ChurnAnalysis>(`/api/v1/videos/analytics/channels/${channelId}/churn`);
}

export interface LtvResult {
  avg_ltv: number; total_ltv: number; cohort_count: number;
  by_cohort: { cohort_month: string; users: number; avg_ltv: number; total_ltv: number }[];
  arpu: number; avg_lifetime_months: number;
}
export async function getLifetimeValue(channelId: string): Promise<LtvResult> {
  return request<LtvResult>(`/api/v1/videos/analytics/channels/${channelId}/ltv`);
}

export interface CohortRow { cohort_month: string; users: number; periods: number[]; }
export interface CohortAnalysis { cohorts: CohortRow[]; avg_retention: number[]; }
export async function getCohortAnalysis(channelId: string): Promise<CohortAnalysis> {
  return request<CohortAnalysis>(`/api/v1/videos/analytics/channels/${channelId}/cohort`);
}

export interface FunnelStep { step: string; label: string; count: number; drop_from_prev: number; conversion_from_start: number; }
export interface FunnelAnalysis { steps: FunnelStep[]; total_sessions: number; conversion_rate: number; }
export async function getFunnelAnalysis(channelId: string, days = 30): Promise<FunnelAnalysis> {
  return request<FunnelAnalysis>(`/api/v1/videos/analytics/channels/${channelId}/funnel?days=${days}`);
}

export interface CompletionRateReport {
  overall_completion_rate: number;
  by_video: { video_id: string; title: string | null; starts: number; completions: number; rate: number }[];
  by_day: { day: string; starts: number; completions: number; rate: number }[];
}
export async function getCompletionRate(channelId: string, days = 30): Promise<CompletionRateReport> {
  return request<CompletionRateReport>(`/api/v1/videos/analytics/channels/${channelId}/completion?days=${days}`);
}

export interface RewatchReport {
  total_rewatches: number; rewatch_rate: number;
  top_rewatched: { video_id: string; title: string | null; rewatches: number; unique_viewers: number }[];
}
export async function getRewatchAnalytics(channelId: string, days = 30): Promise<RewatchReport> {
  return request<RewatchReport>(`/api/v1/videos/analytics/channels/${channelId}/rewatch?days=${days}`);
}

export interface DropOffBucket { percent_bucket: string; drops: number; percent_of_total: number; }
export interface DropOffReport { buckets: DropOffBucket[]; avg_watch_percent: number; worst_drop_bucket: string | null; }
export async function getDropOffPoints(channelId: string, days = 30): Promise<DropOffReport> {
  return request<DropOffReport>(`/api/v1/videos/analytics/channels/${channelId}/dropoff?days=${days}`);
}

export interface ClickTrackingReport {
  total_clicks: number;
  by_target: { target: string; clicks: number; percent: number }[];
  by_video: { video_id: string; clicks: number }[];
  recent: { id: string; user_id: string | null; session_id: string | null; event_data: any; created_at: string }[];
}
export async function getClickTracking(channelId: string, days = 30): Promise<ClickTrackingReport> {
  return request<ClickTrackingReport>(`/api/v1/videos/analytics/channels/${channelId}/clicks?days=${days}`);
}

export interface ScrollDepthBucket { depth_bucket: string; sessions: number; percent: number; }
export interface ScrollDepthReport { total_sessions: number; avg_max_depth: number; buckets: ScrollDepthBucket[]; reached_bottom_rate: number; }
export async function getScrollDepth(channelId: string, days = 30): Promise<ScrollDepthReport> {
  return request<ScrollDepthReport>(`/api/v1/videos/analytics/channels/${channelId}/scroll?days=${days}`);
}

export interface SessionSummary {
  session_id: string; user_id: string | null;
  started_at: string; ended_at: string;
  event_count: number; videos_watched: number;
}
export async function listRecentSessions(channelId: string, days = 7, limit = 50): Promise<{ sessions: SessionSummary[] }> {
  return request<{ sessions: SessionSummary[] }>(`/api/v1/videos/analytics/channels/${channelId}/sessions?days=${days}&limit=${limit}`);
}

export interface SessionTimeline {
  session_id: string; user_id: string | null;
  started_at: string; ended_at: string; duration_seconds: number;
  events: { id: string; event_type: string; event_data: any; video_id: string | null; created_at: string }[];
  videos_watched: number; total_watch_seconds: number;
}
export async function getSessionTimeline(sessionId: string): Promise<SessionTimeline> {
  return request<SessionTimeline>(`/api/v1/videos/analytics/sessions/${sessionId}/timeline`);
}

export interface HeatmapCell { bucket_start_seconds: number; bucket_end_seconds: number; views: number; clicks: number; avg_intensity: number; }
export interface HeatmapReport {
  cells: HeatmapCell[];
  bucket_size_seconds: number;
  total_video_seconds: number;
  peak_bucket_start: number;
  peak_intensity: number;
}
export async function getHeatmap(channelId: string, videoId: string, duration: number, bucket = 15, days = 30): Promise<HeatmapReport> {
  return request<HeatmapReport>(`/api/v1/videos/analytics/channels/${channelId}/heatmap/${videoId}?duration=${duration}&bucket=${bucket}&days=${days}`);
}

export type AnalyticsExportReport =
  | 'overview' | 'demographics' | 'traffic' | 'revenue'
  | 'completion' | 'rewatch' | 'dropoff' | 'click' | 'scroll'
  | 'cohort' | 'funnel' | 'churn' | 'ltv' | 'predictive';

export function analyticsExportUrl(channelId: string, report: AnalyticsExportReport, format: 'csv' | 'json' = 'csv', days = 30): string {
  return `/api/v1/videos/analytics/channels/${channelId}/export?report=${report}&format=${format}&days=${days}`;
}

export async function updateAnalyticsProfile(patch: {
  birth_year?: number;
  gender?: 'male' | 'female' | 'other' | 'prefer_not';
  country?: string;
  language?: string;
  interests?: string[];
}): Promise<any> {
  return request<any>('/api/v1/videos/analytics/profile', { method: 'PUT', body: JSON.stringify(patch) });
}

// ============ Creator Analytics ============
export interface AnalyticsOverview {
  total_videos: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  total_subscribers: number;
  total_watch_time_seconds: number;
  avg_views_per_video: number;
  avg_completion_rate: number;
}

export interface DailyPoint {
  date: string;
  views: number;
  likes: number;
  comments: number;
}

export interface TopVideo {
  id: string;
  title: string;
  thumbnail_url: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  duration_seconds: number;
  created_at: string;
}

export interface RevenueBreakdown {
  super_chat: number;
  membership: number;
  ads: number;
  total: number;
}

export interface SubscriberPoint {
  date: string;
  total: number;
}

export interface AnalyticsData {
  overview: AnalyticsOverview;
  series: DailyPoint[];
  top: TopVideo[];
  revenue: RevenueBreakdown;
  growth: SubscriberPoint[];
  days: number;
  channel_id?: string;
}

export async function getMyAnalytics(days = 30): Promise<AnalyticsData> {
  return request<AnalyticsData>(`/api/v1/videos/analytics/me?days=${days}`);
}

export async function getChannelAnalytics(channelId: string, days = 30): Promise<AnalyticsData> {
  return request<AnalyticsData>(`/api/v1/videos/analytics/channel/${channelId}?days=${days}`);
}

// ============ Customer Support ============
export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  order_index: number;
}

export async function listFaq(category?: string): Promise<{ faq: FaqItem[]; categories: string[] }> {
  const url = category
    ? `/api/v1/videos/support/faq?category=${encodeURIComponent(category)}`
    : '/api/v1/videos/support/faq';
  return request<{ faq: FaqItem[]; categories: string[] }>(url);
}

export async function askChatbot(message: string, conversationId?: string): Promise<{ reply: string; conversation_id: string }> {
  return request<{ reply: string; conversation_id: string }>('/api/v1/videos/support/chatbot', {
    method: 'POST',
    body: JSON.stringify({ message, conversation_id: conversationId }),
  });
}

export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_type: 'user' | 'admin';
  sender_id: string | null;
  sender_name: string;
  content: string;
  created_at: string;
}

export async function createSupportTicket(input: {
  subject: string;
  message: string;
  category?: string;
  priority?: string;
}): Promise<SupportTicket> {
  return request<SupportTicket>('/api/v1/videos/support/tickets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listMySupportTickets(): Promise<{ tickets: SupportTicket[] }> {
  return request<{ tickets: SupportTicket[] }>('/api/v1/videos/support/tickets/me');
}

export async function getSupportTicket(id: string): Promise<{ ticket: SupportTicket; messages: SupportMessage[] }> {
  return request<{ ticket: SupportTicket; messages: SupportMessage[] }>(`/api/v1/videos/support/tickets/${id}`);
}

export async function replySupportTicket(id: string, content: string): Promise<SupportMessage> {
  return request<SupportMessage>(`/api/v1/videos/support/tickets/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

// ============ Web Push Notifications ============
export async function getPushPublicKey(): Promise<{ publicKey: string }> {
  return request<{ publicKey: string }>('/api/v1/videos/push/public-key');
}

export async function subscribePush(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}): Promise<any> {
  return request<any>('/api/v1/videos/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function unsubscribePush(endpoint: string): Promise<{ unsubscribed: boolean }> {
  return request<{ unsubscribed: boolean }>('/api/v1/videos/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint }),
  });
}

export async function listMyPushSubscriptions(): Promise<{ subscriptions: any[] }> {
  return request<{ subscriptions: any[] }>('/api/v1/videos/push/my-subscriptions');
}

export async function sendTestPush(): Promise<{ sent: number; failed: number; removed: number }> {
  return request<{ sent: number; failed: number; removed: number }>('/api/v1/videos/push/test', {
    method: 'POST',
  });
}

// ============ Email Verification ============
export async function verifyEmailToken(token: string): Promise<{ verified: boolean; user_id: string; email: string }> {
  return request<{ verified: boolean; user_id: string; email: string }>('/api/auth/email/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}


// ========== Video Chapters ==========
export interface Chapter {
  id: string;
  video_id: string;
  start_seconds: number;
  title: string;
  order_index: number;
  created_at: string;
}

export interface ChaptersResult {
  chapters: Chapter[];
  source: 'manual' | 'auto' | 'none';
}

export async function getChapters(videoId: string): Promise<ChaptersResult> {
  return request<ChaptersResult>(`/api/v1/videos/${videoId}/chapters`);
}

export async function setChapters(videoId: string, chapters: { start_seconds: number; title: string }[]): Promise<ChaptersResult> {
  return request<ChaptersResult>(`/api/v1/videos/${videoId}/chapters`, {
    method: 'PUT',
    body: JSON.stringify({ chapters }),
  });
}

export async function clearChapters(videoId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/videos/${videoId}/chapters`, {
    method: 'DELETE',
  });
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ============================================================
// Live TV — Section 40 (channels, EPG, schedule, switch, imports)
// ============================================================

export interface LiveTvChannel {
  id: string;
  owner_id: string;
  name: string;
  stream_url: string;
  logo_url: string | null;
  category: string | null;
  country: string | null;
  language: string | null;
  tvg_id: string | null;
  tvg_name: string | null;
  description: string | null;
  is_active: number;
  is_public: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface LiveTvEpgEntry {
  id: string;
  channel_id: string;
  start_ts: string;
  stop_ts: string;
  title: string;
  description: string | null;
  category: string | null;
  episode_num: string | null;
}

export interface LiveTvWatchState {
  user_id: string;
  channel_id: string;
  position_seconds: number;
  device: string | null;
  updated_at: string;
  channel: LiveTvChannel | null;
}

export interface LiveTvRecentChannel {
  channel_id: string;
  last_watched_at: string;
  watch_count: number;
  channel: LiveTvChannel | null;
}

export interface LiveTvScheduleSlot {
  channel_id: string;
  channel_name: string;
  channel_logo: string | null;
  category: string | null;
  now: LiveTvEpgEntry | null;
  up_next: LiveTvEpgEntry[];
}

export interface LiveTvListFilters {
  category?: string;
  country?: string;
  language?: string;
  owner_id?: string;
  limit?: number;
}

export interface CreateLiveTvChannelInput {
  name: string;
  stream_url: string;
  logo_url?: string | null;
  category?: string | null;
  country?: string | null;
  language?: string | null;
  tvg_id?: string | null;
  tvg_name?: string | null;
  description?: string | null;
  is_public?: boolean;
  sort_order?: number;
}

// ---- Channels (40.1, 40.6, 40.15) ----

export async function listLiveTvChannels(
  filters: LiveTvListFilters = {}
): Promise<{ channels: LiveTvChannel[]; count: number }> {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.country) params.set('country', filters.country);
  if (filters.language) params.set('language', filters.language);
  if (filters.owner_id) params.set('owner_id', filters.owner_id);
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return request<{ channels: LiveTvChannel[]; count: number }>(
    `/api/v1/videos/live-tv/channels${qs ? '?' + qs : ''}`
  );
}

export async function listLiveTvCategories(): Promise<
  { categories: { category: string; count: number }[] }
> {
  return request('/api/v1/videos/live-tv/categories');
}

export async function getLiveTvChannel(
  id: string
): Promise<{ channel: LiveTvChannel }> {
  return request(`/api/v1/videos/live-tv/channels/${id}`);
}

export async function listMyLiveTvChannels(): Promise<{
  channels: LiveTvChannel[];
  count: number;
}> {
  return request('/api/v1/videos/live-tv/mine');
}

export async function createLiveTvChannel(
  input: CreateLiveTvChannelInput
): Promise<{ channel: LiveTvChannel }> {
  return request('/api/v1/videos/live-tv/channels', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateLiveTvChannel(
  id: string,
  patch: Partial<CreateLiveTvChannelInput> & { is_active?: boolean }
): Promise<{ channel: LiveTvChannel }> {
  return request(`/api/v1/videos/live-tv/channels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteLiveTvChannel(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/v1/videos/live-tv/channels/${id}`, { method: 'DELETE' });
}

// ---- Stream Health (40.16) ----

export async function checkLiveTvHealth(id: string): Promise<{
  health: {
    id: string;
    channel_id: string;
    status: 'ok' | 'error' | 'timeout';
    http_code: number | null;
    response_ms: number;
    error_message: string | null;
    checked_at: string;
  };
}> {
  return request(`/api/v1/videos/live-tv/channels/${id}/health`, { method: 'POST' });
}

// ---- EPG (40.2, 40.14) ----

export async function getLiveTvEpg(
  channelId: string,
  opts: { from?: string; to?: string } = {}
): Promise<{ entries: LiveTvEpgEntry[]; count: number }> {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  const qs = params.toString();
  return request(
    `/api/v1/videos/live-tv/epg/${channelId}${qs ? '?' + qs : ''}`
  );
}

export async function getLiveTvNowPlaying(
  channelId: string,
  at?: string
): Promise<{ entry: LiveTvEpgEntry | null }> {
  const qs = at ? `?at=${encodeURIComponent(at)}` : '';
  return request(`/api/v1/videos/live-tv/epg/${channelId}/now${qs}`);
}

export async function getLiveTvUpNext(
  channelId: string,
  limit = 5
): Promise<{ entries: LiveTvEpgEntry[] }> {
  return request(`/api/v1/videos/live-tv/epg/${channelId}/up-next?limit=${limit}`);
}

// ---- Schedule (40.7) ----

export async function getLiveTvSchedule(opts: {
  at?: string;
  mine?: boolean;
  category?: string;
  limit_channels?: number;
  up_next_limit?: number;
} = {}): Promise<{ at: string; count: number; slots: LiveTvScheduleSlot[] }> {
  const params = new URLSearchParams();
  if (opts.at) params.set('at', opts.at);
  if (opts.mine) params.set('mine', 'true');
  if (opts.category) params.set('category', opts.category);
  if (opts.limit_channels) params.set('limit_channels', String(opts.limit_channels));
  if (opts.up_next_limit) params.set('up_next_limit', String(opts.up_next_limit));
  const qs = params.toString();
  return request(`/api/v1/videos/live-tv/schedule${qs ? '?' + qs : ''}`);
}

// ---- Channel Switching / Watch State (40.3) ----

export async function switchLiveTvChannel(
  channelId: string,
  opts: { device?: string; resume?: boolean } = {}
): Promise<{
  channel: LiveTvChannel;
  resumed_at_seconds: number;
  previous_channel_id: string | null;
}> {
  return request(`/api/v1/videos/live-tv/switch/${channelId}`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function getLiveTvState(): Promise<{ state: LiveTvWatchState | null }> {
  return request('/api/v1/videos/live-tv/state');
}

export async function updateLiveTvPosition(
  position_seconds: number
): Promise<{ updated: boolean }> {
  return request('/api/v1/videos/live-tv/state/position', {
    method: 'PATCH',
    body: JSON.stringify({ position_seconds }),
  });
}

export async function clearLiveTvState(): Promise<{ cleared: boolean }> {
  return request('/api/v1/videos/live-tv/state', { method: 'DELETE' });
}

export async function listRecentLiveTvChannels(
  limit = 10
): Promise<{ recent: LiveTvRecentChannel[]; count: number }> {
  return request(`/api/v1/videos/live-tv/recent?limit=${limit}`);
}

// ---- Imports (40.13, 40.14) ----

export async function importLiveTvM3U(
  playlist: string,
  opts: {
    replace_existing?: boolean;
    skip_duplicates_by_url?: boolean;
    default_category?: string | null;
    is_public?: boolean;
  } = {}
): Promise<{
  parsed: number;
  inserted: number;
  skipped: number;
  errors: string[];
}> {
  return request('/api/v1/videos/live-tv/import/m3u', {
    method: 'POST',
    body: JSON.stringify({ playlist, ...opts }),
  });
}

export async function importLiveTvXmltv(
  xml: string,
  opts: { replace_programs?: boolean } = {}
): Promise<{
  channels_parsed: number;
  programs_parsed: number;
  channels_upserted: number;
  programs_inserted: number;
  programs_skipped: number;
  errors: string[];
}> {
  return request('/api/v1/videos/live-tv/import/xmltv', {
    method: 'POST',
    body: JSON.stringify({ xml, ...opts }),
  });
}

// ---- Channel Favorites (40.11) ----

export interface LiveTvFavorite {
  user_id: string;
  channel_id: string;
  sort_order: number;
  created_at: string;
  channel: LiveTvChannel | null;
}

export async function listLiveTvFavorites(
  limit = 200
): Promise<{ favorites: LiveTvFavorite[]; count: number }> {
  return request(`/api/v1/videos/live-tv/favorites?limit=${limit}`);
}

export async function addLiveTvFavorite(
  channelId: string
): Promise<{ favorite: LiveTvFavorite }> {
  return request(`/api/v1/videos/live-tv/favorites/${channelId}`, { method: 'POST' });
}

export async function removeLiveTvFavorite(
  channelId: string
): Promise<{ removed: boolean }> {
  return request(`/api/v1/videos/live-tv/favorites/${channelId}`, { method: 'DELETE' });
}

export async function toggleLiveTvFavorite(
  channelId: string
): Promise<{ favorited: boolean }> {
  return request(`/api/v1/videos/live-tv/favorites/${channelId}/toggle`, { method: 'POST' });
}

export async function isLiveTvFavorite(
  channelId: string
): Promise<{ favorited: boolean }> {
  return request(`/api/v1/videos/live-tv/favorites/${channelId}`);
}

export async function setLiveTvFavoriteOrder(
  channelIds: string[]
): Promise<{ updated: boolean }> {
  return request('/api/v1/videos/live-tv/favorites/order', {
    method: 'PUT',
    body: JSON.stringify({ channel_ids: channelIds }),
  });
}

// ---- Parental Control (40.12) ----

export interface LiveTvParentalSettings {
  has_pin: boolean;
  max_age_rating: number;
  unlocked: boolean;
  updated_at: string | null;
}

export interface LiveTvBlockedChannel {
  channel_id: string;
  channel: LiveTvChannel | null;
  created_at: string;
}

export interface LiveTvAccessCheck {
  allowed: boolean;
  reason: 'ok' | 'blocked' | 'age' | 'unlocked';
  channel_age_rating: number;
  max_age_rating: number;
  requires_pin: boolean;
}

export async function getLiveTvParental(): Promise<LiveTvParentalSettings> {
  return request('/api/v1/videos/live-tv/parental');
}

export async function setLiveTvPin(
  pin: string,
  maxAgeRating?: number
): Promise<{ has_pin: boolean; max_age_rating: number }> {
  return request('/api/v1/videos/live-tv/parental/pin', {
    method: 'POST',
    body: JSON.stringify({ pin, max_age_rating: maxAgeRating }),
  });
}

export async function changeLiveTvPin(
  currentPin: string,
  newPin: string
): Promise<{ changed: boolean }> {
  return request('/api/v1/videos/live-tv/parental/pin/change', {
    method: 'POST',
    body: JSON.stringify({ current_pin: currentPin, new_pin: newPin }),
  });
}

export async function removeLiveTvPin(pin: string): Promise<{ removed: boolean }> {
  return request('/api/v1/videos/live-tv/parental/pin', {
    method: 'DELETE',
    body: JSON.stringify({ pin }),
  });
}

export async function updateLiveTvMaxAge(
  maxAgeRating: number
): Promise<{ max_age_rating: number }> {
  return request('/api/v1/videos/live-tv/parental/max-age', {
    method: 'PATCH',
    body: JSON.stringify({ max_age_rating: maxAgeRating }),
  });
}

export async function unlockLiveTvParental(
  pin: string
): Promise<{ unlocked_until: string }> {
  return request('/api/v1/videos/live-tv/parental/unlock', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

export async function lockLiveTvParental(): Promise<{ locked: boolean }> {
  return request('/api/v1/videos/live-tv/parental/lock', { method: 'POST' });
}

export async function verifyLiveTvPin(pin: string): Promise<{ valid: boolean }> {
  return request('/api/v1/videos/live-tv/parental/verify', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
}

export async function listLiveTvBlocked(): Promise<{
  blocked: LiveTvBlockedChannel[];
  count: number;
}> {
  return request('/api/v1/videos/live-tv/parental/blocked');
}

export async function blockLiveTvChannel(
  channelId: string
): Promise<{ blocked: boolean }> {
  return request(`/api/v1/videos/live-tv/parental/blocked/${channelId}`, { method: 'POST' });
}

export async function unblockLiveTvChannel(
  channelId: string
): Promise<{ unblocked: boolean }> {
  return request(`/api/v1/videos/live-tv/parental/blocked/${channelId}`, { method: 'DELETE' });
}

export async function getLiveTvChannelAccess(
  channelId: string
): Promise<LiveTvAccessCheck> {
  return request(`/api/v1/videos/live-tv/channels/${channelId}/access`);
}

export async function setLiveTvChannelAgeRating(
  channelId: string,
  ageRating: number
): Promise<{ channel: LiveTvChannel }> {
  return request(`/api/v1/videos/live-tv/channels/${channelId}/age-rating`, {
    method: 'PATCH',
    body: JSON.stringify({ max_age_rating: ageRating }),
  });
}

// ---- Live TV Chat (40.9) ----

export interface LiveTvChatMessage {
  id: string;
  channel_id: string;
  user_id: string;
  content: string;
  is_hidden: number;
  created_at: string;
}

export async function listLiveTvChat(
  channelId: string,
  opts: { limit?: number; since?: string } = {}
): Promise<{ chat: LiveTvChatMessage[]; count: number; recent_per_minute: number }> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.since) params.set('since', opts.since);
  const qs = params.toString();
  return request(`/api/v1/videos/live-tv/chat/${channelId}${qs ? '?' + qs : ''}`);
}

export async function postLiveTvChat(
  channelId: string,
  content: string
): Promise<{ message: LiveTvChatMessage }> {
  return request(`/api/v1/videos/live-tv/chat/${channelId}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function deleteLiveTvChatMessage(
  messageId: string
): Promise<{ removed: boolean }> {
  return request(`/api/v1/videos/live-tv/chat/messages/${messageId}`, {
    method: 'DELETE',
  });
}

export async function reportLiveTvChatMessage(
  messageId: string,
  reason?: string
): Promise<{ reported: boolean }> {
  return request(`/api/v1/videos/live-tv/chat/messages/${messageId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function hideLiveTvChatMessage(
  messageId: string
): Promise<{ hidden: boolean }> {
  return request(`/api/v1/videos/live-tv/chat/messages/${messageId}/hide`, {
    method: 'POST',
  });
}

// ============================================================
// Sports (Section 68)
// ============================================================

export interface SportsTeam {
  id: string;
  owner_id: string;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  country: string | null;
  created_at: string;
}

export type SportsMatchStatus = 'scheduled' | 'live' | 'halftime' | 'finished' | 'postponed' | 'cancelled';

export interface SportsMatch {
  id: string;
  owner_id: string;
  channel_id: string;
  home_team_id: string;
  away_team_id: string;
  league: string | null;
  venue: string | null;
  start_ts: string;
  status: SportsMatchStatus;
  home_score: number;
  away_score: number;
  minute: number | null;
  period: string | null;
  overlay_style: string;
  created_at: string;
  updated_at: string;
}

export type SportsEventType = 'goal' | 'own_goal' | 'yellow_card' | 'red_card' | 'substitution' | 'penalty' | 'var' | 'kickoff' | 'halftime' | 'fulltime' | 'info';

export interface SportsTimelineEvent {
  id: string;
  match_id: string;
  team_id: string | null;
  event_type: SportsEventType;
  minute: number | null;
  player_name: string | null;
  player_out: string | null;
  description: string | null;
  created_at: string;
}

export interface SportsReminder {
  id: string;
  user_id: string;
  match_id: string;
  remind_at: string;
  sent_at: string | null;
  channel: 'push' | 'email' | 'inapp';
  created_at: string;
}

export interface SportsReplayClip {
  id: string;
  match_id: string;
  user_id: string;
  label: string;
  start_ts: string;
  duration_seconds: number;
  event_id: string | null;
  is_public: number;
  created_at: string;
}

// Teams
export async function listSportsTeams(limit = 200): Promise<{ teams: SportsTeam[]; count: number }> {
  return request(`/api/v1/videos/sports/teams?limit=${limit}`);
}

export async function createSportsTeam(input: {
  name: string;
  short_name?: string | null;
  logo_url?: string | null;
  country?: string | null;
}): Promise<{ team: SportsTeam }> {
  return request('/api/v1/videos/sports/teams', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Matches
export async function listSportsMatches(filters: {
  owner_id?: string;
  channel_id?: string;
  status?: SportsMatchStatus;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<{ matches: SportsMatch[]; count: number }> {
  const params = new URLSearchParams();
  if (filters.owner_id) params.set('owner_id', filters.owner_id);
  if (filters.channel_id) params.set('channel_id', filters.channel_id);
  if (filters.status) params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return request(`/api/v1/videos/sports/matches${qs ? '?' + qs : ''}`);
}

export async function listLiveSportsMatches(): Promise<{ matches: SportsMatch[]; count: number }> {
  return request('/api/v1/videos/sports/matches/live');
}

export async function getSportsMatch(id: string): Promise<{ match: SportsMatch }> {
  return request(`/api/v1/videos/sports/matches/${id}`);
}

export async function createSportsMatch(input: {
  channel_id: string;
  home_team_id: string;
  away_team_id: string;
  league?: string | null;
  venue?: string | null;
  start_ts: string;
  overlay_style?: string;
}): Promise<{ match: SportsMatch }> {
  return request('/api/v1/videos/sports/matches', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateSportsMatchStatus(
  id: string,
  patch: { status: SportsMatchStatus; minute?: number | null; period?: string | null }
): Promise<{ match: SportsMatch }> {
  return request(`/api/v1/videos/sports/matches/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function updateSportsScore(
  id: string,
  patch: { home_score: number; away_score: number; minute?: number | null }
): Promise<{ match: SportsMatch }> {
  return request(`/api/v1/videos/sports/matches/${id}/score`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

// Timeline
export async function listSportsTimeline(
  matchId: string,
  limit = 200
): Promise<{ events: SportsTimelineEvent[]; count: number }> {
  return request(`/api/v1/videos/sports/matches/${matchId}/timeline?limit=${limit}`);
}

export async function addSportsTimelineEvent(
  matchId: string,
  input: {
    team_id?: string | null;
    event_type: SportsEventType;
    minute?: number | null;
    player_name?: string | null;
    player_out?: string | null;
    description?: string | null;
  }
): Promise<{ event: SportsTimelineEvent }> {
  return request(`/api/v1/videos/sports/matches/${matchId}/timeline`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteSportsTimelineEvent(eventId: string): Promise<{ removed: boolean }> {
  return request(`/api/v1/videos/sports/timeline/${eventId}`, { method: 'DELETE' });
}

// Reminders
export async function listSportsReminders(limit = 100): Promise<{ reminders: SportsReminder[]; count: number }> {
  return request(`/api/v1/videos/sports/reminders?limit=${limit}`);
}

export async function createSportsReminder(input: {
  match_id: string;
  remind_at: string;
  channel?: 'push' | 'email' | 'inapp';
}): Promise<{ reminder: SportsReminder }> {
  return request('/api/v1/videos/sports/reminders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function cancelSportsReminder(id: string): Promise<{ removed: boolean }> {
  return request(`/api/v1/videos/sports/reminders/${id}`, { method: 'DELETE' });
}

// Replays
export async function listSportsReplays(
  matchId: string,
  limit = 100
): Promise<{ replays: SportsReplayClip[]; count: number }> {
  return request(`/api/v1/videos/sports/matches/${matchId}/replays?limit=${limit}`);
}

export async function listMySportsReplays(limit = 100): Promise<{ replays: SportsReplayClip[]; count: number }> {
  return request(`/api/v1/videos/sports/replays/mine?limit=${limit}`);
}

export async function saveSportsReplay(input: {
  match_id: string;
  label: string;
  start_ts: string;
  duration_seconds: number;
  event_id?: string | null;
  is_public?: boolean;
}): Promise<{ replay: SportsReplayClip }> {
  return request('/api/v1/videos/sports/replays', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function rewindSportsMatch(
  matchId: string,
  seconds: number
): Promise<{ allowed: boolean; reason: string; at_ts: string; seconds: number; segments: any[] }> {
  return request(`/api/v1/videos/sports/matches/${matchId}/rewind`, {
    method: 'POST',
    body: JSON.stringify({ seconds }),
  });
}

// ============================================================
// Radio (Section 124)
// ============================================================

export interface RadioStation {
  id: string;
  owner_id: string;
  name: string;
  stream_url: string;
  logo_url: string | null;
  genre: string | null;
  country: string | null;
  language: string | null;
  description: string | null;
  bitrate_kbps: number | null;
  sample_rate_hz: number | null;
  is_active: number;
  is_public: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface RadioHealth {
  id: string;
  station_id: string;
  status: 'ok' | 'error' | 'timeout';
  http_code: number | null;
  response_ms: number;
  error_message: string | null;
  checked_at: string;
}

export interface RadioJingle {
  id: string;
  station_id: string;
  owner_id: string;
  name: string;
  audio_url: string;
  duration_seconds: number;
  jingle_type: 'intro' | 'outro' | 'transition' | 'ad_break' | 'station_id' | 'news';
  weight: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RadioScheduleSlot {
  id: string;
  station_id: string;
  owner_id: string;
  title: string;
  kind: 'show' | 'music_rotation' | 'jingle' | 'ad_break' | 'news';
  day_of_week: number | null;
  start_minute: number;
  duration_minutes: number;
  playlist_url: string | null;
  jingle_id: string | null;
  description: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RadioTrackPlay {
  id: string;
  station_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration_seconds: number;
  played_at: string;
  source: 'playlist' | 'live' | 'manual' | 'schedule';
  cover_url: string | null;
  metadata_json: string | null;
  created_at: string;
}

// Stations
export async function listRadioStations(filters: {
  genre?: string;
  country?: string;
  language?: string;
  owner_id?: string;
  search?: string;
  limit?: number;
} = {}): Promise<{ stations: RadioStation[]; count: number }> {
  const params = new URLSearchParams();
  if (filters.genre) params.set('genre', filters.genre);
  if (filters.country) params.set('country', filters.country);
  if (filters.language) params.set('language', filters.language);
  if (filters.owner_id) params.set('owner_id', filters.owner_id);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return request(`/api/v1/videos/radio/stations${qs ? '?' + qs : ''}`);
}

export async function listRadioGenres(): Promise<{ genres: { genre: string; count: number }[] }> {
  return request('/api/v1/videos/radio/genres');
}

export async function getRadioStation(id: string): Promise<{ station: RadioStation }> {
  return request(`/api/v1/videos/radio/stations/${id}`);
}

export async function createRadioStation(input: {
  name: string;
  stream_url: string;
  logo_url?: string | null;
  genre?: string | null;
  country?: string | null;
  language?: string | null;
  description?: string | null;
  bitrate_kbps?: number | null;
  sample_rate_hz?: number | null;
  is_public?: boolean;
}): Promise<{ station: RadioStation }> {
  return request('/api/v1/videos/radio/stations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function checkRadioHealth(id: string): Promise<{ health: RadioHealth }> {
  return request(`/api/v1/videos/radio/stations/${id}/health`, { method: 'POST' });
}

export async function getRadioHealth(id: string): Promise<{ health: RadioHealth | null }> {
  return request(`/api/v1/videos/radio/stations/${id}/health`);
}

// Now Playing / History
export async function getRadioNowPlaying(id: string): Promise<{ play: RadioTrackPlay | null }> {
  return request(`/api/v1/videos/radio/stations/${id}/now-playing`);
}

export async function listRadioHistory(
  id: string,
  opts: { from?: string; to?: string; artist?: string; search?: string; limit?: number } = {}
): Promise<{ plays: RadioTrackPlay[]; count: number }> {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.artist) params.set('artist', opts.artist);
  if (opts.search) params.set('search', opts.search);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request(`/api/v1/videos/radio/stations/${id}/history${qs ? '?' + qs : ''}`);
}

export async function getRadioHistoryStats(id: string): Promise<{
  total_plays: number;
  last_24h_plays: number;
  top_artists: { artist: string; count: number }[];
  top_titles: { title: string; artist: string | null; count: number }[];
}> {
  return request(`/api/v1/videos/radio/stations/${id}/history/stats`);
}

// Schedule
export async function listRadioSchedule(
  stationId: string,
  opts: { day_of_week?: number; active_only?: boolean; limit?: number } = {}
): Promise<{ slots: RadioScheduleSlot[]; count: number }> {
  const params = new URLSearchParams();
  if (opts.day_of_week !== undefined) params.set('day_of_week', String(opts.day_of_week));
  if (opts.active_only === false) params.set('active_only', 'false');
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request(`/api/v1/videos/radio/stations/${stationId}/schedule${qs ? '?' + qs : ''}`);
}

export async function getRadioScheduleNow(stationId: string, at?: string): Promise<{
  now: RadioScheduleSlot | null;
  next: RadioScheduleSlot | null;
  server_time: string;
  minute_of_day: number;
  day_of_week: number;
}> {
  const qs = at ? `?at=${encodeURIComponent(at)}` : '';
  return request(`/api/v1/videos/radio/stations/${stationId}/schedule/now${qs}`);
}

// ============================================================
// Live TV — DVR (40.4), Time-Shift (40.5), Catch-Up (40.8)
// ============================================================

export type RecordingStatus = 'scheduled' | 'recording' | 'completed' | 'failed' | 'cancelled';

export interface LiveTvRecording {
  id: string;
  channel_id: string;
  user_id: string;
  title: string;
  start_ts: string;
  stop_ts: string;
  status: RecordingStatus;
  file_path: string | null;
  file_size_bytes: number;
  duration_seconds: number;
  pid: number | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordingStats {
  total: number;
  scheduled: number;
  recording: number;
  completed: number;
  failed: number;
  total_bytes: number;
}

export interface TimeshiftWindow {
  channel_id: string;
  window_seconds: number;
  earliest_ts: string | null;
  latest_ts: string | null;
  segment_count: number;
}

export interface TimeshiftSegment {
  id: string;
  channel_id: string;
  segment_path: string;
  start_ts: string;
  duration_seconds: number;
  bytes: number;
  created_at: string;
}

export interface TimeshiftSeekResult {
  allowed: boolean;
  reason: 'ok' | 'before_window' | 'future';
  at_ts: string;
  earliest_ts: string | null;
  latest_ts: string | null;
  segments: TimeshiftSegment[];
}

export interface CatchUpEntry {
  program_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  category: string | null;
  start_ts: string;
  stop_ts: string;
  duration_seconds: number;
  available: boolean;
  recording_id: string | null;
  file_path: string | null;
  replay_url: string | null;
  source: 'recording' | 'none';
}

export interface CatchUpSummary {
  channel_id: string;
  from_ts: string;
  to_ts: string;
  program_count: number;
  available_count: number;
  earliest_available_ts: string | null;
  latest_available_ts: string | null;
}

// DVR
export async function listLiveTvRecordings(opts: {
  status?: RecordingStatus;
  channel_id?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<{ recordings: LiveTvRecording[]; count: number }> {
  const params = new URLSearchParams();
  if (opts.status) params.set('status', opts.status);
  if (opts.channel_id) params.set('channel_id', opts.channel_id);
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request(`/api/v1/videos/live-tv/recordings${qs ? '?' + qs : ''}`);
}

export async function getLiveTvRecordingStats(): Promise<RecordingStats> {
  return request('/api/v1/videos/live-tv/recordings/stats');
}

export async function getLiveTvRecording(id: string): Promise<{ recording: LiveTvRecording }> {
  return request(`/api/v1/videos/live-tv/recordings/${id}`);
}

export async function scheduleLiveTvRecording(input: {
  channel_id: string;
  title?: string;
  start_ts: string;
  stop_ts: string;
}): Promise<{ recording: LiveTvRecording }> {
  return request('/api/v1/videos/live-tv/recordings', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function cancelLiveTvRecording(id: string): Promise<{ cancelled: boolean }> {
  return request(`/api/v1/videos/live-tv/recordings/${id}/cancel`, { method: 'POST' });
}

export async function deleteLiveTvRecording(id: string): Promise<{ deleted: boolean }> {
  return request(`/api/v1/videos/live-tv/recordings/${id}`, { method: 'DELETE' });
}

// Time-Shift
export async function getLiveTvTimeshiftWindow(channelId: string): Promise<TimeshiftWindow> {
  return request(`/api/v1/videos/live-tv/timeshift/window/${channelId}`);
}

export async function listLiveTvTimeshiftSegments(
  channelId: string,
  opts: { from?: string; to?: string } = {}
): Promise<{ segments: TimeshiftSegment[]; count: number }> {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  const qs = params.toString();
  return request(`/api/v1/videos/live-tv/timeshift/segments/${channelId}${qs ? '?' + qs : ''}`);
}

export async function seekLiveTvTimeshift(
  channelId: string,
  at_ts: string
): Promise<TimeshiftSeekResult> {
  return request(`/api/v1/videos/live-tv/timeshift/seek/${channelId}`, {
    method: 'POST',
    body: JSON.stringify({ at_ts }),
  });
}

export async function startLiveTvTimeshiftSession(
  channelId: string
): Promise<{ session: { user_id: string; channel_id: string; session_start_ts: string; last_seen_ts: string } }> {
  return request(`/api/v1/videos/live-tv/timeshift/session/${channelId}`, { method: 'POST' });
}

export async function heartbeatLiveTvTimeshiftSession(): Promise<{ ok: boolean }> {
  return request('/api/v1/videos/live-tv/timeshift/session/heartbeat', { method: 'PATCH' });
}

export async function endLiveTvTimeshiftSession(): Promise<{ ended: boolean }> {
  return request('/api/v1/videos/live-tv/timeshift/session', { method: 'DELETE' });
}

// Catch-Up
export async function getLiveTvCatchUp(
  channelId: string,
  opts: { from?: string; to?: string; limit?: number } = {}
): Promise<{ entries: CatchUpEntry[]; count: number }> {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request(`/api/v1/videos/live-tv/catchup/${channelId}${qs ? '?' + qs : ''}`);
}

export async function getLiveTvCatchUpSummary(
  channelId: string,
  from?: string
): Promise<CatchUpSummary> {
  const qs = from ? `?from=${encodeURIComponent(from)}` : '';
  return request(`/api/v1/videos/live-tv/catchup/${channelId}/summary${qs}`);
}

export async function getLiveTvCatchUpForProgram(programId: string): Promise<{ entry: CatchUpEntry }> {
  return request(`/api/v1/videos/live-tv/catchup/program/${programId}`);
}
