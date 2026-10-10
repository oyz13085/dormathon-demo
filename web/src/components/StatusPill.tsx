import { theme } from '../theme';

export type TicketStatus = 'Unassigned' | 'Assigned' | 'In progress' | 'Waiting' | 'Closed' | 'Needs revision';

interface Props { status: TicketStatus; }

const STYLES: Record<TicketStatus, { bg: string; color: string; border?: string }> = {
  'Unassigned':    { bg: 'transparent', color: theme.colors.grey,   border: theme.colors.grey },
  'Assigned':      { bg: 'transparent', color: theme.colors.ink,    border: theme.colors.ink },
  'In progress':   { bg: theme.colors.accent, color: '#fff' },
  'Waiting':       { bg: theme.colors.sand,   color: '#fff' },
  'Closed':        { bg: theme.colors.sage,   color: '#fff' },
  'Needs revision':{ bg: 'transparent', color: theme.colors.red,    border: theme.colors.red },
};

export function StatusPill({ status }: Props) {
  const s = STYLES[status];
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: theme.radius.pill,
      fontSize: 12,
      fontWeight: 600,
      background: s.bg,
      color: s.color,
      border: s.border ? `1.5px solid ${s.border}` : 'none',
      whiteSpace: 'nowrap',
    }}>
      {status}
    </span>
  );
}
