import { theme } from '../../theme';
import { useApi } from '../../session';
import { Card, Empty, Grid, Loading, Pill, Table, fmtDate, td } from '../../components/ui';

interface Log {
  override_rate: number;
  handovers: number;
  assignments: { id: number; ticket_id: number; title: string; division: string; recommended_name?: string; recommended_fit?: number;
    chosen_name?: string; chosen_fit?: number; support_name?: string; accepted: number; override_reason?: string;
    decided_by?: string; is_handover: number; decided_at: string }[];
  priority_changes: { id: number; ticket_id: number; title: string; suggested?: string; chosen: string; reason?: string; changed_by?: string; changed_at: string }[];
}

export default function OverrideLog() {
  const { data, error } = useApi<Log>('/assignment/log');
  if (!data) return <Card title="Override log"><Loading error={error} /></Card>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
      <Grid cols="repeat(auto-fit, minmax(200px, 1fr))">
        <Card><div style={{ fontSize: 32, fontWeight: 700 }}>{Math.round(data.override_rate * 100)}%</div>
          <div style={{ fontSize: 13, color: theme.colors.grey }}>of recommendations overridden: a trust measure for the recommender</div></Card>
        <Card><div style={{ fontSize: 32, fontWeight: 700 }}>{data.handovers}</div>
          <div style={{ fontSize: 13, color: theme.colors.grey }}>handovers (a ticket moved between analysts)</div></Card>
      </Grid>
      <Card title="Assignment decisions">
        <Table head={['When', 'Ticket', 'Recommended', 'Chosen', 'Support', 'Decision', 'Reason', 'By']}>
          {data.assignments.map(a => (
            <tr key={a.id}>
              <td style={td}>{fmtDate(a.decided_at)}</td>
              <td style={td}>#{a.ticket_id} {a.title}</td>
              <td style={td}>{a.recommended_name ? `${a.recommended_name}${a.recommended_fit != null ? ` (${Math.round(a.recommended_fit)})` : ''}` : '—'}</td>
              <td style={td}>{a.chosen_name}{a.chosen_fit != null ? ` (${Math.round(a.chosen_fit)})` : ''}</td>
              <td style={td}>{a.support_name ?? '—'}</td>
              <td style={td}>
                {a.accepted ? <Pill color={theme.colors.sage}>accepted</Pill> : <Pill color={theme.colors.red}>overridden</Pill>}
                {!!a.is_handover && <> <Pill color={theme.colors.sand}>handover</Pill></>}
              </td>
              <td style={td}>{a.override_reason ?? ''}</td>
              <td style={td}>{a.decided_by}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Priority changes">
        {data.priority_changes.length === 0 ? <Empty>No priority changes yet.</Empty> : (
          <Table head={['When', 'Ticket', 'Was', 'Now', 'Reason', 'By']}>
            {data.priority_changes.map(p => (
              <tr key={p.id}><td style={td}>{fmtDate(p.changed_at)}</td><td style={td}>#{p.ticket_id} {p.title}</td>
                <td style={td}>{p.suggested ?? '—'}</td><td style={td}>{p.chosen}</td><td style={td}>{p.reason ?? ''}</td><td style={td}>{p.changed_by}</td></tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
