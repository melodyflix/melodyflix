import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  deleteNotification, clearAllNotifications,
  getCachedUser,
  timeAgo,
  type Notification,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

function iconFor(type: string): string {
  switch (type) {
    case 'comment_on_video': return '💬';
    case 'reply_to_comment': return '↩️';
    case 'video_like': return '👍';
    case 'new_subscriber': return '🔔';
    case 'video_uploaded': return '🎬';
    case 'system': return 'ℹ️';
    default: return '🔔';
  }
}

export default function Notifications({ onSignIn }: Props) {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await listNotifications(100, 0);
      setNotifications(res.notifications);
      setUnread(res.unread);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!me) { setLoading(false); return; }
    load();
  }, []);

  if (!me) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to see notifications</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  async function handleClick(n: Notification) {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id);
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
        setUnread((c) => Math.max(c - 1, 0));
      } catch {}
    }
    if (n.link) navigate(n.link);
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch {}
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
      setUnread(0);
    } catch {}
  }

  async function handleClearAll() {
    if (!confirm('Delete all notifications? This cannot be undone.')) return;
    try {
      await clearAllNotifications();
      setNotifications([]);
      setUnread(0);
    } catch {}
  }

  return (
    <div className="mf-container" style={{ maxWidth: 800, marginTop: 20 }}>
      <div className="mf-flex-between mf-mb-16">
        <h1 style={{ fontSize: 24, marginBottom: 0 }}>
          Notifications
          {unread > 0 && (
            <span
              className="mf-badge mf-badge-info"
              style={{ fontSize: 12, marginLeft: 10, verticalAlign: 'middle' }}
            >
              {unread} new
            </span>
          )}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {unread > 0 && (
            <button className="mf-btn mf-btn-secondary" onClick={handleMarkAllRead}>
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button className="mf-btn mf-btn-secondary" onClick={handleClearAll}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {error && <div className="mf-error">{error}</div>}

      {loading ? (
        <div className="mf-loading">Loading...</div>
      ) : notifications.length === 0 ? (
        <div className="mf-empty">
          <div className="mf-empty-icon">🔔</div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>No notifications yet</div>
          <div style={{ fontSize: 14, color: '#606060' }}>
            When someone likes or comments on your videos, you'll see it here
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e5e5' }}>
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => handleClick(n)}
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
                background: n.is_read ? '#fff' : '#e8f0fe',
                display: 'flex',
                gap: 14,
                alignItems: 'flex-start',
              }}
            >
              <div style={{ fontSize: 26, flexShrink: 0 }}>{iconFor(n.type)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                  {n.title}
                </div>
                {n.body && (
                  <div style={{ fontSize: 13, color: '#606060', lineHeight: 1.5, marginBottom: 4 }}>
                    {n.body}
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#909090' }}>{timeAgo(n.created_at)}</div>
              </div>
              <button
                onClick={(e) => handleDelete(e, n.id)}
                title="Delete"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 18,
                  cursor: 'pointer',
                  color: '#909090',
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
