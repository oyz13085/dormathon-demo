import { useState } from 'react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Deliverable, Dept, Feedback } from '../../api/types';
import { useApi, useSession } from '../../session';
import { DeliverableBody } from '../requester/CompletedWork';
import { Button, Card, Empty, Field, Grid, Loading, Pill, Table, fmtDate, inputStyle, td } from '../../components/ui';

export default function Library() {
  const { meta } = useSession();
  const [q, setQ] = useState('');
  const [division, setDivision] = useState<Dept | ''>('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const lib = useApi<Deliverable[]>(`/deliverables/${qs({ role: 'lead', q, division, category, date_from: from, date_to: to })}`);
  const stats = useApi<{ revisions_by_category: { category: string; delivered: number; revisions: number }[] }>('/deliverables/stats');
  const feedback = useApi<Feedback[]>(`/feedback/${qs({ role: 'lead' })}`);
  const under = useApi<{ category: string; n_closed: number; actual_over_estimate: number; too_low_votes: number }[]>('/prediction/underestimated');
  const [retrain, setRetrain] = useState<string | null>(null);

  return (
    <Grid cols="minmax(0,1.4fr) minmax(0,1fr)">
      <Card title="Deliverables library">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
          <Field label="Search"><input value={q} onChange={e => setQ(e.target.value)} placeholder="title or summary" style={inputStyle} /></Field>
          <Field label="Department">
            <select value={division} onChange={e => setDivision(e.target.value as Dept)} style={inputStyle}>
              <option value="">All</option>{(meta?.departments ?? []).map(d => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
              <option value="">All</option>{(meta?.categories ?? []).map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} /></Field>
          <Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} /></Field>
        </div>
        {!lib.data ? <Loading error={lib.error} /> : lib.data.length === 0 ? <Empty>No deliverables match.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {lib.data.map(d => (
              <div key={d.id} style={{ paddingBottom: 12, borderBottom: `1px solid ${theme.colors.track}` }}>
                <DeliverableBody d={d} />
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Pill>{d.category}</Pill><Pill>for {d.requester}</Pill>
                  {d.requester_rating && <Pill color={d.requester_rating === 'Useful' ? theme.colors.sage : theme.colors.red}>{d.requester_rating}</Pill>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
        <Card title="Quality check: rework by ticket type">
          {!stats.data ? <Loading error={stats.error} /> : (
            <Table head={['Type', 'Delivered', 'Needs revision']}>
              {stats.data.revisions_by_category.map(r => (
                <tr key={r.category}><td style={td}>{r.category}</td><td style={td}>{r.delivered}</td>
                  <td style={{ ...td, color: r.revisions ? theme.colors.red : undefined, fontWeight: r.revisions ? 700 : 400 }}>{r.revisions}</td></tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Regularly underestimated types" right={
          <Button small variant="outline" onClick={async () => {
            setRetrain('Retraining…');
            try {
              const r = await api.post<{ hours: { mae_model: number; mae_category_median: number }; live_tickets_added: number }>('/prediction/retrain', {});
              setRetrain(`Retrained with ${r.live_tickets_added} live closed tickets. Hours error ${r.hours.mae_model}h vs ${r.hours.mae_category_median}h baseline.`);
            } catch (e) { setRetrain((e as Error).message); }
          }}>Retrain with feedback</Button>}>
          {retrain && <p style={{ marginTop: 0, fontSize: 12 }}>{retrain}</p>}
          {!under.data ? <Loading error={under.error} /> : (
            <Table head={['Type', 'Closed', 'Actual ÷ estimate', '"Too low" votes']}>
              {under.data.map(r => (
                <tr key={r.category}><td style={td}>{r.category}</td><td style={td}>{r.n_closed}</td>
                  <td style={{ ...td, color: r.actual_over_estimate > 1.15 ? theme.colors.red : undefined }}>{r.actual_over_estimate}×</td>
                  <td style={td}>{r.too_low_votes}</td></tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="All feedback">
          {!feedback.data ? <Loading error={feedback.error} /> : feedback.data.length === 0 ? <Empty>No feedback yet.</Empty> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              {feedback.data.map(f => (
                <div key={f.id}>
                  <strong>{f.title}</strong> <span style={{ color: theme.colors.grey }}>({f.category}) · {fmtDate(f.created_at)}</span>
                  <div>Estimate {f.pred_likely ?? '—'}h, actual {f.actual_hours ?? '—'}h: <em>{f.estimate_rating ?? 'no rating'}</em>
                    {f.better_suited_name && <> · better suited: {f.better_suited_name}</>}</div>
                  {f.comment && <div style={{ color: theme.colors.grey }}>{f.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Grid>
  );
}
