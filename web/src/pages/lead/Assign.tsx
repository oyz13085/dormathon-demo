import { useEffect, useMemo, useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowRight, BookOpen, CalendarCheck, CalendarOff, Check, CheckCircle, Clock, Flag, GraduationCap, Handshake,
  HelpCircle, Hourglass, Inbox, LifeBuoy, Target, Undo2, UserCheck, Users, X,
} from 'lucide-react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Candidate, MoveImpact, MoveOption, Priority, RecommendationCard as CardData, Ticket, Workload } from '../../api/types';
import { useApi, useSession } from '../../session';
import { DepartmentChip } from '../../components/DepartmentChip';
import { StatusPill } from '../../components/StatusPill';
import { Avatar, TicketCard } from '../../components/TicketModals';
import { Button, Card, FilterChip, Hint, Loading, MiniStat, Notice, PRIORITY_COLOR, Page, Pill, SearchBox, StatRow, StatTile, TabPills, Toolbar, cardGrid, fmtDate, inputStyle } from '../../components/ui';

type Tab = 'Unassigned' | 'At risk' | 'All open';

const DECISION: Record<CardData['decision'], { label: string; color: string; tone: 'ok' | 'warn' | 'error' | 'info' }> = {
  good: { label: 'Good fit · usual partner', color: theme.colors.sage, tone: 'ok' },
  possible: { label: 'Possible fit · usual partner with a note', color: theme.colors.sand, tone: 'warn' },
  poor: { label: 'Poor fit · someone else recommended', color: theme.colors.red, tone: 'error' },
  low_confidence: { label: 'New ticket type · you decide', color: theme.colors.sand, tone: 'warn' },
  no_partner: { label: 'No usual partner · best fit', color: theme.colors.ink, tone: 'info' },
  partner_busy: { label: 'Usual partner likely to miss · safer analyst', color: theme.colors.accent, tone: 'warn' },
};

const isRisky = (t: Ticket) => t.status !== 'Closed' && (t.alert || (t.p_miss ?? 0) >= 0.3);

