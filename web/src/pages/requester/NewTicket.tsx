import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, Send, Sparkles } from 'lucide-react';
import { theme } from '../../theme';
import { api } from '../../api/client';
import type { Dept, Priority, Suggestion, Ticket } from '../../api/types';
import { useSession } from '../../session';
import { Button, Card, Field, Hint, Modal, Notice, PRIORITY_COLOR, Pill, fmtDate, inputStyle } from '../../components/ui';

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Critical'];

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

// Terracotta = predicted by the agent. Any manual pick turns the field white again.
function predictedStyle(active: boolean) {
  return active
    ? { ...inputStyle, borderColor: theme.colors.accent, background: theme.colors.accent + '14' }
    : inputStyle;
}

export default function NewTicket() {
  const { meta, user, role, refresh } = useSession();
  const myDivision = meta?.requesters.find(r => r.name === user)?.division ?? '';
  const [title, setTitle] = useState('');
  const [division, setDivision] = useState<Dept | ''>(myDivision);
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState(defaultDeadline());
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [thinking, setThinking] = useState(false);
  const [priority, setPriority] = useState<Priority | ''>('');
  const [deptTouched, setDeptTouched] = useState(false);
  const [priorityTouched, setPriorityTouched] = useState(false);
  const [assignToSuggested, setAssignToSuggested] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Ticket | null>(null);

  useEffect(() => { setDivision(myDivision); }, [myDivision]);
  // A new title means new predictions: manual picks stop applying.
  useEffect(() => { setDeptTouched(false); setPriorityTouched(false); }, [title]);

  // Ask for suggestions once there's enough to go on
  useEffect(() => {
    if (title.trim().length < 6 || !division || !deadline) { setSuggestion(null); return; }
    const timer = setTimeout(() => {
      setThinking(true);
      api.post<Suggestion>('/tickets/suggest', { title, division, deadline, description, requester: user })
        .then(s => {
          setSuggestion(s);
          if (!deptTouched && s.division) setDivision(s.division);
          if (!priorityTouched) setPriority(s.priority);
          setError(null);
        })
        .catch(e => setError(e.message))
        .finally(() => setThinking(false));
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, division, deadline, description, user]);

  const rec = suggestion?.recommendation;
  const canAutoAssign = !!rec?.recommended && suggestion?.confidence === 'High';
  const deptPredicted = !!suggestion && !deptTouched && !!division;

  async function submit() {
    if (!title.trim() || !division || !deadline || !priority) { setError('Fill in the title, department, deadline and priority.'); return; }
    setError(null);
    try {
      const t = await api.post<Ticket>('/tickets/', {
        title, division, deadline, description, requester: user, priority,
        category: suggestion?.category, suggested_priority: suggestion?.priority,
        assignee_id: canAutoAssign && assignToSuggested ? rec!.recommended!.analyst_id : undefined,
      });
      setCreated(t);
      setTitle(''); setDescription(''); setSuggestion(null); setPriority('');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const myTicketsPath = role === 'analyst' ? '/analyst/requested' : '/requester/tickets';

  return (
    <div className="fq-split" style={{ ['--side' as string]: '400px' }}>
      <Card title="New request" icon={FilePlus2} iconColor={theme.colors.accent}
        right={<Hint>Suggestions fill in as you type</Hint>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {created && (
            <Notice tone="ok">
              Ticket #{created.id} "{created.title}" submitted
              {created.assignee_name ? ` and assigned to ${created.assignee_name}` : ' and waiting for assignment'}.{' '}
              <Link to={myTicketsPath}>See my tickets</Link>
            </Notice>
          )}
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Monthly payroll variance report" style={inputStyle} />
          </Field>
          <div className="fq-cards-fit" style={{ ['--min' as string]: '200px', gap: 16 }}>
            <Field label="Requesting department" hint={deptPredicted ? 'Predicted — change it if wrong' : undefined}>
              <select value={division} onChange={e => { setDivision(e.target.value as Dept); setDeptTouched(true); }}
                style={predictedStyle(deptPredicted)}>
                <option value="">Select…</option>
                {(meta?.departments ?? []).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Deadline">
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <Field label="Description" hint="What do you need, which data, and what will you do with the answer?">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5}
              style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.grey }}>Priority</span>
            <div role="radiogroup" aria-label="Priority" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
              {PRIORITIES.map(p => {
                const on = priority === p;
                const suggested = suggestion?.priority === p;
                return (
                  <button key={p} role="radio" aria-checked={on} onClick={() => { setPriority(p); setPriorityTouched(true); }} style={{
                    padding: '9px 4px', borderRadius: 12, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    border: `1.5px solid ${on ? PRIORITY_COLOR[p] : suggested ? PRIORITY_COLOR[p] + '80' : theme.colors.track}`,
                    background: on ? PRIORITY_COLOR[p] : theme.colors.card, color: on ? '#fff' : theme.colors.ink,
                  }}>{p}{suggested && <Sparkles size={11} />}</button>
                );
              })}
            </div>
            <span style={{ fontSize: 11, color: theme.colors.grey }}>
              {suggestion ? `Suggested: ${suggestion.priority} (marked ✦). You can change it; the team lead has the final say.` : 'Filled in from the suggestion once you add a title'}
            </span>
          </div>
          {canAutoAssign && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={assignToSuggested} onChange={e => setAssignToSuggested(e.target.checked)}
                style={{ accentColor: theme.colors.ink, width: 15, height: 15 }} />
              Assign to {rec!.recommended!.name} straight away
            </label>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <div><Button onClick={submit}><Send size={14} /> Submit request</Button></div>
        </div>
      </Card>

      <Card title="AI suggestions" icon={Sparkles} iconColor={theme.colors.accent}
        right={!thinking && suggestion && <Pill color={suggestion.priority_method === 'llm' ? theme.colors.sage : theme.colors.grey}>
          {suggestion.priority_method === 'llm' ? meta?.llm.model ?? 'AI' : 'rule-based'}</Pill>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {thinking && <div className="fq-loadbar" role="status" aria-label="Reasoning in progress"><div /></div>}
          {!suggestion && (
            <p style={{ margin: 0, fontSize: 13, color: theme.colors.grey, lineHeight: 1.6 }}>
              {thinking ? 'Reading your request…' : 'Fill in the title, department and deadline to see the suggested priority, effort and analyst, with the reason for each.'}
            </p>
          )}
          {suggestion && (
            <>
              <Tile>
                <TileLabel>Priority</TileLabel>
                <p style={{ margin: 0, fontSize: 19, fontWeight: 800, color: PRIORITY_COLOR[suggestion.priority] }}>{suggestion.priority}</p>
                <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: theme.colors.ink }}>{cleanReason(suggestion.priority_reason)}</p>
              </Tile>
              <Tile>
                <TileLabel>Estimated effort</TileLabel>
                <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: theme.colors.ink }}>
                  {suggestion.hours.likely}h
                  <span style={{ fontSize: 12, fontWeight: 500, color: theme.colors.grey }}>
                    {' '}range {suggestion.hours.low}–{suggestion.hours.high}h{suggestion.category ? ` · ${suggestion.category}` : ''}
                  </span>
                </p>
              </Tile>
              {rec?.recommended ? (
                <MatchTile name={rec.recommended.name} fit={rec.recommended.fit}
                  explanation={rec.recommended.explanation}
                  breakdown={rec.recommended.breakdown} free={rec.recommended.free_hours ?? 0}
                  open={rec.recommended.open_hours ?? 0}
                  pastCat={rec.recommended.past_in_category ?? 0} pastReq={rec.recommended.past_with_requester ?? 0}
                  category={suggestion.category} user={user} />
              ) : rec?.decision === 'low_confidence' ? (
                <Tile>
                  <TileLabel>Assignee</TileLabel>
                  <Notice tone="warn">This looks like a new type of request, so FairQueue won't guess. The team lead will pick an analyst.</Notice>
                </Tile>
              ) : undefined}
              {rec?.decision === 'poor' && rec.usual_partner && (
                <Tile>
                  <TileLabel>Usual partner</TileLabel>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    <strong>{rec.usual_partner.name}</strong>
                    <span style={{ color: theme.colors.grey }}> — {rec.usual_partner.explanation}</span>
                  </p>
                </Tile>
              )}
              {rec?.note && <Tile><p style={{ margin: 0, fontSize: 13, color: theme.colors.ink }}>{rec.note}</p></Tile>}
              {suggestion.similar_work.length > 0 && (
                <Tile>
                  <TileLabel>Already answered?</TileLabel>
                  {suggestion.similar_work.map(w => (
                    <p key={w.deliverable_id} style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6 }}>
                      <a href={api.fileUrl(w.deliverable_id)} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: theme.colors.ink }}>
                        {w.title}
                      </a>
                      <span style={{ color: theme.colors.grey }}>, delivered {fmtDate(w.delivered_on)}</span>
                    </p>
                  ))}
                </Tile>
              )}
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

/** A grey section inside the suggestions card. */
function Tile({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '14px 16px', borderRadius: 14, background: theme.colors.background }}>{children}</div>;
}

