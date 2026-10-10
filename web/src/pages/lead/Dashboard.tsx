import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, BarChart2, Bot, CalendarDays, CheckCircle, ChevronRight, Clock, Flame, Gauge, Inbox,
  MessageCircle, PieChart as PieIcon, Send, TrendingUp, Users,
} from 'lucide-react';
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Dept, DeptCounts, Forecast, ForecastWeek, RiskItem, RiskList, Summary, Ticket, TicketStatus, Workload } from '../../api/types';
import { useApi, useSession } from '../../session';
import { HatchedBar } from '../../components/HatchedBar';
import { DepartmentChip } from '../../components/DepartmentChip';
import { ANALYST_COLORS } from '../../components/LeaveCalendar';
import { Avatar, RiskActionModal, TicketCard, TicketDetailModal } from '../../components/TicketModals';
import { Button, Card, Empty, FilterChip, Grid, Highlight, HighlightRow, Hint, Loading, Notice, PRIORITY_COLOR, Page, Pill, StatRow, StatTile, cardGrid, fmtDate, initials, inputStyle } from '../../components/ui';

const STATUSES: TicketStatus[] = ['Unassigned', 'Assigned', 'In progress', 'Waiting', 'Closed'];
const STATUS_COLOR: Record<TicketStatus, string> = {
  Unassigned: theme.colors.grey, Assigned: theme.colors.ink, 'In progress': theme.colors.accent,
  Waiting: theme.colors.sand, Closed: theme.colors.sage,
};
const DEPTS: Dept[] = ['HR', 'IT', 'Finance', 'Marketing'];
const isRisky = (t: Ticket) => t.status !== 'Closed' && (t.alert || (t.p_miss ?? 0) >= 0.3);

export default function Dashboard() {
  const { division, setDivision } = useSession();
  const summary = useApi<Summary>(`/tickets/summary${qs({ role: 'lead', division })}`);
  const risk = useApi<RiskList>(`/prediction/risk${qs({ division })}`);
  const workload = useApi<Workload[]>(`/assignment/workload${qs({ role: 'lead', division })}`);
  const forecast = useApi<Forecast>(`/planning/forecast${qs({ n_weeks: 4, history_weeks: 6, division })}`);
  const tickets = useApi<Ticket[]>(`/tickets/${qs({ role: 'lead', division })}`);

  const [openTicket, setOpenTicket] = useState<number | null>(null);
  const [actOn, setActOn] = useState<RiskItem | null>(null);
  const lowConf = (tickets.data ?? []).filter(t => t.status === 'Unassigned' && t.confidence === 'Low');

  function act(ticketId: number) {
    const r = risk.data?.all?.find(x => x.ticket_id === ticketId)
      ?? [...(risk.data?.alerts ?? []), ...(risk.data?.watch ?? [])].find(x => x.ticket_id === ticketId);
    if (r) { setOpenTicket(null); setActOn(r); }
  }

  return (
    <Page>
      <WeekSummary tickets={tickets.data} summary={summary.data} workload={workload.data} forecast={forecast.data}
        risk={risk.data} division={division} onClear={() => setDivision(null)} onOpenRisk={setActOn} />

      {lowConf.length > 0 && (
        <Notice tone="warn">
          <strong>{lowConf.length} new ticket type{lowConf.length > 1 ? 's' : ''} need your decision:</strong>{' '}
          {lowConf.map(t => t.title).join(', ')}. FairQueue hasn't seen these before, so it isn't guessing an assignee.{' '}
          <Link to="/lead/assign">Decide now</Link>
        </Notice>
      )}

      <DepartmentSection summary={summary.data} error={summary.error} division={division} onChange={setDivision} />
      <StatusOverview tickets={tickets.data} error={tickets.error} onOpen={setOpenTicket} />
      <RiskCards risk={risk.data} error={risk.error} onOpen={setActOn} />
      <WorkloadCards workload={workload.data} error={workload.error} tickets={tickets.data} onOpen={setOpenTicket} />
      <VolumeCard forecast={forecast.data} error={forecast.error} division={division} />
      <CapacityAgent />

      {openTicket !== null && <TicketDetailModal ticketId={openTicket} onClose={() => setOpenTicket(null)} onAct={act} />}
      {actOn && <RiskActionModal risk={actOn} onClose={() => setActOn(null)} />}
    </Page>
  );
}

