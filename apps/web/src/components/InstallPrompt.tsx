// melodyflix - PWA install prompt
import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Check if already dismissed
    const dismissedAt = localStorage.getItem('mf_install_dismissed');
    if (dismissedAt) {
      const diffDays = (Date.now() - Number(dismissedAt)) / (24 * 60 * 60 * 1000);
      if (diffDays < 14) return; // don't show for 14 days after dismissal
    }

    // Detect if already installed (standalone mode)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Detect iOS
    const ua = window.navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    setIsIOS(iosDevice);

    // iOS: no beforeinstallprompt, show custom prompt after delay
    if (iosDevice) {
      setTimeout(() => setVisible(true), 5000);
      return;
    }

    // Android/Chrome: use beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function dismiss() {
    localStorage.setItem('mf_install_dismissed', String(Date.now()));
    setVisible(false);
    setShowIOSInstructions(false);
  }

  async function handleInstall() {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') {
        setVisible(false);
      } else {
        dismiss();
      }
    } catch {
      dismiss();
    }
  }

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: 20,
        right: 20,
        maxWidth: 400,
        margin: '0 auto',
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 14,
        boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
        padding: 16,
        zIndex: 900,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #7c3aed, #ec4899)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <path d="M25 20 L47 32 L25 44 Z" fill="#fff" />
        </svg>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {!showIOSInstructions ? (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              Install melodyflix
            </div>
            <div style={{ fontSize: 12, color: '#606060', lineHeight: 1.5, marginBottom: 10 }}>
              Add to your home screen for a faster, full-screen experience.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleInstall}
                style={{
                  background: '#7c3aed',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Install
              </button>
              <button
                onClick={dismiss}
                style={{
                  background: 'transparent',
                  color: '#606060',
                  border: 'none',
                  padding: '8px 12px',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Not now
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
              Install on iPhone
            </div>
            <ol style={{ fontSize: 12, color: '#404040', lineHeight: 1.7, paddingLeft: 18 }}>
              <li>Tap the <strong>Share</strong> button below</li>
              <li>Scroll and tap <strong>Add to Home Screen</strong></li>
              <li>Tap <strong>Add</strong> to confirm</li>
            </ol>
            <button
              onClick={dismiss}
              style={{
                background: '#7c3aed',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginTop: 8,
              }}
            >
              Got it
            </button>
          </>
        )}
      </div>

      <button
        onClick={dismiss}
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: 18,
          cursor: 'pointer',
          color: '#909090',
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
        title="Close"
      >
        ✕
      </button>
    </div>
  );
}
