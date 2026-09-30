// melodyflix videos - customer support service
import { randomUUID } from 'node:crypto';
import { getDb } from '@melodyflix/shared-db';

// ============ FAQ ============
export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  order_index: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export function ensureSupportSchema(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS faq_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_faq_cat ON faq_items(category);

    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      last_message_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_user ON support_tickets(user_id);
    CREATE INDEX IF NOT EXISTS idx_ticket_status ON support_tickets(status);

    CREATE TABLE IF NOT EXISTS support_messages (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_smsg_ticket ON support_messages(ticket_id);

    CREATE TABLE IF NOT EXISTS chatbot_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cbm_conv ON chatbot_messages(conversation_id);
  `);

  // Seed FAQ if empty
  const count = (db.prepare('SELECT COUNT(*) as n FROM faq_items').get() as { n: number }).n;
  if (count === 0) {
    const now = new Date().toISOString();
    const seed: Omit<FaqItem, 'id' | 'created_at' | 'updated_at'>[] = [
      { category: 'Getting Started', question: 'How do I create an account?', answer: 'Click the "Sign in" button at the top right, then select "Create an account". Enter your email, username, and password to get started.', order_index: 1, active: 1 },
      { category: 'Getting Started', question: 'How do I upload my first video?', answer: 'First, create a channel from your profile menu. Then click the 📤 upload icon at the top, select your video file, add a title and description, and click Publish.', order_index: 2, active: 1 },
      { category: 'Getting Started', question: 'Is melodyflix free?', answer: 'Yes! Watching and uploading videos is completely free. Some creators offer paid memberships and Super Chats, but these are optional.', order_index: 3, active: 1 },
      { category: 'Account', question: 'How do I enable 2FA?', answer: 'Go to Avatar menu → Security settings. Click "Enable 2FA" and scan the QR code with Google Authenticator or Authy.', order_index: 1, active: 1 },
      { category: 'Account', question: 'I forgot my password. What do I do?', answer: 'Currently, password reset requires contacting support. Open a ticket and we will help you recover your account.', order_index: 2, active: 1 },
      { category: 'Payments', question: 'Which payment methods do you support?', answer: 'We support bKash, Nagad, Rocket, SSLCommerz (Bangladesh) plus Stripe, PayPal, and Razorpay (international).', order_index: 1, active: 1 },
      { category: 'Payments', question: 'How do I buy a message pack?', answer: 'Go to Avatar → Buy Messages, choose the number of packs, select a payment method, and complete the payment.', order_index: 2, active: 1 },
      { category: 'Payments', question: 'How do I become a member of a channel?', answer: 'Visit any channel page and click the "🏅 Join" button. Choose a tier and complete payment.', order_index: 3, active: 1 },
      { category: 'Live Streaming', question: 'How do I start a live stream?', answer: 'Click the 🔴 icon in the top bar or go to Avatar → Go Live. Choose between camera broadcast or OBS/RTMP.', order_index: 1, active: 1 },
      { category: 'Live Streaming', question: 'Can I use OBS Studio?', answer: 'Yes! In Go Live page, select "OBS / RTMP" mode. Copy the Stream URL and Stream Key into OBS settings.', order_index: 2, active: 1 },
      { category: 'Content', question: 'What is a Short?', answer: 'Shorts are vertical videos under 60 seconds. When uploading, select "Short" as content type to publish to the Shorts feed.', order_index: 1, active: 1 },
      { category: 'Content', question: 'How do podcasts work?', answer: 'When uploading, select "Podcast" as content type. Podcasts appear in the Podcasts section with an audio-first UI.', order_index: 2, active: 1 },
      { category: 'Content', question: 'Can I create a series?', answer: 'Yes. Go to /series and click "New series". Then add seasons and episodes to organize your content.', order_index: 3, active: 1 },
      { category: 'Troubleshooting', question: 'Video won\'t play. What can I do?', answer: 'Try refreshing the page, checking your internet connection, or clearing browser cache. If the issue persists, open a support ticket.', order_index: 1, active: 1 },
      { category: 'Troubleshooting', question: 'My upload is stuck. Why?', answer: 'Large videos take time to process (transcoding). Check back in a few minutes. If status shows "failed", open a support ticket.', order_index: 2, active: 1 },
    ];
    for (const f of seed) {
      db.prepare(`
        INSERT INTO faq_items (id, category, question, answer, order_index, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), f.category, f.question, f.answer, f.order_index, f.active, now, now);
    }
  }
}

