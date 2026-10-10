import { useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Leave, Meta, WhatIf } from '../../api/types';
import { useApi, useSession } from '../../session';
import { LeaveCalendar, ANALYST_COLORS, type LeaveEvent } from '../../components/LeaveCalendar';
import { Button, Card, Empty, Field, Grid, Loading, Notice, Pill, RiskBadge, Table, fmtDate, inputStyle, td } from '../../components/ui';

function toEvent(l: Leave): LeaveEvent {
  const end = new Date(`${l.end_date}T00:00:00`);
  end.setDate(end.getDate() + 1);   // calendar end is exclusive
  return { id: l.id, title: `${l.analyst_name}: ${l.reason ?? 'Leave'}${l.status === 'Requested' ? ' (requested)' : ''}`,
    start: new Date(`${l.start_date}T00:00:00`), end, analystName: l.analyst_name,
    analystColor: ANALYST_COLORS[l.analyst_name] ?? theme.colors.ink, approved: l.status === 'Approved' };
}

export function WhatIfResult({ w, onReassign }: { w: WhatIf; onReassign?: (ticketId: number, analystId: number, name: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Notice tone={w.broken.length ? 'warn' : 'ok'}>{w.summary}</Notice>
      {w.broken.length > 0 && (
        <Table head={['Ticket', 'Deadline', 'Before', 'With leave', 'Who could take over', '']}>
          {w.broken.map(b => (
            <tr key={b.ticket_id}>
              <td style={td}><strong>{b.title}</strong><div style={{ fontSize: 11, color: theme.colors.grey }}>{b.hours}h · {b.priority}</div></td>
              <td style={td}>{fmtDate(b.deadline)}</td>
              <td style={td}><RiskBadge p={b.p_miss_before} /></td>
              <td style={td}><RiskBadge p={b.p_miss_after} /></td>
              <td style={td}>{b.takeover ? <>
                <strong>{b.takeover.name}</strong> <span style={{ fontSize: 11, color: theme.colors.grey }}>fit {b.takeover.fit}, {Math.round(b.takeover.p_miss_if_moved * 100)}% miss if moved</span>
                <div style={{ fontSize: 11, color: theme.colors.grey }}>{b.takeover.explanation}</div></> : <span style={{ color: theme.colors.red }}>Nobody can absorb it in time</span>}</td>
              <td style={td}>{b.takeover && onReassign && <Button small variant="outline" onClick={() => onReassign(b.ticket_id, b.takeover!.analyst_id, b.takeover!.name)}>Reassign</Button>}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export default function LeaveCalendarPage() {
  const { refresh, meta } = useSession();
  const leave = useApi<Leave[]>(`/planning/leave${qs({ role: 'lead' })}`);
  const [msg, setMsg] = useState<string | null>(null);
  const pending = (leave.data ?? []).filter(l => l.status === 'Requested');

  async function decide(l: Leave, status: 'Approved' | 'Rejected') {
    await api.patch(`/planning/leave/${l.id}`, { status });
    setMsg(`${status} ${l.analyst_name}'s leave.`);
    refresh();
  }
  async function reassign(ticketId: number, analystId: number, name: string) {
    try {
      await api.post('/assignment/assign', { ticket_id: ticketId, analyst_id: analystId, decided_by: 'lead',
        override_reason: `Reassigned for leave cover to ${name}` });
      setMsg(`Moved ticket #${ticketId} to ${name}. Counted as a handover.`);
      refresh();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
      {msg && <Notice tone="ok">{msg}</Notice>}
      <Card title="Leave requests waiting for you" icon={AlertTriangle} iconColor={theme.colors.sand}>
        {!leave.data ? <Loading error={leave.error} /> : pending.length === 0 ? <Empty>No pending requests.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {pending.map(l => (
              <div key={l.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{l.analyst_name}</strong>
                  <span style={{ fontSize: 13 }}>{fmtDate(l.start_date)} to {fmtDate(l.end_date)}</span>
                  <Pill>{l.reason ?? 'Leave'}</Pill>
                  <span style={{ flex: 1 }} />
                  <Button small onClick={() => decide(l, 'Approved')}><Check size={12} /> Approve</Button>
                  <Button small variant="danger" onClick={() => decide(l, 'Rejected')}><X size={12} /> Reject</Button>
                </div>
                {l.whatif && <WhatIfResult w={l.whatif} onReassign={reassign} />}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Grid cols="minmax(0,1.4fr) minmax(0,1fr)">
        <Card title="Team leave calendar">
          {leave.data ? <LeaveCalendar events={leave.data.filter(l => l.status !== 'Rejected').map(toEvent)} /> : <Loading error={leave.error} />}
        </Card>
        <WhatIfTool meta={meta} />
      </Grid>
    </div>
  );
}

function WhatIfTool({ meta }: { meta: Meta | null }) {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const [analyst, setAnalyst] = useState<number | ''>('');
  const [start, setStart] = useState(monday.toISOString().slice(0, 10));
  const [end, setEnd] = useState(friday.toISOString().slice(0, 10));
  const [result, setResult] = useState<WhatIf | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    try { setResult(await api.get<WhatIf>(`/planning/whatif/leave${qs({ analyst_id: analyst, start_date: start, end_date: end })}`)); setError(null); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <Card title="What-if: if someone takes leave, which deadlines break?">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Analyst">
          <select value={analyst} onChange={e => setAnalyst(Number(e.target.value))} style={inputStyle}>
            <option value="">Select…</option>
            {(meta?.analysts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Grid cols="1fr 1fr">
          <Field label="From"><input type="date" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} /></Field>
          <Field label="To"><input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inputStyle} /></Field>
        </Grid>
        <div><Button disabled={!analyst} onClick={run}>Run what-if</Button></div>
        {error && <Notice tone="error">{error}</Notice>}
        {result && <WhatIfResult w={result} />}
      </div>
    </Card>
  );
}
