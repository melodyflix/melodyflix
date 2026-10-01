// melodyflix admin - API client
const TOKEN_KEY = 'melodyflix_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data.data;
}

export interface User {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  role: string;
  email_verified: number;
  created_at: string;
}

export interface Channel {
  id: string;
  owner_id: string;
  name: string;
  handle: string;
  description: string | null;
  subscriber_count: number;
  video_count: number;
  is_verified: number;
  created_at: string;
}

export interface HealthStatus {
  service: string;
  status: string;
}

export interface UsersListResponse {
  users: User[];
  total: number;
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
  created_at: string;
}

export interface VideosListResponse {
  videos: Video[];
  total: number;
}


// ========== Video Chapters (admin) ==========
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

export async function adminGetChapters(videoId: string): Promise<ChaptersResult> {
  return request<ChaptersResult>(`/api/v1/videos/admin/chapters/${videoId}`);
}

export async function adminSetChapters(videoId: string, chapters: { start_seconds: number; title: string }[]): Promise<ChaptersResult> {
  return request<ChaptersResult>(`/api/v1/videos/admin/chapters/${videoId}`, {
    method: 'PUT',
    body: JSON.stringify({ chapters }),
  });
}

export async function adminClearChapters(videoId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/v1/videos/admin/chapters/${videoId}`, {
    method: 'DELETE',
  });
}

export function formatChapterTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function parseTimeInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':').map((x) => x.trim());
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (nums.length === 1) return nums[0];
  return null;
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

  // channels
  listChannels: (limit = 50, offset = 0) =>
    request<Channel[]>(`/api/channels?limit=${limit}&offset=${offset}`),

  getMyChannel: () => request<Channel>('/api/channels/me'),

  createChannel: (name: string, handle: string, description?: string) =>
    request<Channel>('/api/channels', {
      method: 'POST',
      body: JSON.stringify({ name, handle, description }),
    }),

  // admin - users
  listUsers: (limit = 50, offset = 0) =>
    request<UsersListResponse>(`/api/admin/users?limit=${limit}&offset=${offset}`),

  changeUserRole: (userId: string, role: string) =>
    request<User>(`/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  deleteUser: (userId: string) =>
    request<{ deleted: boolean }>(`/api/admin/users/${userId}`, { method: 'DELETE' }),

  // videos
  listVideos: (limit = 50, offset = 0) =>
    request<VideosListResponse>(`/api/v1/videos?limit=${limit}&offset=${offset}`),

  getVideo: (id: string) =>
    request<Video>(`/api/v1/videos/${id}`),

  deleteVideo: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/videos/${id}`, { method: 'DELETE' }),

  // health
  healthAuth: () => request<HealthStatus>('/api/auth/health'),
  healthChannel: () => request<HealthStatus>('/api/channels/health'),
};

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
    xhr.open('POST', '/api/v1/videos/upload');
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

// ============ Admin: Reports ============
export interface ReportUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface Report {
  id: string;
  comment_id: string;
  reporter_id: string;
  reason: string;
  note: string | null;
  status: string;
  created_at: string;
  comment_content: string | null;
  comment_author_id: string | null;
  comment_video_id: string | null;
  comment_is_deleted: number | null;
  reporter: ReportUser;
  comment_author: ReportUser | null;
}

export interface ReportsResponse {
  reports: Report[];
  pendingCount: number;
}

export async function listReports(status = 'pending'): Promise<ReportsResponse> {
  return request<ReportsResponse>(`/api/v1/videos/admin/reports?status=${status}`);
}

export async function dismissReport(id: string): Promise<{ status: string }> {
  return request<{ status: string }>(`/api/v1/videos/admin/reports/${id}/dismiss`, {
    method: 'POST',
  });
}

export async function deleteReportedComment(id: string): Promise<{ status: string; commentDeleted: boolean }> {
  return request<{ status: string; commentDeleted: boolean }>(
    `/api/v1/videos/admin/reports/${id}/delete-comment`,
    { method: 'POST' }
  );
}

// ============ Channel Verification ============
export async function verifyChannel(channelId: string): Promise<Channel> {
  return request<Channel>(`/api/channels/admin/${channelId}/verify`, { method: 'POST' });
}

export async function unverifyChannel(channelId: string): Promise<Channel> {
  return request<Channel>(`/api/channels/admin/${channelId}/unverify`, { method: 'POST' });
}

// ============ Ad Networks (external — Adsterra, Monetag, AdSense) ============
export interface AdNetwork {
  id: string;
  name: string;
  vast_tag_url: string;
  type: 'pre-roll' | 'mid-roll' | 'post-roll';
  weight: number;
  active: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export async function listAdNetworks(): Promise<{ networks: AdNetwork[] }> {
  return request<{ networks: AdNetwork[] }>('/api/v1/videos/admin/ad-networks');
}

export async function createAdNetwork(input: {
  name: string;
  vast_tag_url: string;
  type?: 'pre-roll' | 'mid-roll' | 'post-roll';
  weight?: number;
  priority?: number;
}): Promise<AdNetwork> {
  return request<AdNetwork>('/api/v1/videos/admin/ad-networks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAdNetwork(id: string, updates: Partial<{
  name: string;
  vast_tag_url: string;
  type: 'pre-roll' | 'mid-roll' | 'post-roll';
  weight: number;
  priority: number;
  active: number;
}>): Promise<AdNetwork> {
  return request<AdNetwork>(`/api/v1/videos/admin/ad-networks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteAdNetwork(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/admin/ad-networks/${id}`, { method: 'DELETE' });
}

// ============ Internal Ads ============
export interface Ad {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  click_url: string | null;
  type: 'pre-roll' | 'mid-roll' | 'post-roll';
  duration_seconds: number;
  skip_after_seconds: number;
  active: number;
  weight: number;
  impression_count: number;
  click_count: number;
  created_at: string;
  updated_at: string;
}

export async function listAds(): Promise<{ ads: Ad[] }> {
  return request<{ ads: Ad[] }>('/api/v1/videos/admin/ads');
}

export async function createAd(input: {
  title: string;
  description?: string;
  video_url: string;
  click_url?: string;
  type?: 'pre-roll' | 'mid-roll' | 'post-roll';
  duration_seconds?: number;
  skip_after_seconds?: number;
  weight?: number;
}): Promise<Ad> {
  return request<Ad>('/api/v1/videos/admin/ads', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAd(id: string, updates: Partial<Ad>): Promise<Ad> {
  return request<Ad>(`/api/v1/videos/admin/ads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deleteAd(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/admin/ads/${id}`, { method: 'DELETE' });
}

// ============ Payment Gateways ============
export interface PaymentGateway {
  id: string;
  provider: string;
  display_name: string;
  api_key: string | null;
  api_secret: string | null;
  merchant_id: string | null;
  base_url: string | null;
  sandbox: number;
  active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentTransaction {
  id: string;
  gateway_id: string;
  user_id: string;
  purpose: string;
  reference_id: string | null;
  amount: number;
  currency: string;
  status: string;
  external_id: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentStats {
  total_transactions: number;
  completed_transactions: number;
  total_revenue: number;
  revenue_last_30d: number;
}

export async function listPaymentGateways(): Promise<{ gateways: PaymentGateway[] }> {
  return request<{ gateways: PaymentGateway[] }>('/api/v1/videos/admin/payment/gateways');
}

export async function createPaymentGateway(input: {
  provider: string;
  display_name: string;
  api_key?: string;
  api_secret?: string;
  merchant_id?: string;
  base_url?: string;
  sandbox?: boolean;
  active?: boolean;
  is_default?: boolean;
}): Promise<PaymentGateway> {
  return request<PaymentGateway>('/api/v1/videos/admin/payment/gateways', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updatePaymentGateway(id: string, updates: Partial<{
  display_name: string;
  api_key: string;
  api_secret: string;
  merchant_id: string;
  base_url: string;
  sandbox: boolean;
  active: boolean;
  is_default: boolean;
}>): Promise<PaymentGateway> {
  return request<PaymentGateway>(`/api/v1/videos/admin/payment/gateways/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function deletePaymentGateway(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/admin/payment/gateways/${id}`, { method: 'DELETE' });
}

export async function listPaymentTransactions(limit = 100, offset = 0): Promise<{ transactions: PaymentTransaction[]; stats: PaymentStats | null }> {
  return request<{ transactions: PaymentTransaction[]; stats: PaymentStats | null }>(
    `/api/v1/videos/admin/payment/transactions?limit=${limit}&offset=${offset}`
  );
}

export async function completeTransaction(id: string): Promise<PaymentTransaction> {
  return request<PaymentTransaction>(`/api/v1/videos/admin/payment/transactions/${id}/complete`, {
    method: 'POST',
  });
}

// ============ Support Tickets (Admin) ============
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

export interface SupportStats {
  total_tickets: number;
  open_tickets: number;
  in_progress_tickets: number;
  resolved_tickets: number;
  today_tickets: number;
}

export async function listAdminSupportTickets(status?: string): Promise<{ tickets: SupportTicket[]; stats: SupportStats }> {
  const url = status
    ? `/api/v1/videos/admin/support/admin/tickets?status=${status}`
    : '/api/v1/videos/admin/support/admin/tickets';
  return request<{ tickets: SupportTicket[]; stats: SupportStats }>(url);
}

export async function getSupportTicketDetail(id: string): Promise<{ ticket: SupportTicket; messages: SupportMessage[] }> {
  return request<{ ticket: SupportTicket; messages: SupportMessage[] }>(`/api/v1/videos/support/tickets/${id}`);
}

export async function adminReplyTicket(id: string, content: string): Promise<SupportMessage> {
  return request<SupportMessage>(`/api/v1/videos/admin/support/admin/tickets/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export async function updateTicketStatus(id: string, status: string): Promise<SupportTicket> {
  return request<SupportTicket>(`/api/v1/videos/admin/support/admin/tickets/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// ============ SMTP / Email ============
export interface SmtpSettings {
  id: number;
  host: string;
  port: number;
  secure: number;
  username: string;
  password: string;
  from_name: string;
  from_email: string;
  enabled: number;
  updated_at: string;
}

export interface EmailLog {
  id: string;
  user_id: string | null;
  to_email: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: string;
}

export async function getSmtpSettings(): Promise<SmtpSettings | null> {
  return request<SmtpSettings | null>('/api/admin/email/smtp');
}

export async function saveSmtpSettings(input: {
  host: string;
  port?: number;
  secure?: boolean;
  username?: string;
  password?: string;
  from_name?: string;
  from_email: string;
  enabled?: boolean;
}): Promise<SmtpSettings> {
  return request<SmtpSettings>('/api/admin/email/smtp', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function sendTestEmail(to: string): Promise<{ sent: boolean }> {
  return request<{ sent: boolean }>('/api/admin/email/test', {
    method: 'POST',
    body: JSON.stringify({ to }),
  });
}

export async function getEmailLogs(limit = 100): Promise<{ logs: EmailLog[] }> {
  return request<{ logs: EmailLog[] }>(`/api/admin/email/logs?limit=${limit}`);
}

export interface SmtpSettings { id: number; host: string; port: number; secure: number; username: string; password: string; from_name: string; from_email: string; enabled: number; updated_at: string; }
export interface EmailLog { id: string; user_id: string | null; to_email: string; subject: string; status: string; error: string | null; created_at: string; }

export async function getSmtpSettings(): Promise<SmtpSettings | null> {
  return request<SmtpSettings | null>('/api/admin/email/smtp');
}
export async function saveSmtpSettings(input: any): Promise<SmtpSettings> {
  return request<SmtpSettings>('/api/admin/email/smtp', { method: 'POST', body: JSON.stringify(input) });
}
export async function sendTestEmail(to: string): Promise<{ sent: boolean }> {
  return request<{ sent: boolean }>('/api/admin/email/test', { method: 'POST', body: JSON.stringify({ to }) });
}
export async function getEmailLogs(): Promise<{ logs: EmailLog[] }> {
  return request<{ logs: EmailLog[] }>('/api/admin/email/logs');
}
