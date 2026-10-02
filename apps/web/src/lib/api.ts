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
