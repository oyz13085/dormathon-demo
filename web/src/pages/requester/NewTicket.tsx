import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Sparkles, BookOpen } from 'lucide-react';
import { theme } from '../../theme';
import { api } from '../../api/client';
import type { Dept, Priority, Suggestion, Ticket } from '../../api/types';
import { useSession } from '../../session';
import { Button, Card, Field, Grid, Notice, Pill, PRIORITY_COLOR, fmtDate, inputStyle } from '../../components/ui';

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Critical'];

function defaultDeadline(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
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
  const [assignToSuggested, setAssignToSuggested] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Ticket | null>(null);

  useEffect(() => { setDivision(myDivision); }, [myDivision]);

  // Ask for suggestions once there's enough to go on
  useEffect(() => {
    if (title.trim().length < 6 || !division || !deadline) { setSuggestion(null); return; }
    const timer = setTimeout(() => {
      setThinking(true);
      api.post<Suggestion>('/tickets/suggest', { title, division, deadline, description, requester: user })
        .then(s => { setSuggestion(s); setPriority(s.priority); setError(null); })
        .catch(e => setError(e.message))
        .finally(() => setThinking(false));
    }, 700);
    return () => clearTimeout(timer);
  }, [title, division, deadline, description, user]);

  const rec = suggestion?.recommendation;
  const canAutoAssign = !!rec?.recommended && suggestion?.confidence === 'High';

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
    <Grid cols="minmax(0,1fr) 360px">
      <Card title="New request">
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
          <Grid cols="1fr 1fr">
            <Field label="Requesting department">
              <select value={division} onChange={e => setDivision(e.target.value as Dept)} style={inputStyle}>
                <option value="">Select…</option>
                {(meta?.departments ?? []).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Deadline">
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} style={inputStyle} />
            </Field>
          </Grid>
          <Field label="Description" hint="What do you need, which data, and what will you do with the answer?">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5}
              style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
          <Field label="Priority" hint={suggestion ? `Suggested: ${suggestion.priority}. You can change it; the team lead has the final say.` : 'Filled in from the suggestion'}>
            <select value={priority} onChange={e => setPriority(e.target.value as Priority)} style={inputStyle}>
              <option value="">Select…</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}{suggestion?.priority === p ? ' (suggested)' : ''}</option>)}
            </select>
          </Field>
          {canAutoAssign && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={assignToSuggested} onChange={e => setAssignToSuggested(e.target.checked)} />
              Assign to {rec!.recommended!.name} straight away
            </label>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <div><Button onClick={submit}><Send size={14} /> Submit request</Button></div>
        </div>
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
        <Card title="AI suggestions" icon={Sparkles} iconColor={theme.colors.accent}
          right={suggestion && <Pill>{suggestion.priority_method === 'llm' ? `LLM · ${meta?.llm.model}` : 'rule-based'}</Pill>}>
          {!suggestion && (
            <p style={{ margin: 0, fontSize: 13, color: theme.colors.grey }}>
              {thinking ? 'Thinking…' : 'Fill in the title, department and deadline to see a suggested priority, estimated hours and assignee.'}
            </p>
          )}
          {suggestion && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
              <div>
                <Label>Suggested priority</Label>
                <span style={{ fontWeight: 700, color: PRIORITY_COLOR[suggestion.priority] }}>{suggestion.priority}</span>
                <p style={{ margin: '4px 0 0', color: theme.colors.ink }}>{suggestion.priority_reason}</p>
              </div>
              <div>
                <Label>Estimated hours</Label>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{suggestion.hours.likely}h</span>
                <span style={{ color: theme.colors.grey }}> (range {suggestion.hours.low}–{suggestion.hours.high}h)</span>
                <p style={{ margin: '2px 0 0', color: theme.colors.grey, fontSize: 12 }}>Type: {suggestion.category}</p>
              </div>
              <div>
                <Label>Assignee</Label>
                {rec?.decision === 'low_confidence' ? (
                  <Notice tone="warn">This looks like a new type of request, so FairQueue won't guess. The team lead will pick an analyst.</Notice>
                ) : rec?.recommended ? (
                  <>
                    <strong>{rec.recommended.name}</strong>
                    <p style={{ margin: '2px 0 0', color: theme.colors.grey, fontSize: 12 }}>{rec.recommended.explanation}</p>
                    {rec.decision === 'poor' && rec.usual_partner && (
                      <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                        Your usual partner {rec.usual_partner.name}: {rec.usual_partner.explanation}
                      </p>
                    )}
                    {rec.note && <p style={{ margin: '6px 0 0', fontSize: 12, color: theme.colors.ink }}>{rec.note}</p>}
                  </>
                ) : <span style={{ color: theme.colors.grey }}>No suggestion</span>}
              </div>
            </div>
          )}
        </Card>

        {suggestion && suggestion.similar_work.length > 0 && (
          <Card title="This may already be answered" icon={BookOpen} iconColor={theme.colors.sage}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {suggestion.similar_work.map(w => (
                <div key={w.deliverable_id} style={{ fontSize: 13 }}>
                  <a href={api.fileUrl(w.deliverable_id)} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: theme.colors.ink }}>
                    {w.title}
                  </a>
                  <span style={{ color: theme.colors.grey }}>, delivered {fmtDate(w.delivered_on)}</span>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: theme.colors.grey }}>{w.summary}</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Grid>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ display: 'block', fontSize: 11, color: theme.colors.grey, marginBottom: 4 }}>{children}</span>;
}
