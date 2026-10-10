import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket as TicketIcon, CheckCircle, Clock, AlertCircle, BarChart2, Users, HelpCircle, MessageCircle, AlertTriangle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Dept, Forecast, RiskList, Summary, Ticket, Workload } from '../../api/types';
import { useApi, useSession } from '../../session';
import { KpiCard } from '../../components/KpiCard';
import { HatchedBar } from '../../components/HatchedBar';
import { DepartmentChip } from '../../components/DepartmentChip';
import { ANALYST_COLORS } from '../../components/LeaveCalendar';
import { Button, Card, Empty, Grid, Loading, Notice, Pill, Table, fmtDate, initials, inputStyle, td } from '../../components/ui';

export default function Dashboard() {
  const { division, setDivision, meta } = useSession();
  const summary = useApi<Summary>(`/tickets/summary${qs({ role: 'lead', division })}`);
  const risk = useApi<RiskList>(`/prediction/risk${qs({ division })}`);
  const workload = useApi<Workload[]>(`/assignment/workload${qs({ role: 'lead', division })}`);
  const forecast = useApi<Forecast>(`/planning/forecast${qs({ n_weeks: 2, division })}`);
  const unassigned = useApi<Ticket[]>(`/tickets/${qs({ role: 'lead', status: 'Unassigned', division })}`);
  const team = summary.data?.team;
  const lowConf = (unassigned.data ?? []).filter(t => t.confidence === 'Low');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
      {/* Department filter: applies to the whole dashboard */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: theme.colors.grey }}>Show</span>
        {[null, ...(meta?.departments ?? [])].map(d => (
          <button key={d ?? 'all'} onClick={() => setDivision(d as Dept | null)} style={{
            padding: '5px 14px', borderRadius: theme.radius.pill, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: division === d ? theme.colors.ink : theme.colors.card, color: division === d ? '#fff' : theme.colors.grey,
            boxShadow: theme.shadow,
          }}>{d ?? 'All departments'}</button>
        ))}
      </div>

      {/* Ticket summary */}
      {team ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: theme.space.gap }}>
          <KpiCard label="Total tickets" value={team.total} icon={TicketIcon} />
          <KpiCard label="Solved" value={team.solved} icon={CheckCircle} iconColor={theme.colors.sage + '30'} />
          <KpiCard label="In progress" value={team.in_progress} icon={Clock} iconColor={theme.colors.sand + '40'} />
          <KpiCard label="Unassigned" value={team.unassigned} icon={HelpCircle} iconColor={theme.colors.grey + '30'} />
          <KpiCard label="At risk" value={team.at_risk ?? 0} icon={AlertCircle} iconColor={theme.colors.red + '20'} />
        </div>
      ) : <Loading error={summary.error} />}

      {lowConf.length > 0 && (
        <Notice tone="warn">
          <strong>{lowConf.length} new ticket type{lowConf.length > 1 ? 's' : ''} need your decision:</strong>{' '}
          {lowConf.map(t => t.title).join(', ')}. FairQueue hasn't seen these before, so it isn't guessing an assignee.{' '}
          <Link to="/lead/assign">Decide now</Link>
        </Notice>
      )}

      <Grid cols="minmax(0,1.2fr) minmax(0,1fr)">
        {/* At-risk alerts */}
        <Card title="At-risk tickets" icon={AlertCircle} iconColor={theme.colors.red}
          right={risk.data && <span style={{ fontSize: 11, color: theme.colors.grey }}>
            alerts at ≥{Math.round(risk.data.threshold * 100)}% chance of missing, max {risk.data.cap_per_day}/day, ranked by risk × business impact
          </span>}>
          {!risk.data ? <Loading error={risk.error} /> : risk.data.alerts.length === 0 ? <Empty>Nothing above the alert threshold.</Empty> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {risk.data.alerts.map(r => (
                <div key={r.ticket_id} style={{ padding: '10px 12px', borderRadius: 12, background: theme.colors.background }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13, flex: 1 }}>{r.ticket_title}</strong>
                    <DepartmentChip dept={r.division} size="sm" />
                    <Pill color={theme.colors.accent}>{r.cause}</Pill>
                    <Pill color={theme.colors.red} solid>{Math.round(r.p_miss * 100)}%</Pill>
                  </div>
                  <p style={{ margin: '6px 0', fontSize: 13 }}>{r.explanation}</p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: theme.colors.grey }}>
                    {r.facts.map(f => <li key={f}>{f}</li>)}
                  </ul>
                  <p style={{ margin: '6px 0 0', fontSize: 12 }}><strong>Suggested action:</strong> {r.action}{' '}
                    <Link to={`/lead/assign?ticket=${r.ticket_id}`}>Reassign</Link></p>
                </div>
              ))}
              {risk.data.suppressed > 0 && <p style={{ margin: 0, fontSize: 12, color: theme.colors.grey }}>{risk.data.suppressed} more above the threshold, held back by the daily cap.</p>}
            </div>
          )}
          {risk.data && risk.data.watch.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: theme.colors.grey }}>
              Watching (below the alert threshold): {risk.data.watch.map(w => `${w.ticket_title} (${Math.round(w.p_miss * 100)}%)`).join(', ')}
            </div>
          )}
        </Card>

        {/* Workload in hours */}
        <Card title="Workload per analyst (open predicted hours)" icon={Users} iconColor={theme.colors.sand}>
          {!workload.data ? <Loading error={workload.error} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {workload.data.map(a => (
                <HatchedBar key={a.analyst_id} label={`${a.name} · ${a.open_tickets} tickets`} booked={a.open_hours}
                  capacity={a.weekly_hours} avatarInitials={initials(a.name)} avatarColor={ANALYST_COLORS[a.name] ?? theme.colors.ink} />
              ))}
              <p style={{ margin: 0, fontSize: 11, color: theme.colors.grey }}>Hours, not ticket counts. Sorted by name; FairQueue never ranks analysts by speed.</p>
            </div>
          )}
        </Card>
      </Grid>

      <Grid cols="minmax(0,1fr) minmax(0,1fr)">
        <DepartmentTable summary={summary.data} onPick={d => setDivision(d)} active={division} />
        <ForecastCard forecast={forecast.data} error={forecast.error} division={division} />
      </Grid>

      <PlanningAssistant />
    </div>
  );
}

