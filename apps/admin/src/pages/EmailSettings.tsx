import { useEffect, useState } from 'react';
import {
  getSmtpSettings, saveSmtpSettings, sendTestEmail, getEmailLogs,
  type SmtpSettings, type EmailLog,
} from '../lib/api';

const PRESETS = [
  { name: 'Gmail', host: 'smtp.gmail.com', port: 587, secure: false, help: 'Gmail → Account → App Passwords (2FA required)' },
  { name: 'Outlook / Office365', host: 'smtp-mail.outlook.com', port: 587, secure: false, help: 'Outlook → Security → App Password' },
  { name: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, help: 'Username must be: apikey · Password: your SendGrid API key' },
  { name: 'Mailgun', host: 'smtp.mailgun.org', port: 587, secure: false, help: 'Username: postmaster@yourdomain.com · Password from Mailgun' },
  { name: 'Zoho Mail', host: 'smtp.zoho.com', port: 587, secure: false, help: 'Use app-specific password' },
  { name: 'Brevo (Sendinblue)', host: 'smtp-relay.brevo.com', port: 587, secure: false, help: 'Login + SMTP Key from Brevo dashboard' },
];

export default function EmailSettings() {
  const [settings, setSettings] = useState<SmtpSettings | null>(null);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

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
    setError('');
    try {
      const [s, l] = await Promise.all([
        getSmtpSettings().catch(() => null),
        getEmailLogs().catch(() => ({ logs: [] })),
      ]);
      if (s) {
        setSettings(s);
        setHost(s.host);
        setPort(s.port);
        setSecure(s.secure === 1);
        setUsername(s.username);
        setPassword(s.password);
        setFromName(s.from_name);
        setFromEmail(s.from_email);
        setEnabled(s.enabled === 1);
      }
      setLogs(l.logs);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function applyPreset(idx: number) {
    const p = PRESETS[idx];
    setHost(p.host);
    setPort(p.port);
    setSecure(p.secure);
    setInfo(`Loaded ${p.name} preset. ${p.help}`);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await saveSmtpSettings({
        host: host.trim(),
        port,
        secure,
        username: username.trim(),
        password: password,
        from_name: fromName.trim(),
        from_email: fromEmail.trim(),
        enabled,
      });
      setInfo('✓ Settings saved');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function handleTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testTo.trim()) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await sendTestEmail(testTo.trim());
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
        <h1 className="mf-page-title" style={{ marginBottom: 0 }}>Email & SMTP</h1>
        <button className="mf-btn" onClick={load}>↻ Refresh</button>
      </div>

      <div className="mf-card mf-mb-16" style={{ background: '#e7f3ff', borderColor: '#c2d9f5' }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>ℹ️ Setup:</strong> Configure an SMTP server to send verification emails, password resets, and notifications.
          Choose a preset below or enter your provider's details manually.
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map((p, i) => (
            <button
              key={p.name}
              onClick={() => applyPreset(i)}
              className="mf-btn mf-btn-secondary"
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              + {p.name}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mf-alert mf-alert-error">{error}</div>}
      {info && <div className="mf-alert mf-alert-success">{info}</div>}

      <form onSubmit={handleSave} className="mf-card mf-mb-16">
        <h3 style={{ marginBottom: 14, fontSize: 15 }}>SMTP Configuration</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
          <div className="mf-form-group" style={{ margin: 0 }}>
            <label className="mf-label">Host</label>
            <input className="mf-input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" required />
          </div>
          <div className="mf-form-group" style={{ margin: 0 }}>
            <label className="mf-label">Port</label>
            <input className="mf-input" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} min={1} max={65535} required />
          </div>
        </div>

        <div style={{ marginBottom: 12, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
            SSL/TLS (port 465)
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enable email sending
          </label>
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Username</label>
          <input className="mf-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@example.com" autoComplete="off" />
        </div>

        <div className="mf-form-group">
          <label className="mf-label">Password / API Key</label>
          <input className="mf-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
          <div style={{ fontSize: 11, color: '#909090', marginTop: 4 }}>
            For Gmail: use an <strong>App Password</strong>, not your main password.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div className="mf-form-group" style={{ margin: 0 }}>
            <label className="mf-label">From name</label>
            <input className="mf-input" value={fromName} onChange={(e) => setFromName(e.target.value)} required />
          </div>
          <div className="mf-form-group" style={{ margin: 0 }}>
            <label className="mf-label">From email</label>
            <input className="mf-input" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="noreply@yourdomain.com" required />
          </div>
        </div>

        <button className="mf-btn" type="submit" disabled={busy}>
          {busy ? 'Saving...' : 'Save settings'}
        </button>
      </form>

      <form onSubmit={handleTest} className="mf-card mf-mb-16">
        <h3 style={{ marginBottom: 10, fontSize: 15 }}>Send test email</h3>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="mf-input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="recipient@example.com" required style={{ flex: 1 }} />
          <button className="mf-btn" type="submit" disabled={busy}>
            {busy ? '...' : 'Send'}
          </button>
        </div>
      </form>

      <div className="mf-card">
        <h3 style={{ marginBottom: 12, fontSize: 15 }}>Recent email logs</h3>
        {logs.length === 0 ? (
          <div style={{ color: '#606060', textAlign: 'center', padding: 20 }}>No emails sent yet</div>
        ) : (
          <table className="mf-table">
            <thead>
              <tr><th>To</th><th>Subject</th><th>Status</th><th>Time</th></tr>
            </thead>
            <tbody>
              {logs.slice(0, 20).map((l) => (
                <tr key={l.id}>
                  <td>{l.to_email}</td>
                  <td>{l.subject}</td>
                  <td>
                    <span className={`mf-badge ${
                      l.status === 'sent' ? 'mf-badge-success' :
                      l.status === 'failed' ? 'mf-badge-danger' : ''
                    }`}>{l.status}</span>
                  </td>
                  <td className="mf-muted" style={{ fontSize: 12 }}>{new Date(l.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
