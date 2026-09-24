export default function Sparkline({
  points,
  color,
  width = 96,
  height = 28,
}: {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const finite = points.filter((value) => Number.isFinite(value));
  if (finite.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="#3a1c74" strokeDasharray="3 3" />
      </svg>
    );
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (finite.length - 1);
  const coords = finite.map((value, index) => [
    pad + index * step,
    height - pad - ((value - min) / span) * (height - pad * 2),
  ]);
  const last = coords[coords.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <rect x={last[0] - 2} y={last[1] - 2} width="4" height="4" fill={color} />
    </svg>
  );
}
