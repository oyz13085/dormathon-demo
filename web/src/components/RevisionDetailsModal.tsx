import { theme } from '../theme';
import type { Deliverable } from '../api/types';
import { ticketRevisionRequestsPath, type RevisionRequest } from '../api/requesterRevisions';
import { useApi } from '../session';
import { StatusPill } from './StatusPill';
import { RequestDetails } from './CompletedWorkModal';
import { Detail, Loading, Modal, Notice, SectionTitle, fmtDate } from './ui';

// What the requester asked for when they sent this deliverable back, for the analyst doing the rework.
// The server decides who may read it (the requester and the assigned analyst), including the attachments.
export function RevisionDetailsModal({ deliverable: d, user, onClose }: {
  deliverable: Deliverable; user: string; onClose: () => void;
}) {
  const { data, error } = useApi<RevisionRequest[]>(ticketRevisionRequestsPath(d.ticket_id, user));
  const requests = data?.filter(r => r.deliverable_id === d.id) ?? [];

  return (
    <Modal title={`Revision details: ${d.ticket_title}`} onClose={onClose} width={620} centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13 }}>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px 24px' }}>
          <Detail label="Ticket">#{d.ticket_id}</Detail>
          <Detail label="Previous deliverable">Version {d.version}</Detail>
          <Detail label="Requested by">{d.requester}</Detail>
          <Detail label="Ticket status"><StatusPill status={d.ticket_status} /></Detail>
        </dl>

        {error ? (
          <Notice tone="error">
            {error}. If the ticket was reassigned, the analyst it's assigned to now can see these details.
          </Notice>
        ) : !data ? <Loading /> : requests.length === 0 ? (
          // Ratings saved before structured requests existed only have the one-line note
          <section>
            <SectionTitle>Requester's note</SectionTitle>
            <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {d.revision_note || <span style={{ color: theme.colors.grey }}>The requester didn't leave any details.</span>}
            </p>
          </section>
        ) : requests.map(r => (
          <section key={r.id}>
            <SectionTitle>Requested by {r.created_by} · {fmtDate(r.created_at)}</SectionTitle>
            <RequestDetails q={r} />
          </section>
        ))}
      </div>
    </Modal>
  );
}