export default function Assign() {
  const { division, setDivision } = useSession();
  const [params, setParams] = useSearchParams();
  // Load every ticket so a link to any ticket opens; the dashboard's department filter only narrows the list
  const tickets = useApi<Ticket[]>(`/tickets/${qs({ role: 'lead' })}`);
  const workload = useApi<Workload[]>(`/assignment/workload${qs({ role: 'lead' })}`);
  // Opened from a link (e.g. the dashboard's Reassign) → the ticket may already be assigned, so list all open ones
  const [tab, setTab] = useState<Tab>(() => (params.get('ticket') ? 'All open' : 'Unassigned'));
  const [search, setSearch] = useState('');

  const open = useMemo(() => (tickets.data ?? []).filter(t => t.status !== 'Closed' && (!division || t.division === division))
    .sort((a, b) => Number(!!a.assignee_id) - Number(!!b.assignee_id) || (a.confidence === 'Low' ? -1 : b.confidence === 'Low' ? 1 : 0)
      || a.deadline.localeCompare(b.deadline)), [tickets.data, division]);
  const shown = open.filter(t => (tab === 'Unassigned' ? !t.assignee_id : tab === 'At risk' ? isRisky(t) : true)
    && (!search || `${t.title} ${t.requester} ${t.category} #${t.id}`.toLowerCase().includes(search.toLowerCase())));

  const selectedId = Number(params.get('ticket')) || null;
  const selected = (tickets.data ?? []).find(t => t.id === selectedId) ?? null;
  const close = () => setParams({});

  const unassigned = open.filter(t => !t.assignee_id);
  const newTypes = unassigned.filter(t => t.confidence === 'Low').length;
  const [ws, we] = weekBounds();
  const dueSoon = unassigned.filter(t => { const d = new Date(`${t.deadline}T00:00:00`); return d >= ws && d < we; }).length;
  const free = Math.round((workload.data ?? []).reduce((s, a) => s + Math.max(a.weekly_hours - a.open_hours, 0), 0));
  const hoursWaiting = Math.round(unassigned.reduce((s, t) => s + (t.pred_likely ?? 0), 0));

  return (
    <Page>
      <Card title="Assign work" icon={UserCheck} iconColor={theme.colors.accent}
        right={<Hint>Pick a ticket, compare the team, assign</Hint>}>
        <StatRow>
          <StatTile icon={Inbox} color={theme.colors.ink} label="Waiting for an owner" value={unassigned.length} hint={`${hoursWaiting}h of work`} />
          <StatTile icon={HelpCircle} color={theme.colors.sand} label="New ticket types" value={newTypes} hint={newTypes ? 'need your decision' : 'none to decide'} />
          <StatTile icon={Clock} color={theme.colors.accent} label="Unassigned, due this week" value={dueSoon} hint="assign these first" />
          <StatTile icon={AlertCircle} color={theme.colors.red} label="At risk" value={open.filter(isRisky).length} hint="may need a reassign" />
          <StatTile icon={Users} color={theme.colors.sage} label="Team free hours" value={`${free}h`} hint="this week, after open work" />
        </StatRow>
      </Card>

      <Card title="Tickets" icon={Inbox} iconColor={theme.colors.accent}
        right={division ? <FilterChip onClear={() => setDivision(null)}>Showing {division} only</FilterChip>
          : <Hint>Unassigned and new types first · click a ticket to assign it</Hint>}>
        <div style={{ marginBottom: 14 }}>
          <Toolbar>
            <TabPills tabs={['Unassigned', 'At risk', 'All open'] as const} value={tab} onChange={setTab}
              counts={{ Unassigned: unassigned.length, 'At risk': open.filter(isRisky).length, 'All open': open.length }} />
            <SearchBox value={search} onChange={setSearch} placeholder="Search tickets…" />
          </Toolbar>
        </div>
        {!tickets.data ? <Loading error={tickets.error} /> : shown.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {search ? <>
              <span style={{ fontSize: 13, color: theme.colors.grey }}>No {tab.toLowerCase()} tickets match “{search}”.</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button small variant="ghost" onClick={() => setSearch('')}>Clear search</Button>
                {tab !== 'All open' && <Button small variant="outline" onClick={() => setTab('All open')}>Search all open tickets</Button>}
              </div>
            </> : (
              <span style={{ fontSize: 13, color: theme.colors.grey, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={15} color={theme.colors.sage} />
                {tab === 'Unassigned' ? 'Every open ticket has an owner.' : tab === 'At risk' ? 'No tickets at risk right now.' : 'No open tickets.'}
              </span>
            )}
          </div>
        ) : (
          <div style={cardGrid(240, false)}>
            {shown.map(t => <TicketCard key={t.id} t={t} selected={t.id === selectedId} onOpen={id => setParams({ ticket: String(id) })} />)}
          </div>
        )}
      </Card>

      {selected && (
        <AssignWindow onClose={close}>
          <TicketPanel key={selected.id} ticket={selected} onClose={close}
            next={unassigned.find(t => t.id !== selected.id) ?? null} onNext={id => setParams({ ticket: String(id) })} />
        </AssignWindow>
      )}
    </Page>
  );
}

/** Pop-up for assigning one ticket: grey body so the sections inside read as cards, like the dashboard. */
function AssignWindow({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} className="fq-modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(35,37,43,0.4)', zIndex: 200,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 1080, background: theme.colors.background,
        borderRadius: theme.radius.card, padding: 'clamp(10px, 2vw, 20px)', boxShadow: '0 20px 60px rgba(35,37,43,0.25)', containerType: 'inline-size' }}>
        {children}
      </div>
    </div>
  );
}

function weekBounds(): [Date, Date] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const end = new Date(start); end.setDate(start.getDate() + 7);
  return [start, end];
}

// ── The selected ticket: recommendation, team cards, decision ───────────────

interface Row extends Candidate { impact?: MoveOption; riskNow?: number | null; tags: string[] }

const QUICK_REASONS = ['Has more free time', 'Knows this requester', 'Building skills on this type', 'Balancing the workload', 'Requester asked for them'];

