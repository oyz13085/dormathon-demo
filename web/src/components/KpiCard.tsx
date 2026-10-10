import type { LucideIcon } from 'lucide-react';
import { theme } from '../theme';

interface Props {
  label: string;
  value: number | string;
  delta?: number;        // +/- from yesterday
  icon?: LucideIcon;
  iconColor?: string;
}

export function KpiCard({ label, value, delta, icon: Icon, iconColor }: Props) {
  const positive = delta !== undefined && delta >= 0;

  return (
    <div style={{
      background: theme.colors.card,
      borderRadius: theme.radius.card,
      padding: theme.space.pad,
      boxShadow: theme.shadow,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {Icon && (
          <span style={{
            width: 32, height: 32, borderRadius: 8, background: iconColor ?? theme.colors.track,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon size={16} color={theme.colors.ink} strokeWidth={1.5} />
          </span>
        )}
        <span style={{ fontSize: theme.font.label, color: theme.colors.grey, fontWeight: 500 }}>
          {label}
        </span>
      </div>

      <span style={{ fontSize: theme.font.kpi, fontWeight: 700, color: theme.colors.ink, lineHeight: 1 }}>
        {value}
      </span>

      {delta !== undefined && (
        <span style={{ fontSize: 12, color: positive ? theme.colors.sage : theme.colors.red, fontWeight: 500 }}>
          {positive ? '+' : ''}{delta} from yesterday
        </span>
      )}
    </div>
  );
}
