import { useState } from 'react';
import { AlertCircle, Check, CheckCircle, X, CalendarDays, Hourglass, Plane, Users, FlaskConical } from 'lucide-react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Leave, Meta, RiskItem, WhatIf } from '../../api/types';
import { useApi, useSession } from '../../session';
import { LeaveCalendar, ANALYST_COLORS, type LeaveEvent } from '../../components/LeaveCalendar';
import { RiskActionModal } from '../../components/TicketModals';
import { Button, Card, Empty, Field, Grid, Hint, Loading, Notice, Page, Pill, RiskBadge, StatRow, StatTile, Table, fmtDate, initials, inputStyle, td } from '../../components/ui';

type Broken = WhatIf['broken'][number];
interface Reassigning { risk: RiskItem; reason: string }

const today = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function weekBounds(): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 7);
  return [iso(start), iso(end)];
}
const pct = (p: number | null) => p == null ? '—' : `${Math.round(p * 100)}%`;

function toEvent(l: Leave): LeaveEvent {
  const end = new Date(`${l.end_date}T00:00:00`);
  end.setDate(end.getDate() + 1);   // calendar end is exclusive
  return {
    id: l.id, title: `${l.analyst_name}: ${l.reason ?? 'Leave'}${l.status === 'Requested' ? ' (requested)' : ''}`,
    start: new Date(`${l.start_date}T00:00:00`), end, analystName: l.analyst_name,
    analystColor: ANALYST_COLORS[l.analyst_name] ?? theme.colors.ink, approved: l.status === 'Approved',
  };
}

