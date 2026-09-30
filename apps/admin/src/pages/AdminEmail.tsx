import { useEffect, useState } from 'react';
import {
  getSmtpSettings, saveSmtpSettings, sendTestEmail, getEmailLogs,
  type SmtpSettings, type EmailLog,
} from '../lib/api';

const PRESETS = [
  { label: 'Gmail', host: 'smtp.gmail.com', port: 587, secure: false, hint: 'Use App Password, not your Google password' },
  { label: 'Outlook', host: 'smtp-mail.outlook.com', port: 587, secure: false, hint: '' },
  { label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 587, secure: false, hint: '' },
  { label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, hint: 'Username: apikey, Password: your API key' },
  { label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, secure: false, hint: '' },
  { label: 'Custom SMTP', host: '', port: 587, secure: false, hint: '' },
];

export default function AdminEmail() {
  const [settings, setSettings] = useState<SmtpSettings | null>(null);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  // Form
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fromName, setFromName] = useState('melodyflix');
  const [fromEmail, setFromEmail] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [testTo, setTestTo] = useState('');

  async function load() {
    setLoading(true);
    try {
      const s = await getSmtpSettings();
      setSettings(s);
      if (s) {
        setHost(s.host);
        setPort(s.port);
        setSecure(s.secure === 1);
        setUsername(s.username);
        setPassword(s.password);
        setFromName(s.from_name);
        setFromEmail(s.from_email);
        setEnabled(s.enabled === 1);
      }
      const l = await getEmailLogs(50);
      setLogs(l.logs);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function applyPreset(idx: number) {
    setHost(PRESETS[idx].host);
    setPort(PRESETS[idx].port);
    setSecure(PRESETS[idx].secure);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const s = await saveSmtpSettings({
        host, port, secure, username, password, from_name: fromName, from_email: fromEmail, enabled,
      });
      setSettings(s);
      setInfo('✓ SMTP settings saved');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function handleTest() {
    if (!testTo) { setError('Enter a test email address'); return; }
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await sendTestEmail(testTo);
      setInfo(`✓ Test email sent to ${testTo}`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  if (loading) return <div className="mf-card">Loading...</div>;

  return (
    <>
      <div className="mf-flex-between mf-mb-16">
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>Email Settings</h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}
      {info && <div className="mf-alert mf-alert-success">{info}</div>}

      <div className="mf-card mf-mb-16" style={{ background: '#e7f3ff', borderColor: '#c2d9f5' }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>ℹ️ Setup:</strong> melodyflix uses SMTP to send verification links, password resets, and notifications.
          Enter your email provider's SMTP credentials below.
        </div>
      </div>

      <form onSubmit={handleSave} className="mf-card mf-mb-16">
        <h2 style={{ fontSize: 15, marginBottom: 14 }}>SMTP Configuration</h2>

        <div style={{ marginBottom: 14 }}>
          <label className="mf-label">Quick presets</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESETS.map((p, i) => (
              <button
                type="button"
                key={p.label}
                className="mf-btn mf-btn-secondary"
                style={{ padding: '6px 12px', fontSize: 12 }}
                onClick={() => applyPreset(i)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mf-muted" style={{ fontSize: 12, marginTop: 6 }}>
            {PRESETS.find((p) => p.host === host)?.hint ?? ''}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <div className="mf-form-group">
            <label className="mf-label">SMTP Host</label>
            <input className="mf-input" value={host} onChange={(e) => setHost(e.target.value)} required placeholder="smtp.gmail.com" />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Port</label>
            <input className="mf-input" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} min={1} max={65535} />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Secure (SSL)</label>
            <select className="mf-input" value={secure ? '1' : '0'} onChange={(e) => setSecure(e.target.value === '1')}>
              <option value="0">No (TLS / 587)</option>
              <option value="1">Yes (SSL / 465)</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="mf-form-group">
            <label className="mf-label">Username</label>
            <input className="mf-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your@email.com" />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">Password / App Password</label>
            <input className="mf-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="mf-form-group">
            <label className="mf-label">From Name</label>
            <input className="mf-input" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="melodyflix" />
          </div>
          <div className="mf-form-group">
            <label className="mf-label">From Email</label>
            <input className="mf-input" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} required placeholder="noreply@melodyflix.com" />
          </div>
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, fontSize: 13 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable email sending
        </label>

        <button className="mf-btn" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save SMTP settings'}
        </button>
      </form>

      <div className="mf-card mf-mb-16">
        <h2 style={{ fontSize: 15, marginBottom: 14 }}>Test email</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="mf-input"
            type="email"
            placeholder="recipient@example.com"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="mf-btn mf-btn-secondary"
            onClick={handleTest}
            disabled={busy || !enabled}
          >
            Send test
          </button>
        </div>
        {!enabled && (
          <div className="mf-muted" style={{ fontSize: 12, marginTop: 8 }}>
            ⚠️ Enable email sending first to test
          </div>
        )}
      </div>

      {/* Logs */}
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Recent email activity</h2>
      {logs.length === 0 ? (
        <div className="mf-card" style={{ textAlign: 'center', padding: 30, color: '#606060' }}>
          No email activity yet
        </div>
      ) : (
        <table className="mf-table">
          <thead>
            <tr>
              <th>To</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.to_email}</td>
                <td>{log.subject}</td>
                <td>
                  <span className={`mf-badge ${
                    log.status === 'sent' ? 'mf-badge-success' :
                    log.status === 'failed' ? 'mf-badge-danger' : 'mf-badge-warning'
                  }`}>
                    {log.status}
                  </span>
                </td>
                <td className="mf-muted" style={{ fontSize: 12 }}>
                  {new Date(log.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
