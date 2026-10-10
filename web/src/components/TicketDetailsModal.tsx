import { AlertCircle } from 'lucide-react';
import { theme } from '../theme';
import type { Ticket } from '../api/types';
import { StatusPill } from './StatusPill';
import { DepartmentChip } from './DepartmentChip';
import { ProgressBar } from './ProgressBar';
import { ticketProgress } from './tickets';
import { Detail, Modal, PRIORITY_COLOR, SectionTitle, fmtDate, initials } from './ui';

export function TicketDetailsModal({ ticket: t, onClose }: { ticket: Ticket; onClose: () => void }) {
  const progress = ticketProgress(t);
  return (
    <Modal title={t.title} onClose={onClose} width={620} centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13 }}>
        <span style={{ fontSize: 12, color: theme.colors.grey, marginTop: -8 }}>Ticket #{t.id}</span>

        <section>
          <SectionTitle>Description</SectionTitle>
          {t.description
            ? <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{t.description}</p>
            : <p style={{ margin: 0, color: theme.colors.grey }}>No description was provided.</p>}
        </section>

        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px 24px' }}>
          <Detail label="Department"><DepartmentChip dept={t.division} size="sm" /></Detail>
          <Detail label="Priority"><span style={{ color: PRIORITY_COLOR[t.priority], fontWeight: 600 }}>{t.priority}</span></Detail>
          <Detail label="Status"><StatusPill status={t.status} /></Detail>
          <Detail label="Assigned analyst">
            {t.assignee_name ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', background: theme.colors.accent, color: '#fff',
                  fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {initials(t.assignee_name)}
                </span>
                {t.assignee_name}
              </span>
            ) : <span style={{ color: theme.colors.grey }}>Not assigned yet</span>}
          </Detail>
          <Detail label="Deadline">
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {fmtDate(t.deadline)}
              {t.alert && <><AlertCircle size={13} color={theme.colors.red} strokeWidth={2} aria-hidden="true" />
                <span style={{ color: theme.colors.red, fontSize: 12 }}>At risk</span></>}
            </span>
          </Detail>
          <Detail label={t.status === 'Closed' ? 'Completed' : 'Expected completion'}>
            {t.status === 'Closed' ? fmtDate(t.closed_at)
              : t.expected_completion ? fmtDate(t.expected_completion)
              : <span style={{ color: theme.colors.grey }}>{t.expected_note ?? '—'}</span>}
          </Detail>
        </dl>

        <section>
          <SectionTitle>Progress</SectionTitle>
          <ProgressBar value={progress} size="lg" label={`Ticket #${t.id} progress`} />
          {progress === null && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: theme.colors.grey }}>
              Progress isn't reported for open tickets yet. Check the status and expected completion date above.
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
