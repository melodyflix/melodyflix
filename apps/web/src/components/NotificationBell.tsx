import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
  getCachedUser,
  type Notification,
} from '../lib/api';

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

function timeAgoShort(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 2592000)}mo`;
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const me = getCachedUser();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Poll unread count every 30s
  useEffect(() => {
    if (!me) return;
    let cancelled = false;

    async function fetchCount() {
      try {
        const res = await getUnreadCount();
        if (!cancelled) setUnread(res.count);
      } catch {}
    }

    fetchCount();
    const interval = setInterval(fetchCount, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [me?.id]);

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function openDropdown() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setLoading(true);
    try {
      const res = await listNotifications(10, 0);
      setNotifications(res.notifications);
      setUnread(res.unread);
    } catch {}
    setLoading(false);
  }

  async function handleClick(n: Notification) {
    if (!n.is_read) {
      try {
        await markNotificationRead(n.id);
        setNotifications((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x))
        );
        setUnread((c) => Math.max(c - 1, 0));
      } catch {}
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: 1 })));
      setUnread(0);
    } catch {}
  }

  if (!me) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={openDropdown}
        title="Notifications"
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: 22,
          cursor: 'pointer',
          padding: '4px 8px',
          position: 'relative',
          lineHeight: 1,
        }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: '#dc2626',
              color: '#fff',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 5px',
              minWidth: 16,
              textAlign: 'center',
              lineHeight: '14px',
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 380,
            maxWidth: 'calc(100vw - 20px)',
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            zIndex: 300,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <strong style={{ fontSize: 15 }}>Notifications</strong>
            {unread > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#065fd4',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  padding: 0,
                }}
              >
                Mark all as read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#606060', fontSize: 13 }}>
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: '#606060', fontSize: 13 }}>
                <div style={{ fontSize: 36, marginBottom: 8, opacity: 0.4 }}>🔔</div>
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #f5f5f5',
                    cursor: 'pointer',
                    background: n.is_read ? '#fff' : '#e8f0fe',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ fontSize: 22, flexShrink: 0 }}>{iconFor(n.type)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>
                      {n.title}
                    </div>
                    {n.body && (
                      <div
                        style={{
                          fontSize: 12,
                          color: '#606060',
                          lineHeight: 1.4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {n.body}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: '#909090', marginTop: 4 }}>
                      {timeAgoShort(n.created_at)}
                    </div>
                  </div>
                  {!n.is_read && (
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: '#065fd4',
                        flexShrink: 0,
                        marginTop: 6,
                      }}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          <div
            onClick={() => { setOpen(false); navigate('/notifications'); }}
            style={{
              padding: '12px 16px',
              textAlign: 'center',
              color: '#065fd4',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              borderTop: '1px solid #f0f0f0',
            }}
          >
            View all notifications
          </div>
        </div>
      )}
    </div>
  );
}
