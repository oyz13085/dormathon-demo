import { useState } from 'react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Deliverable, Feedback, SkillAdjustment } from '../../api/types';
import { useApi, useSession } from '../../session';
import { Button, Card, Empty, Field, Grid, Loading, Notice, Pill, Table, fmtDate, inputStyle, td } from '../../components/ui';
import { DeliverableBody } from '../requester/CompletedWork';
import { RevisionDetailsModal } from '../../components/RevisionDetailsModal';

export default function MyWork() {
  const { user, analystId, meta } = useSession();
  const work = useApi<Deliverable[]>(`/deliverables/${qs({ role: 'analyst', user })}`);
  const feedback = useApi<Feedback[]>(`/feedback/${qs({ role: 'analyst', user })}`);
  const flags = useApi<SkillAdjustment[]>(analystId ? `/assignment/skills${qs({ analyst_id: analystId })}` : null);
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [revisionFor, setRevisionFor] = useState<Deliverable | null>(null);

  async function flag() {
    try {
      await api.post('/assignment/skills', { analyst_id: analystId, category, adjustment: 0.15, reason, set_by: user, role: 'analyst' });
      setMsg(`Sent to the team lead: you're comfortable with ${category} tickets.`);
      setCategory(''); setReason('');
      flags.reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <Grid cols="minmax(0,1fr) 380px">
      <Card title="My completed work" right={<span style={{ fontSize: 12, color: theme.colors.grey }}>Useful for reviews and for handing over before leave</span>}>
        {!work.data ? <Loading error={work.error} /> : work.data.length === 0 ? <Empty>Nothing delivered yet.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {work.data.map(d => (
              <div key={d.id} style={{ paddingBottom: 12, borderBottom: `1px solid ${theme.colors.track}` }}>
                <DeliverableBody d={d} />
                {d.requester_rating && (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Pill color={d.requester_rating === 'Useful' ? theme.colors.sage : theme.colors.red}>
                      Requester: {d.requester_rating}{d.revision_note ? `: ${d.revision_note}` : ''}
                    </Pill>
                    {d.requester_rating === 'Needs revision' && (
                      <Button small variant="outline" onClick={() => setRevisionFor(d)}>View Revision Details</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
        <Card title="My feedback on estimates">
          {!feedback.data ? <Loading error={feedback.error} /> : feedback.data.length === 0 ? <Empty>No feedback yet.</Empty> : (
            <Table head={['Ticket', 'Estimate', 'Actual', 'Rating']}>
              {feedback.data.map(f => (
                <tr key={f.id}>
                  <td style={td}>{f.title}</td>
                  <td style={td}>{f.pred_likely ?? '—'}h</td>
                  <td style={td}>{f.actual_hours ?? '—'}h</td>
                  <td style={td}>{f.estimate_rating ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="I'm comfortable with this type">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12, color: theme.colors.grey }}>
              Raise your skill for a ticket type, e.g. after training. The team lead approves it before it changes your fit.
            </p>
            <Field label="Ticket type">
              <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
                <option value="">Select…</option>
                {(meta?.categories ?? []).map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Why"><input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} /></Field>
            <div><Button disabled={!category} onClick={flag}>Send to lead</Button></div>
            {msg && <Notice tone="ok">{msg}</Notice>}
            {(flags.data ?? []).map(f => (
              <div key={f.id} style={{ fontSize: 12 }}>
                {f.category} {f.adjustment > 0 ? '+' : ''}{f.adjustment} · {f.approved ? <Pill color={theme.colors.sage}>approved</Pill> : <Pill color={theme.colors.sand}>waiting for lead</Pill>}
                <span style={{ color: theme.colors.grey }}> {fmtDate(f.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      {revisionFor && <RevisionDetailsModal deliverable={revisionFor} user={user} onClose={() => setRevisionFor(null)} />}
    </Grid>
  );
}
