import { theme } from '../theme';

interface Props {
  value: number | null;           // 0–100, or null when progress isn't known
  size?: 'sm' | 'lg';
  label?: string;                 // accessible name for the bar
}

// A null value renders an explicit "not tracked" state instead of a made-up percentage
export function ProgressBar({ value, size = 'sm', label = 'Progress' }: Props) {
  const height = size === 'lg' ? 10 : 6;
  const fontSize = size === 'lg' ? 13 : 12;

  if (value === null) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
        <span className="hatch-pattern" aria-hidden="true" style={{
          display: 'block', flex: 1, height, borderRadius: theme.radius.pill, backgroundColor: theme.colors.track, opacity: 0.6,
        }} />
        <span style={{ fontSize, color: theme.colors.grey, whiteSpace: 'nowrap' }}>Not tracked</span>
      </span>
    );
  }

  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const fill = pct === 100 ? theme.colors.sage : theme.colors.accent;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <span role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{
        display: 'block', flex: 1, height, borderRadius: theme.radius.pill, background: theme.colors.track, overflow: 'hidden',
      }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', borderRadius: theme.radius.pill, background: fill }} />
      </span>
      <span style={{ fontSize, fontWeight: 600, color: theme.colors.ink, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
    </span>
  );
}
