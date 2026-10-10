import { Paperclip } from 'lucide-react';
import { theme } from '../theme';
import { DepartmentChip } from './DepartmentChip';
import { Pill, fmtDate } from './ui';
import { REVIEW_COLOR, analystName, attachments, reviewStatus, type CompletedWork } from './completedWork';

export function CompletedWorkCard({ work: w, onOpen }: { work: CompletedWork; onOpen: () => void }) {
  const status = reviewStatus(w);
  const files = attachments(w).length;
  return (
    <button type="button" className="fq-ticket-card fq-lift" onClick={onOpen} aria-haspopup="dialog" style={{
      display: 'flex', flexDirection: 'column', gap: 12, width: '100%', height: '100%', padding: 16,
      textAlign: 'left', font: 'inherit', color: theme.colors.ink, cursor: 'pointer',
    }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ fontSize: 12, color: theme.colors.grey, flex: 1 }}>#{w.ticketId}</span>
        <Pill color={REVIEW_COLOR[status]}>{status}</Pill>
      </span>

      <span style={{
        fontSize: 14, fontWeight: 600, lineHeight: 1.4,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{w.latest.ticket_title}</span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DepartmentChip dept={w.latest.division} size="sm" />
        {w.latest.version > 1 && <Pill>Version {w.latest.version}</Pill>}
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: theme.colors.grey, marginTop: 'auto' }}>
        <span>Analyst <strong style={{ color: theme.colors.ink, fontWeight: 600 }}>{analystName(w)}</strong></span>
        <span>Completed <strong style={{ color: theme.colors.ink, fontWeight: 600 }}>{fmtDate(w.latest.uploaded_at)}</strong></span>
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', paddingTop: 12,
        borderTop: `1px solid ${theme.colors.track}`, fontSize: 12, color: theme.colors.grey }}>
        <Paperclip size={12} strokeWidth={1.5} aria-hidden="true" />
        {files === 0 ? 'No attachments' : `${files} ${files === 1 ? 'attachment' : 'attachments'}`}
      </span>
    </button>
  );
}
