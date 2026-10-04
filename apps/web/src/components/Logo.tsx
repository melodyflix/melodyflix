// melodyflix - premium logo component (crystalline SVG default)
// Custom logo can be provided via imageSrc prop (used by admin upload feature).

interface Props {
  size?: number;
  showText?: boolean;
  showTagline?: boolean;
  variant?: 'light' | 'dark';
  imageSrc?: string | null;
}

export default function Logo({ size = 32, showText = true, showTagline = false, variant = 'light', imageSrc = null }: Props) {
  const textColor = variant === 'light' ? '#0f0f0f' : '#fff';
  const taglineColor = variant === 'light' ? '#71717a' : '#a1a1aa';
  const uid = `mf-${size}-${variant}`;

  // Custom image logo (admin-uploaded) — renders as <img>
  if (imageSrc) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: Math.max(8, size * 0.22) }}>
        <img
          src={imageSrc}
          alt="MelodyFlix"
          width={size}
          height={size}
          style={{
            objectFit: 'contain',
            flexShrink: 0,
            filter: variant === 'dark' ? 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.4))' : 'none',
          }}
        />
      </div>
    );
  }

  // Default crystalline SVG mark
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.max(8, size * 0.28) }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        xmlns="http://www.w3.org/2000/svg"
        style={{ flexShrink: 0 }}
      >
        <defs>
          <linearGradient id={`${uid}-g1`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id={`${uid}-g2`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f0abfc" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <linearGradient id={`${uid}-g3`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id={`${uid}-g4`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e879f9" />
            <stop offset="100%" stopColor="#c026d3" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g filter={`url(#${uid}-glow)`}>
          <polygon points="4,46 18,32 32,46 18,60" fill={`url(#${uid}-g1)`} />
          <polygon points="4,46 18,32 18,60" fill={`url(#${uid}-g2)`} opacity="0.75" />
          <polygon points="18,32 32,46 18,60" fill={`url(#${uid}-g3)`} opacity="0.85" />
          <polygon points="10,44 18,36 26,44 18,52" fill="#fff" opacity="0.14" />
          <polygon points="14,42 18,38 22,42 18,46" fill="#fff" opacity="0.3" />
          <polygon points="26,10 34,8 34,46 26,48" fill={`url(#${uid}-g1)`} />
          <polygon points="26,10 26,48 30,48 30,10" fill={`url(#${uid}-g4)`} opacity="0.7" />
          <polygon points="30,10 34,8 34,46 30,48" fill={`url(#${uid}-g3)`} opacity="0.55" />
          <polygon points="34,8 56,18 42,32 34,22" fill={`url(#${uid}-g2)`} />
          <polygon points="34,8 56,18 48,13 34,10" fill={`url(#${uid}-g1)`} opacity="0.9" />
          <polygon points="34,22 42,32 36,34 34,26" fill={`url(#${uid}-g3)`} opacity="0.9" />
          <polygon points="34,10 48,13 42,16" fill="#fff" opacity="0.18" />
        </g>
      </svg>

      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span
            style={{
              fontSize: Math.max(16, size * 0.58),
              fontWeight: 800,
              letterSpacing: -0.6,
              lineHeight: 1.05,
              whiteSpace: 'nowrap',
              background: variant === 'light'
                ? 'linear-gradient(180deg, #18181b 0%, #3f3f46 45%, #18181b 55%, #52525b 100%)'
                : 'linear-gradient(180deg, #ffffff 0%, #d4d4d8 45%, #a1a1aa 55%, #e4e4e7 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              textShadow: variant === 'light'
                ? '0 1px 2px rgba(168, 85, 247, 0.12)'
                : '0 0 12px rgba(168, 85, 247, 0.35)',
              color: textColor,
            }}
          >
            Melody
            <span
              style={{
                background: 'linear-gradient(135deg, #c084fc 0%, #a855f7 40%, #ec4899 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Flix
            </span>
          </span>
          {showTagline && (
            <span
              style={{
                fontSize: Math.max(8, size * 0.16),
                fontWeight: 600,
                letterSpacing: size * 0.06,
                color: taglineColor,
                marginTop: size * 0.1,
                whiteSpace: 'nowrap',
              }}
            >
              CINEMA · DRAMA · MUSIC
            </span>
          )}
        </div>
      )}
    </div>
  );
}
