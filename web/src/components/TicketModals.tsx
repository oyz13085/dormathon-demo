import { useState } from 'react';
import { AlertTriangle, CalendarDays, CalendarOff, CheckCircle, Info, LifeBuoy, Lightbulb, ListOrdered, Shuffle, TrendingUp, Users } from 'lucide-react';
import { theme } from '../theme';
import { api } from '../api/client';
import type { MoveImpact, MoveOption, RiskItem, Ticket, TicketDetail } from '../api/types';
import { useApi, useSession } from '../session';
import { StatusPill } from './StatusPill';
import { DepartmentChip } from './DepartmentChip';
import { ANALYST_COLORS } from './LeaveCalendar';
import { Button, Empty, Loading, Modal, Notice, PRIORITY_COLOR, Pill, RiskBadge, fmtDate, hours, initials, inputStyle } from './ui';

function InfoTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 12, background: theme.colors.background, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: theme.colors.grey, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{children}</div>
    </div>
  );
}

/** A ticket as a small card, used in grids on the dashboard. */
export function TicketCard({ t, onOpen, hideAssignee, selected }: { t: Ticket; onOpen: (id: number) => void; hideAssignee?: boolean; selected?: boolean }) {
  const open = t.status !== 'Closed';
  const alert = open && !!t.alert;
  const watch = open && !alert && (t.p_miss ?? 0) >= 0.3;
  const edge = alert ? theme.colors.red : watch ? theme.colors.sand : theme.colors.track;
  return (
    <button onClick={() => onOpen(t.id)} className="fq-lift" style={{
      textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.ink,
      background: selected ? theme.colors.background : theme.colors.card,
      border: selected ? `2px solid ${theme.colors.ink}` : `1.5px solid ${edge}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: '0 1px 3px rgba(35,37,43,0.05)', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: theme.colors.grey, flex: 1 }}>#{t.id}</span>
        <StatusPill status={t.status} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, minHeight: 38,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.title}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <DepartmentChip dept={t.division} size="sm" />
        <Pill color={PRIORITY_COLOR[t.priority]}>{t.priority}</Pill>
        {(alert || watch) && <RiskBadge p={t.p_miss} />}
        {t.confidence === 'Low' && t.status === 'Unassigned' && <Pill color={theme.colors.sand} solid>New type</Pill>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.colors.grey, marginTop: 'auto' }}>
        {!hideAssignee && (t.assignee_name
          ? <><Avatar name={t.assignee_name} size={20} /><span style={{ color: theme.colors.ink }}>{t.assignee_name}</span></>
          : <span>Unassigned</span>)}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <CalendarDays size={12} /> {fmtDate(t.deadline)}
        </span>
      </div>
    </button>
  );
}

export function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, color: '#fff',
      background: ANALYST_COLORS[name ?? ''] ?? theme.colors.grey }}>{initials(name)}</span>
  );
}

/** Read-only details of one ticket. Risky tickets get a button into the reassign / support window. */
export function TicketDetailModal({ ticketId, onClose, onAct }: {
  ticketId: number; onClose: () => void; onAct?: (ticketId: number) => void;
}) {
  const { data: t, error } = useApi<TicketDetail>(`/tickets/${ticketId}?role=lead`);
  return (
    <Modal title={t ? t.title : 'Ticket'} onClose={onClose} width={620}>
      {!t ? <Loading error={error} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill status={t.status} />
            <DepartmentChip dept={t.division} size="sm" />
            <Pill color={PRIORITY_COLOR[t.priority]}>{t.priority}</Pill>
            {t.category && <Pill>{t.category}</Pill>}
            {t.status !== 'Closed' && <RiskBadge p={t.p_miss} />}
          </div>
          {t.description && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{t.description}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <InfoTile label="Assignee">{t.assignee_name
              ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Avatar name={t.assignee_name} size={20} />{t.assignee_name}</span>
              : <span style={{ color: theme.colors.grey }}>Unassigned</span>}</InfoTile>
            <InfoTile label="Requester">{t.requester}</InfoTile>
            <InfoTile label="Deadline">{fmtDate(t.deadline)}</InfoTile>
            <InfoTile label="Estimated hours">{hours(t.pred_low, t.pred_likely, t.pred_high)}</InfoTile>
            {t.expected_completion && <InfoTile label="Expected finish">{fmtDate(t.expected_completion)}</InfoTile>}
            <InfoTile label="Created">{fmtDate(t.created_at)}</InfoTile>
            {t.closed_at && <InfoTile label="Closed">{fmtDate(t.closed_at)}</InfoTile>}
            <InfoTile label="Deliverables">{t.deliverables.length || '—'}</InfoTile>
          </div>
          {t.explanation && t.status !== 'Closed' && (
            <RiskBreakdown cause={t.cause ?? ''} pMiss={t.p_miss ?? 0} explanation={t.explanation} facts={t.facts ?? []}
              action={t.action} needed={t.pred_likely} low={t.pred_low} high={t.pred_high}
              deadline={t.deadline} finish={t.expected_completion} />
          )}
          {t.assignments && t.assignments.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.grey, marginBottom: 6 }}>Assignment history</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderLeft: `2px solid ${theme.colors.track}`, marginLeft: 9, paddingLeft: 14 }}>
                {t.assignments.map((a, i) => (
                  <div key={i} style={{ position: 'relative', fontSize: 12 }}>
                    <span style={{ position: 'absolute', left: -20, top: 3, width: 10, height: 10, borderRadius: '50%',
                      background: i === 0 ? theme.colors.ink : theme.colors.grey, border: '2px solid #fff' }} />
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{a.chosen_name}</strong>
                      {a.support_name && <Pill color={theme.colors.sage}>support: {a.support_name}</Pill>}
                      {a.is_handover ? <Pill color={theme.colors.accent}>handover</Pill> : null}
                      <span style={{ color: theme.colors.grey }}>{fmtDate(a.decided_at)}</span>
                    </div>
                    {a.override_reason && <div style={{ color: theme.colors.grey, marginTop: 2 }}>“{a.override_reason}”</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {onAct && t.status !== 'Closed' && (t.p_miss ?? 0) >= 0.3 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => onAct(t.id)}><Shuffle size={14} /> Reassign or add support</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const FACT_ICON: [RegExp, React.ElementType][] = [
  [/queued ahead|earlier-deadline/i, ListOrdered],
  [/average|team/i, Users],
  [/leave/i, CalendarOff],
  [/spike|season/i, TrendingUp],
  [/handover/i, Shuffle],
];

/** Why a ticket is at risk, drawn rather than listed: odds, hours needed vs available, the facts as tiles, and the next step. */
export function RiskBreakdown({ cause, pMiss, explanation, facts, action, needed, low, high, available, deadline, finish, confidence }: {
  cause: string; pMiss: number; explanation: string; facts: string[]; action?: string | null;
  needed?: number; low?: number; high?: number; available?: number; deadline?: string; finish?: string | null;
  confidence?: { level: 'High' | 'Medium' | 'Low'; reason: string };
}) {
  const c = pMiss >= 0.5 ? theme.colors.red : pMiss >= 0.3 ? theme.colors.sand : theme.colors.sage;
  const rest = facts.filter(f => f && !/^Needs \d/.test(f));
  return (
    <div style={{ borderRadius: 16, border: `1.5px solid ${c}55`, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 14, padding: 16, background: c + '0F', alignItems: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `conic-gradient(${c} ${pMiss * 360}deg, ${theme.colors.track} 0)` }}>
          <div style={{ width: 50, height: 50, borderRadius: '50%', background: theme.colors.card, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: c, lineHeight: 1 }}>{Math.round(pMiss * 100)}%</span>
            <span style={{ fontSize: 8, color: theme.colors.grey }}>miss</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c, textTransform: 'uppercase', letterSpacing: 0.4 }}>{cause || 'Deadline risk'}</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 2 }}>{explanation}</div>
          {confidence && (
            <div style={{ fontSize: 12, color: theme.colors.grey, marginTop: 6, lineHeight: 1.45 }}>
              <Pill color={confidence.level === 'High' ? theme.colors.sage : confidence.level === 'Medium' ? theme.colors.sand : theme.colors.red}>
                {confidence.level} confidence</Pill>{' '}{confidence.reason}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {deadline && <DateTimeline deadline={deadline} finish={finish} />}
        {needed !== undefined && <HoursCompare needed={needed} low={low} high={high} available={available} color={c} />}

        {rest.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {rest.map(f => {
              const Icon = FACT_ICON.find(([re]) => re.test(f))?.[1] ?? Info;
              return (
                <div key={f} style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 12, background: theme.colors.background, fontSize: 12, lineHeight: 1.4 }}>
                  <Icon size={14} color={theme.colors.grey} style={{ flexShrink: 0, marginTop: 1 }} />{f}
                </div>
              );
            })}
          </div>
        )}

        {action && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 12, background: theme.colors.ink, color: '#fff', fontSize: 13 }}>
            <Lightbulb size={16} color={theme.colors.sand} style={{ flexShrink: 0 }} />
            <span><span style={{ opacity: 0.65 }}>Suggested next step · </span>{action}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const DAY = 86400000;
const dayOf = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00`);

/** Today → deadline → expected finish on one line, so "late by a day" is visible at a glance. */
function DateTimeline({ deadline, finish }: { deadline: string; finish?: string | null }) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dl = dayOf(deadline);
  const fin = finish ? dayOf(finish) : null;
  const late = fin ? Math.round((fin.getTime() - dl.getTime()) / DAY) : null;
  const daysLeft = Math.round((dl.getTime() - today.getTime()) / DAY);
  const end = Math.max(dl.getTime(), fin?.getTime() ?? 0, today.getTime() + DAY);
  const pos = (d: Date) => `${((d.getTime() - today.getTime()) / (end - today.getTime())) * 100}%`;
  const points: { d: Date; label: string; c: string; big?: boolean }[] = [
    { d: today, label: 'Today', c: theme.colors.ink },
    { d: dl, label: 'Deadline', c: theme.colors.ink, big: true },
    ...(fin ? [{ d: fin, label: 'Expected finish', c: late && late > 0 ? theme.colors.red : theme.colors.sage, big: true }] : []),
  ];
  return (
    <div style={{ padding: '14px 16px 10px', borderRadius: 12, background: theme.colors.background }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 18 }}>
        <span style={{ fontWeight: 600 }}>Timeline</span>
        {late !== null && (late > 0
          ? <Pill color={theme.colors.red} solid>Finishes {late} day{late !== 1 ? 's' : ''} late</Pill>
          : <Pill color={theme.colors.sage} solid>{late === 0 ? 'Finishes on the deadline' : `Finishes ${-late} day${late !== -1 ? 's' : ''} early`}</Pill>)}
      </div>
      <div style={{ position: 'relative', height: 64, margin: '0 44px' }}>
        <div style={{ position: 'absolute', top: 6, left: 0, right: 0, height: 4, borderRadius: 2, background: theme.colors.track }} />
        <div style={{ position: 'absolute', top: 6, left: 0, width: pos(dl), height: 4, borderRadius: 2, background: theme.colors.ink }} />
        {fin && late !== null && late > 0 && (
          <div style={{ position: 'absolute', top: 6, left: pos(dl), width: `calc(${pos(fin)} - ${pos(dl)})`, height: 4, background: theme.colors.red }} />
        )}
        {points.map((p, i) => {
          const sameAsPrev = i > 0 && p.d.getTime() === points[i - 1].d.getTime();
          return (
            <div key={p.label} style={{ position: 'absolute', left: pos(p.d), top: 0, transform: 'translateX(-50%)', textAlign: 'center', whiteSpace: 'nowrap' }}>
              <div style={{ width: p.big ? 16 : 12, height: p.big ? 16 : 12, borderRadius: '50%', margin: `${p.big ? 0 : 2}px auto 0`,
                background: p.c, border: '3px solid #fff', boxShadow: `0 0 0 1.5px ${p.c}` }} />
              <div style={{ fontSize: 11, color: theme.colors.grey, marginTop: sameAsPrev ? 30 : 6 }}>{p.label}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: p.c }}>{fmtDate(p.d.toISOString())}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: theme.colors.grey, textAlign: 'center' }}>
        {daysLeft > 0 ? `${daysLeft} day${daysLeft !== 1 ? 's' : ''} until the deadline` : daysLeft === 0 ? 'Due today' : `${-daysLeft} days overdue`}
      </div>
    </div>
  );
}

/** Two bars on the same scale: hours left before the deadline vs hours the work likely takes (with its range). */
function HoursCompare({ needed, low, high, available, color }: { needed: number; low?: number; high?: number; available?: number; color: string }) {
  const scale = Math.max(high ?? 0, needed, available ?? 0, 1);
  const w = (h: number) => `${Math.min((h / scale) * 100, 100)}%`;
  const short = available !== undefined ? Math.round((needed - available) * 10) / 10 : null;
  const row = (label: string, value: string, bar: React.ReactNode) => (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, color: theme.colors.grey }}>{label}</span>
      <div style={{ position: 'relative', height: 14, borderRadius: 7, background: theme.colors.card }}>{bar}</div>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{value}</span>
    </div>
  );
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, background: theme.colors.background, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}>Hours</span>
        {short !== null && (short > 0
          ? <Pill color={theme.colors.red} solid>{short}h short</Pill>
          : <Pill color={theme.colors.sage} solid>{-short}h to spare</Pill>)}
      </div>
      {available !== undefined && row('Available', `${available}h`,
        <div style={{ position: 'absolute', inset: 0, width: w(available), borderRadius: 7, background: theme.colors.sage }} />)}
      {row('Likely needed', `${needed}h`, <>
        {low !== undefined && high !== undefined && (
          <div title={`Could take ${low}–${high}h`} style={{ position: 'absolute', top: 0, bottom: 0, left: w(low), width: `calc(${w(high)} - ${w(low)})`,
            borderRadius: 7, background: `repeating-linear-gradient(-45deg, ${color}33 0 4px, transparent 4px 8px)` }} />
        )}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: w(needed), borderRadius: 7, background: color }} />
      </>)}
      {low !== undefined && high !== undefined && (
        <div style={{ fontSize: 11, color: theme.colors.grey, paddingLeft: 120 }}>Striped part: it could take anywhere from {low}h to {high}h.</div>
      )}
    </div>
  );
}

