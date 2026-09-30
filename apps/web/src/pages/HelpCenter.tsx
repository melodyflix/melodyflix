import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listFaq, askChatbot, createSupportTicket, listMySupportTickets, getSupportTicket, replySupportTicket,
  getCachedUser,
  type FaqItem, type SupportTicket, type SupportMessage,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

type Tab = 'faq' | 'chatbot' | 'tickets';

export default function HelpCenter({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [tab, setTab] = useState<Tab>('faq');

  return (
    <div className="mf-container" style={{ maxWidth: 900, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#0f0f0f' }}
        >
          ←
        </button>
        <div style={{ fontSize: 34 }}>🆘</div>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 4 }}>Help Center</h1>
          <div style={{ color: '#606060', fontSize: 13 }}>
            We're here to help — browse FAQ, ask our bot, or open a ticket
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, borderBottom: '1px solid #e5e5e5' }}>
        <TabButton active={tab === 'faq'} onClick={() => setTab('faq')} icon="📚" label="FAQ" />
        <TabButton active={tab === 'chatbot'} onClick={() => setTab('chatbot')} icon="🤖" label="AI Assistant" />
        <TabButton active={tab === 'tickets'} onClick={() => setTab('tickets')} icon="🎫" label="My Tickets" />
      </div>

      {tab === 'faq' && <FaqTab onSignIn={onSignIn} onOpenTicket={() => setTab('tickets')} />}
      {tab === 'chatbot' && <ChatbotTab />}
      {tab === 'tickets' && <TicketsTab me={!!me} onSignIn={onSignIn} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '10px 18px',
        fontSize: 14,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        color: active ? '#0f0f0f' : '#606060',
        borderBottom: active ? '3px solid #7c3aed' : '3px solid transparent',
        marginBottom: -1,
        transition: 'all 0.15s',
      }}
    >
      {icon} {label}
    </button>
  );
}

