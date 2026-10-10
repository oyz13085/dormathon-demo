import { theme } from '../../theme';
import { qs } from '../../api/client';
import type { Summary, Ticket } from '../../api/types';
import { useApi, useSession } from '../../session';
import { TicketTable } from '../../components/TicketTable';
import { Card, Loading } from '../../components/ui';

export default function MyTickets() {
  const { user, role } = useSession();
  // Analysts see the tickets they requested here; requesters see their own
  const { data, error } = useApi<Ticket[]>(`/tickets/${qs({ role: 'requester', user })}`);
  const summary = useApi<Summary>(role === 'requester' ? `/tickets/summary${qs({ role: 'requester', user })}` : null);
  const dept = summary.data?.departments[0];

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
      <Card title={role === 'analyst' ? 'Tickets I requested' : 'My tickets'}>
        {data ? <TicketTable tickets={data} showExpected tabs={['All', 'Open', 'Closed']} /> : <Loading error={error} />}
      </Card>
    </div>
  );
}
