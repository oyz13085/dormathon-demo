import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, type TooltipProps,
} from 'recharts';
import { theme } from '../theme';

export interface ForecastPoint {
  label: string;
  volume: number;
  capacity?: number;
  HR?: number; IT?: number; Finance?: number; Marketing?: number;
}

interface Props { data: ForecastPoint[]; }

type Interval = 'Daily' | 'Weekly' | 'Monthly';

function CustomTooltip(props: TooltipProps<number, string> & { payload?: Array<{ dataKey?: string | number; name?: string; value?: number; color?: string }>; label?: string }) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: theme.colors.ink, color: '#fff', borderRadius: 10,
      padding: '10px 14px', fontSize: 12, boxShadow: theme.shadow,
    }}>
      <p style={{ margin: '0 0 6px', fontWeight: 600 }}>{label as string}</p>
      {payload.map((p: { dataKey?: string | number; name?: string; value?: number; color?: string }) => (
        <p key={String(p.dataKey)} style={{ margin: '2px 0', color: p.color ?? '#fff' }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

export function LineForecastChart({ data }: Props) {
  const [interval, setInterval] = useState<Interval>('Weekly');
  const capacityVal = data[0]?.capacity;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Interval pills */}
      <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end' }}>
        {(['Daily', 'Weekly', 'Monthly'] as Interval[]).map(i => (
          <button key={i} onClick={() => setInterval(i)} style={{
            padding: '4px 12px', borderRadius: theme.radius.pill, border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            background: interval === i ? theme.colors.ink : theme.colors.track,
            color: interval === i ? '#fff' : theme.colors.grey,
          }}>
            {i}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke={theme.colors.track} strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.colors.grey }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: theme.colors.grey }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          {capacityVal && (
            <ReferenceLine y={capacityVal} stroke={theme.colors.grey} strokeDasharray="6 3"
              label={{ value: 'Capacity', position: 'insideTopRight', fontSize: 11, fill: theme.colors.grey }} />
          )}
          <Line type="monotone" dataKey="volume" stroke={theme.colors.accent} strokeWidth={2.5}
            dot={{ r: 3, fill: theme.colors.accent, strokeWidth: 0 }} name="Volume" />
          {['HR', 'IT', 'Finance', 'Marketing'].map(dept => (
            <Line key={dept} type="monotone" dataKey={dept}
              stroke={theme.dept[dept as keyof typeof theme.dept]}
              strokeWidth={1.5} dot={false} name={dept} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
