// melodyflix - lightweight SVG charts (no external library)

interface LineChartProps {
  data: number[];
  labels?: string[];
  color?: string;
  height?: number;
  fill?: boolean;
}

export function LineChart({
  data, labels, color = '#7c3aed', height = 180, fill = true,
}: LineChartProps) {
  const width = 800; // viewBox width — scales to container
  const padding = { top: 10, right: 10, bottom: 22, left: 34 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const max = Math.max(...data, 1);
  const stepX = data.length > 1 ? w / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + h - (v / max) * h;
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ');

  const areaPath = points.length > 0
    ? `${linePath} L${points[points.length - 1][0]},${padding.top + h} L${points[0][0]},${padding.top + h} Z`
    : '';

  // Y-axis labels (5 ticks)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const val = Math.round(max * p);
    const y = padding.top + h - p * h;
    return { val, y };
  });

  // X-axis labels — show every Nth
  const showEvery = Math.max(1, Math.floor(data.length / 6));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            x1={padding.left} y1={t.y}
            x2={padding.left + w} y2={t.y}
            stroke="#e5e5e5" strokeDasharray="2 3"
          />
          <text x={padding.left - 6} y={t.y + 4} fontSize="10" fill="#909090" textAnchor="end">
            {t.val}
          </text>
        </g>
      ))}

      {/* Area */}
      {fill && areaPath && <path d={areaPath} fill={`url(#grad-${color.replace('#', '')})`} />}

      {/* Line */}
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />

      {/* Dots */}
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="#fff" stroke={color} strokeWidth="2" />
      ))}

      {/* X labels */}
      {labels && labels.map((lab, i) => {
        if (i % showEvery !== 0) return null;
        const x = padding.left + i * stepX;
        return (
          <text key={i} x={x} y={height - 6} fontSize="10" fill="#909090" textAnchor="middle">
            {lab.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

interface BarChartProps {
  data: number[];
  labels?: string[];
  color?: string;
  height?: number;
}

export function BarChart({ data, labels, color = '#065fd4', height = 160 }: BarChartProps) {
  const width = 800;
  const padding = { top: 10, right: 10, bottom: 22, left: 34 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const max = Math.max(...data, 1);
  const barW = data.length > 0 ? w / data.length : 0;
  const innerW = barW * 0.7;
  const showEvery = Math.max(1, Math.floor(data.length / 6));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <line
        x1={padding.left} y1={padding.top + h}
        x2={padding.left + w} y2={padding.top + h}
        stroke="#e5e5e5"
      />
      {data.map((v, i) => {
        const bh = (v / max) * h;
        const x = padding.left + i * barW + (barW - innerW) / 2;
        const y = padding.top + h - bh;
        return <rect key={i} x={x} y={y} width={innerW} height={bh} fill={color} rx="2" />;
      })}
      {/* Y labels */}
      {[0, 0.5, 1].map((p, i) => {
        const val = Math.round(max * p);
        const y = padding.top + h - p * h;
        return (
          <text key={i} x={padding.left - 6} y={y + 3} fontSize="10" fill="#909090" textAnchor="end">
            {val}
          </text>
        );
      })}
      {labels && labels.map((lab, i) => {
        if (i % showEvery !== 0) return null;
        const x = padding.left + i * barW + barW / 2;
        return (
          <text key={i} x={x} y={height - 6} fontSize="10" fill="#909090" textAnchor="middle">
            {lab.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  color?: string;
  icon?: string;
}

export function StatCard({ label, value, hint, color = '#7c3aed', icon }: StatCardProps) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e5e5e5',
        borderRadius: 12,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        borderLeft: `4px solid ${color}`,
      }}
    >
      <div style={{ fontSize: 12, color: '#606060', textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 }}>
        {icon && <span style={{ marginRight: 4 }}>{icon}</span>}
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 12, color: '#909090' }}>{hint}</div>}
    </div>
  );
}
