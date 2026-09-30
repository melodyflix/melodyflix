// melodyflix - push notification enable/disable component
import { useEffect, useState } from 'react';
import {
  getPushPublicKey, subscribePush, unsubscribePush, listMyPushSubscriptions, sendTestPush,
  getCachedUser,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function PushNotificationSettings({ onSignIn }: Props) {
  const me = getCachedUser();
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission);
    checkExisting();
  }, [me?.id]);

  async function checkExisting() {
    if (!me) { setLoading(false); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setEnabled(true);
      } else {
        // Also check server
        const res = await listMyPushSubscriptions().catch(() => ({ subscriptions: [] }));
        setEnabled(res.subscriptions.length > 0);
      }
    } catch {}
    setLoading(false);
  }

  async function enable() {
    if (!me) { onSignIn(); return; }
    if (!supported) {
      setError('Your browser does not support push notifications');
      return;
    }
    setBusy(true);
    setError('');
    setInfo('');
    try {
      // Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setError('Notification permission denied. Please enable it in browser settings.');
        setBusy(false);
        return;
      }

      // Get VAPID public key from backend
      const { publicKey } = await getPushPublicKey();

      // Register service worker (already done in main.tsx)
      const reg = await navigator.serviceWorker.ready;

      // Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const json = sub.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Could not obtain subscription keys');
      }

      // Send to backend
      await subscribePush({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent.slice(0, 250),
      });

      setEnabled(true);
      setInfo('✓ Push notifications enabled');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function disable() {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setEnabled(false);
      setInfo('Push notifications disabled');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function testSend() {
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await sendTestPush();
      if (res.sent > 0) {
        setInfo(`✓ Test sent to ${res.sent} device(s)`);
      } else {
        setError('No active subscriptions on server');
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (loading) return null;

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 26 }}>🔔</span>
            <div style={{ fontSize: 16, fontWeight: 600 }}>Push notifications</div>
          </div>
          <div style={{ fontSize: 13, color: '#606060', lineHeight: 1.6 }}>
            Get notified about new videos, live streams, comments, and messages — even when melodyflix is closed.
          </div>

          {!supported && (
            <div style={{ marginTop: 10, background: '#fef2f2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
              ⚠️ Your browser doesn't support push notifications.
            </div>
          )}

          {permission === 'denied' && (
            <div style={{ marginTop: 10, background: '#fffbea', color: '#664d03', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
              ℹ️ Notification permission is blocked. Open browser settings to allow.
            </div>
          )}

          {error && (
            <div style={{ marginTop: 10, background: '#fef2f2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
              {error}
            </div>
          )}

          {info && (
            <div style={{ marginTop: 10, background: '#d1fadf', color: '#054f31', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
              {info}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
          {enabled ? (
            <>
              <button
                className="mf-btn-secondary"
                style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}
                onClick={disable}
                disabled={busy}
              >
                {busy ? '...' : 'Turn off'}
              </button>
              <button
                className="mf-btn-secondary"
                style={{ padding: '8px 16px', fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={testSend}
                disabled={busy}
                title="Send a test notification"
              >
                Test
              </button>
            </>
          ) : (
            <button
              className="mf-btn-primary"
              style={{ padding: '10px 20px', whiteSpace: 'nowrap', width: 'auto' }}
              onClick={enable}
              disabled={busy || !supported}
            >
              {busy ? 'Enabling...' : 'Enable'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
