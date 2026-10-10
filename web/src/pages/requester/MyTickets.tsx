import { useState } from 'react';
import { theme } from '../../theme';
import { qs } from '../../api/client';
import type { Summary, Ticket } from '../../api/types';
import { useApi, useSession } from '../../session';
import { TicketFilters } from '../../components/TicketFilters';
import { filterTickets, type TicketTab } from '../../components/tickets';
import { TicketCard } from '../../components/TicketCard';
import { TicketDetailsModal } from '../../components/TicketDetailsModal';
import { Card, Empty, Loading } from '../../components/ui';

export default function MyTickets() {
  const { user, role } = useSession();
  // Analysts see the tickets they requested here; requesters see their own
  const { data, error } = useApi<Ticket[]>(`/tickets/${qs({ role: 'requester', user })}`);
  const summary = useApi<Summary>(role === 'requester' ? `/tickets/summary${qs({ role: 'requester', user })}` : null);
  const dept = summary.data?.departments[0];
  const [tab, setTab] = useState<TicketTab>('All');
  const [search, setSearch] = useState('');
  // Keep the id, not the ticket, so a data refresh shows up in an open modal
  const [openId, setOpenId] = useState<number | null>(null);
  const filtered = data ? filterTickets(data, tab, search) : [];
  const open = data?.find(t => t.id === openId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
      {dept && (
        <Card title={`${dept.division} department: request status`}>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', fontSize: 13 }}>
            {([['Total', dept.total], ['Solved', dept.solved], ['In progress', dept.in_progress],
              ['Waiting', dept.waiting], ['Unassigned', dept.unassigned]] as const).map(([l, v]) => (
              <div key={l}><div style={{ fontSize: 24, fontWeight: 700 }}>{v}</div><div style={{ color: theme.colors.grey }}>{l}</div></div>
            ))}
          </div>
        </Card>
      )}
      <Card title={role === 'analyst' ? 'Tickets I requested' : 'Tickets Assigned'}>
        {data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <TicketFilters tabs={['All', 'Open', 'Closed']} tab={tab} onTab={setTab} search={search} onSearch={setSearch} />
            <div className="fq-ticket-grid-wrap">
              <ul className="fq-ticket-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {filtered.map(t => <li key={t.id}><TicketCard ticket={t} onOpen={() => setOpenId(t.id)} /></li>)}
              </ul>
              {filtered.length === 0 && <Empty>No tickets here.</Empty>}
            </div>
          </div>
        ) : <Loading error={error} />}
      </Card>
      {open && <TicketDetailsModal ticket={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