function TileLabel({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: theme.colors.grey }}>{children}</p>;
}

function Bar({ label, display, pct }: { label: string; display: string; pct: number }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12, color: theme.colors.grey, width: 92, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 8, borderRadius: 99, background: theme.colors.track, minWidth: 0 }}>
        <div style={{ width: `${v}%`, height: '100%', borderRadius: 99, background: theme.colors.sage }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.ink, minWidth: 86, textAlign: 'right' }}>{display}</span>
    </div>
  );
}

function MatchTile({ name, fit, explanation, breakdown, free, open, pastCat, pastReq, category, user }: {
  name: string; fit: number; explanation: string; breakdown?: Record<string, number>;
  free: number; open: number; pastCat: number; pastReq: number; category: string; user: string;
}) {
  const [show, setShow] = useState(false);
  const [hover, setHover] = useState(false);
  const bd = breakdown ?? {};
  const pct = (k: string) => Math.round((bd[k] ?? 0) * 100);
  const total = Math.round(free + open);
  return (
    <>
      <article onClick={() => setShow(true)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="fq-lift"
        style={{ padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
          background: theme.colors.accent + '14',
          border: `1.5px solid ${hover ? theme.colors.accent : 'transparent'}`,
          transition: 'border-color 0.15s' }}>
        <TileLabel>Best match</TileLabel>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: theme.colors.ink, flex: 1 }}>{name}</p>
          <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: theme.colors.accent, lineHeight: 1 }}>{fit}%</p>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.65, color: theme.colors.ink }}>{explanation}</p>
      </article>
      {show && (
        <Modal title={`${name} · ${fit}% fit`} onClose={() => setShow(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 0 12px' }}>
            <Bar label="Availability" display={`${Math.round(free)}h free of ${total}h`} pct={total ? (free / total) * 100 : 0} />
            <Bar label="Skill" display={`${pct('skill')}`} pct={pct('skill')} />
            <Bar label="Track record" display={`${pct('track')}`} pct={pct('track')} />
            <Bar label="Pairing" display={`${pct('pairing')}`} pct={pct('pairing')} />
            <Bar label="Capacity" display={`${pct('capacity')}`} pct={pct('capacity')} />
            <Bar label="Deadline" display={`${pct('deadline')}`} pct={pct('deadline')} />
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: theme.colors.ink }}>
            {pastCat} {category} tickets closed before · {pastReq} for {user}
          </p>
        </Modal>
      )}
    </>
  );
}

function cleanReason(reason: string): string {
  return reason.replace(/^Rule-based:\s*/, '').replace(/\s+/g, ' ').trim();
}
