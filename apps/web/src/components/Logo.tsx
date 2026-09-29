// melodyflix - premium logo component
interface Props {
  size?: number;
  showText?: boolean;
  variant?: 'light' | 'dark';
}

export default function Logo({ size = 32, showText = true, variant = 'light' }: Props) {
  const textColor = variant === 'light' ? '#0f0f0f' : '#fff';
  const gradId = `mf-grad-${size}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.max(8, size * 0.28) }}>
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="55%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        {/* Squircle background */}
        <rect width="64" height="64" rx="18" fill={`url(#${gradId})`} />
        {/* Subtle top highlight */}
        <rect
          x="2" y="2" width="60" height="30"
          rx="16" fill="rgba(255,255,255,0.12)"
        />
        {/* Play triangle */}
        <path d="M25 20 L47 32 L25 44 Z" fill="#fff" strokeLinejoin="round" />
      </svg>
      {showText && (
        <span
          style={{
            fontSize: Math.max(16, size * 0.62),
            fontWeight: 700,
            letterSpacing: -0.6,
            color: textColor,
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          melody
          <span style={{ color: '#a855f7' }}>flix</span>
        </span>
      )}
    </div>
  );
}