function DepartmentTable({ summary, onPick, active }: { summary: Summary | null; onPick: (d: Dept | null) => void; active: Dept | null }) {
  return (
    <Card title="By requesting department" icon={BarChart2}>
      {!summary ? <Loading /> : (
        <Table head={['Department', 'Total', 'Solved', 'In progress', 'Unassigned', 'Hours queued', 'At risk', 'Missed']}>
          {summary.departments.map(r => (
            <tr key={r.division} onClick={() => onPick(active === r.division ? null : r.division)} style={{ cursor: 'pointer' }}>
              <td style={td}><DepartmentChip dept={r.division} size="sm" /></td>
              <td style={{ ...td, fontWeight: 600 }}>{r.total}</td>
              <td style={{ ...td, color: theme.colors.sage, fontWeight: 600 }}>{r.solved}</td>
              <td style={{ ...td, color: theme.colors.accent }}>{r.in_progress}</td>
              <td style={td}>{r.unassigned}</td>
              <td style={td}>{r.hours_in_queue}h</td>
              <td style={{ ...td, color: r.at_risk ? theme.colors.red : undefined, fontWeight: r.at_risk ? 700 : 400 }}>{r.at_risk ?? 0}</td>
              <td style={td}>{r.missed}</td>
            </tr>
          ))}
        </Table>
      )}
      <p style={{ margin: '10px 0 0', fontSize: 11, color: theme.colors.grey }}>Click a department to filter the whole dashboard.</p>
    </Card>
  );
}

function ForecastCard({ forecast, error, division }: { forecast: Forecast | null; error: string | null; division: Dept | null }) {
  if (!forecast) return <Card title="Volume forecast"><Loading error={error} /></Card>;
  const depts: Dept[] = division ? [division] : ['HR', 'IT', 'Finance', 'Marketing'];
  const data = forecast.weeks.map(w => ({
    label: w.label.replace('Week of ', ''),
    capacity: w.capacity_hours,
    ...Object.fromEntries(depts.map(d => [d, w.departments[d].hours])),
  }));
  return (
    <Card title="Volume forecast · next 2 weeks (hours)" icon={BarChart2} iconColor={theme.colors.accent}>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={theme.colors.track} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {depts.map(d => <Bar key={d} dataKey={d} stackId="a" fill={theme.dept[d]} isAnimationActive={false} />)}
            {!division && <ReferenceLine y={Math.max(...forecast.weeks.map(w => w.capacity_hours))} stroke={theme.colors.red}
              strokeDasharray="4 4" label={{ value: 'Team hours', fontSize: 11, fill: theme.colors.red, position: 'insideTopRight' }} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
        {forecast.weeks.map(w => (
          <div key={w.week_start} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            {(w.over_capacity || w.spikes.length > 0) && <AlertTriangle size={14} color={theme.colors.sand} style={{ marginTop: 2, flexShrink: 0 }} />}
            {w.message}
          </div>
        ))}
      </div>
    </Card>
  );
}

function PlanningAssistant() {
  const [q, setQ] = useState('If Ravi takes leave next week, which deadlines break?');
  const [answer, setAnswer] = useState<{ answer: string; method: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    try { setAnswer(await api.post(`/planning/ask${qs({ question: q })}`, {})); }
    catch (e) { setAnswer({ answer: (e as Error).message, method: 'error' }); }
    finally { setBusy(false); }
  }
  return (
    <Card title="Ask about capacity" icon={MessageCircle} iconColor={theme.colors.accent}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && ask()} style={inputStyle} />
        <Button onClick={ask} disabled={busy}>{busy ? 'Checking…' : 'Ask'}</Button>
      </div>
      {answer && (
        <p style={{ margin: '12px 0 0', fontSize: 13, lineHeight: 1.5 }}>
          {answer.answer} <Pill>{answer.method}</Pill>
        </p>
      )}
      <p style={{ margin: '8px 0 0', fontSize: 11, color: theme.colors.grey }}>
        Numbers come from the what-if, forecast and risk tools, not from the language model. As of {fmtDate(new Date().toISOString())}.
      </p>
    </Card>
  );
}