export function listFaq(category?: string): FaqItem[] {
  const db = getDb();
  if (category) {
    return db.prepare(
      'SELECT * FROM faq_items WHERE active = 1 AND category = ? ORDER BY order_index'
    ).all(category) as FaqItem[];
  }
  return db.prepare(
    'SELECT * FROM faq_items WHERE active = 1 ORDER BY category, order_index'
  ).all() as FaqItem[];
}

export function listFaqCategories(): string[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT DISTINCT category FROM faq_items WHERE active = 1 ORDER BY category'
  ).all() as { category: string }[];
  return rows.map((r) => r.category);
}

// ============ Tickets ============
export interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  category: string;
  status: string;
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

export interface CreateTicketInput {
  user_id: string;
  user_name: string;
  subject: string;
  category?: string;
  priority?: string;
  message: string;
}

export function createTicket(input: CreateTicketInput): SupportTicket {
  const db = getDb();
  const now = new Date().toISOString();
  const ticket: SupportTicket = {
    id: randomUUID(),
    user_id: input.user_id,
    subject: input.subject.trim().slice(0, 200),
    category: input.category ?? 'general',
    status: 'open',
    priority: input.priority ?? 'normal',
    last_message_at: now,
    created_at: now,
    updated_at: now,
  };
  db.prepare(`
    INSERT INTO support_tickets (id, user_id, subject, category, status, priority,
      last_message_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticket.id, ticket.user_id, ticket.subject, ticket.category, ticket.status,
    ticket.priority, now, now, now
  );
  // First message
  db.prepare(`
    INSERT INTO support_messages (id, ticket_id, sender_type, sender_id, sender_name, content, created_at)
    VALUES (?, ?, 'user', ?, ?, ?, ?)
  `).run(randomUUID(), ticket.id, input.user_id, input.user_name, input.message.trim(), now);
  return ticket;
}

export function listMyTickets(userId: string): SupportTicket[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM support_tickets WHERE user_id = ? ORDER BY last_message_at DESC'
  ).all(userId) as SupportTicket[];
}

export function listAllTickets(status?: string): SupportTicket[] {
  const db = getDb();
  if (status) {
    return db.prepare(
      'SELECT * FROM support_tickets WHERE status = ? ORDER BY last_message_at DESC'
    ).all(status) as SupportTicket[];
  }
  return db.prepare(
    'SELECT * FROM support_tickets ORDER BY last_message_at DESC'
  ).all() as SupportTicket[];
}

export function getTicketById(id: string): SupportTicket | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id) as SupportTicket | undefined) ?? null;
}

export function listTicketMessages(ticketId: string): SupportMessage[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC'
  ).all(ticketId) as SupportMessage[];
}

export function addTicketMessage(
  ticketId: string,
  senderType: 'user' | 'admin',
  senderId: string | null,
  senderName: string,
  content: string,
): SupportMessage {
  const db = getDb();
  const now = new Date().toISOString();
  const msg: SupportMessage = {
    id: randomUUID(),
    ticket_id: ticketId,
    sender_type: senderType,
    sender_id: senderId,
    sender_name: senderName.slice(0, 50),
    content: content.trim().slice(0, 5000),
    created_at: now,
  };
  db.prepare(`
    INSERT INTO support_messages (id, ticket_id, sender_type, sender_id, sender_name, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.ticket_id, msg.sender_type, msg.sender_id, msg.sender_name, msg.content, now);
  db.prepare('UPDATE support_tickets SET last_message_at = ?, updated_at = ?, status = ? WHERE id = ?')
    .run(now, now, senderType === 'admin' ? 'in_progress' : 'open', ticketId);
  return msg;
}

export function updateTicketStatus(ticketId: string, status: string): SupportTicket | null {
  const db = getDb();
  db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, new Date().toISOString(), ticketId);
  return getTicketById(ticketId);
}

