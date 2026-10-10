import { useState } from 'react';
import { Flag, ListChecks, Repeat, ScrollText, ThumbsDown, UserCheck } from 'lucide-react';
import { theme } from '../../theme';
import { useApi } from '../../session';
import { Card, Empty, Hint, Loading, Page, Pill, SearchBox, StatRow, StatTile, TabPills, Table, Toolbar, fmtDate, td } from '../../components/ui';

interface Log {
  override_rate: number;
  handovers: number;
  assignments: { id: number; ticket_id: number; title: string; division: string; recommended_name?: string; recommended_fit?: number;
    chosen_name?: string; chosen_fit?: number; support_name?: string; accepted: number; override_reason?: string;
    decided_by?: string; is_handover: number; decided_at: string }[];
  priority_changes: { id: number; ticket_id: number; title: string; suggested?: string; chosen: string; reason?: string; changed_by?: string; changed_at: string }[];
}

const TABS = ['All', 'Overridden', 'Handovers'] as const;
type Tab = typeof TABS[number];

export default function OverrideLog() {
  const { data, error } = useApi<Log>('/assignment/log');
  const [tab, setTab] = useState<Tab>('All');
  const [search, setSearch] = useState('');
  if (!data) return <Card title="Override log" icon={ScrollText}><Loading error={error} /></Card>;

  const inTab = (a: Log['assignments'][number], t: Tab) => t === 'All' || (t === 'Overridden' ? !a.accepted : !!a.is_handover);
  const rows = data.assignments.filter(a => inTab(a, tab)
    && (!search || `${a.title} #${a.ticket_id} ${a.chosen_name ?? ''} ${a.recommended_name ?? ''} ${a.override_reason ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const fit = (n?: string, f?: number) => n ? <>{n}{f != null && <span style={{ color: theme.colors.grey }}> ({Math.round(f)})</span>}</> : '—';

  return (
    <Page>
      <Card title="Override log" icon={ScrollText} iconColor={theme.colors.accent} right={<Hint>Every assignment and priority decision, with the reason</Hint>}>
        <StatRow>
          <StatTile icon={UserCheck} color={theme.colors.ink} label="Decisions" value={data.assignments.length} hint="assignments recorded" />
          <StatTile icon={ThumbsDown} color={data.override_rate > 0.3 ? theme.colors.red : theme.colors.sage} label="Overridden"
            value={`${Math.round(data.override_rate * 100)}%`} hint="a trust measure for the recommender" />
          <StatTile icon={Repeat} color={theme.colors.sand} label="Handovers" value={data.handovers} hint="a ticket moved between analysts" />
          <StatTile icon={Flag} color={theme.colors.accent} label="Priority changes" value={data.priority_changes.length} hint="suggested vs chosen" />
        </StatRow>
      </Card>

      <Card title="Assignment decisions" icon={ListChecks} iconColor={theme.colors.accent} right={<Hint>Newest first</Hint>}>
        <div style={{ marginBottom: 12 }}>
          <Toolbar>
            <TabPills tabs={TABS} value={tab} onChange={setTab}
              counts={{ All: data.assignments.length, Overridden: data.assignments.filter(a => !a.accepted).length, Handovers: data.assignments.filter(a => a.is_handover).length }} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search ticket, analyst or reason…" />
          </Toolbar>
        </div>
        {rows.length === 0 ? <Empty>No decisions match.</Empty> : (
          <Table head={['When', 'Ticket', 'Recommended', 'Chosen', 'Support', 'Decision', 'Reason', 'By']}>
            {rows.map(a => (
              <tr key={a.id}>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(a.decided_at)}</td>
                <td style={{ ...td, minWidth: 200 }}><span style={{ color: theme.colors.grey }}>#{a.ticket_id}</span> {a.title}</td>
                <td style={td}>{fit(a.recommended_name, a.recommended_fit)}</td>
                <td style={td}>{fit(a.chosen_name, a.chosen_fit)}</td>
                <td style={td}>{a.support_name ?? '—'}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>
                  {a.accepted ? <Pill color={theme.colors.sage}>accepted</Pill> : <Pill color={theme.colors.red}>overridden</Pill>}
                  {!!a.is_handover && <> <Pill color={theme.colors.sand}>handover</Pill></>}
                </td>
                <td style={{ ...td, minWidth: 160 }}>{a.override_reason ?? ''}</td>
                <td style={td}>{a.decided_by}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Priority changes" icon={Flag} iconColor={theme.colors.sand}>
        {data.priority_changes.length === 0 ? <Empty>No priority changes yet.</Empty> : (
          <Table head={['When', 'Ticket', 'Was', 'Now', 'Reason', 'By']}>
            {data.priority_changes.map(p => (
              <tr key={p.id}><td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(p.changed_at)}</td><td style={{ ...td, minWidth: 200 }}>#{p.ticket_id} {p.title}</td>
                <td style={td}>{p.suggested ?? '—'}</td><td style={td}>{p.chosen}</td><td style={{ ...td, minWidth: 160 }}>{p.reason ?? ''}</td><td style={td}>{p.changed_by}</td></tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  );
}
