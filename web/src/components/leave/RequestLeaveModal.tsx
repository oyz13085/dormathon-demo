import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CheckCircle, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { theme } from '../../theme';
import type { WhatIf } from '../../api/types';
import { useSession } from '../../session';
import { previewLeave, reassignTicket, submitLeave, type Suggestion, type Suggestions } from '../../api/leaveAdvisor';
import { Button, Field, Grid, Modal, Notice, Pill, PRIORITY_COLOR, fmtDate, initials, inputStyle } from '../ui';

function nextWeek(): [string, string] {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return [monday.toISOString().slice(0, 10), friday.toISOString().slice(0, 10)];
}

const URGENCY = ['Critical', 'High', 'Medium', 'Low'];
const rank = (p: string) => (URGENCY.includes(p) ? URGENCY.indexOf(p) : 9);

type Row =
  | { kind: 'open'; t: Suggestion }
  | { kind: 'done'; h: Suggestions['reassigned'][number] };

// Request leave with the AI Leave & Reassignment Planner. Each ticket is handled on its own: Reassign hands it to the
// recommended colleague now (after confirmation, through POST /leave-advisor/reassign); Keep changes nothing. Sending
// the leave request is separate, and the Team Lead still approves the leave.
export function RequestLeaveModal({ analystId, onClose, onDone, onChanged }: {
  analystId: number; onClose: () => void; onDone: (w: WhatIf) => void; onChanged?: () => void;
}) {
  const { user } = useSession();
  const [start, setStart] = useState(() => nextWeek()[0]);
  const [end, setEnd] = useState(() => nextWeek()[1]);
  const [reason, setReason] = useState('Annual leave');
  const [got, setGot] = useState<{ key: string; result?: Suggestions; error?: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = useMemo(() => ({ analyst_id: analystId, start_date: start, end_date: end }), [analystId, start, end]);
  const key = JSON.stringify(input);
  const datesOk = !!start && !!end && start <= end;

  // Debounced, and the backend caches by analyst, dates and data, so the AI isn't called on every change
  useEffect(() => {
    if (!datesOk) return;
    let live = true;
    const timer = setTimeout(() => {
      previewLeave(JSON.parse(key))
        .then(result => { if (live) setGot({ key, result }); })
        .catch(e => { if (live) setGot({ key, error: (e as Error).message }); });
    }, 700);
    return () => { live = false; clearTimeout(timer); };
  }, [key, datesOk]);

  const loading = datesOk && got?.key !== key;
  const r = got?.key === key ? got.result : undefined;

  // Open tickets and tickets already handed over, together in urgency order (most urgent first)
  const rows: Row[] = r?.valid ? [
    ...r.tickets.map(t => ({ kind: 'open' as const, t })),
    ...r.reassigned.map(h => ({ kind: 'done' as const, h })),
  ].sort((a, b) => {
    const pa = a.kind === 'open' ? a.t.priority : a.h.priority, pb = b.kind === 'open' ? b.t.priority : b.h.priority;
    const da = a.kind === 'open' ? a.t.deadline : a.h.deadline, db = b.kind === 'open' ? b.t.deadline : b.h.deadline;
    return rank(pa) - rank(pb) || da.localeCompare(db);
  }) : [];

  async function reassign(t: Suggestion) {
    if (!t.recommended) return;
    setBusy(t.ticket_id); setError(null); setDone(null);
    try {
      const out = await reassignTicket({ ...input, ticket_id: t.ticket_id, to_analyst_id: t.recommended.id, user });
      setGot({ key, result: out.suggestions });              // recalculated by the backend after the change
      setDone(`Ticket #${t.ticket_id} is now assigned to ${out.ticket.assignee_name}.`);
      setConfirming(null);
      onChanged?.();                                          // refresh the queue and workload on the page
    } catch (e) {
      setError(`Ticket #${t.ticket_id} wasn't reassigned: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setSending(true); setError(null);
    try {
      const out = await submitLeave({ ...input, reason, choices: {} });
      onDone(out.whatif);
    } catch (e) { setError((e as Error).message); setSending(false); }
  }

  const s = r?.stats;
  return (
    <Modal title="Request leave" onClose={onClose} width={620}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Grid cols="1fr 1fr">
          <Field label="From"><input type="date" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} /></Field>
          <Field label="To"><input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inputStyle} /></Field>
        </Grid>
        <Field label="Reason"><input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} /></Field>

        <section aria-live="polite" aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Sparkles size={15} color={theme.colors.accent} aria-hidden="true" />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, flex: 1 }}>AI Leave &amp; Reassignment Planner</h3>
              {r?.valid && r.source === 'ai' && (
                <span title={r.ai?.request_ids.join(', ')}><Pill color={theme.colors.accent}>AI · {r.ai?.model ?? r.ai?.provider}</Pill></span>
              )}
              {r?.valid && r.source === 'rule_based' && <Pill color={theme.colors.sand}>Rule-based fallback</Pill>}
            </span>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: theme.colors.grey }}>
              Tickets ranked by urgency · Select a ticket to manage its handover
            </p>
            {r?.valid && r.source === 'rule_based' && r.ai?.status === 'unavailable' && r.ai.reason && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: theme.colors.grey }}>AI unavailable: {r.ai.reason}</p>
            )}
          </div>

          {!datesOk ? <Notice tone="error">The leave ends before it starts.</Notice>
            : got?.key === key && got.error ? <Notice tone="error">Couldn't check your tickets: {got.error}</Notice>
            : !r ? <p style={{ margin: 0, fontSize: 13, color: theme.colors.grey }}>Checking which tickets are affected…</p>
            : !r.valid ? <Notice tone="error">{r.errors.join(' ')}</Notice>
            : (
              <>
                {r.warnings.map(w => <Notice key={w} tone="warn">{w}</Notice>)}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  <StatCard label="Affected tickets" value={String((s?.affected ?? 0) + (s?.reassigned ?? 0))}
                    sub={s?.reassigned ? `${s.reassigned} handed over` : undefined} />
                  <StatCard label="Urgent handovers" value={String(s?.urgent_handovers ?? 0)} sub="Critical or High"
                    tone={s?.urgent_handovers ? theme.colors.red : undefined} />
                  <StatCard label="Extra workload" value={`${s?.extra_team_hours ?? 0}h`}
                    sub={Object.entries(s?.extra_hours_by_colleague ?? {}).map(([n, h]) => `${n} +${h}h`).join(', ') || 'None'} />
                </div>

                {done && <Notice tone="ok">{done}</Notice>}

                <h4 style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 700 }}>Tickets ranked by urgency</h4>
                {rows.length === 0
                  ? <Notice tone="ok">No tickets require handover for these leave dates.</Notice>
                  : (
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {rows.map((row, i) => row.kind === 'open' ? (
                        <li key={row.t.ticket_id}>
                          <TicketCard rank={i + 1} t={row.t} open={open === row.t.ticket_id}
                            confirming={confirming === row.t.ticket_id} busy={busy === row.t.ticket_id} disabled={busy !== null}
                            onToggle={() => setOpen(o => (o === row.t.ticket_id ? null : row.t.ticket_id))}
                            onKeep={() => { setConfirming(null); setOpen(null); }}
                            onReassign={() => setConfirming(row.t.ticket_id)} onCancel={() => setConfirming(null)}
                            onConfirm={() => reassign(row.t)} />
                        </li>
                      ) : (
                        <li key={`done-${row.h.ticket_id}`}>
                          <div style={card}>
                            <CardRows rank={i + 1} priority={row.h.priority} id={row.h.ticket_id} title={row.h.title}
                              status={<>Due {fmtDate(row.h.deadline)} · Reassigned to {row.h.to.name}</>} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
              </>
            )}
        </section>

        <p style={{ margin: 0, fontSize: 12, color: theme.colors.grey }}>
          Reassign hands a ticket over straight away. Sending the leave request is separate; your Team Lead approves the leave.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={send} disabled={sending || loading || busy !== null || !r?.valid}>{sending ? 'Sending…' : 'Send leave request'}</Button>
          <Button variant="ghost" onClick={onClose} disabled={sending || busy !== null}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 14, background: theme.colors.background + '80', minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 11, color: theme.colors.grey }}>{label}</span>
      <span style={{ display: 'block', fontSize: 20, fontWeight: 700, color: tone ?? theme.colors.ink }}>{value}</span>
      {sub && <span style={{ display: 'block', fontSize: 11, color: theme.colors.grey, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
    </div>
  );
}

const card: React.CSSProperties = {
  background: theme.colors.card, border: `1px solid ${theme.colors.track}`, borderRadius: 16, overflow: 'hidden',
};

// Collapsed rows: "#1  [Medium]  Ticket #314" / title / "Due Fri 23 Oct · Kept"
function CardRows({ rank, priority, id, title, status, chevron, open }: {
  rank: number; priority: string; id: number; title: string; status: React.ReactNode; chevron?: boolean; open?: boolean;
}) {
  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.colors.grey, minWidth: 24 }}>#{rank}</span>
        <Pill color={PRIORITY_COLOR[priority]}>{priority}</Pill>
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.colors.ink, flex: 1 }}>Ticket #{id}</span>
        {chevron && (open ? <ChevronDown size={18} color={theme.colors.grey} aria-hidden="true" />
          : <ChevronRight size={18} color={theme.colors.grey} aria-hidden="true" />)}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.ink }}>{title}</div>
      <div style={{ fontSize: 12, color: theme.colors.grey }}>{status}</div>
    </div>
  );
}

function TicketCard({ rank, t, open, confirming, busy, disabled, onToggle, onKeep, onReassign, onCancel, onConfirm }: {
  rank: number; t: Suggestion; open: boolean; confirming: boolean; busy: boolean; disabled: boolean;
  onToggle: () => void; onKeep: () => void; onReassign: () => void; onCancel: () => void; onConfirm: () => void;
}) {
  const rec = t.recommended;
  const id = `leave-ticket-${t.ticket_id}`;
  const small = { fontSize: 11, color: theme.colors.grey, fontWeight: 500 } as const;
  return (
    <div style={card}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} style={{
        display: 'block', width: '100%', padding: 0, background: 'none', border: 'none', textAlign: 'left',
        font: 'inherit', color: theme.colors.ink, cursor: 'pointer',
      }}>
        <CardRows rank={rank} priority={t.priority} id={t.ticket_id} title={t.title} chevron open={open}
          status={<>Due {fmtDate(t.deadline)} · Kept</>} />
      </button>

      {open && (
        <div id={id} style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: theme.colors.background, borderRadius: 14, padding: 16,
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
              <div style={small}>Recommended analyst</div>
              {rec ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', background: theme.colors.accent, color: '#fff',
                    fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {initials(rec.name)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: theme.colors.ink }}>{rec.name}</span>
                    <span style={{ display: 'block', fontSize: 12, color: theme.colors.grey }}>{rec.role ?? '—'}</span>
                  </span>
                </div>
              ) : <div style={{ marginTop: 8, fontSize: 14, color: theme.colors.grey }}>Unavailable</div>}
            </div>

            <div style={{ flex: '0 0 auto' }}>
              <div style={small}>Compatibility</div>
              <div style={{ marginTop: 4, fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: rec && t.suitability?.score != null ? theme.colors.sage : theme.colors.grey }}>
                {rec && t.suitability?.score != null ? `${t.suitability.score}%` : '—'}
              </div>
            </div>

            <div style={{ flex: '1 1 200px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <DeadlineCard label="Current deadline" value={fmtDate(t.deadline)} />
              <DeadlineCard label="Suggested deadline" value={t.suggested_deadline ? fmtDate(t.suggested_deadline) : '—'} />
            </div>
          </div>

          {confirming && rec ? (
            <div role="alertdialog" aria-label="Confirm reassignment" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
              <span style={{ flex: '1 1 220px' }}>Reassign <strong>{t.title}</strong> to <strong>{rec.name}</strong>?</span>
              <PillButton dark onClick={onConfirm} disabled={busy}>{busy ? 'Reassigning…' : 'Confirm'}</PillButton>
              <PillButton onClick={onCancel} disabled={busy}>Cancel</PillButton>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <PillButton dark onClick={onKeep} disabled={disabled}><CheckCircle size={15} aria-hidden="true" /> Keep my ticket</PillButton>
              <PillButton onClick={onReassign} disabled={!rec || disabled}><ArrowLeftRight size={15} aria-hidden="true" /> Reassign</PillButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeadlineCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: theme.colors.card, borderRadius: 12, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: theme.colors.grey, fontWeight: 500 }}>{label}</div>
      <div style={{ marginTop: 2, fontSize: 14, fontWeight: 700, color: theme.colors.ink }}>{value}</div>
    </div>
  );
}

function PillButton({ dark, onClick, disabled, children }: {
  dark?: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: theme.radius.pill,
      border: dark ? `1.5px solid ${theme.colors.ink}` : `1.5px solid ${theme.colors.track}`,
      background: dark ? theme.colors.ink : theme.colors.card, color: dark ? '#fff' : theme.colors.ink,
      fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
    }}>
      {children}
    </button>
  );
}