// ============ AI Chatbot (Rule-based) ============
const BOT_RULES: { keywords: string[]; response: string }[] = [
  {
    keywords: ['upload', 'video upload', 'post video', 'publish'],
    response: '📤 To upload a video: 1) Create a channel if you don\'t have one. 2) Click the 📤 icon at the top. 3) Select your file, add a title & description, and click Publish. Transcoding takes a few minutes depending on length.',
  },
  {
    keywords: ['live', 'stream', 'go live', 'rtmp', 'obs'],
    response: '🔴 To go live: Click the red dot icon at the top, or Avatar → Go Live. You can use your camera directly or OBS via RTMP. For OBS, copy the Stream URL and Stream Key.',
  },
  {
    keywords: ['2fa', 'two factor', 'authenticator', 'security'],
    response: '🔐 To enable 2FA: Avatar menu → Security settings → Enable 2FA. Scan the QR with Google Authenticator or Authy, then enter the 6-digit code.',
  },
  {
    keywords: ['payment', 'pay', 'bkash', 'nagad', 'stripe', 'paypal'],
    response: '💳 We support bKash, Nagad, Rocket, SSLCommerz (BD) and Stripe, PayPal, Razorpay (international). Payment options appear at checkout.',
  },
  {
    keywords: ['message limit', 'chat limit', 'free message', 'message pack'],
    response: '💬 Every user gets 7 free chat messages. After that, buy a pack (20 messages for ৳50) from Avatar → Buy Messages.',
  },
  {
    keywords: ['super chat', 'paid message', 'highlight'],
    response: '💎 In any live stream chat, click the 💎 Super button. Choose amount (৳50 to ৳1000+). Higher amounts stay pinned longer with different colors.',
  },
  {
    keywords: ['membership', 'join channel', 'subscription'],
    response: '🏅 Visit any channel and click the "🏅 Join" button. Choose a tier, pay monthly, and unlock badges + member-only content.',
  },
  {
    keywords: ['podcast', 'audio'],
    response: '🎙️ When uploading, choose "Podcast" as content type. Podcasts appear in the Podcasts section with an audio-first player and support RSS feeds.',
  },
  {
    keywords: ['shorts', 'reels', 'vertical'],
    response: '📱 Shorts are vertical videos under 60 seconds. Select "Short" as content type when uploading — they\'ll appear in the Shorts feed.',
  },
  {
    keywords: ['series', 'episode', 'season'],
    response: '📺 To create a series: Go to /series → New series → add seasons → attach episodes from your videos. Auto-play next episode works automatically.',
  },
  {
    keywords: ['delete account', 'remove account'],
    response: '⚠️ Account deletion is permanent. Please open a support ticket with subject "Account Deletion" to proceed.',
  },
  {
    keywords: ['report', 'abuse', 'spam', 'copyright'],
    response: '🚩 To report content: Click the ⋮ menu on any video/comment and select "Report". Our moderation team reviews all reports.',
  },
  {
    keywords: ['download', 'offline'],
    response: '⬇️ Offline download is available for premium members. Open any video, click the ⋮ menu and choose "Download".',
  },
  {
    keywords: ['thanks', 'thank', 'ok', 'got it'],
    response: '😊 You\'re welcome! Is there anything else I can help you with?',
  },
  {
    keywords: ['hi', 'hello', 'hey', 'salam', 'assalam'],
    response: '👋 Hello! I\'m melodyflix assistant. Ask me about uploading, payments, live streaming, or type "help" to see what I can do.',
  },
  {
    keywords: ['help', 'what can you do'],
    response: '📚 I can help with: uploading videos, live streaming, payments, memberships, Super Chat, message limits, 2FA, series, podcasts, shorts, and more. Just ask!',
  },
];

export function chatbotReply(message: string): string {
  const lower = message.toLowerCase();

  // Keyword match
  let bestRule: { keywords: string[]; response: string } | null = null;
  let bestScore = 0;
  for (const rule of BOT_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) score += kw.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  if (bestRule) return bestRule.response;

  // Fallback
  return '🤔 I\'m not sure about that. Try asking about: upload, live streaming, payments, 2FA, memberships, or open a support ticket for personalized help.';
}

export function logChatbotMessage(
  conversationId: string,
  userId: string | null,
  role: 'user' | 'assistant',
  content: string,
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO chatbot_messages (id, user_id, conversation_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, conversationId, role, content, new Date().toISOString());
}

export function listChatbotHistory(conversationId: string, limit = 50): any[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM chatbot_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(conversationId, limit);
}

// ============ Stats (admin) ============
export interface SupportStats {
  total_tickets: number;
  open_tickets: number;
  in_progress_tickets: number;
  resolved_tickets: number;
  today_tickets: number;
}

export function getSupportStats(): SupportStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM support_tickets').get() as { n: number }).n;
  const open = (db.prepare("SELECT COUNT(*) as n FROM support_tickets WHERE status = 'open'").get() as { n: number }).n;
  const prog = (db.prepare("SELECT COUNT(*) as n FROM support_tickets WHERE status = 'in_progress'").get() as { n: number }).n;
  const res = (db.prepare("SELECT COUNT(*) as n FROM support_tickets WHERE status = 'resolved'").get() as { n: number }).n;
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
  const today = (db.prepare('SELECT COUNT(*) as n FROM support_tickets WHERE created_at >= ?').get(cutoff.toISOString()) as { n: number }).n;
  return { total_tickets: total, open_tickets: open, in_progress_tickets: prog, resolved_tickets: res, today_tickets: today };
}