export function WhatIfResult({ w, onReassign, approved }: { w: WhatIf; onReassign?: (b: Broken) => void; approved?: boolean }) {
  const n = w.broken.length;
  const headline = !n ? `${w.analyst_name}'s tickets are covered for this leave.`
    : approved ? `${w.analyst_name}'s leave is approved: ${n} ticket${n === 1 ? '' : 's'} will miss the deadline unless reassigned.`
    : w.summary;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Notice tone={n ? 'warn' : 'ok'}>{headline}</Notice>
      {w.broken.length > 0 && (
        <Table head={['Ticket', 'Deadline', 'Before', 'With leave', 'Suggested cover', '']}>
          {w.broken.map(b => (
            <tr key={b.ticket_id}>
              <td style={td}><strong>{b.title}</strong><div style={{ fontSize: 11, color: theme.colors.grey }}>{b.hours}h · {b.priority} · {b.division}</div></td>
              <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDate(b.deadline)}</td>
              <td style={td}><RiskBadge p={b.p_miss_before} /></td>
              <td style={td}><RiskBadge p={b.p_miss_after} /></td>
              <td style={{ ...td, fontSize: 12 }}>{b.takeover
                ? <><strong>{b.takeover.name}</strong> <span style={{ color: theme.colors.grey }}>fit {b.takeover.fit}</span></>
                : <span style={{ color: theme.colors.red }}>Nobody absorbs it in time</span>}</td>
              <td style={td}>{onReassign && <Button small variant="outline" onClick={() => onReassign(b)}>Reassign</Button>}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function LeaveCard({ l, focused, onDecide, onReassign }: {
  l: Leave; focused: boolean;
  onDecide: (l: Leave, s: 'Approved' | 'Rejected') => void;
  onReassign: (l: Leave, b: Broken) => void;
}) {
  const color = ANALYST_COLORS[l.analyst_name] ?? theme.colors.ink;
  return (
    <div id={`leave-${l.id}`} style={{
      padding: 16, borderRadius: 16, background: theme.colors.background + '80',
      border: `1.5px solid ${focused ? theme.colors.accent : theme.colors.track}`,
      display: 'flex', flexDirection: 'column', gap: 12, scrollMarginTop: 80,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ width: 32, height: 32, borderRadius: '50%', background: color, color: '#fff', fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(l.analyst_name)}</span>
        <div>
          <strong style={{ fontSize: 14 }}>{l.analyst_name}</strong>
          <div style={{ fontSize: 12, color: theme.colors.grey }}>{fmtDate(l.start_date)} to {fmtDate(l.end_date)} · {l.reason ?? 'Leave'}</div>
        </div>
        <Pill color={l.status === 'Approved' ? theme.colors.sage : theme.colors.sand}>{l.status}</Pill>
        <span style={{ flex: 1 }} />
        {l.status === 'Requested' && <>
          <Button small onClick={() => onDecide(l, 'Approved')}><Check size={12} /> Approve</Button>
          <Button small variant="danger" onClick={() => onDecide(l, 'Rejected')}><X size={12} /> Reject</Button>
        </>}
      </div>
      {l.whatif && <WhatIfResult w={l.whatif} approved={l.status === 'Approved'} onReassign={b => onReassign(l, b)} />}
    </div>
  );
}

export default function LeaveCalendarPage() {
  const { refresh, meta } = useSession();
  const leave = useApi<Leave[]>(`/planning/leave${qs({ role: 'lead' })}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [reassigning, setReassigning] = useState<Reassigning | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const all = leave.data ?? [];
  const pending = all.filter(l => l.status === 'Requested');
  const upcoming = all.filter(l => l.status === 'Approved' && l.end_date >= today());
  const past = all.filter(l => l.status === 'Rejected' || (l.status === 'Approved' && l.end_date < today()));
  const needCover = [...pending, ...upcoming].reduce((n, l) => n + (l.whatif?.broken.length ?? 0), 0);
  const [ws, we] = weekBounds();
  const awayNow = [...new Set(all.filter(l => l.status === 'Approved' && l.start_date < we && l.end_date >= ws).map(l => l.analyst_name))];

  async function decide(l: Leave, status: 'Approved' | 'Rejected') {
    await api.patch(`/planning/leave/${l.id}`, { status });
    setMsg(`${status} ${l.analyst_name}'s leave.${status === 'Approved' && l.whatif?.broken.length ? ' Its tickets still need cover; reassign them below.' : ''}`);
    refresh();
  }

  // The ticket's risk in today's plan, restated with the leave counted, so the dialog shows the with-leave numbers
  async function openReassign(fromName: string, b: Broken, reason: string) {
    setOpenError(null);
    try {
      const r = await api.get<RiskItem>(`/prediction/risk/${b.ticket_id}`);
      setReassigning({ reason, risk: {
        ...r, p_miss: b.p_miss_after, cause: 'Leave conflict', action: 'Reassign before the leave starts',
        explanation: `With ${fromName}'s leave, the chance of missing ${fmtDate(b.deadline)} goes from ${pct(b.p_miss_before)} to ${pct(b.p_miss_after)}.`,
        facts: [], hours_available: b.hours_available_after ?? r.hours_available, expected_completion: null,
      } });
    } catch (e) { setOpenError((e as Error).message); }
  }

  function jumpTo(id: number) {
    setFocus(id);
    document.getElementById(`leave-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <Page>
      {/* Calendar first */}
      <Card title="Team leave calendar" icon={CalendarDays} iconColor={theme.colors.accent}
        right={<Hint>Approve leave and cover its tickets in one place</Hint>}>
        {leave.data && (
          <div style={{ marginBottom: 16 }}>
            <StatRow>
              <StatTile icon={Hourglass} color={theme.colors.sand} label="Pending requests" value={pending.length} hint="waiting for your decision" />
              <StatTile icon={CheckCircle} color={theme.colors.sage} label="Approved, upcoming" value={upcoming.length} hint="leave not over yet" />
              <StatTile icon={AlertCircle} color={needCover ? theme.colors.red : theme.colors.sage} label="Tickets need cover" value={needCover}
                hint={needCover ? 'would miss the deadline' : 'everything covered'} />
              <StatTile icon={Plane} color={theme.colors.accent} label="Away this week" value={awayNow.length}
                hint={awayNow.length ? awayNow.join(', ') : 'whole team in'} />
            </StatRow>
          </div>
        )}
        {leave.data ? (
          <LeaveCalendar events={all.filter(l => l.status !== 'Rejected').map(toEvent)} onSelectEvent={e => jumpTo(e.id)} />
        ) : <Loading error={leave.error} />}
        <p style={{ margin: '8px 0 0', fontSize: 11, color: theme.colors.grey }}>Solid = approved, striped = requested. Click a leave to jump to its tickets.</p>
      </Card>

      {msg && <Notice tone="ok">{msg}</Notice>}
      {openError && <Notice tone="error">{openError}</Notice>}

      <Grid cols="minmax(0,1.6fr) minmax(0,1fr)">
        <Card title="Leave and tickets needing cover" icon={Users} iconColor={theme.colors.sand}>
          {!leave.data ? <Loading error={leave.error} /> : pending.length + upcoming.length === 0 ? <Empty>No pending or upcoming leave.</Empty> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[...pending, ...upcoming].map(l => (
                <LeaveCard key={l.id} l={l} focused={focus === l.id} onDecide={decide}
                  onReassign={(lv, b) => openReassign(lv.analyst_name, b, `Cover for ${lv.analyst_name}'s leave ${fmtDate(lv.start_date)}–${fmtDate(lv.end_date)}`)} />
              ))}
            </div>
          )}
          {past.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: theme.colors.grey }}>Past and rejected leave ({past.length})</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, fontSize: 13 }}>
                {past.map(l => (
                  <div key={l.id}>{l.analyst_name} · {fmtDate(l.start_date)}–{fmtDate(l.end_date)} <Pill color={l.status === 'Rejected' ? theme.colors.red : theme.colors.grey}>{l.status}</Pill></div>
                ))}
              </div>
            </details>
          )}
        </Card>

        <WhatIfTool meta={meta} onReassign={openReassign} />
      </Grid>

      {reassigning && (
        <RiskActionModal risk={reassigning.risk} defaultReason={reassigning.reason} onClose={() => setReassigning(null)} />
      )}
    </Page>
  );
}

function WhatIfTool({ meta, onReassign }: { meta: Meta | null; onReassign: (fromName: string, b: Broken, reason: string) => void }) {
  const monday = new Date();
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const [analyst, setAnalyst] = useState<number | ''>('');
  const [start, setStart] = useState(monday.toISOString().slice(0, 10));
  const [end, setEnd] = useState(friday.toISOString().slice(0, 10));
  const [result, setResult] = useState<WhatIf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { refreshKey } = useSession();
  const [ranAt, setRanAt] = useState(refreshKey);

  async function run() {
    try {
      setResult(await api.get<WhatIf>(`/planning/whatif/leave${qs({ analyst_id: analyst, start_date: start, end_date: end })}`));
      setRanAt(refreshKey); setError(null);
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <Card title="What-if: if someone takes leave, which deadlines break?" icon={FlaskConical} iconColor={theme.colors.accent}>
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
        {result && ranAt !== refreshKey && <Notice>Tickets changed since this ran. Run it again for the latest picture.</Notice>}
        {result && <WhatIfResult w={result} onReassign={b => onReassign(result.analyst_name, b,
          `Planning ahead for ${result.analyst_name}'s possible leave ${fmtDate(result.start_date)}–${fmtDate(result.end_date)}`)} />}
      </div>
    </Card>
  );
}