// ── Summary of the week ──────────────────────────────────────────────────────

function weekBounds(): [Date, Date] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 7);
  return [start, end];
}
const parse = (s?: string | null) => s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s.replace(' ', 'T')) : null;


function WeekSummary({ tickets, summary, workload, forecast, risk, division, onClear, onOpenRisk }: {
  tickets: Ticket[] | null; summary: Summary | null; workload: Workload[] | null; forecast: Forecast | null;
  risk: RiskList | null; division: Dept | null; onClear: () => void; onOpenRisk: (r: RiskItem) => void;
}) {
  if (!tickets || !summary?.team) return <Card title="This week"><Loading /></Card>;
  const [start, end] = weekBounds();
  const inWeek = (s?: string | null) => { const d = parse(s); return !!d && d >= start && d < end; };
  const created = tickets.filter(t => inWeek(t.created_at)).length;
  const closed = tickets.filter(t => inWeek(t.closed_at)).length;
  const due = tickets.filter(t => t.status !== 'Closed' && inWeek(t.deadline)).length;
  const atRisk = summary.team.at_risk ?? 0;
  const booked = Math.round((workload ?? []).reduce((s, a) => s + a.open_hours, 0));
  const capacity = (workload ?? []).reduce((s, a) => s + a.weekly_hours, 0);
  const load = capacity ? Math.round((booked / capacity) * 100) : 0;
  const busiest = [...(workload ?? [])].sort((a, b) => b.open_hours / b.weekly_hours - a.open_hours / a.weekly_hours)[0];
  const top = risk?.alerts[0];
  const next = forecast?.weeks[0];
  const lastDay = new Date(end.getTime() - 86400000);
  const loadColor = load >= 90 ? theme.colors.red : load >= 70 ? theme.colors.sand : theme.colors.sage;

  return (
    <>
      <Card title={<>This week <span style={{ fontWeight: 400, color: theme.colors.grey, fontSize: 13 }}>
        · {fmtDate(start.toISOString())} – {fmtDate(lastDay.toISOString())}</span></>} icon={CalendarDays} iconColor={theme.colors.accent}
        right={division && <FilterChip onClear={onClear}>Showing {division} only</FilterChip>}>
        <StatRow>
          <StatTile icon={Inbox} color={theme.colors.ink} label="New tickets" value={created} hint="created this week" />
          <StatTile icon={CheckCircle} color={theme.colors.sage} label="Closed" value={closed} hint="finished this week" />
          <StatTile icon={Clock} color={theme.colors.accent} label="Still due" value={due} hint="open, deadline this week" />
          <StatTile icon={AlertCircle} color={theme.colors.red} label="At risk" value={atRisk} hint={atRisk ? 'may miss the deadline' : 'all on track'} />
          <StatTile icon={Gauge} color={loadColor} label={division ? `${division} share of team hours` : 'Team load'} value={`${load}%`}
            hint={<span style={{ display: 'block' }}>
              <span style={{ display: 'block', height: 5, borderRadius: 3, background: theme.colors.track, marginBottom: 4 }}>
                <span style={{ display: 'block', width: `${Math.min(load, 100)}%`, height: '100%', borderRadius: 3, background: loadColor }} />
              </span>
              {division ? `${booked}h of ${division} work in the team's ${capacity}h` : `${booked}h of ${capacity}h booked`}
            </span>} />
        </StatRow>
      </Card>

      {/* Highlights sit outside the summary card and share the row equally */}
      <HighlightRow>
        {top ? (
          <Highlight icon={Flame} color={theme.colors.red} title="Needs attention" onClick={() => onOpenRisk(top)}>
            <strong>{top.ticket_title}</strong> is {Math.round(top.p_miss * 100)}% likely to miss {fmtDate(top.deadline)}
          </Highlight>
        ) : (
          <Highlight icon={CheckCircle} color={theme.colors.sage} title="Needs attention">No tickets above the alert threshold.</Highlight>
        )}
        {busiest && (
          <Highlight icon={Users} color={ANALYST_COLORS[busiest.name] ?? theme.colors.ink} title="Busiest analyst">
            <strong>{busiest.name}</strong> has {busiest.open_hours}h booked of {busiest.weekly_hours}h
          </Highlight>
        )}
        {next && (
          <Highlight icon={TrendingUp} color={weekLevel(next).color} title={`Next week · ${next.label.replace('Week of ', '')}`}>
            Needs <strong>{next.demand_hours}h</strong> of the team's {next.capacity_hours}h
            {next.spikes.length > 0 && <> · {next.spikes.join(', ')} spike</>}
          </Highlight>
        )}
      </HighlightRow>
    </>
  );
}

