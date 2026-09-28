import { useState, useRef, useEffect } from 'react';

interface Props {
  videoId: string;
  title: string;
  onToast: (msg: string) => void;
}

export default function ShareMenu({ videoId, title, onToast }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const url = `${window.location.origin}/watch/${videoId}`;

  function copyLink() {
    navigator.clipboard.writeText(url)
      .then(() => onToast('Link copied to clipboard'))
      .catch(() => onToast('Failed to copy'));
    setOpen(false);
  }

  function openWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}`, '_blank');
    setOpen(false);
  }

  function openFacebook() {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank');
    setOpen(false);
  }

  function openTwitter() {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, '_blank');
    setOpen(false);
  }

  function openTelegram() {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`, '_blank');
    setOpen(false);
  }

  function openEmail() {
    window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`;
    setOpen(false);
  }

  async function nativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        setOpen(false);
      } catch {}
    } else {
      copyLink();
    }
  }

  return (
    <div className="mf-share-wrap" ref={wrapRef}>
      <button
        className="mf-sub-btn"
        style={{ background: '#f2f2f2', color: '#0f0f0f' }}
        onClick={() => setOpen((v) => !v)}
      >
        🔗 Share
      </button>

      {open && (
        <div className="mf-share-menu">
          {typeof navigator.share === 'function' && (
            <>
              <div className="mf-share-item" onClick={nativeShare}>
                <div className="mf-share-icon">📱</div>
                <span>Share via...</span>
              </div>
              <div className="mf-share-divider" />
            </>
          )}

          <div className="mf-share-item" onClick={copyLink}>
            <div className="mf-share-icon copy">🔗</div>
            <span>Copy link</span>
          </div>

          <div className="mf-share-item" onClick={openWhatsApp}>
            <div className="mf-share-icon whatsapp">💬</div>
            <span>WhatsApp</span>
          </div>

          <div className="mf-share-item" onClick={openFacebook}>
            <div className="mf-share-icon facebook">f</div>
            <span>Facebook</span>
          </div>

          <div className="mf-share-item" onClick={openTwitter}>
            <div className="mf-share-icon twitter">𝕏</div>
            <span>X (Twitter)</span>
          </div>

          <div className="mf-share-item" onClick={openTelegram}>
            <div className="mf-share-icon">✈️</div>
            <span>Telegram</span>
          </div>

          <div className="mf-share-item" onClick={openEmail}>
            <div className="mf-share-icon">✉️</div>
            <span>Email</span>
          </div>
        </div>
      )}
    </div>
  );
}
