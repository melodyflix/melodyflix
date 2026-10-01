import { useEffect, useState } from 'react';
import {
  getPreferences, updatePreferences, resetPreferences,
  type Preferences as Prefs,
  type QualityOption,
  type ThemeOption,
} from '../lib/api';

interface Props {
  onSignIn: () => void;
  onToast?: (msg: string) => void;
}

const QUALITY_OPTIONS: { value: QualityOption; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
  { value: '240', label: '240p' },
  { value: '144', label: '144p' },
];

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark', label: 'Dark', icon: '🌙' },
  { value: 'system', label: 'System', icon: '💻' },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'bn', label: 'বাংলা (Bangla)' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'ar', label: 'العربية (Arabic)' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'zh', label: '中文 (Chinese)' },
  { value: 'ja', label: '日本語 (Japanese)' },
];

export default function Preferences({ onSignIn, onToast }: Props) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const p = await getPreferences();
      setPrefs(p);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        setError('signin');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function patch(update: Partial<Prefs>) {
    if (!prefs) return;
    // optimistic update
    setPrefs({ ...prefs, ...update });
    setSaving(true);
    try {
      const updated = await updatePreferences(update as any);
      setPrefs(updated);
      onToast?.('Preferences saved');
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to save');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!confirm('Reset all preferences to defaults?')) return;
    setSaving(true);
    try {
      const p = await resetPreferences();
      setPrefs(p);
      onToast?.('Preferences reset');
    } catch (err) {
      onToast?.((err as Error).message || 'Failed to reset');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mf-page">
        <div style={{ padding: 40, textAlign: 'center', color: '#606060' }}>Loading preferences...</div>
      </div>
    );
  }

  if (error === 'signin' || !prefs) {
    return (
      <div className="mf-page">
        <div style={{ padding: 40, textAlign: 'center' }}>
          <h2 style={{ fontSize: 20, marginBottom: 12 }}>Sign in required</h2>
          <p style={{ color: '#606060', marginBottom: 20 }}>Please sign in to manage your preferences.</p>
          <button className="mf-btn-primary" onClick={onSignIn} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#065fd4', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mf-page" style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>⚙️ Preferences</h1>
        <button
          onClick={handleReset}
          disabled={saving}
          className="mf-btn-text"
          style={{ fontSize: 13, color: '#dc2626' }}
        >
          {saving ? 'Working...' : 'Reset to defaults'}
        </button>
      </div>

      {/* Playback Section */}
      <Section title="🎬 Playback">
        <Row label="Autoplay next video" hint="Play the next recommended video automatically">
          <Toggle
            checked={prefs.autoplay_next === 1}
            onChange={(v) => patch({ autoplay_next: v })}
            disabled={saving}
          />
        </Row>

        <Row label="Autoplay in playlists" hint="Continue to the next video in a playlist">
          <Toggle
            checked={prefs.autoplay_playlist === 1}
            onChange={(v) => patch({ autoplay_playlist: v })}
            disabled={saving}
          />
        </Row>

        <Row label="Default quality" hint="Preferred video resolution when available">
          <select
            value={prefs.default_quality}
            onChange={(e) => patch({ default_quality: e.target.value as QualityOption })}
            disabled={saving}
            className="mf-select"
          >
            {QUALITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Row>

        <Row label="Default speed" hint="Playback speed for all videos">
          <select
            value={prefs.default_speed}
            onChange={(e) => patch({ default_speed: parseFloat(e.target.value) })}
            disabled={saving}
            className="mf-select"
          >
            {SPEED_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}x</option>
            ))}
          </select>
        </Row>
      </Section>

      {/* Appearance Section */}
      <Section title="🎨 Appearance">
        <Row label="Theme" hint="Choose how MelodyFlix looks">
          <div style={{ display: 'flex', gap: 8 }}>
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.value}
                onClick={() => patch({ theme: t.value })}
                disabled={saving}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: prefs.theme === t.value ? '2px solid #065fd4' : '1px solid #e5e5e5',
                  background: prefs.theme === t.value ? '#e8f0fe' : '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: prefs.theme === t.value ? 600 : 400,
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="Reduced motion" hint="Minimize animations and transitions">
          <Toggle
            checked={prefs.reduced_motion === 1}
            onChange={(v) => patch({ reduced_motion: v })}
            disabled={saving}
          />
        </Row>
      </Section>

      {/* Accessibility Section */}
      <Section title="♿ Accessibility & Language">
        <Row label="Captions on by default" hint="Show subtitles automatically when available">
          <Toggle
            checked={prefs.captions_on === 1}
            onChange={(v) => patch({ captions_on: v })}
            disabled={saving}
          />
        </Row>

        <Row label="Language" hint="Interface language">
          <select
            value={prefs.language}
            onChange={(e) => patch({ language: e.target.value })}
            disabled={saving}
            className="mf-select"
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </Row>
      </Section>

      <div style={{ marginTop: 20, fontSize: 12, color: '#909090', textAlign: 'center' }}>
        Changes save automatically {saving && '• saving...'}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e5e5', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', background: '#fafafa', borderBottom: '1px solid #f0f0f0', fontWeight: 600, fontSize: 14 }}>
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 18px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: '#606060' }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      style={{
        width: 46,
        height: 26,
        borderRadius: 13,
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? '#065fd4' : '#ccc',
        position: 'relative',
        transition: 'background 0.2s',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}
      />
    </button>
  );
}
