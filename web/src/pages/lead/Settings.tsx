import { useEffect, useState } from 'react';
import { theme } from '../../theme';
import { api } from '../../api/client';
import type { FitSettings, SkillAdjustment } from '../../api/types';
import { useApi, useSession } from '../../session';
import { Button, Card, Field, Grid, Loading, Notice, Pill, Table, fmtDate, inputStyle, td } from '../../components/ui';

const WEIGHTS: { key: keyof FitSettings; label: string; hint: string }[] = [
  { key: 'w_skill', label: 'Skill match', hint: 'past closed tickets of this type, plus declared skills' },
  { key: 'w_track', label: 'Track record on this type', hint: 'actual vs estimated hours, and few revisions' },
  { key: 'w_pairing', label: 'Pairing', hint: 'past tickets for this requester (capped)' },
  { key: 'w_capacity', label: 'Capacity', hint: 'free hours this week vs the high estimate' },
  { key: 'w_deadline', label: 'Deadline', hint: 'chance of finishing in time with their queue' },
];

export default function Settings() {
  const { meta, refresh } = useSession();
  const settings = useApi<FitSettings>('/assignment/settings');
  const skills = useApi<SkillAdjustment[]>('/assignment/skills');
  const [w, setW] = useState<FitSettings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [adj, setAdj] = useState({ analyst_id: '', category: '', adjustment: '0.1', reason: '' });

  useEffect(() => { if (settings.data) setW(settings.data); }, [settings.data]);
  if (!w) return <Card title="Fit settings"><Loading error={settings.error} /></Card>;

  const total = WEIGHTS.reduce((s, x) => s + Number(w[x.key]), 0);

  async function save() {
    try {
      await api.put('/assignment/settings', { ...w, updated_by: 'lead' });
      setMsg({ tone: 'ok', text: 'Saved. New recommendations and the replay use these settings.' });
      refresh();
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); }
  }

  async function addAdjustment() {
    try {
      await api.post('/assignment/skills', { analyst_id: Number(adj.analyst_id), category: adj.category,
        adjustment: Number(adj.adjustment), reason: adj.reason, set_by: 'lead', role: 'lead' });
      setAdj({ analyst_id: '', category: '', adjustment: '0.1', reason: '' });
      skills.reload();
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); }
  }

  return (
    <Grid cols="minmax(0,1fr) minmax(0,1fr)">
      <Card title="Fit score weights and thresholds">
        <p style={{ marginTop: 0, fontSize: 13, color: theme.colors.grey }}>
          Fit = 100 × (weighted parts). A team that values continuity can raise pairing; one with tight deadlines can raise deadline.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {WEIGHTS.map(x => (
            <Field key={x.key} label={`${x.label}: ${Number(w[x.key]).toFixed(2)}`} hint={x.hint}>
              <input type="range" min={0} max={0.6} step={0.05} value={Number(w[x.key])}
                onChange={e => setW({ ...w, [x.key]: Number(e.target.value) })} />
            </Field>
          ))}
          <p style={{ margin: 0, fontSize: 13, color: Math.abs(total - 1) > 0.01 ? theme.colors.red : theme.colors.sage }}>
            Weights add up to {total.toFixed(2)} {Math.abs(total - 1) > 0.01 ? '(must be 1.00)' : ''}
          </p>
          <Grid cols="1fr 1fr">
            <Field label={`Good fit at or above: ${w.good_fit}`} hint="assign to the usual partner, no extra step">
              <input type="range" min={40} max={95} step={1} value={w.good_fit} onChange={e => setW({ ...w, good_fit: Number(e.target.value) })} />
            </Field>
            <Field label={`Poor fit below: ${w.poor_fit}`} hint="recommend the best-fitting analyst instead">
              <input type="range" min={20} max={90} step={1} value={w.poor_fit} onChange={e => setW({ ...w, poor_fit: Number(e.target.value) })} />
            </Field>
          </Grid>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <div><Button onClick={save} disabled={Math.abs(total - 1) > 0.01}>Save settings</Button></div>
        </div>
      </Card>

      <Card title="Skill adjustments">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, alignItems: 'end' }}>
          <Field label="Analyst">
            <select value={adj.analyst_id} onChange={e => setAdj({ ...adj, analyst_id: e.target.value })} style={inputStyle}>
              <option value="">Select…</option>{(meta?.analysts ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Ticket type">
            <select value={adj.category} onChange={e => setAdj({ ...adj, category: e.target.value })} style={inputStyle}>
              <option value="">Select…</option>{(meta?.categories ?? []).map(c => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Change (0–1 scale)">
            <input type="number" step={0.05} min={-1} max={1} value={adj.adjustment} onChange={e => setAdj({ ...adj, adjustment: e.target.value })} style={inputStyle} />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}><Field label="Reason"><input value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} placeholder="e.g. finished the forecasting course" style={inputStyle} /></Field></div>
          <Button disabled={!adj.analyst_id || !adj.category || !adj.reason.trim()} onClick={addAdjustment}>Add</Button>
        </div>
        <div style={{ marginTop: 16 }}>
          {!skills.data ? <Loading error={skills.error} /> : (
            <Table head={['Analyst', 'Type', 'Change', 'Reason', 'Set by', 'Status']}>
              {skills.data.map(s => (
                <tr key={s.id}>
                  <td style={td}>{s.analyst_name}</td><td style={td}>{s.category}</td>
                  <td style={td}>{s.adjustment > 0 ? '+' : ''}{s.adjustment}</td><td style={td}>{s.reason}</td>
                  <td style={td}>{s.set_by} · {fmtDate(s.created_at)}</td>
                  <td style={td}>{s.approved ? <Pill color={theme.colors.sage}>applied</Pill> : (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <Button small onClick={async () => { await api.patch(`/assignment/skills/${s.id}`, { approved: true }); skills.reload(); }}>Approve</Button>
                      <Button small variant="danger" onClick={async () => { await api.patch(`/assignment/skills/${s.id}`, { approved: false }); skills.reload(); }}>Reject</Button>
                    </span>
                  )}</td>
                </tr>
              ))}
            </Table>
          )}
          <p style={{ fontSize: 11, color: theme.colors.grey }}>Analysts' "I'm comfortable with this type" flags wait here for approval. Feedback and actual hours on closed tickets also update skill and track record automatically.</p>
        </div>
      </Card>
    </Grid>
  );
}
