// melodyflix - premium logo component (uses official PNG brand mark)
// The official logo is at /public/logo.png (3264x3264 PNG with transparency).

interface Props {
  size?: number;
  showText?: boolean;
  showTagline?: boolean;
  variant?: 'light' | 'dark';
}

export default function Logo({ size = 32, showText = true, showTagline = false, variant = 'light' }: Props) {
  const textColor = variant === 'light' ? '#0f0f0f' : '#fff';
  const taglineColor = variant === 'light' ? '#71717a' : '#a1a1aa';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.max(8, size * 0.22) }}>
      <img
        src="/logo.png"
        alt="MelodyFlix"
        width={size}
        height={size}
        style={{
          objectFit: 'contain',
          flexShrink: 0,
          filter: variant === 'dark' ? 'drop-shadow(0 0 8px rgba(168, 85, 247, 0.4))' : 'none',
        }}
      />

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
