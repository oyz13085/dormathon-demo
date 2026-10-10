import { AlertCircle } from 'lucide-react';
import { theme } from '../theme';
import type { Ticket } from '../api/types';
import { StatusPill } from './StatusPill';
import { DepartmentChip } from './DepartmentChip';
import { ProgressBar } from './ProgressBar';
import { PRIORITY_COLOR, fmtDate } from './ui';
import { ticketProgress } from './tickets';

export function TicketCard({ ticket: t, onOpen }: { ticket: Ticket; onOpen: (t: Ticket) => void }) {
  return (
    <button type="button" className="fq-ticket-card" onClick={() => onOpen(t)} aria-haspopup="dialog" style={{
      display: 'flex', flexDirection: 'column', gap: 12, width: '100%', height: '100%', padding: 16,
      textAlign: 'left', font: 'inherit', color: theme.colors.ink, cursor: 'pointer',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ fontSize: 12, color: theme.colors.grey, flex: 1 }}>#{t.id}</span>
        <StatusPill status={t.status} />
      </span>

      <span style={{
        fontSize: 14, fontWeight: 600, lineHeight: 1.4,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{t.title}</span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <DepartmentChip dept={t.division} size="sm" />
        <span style={{ color: PRIORITY_COLOR[t.priority], fontWeight: 600, fontSize: 12 }}>{t.priority} priority</span>
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: theme.colors.grey, marginTop: 'auto' }}>
        Deadline <strong style={{ color: theme.colors.ink, fontWeight: 600 }}>{fmtDate(t.deadline)}</strong>
        {t.alert && <AlertCircle size={13} color={theme.colors.red} strokeWidth={2} aria-label="Deadline at risk" />}
      </span>

      <span style={{ display: 'block', width: '100%', paddingTop: 12, borderTop: `1px solid ${theme.colors.track}` }}>
        <ProgressBar value={ticketProgress(t)} label={`Ticket #${t.id} progress`} />
      </span>
    </button>
  );
}
