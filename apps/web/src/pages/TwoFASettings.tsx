import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getTwoFAStatus, beginTwoFASetup, confirmTwoFA, disableTwoFA, regenerateBackupCodes,
  getCachedUser,
  type User, type TwoFASetupResult, type TwoFAStatus,
} from '../lib/api';

interface Props {
  user: User | null;
  onSignIn: () => void;
}

type Step = 'status' | 'setup-qr' | 'setup-confirm' | 'backup-codes' | 'disable';

export default function TwoFASettings({ user, onSignIn }: Props) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<TwoFAStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState<Step>('status');
  const [setup, setSetup] = useState<TwoFASetupResult | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  async function loadStatus() {
    setLoading(true);
    setError('');
    try {
      const s = await getTwoFAStatus();
      setStatus(s);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    loadStatus();
  }, [user]);

  async function startSetup() {
    setBusy(true);
    setError('');
    try {
      const result = await beginTwoFASetup();
      setSetup(result);
      setStep('setup-qr');
      setCode('');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await confirmTwoFA(code);
      setBackupCodes(result.backup_codes);
      setStep('backup-codes');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await disableTwoFA(code);
      setCode('');
      setStep('status');
      await loadStatus();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function handleRegenerate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await regenerateBackupCodes(code);
      setBackupCodes(result.backup_codes);
      setCode('');
      setStep('backup-codes');
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  function copyBackupCodes() {
    const text = backupCodes.join('\n');
    navigator.clipboard.writeText(text)
      .then(() => alert('Backup codes copied to clipboard'))
      .catch(() => alert('Could not copy'));
  }

  if (!user) {
    return (
      <div className="mf-container">
        <div className="mf-empty">
          <div className="mf-empty-icon">🔒</div>
          <div style={{ fontSize: 18, marginBottom: 12 }}>Sign in to manage security</div>
          <button className="mf-btn-primary" style={{ width: 'auto', padding: '10px 24px' }} onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="mf-loading">Loading...</div>;

  return (
    <div className="mf-container" style={{ maxWidth: 640, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#0f0f0f' }}
        >
          ←
        </button>
        <h1 style={{ fontSize: 24, marginBottom: 0 }}>Security</h1>
      </div>

      {error && <div className="mf-error">{error}</div>}

      {/* Status */}
      {step === 'status' && status && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 32 }}>{status.enabled ? '🔐' : '🔓'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                Two-factor authentication
              </div>
              <div style={{ fontSize: 13, color: '#606060' }}>
                {status.enabled
                  ? 'Your account is protected with an additional security layer.'
                  : 'Add an extra layer of security to your account.'}
              </div>
            </div>
            <span
              className={`mf-badge ${status.enabled ? 'mf-badge-success' : ''}`}
              style={{ fontSize: 12, padding: '4px 10px' }}
            >
              {status.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {status.enabled ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => { setStep('disable'); setCode(''); }}
                className="mf-btn-secondary"
                style={{ flex: 1, padding: 10 }}
              >
                Disable 2FA
              </button>
              <button
                onClick={() => { setStep('setup-confirm'); setCode(''); }}
                className="mf-btn-secondary"
                style={{ flex: 1, padding: 10 }}
              >
                Regenerate backup codes
              </button>
            </div>
          ) : (
            <button
              onClick={startSetup}
              disabled={busy}
              className="mf-btn-primary"
              style={{ width: '100%', padding: 12, fontSize: 15 }}
            >
              {busy ? 'Please wait...' : '🔐 Enable 2FA'}
            </button>
          )}

          {status.enabled && (
            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                color: '#909090',
                textAlign: 'center',
              }}
            >
              {status.has_backup_codes} backup code{status.has_backup_codes === 1 ? '' : 's'} remaining
            </div>
          )}
        </div>
      )}

      {/* Setup: Show QR */}
      {step === 'setup-qr' && setup && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>Scan this QR code</h2>
          <p style={{ fontSize: 13, color: '#606060', marginBottom: 20 }}>
            Open Google Authenticator, Authy, or any TOTP app and scan the code below.
          </p>

          <img
            src={setup.qr_data_url}
            alt="2FA QR code"
            style={{
              width: 220,
              height: 220,
              margin: '0 auto 16px',
              display: 'block',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
            }}
          />

          <div style={{ fontSize: 12, color: '#606060', marginBottom: 6 }}>
            Can't scan? Enter this code manually:
          </div>
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: 14,
              background: '#f9f9f9',
              padding: '10px 14px',
              borderRadius: 6,
              marginBottom: 20,
              wordBreak: 'break-all',
            }}
          >
            {setup.manual_entry}
          </div>

          <button
            onClick={() => { setStep('setup-confirm'); setCode(''); }}
            className="mf-btn-primary"
            style={{ width: '100%', padding: 12 }}
          >
            I've scanned it → Next
          </button>
          <button
            onClick={() => { setStep('status'); setSetup(null); }}
            className="mf-btn-secondary"
            style={{ marginTop: 8 }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Setup: Confirm code */}
      {step === 'setup-confirm' && (
        <form
          onSubmit={status?.enabled ? handleRegenerate : confirmSetup}
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 24,
          }}
        >
          <h2 style={{ fontSize: 18, marginBottom: 8, textAlign: 'center' }}>
            {status?.enabled ? 'Regenerate backup codes' : 'Enter the 6-digit code'}
          </h2>
          <p style={{ fontSize: 13, color: '#606060', marginBottom: 20, textAlign: 'center' }}>
            {status?.enabled
              ? 'Enter your current 2FA code to generate new backup codes.'
              : 'Enter the code from your authenticator app to verify setup.'}
          </p>

          <input
            className="mf-input"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            style={{
              fontSize: 24,
              letterSpacing: 6,
              textAlign: 'center',
              fontFamily: 'monospace',
              padding: '12px 16px',
              marginBottom: 20,
            }}
          />

          <button className="mf-btn-primary" type="submit" disabled={busy || code.length < 6} style={{ width: '100%', padding: 12 }}>
            {busy ? 'Verifying...' : status?.enabled ? 'Generate new codes' : 'Verify & enable'}
          </button>
          <button
            type="button"
            onClick={() => { setStep('status'); setCode(''); }}
            className="mf-btn-secondary"
            style={{ marginTop: 8 }}
            disabled={busy}
          >
            Cancel
          </button>
        </form>
      )}

      {/* Backup codes display */}
      {step === 'backup-codes' && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔑</div>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Save your backup codes</h2>
            <p style={{ fontSize: 13, color: '#606060', marginBottom: 0 }}>
              These codes let you sign in if you lose access to your authenticator app.
              Each code can only be used once.
            </p>
          </div>

          <div
            style={{
              background: '#f9f9f9',
              border: '1px solid #e5e5e5',
              borderRadius: 8,
              padding: 16,
              marginBottom: 16,
              fontFamily: 'monospace',
              fontSize: 14,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            {backupCodes.map((c, i) => (
              <div key={i} style={{ padding: '4px 8px' }}>
                {i + 1}. {c}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={copyBackupCodes}
              className="mf-btn-secondary"
              style={{ flex: 1, padding: 10 }}
            >
              📋 Copy all
            </button>
            <button
              onClick={() => { setStep('status'); setBackupCodes([]); loadStatus(); }}
              className="mf-btn-primary"
              style={{ flex: 1, padding: 10 }}
            >
              I've saved them
            </button>
          </div>
        </div>
      )}

      {/* Disable */}
      {step === 'disable' && (
        <form
          onSubmit={handleDisable}
          style={{
            background: '#fff',
            border: '1px solid #e5e5e5',
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Disable 2FA?</h2>
            <p style={{ fontSize: 13, color: '#606060', marginBottom: 0 }}>
              Your account will no longer require a code at sign in. Enter your current 2FA
              code or a backup code to confirm.
            </p>
          </div>

          <input
            className="mf-input"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code or backup code"
            required
            autoFocus
            maxLength={20}
            style={{
              fontSize: 18,
              textAlign: 'center',
              fontFamily: 'monospace',
              padding: '12px 16px',
              marginBottom: 20,
            }}
          />

          <button
            className="mf-btn-primary"
            type="submit"
            disabled={busy || !code.trim()}
            style={{ width: '100%', padding: 12, background: '#dc2626' }}
          >
            {busy ? 'Disabling...' : 'Disable 2FA'}
          </button>
          <button
            type="button"
            onClick={() => { setStep('status'); setCode(''); }}
            className="mf-btn-secondary"
            style={{ marginTop: 8 }}
            disabled={busy}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
