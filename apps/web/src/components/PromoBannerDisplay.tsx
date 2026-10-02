import { useEffect, useState } from 'react';
import { getActiveBanners, dismissBanner, getCachedUser, type Banner } from '../lib/api';

interface Props {
  placement: 'top' | 'bottom' | 'home' | 'watch';
}

export default function PromoBannerDisplay({ placement }: Props) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const me = getCachedUser();

  async function load() {
    try {
      const res = await getActiveBanners(placement);
      setBanners(res.banners);
    } catch {
      setBanners([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [placement, me?.id]);

  async function handleDismiss(id: string) {
    // Optimistic remove
    setBanners((prev) => prev.filter((b) => b.id !== id));
    if (me) {
      try { await dismissBanner(id); } catch {}
    }
  }

  if (banners.length === 0) return null;

  return (
    <div className="mf-promo-banner-stack" data-placement={placement}>
      {banners.map((b) => (
        <div
          key={b.id}
          className="mf-promo-banner"
          style={{ background: b.bg_color, color: b.text_color }}
          role="region"
          aria-label="Promotional banner"
        >
          <div className="mf-promo-banner-content">
            <div className="mf-promo-banner-text">
              <strong className="mf-promo-banner-title">{b.title}</strong>
              {b.message && <span className="mf-promo-banner-msg">{b.message}</span>}
            </div>
            {b.cta_label && b.cta_url && (
              <a
                href={b.cta_url}
                target={b.cta_url.startsWith('http') ? '_blank' : undefined}
                rel={b.cta_url.startsWith('http') ? 'noopener noreferrer' : undefined}
                className="mf-promo-banner-cta"
                style={{ color: b.text_color, borderColor: b.text_color }}
              >
                {b.cta_label}
              </a>
            )}
          </div>
          {b.dismissible === 1 && (
            <button
              className="mf-promo-banner-close"
              style={{ color: b.text_color }}
              onClick={() => handleDismiss(b.id)}
              title={me ? 'Dismiss (won\'t show again)' : 'Hide'}
              aria-label="Close banner"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