// ============ FAQ TAB ============
function FaqTab({ onSignIn, onOpenTicket }: { onSignIn: () => void; onOpenTicket: () => void }) {
  const [categories, setCategories] = useState<string[]>([]);
  const [faq, setFaq] = useState<FaqItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listFaq()
      .then((res) => {
        setFaq(res.faq);
        setCategories(res.categories);
        if (res.categories.length > 0) setActiveCategory(res.categories[0]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = faq.filter((f) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      return f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q);
    }
    return !activeCategory || f.category === activeCategory;
  });

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <input
          className="mf-input"
          placeholder="🔍 Search FAQ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 15, padding: '12px 16px' }}
        />
      </div>

      {!search && categories.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setActiveCategory(c)}
              style={{
                padding: '7px 14px',
                borderRadius: 18,
                border: `1px solid ${activeCategory === c ? '#7c3aed' : '#e5e5e5'}`,
                background: activeCategory === c ? '#7c3aed' : '#fff',
                color: activeCategory === c ? '#fff' : '#0f0f0f',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="mf-loading">Loading FAQ...</div>
      ) : filtered.length === 0 ? (
        <div className="mf-card" style={{ textAlign: 'center', padding: 40, color: '#606060' }}>
          No FAQ matches your search
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map((f) => (
            <div
              key={f.id}
              style={{
                background: '#fff',
                border: '1px solid #e5e5e5',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <button
                onClick={() => setOpenId(openId === f.id ? null : f.id)}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 15,
                  fontWeight: 500,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  color: '#0f0f0f',
                }}
              >
                <span>{f.question}</span>
                <span style={{ color: '#909090', fontSize: 18, flexShrink: 0 }}>
                  {openId === f.id ? '−' : '+'}
                </span>
              </button>
              {openId === f.id && (
                <div
                  style={{
                    padding: '0 18px 18px',
                    fontSize: 14,
                    color: '#404040',
                    lineHeight: 1.7,
                    borderTop: '1px solid #f0f0f0',
                    paddingTop: 14,
                  }}
                >
                  {f.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 30, textAlign: 'center', color: '#606060', fontSize: 13 }}>
        Didn't find what you're looking for?{' '}
        <button
          onClick={onOpenTicket}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#065fd4',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
            textDecoration: 'underline',
          }}
        >
          Open a support ticket
        </button>
      </div>
    </>
  );
}

// ============ CHATBOT TAB ============
interface BotMessage {
  role: 'user' | 'assistant';
  content: string;
  time: string;
}

function ChatbotTab() {
  const [messages, setMessages] = useState<BotMessage[]>([
    { role: 'assistant', content: '👋 Hi! I\'m melodyflix assistant. Ask me anything about uploading, payments, live streaming, and more.', time: new Date().toISOString() },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [convId, setConvId] = useState<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text, time: new Date().toISOString() }]);
    setBusy(true);
    try {
      const res = await askChatbot(text, convId);
      if (res.conversation_id && !convId) setConvId(res.conversation_id);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply, time: new Date().toISOString() }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ Sorry, something went wrong. Please try again.', time: new Date().toISOString() }]);
    }
    setBusy(false);
  }

  const suggestions = ['How do I upload a video?', 'How do I go live?', 'Payment methods?', 'How to enable 2FA?', 'What is Super Chat?'];

  return (
    <>
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e5e5',
          borderRadius: 12,
          height: 480,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#7c3aed', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🤖</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>melodyflix Assistant</div>
            <div style={{ fontSize: 11, color: '#00a32a' }}>● Online</div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                background: m.role === 'user' ? '#7c3aed' : '#f5f5f5',
                color: m.role === 'user' ? '#fff' : '#0f0f0f',
                padding: '10px 14px',
                borderRadius: 14,
                fontSize: 14,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content}
            </div>
          ))}
          {busy && (
            <div style={{ alignSelf: 'flex-start', padding: '10px 14px', background: '#f5f5f5', borderRadius: 14, fontSize: 14, color: '#909090' }}>
              Typing...
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={send} style={{ padding: 12, borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
          <input
            className="mf-input"
            placeholder="Type your question..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="mf-btn-primary" style={{ width: 'auto', padding: '8px 20px' }} disabled={busy || !input.trim()}>
            Send
          </button>
        </form>
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => setInput(s)}
            style={{
              padding: '6px 12px',
              borderRadius: 14,
              background: '#f5f3ff',
              border: '1px solid #ddd6fe',
              color: '#5b21b6',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </>
  );
}

// ============ TICKETS TAB ============
function TicketsTab({ me, onSignIn }: { me: boolean; onSignIn: () => void }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('general');
  const [priority, setPriority] = useState('normal');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openTicket, setOpenTicket] = useState<{ ticket: SupportTicket; messages: SupportMessage[] } | null>(null);
  const [replyText, setReplyText] = useState('');

  async function load() {
    if (!me) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await listMySupportTickets();
      setTickets(res.tickets);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [me]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!me) { onSignIn(); return; }
    setBusy(true);
    setError('');
    try {
      await createSupportTicket({ subject, message, category, priority });
      setSubject('');
      setMessage('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function openTicketDetail(id: string) {
    try {
      const res = await getSupportTicket(id);
      setOpenTicket(res);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!openTicket || !replyText.trim()) return;
    setBusy(true);
    try {
      await replySupportTicket(openTicket.ticket.id, replyText.trim());
      setReplyText('');
      await openTicketDetail(openTicket.ticket.id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (!me) {
    return (
      <div className="mf-empty">
        <div className="mf-empty-icon">🔒</div>
        <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to open support tickets</div>
        <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
          Sign in
        </button>
      </div>
    );
  }

  // Ticket detail view
  if (openTicket) {
    return (
      <div>
        <button
          onClick={() => setOpenTicket(null)}
          style={{ background: 'transparent', border: 'none', color: '#065fd4', cursor: 'pointer', fontSize: 14, marginBottom: 16, padding: 0, fontFamily: 'inherit' }}
        >
          ← Back to tickets
        </button>

        <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
            {openTicket.ticket.subject}
          </div>
          <div style={{ fontSize: 12, color: '#909090' }}>
            #{openTicket.ticket.id.slice(0, 8)} · {openTicket.ticket.status} · {openTicket.ticket.priority}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {openTicket.messages.map((m) => (
            <div
              key={m.id}
              style={{
                background: m.sender_type === 'admin' ? '#f5f3ff' : '#f9f9f9',
                border: '1px solid #e5e5e5',
                borderRadius: 10,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: m.sender_type === 'admin' ? '#7c3aed' : '#0f0f0f', marginBottom: 4 }}>
                {m.sender_name} {m.sender_type === 'admin' && '(Support)'}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.content}</div>
              <div style={{ fontSize: 11, color: '#909090', marginTop: 6 }}>
                {new Date(m.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        {openTicket.ticket.status !== 'closed' && (
          <form onSubmit={sendReply} style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, padding: 12 }}>
            <textarea
              className="mf-input"
              placeholder="Write a reply..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              required
              style={{ minHeight: 70, fontSize: 14 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="submit" className="mf-btn-primary" style={{ width: 'auto', padding: '8px 20px' }} disabled={busy || !replyText.trim()}>
                {busy ? 'Sending...' : 'Send reply'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // Tickets list
  return (
    <>
      {error && <div className="mf-error">{error}</div>}

      <div className="mf-flex-between mf-mb-16">
        <h2 style={{ fontSize: 16, margin: 0 }}>My Tickets ({tickets.length})</h2>
        <button className="mf-btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New ticket'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="mf-card mf-mb-16" style={{ background: '#fafbff' }}>
          <div className="mf-form-group">
            <label className="mf-label">Subject</label>
            <input className="mf-input" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={200} placeholder="Short summary of your issue" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="mf-form-group">
              <label className="mf-label">Category</label>
              <select className="mf-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="general">General</option>
                <option value="account">Account</option>
                <option value="payment">Payment</option>
                <option value="video">Video</option>
                <option value="live">Live streaming</option>
                <option value="bug">Bug report</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="mf-form-group">
              <label className="mf-label">Priority</label>
              <select className="mf-input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Describe your issue</label>
            <textarea className="mf-input" value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={5000} style={{ minHeight: 120 }} />
          </div>
          <button className="mf-btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating...' : 'Create ticket'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="mf-loading">Loading...</div>
      ) : tickets.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🎫</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No tickets yet</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            Need help? Open a ticket and our team will respond shortly.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tickets.map((t) => (
            <div
              key={t.id}
              onClick={() => openTicketDetail(t.id)}
              style={{
                background: '#fff',
                border: '1px solid #e5e5e5',
                borderRadius: 10,
                padding: 14,
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.subject}
                </div>
                <div style={{ fontSize: 12, color: '#909090' }}>
                  #{t.id.slice(0, 8)} · {t.category} · {new Date(t.last_message_at).toLocaleDateString()}
                </div>
              </div>
              <span
                className={`mf-badge ${
                  t.status === 'open' ? 'mf-badge-warning' :
                  t.status === 'in_progress' ? 'mf-badge-info' :
                  t.status === 'resolved' ? 'mf-badge-success' : ''
                }`}
                style={{ flexShrink: 0 }}
              >
                {t.status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
