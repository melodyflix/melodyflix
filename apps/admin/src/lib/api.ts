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


// ============ Email Campaigns (27.1) ============
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' | 'failed';
export type AudienceType = 'all' | 'verified' | 'unverified' | 'subscribers' | 'inactive';

export interface EmailCampaign {
  id: string;
  title: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  audience: AudienceType;
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  open_count: number;
  click_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AudienceInfo {
  id: AudienceType;
  label: string;
  desc: string;
  size: number;
}

export interface CampaignStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  open_count: number;
  click_count: number;
  open_rate: number;
  click_rate: number;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  user_id: string;
  email: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
}

export interface CampaignInput {
  title: string;
  subject: string;
  body_html: string;
  body_text?: string | null;
  audience?: AudienceType;
}

export async function listCampaigns(limit = 50): Promise<{ campaigns: EmailCampaign[] }> {
  return request<{ campaigns: EmailCampaign[] }>(`/api/v1/auth/campaigns?limit=${limit}`);
}

export async function getCampaign(id: string): Promise<{ campaign: EmailCampaign; stats: CampaignStats }> {
  return request<{ campaign: EmailCampaign; stats: CampaignStats }>(`/api/v1/auth/campaigns/${id}`);
}

export async function createCampaign(input: CampaignInput): Promise<{ campaign: EmailCampaign }> {
  return request<{ campaign: EmailCampaign }>('/api/v1/auth/campaigns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateCampaign(id: string, patch: Partial<CampaignInput> & { status?: CampaignStatus; scheduled_at?: string | null }): Promise<{ campaign: EmailCampaign }> {
  return request<{ campaign: EmailCampaign }>(`/api/v1/auth/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteCampaign(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/auth/campaigns/${id}`, { method: 'DELETE' });
}

export async function sendCampaign(id: string): Promise<{ total: number; sent: number; failed: number }> {
  return request<{ total: number; sent: number; failed: number }>(`/api/v1/auth/campaigns/${id}/send`, {
    method: 'POST',
  });
}

export async function listCampaignRecipients(id: string, limit = 200): Promise<{ recipients: CampaignRecipient[] }> {
  return request<{ recipients: CampaignRecipient[] }>(`/api/v1/auth/campaigns/${id}/recipients?limit=${limit}`);
}

export async function listAudiences(): Promise<{ audiences: AudienceInfo[] }> {
  return request<{ audiences: AudienceInfo[] }>('/api/v1/auth/campaigns/audiences');
}

// ============ Influencer Dashboard (27.3) ============
export type InfluencerTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface Influencer {
  user_id: string;
  tier: InfluencerTier;
  notes: string | null;
  marked_by: string;
  created_at: string;
  updated_at: string;
}

export interface InfluencerMetrics {
  user_id: string;
  username: string | null;
  email: string | null;
  display_name: string | null;
  tier: InfluencerTier;
  channel_count: number;
  subscriber_count: number;
  video_count: number;
  total_views: number;
  total_likes: number;
  total_comments: number;
  referral_invited: number;
  referral_completed: number;
  referral_earned: number;
  estimated_earnings: number;
  engagement_rate: number;
  created_at: string;
}

export interface InfluencerListItem extends InfluencerMetrics {
  marked_at: string;
  notes: string | null;
}

export interface CandidateCreator {
  user_id: string;
  username: string | null;
  display_name: string | null;
  subscriber_count: number;
  video_count: number;
  total_views: number;
  suggested_tier: InfluencerTier;
  is_influencer: boolean;
}

export interface TierInfo {
  id: InfluencerTier;
  label: string;
  min_subs: number;
}

export async function listInfluencerTiers(): Promise<{ tiers: TierInfo[] }> {
  return request<{ tiers: TierInfo[] }>('/api/v1/auth/admin/influencers/tiers');
}

export async function listInfluencers(limit = 100): Promise<{ influencers: InfluencerListItem[] }> {
  return request<{ influencers: InfluencerListItem[] }>(`/api/v1/auth/admin/influencers?limit=${limit}`);
}

export async function listInfluencerCandidates(minSubs = 1000): Promise<{ candidates: CandidateCreator[] }> {
  return request<{ candidates: CandidateCreator[] }>(`/api/v1/auth/admin/influencers/candidates?min=${minSubs}`);
}

export async function getInfluencerDetail(userId: string): Promise<{ influencer: Influencer | null; metrics: InfluencerMetrics }> {
  return request<{ influencer: Influencer | null; metrics: InfluencerMetrics }>(`/api/v1/auth/admin/influencers/${userId}`);
}

export async function markInfluencer(userId: string, input: { tier?: InfluencerTier; notes?: string | null } = {}): Promise<{ influencer: Influencer }> {
  return request<{ influencer: Influencer }>(`/api/v1/auth/admin/influencers/${userId}`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateInfluencerTier(userId: string, tier: InfluencerTier): Promise<{ influencer: Influencer }> {
  return request<{ influencer: Influencer }>(`/api/v1/auth/admin/influencers/${userId}/tier`, {
    method: 'PUT',
    body: JSON.stringify({ tier }),
  });
}

export async function unmarkInfluencer(userId: string): Promise<{ unmarked: boolean }> {
  return request<{ unmarked: boolean }>(`/api/v1/auth/admin/influencers/${userId}`, { method: 'DELETE' });
}

// ============ Ad Campaigns (51.x) ============
export type AdFormat = 'banner' | 'overlay' | 'pre-roll' | 'mid-roll' | 'post-roll' | 'native' | 'sponsored-card';
export type AdStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'active' | 'paused' | 'completed' | 'archived';
export type TargetingGender = 'any' | 'male' | 'female' | 'other';

export interface AdCampaign {
  id: string;
  name: string;
  advertiser: string;
  format: AdFormat;
  creative_url: string;
  click_url: string;
  thumbnail_url: string | null;
  cta_text: string | null;
  target_countries: string;
  target_languages: string;
  target_age_min: number;
  target_age_max: number;
  target_gender: TargetingGender;
  target_interests: string;
  target_categories: string;
  starts_at: string | null;
  ends_at: string | null;
  freq_cap_per_user: number;
  freq_cap_window_hours: number;
  freq_cap_per_session: number;
  is_skippable: number;
  skip_after_seconds: number;
  duration_seconds: number;
  pod_id: string | null;
  requires_consent: number;
  consent_scope: string;
  budget_total: number;
  budget_spent: number;
  cpm: number;
  cpc: number;
  status: AdStatus;
  review_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  impression_count: number;
  click_count: number;
  view_count: number;
  completion_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AdPod {
  id: string;
  name: string;
  max_ads: number;
  max_duration_seconds: number;
  ad_break_type: string;
  created_at: string;
}

export interface CampaignAnalytics {
  campaign_id: string;
  impressions: number;
  clicks: number;
  views: number;
  completions: number;
  ctr: number;
  view_rate: number;
  completion_rate: number;
  revenue: number;
  budget_remaining: number;
  avg_cpm_effective: number;
}

export interface DailySeriesPoint {
  day: string;
  impressions: number;
  clicks: number;
  revenue: number;
}

export interface BillingSummary {
  campaign_id: string;
  name: string;
  advertiser: string;
  budget_total: number;
  budget_spent: number;
  impressions: number;
  clicks: number;
  total_revenue: number;
  cpm_effective: number;
  cpc_effective: number;
}

export interface BillingLedgerEntry {
  id: string;
  campaign_id: string;
  entry_type: string;
  amount: number;
  note: string | null;
  created_at: string;
}

export async function listAdFormats(): Promise<{ formats: { id: AdFormat; label: string; description: string }[] }> {
  return request<{ formats: any[] }>('/api/v1/videos/admin/ads/formats');
}

export async function listAdPods(): Promise<{ pods: AdPod[] }> {
  return request<{ pods: AdPod[] }>('/api/v1/videos/admin/ads/pods');
}

export async function createAdPod(input: { name: string; max_ads?: number; max_duration_seconds?: number; ad_break_type?: string }): Promise<{ pod: AdPod }> {
  return request<{ pod: AdPod }>('/api/v1/videos/admin/ads/pods', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteAdPod(id: string): Promise<{ removed: boolean }> {
  return request<{ removed: boolean }>(`/api/v1/videos/admin/ads/pods/${id}`, { method: 'DELETE' });
}

export async function listAdCampaigns(filters: { status?: AdStatus; format?: AdFormat; advertiser?: string; limit?: number } = {}): Promise<{ campaigns: AdCampaign[] }> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.format) qs.set('format', filters.format);
  if (filters.advertiser) qs.set('advertiser', filters.advertiser);
  if (filters.limit) qs.set('limit', String(filters.limit));
  const q = qs.toString();
  return request<{ campaigns: AdCampaign[] }>(`/api/v1/videos/admin/ads/campaigns${q ? '?' + q : ''}`);
}

export async function getAdCampaign(id: string): Promise<{ campaign: AdCampaign; analytics: CampaignAnalytics }> {
  return request<{ campaign: AdCampaign; analytics: CampaignAnalytics }>(`/api/v1/videos/admin/ads/campaigns/${id}`);
}

export async function createAdCampaign(input: Partial<AdCampaign> & { name: string; advertiser: string; format: AdFormat; creative_url: string; click_url: string }): Promise<{ campaign: AdCampaign }> {
  return request<{ campaign: AdCampaign }>('/api/v1/videos/admin/ads/campaigns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAdCampaign(id: string, patch: Partial<AdCampaign>): Promise<{ campaign: AdCampaign }> {
  return request<{ campaign: AdCampaign }>(`/api/v1/videos/admin/ads/campaigns/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteAdCampaign(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/api/v1/videos/admin/ads/campaigns/${id}`, { method: 'DELETE' });
}

export async function submitAdCampaign(id: string): Promise<{ campaign: AdCampaign }> {
  return request<{ campaign: AdCampaign }>(`/api/v1/videos/admin/ads/campaigns/${id}/submit`, { method: 'POST' });
}

export async function approveAdCampaign(id: string): Promise<{ campaign: AdCampaign }> {
  return request<{ campaign: AdCampaign }>(`/api/v1/videos/admin/ads/campaigns/${id}/approve`, { method: 'POST' });
}

export async function rejectAdCampaign(id: string, notes?: string): Promise<{ campaign: AdCampaign }> {
  return request<{ campaign: AdCampaign }>(`/api/v1/videos/admin/ads/campaigns/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export async function setAdCampaignStatus(id: string, status: AdStatus): Promise<{ campaign: AdCampaign }> {
  return request<{ campaign: AdCampaign }>(`/api/v1/videos/admin/ads/campaigns/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export async function getAdCampaignAnalytics(id: string): Promise<{ analytics: CampaignAnalytics; daily: DailySeriesPoint[]; ledger: BillingLedgerEntry[] }> {
  return request<{ analytics: CampaignAnalytics; daily: DailySeriesPoint[]; ledger: BillingLedgerEntry[] }>(`/api/v1/videos/admin/ads/campaigns/${id}/analytics`);
}

export async function getAdBillingReport(filters: { status?: AdStatus; advertiser?: string } = {}): Promise<{ report: BillingSummary[] }> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.advertiser) qs.set('advertiser', filters.advertiser);
  const q = qs.toString();
  return request<{ report: BillingSummary[] }>(`/api/v1/videos/admin/ads/billing${q ? '?' + q : ''}`);
}

