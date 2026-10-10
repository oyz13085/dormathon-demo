import { useState } from 'react';
import { CheckCircle, Clock, Hourglass, Inbox, ListTodo, UserX } from 'lucide-react';
import { theme } from '../../theme';
import { qs } from '../../api/client';
import type { Ticket } from '../../api/types';
import { useApi, useSession } from '../../session';
import { filterTickets, type TicketTab } from '../../components/tickets';
import { TicketCard } from '../../components/TicketModals';
import { TicketDetailsModal } from '../../components/TicketDetailsModal';
import { Card, Empty, Hint, Loading, Page, SearchBox, StatRow, StatTile, TabPills, Toolbar } from '../../components/ui';

const TABS = ['All', 'Open', 'Closed'] as const;

export default function MyTickets() {
  const { user, role, meta } = useSession();
  // Analysts see the tickets they requested here; requesters see their own
  const { data, error } = useApi<Ticket[]>(`/tickets/${qs({ role: 'requester', user })}`);
  const [tab, setTab] = useState<TicketTab>('All');
  const [search, setSearch] = useState('');
  // Keep the id, not the ticket, so a data refresh shows up in an open modal
  const [openId, setOpenId] = useState<number | null>(null);
  const tickets = data ?? [];
  const filtered = filterTickets(tickets, tab, search)
    .sort((a, b) => Number(a.status === 'Closed') - Number(b.status === 'Closed') || a.deadline.localeCompare(b.deadline));
  const open = data?.find(t => t.id === openId);
  const n = (f: (t: Ticket) => boolean) => tickets.filter(f).length;
  const division = meta?.requesters.find(r => r.name === user)?.division;
  const title = role === 'analyst' ? 'Tickets I requested' : 'Tickets Assigned';

  return (
    <Page>
      <Card title={role === 'analyst' ? 'My requests' : <>Your requests{division ? <span style={{ fontWeight: 400, color: theme.colors.grey, fontSize: 13 }}> · {division}</span> : null}</>}
        icon={Inbox} iconColor={theme.colors.accent} right={<Hint>Where each of your requests stands</Hint>}>
        {!data ? <Loading error={error} /> : (
          <StatRow>
            <StatTile icon={Inbox} color={theme.colors.ink} label="Total" value={tickets.length} hint="requests made" />
            <StatTile icon={CheckCircle} color={theme.colors.sage} label="Done" value={n(t => t.status === 'Closed')} hint="closed with a deliverable" />
            <StatTile icon={Clock} color={theme.colors.accent} label="In progress" value={n(t => t.status === 'In progress' || t.status === 'Assigned')} hint="an analyst has it" />
            <StatTile icon={Hourglass} color={theme.colors.sand} label="Waiting on you" value={n(t => t.status === 'Waiting')} hint="the analyst needs something" />
            <StatTile icon={UserX} color={theme.colors.grey} label="Unassigned" value={n(t => t.status === 'Unassigned')} hint="the lead will assign it" />
          </StatRow>
        )}
      </Card>

      <Card title={title} icon={ListTodo} iconColor={theme.colors.accent} right={<Hint>Open ones first · click a ticket for details</Hint>}>
        {!data ? <Loading error={error} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Toolbar>
              <TabPills tabs={TABS} value={tab as typeof TABS[number]} onChange={setTab}
                counts={{ All: tickets.length, Open: n(t => t.status !== 'Closed'), Closed: n(t => t.status === 'Closed') }} />
              <SearchBox value={search} onChange={setSearch} placeholder="Search tickets…" />
            </Toolbar>
            {filtered.length === 0 ? <Empty>No tickets here.</Empty> : (
              <div className="fq-cards" style={{ ['--min' as string]: '240px' }}>
                {filtered.map(t => <TicketCard key={t.id} t={t} onOpen={setOpenId} />)}
              </div>
            )}
          </div>
        )}
      </Card>
      {open && <TicketDetailsModal ticket={open} onClose={() => setOpenId(null)} />}
    </Page>
  );
}