function TicketPanel({ ticket, next, onNext, onClose }: {
  ticket: Ticket; next: Ticket | null; onNext: (id: number) => void; onClose: () => void;
}) {
  const { refresh } = useSession();
  const card = useApi<CardData>(`/assignment/recommend/${ticket.id}`);
  const impact = useApi<MoveImpact>(`/assignment/move-impact/${ticket.id}`);
  const [picked, setPicked] = useState<number | null>(null);
  const [support, setSupport] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const c = card.data;
  const rows: Row[] = useMemo(() => {
    if (!c) return [];
    const byId = new Map((impact.data?.options ?? []).map(o => [o.analyst_id, o]));
    const current = impact.data?.current;
    return c.candidates.map(x => ({
      ...x, impact: byId.get(x.analyst_id),
      riskNow: current && current.analyst_id === x.analyst_id ? current.p_miss_now : undefined,
      tags: [
        ...(c.recommended?.analyst_id === x.analyst_id ? ['Recommended'] : []),
        ...(c.usual_partner?.analyst_id === x.analyst_id ? ['Usual partner'] : []),
        ...(c.support?.analyst_id === x.analyst_id ? ['Suggested support'] : []),
        ...(ticket.assignee_id === x.analyst_id ? ['Current owner'] : []),
      ],
    })).sort((a, b) => Number(b.tags.includes('Recommended')) - Number(a.tags.includes('Recommended'))
      || Number(b.tags.includes('Current owner')) - Number(a.tags.includes('Current owner')) || (b.fit - b.load_penalty) - (a.fit - a.load_penalty));
  }, [c, impact.data, ticket.assignee_id]);

  const chosen = rows.find(r => r.analyst_id === picked) ?? null;
  const isOverride = !!c?.recommended && !!chosen && chosen.analyst_id !== c.recommended.analyst_id;
  const sameOwner = !!chosen && chosen.analyst_id === ticket.assignee_id;
  const canConfirm = !!chosen && !busy && !(isOverride && !reason.trim()) && !(sameOwner && !support);

  function pick(id: number) {
    setPicked(picked === id ? null : id); setSupport(null); setReason(''); setError(null);
  }

  async function assign(analystId: number, supportId?: number | null, why?: string) {
    setBusy(true); setError(null);
    try {
      const r = await api.post<{ ticket: Ticket; accepted: boolean; handover: boolean }>('/assignment/assign', {
        ticket_id: ticket.id, analyst_id: analystId, support_id: supportId ?? undefined, decided_by: 'lead',
        override_reason: why?.trim() || undefined,
      });
      setDone(`${r.ticket.assignee_name} now owns this ticket${supportId ? `, with ${rows.find(x => x.analyst_id === supportId)?.name} supporting` : ''}.`
        + `${c?.decision === 'low_confidence' ? ' Saved as your decision on a new ticket type.' : r.accepted ? '' : ' Your reason is saved in the override log.'}`
        + `${r.handover ? ' Counted as a handover.' : ''}`);
      setPicked(null); setSupport(null); setReason('');
      refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!c) return <Card><Loading error={card.error} /></Card>;
  const d = DECISION[c.decision];
  const showRec = c.recommended && c.recommended.analyst_id !== ticket.assignee_id;
  // The fit score favours the usual partner; if they'd likely miss the deadline, point to a safer option too
  const riskOf = (r: Row) => (r.analyst_id === ticket.assignee_id ? r.riskNow : r.impact?.p_miss_if_moved) ?? null;
  const recRow = rows.find(r => r.analyst_id === c.recommended?.analyst_id);
  const recRisk = recRow ? riskOf(recRow) : null;
  const recIsRisky = showRec && recRisk !== null && recRisk >= (impact.data?.threshold ?? 0.5);
  const safer = recIsRisky ? rows.filter(r => r !== recRow && (riskOf(r) ?? 1) < 0.3)
    .sort((a, b) => (b.fit - b.load_penalty) - (a.fit - a.load_penalty))[0] ?? null : null;
  const saferIsOwner = !!safer && safer.analyst_id === ticket.assignee_id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
      {/* Ticket header */}
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 12, color: theme.colors.grey }}>#{ticket.id} · requested by {ticket.requester}</div>
            <h2 style={{ margin: '4px 0 10px', fontSize: 20 }}>{ticket.title}</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <StatusPill status={ticket.status} />
              <DepartmentChip dept={ticket.division} size="sm" />
              <Pill color={PRIORITY_COLOR[ticket.priority]}>{ticket.priority}</Pill>
              {c.category && <Pill>{c.category}</Pill>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <MiniStat label="Estimate" value={`${c.hours.likely}h`} sub={`${c.hours.low}–${c.hours.high}h`} />
            <MiniStat label="Deadline" value={fmtDate(ticket.deadline)} sub={daysLeft(ticket.deadline)} />
            <MiniStat label="Owner" value={ticket.assignee_name ?? '—'} sub={ticket.assignee_name ? 'assigned' : 'unassigned'} />
            <button onClick={onClose} aria-label="Close" title="Close (Esc)" style={{ alignSelf: 'flex-start', width: 32, height: 32, borderRadius: '50%', border: 'none',
              background: theme.colors.track, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} color={theme.colors.ink} />
            </button>
          </div>
        </div>
        {ticket.description && <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.5, color: theme.colors.ink }}>{ticket.description}</p>}
      </Card>

      {/* Done: confirm and move on */}
      {done && (
        <div style={{ padding: '18px 20px', borderRadius: theme.radius.card, background: theme.colors.card, boxShadow: theme.shadow,
          borderLeft: `4px solid ${theme.colors.sage}`, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ width: 38, height: 38, borderRadius: '50%', background: theme.colors.sage, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check size={20} color="#fff" />
          </span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Assigned</div>
            <div style={{ fontSize: 13, color: theme.colors.grey, marginTop: 2 }}>{done}</div>
          </div>
          <Button variant="ghost" onClick={onClose}>Done</Button>
          {next && <Button onClick={() => onNext(next.id)}>Next: {next.title} <ArrowRight size={14} /></Button>}
        </div>
      )}

      {/* Step 1: the recommendation, one click */}
      {!done && (
        <div style={{ padding: '18px 20px', borderRadius: theme.radius.card, background: theme.colors.card, boxShadow: theme.shadow,
          borderLeft: `4px solid ${d.color}`, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {c.recommended ? <Avatar name={c.recommended.name} size={44} /> : (
            <span style={{ width: 44, height: 44, borderRadius: '50%', background: d.color + '18', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HelpCircle size={20} color={d.color} />
            </span>
          )}
          <div style={{ flex: 1, minWidth: 240 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: d.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {d.label}
            </div>
            <div style={{ fontSize: 15, marginTop: 3, lineHeight: 1.45 }}>
              {!c.recommended ? c.note
                : c.recommended.analyst_id === ticket.assignee_id
                  ? <><strong>{c.recommended.name}</strong> already owns this and is still the best fit.{(ticket.p_miss ?? 0) >= 0.3
                    ? <> It's at risk, so consider <strong>adding a helper</strong>{c.support ? <> such as <strong>{c.support.name}</strong></> : null}: select {c.recommended.name} below.</> : null}</>
                  : <>We suggest <strong>{c.recommended.name}</strong>{c.support ? <>, with <strong>{c.support.name}</strong> supporting</> : null}.</>}
            </div>
            {c.recommended && c.facts && c.facts.filter(Boolean).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {c.facts.filter(Boolean).map(f => <span key={f} style={{ fontSize: 11, padding: '3px 10px', borderRadius: theme.radius.pill, background: theme.colors.background }}>{f}</span>)}
              </div>
            )}
            {!c.recommended && <div style={{ fontSize: 12, color: theme.colors.grey, marginTop: 6 }}>Pick someone below. Free hours and deadline risk are shown for everyone.</div>}
            {recIsRisky && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 10, background: theme.colors.red + '10', color: theme.colors.red, fontSize: 12,
                display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Heads-up: with their current queue, {c.recommended!.name} is <strong>{Math.round(recRisk! * 100)}%</strong> likely to miss the deadline.
                  {safer && <> {saferIsOwner ? <>Keeping <strong>{safer.name}</strong></> : <><strong>{safer.name}</strong></>} is safer
                    ({Math.round((riskOf(safer) ?? 0) * 100)}% risk).</>}
                </span>
              </div>
            )}
          </div>
          {showRec && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {safer && !saferIsOwner && (
                <Button disabled={busy} onClick={() => assign(safer.analyst_id, null, `Safer for the deadline: ${Math.round((riskOf(safer) ?? 0) * 100)}% risk vs ${Math.round(recRisk! * 100)}% with ${c.recommended!.name}`)}>
                  <CheckCircle size={14} /> Assign {safer.name} (safer)
                </Button>
              )}
              {safer && saferIsOwner && <Button disabled={busy} onClick={onClose}><CheckCircle size={14} /> Keep {safer.name}</Button>}
              <Button variant={recIsRisky ? 'outline' : 'primary'} disabled={busy} onClick={() => assign(c.recommended!.analyst_id, c.support?.analyst_id)}>
                {!recIsRisky && <CheckCircle size={14} />} Assign {c.recommended!.name}{c.support ? ` + ${c.support.name}` : ''}{recIsRisky ? ' anyway' : ''}
              </Button>
              <span style={{ fontSize: 11, color: theme.colors.grey, textAlign: 'center' }}>or pick someone else below</span>
            </div>
          )}
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {/* Step 2: anyone on the team */}
      <Card title={c.recommended ? 'Or pick someone else' : 'Pick an analyst'} icon={Users} iconColor={theme.colors.sand}
        right={<Hint>Best options first · tap a card to select</Hint>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(r => <AnalystCard key={r.analyst_id} r={r} thresholds={c.thresholds} high={c.hours.high} selected={picked === r.analyst_id} onPick={() => pick(r.analyst_id)} />)}
        </div>
      </Card>

      <PriorityCard ticket={ticket} />

      {!!c.similar_work?.length && (
        <Card title="Similar work already delivered" icon={BookOpen} iconColor={theme.colors.sage}
          right={<Hint>Share these with whoever picks it up</Hint>}>
          <div style={cardGrid(260)}>
            {c.similar_work.map(w => (
              <a key={w.deliverable_id} href={api.fileUrl(w.deliverable_id)} target="_blank" rel="noreferrer" className="fq-lift" style={{
                display: 'block', padding: 12, borderRadius: 12, background: theme.colors.background, textDecoration: 'none', color: theme.colors.ink }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <strong style={{ fontSize: 13, flex: 1 }}>{w.title}</strong>
                  <DepartmentChip dept={w.division} size="sm" />
                </div>
                {w.summary && <div style={{ fontSize: 12, color: theme.colors.grey, marginTop: 4 }}>{w.summary}</div>}
                <div style={{ fontSize: 11, color: theme.colors.grey, marginTop: 4 }}>Delivered {fmtDate(w.delivered_on)}</div>
              </a>
            ))}
          </div>
        </Card>
      )}

      {ticket.assignee_id && !done && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="danger" small onClick={async () => { await api.post(`/assignment/unassign/${ticket.id}`, {}); refresh(); }}>
            <Undo2 size={13} /> Move back to Unassigned
          </Button>
        </div>
      )}

      {/* Step 3: confirm. Sticks to the bottom of the window so it's always in reach */}
      {chosen && (
        <div style={{ position: 'sticky', bottom: 0, zIndex: 2, marginTop: -4, padding: 16, borderRadius: theme.radius.card,
          background: theme.colors.ink, color: '#fff', boxShadow: '0 -8px 30px rgba(35,37,43,0.25)', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Avatar name={chosen.name} size={36} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {sameOwner ? <>Keep {chosen.name} and add a helper</> : <>Assign to {chosen.name}</>}
                {isOverride && <span style={{ marginLeft: 8 }}><Pill color={theme.colors.sand} solid>Not the suggestion</Pill></span>}
                {ticket.assignee_id && !sameOwner && <span style={{ marginLeft: 6 }}><Pill color={theme.colors.accent} solid>Handover</Pill></span>}
              </div>
              {chosen.impact && !sameOwner && (
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                  {Math.round(chosen.impact.p_miss_if_moved * 100)}% chance of missing the deadline
                  {chosen.impact.expected_completion ? ` · likely done ${fmtDate(chosen.impact.expected_completion)}` : ''}
                </div>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.9 }}>
              <LifeBuoy size={14} /> Helper
              <select value={support ?? ''} onChange={e => setSupport(e.target.value ? Number(e.target.value) : null)} style={{
                padding: '7px 10px', borderRadius: 10, border: 'none', fontSize: 13, fontFamily: 'inherit', background: '#ffffff1A', color: '#fff' }}>
                <option value="" style={{ color: theme.colors.ink }}>{sameOwner ? 'Choose a helper…' : 'None'}</option>
                {rows.filter(r => r.analyst_id !== chosen.analyst_id).map(r => (
                  <option key={r.analyst_id} value={r.analyst_id} style={{ color: theme.colors.ink }}>{r.name} · {r.free_hours}h free</option>
                ))}
              </select>
            </label>
          </div>

          {isOverride && (
            <div>
              <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>Why {chosen.name}? Pick a reason or type your own (saved in the override log)</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {QUICK_REASONS.map(q => (
                  <button key={q} onClick={() => setReason(q)} style={{
                    padding: '5px 12px', borderRadius: theme.radius.pill, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                    border: '1px solid #ffffff40', background: reason === q ? '#fff' : 'transparent', color: reason === q ? theme.colors.ink : '#fff',
                  }}>{q}</button>
                ))}
              </div>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Or type a reason…"
                style={{ ...inputStyle, background: '#ffffff14', border: '1px solid #ffffff30', color: '#fff' }} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            {isOverride && !reason.trim() && <span style={{ fontSize: 12, opacity: 0.7, marginRight: 'auto' }}>Add a reason to continue</span>}
            {sameOwner && !support && <span style={{ fontSize: 12, opacity: 0.7, marginRight: 'auto' }}>Choose a helper to continue</span>}
            <button onClick={() => setPicked(null)} style={{ padding: '8px 18px', borderRadius: theme.radius.pill, border: '1px solid #ffffff40',
              background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>Cancel</button>
            <button disabled={!canConfirm} onClick={() => assign(chosen.analyst_id, support, reason || (sameOwner ? `Added support for ${chosen.name}` : undefined))} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: theme.radius.pill, border: 'none',
              background: '#fff', color: theme.colors.ink, cursor: canConfirm ? 'pointer' : 'not-allowed', opacity: canConfirm ? 1 : 0.4,
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
              <UserCheck size={14} /> {busy ? 'Saving…' : sameOwner ? 'Add helper' : `Assign ${chosen.name}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function daysLeft(deadline: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const n = Math.round((new Date(`${deadline}T00:00:00`).getTime() - today.getTime()) / 86400000);
  return n > 0 ? `in ${n} day${n !== 1 ? 's' : ''}` : n === 0 ? 'today' : `${-n} days overdue`;
}

type Factor = keyof Candidate['breakdown'];

// Each part of the fit score, with what a high or low value means in plain words
const FACTORS: { key: Factor; label: string; short: string; icon: ElementType; good: string; weak: string; detail: (r: Row, high: number) => string }[] = [
  { key: 'skill', label: 'Skill', short: 'Skill', icon: GraduationCap, good: 'Experienced on this type', weak: 'New to this type',
    detail: r => `${r.past_in_category} past ticket${r.past_in_category !== 1 ? 's' : ''} of this type` },
  { key: 'track', label: 'Track record', short: 'Track', icon: Target, good: 'Usually on estimate', weak: 'Often over estimate',
    detail: r => r.breakdown.track >= 0.7 ? 'Hours usually match the estimate' : r.breakdown.track >= 0.4 ? 'Sometimes runs over' : 'Often runs over or gets revisions' },
  { key: 'pairing', label: 'Partnership', short: 'Pairing', icon: Handshake, good: 'Knows this requester', weak: 'New to this requester',
    detail: r => `${r.past_with_requester} done for this requester` },
  { key: 'capacity', label: 'Capacity', short: 'Capacity', icon: Hourglass, good: 'Has free time', weak: 'Little free time',
    detail: (r, high) => `${r.free_hours}h free vs up to ${high}h needed` },
  { key: 'deadline', label: 'Deadline', short: 'Deadline', icon: CalendarCheck, good: 'Deadline safe', weak: 'Deadline tight',
    detail: r => `${Math.round(r.breakdown.deadline * 100)}% chance of finishing on time` },
];
const level = (v: number) => (v >= 0.7 ? theme.colors.sage : v >= 0.4 ? theme.colors.sand : theme.colors.red);

function matchLabel(r: Row, t: CardData['thresholds']): { label: string; color: string } {
  if (r.low_confidence) return { label: 'Little history', color: theme.colors.grey };
  if (r.fit >= t.good_fit) return { label: 'Strong match', color: theme.colors.sage };
  if (r.fit >= t.poor_fit) return { label: 'OK match', color: theme.colors.sand };
  return { label: 'Weak match', color: theme.colors.red };
}

function AnalystCard({ r, thresholds, high, selected, onPick }: {
  r: Row; thresholds: CardData['thresholds']; high: number; selected: boolean; onPick: () => void;
}) {
  const m = matchLabel(r, thresholds);
  const cap = r.impact?.weekly_hours ?? r.open_hours + r.free_hours;
  const used = cap ? Math.min(r.open_hours / cap, 1) : 0;
  const owner = r.tags.includes('Current owner');
  const p = owner ? (r.riskNow ?? undefined) : r.impact?.p_miss_if_moved;
  const pc = p === undefined ? theme.colors.grey : p >= 0.5 ? theme.colors.red : p >= 0.3 ? theme.colors.sand : theme.colors.sage;
  const hurts = r.impact?.affected.filter(a => a.crosses) ?? [];
  const leave = r.impact?.leave_days ?? [];
  const rec = r.tags.includes('Recommended');
  const strong = FACTORS.filter(f => r.breakdown[f.key] >= 0.7);
  const weak = FACTORS.filter(f => r.breakdown[f.key] < 0.4);
  const label = { fontSize: 10, color: theme.colors.grey } as const;

  return (
    <div role="button" tabIndex={0} onClick={onPick} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onPick()} className="fq-lift" style={{
      padding: '10px 14px', borderRadius: 14, cursor: 'pointer', color: theme.colors.ink,
      background: selected ? theme.colors.ink + '08' : theme.colors.card,
      border: `2px solid ${selected ? theme.colors.ink : rec ? theme.colors.accent + '80' : theme.colors.track}`,
      display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0,
    }}>
      <div className="fq-analyst-row">
        {/* Who */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `2px solid ${selected ? theme.colors.ink : theme.colors.track}`, background: selected ? theme.colors.ink : 'transparent' }}>
            {selected && <Check size={11} color="#fff" />}
          </span>
          <Avatar name={r.name} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.name} <span style={{ fontSize: 11, fontWeight: 600, color: m.color, marginLeft: 4 }}>{m.label}</span></div>
            {r.tags.length > 0 && (
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
                {r.tags.map(t => <Pill key={t} color={t === 'Recommended' ? theme.colors.accent : t === 'Current owner' ? theme.colors.ink : theme.colors.sage}
                  solid={t === 'Recommended'}>{t}</Pill>)}
              </div>
            )}
          </div>
        </div>

        {/* Fit */}
        <div title="Fit score for this ticket type (0–100)" style={{ width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: `conic-gradient(${m.color} ${r.fit * 3.6}deg, ${theme.colors.track} 0)` }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: theme.colors.card, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1, color: m.color }}>{Math.round(r.fit)}</span>
            <span style={{ fontSize: 7, color: theme.colors.grey }}>FIT</span>
          </div>
        </div>

        {/* Free time */}
        <div title={`${r.open_hours}h of ${cap}h already booked`}>
          <div style={{ fontSize: 15, fontWeight: 700, color: r.free_hours > 0 ? theme.colors.ink : theme.colors.red }}>{r.free_hours}h <span style={label}>free</span></div>
          <div style={{ height: 4, borderRadius: 2, background: theme.colors.track, margin: '3px 0 2px' }}>
            <div style={{ width: `${used * 100}%`, height: '100%', borderRadius: 2,
              background: used >= 0.9 ? theme.colors.red : used >= 0.6 ? theme.colors.sand : theme.colors.sage }} />
          </div>
          <div style={label}>{r.open_hours}/{cap}h booked</div>
        </div>

        {/* Risk */}
        <div title={r.impact?.expected_completion && !owner ? `Likely done ${fmtDate(r.impact.expected_completion)}` : undefined}>
          <div style={{ fontSize: 15, fontWeight: 700, color: pc }}>{p === undefined ? '—' : `${Math.round(p * 100)}%`}</div>
          <div style={label}>{owner ? 'risk now' : 'risk if assigned'}</div>
        </div>

        {/* Score parts: hover for what each means */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
          {FACTORS.map(f => {
            const v = Math.max(0, Math.min(r.breakdown[f.key], 1));
            const Icon = f.icon;
            return (
              <div key={f.key} title={`${f.label}: ${f.detail(r, high)}`} style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
                  <Icon size={11} color={level(v)} style={{ flexShrink: 0 }} />
                  <span style={{ color: theme.colors.grey, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.short}</span>
                  <strong style={{ color: level(v) }}>{Math.round(v * 100)}</strong>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: theme.colors.track, marginTop: 4 }}>
                  <div style={{ width: `${v * 100}%`, height: '100%', borderRadius: 2, background: level(v) }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* One line: strengths, watch-outs, warnings */}
      {(strong.length + weak.length > 0 || (!owner && (hurts.length > 0 || leave.length > 0))) && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingLeft: 26 }}>
          {!owner && hurts.length > 0 && <Chip color={theme.colors.red} icon={AlertTriangle}>Would put {hurts.map(a => a.title).join(', ')} at risk</Chip>}
          {!owner && leave.length > 0 && <Chip color={theme.colors.red} icon={CalendarOff}>On leave {leave.map(d => fmtDate(d)).join(', ')}</Chip>}
          {strong.map(f => <Chip key={f.key} color={theme.colors.sage} icon={Check}>{f.good}</Chip>)}
          {weak.map(f => <Chip key={f.key} color="#A8743F" icon={AlertTriangle}>{f.weak}</Chip>)}
        </div>
      )}
    </div>
  );
}

function Chip({ color, icon: Icon, children }: { color: string; icon: ElementType; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, padding: '2px 8px',
      borderRadius: theme.radius.pill, background: color + '16', color }}><Icon size={10} />{children}</span>
  );
}

function PriorityCard({ ticket }: { ticket: Ticket }) {
  const { refresh } = useSession();
  const [priority, setPriority] = useState<Priority>(ticket.priority);
  const [reason, setReason] = useState('');
  useEffect(() => { setPriority(ticket.priority); setReason(''); }, [ticket.id, ticket.priority]);
  const changed = priority !== ticket.priority;
  return (
    <Card title="Priority" icon={Flag} iconColor={PRIORITY_COLOR[priority]}
      right={<Hint>The lead has the final say</Hint>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
        {(['Low', 'Medium', 'High', 'Critical'] as Priority[]).map(p => {
          const on = priority === p;
          return (
            <button key={p} onClick={() => setPriority(p)} style={{
              padding: '8px 4px', borderRadius: 12, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
              border: `1.5px solid ${on ? PRIORITY_COLOR[p] : theme.colors.track}`, background: on ? PRIORITY_COLOR[p] : theme.colors.card,
              color: on ? '#fff' : theme.colors.ink,
            }}>{p}{p === ticket.priority && !on ? ' ·' : ''}</button>
          );
        })}
      </div>
      {changed && (
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} placeholder={`Why ${ticket.priority} → ${priority}?`} />
          <Button onClick={async () => { await api.patch(`/tickets/${ticket.id}/priority`, { priority, reason, by: 'lead' }); refresh(); }}>Save</Button>
        </div>
      )}
      {!changed && <div style={{ fontSize: 12, color: theme.colors.grey }}>Currently <strong style={{ color: PRIORITY_COLOR[ticket.priority] }}>{ticket.priority}</strong>. Pick another level to change it.</div>}
    </Card>
  );
}
