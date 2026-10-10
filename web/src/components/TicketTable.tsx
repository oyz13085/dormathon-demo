import { useState, type ReactNode } from 'react';
import { Paperclip, AlertCircle } from 'lucide-react';
import { theme } from '../theme';
import type { Ticket } from '../api/types';
import { StatusPill } from './StatusPill';
import { DepartmentChip } from './DepartmentChip';
import { TicketFilters } from './TicketFilters';
import { filterTickets, type TicketTab } from './tickets';
import { Empty, PRIORITY_COLOR, RiskBadge, fmtDate, hours, initials } from './ui';

interface Props {
  tickets: Ticket[];
  showPredictions?: boolean;      // hours and risk: lead, and the analyst's own queue
  showAssignee?: boolean;
  showExpected?: boolean;         // expected completion: what requesters see
  actions?: (t: Ticket) => ReactNode;
  onSelect?: (t: Ticket) => void;
  selectedId?: number | null;
  tabs?: TicketTab[];
}

export function TicketTable({ tickets, showPredictions, showAssignee = true, showExpected, actions, onSelect,
  selectedId, tabs = ['All', 'Open', 'Unassigned', 'In progress', 'Waiting', 'Closed'] }: Props) {
  const [tab, setTab] = useState<TicketTab>(tabs[0]);
  const [search, setSearch] = useState('');

  const filtered = filterTickets(tickets, tab, search);

  const head = ['ID', 'Title', 'Dept', 'Priority', 'Status',
    ...(showAssignee ? ['Assignee'] : []),
    ...(showPredictions ? ['Est. hours', 'Risk'] : []),
    'Deadline',
    ...(showExpected ? ['Expected'] : []),
    '', ...(actions ? [''] : [])];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <TicketFilters tabs={tabs} tab={tab} onTab={setTab} search={search} onSearch={setSearch} />

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>{head.map((h, i) => (
              <th key={i} style={{ padding: '10px 12px', textAlign: 'left', color: theme.colors.grey, fontWeight: 500,
                fontSize: 12, borderBottom: `1.5px solid ${theme.colors.track}`, whiteSpace: 'nowrap' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.id} onClick={onSelect ? () => onSelect(t) : undefined} style={{
                cursor: onSelect ? 'pointer' : 'default',
                background: selectedId === t.id ? theme.colors.accent + '12' : 'transparent',
              }}>
                <td style={cell}><span style={{ color: theme.colors.grey }}>#{t.id}</span></td>
                <td style={{ ...cell, fontWeight: 500, maxWidth: 260 }}>
                  {t.title}
                  {t.confidence === 'Low' && t.status !== 'Closed' && showPredictions &&
                    <span style={{ display: 'block', fontSize: 11, color: theme.colors.sand, fontWeight: 600 }}>New ticket type: lead decides</span>}
                  {t.relation === 'requested' && <span style={{ display: 'block', fontSize: 11, color: theme.colors.grey }}>You requested this</span>}
                </td>
                <td style={cell}><DepartmentChip dept={t.division} size="sm" /></td>
                <td style={cell}><span style={{ color: PRIORITY_COLOR[t.priority], fontWeight: 600, fontSize: 12 }}>{t.priority}</span></td>
                <td style={cell}><StatusPill status={t.status} /></td>
                {showAssignee && (
                  <td style={cell}>
                    {t.assignee_name ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 24, height: 24, borderRadius: '50%', background: theme.colors.accent, color: '#fff',
                          fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {initials(t.assignee_name)}
                        </span>
                        <span style={{ fontSize: 12 }}>{t.assignee_name}</span>
                      </span>
                    ) : <span style={{ color: theme.colors.grey, fontSize: 12 }}>—</span>}
                  </td>
                )}
                {showPredictions && <td style={{ ...cell, whiteSpace: 'nowrap' }}>{hours(t.pred_low, t.pred_likely, t.pred_high)}</td>}
                {showPredictions && <td style={cell}>{t.status === 'Closed' ? '—' : <span title={t.explanation ?? ''}><RiskBadge p={t.p_miss} /></span>}</td>}
                <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {fmtDate(t.deadline)}
                    {t.alert && <AlertCircle size={13} color={theme.colors.red} strokeWidth={2} />}
                  </span>
                </td>
                {showExpected && (
                  <td style={{ ...cell, whiteSpace: 'nowrap', fontSize: 12 }}>
                    {t.status === 'Closed' ? `Done ${fmtDate(t.closed_at)}`
                      : t.expected_completion ? fmtDate(t.expected_completion)
                      : <span style={{ color: theme.colors.grey }}>{t.expected_note ?? '—'}</span>}
                  </td>
                )}
                <td style={cell}>
                  {!!t.deliverable_count && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: theme.colors.grey, fontSize: 12 }}>
                      <Paperclip size={12} strokeWidth={1.5} />{t.deliverable_count}
                    </span>
                  )}
                </td>
                {actions && <td style={{ ...cell, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>{actions(t)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty>No tickets here.</Empty>}
      </div>
    </div>
  );
}

const cell: React.CSSProperties = { padding: '10px 12px', verticalAlign: 'middle', borderBottom: `1px solid ${theme.colors.track}` };
