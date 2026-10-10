import { theme, type Dept } from '../theme';

interface Props {
  dept: Dept;
  size?: 'sm' | 'md';
}

export function DepartmentChip({ dept, size = 'md' }: Props) {
  const color = theme.dept[dept];
  const isLight = dept === 'IT';
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: size === 'sm' ? '2px 8px' : '3px 10px',
      borderRadius: theme.radius.pill,
      fontSize: size === 'sm' ? 11 : 12,
      fontWeight: 600,
      background: color + '1A',   // 10% alpha tint
      color: isLight ? theme.colors.ink : color,
      whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {dept}
    </span>
  );
}
