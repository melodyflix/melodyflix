// melodyflix web — Parental control settings (Section 40.12)
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getLiveTvParental, setLiveTvPin, changeLiveTvPin, removeLiveTvPin,
  updateLiveTvMaxAge, unlockLiveTvParental, lockLiveTvParental,
  listLiveTvBlocked, unblockLiveTvChannel,
  LiveTvParentalSettings, LiveTvBlockedChannel,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
}

const AGE_OPTIONS = [0, 3, 7, 12, 16, 18, 21];

export default function ParentalSettings({ onSignIn }: Props) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<LiveTvParentalSettings | null>(null);
  const [blocked, setBlocked] = useState<LiveTvBlockedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // form state
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [unlockPin, setUnlockPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const reload = async () => {
    try {
      setLoading(true);
      const [s, b] = await Promise.all([
        getLiveTvParental(),
        listLiveTvBlocked().catch(() => ({ blocked: [], count: 0 })),
      ]);
      setSettings(s);
      setBlocked(b.blocked);
    } catch (e: any) {
      if (String(e?.message ?? '').toLowerCase().includes('unauth')) {
        onSignIn();
      } else {
        setError(e?.message ?? 'Failed to load');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  const flash = (m: string) => { setMessage(m); setTimeout(() => setMessage(null), 3000); };

  const doSetPin = async () => {
    if (!/^\d{4,6}$/.test(pin)) { flash('PIN must be 4–6 digits'); return; }
    if (pin !== confirmPin) { flash('PIN and confirm do not match'); return; }
    setBusy(true);
    try {
      await setLiveTvPin(pin, settings?.max_age_rating ?? 18);
      setPin(''); setConfirmPin('');
      flash('PIN set successfully');
      await reload();
    } catch (e: any) { flash(e?.message ?? 'Set failed'); }
    finally { setBusy(false); }
  };

  const doChangePin = async () => {
    if (!/^\d{4,6}$/.test(newPin)) { flash('New PIN must be 4–6 digits'); return; }
    if (newPin !== confirmPin) { flash('New PIN and confirm do not match'); return; }
    setBusy(true);
    try {
      await changeLiveTvPin(currentPin, newPin);
      setCurrentPin(''); setNewPin(''); setConfirmPin('');
      flash('PIN changed');
      await reload();
    } catch (e: any) { flash(e?.message ?? 'Change failed'); }
    finally { setBusy(false); }
  };

  const doRemovePin = async () => {
    if (!/^\d{4,6}$/.test(currentPin)) { flash('Enter current PIN'); return; }
    if (!confirm('Remove PIN? Parental controls will be disabled.')) return;
    setBusy(true);
    try {
      await removeLiveTvPin(currentPin);
      setCurrentPin('');
      flash('PIN removed');
      await reload();
    } catch (e: any) { flash(e?.message ?? 'Remove failed'); }
    finally { setBusy(false); }
  };

  const doMaxAge = async (age: number) => {
    setBusy(true);
    try {
      await updateLiveTvMaxAge(age);
      flash(`Max age rating set to ${age === 21 ? 'All' : age + '+'}`);
      await reload();
    } catch (e: any) { flash(e?.message ?? 'Update failed'); }
    finally { setBusy(false); }
  };

  const doUnlock = async () => {
    if (!/^\d{4,6}$/.test(unlockPin)) { flash('Enter PIN'); return; }
    setBusy(true);
    try {
      await unlockLiveTvParental(unlockPin);
      setUnlockPin('');
      flash('Unlocked for 1 hour');
      await reload();
    } catch (e: any) { flash(e?.message ?? 'Wrong PIN'); }
    finally { setBusy(false); }
  };

  const doLock = async () => {
    setBusy(true);
    try {
      await lockLiveTvParental();
      flash('Locked');
      await reload();
    } catch (e: any) { flash(e?.message ?? 'Lock failed'); }
    finally { setBusy(false); }
  };

  const doUnblock = async (channelId: string) => {
    try {
      await unblockLiveTvChannel(channelId);
      await reload();
    } catch (e: any) { flash(e?.message ?? 'Unblock failed'); }
  };

  if (loading) return <div style={{ padding: 40, color: '#666' }}>Loading…</div>;
  if (error) return <div style={{ padding: 40, color: 'crimson' }}>{error}</div>;
  if (!settings) return null;

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <button
        onClick={() => navigate(-1)}
        style={{ marginBottom: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 13 }}
      >← Back</button>

      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>🔒 Parental Control</h1>
      <p style={{ color: '#666', marginTop: 4 }}>Restrict Live TV channels by age rating or block them explicitly.</p>

      {message && (
        <div style={{ padding: 10, background: '#eef7ff', border: '1px solid #c9def0', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          {message}
        </div>
      )}

      {/* Status card */}
      <section style={{ border: '1px solid #eee', borderRadius: 12, padding: 16, marginBottom: 16, background: '#fafafa' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: '#888' }}>STATUS</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {settings.has_pin ? (settings.unlocked ? '🔓 Unlocked' : '🔒 Locked') : '⚪ No PIN set'}
            </div>
          </div>
          {settings.has_pin && settings.unlocked && (
            <button onClick={doLock} disabled={busy} style={btnStyle('#fff', '#333', '#ddd')}>Lock now</button>
          )}
        </div>

        {settings.has_pin && (
          <div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>MAX AGE RATING</div>
            <select
              value={settings.max_age_rating}
              onChange={(e) => doMaxAge(parseInt(e.target.value))}
              disabled={busy}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, minWidth: 180 }}
            >
              {AGE_OPTIONS.map((a) => (
                <option key={a} value={a}>{a === 21 ? 'All ages' : `${a}+`}</option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* Unlock (if has_pin and locked) */}
      {settings.has_pin && !settings.unlocked && (
        <section style={{ border: '1px solid #eee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, marginBottom: 12 }}>🔓 Unlock for 1 hour</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password" inputMode="numeric" placeholder="Enter PIN"
              value={unlockPin} onChange={(e) => setUnlockPin(e.target.value)}
              style={inputStyle()}
            />
            <button onClick={doUnlock} disabled={busy} style={btnStyle('#0a7', '#fff')}>Unlock</button>
          </div>
        </section>
      )}

      {/* Set PIN (first time) */}
      {!settings.has_pin && (
        <section style={{ border: '1px solid #eee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, marginBottom: 12 }}>Set PIN</h2>
          <p style={{ fontSize: 13, color: '#666', marginTop: 0 }}>
            4–6 digits. You'll need this PIN to view age-restricted channels.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input type="password" inputMode="numeric" placeholder="New PIN" value={pin} onChange={(e) => setPin(e.target.value)} style={inputStyle()} />
            <input type="password" inputMode="numeric" placeholder="Confirm PIN" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} style={inputStyle()} />
            <button onClick={doSetPin} disabled={busy} style={btnStyle('#0a7', '#fff', undefined, true)}>Set PIN</button>
          </div>
        </section>
      )}

      {/* Change / Remove PIN (if has_pin) */}
      {settings.has_pin && (
        <section style={{ border: '1px solid #eee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, marginBottom: 12 }}>Change or remove PIN</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input type="password" inputMode="numeric" placeholder="Current PIN" value={currentPin} onChange={(e) => setCurrentPin(e.target.value)} style={inputStyle()} />
            <input type="password" inputMode="numeric" placeholder="New PIN (leave blank to remove)" value={newPin} onChange={(e) => setNewPin(e.target.value)} style={inputStyle()} />
            <input type="password" inputMode="numeric" placeholder="Confirm new PIN" value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} style={inputStyle()} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={doChangePin} disabled={busy} style={btnStyle('#0a7', '#fff')}>Change PIN</button>
              <button onClick={doRemovePin} disabled={busy} style={btnStyle('#fff', 'crimson', '#f5c6c6')}>Remove PIN</button>
            </div>
          </div>
        </section>
      )}

      {/* Blocked channels */}
      <section style={{ border: '1px solid #eee', borderRadius: 12, padding: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, marginBottom: 12 }}>Blocked channels ({blocked.length})</h2>
        {blocked.length === 0 && (
          <p style={{ fontSize: 13, color: '#888', margin: 0 }}>No blocked channels. You can block individual channels from their watch page.</p>
        )}
        {blocked.map((b) => (
          <div key={b.channel_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{b.channel?.name ?? '(deleted channel)'}</div>
              <div style={{ fontSize: 11, color: '#888' }}>{b.channel?.category ?? '—'}</div>
            </div>
            <button onClick={() => doUnblock(b.channel_id)} style={btnStyle('#fff', '#333', '#ddd')}>Unblock</button>
          </div>
        ))}
      </section>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return { padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 };
}

function btnStyle(bg: string, color: string, border?: string, fullWidth = false): React.CSSProperties {
  return {
    padding: '10px 16px',
    background: bg,
    color,
    border: border ? `1px solid ${border}` : 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    width: fullWidth ? '100%' : undefined,
  };
}
