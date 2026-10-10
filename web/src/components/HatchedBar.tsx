import { theme } from '../theme';

interface Props {
  label: string;
  booked: number;     // hours booked
  capacity: number;   // total capacity
  avatarInitials?: string;
  avatarColor?: string;
}

const HATCH_ID = 'fq-hatch';

export function HatchedBar({ label, booked, capacity, avatarInitials, avatarColor }: Props) {
  const pct = Math.min(booked / capacity, 1);
  const overloaded = pct > 0.9;
  const barColor = overloaded ? theme.colors.accent : theme.colors.ink;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {avatarInitials && (
        <span style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: avatarColor ?? theme.colors.track,
          color: '#fff', fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {avatarInitials}
        </span>
      )}

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: theme.colors.ink }}>{label}</span>
          <span style={{ fontSize: 12, color: overloaded ? theme.colors.accent : theme.colors.grey }}>
            {booked}/{capacity}h
          </span>
        </div>

        {/* SVG bar with hatch for remaining */}
        <svg width="100%" height={14} style={{ display: 'block' }}>
          <defs>
            <pattern id={HATCH_ID} patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(-45)">
              <line x1={0} y1={0} x2={0} y2={8} stroke={theme.colors.grey} strokeWidth={1.5} />
            </pattern>
          </defs>
          {/* Track (full width hatch) */}
          <rect x={0} y={2} width="100%" height={10} rx={5} fill={`url(#${HATCH_ID})`} opacity={0.35} />
          {/* Filled portion */}
          <rect x={0} y={2} width={`${pct * 100}%`} height={10} rx={5} fill={barColor} />
        </svg>
      </div>
    </div>
  );
}
