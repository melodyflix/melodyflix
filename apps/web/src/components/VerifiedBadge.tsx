// melodyflix - verified badge (reusable)
interface Props {
  verified: boolean | number | undefined;
  size?: number;
}

export default function VerifiedBadge({ verified, size = 14 }: Props) {
  const isVerified = verified === true || verified === 1;
  if (!isVerified) return null;
  return (
    <span
      title="Verified channel"
      aria-label="Verified"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#065fd4',
        color: '#fff',
        fontSize: Math.round(size * 0.65),
        fontWeight: 700,
        marginLeft: 4,
        verticalAlign: 'middle',
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      ✓
    </span>
  );
}
