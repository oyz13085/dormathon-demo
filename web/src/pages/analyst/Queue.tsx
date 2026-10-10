import { useState } from 'react';
import { CalendarDays, Play, Pause, CheckCircle } from 'lucide-react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Leave, Ticket, Workload } from '../../api/types';
import { useApi, useSession } from '../../session';
import { HalfDonutGauge } from '../../components/HalfDonutGauge';
import { TicketCards } from '../../components/TicketCards';
import { RequestLeaveModal } from '../../components/leave/RequestLeaveModal';
import { Button, Card, Field, Grid, Loading, Modal, Notice, Pill, fmtDate, inputStyle } from '../../components/ui';

export default function Queue() {
  const { user, analystId, meta, refresh } = useSession();
  const tickets = useApi<Ticket[]>(`/tickets/${qs({ role: 'analyst', user })}`);
  const workload = useApi<Workload[]>(`/assignment/workload${qs({ role: 'analyst', user })}`);
  const leave = useApi<Leave[]>(`/planning/leave${qs({ role: 'analyst', user })}`);
  const [closing, setClosing] = useState<Ticket | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const mine = (tickets.data ?? []).filter(t => t.relation === 'assigned');
  const open = mine.filter(t => t.status !== 'Closed');
  const atRisk = open.filter(t => t.alert).length;
  const w = workload.data?.[0];

  async function move(t: Ticket, status: 'In progress' | 'Waiting') {
    try {
      await api.patch(`/tickets/${t.id}/status`, { status, by: user });
      refresh();
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
      <Grid cols="minmax(0,1fr) 260px">
        <Card>
          <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>Hello, {user}</h2>
          <p style={{ margin: 0, fontSize: 13, color: theme.colors.grey }}>
            You have <strong style={{ color: theme.colors.ink }}>{open.length} open tickets</strong>
            {w && <> worth about <strong style={{ color: theme.colors.ink }}>{w.open_hours}h</strong></>}
            {atRisk > 0 && <> · <strong style={{ color: theme.colors.red }}>{atRisk} at risk of missing the deadline</strong></>}.
          </p>
          <div style={{ marginTop: 14 }}>
            <Button variant="outline" onClick={() => setLeaveOpen(true)}><CalendarDays size={14} /> Request leave</Button>
          </div>
          {(leave.data ?? []).length > 0 && (
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
              {leave.data!.map(l => (
                <Pill key={l.id} color={l.status === 'Approved' ? theme.colors.sage : l.status === 'Rejected' ? theme.colors.red : theme.colors.sand}>
                  Leave {fmtDate(l.start_date)}–{fmtDate(l.end_date)}: {l.status}
                </Pill>
              ))}
            </div>
          )}
        </Card>
        <Card style={{ display: 'flex', justifyContent: 'center' }}>
          {w ? <HalfDonutGauge percent={Math.min(100, Math.round(100 * w.open_hours / w.weekly_hours))}
            label={`${w.open_hours}h of ${w.weekly_hours}h this week`} size={80} /> : <Loading error={workload.error} />}
        </Card>
      </Grid>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title="My queue">
        {!tickets.data ? <Loading error={tickets.error} /> : (
          <TicketCards tickets={mine} tabs={['Open', 'In progress', 'Waiting', 'Closed', 'All']}
            actions={t => (
              <span style={{ display: 'flex', gap: 6 }}>
                {t.status === 'Assigned' && <Button small variant="ghost" onClick={() => move(t, 'In progress')}><Play size={11} /> Start</Button>}
                {t.status === 'In progress' && <Button small variant="ghost" onClick={() => move(t, 'Waiting')} title="Waiting for the requester: this time isn't counted as effort"><Pause size={11} /> Waiting</Button>}
                {t.status === 'Waiting' && <Button small variant="ghost" onClick={() => move(t, 'In progress')}><Play size={11} /> Resume</Button>}
                {['Assigned', 'In progress', 'Waiting'].includes(t.status) && <Button small onClick={() => setClosing(t)}><CheckCircle size={11} /> Close</Button>}
              </span>
            )} />
        )}
      </Card>

      {closing && analystId && (
        <CloseTicket ticket={closing} analystId={analystId} analysts={meta?.analysts ?? []}
          onClose={() => setClosing(null)}
          onDone={text => { setClosing(null); setMsg({ tone: 'ok', text }); refresh(); }} />
      )}
      {leaveOpen && analystId && (
        <RequestLeaveModal analystId={analystId} onClose={() => setLeaveOpen(false)} onChanged={refresh}
          onDone={w => { setLeaveOpen(false); setMsg({ tone: 'ok', text: `Leave requested. The team lead sees the impact: ${w.summary}` }); refresh(); }} />
      )}
    </div>
  );
}

function CloseTicket({ ticket, analystId, analysts, onClose, onDone }: {
  ticket: Ticket; analystId: number; analysts: { id: number; name: string }[];
  onClose: () => void; onDone: (msg: string) => void;
}) {
  const [kind, setKind] = useState<'File' | 'Link' | 'None'>('File');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [actual, setActual] = useState(String(ticket.pred_likely ?? ''));
  const [rating, setRating] = useState('');
  const [better, setBetter] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const f = new FormData();
    f.set('analyst_id', String(analystId));
    f.set('actual_hours', actual || '0');
    f.set('kind', kind);
    f.set('summary', summary);
    if (title) f.set('title', title);
    if (kind === 'Link') f.set('url', url);
    if (kind === 'File' && file) f.set('file', file);
    if (rating) f.set('estimate_rating', rating);
    if (better) f.set('better_suited_id', better);
    if (comment) f.set('comment', comment);
    setBusy(true);
    try {
      await api.postForm(`/tickets/${ticket.id}/close`, f);
      onDone(`Closed "${ticket.title}". The requester can now open it under My completed work.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Close: ${ticket.title}`} onClose={onClose} width={620}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="What are you handing back?">
          <div style={{ display: 'flex', gap: 8 }}>
            {(['File', 'Link', 'None'] as const).map(k => (
              <Button key={k} small variant={kind === k ? 'primary' : 'ghost'} onClick={() => setKind(k)}>
                {k === 'None' ? 'No deliverable' : k}
              </Button>
            ))}
          </div>
        </Field>
        {kind === 'File' && (
          <Field label="File" hint="PDF, Excel/CSV, PowerPoint or chart image">
            <input type="file" accept=".pdf,.xlsx,.xls,.csv,.pptx,.png,.jpg,.jpeg,.docx,.ipynb"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        )}
        {kind === 'Link' && (
          <Field label="Link" hint="Power BI, Tableau, Looker Studio, a shared notebook or a Drive folder">
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
          </Field>
        )}
        {kind !== 'None' && (
          <Field label="Title (optional)"><input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} /></Field>
        )}
        <Field label={kind === 'None' ? 'Why is there nothing to hand over?' : 'Summary'}
          hint={kind === 'None' ? 'One line, e.g. answered in the Monday meeting' : 'What was asked, what you found, and the recommended next step (2–3 sentences)'}>
          <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <Grid cols="1fr 1fr">
          <Field label="Actual hours spent" hint={`Estimate was ${ticket.pred_likely}h (${ticket.pred_low}–${ticket.pred_high})`}>
            <input type="number" min={0} step={0.5} value={actual} onChange={e => setActual(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Was the estimate right?">
            <select value={rating} onChange={e => setRating(e.target.value)} style={inputStyle}>
              <option value="">Skip</option><option>Too low</option><option>About right</option><option>Too high</option>
            </select>
          </Field>
        </Grid>
        <Field label="Would someone else have been better suited for this type of ticket?" hint="About fit for the ticket type, never a rating of a person">
          <select value={better} onChange={e => setBetter(e.target.value)} style={inputStyle}>
            <option value="">No / skip</option>
            {analysts.filter(a => a.id !== analystId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Comment (optional)"><input value={comment} onChange={e => setComment(e.target.value)} style={inputStyle} /></Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={submit} disabled={busy}>{busy ? 'Closing…' : 'Close ticket'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