const VERDICT: Record<MoveOption['verdict'], { label: string; color: string }> = {
  good:  { label: 'Good match', color: theme.colors.sage },
  tight: { label: 'Tight', color: theme.colors.sand },
  harms: { label: 'Affects others', color: theme.colors.accent },
  no:    { label: "Won't fix it", color: theme.colors.red },
};

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** Risk ticket window: why it's at risk, and who could take it or help, with the knock-on effect on their queue. */
export function RiskActionModal({ risk, defaultReason, onClose }: { risk: RiskItem; defaultReason?: string; onClose: () => void }) {
  const { refresh } = useSession();
  const { data, error } = useApi<MoveImpact>(`/assignment/move-impact/${risk.ticket_id}`);
  const [mode, setMode] = useState<'reassign' | 'support'>('reassign');
  const [picked, setPicked] = useState<number | null>(null);
  const [reason, setReason] = useState(defaultReason ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const option = data?.options.find(o => o.analyst_id === picked) ?? null;

  async function confirm() {
    if (!data || !option) return;
    setBusy(true); setMsg(null);
    try {
      if (mode === 'reassign') {
        await api.post('/assignment/assign', {
          ticket_id: risk.ticket_id, analyst_id: option.analyst_id, decided_by: 'lead',
          override_reason: reason.trim() || `Deadline risk ${pct(risk.p_miss)}: moved to ${option.name} (${pct(option.p_miss_if_moved)} if moved)`,
        });
        setMsg({ tone: 'ok', text: `Reassigned to ${option.name}. The dashboard has been updated.` });
        setPicked(null);
      } else {
        if (!data.current) throw new Error('This ticket has no assignee to support yet; reassign it instead.');
        await api.post('/assignment/assign', {
          ticket_id: risk.ticket_id, analyst_id: data.current.analyst_id, support_id: option.analyst_id, decided_by: 'lead',
          override_reason: reason.trim() || `Deadline risk ${pct(risk.p_miss)}: ${option.name} supports ${data.current.name}`,
        });
        setMsg({ tone: 'ok', text: `${option.name} added as support for ${data.current.name}.` });
        setPicked(null);
      }
      refresh();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <Modal title={risk.ticket_title} onClose={onClose} width={780}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill color={theme.colors.red} solid>{pct(risk.p_miss)} chance of missing</Pill>
          <Pill color={theme.colors.accent}>{risk.cause}</Pill>
          <DepartmentChip dept={risk.division} size="sm" />
          <Pill color={PRIORITY_COLOR[risk.priority]}>{risk.priority}</Pill>
          <span style={{ fontSize: 12, color: theme.colors.grey }}>Due {fmtDate(risk.deadline)} · with {risk.assignee_name ?? 'nobody'}</span>
        </div>
        <RiskBreakdown cause={risk.cause} pMiss={risk.p_miss} explanation={risk.explanation} facts={risk.facts} action={risk.action}
          needed={risk.hours_needed} low={risk.hours_low} high={risk.hours_high} available={risk.hours_available}
          deadline={risk.deadline} finish={risk.expected_completion} confidence={risk.confidence} />

        <div style={{ display: 'flex', gap: 6 }}>
          {(['reassign', 'support'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} disabled={m === 'support' && !risk.assignee_name} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: theme.radius.pill,
              border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: mode === m ? theme.colors.ink : theme.colors.track, color: mode === m ? '#fff' : theme.colors.ink,
              opacity: m === 'support' && !risk.assignee_name ? 0.4 : 1,
            }}>
              {m === 'reassign' ? <><Shuffle size={14} /> Reassign</> : <><LifeBuoy size={14} /> Add support</>}
            </button>
          ))}
          <span style={{ fontSize: 12, color: theme.colors.grey, alignSelf: 'center', marginLeft: 6 }}>
            {mode === 'reassign' ? 'Move the ticket to someone else.' : `Keep ${risk.assignee_name ?? 'the owner'} as owner and add a helper.`}
          </span>
        </div>

        {msg && (msg.tone === 'ok' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 14, background: theme.colors.sage + '14',
            border: `1px solid ${theme.colors.sage}40` }}>
            <CheckCircle size={18} color={theme.colors.sage} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 13 }}>{msg.text}</span>
            <Button small onClick={onClose}>Done</Button>
          </div>
        ) : <Notice tone="error">{msg.text}</Notice>)}
        {!data ? <Loading error={error} /> : (
          <>
            {mode === 'reassign' && data.current && data.current.relief.length > 0 && (
              <Notice tone="ok">Moving it also frees {data.current.name}:{' '}
                {data.current.relief.map(r => `${r.title} ${pct(r.p_miss_before)} → ${pct(r.p_miss_after)}`).join(', ')}.</Notice>
            )}
            <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.grey }}>
              Team availability · {mode === 'reassign' ? 'risk if the ticket moves to them' : 'how much room they have to help'}
            </div>
            {data.options.length === 0 ? <Empty>No other analysts.</Empty> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                {(mode === 'support' ? [...data.options].sort((a, b) => b.free_hours - a.free_hours) : data.options).map(o => <OptionCard key={o.analyst_id} o={o} mode={mode} selected={picked === o.analyst_id}
                  onPick={() => setPicked(picked === o.analyst_id ? null : o.analyst_id)} />)}
              </div>
            )}

            {option && (
              <div style={{ position: 'sticky', bottom: -24, zIndex: 2, padding: 16, borderRadius: 16, background: theme.colors.ink, color: '#fff',
                boxShadow: '0 -8px 30px rgba(35,37,43,0.25)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={option.name} size={34} />
                  <div style={{ fontSize: 14, flex: 1 }}>
                    {mode === 'reassign'
                      ? <>Move to <strong>{option.name}</strong>: chance of missing <strong>{pct(risk.p_miss)} → {pct(option.p_miss_if_moved)}</strong>
                          {option.expected_completion && <span style={{ opacity: 0.7 }}> · likely done {fmtDate(option.expected_completion)}</span>}</>
                      : <><strong>{option.name}</strong> helps {risk.assignee_name} <span style={{ opacity: 0.7 }}>· {option.free_hours}h free this week</span></>}
                  </div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  {option.affected.length > 0 ? (
                    <>Effect on {option.name}'s own tickets{mode === 'support' ? ' (if they took it on fully)' : ''}:{' '}
                      {option.affected.map((a, i) => (
                        <span key={a.ticket_id} style={{ color: a.crosses ? '#F2A38F' : undefined }}>
                          {i > 0 ? ', ' : ''}{a.title} {pct(a.p_miss_before)} → {pct(a.p_miss_after)}{a.crosses && ' (becomes at risk)'}
                        </span>
                      ))}</>
                  ) : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><CheckCircle size={12} /> None of {option.name}'s other tickets get riskier.</span>}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for the log (optional, a default is filled in)"
                    style={{ ...inputStyle, background: '#ffffff14', border: '1px solid #ffffff30', color: '#fff', flex: 1 }} />
                  <button onClick={() => setPicked(null)} style={{ padding: '8px 16px', borderRadius: theme.radius.pill, border: '1px solid #ffffff40',
                    background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>Cancel</button>
                  <button onClick={confirm} disabled={busy} style={{ padding: '8px 18px', borderRadius: theme.radius.pill, border: 'none', background: '#fff',
                    color: theme.colors.ink, cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                    {busy ? 'Saving…' : mode === 'reassign' ? `Reassign to ${option.name}` : `Add ${option.name} as support`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function OptionCard({ o, mode, selected, onPick }: { o: MoveOption; mode: 'reassign' | 'support'; selected: boolean; onPick: () => void }) {
  const v = VERDICT[o.verdict];
  const used = Math.min(o.open_hours / (o.weekly_hours || 40), 1);
  return (
    <button onClick={onPick} style={{
      textAlign: 'left', padding: 12, borderRadius: 14, cursor: 'pointer', background: theme.colors.card, fontFamily: 'inherit',
      border: `2px solid ${selected ? theme.colors.ink : theme.colors.track}`, display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Avatar name={o.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: theme.colors.ink }}>{o.name}</div>
          <div style={{ fontSize: 11, color: theme.colors.grey }}>Fit {Math.round(o.fit)}{o.low_confidence && ' · low confidence'}</div>
        </div>
        {mode === 'reassign' && <Pill color={v.color} solid>{v.label}</Pill>}
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: theme.colors.grey, marginBottom: 3 }}>
          <span>{o.open_hours}h booked of {o.weekly_hours}h</span>
          <span style={{ color: o.free_hours > 0 ? theme.colors.sage : theme.colors.red, fontWeight: 600 }}>{o.free_hours}h free</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: theme.colors.track }}>
          <div style={{ width: `${used * 100}%`, height: '100%', borderRadius: 3,
            background: used >= 0.9 ? theme.colors.red : used >= 0.6 ? theme.colors.sand : theme.colors.sage }} />
        </div>
      </div>
      {mode === 'reassign' && (
        <div style={{ fontSize: 12, color: theme.colors.ink }}>
          If moved: <strong style={{ color: o.p_miss_if_moved >= 0.5 ? theme.colors.red : o.p_miss_if_moved >= 0.3 ? theme.colors.sand : theme.colors.sage }}>
            {pct(o.p_miss_if_moved)} miss</strong>
        </div>
      )}
      {o.leave_days.length > 0 && (
        <div style={{ fontSize: 11, color: theme.colors.accent, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <CalendarOff size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>On leave {o.leave_days.map(d => fmtDate(d)).join(', ')}</span>
        </div>
      )}
      {mode === 'reassign' && (
        <div style={{ fontSize: 11, color: theme.colors.grey, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          {(o.verdict === 'harms' || o.verdict === 'no') && <AlertTriangle size={12} color={v.color} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{o.verdict_note}</span>
        </div>
      )}
    </button>
  );
}
