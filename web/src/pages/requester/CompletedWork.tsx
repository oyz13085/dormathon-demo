import { useState } from 'react';
import { FileText, Link2, MessageSquare } from 'lucide-react';
import { theme } from '../../theme';
import { api } from '../../api/client';
import type { Deliverable } from '../../api/types';
import { completedWorkPath, type ApiCompletedItem } from '../../api/requester';
import { useApi, useSession } from '../../session';
import { DepartmentChip } from '../../components/DepartmentChip';
import { CompletedWorkCard } from '../../components/CompletedWorkCard';
import { CompletedWorkModal } from '../../components/CompletedWorkModal';
import { REVIEW_FILTERS, fromApi, matchesReviewFilter, type ReviewFilter } from '../../components/completedWork';
import { TicketFilters } from '../../components/TicketFilters';
import { Card, Empty, Loading, Pill, fmtDate } from '../../components/ui';

export function DeliverableBody({ d }: { d: Deliverable }) {
  const Icon = d.kind === 'File' ? FileText : d.kind === 'Link' ? Link2 : MessageSquare;
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: theme.colors.track, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} color={theme.colors.ink} strokeWidth={1.5} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>{d.ticket_title}</strong>
          <DepartmentChip dept={d.division} size="sm" />
          {d.version > 1 && <Pill>v{d.version}</Pill>}
        </div>
        <p style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.5 }}>{d.summary}</p>
        <div style={{ fontSize: 12, color: theme.colors.grey }}>
          {d.kind === 'None' ? 'No deliverable' : (
            <a href={api.fileUrl(d.id)} target="_blank" rel="noreferrer" style={{ color: theme.colors.accent, fontWeight: 600 }}>
              {d.kind === 'File' ? `Open ${d.file_name}` : 'Open link'}
            </a>
          )}
          {' · '}{d.analyst_name} · {fmtDate(d.uploaded_at)}
        </div>
      </div>
    </div>
  );
}

const EMPTY: Record<ReviewFilter, string> = {
  All: '',
  'Awaiting review': 'Nothing is waiting for your review.',
  Reviewed: "You haven't reviewed any completed work yet.",
};

export default function CompletedWork() {
  const { user } = useSession();
  // Every version with its full review history, straight from the requester API
  const { data, error } = useApi<{ items: ApiCompletedItem[] }>(completedWorkPath(user));
  const [filter, setFilter] = useState<ReviewFilter>('All');
  // Keep the id, not the work, so a saved review shows up in the open modal
  const [openId, setOpenId] = useState<number | null>(null);

  const work = data ? fromApi(data.items) : null;
  const shown = work?.filter(w => matchesReviewFilter(w, filter)) ?? [];
  const counts = Object.fromEntries(REVIEW_FILTERS.map(f => [f, work?.filter(w => matchesReviewFilter(w, f)).length ?? 0]));
  const open = work?.find(w => w.ticketId === openId);

  return (
    <Card title="My completed work">
      {!work ? <Loading error={error} />
        : work.length === 0 ? (
          <Empty>Nothing has been delivered to {user} yet. Finished work shows up here once an analyst closes one of your tickets.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <TicketFilters tabs={REVIEW_FILTERS} tab={filter} onTab={setFilter} counts={counts} />
            <div className="fq-ticket-grid-wrap">
              <ul className="fq-ticket-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {shown.map(w => <li key={w.ticketId}><CompletedWorkCard work={w} onOpen={() => setOpenId(w.ticketId)} /></li>)}
              </ul>
              {shown.length === 0 && <Empty>{EMPTY[filter]}</Empty>}
            </div>
          </div>
        )}
      {open && <CompletedWorkModal work={open} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
