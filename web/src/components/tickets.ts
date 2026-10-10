import type { Ticket } from '../api/types';

export type TicketTab = 'All' | 'Open' | 'Unassigned' | 'In progress' | 'Waiting' | 'Closed';

export function filterTickets(tickets: Ticket[], tab: TicketTab, search: string): Ticket[] {
  return tickets
    .filter(t => tab === 'All' || (tab === 'Open' ? t.status !== 'Closed'
      : tab === 'Unassigned' ? (!t.assignee_id && t.status !== 'Closed') : t.status === tab))
    .filter(t => `${t.title} ${t.division} ${t.requester} ${t.assignee_name ?? ''}`.toLowerCase()
      .includes(search.toLowerCase()));
}

// Percent complete. The API has no progress field yet, so only a closed ticket is known to be done
export function ticketProgress(t: Ticket): number | null {
  return t.status === 'Closed' ? 100 : null;
}
