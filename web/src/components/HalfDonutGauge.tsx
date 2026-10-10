import { PieChart, Pie, Cell } from 'recharts';
import { theme, type Dept } from '../theme';

interface Segment { dept: Dept; value: number; }

interface Props {
  percent: number;          // 0-100
  label: string;            // e.g. "Team capacity this week"
  segments?: Segment[];     // optional dept breakdown
  size?: number;            // outer radius, default 90
}

export function HalfDonutGauge({ percent, label, segments, size = 90 }: Props) {
  const total = segments?.reduce((s, d) => s + d.value, 0) ?? 100;
  const data: { name: string; value: number; color: string }[] = segments
    ? segments.map(s => ({ name: s.dept, value: s.value, color: theme.dept[s.dept] }))
    : [
        { name: 'used',      value: percent,       color: theme.colors.accent },
        { name: 'remaining', value: 100 - percent, color: theme.colors.track },
      ];

  const w = size * 2 + 20;
  const h = size + 20;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden' }}>
        <PieChart width={w} height={h * 2}>
          <Pie
            data={data}
            cx={w / 2}
            cy={h}
            startAngle={180}
            endAngle={0}
            innerRadius={size * 0.62}
            outerRadius={size}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
          </Pie>
        </PieChart>

        {/* Centre label */}
        <div style={{
          position: 'absolute', bottom: 4, left: 0, right: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}>
          <span style={{ fontSize: 32, fontWeight: 700, color: theme.colors.ink, lineHeight: 1 }}>
            {percent}%
          </span>
        </div>
      </div>

      <span style={{ fontSize: theme.font.label, color: theme.colors.grey, textAlign: 'center', maxWidth: w }}>
        {label}
      </span>

      {segments && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 4 }}>
          {segments.map(s => (
            <span key={s.dept} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: theme.colors.grey }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: theme.dept[s.dept] }} />
              {s.dept} {Math.round((s.value / total) * 100)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