// ── Requesting departments (dropdown filters the whole dashboard) ───────────

function DepartmentSection({ summary, error, division, onChange }: {
  summary: Summary | null; error: string | null; division: Dept | null; onChange: (d: Dept | null) => void;
}) {
  const select = (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: theme.colors.grey }}>
      Department
      <select value={division ?? ''} onChange={e => onChange((e.target.value || null) as Dept | null)} style={{
        padding: '7px 32px 7px 12px', borderRadius: 10, border: `1.5px solid ${theme.colors.track}`, background: theme.colors.card,
        fontSize: 13, fontWeight: 600, color: theme.colors.ink, fontFamily: 'inherit', cursor: 'pointer',
      }}>
        <option value="">All departments</option>
        {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </label>
  );
  return (
    <Card title="Requesting departments" icon={BarChart2} right={select}>
      {!summary ? <Loading error={error} /> : (
        <div style={cardGrid(220)}>
          {summary.departments.map(d => <DeptCard key={d.division} d={d} />)}
        </div>
      )}
      <p style={{ margin: '10px 0 0', fontSize: 11, color: theme.colors.grey }}>Choosing a department filters the whole dashboard.</p>
    </Card>
  );
}

function DeptCard({ d }: { d: DeptCounts }) {
  const parts = [
    { label: 'Solved', n: d.solved, c: theme.colors.sage },
    { label: 'In progress', n: d.in_progress, c: theme.colors.accent },
    { label: 'Waiting', n: d.waiting, c: theme.colors.sand },
    { label: 'Unassigned', n: d.unassigned, c: theme.colors.grey },
  ];
  const assigned = Math.max(d.total - parts.reduce((s, p) => s + p.n, 0), 0);
  const segs = [...parts.slice(0, 3), { label: 'Assigned', n: assigned, c: theme.colors.ink }, parts[3]];
  return (
    <div style={{ padding: 16, borderRadius: 16, border: `1.5px solid ${theme.colors.track}`, borderTop: `4px solid ${theme.dept[d.division]}`,
      display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <DepartmentChip dept={d.division} />
        <span style={{ marginLeft: 'auto', fontSize: 26, fontWeight: 700 }}>{d.total}</span>
        <span style={{ fontSize: 11, color: theme.colors.grey, marginLeft: 4, alignSelf: 'flex-end', marginBottom: 4 }}>tickets</span>
      </div>
      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: theme.colors.track }}>
        {segs.filter(s => s.n > 0).map(s => <div key={s.label} title={`${s.label}: ${s.n}`} style={{ flex: s.n, background: s.c }} />)}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: theme.colors.grey }}>
        {segs.filter(s => s.n > 0).map(s => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: s.c }} />{s.label} {s.n}
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {[
          { label: 'Hours queued', v: `${d.hours_in_queue ?? 0}h`, c: theme.colors.ink },
          { label: 'At risk', v: d.at_risk ?? 0, c: d.at_risk ? theme.colors.red : theme.colors.ink },
          { label: 'Missed', v: d.missed, c: d.missed ? theme.colors.red : theme.colors.ink },
        ].map(x => (
          <div key={x.label} style={{ padding: '8px 10px', borderRadius: 10, background: theme.colors.background }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: x.c }}>{x.v}</div>
            <div style={{ fontSize: 10, color: theme.colors.grey }}>{x.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tickets by status: pie + ticket cards ───────────────────────────────────

function StatusOverview({ tickets, error, onOpen }: { tickets: Ticket[] | null; error: string | null; onOpen: (id: number) => void }) {
  const [status, setStatus] = useState<TicketStatus | null>(null);
  if (!tickets) return <Card title="Tickets by status" icon={PieIcon}><Loading error={error} /></Card>;
  const data = STATUSES.map(s => ({ name: s, value: tickets.filter(t => t.status === s).length })).filter(d => d.value > 0);
  const shown = tickets.filter(t => !status || t.status === status)
    .sort((a, b) => Number(isRisky(b)) - Number(isRisky(a)) || (a.status === 'Closed' ? 1 : 0) - (b.status === 'Closed' ? 1 : 0)
      || a.deadline.localeCompare(b.deadline));

  return (
    <Card title="Tickets by status" icon={PieIcon} iconColor={theme.colors.accent}>
      <Grid cols="minmax(0,280px) minmax(0,1fr)" gap={24}>
        <div>
          <div style={{ height: 220, position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={100} paddingAngle={2}
                  isAnimationActive={false} onClick={(d: { name?: string }) => setStatus(s => s === d.name ? null : d.name as TicketStatus)}>
                  {data.map(d => (
                    <Cell key={d.name} fill={STATUS_COLOR[d.name]} cursor="pointer"
                      opacity={!status || status === d.name ? 1 : 0.25} stroke="#fff" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ fontSize: 34, fontWeight: 700 }}>{status ? data.find(d => d.name === status)?.value ?? 0 : tickets.length}</span>
              <span style={{ fontSize: 12, color: theme.colors.grey }}>{status ?? 'Total tickets'}</span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <button onClick={() => setStatus(null)} style={{
              padding: '8px 10px', borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
              border: `1.5px solid ${!status ? theme.colors.ink : theme.colors.track}`, background: !status ? theme.colors.ink : theme.colors.card,
              color: !status ? '#fff' : theme.colors.ink, display: 'flex', flexDirection: 'column', gap: 2,
            }}>
              <span style={{ fontSize: 11, opacity: 0.7 }}>All</span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{tickets.length}</span>
            </button>
            {STATUSES.map(s => {
              const n = tickets.filter(t => t.status === s).length;
              const on = status === s;
              return (
                <button key={s} onClick={() => setStatus(on ? null : s)} style={{
                  display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 10px', borderRadius: 12, cursor: 'pointer',
                  border: `1.5px solid ${on ? STATUS_COLOR[s] : theme.colors.track}`, background: on ? STATUS_COLOR[s] + '14' : theme.colors.card,
                  fontFamily: 'inherit', color: theme.colors.ink, textAlign: 'left',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: theme.colors.grey }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_COLOR[s] }} />{s}
                  </span>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: theme.colors.grey, marginBottom: 10 }}>
            {status ? `${shown.length} ${status.toLowerCase()}` : `All ${shown.length}`} ticket{shown.length !== 1 ? 's' : ''} · risky ones first · click a card for details
          </div>
          <div style={{ ...cardGrid(220, false), maxHeight: 520, overflowY: 'auto', padding: 2 }}>
            {shown.length === 0 ? <Empty>No tickets.</Empty> : shown.map(t => <TicketCard key={t.id} t={t} onOpen={onOpen} />)}
          </div>
        </div>
      </Grid>
    </Card>
  );
}

// ── Risk tickets as cards ──────────────────────────────────────────────────

function RiskCards({ risk, error, onOpen }: { risk: RiskList | null; error: string | null; onOpen: (r: RiskItem) => void }) {
  const items = risk ? [...risk.alerts, ...risk.watch] : [];
  return (
    <Card title="Risk tickets" icon={AlertCircle} iconColor={theme.colors.red}
      right={risk && <Hint>
        red = alert (≥{Math.round(risk.threshold * 100)}% chance of missing) · amber = watching · click to reassign or add support
      </Hint>}>
      {!risk ? <Loading error={error} /> : items.length === 0 ? <Empty>No tickets at risk.</Empty> : (
        <div style={cardGrid(280)}>
          {items.map(r => {
            const c = r.alert ? theme.colors.red : theme.colors.sand;
            return (
              <button key={r.ticket_id} onClick={() => onOpen(r)} className="fq-lift" style={{
                textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.ink,
                padding: 16, borderRadius: 16, background: c + '0D', border: `1.5px solid ${c}55`,
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <strong style={{ fontSize: 14, flex: 1, lineHeight: 1.3 }}>{r.ticket_title}</strong>
                  <span style={{ fontSize: 22, fontWeight: 700, color: c, lineHeight: 1 }}>{Math.round(r.p_miss * 100)}%</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Pill color={c}>{r.cause}</Pill>
                  <DepartmentChip dept={r.division} size="sm" />
                  <Pill color={PRIORITY_COLOR[r.priority]}>{r.priority}</Pill>
                </div>
                <div style={{ fontSize: 12, color: theme.colors.grey, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Avatar name={r.assignee_name} size={20} />
                  {r.assignee_name ?? 'Unassigned'} · due {fmtDate(r.deadline)}
                </div>
                <div style={{ fontSize: 12 }}>Needs <strong>{r.hours_needed}h</strong>, only <strong>{r.hours_available}h</strong> available</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: c, display: 'flex', alignItems: 'center', gap: 4 }}>
                  Reassign or get support <ChevronRight size={13} />
                </div>
              </button>
            );
          })}
        </div>
      )}
      {risk && risk.suppressed > 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: theme.colors.grey }}>{risk.suppressed} more above the threshold, held back by the daily cap.</p>
      )}
    </Card>
  );
}


// ── Workload per analyst ─────────────────────────────────────────────────────

function WorkloadCards({ workload, error, tickets, onOpen }: {
  workload: Workload[] | null; error: string | null; tickets: Ticket[] | null; onOpen: (id: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  if (!workload || !tickets) return <Card title="Workload per analyst" icon={Users}><Loading error={error} /></Card>;
  const open = tickets.filter(t => t.status !== 'Closed' && t.status !== 'Unassigned');
  const analyst = workload.find(a => a.analyst_id === picked);
  const theirs = open.filter(t => t.assignee_id === picked)
    .sort((a, b) => Number(isRisky(b)) - Number(isRisky(a)) || a.deadline.localeCompare(b.deadline));

  return (
    <Card title="Workload per analyst" icon={Users} iconColor={theme.colors.sand}
      right={<Hint>Open predicted hours vs weekly hours · click an analyst to see their tickets</Hint>}>
      <div style={cardGrid(180)}>
        {workload.map(a => {
          const mine = open.filter(t => t.assignee_id === a.analyst_id);
          const risky = mine.filter(isRisky).length;
          const sel = picked === a.analyst_id;
          return (
            <button key={a.analyst_id} onClick={() => setPicked(sel ? null : a.analyst_id)} className="fq-lift" style={{
              textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.ink, padding: 14, borderRadius: 16,
              background: sel ? theme.colors.background : theme.colors.card, border: `2px solid ${sel ? theme.colors.ink : theme.colors.track}`,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <HatchedBar label={a.name} booked={a.open_hours} capacity={a.weekly_hours}
                avatarInitials={initials(a.name)} avatarColor={ANALYST_COLORS[a.name] ?? theme.colors.ink} />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Pill>{a.open_tickets} ticket{a.open_tickets !== 1 ? 's' : ''}</Pill>
                {risky > 0 ? <Pill color={theme.colors.red}>{risky} at risk</Pill> : <Pill color={theme.colors.sage}>on track</Pill>}
              </div>
            </button>
          );
        })}
      </div>
      {analyst && (
        <div style={{ marginTop: 14, padding: 16, borderRadius: 16, background: theme.colors.background }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Avatar name={analyst.name} size={34} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{analyst.name}'s open tickets</div>
              <div style={{ fontSize: 12, color: theme.colors.grey }}>
                {analyst.role_title ? `${analyst.role_title} · ` : ''}{analyst.open_hours}h booked of {analyst.weekly_hours}h
              </div>
              {analyst.skills.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  {analyst.skills.map(s => <Pill key={s}>{s}</Pill>)}
                </div>
              )}
            </div>
            <Button small variant="ghost" onClick={() => setPicked(null)}>Close</Button>
          </div>
          {theirs.length === 0 ? <Empty>No open tickets.</Empty> : (
            <div style={cardGrid(220, false)}>{theirs.map(t => <TicketCard key={t.id} t={t} onOpen={onOpen} hideAssignee />)}</div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Volume: a line per department, critical weeks in red ─────────────────────

function VolumeCard({ forecast, error, division }: { forecast: Forecast | null; error: string | null; division: Dept | null }) {
  const data = useMemo(() => {
    if (!forecast) return [];
    const depts = division ? [division] : DEPTS;
    const hist = (forecast.history ?? []).map(h => ({
      label: h.label.replace('Week of ', ''),
      ...Object.fromEntries(depts.map(d => [d, h.departments[d]])),
    }));
    const fut = forecast.weeks.map(w => ({
      label: w.label.replace('Week of ', ''),
      ...Object.fromEntries(depts.map(d => [`${d} forecast`, w.departments[d].hours])),
    }));
    // Join the two series at the last actual week so the dashed forecast continues the solid line
    if (hist.length) Object.assign(hist[hist.length - 1], Object.fromEntries(depts.map(d => [`${d} forecast`, (hist[hist.length - 1] as Record<string, unknown>)[d]])));
    return [...hist, ...fut];
  }, [forecast, division]);

  if (!forecast) return <Card title="Volume" icon={TrendingUp}><Loading error={error} /></Card>;
  const depts = division ? [division] : DEPTS;
  const firstForecast = forecast.weeks[0]?.label.replace('Week of ', '');

  return (
    <Card title="Volume by department (hours per week)" icon={TrendingUp} iconColor={theme.colors.accent}
      right={<Hint>solid = actual · dashed = forecast</Hint>}>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.track} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} unit="h" />
            <Tooltip formatter={(v) => `${v}h`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {firstForecast && <ReferenceLine x={firstForecast} stroke={theme.colors.grey} strokeDasharray="2 4"
              label={{ value: 'forecast →', fontSize: 11, fill: theme.colors.grey, position: 'insideTopLeft' }} />}
            {depts.map(d => <Line key={d} dataKey={d} stroke={theme.dept[d]} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />)}
            {depts.map(d => <Line key={`${d}f`} dataKey={`${d} forecast`} stroke={theme.dept[d]} strokeWidth={2.5} strokeDasharray="6 4"
              dot={{ r: 3, fill: '#fff' }} isAnimationActive={false} legendType="none" />)}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.grey, margin: '16px 0 10px' }}>Coming weeks</div>
      <div style={cardGrid(220)}>
        {forecast.weeks.map(w => <WeekCard key={w.week_start} w={w} division={division} />)}
      </div>
    </Card>
  );
}

// Critical (red) = more work than team hours, or within 10% of it; Busy (amber) = a seasonal spike but still room
function weekLevel(w: ForecastWeek): { label: string; color: string; critical: boolean } {
  const pct = w.capacity_hours ? w.demand_hours / w.capacity_hours : 0;
  if (w.over_capacity || pct >= 0.9) return { label: 'Critical', color: theme.colors.red, critical: true };
  if (w.spikes.length > 0) return { label: 'Busy', color: theme.colors.sand, critical: false };
  return { label: 'OK', color: theme.colors.sage, critical: false };
}

function WeekCard({ w, division }: { w: ForecastWeek; division: Dept | null }) {
  const lv = weekLevel(w);
  const c = lv.color;
  const pct = w.capacity_hours ? Math.round((w.demand_hours / w.capacity_hours) * 100) : 0;
  const depts = division ? [division] : DEPTS;
  return (
    <div style={{ padding: 14, borderRadius: 16, background: lv.critical ? theme.colors.red + '0F' : theme.colors.card,
      border: `1.5px solid ${lv.critical ? theme.colors.red : lv.label === 'Busy' ? theme.colors.sand + '90' : theme.colors.track}`,
      display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {lv.label !== 'OK' && <AlertTriangle size={14} color={c} />}
        <strong style={{ fontSize: 13, flex: 1 }}>{w.label}</strong>
        <Pill color={c} solid={lv.label !== 'OK'}>{lv.label}</Pill>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: lv.critical ? theme.colors.red : theme.colors.ink }}>{w.demand_hours}h</span>
          <span style={{ fontSize: 12, color: theme.colors.grey }}>needed of {w.capacity_hours}h ({pct}%)</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: theme.colors.track, marginTop: 6 }}>
          <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 3, background: lv.critical ? theme.colors.red : theme.colors.ink }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {depts.map(d => {
          const x = w.departments[d];
          return (
            <span key={d} title={x.reason ?? undefined} style={{ fontSize: 11, padding: '2px 8px', borderRadius: theme.radius.pill,
              background: x.spike ? theme.colors.sand + '26' : theme.colors.background, color: x.spike ? '#A8743F' : theme.colors.ink,
              fontWeight: x.spike ? 700 : 500 }}>
              {d} {x.hours}h{x.spike && ' ↑'}
            </span>
          );
        })}
      </div>
      {(lv.critical || w.spikes.length > 0) && (
        <div style={{ fontSize: 11, color: lv.critical ? theme.colors.red : '#A8743F' }}>
          {w.over_capacity ? 'More work than team hours. ' : lv.critical ? 'Almost no spare hours. ' : ''}
          {w.spikes.map(d => w.departments[d].reason).filter(Boolean).join(', ')}{w.spikes.length ? ' spike.' : ''}
        </div>
      )}
    </div>
  );
}

// ── Capacity agent ─────────────────────────────────────────────────────────

interface Msg { from: 'you' | 'agent'; text: string; method?: string; tools?: string[] }
const PROMPTS = [
  'If Ravi takes leave next week, which deadlines break?',
  'Which tickets are at risk right now?',
  'Who has spare capacity this week?',
  'Will we have enough hours in the next two weeks?',
];

function CapacityAgent() {
  const { meta } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [msgs, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setOpen(true); setQ(''); setBusy(true);
    setMsgs(m => [...m, { from: 'you', text }]);
    try {
      const r = await api.post<{ answer: string; method: string; tool_calls?: { name?: string; tool?: string }[] }>(`/planning/ask${qs({ question: text })}`, {});
      setMsgs(m => [...m, { from: 'agent', text: r.answer, method: r.method,
        tools: (r.tool_calls ?? []).map(c => c.name ?? c.tool ?? '').filter(Boolean) }]);
    } catch (e) {
      setMsgs(m => [...m, { from: 'agent', text: `Sorry, that failed: ${(e as Error).message}`, method: 'error' }]);
    } finally { setBusy(false); }
  }

  return (
    <Card title="Capacity agent" icon={Bot} iconColor={theme.colors.accent}
      right={<Pill color={meta?.llm.enabled ? theme.colors.sage : theme.colors.grey}>{meta?.llm.enabled ? `AI · ${meta.llm.model}` : 'rule-based mode'}</Pill>}>
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Ask about capacity, leave and deadlines</div>
            <div style={{ fontSize: 12, color: theme.colors.grey, marginTop: 2 }}>
              The agent runs the what-if, forecast and risk tools and answers in plain language.
            </div>
          </div>
          <Button onClick={() => setOpen(true)}><MessageCircle size={14} /> Ask the agent</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto', padding: 4 }}>
            {msgs.length === 0 && (
              <div style={{ display: 'flex', gap: 10 }}>
                <AgentAvatar />
                <Bubble agent>Hi, I'm the FairQueue capacity agent. Ask me who can take more work, what a leave request would break, or whether the next weeks fit the team's hours.</Bubble>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, justifyContent: m.from === 'you' ? 'flex-end' : 'flex-start' }}>
                {m.from === 'agent' && <AgentAvatar />}
                <Bubble agent={m.from === 'agent'}>
                  {m.text}
                  {m.from === 'agent' && m.method && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <Pill>{m.method}</Pill>{m.tools?.map((t, j) => <Pill key={j} color={theme.colors.accent}>{t}</Pill>)}
                    </div>
                  )}
                </Bubble>
              </div>
            ))}
            {busy && <div style={{ display: 'flex', gap: 10 }}><AgentAvatar /><Bubble agent><span style={{ color: theme.colors.grey }}>Checking the numbers…</span></Bubble></div>}
            <div ref={end} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PROMPTS.map(p => (
              <button key={p} onClick={() => ask(p)} disabled={busy} style={{
                padding: '5px 12px', borderRadius: theme.radius.pill, border: `1px solid ${theme.colors.track}`, background: theme.colors.card,
                fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer', color: theme.colors.ink, fontFamily: 'inherit',
              }}>{p}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask(q)} style={inputStyle}
              placeholder="Ask the capacity agent…" autoFocus />
            <Button onClick={() => ask(q)} disabled={busy || !q.trim()}><Send size={14} /> Ask</Button>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: theme.colors.grey }}>
            Numbers come from the what-if, forecast and risk tools, not from the language model. As of {fmtDate(new Date().toISOString())}.
          </p>
        </div>
      )}
    </Card>
  );
}

function AgentAvatar() {
  return (
    <span style={{ width: 28, height: 28, borderRadius: 8, background: theme.colors.accent, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Bot size={15} color="#fff" /></span>
  );
}

function Bubble({ agent, children }: { agent?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: '80%', padding: '9px 13px', fontSize: 13, lineHeight: 1.5, borderRadius: 14,
      background: agent ? theme.colors.background : theme.colors.ink, color: agent ? theme.colors.ink : '#fff',
      borderTopLeftRadius: agent ? 4 : 14, borderTopRightRadius: agent ? 14 : 4 }}>{children}</div>
  );
}
