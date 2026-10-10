import { useEffect, useState } from 'react';
import { CalendarCheck, GraduationCap, Handshake, Hourglass, SlidersHorizontal, Target } from 'lucide-react';
import type { ElementType } from 'react';
import { theme } from '../../theme';
import { api } from '../../api/client';
import type { FitSettings, SkillAdjustment } from '../../api/types';
import { useApi, useSession } from '../../session';
import { Avatar } from '../../components/TicketModals';
import { Button, Card, Field, Hint, Loading, Notice, Page, Pill, StatRow, StatTile, Table, fmtDate, inputStyle, td } from '../../components/ui';

const WEIGHTS: { key: keyof FitSettings; label: string; hint: string }[] = [
  { key: 'w_skill', label: 'Skill match', hint: 'past closed tickets of this type, plus declared skills' },
  { key: 'w_track', label: 'Track record on this type', hint: 'actual vs estimated hours, and few revisions' },
  { key: 'w_pairing', label: 'Pairing', hint: 'past tickets for this requester (capped)' },
  { key: 'w_capacity', label: 'Capacity', hint: 'free hours this week vs the high estimate' },
  { key: 'w_deadline', label: 'Deadline', hint: 'chance of finishing in time with their queue' },
];

const WEIGHT_ICON: Record<string, ElementType> = {
  w_skill: GraduationCap, w_track: Target, w_pairing: Handshake, w_capacity: Hourglass, w_deadline: CalendarCheck,
};

export default function Settings() {
  const { meta, refresh } = useSession();
  const settings = useApi<FitSettings>('/assignment/settings');
  const skills = useApi<SkillAdjustment[]>('/assignment/skills');
  const [w, setW] = useState<FitSettings | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [adj, setAdj] = useState({ analyst_id: '', category: '', adjustment: '0.1', reason: '' });

  useEffect(() => { if (settings.data) setW(settings.data); }, [settings.data]);
  if (!w) return <Card title="Fit settings" icon={SlidersHorizontal}><Loading error={settings.error} /></Card>;

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

  const pending = (skills.data ?? []).filter(x => !x.approved);
  const COLORS = [theme.colors.accent, theme.colors.ink, theme.colors.sage, theme.colors.sand, theme.colors.grey];

  return (
    <Page>
      <Card title="Fit settings" icon={SlidersHorizontal} iconColor={theme.colors.accent}
        right={<Hint>Fit = 100 × the weighted parts below</Hint>}>
        <StatRow>
          {WEIGHTS.map((x, i) => (
            <StatTile key={x.key} icon={WEIGHT_ICON[x.key]} color={COLORS[i]} label={x.label} value={`${Math.round(Number(w[x.key]) * 100)}%`} hint={x.hint} />
          ))}
        </StatRow>
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 14, background: theme.colors.track }}
          title="Share of the fit score">
          {WEIGHTS.map((x, i) => <div key={x.key} style={{ flex: Number(w[x.key]), background: COLORS[i] }} />)}
        </div>
      </Card>

      <div className="fq-cards-fit" style={{ ['--min' as string]: '360px', gap: theme.space.gap, alignItems: 'start' }}>
        <Card title="Weights and thresholds" icon={SlidersHorizontal} iconColor={theme.colors.ink}
          right={<Hint>A team that values continuity can raise pairing</Hint>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {WEIGHTS.map((x, i) => (
              <Field key={x.key} label={`${x.label}: ${Number(w[x.key]).toFixed(2)}`} hint={x.hint}>
                <Range min={0} max={0.6} step={0.05} value={Number(w[x.key])} color={COLORS[i]} onChange={v => setW({ ...w, [x.key]: v })} />
              </Field>
            ))}
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: Math.abs(total - 1) > 0.01 ? theme.colors.red : theme.colors.sage }}>
              Weights add up to {total.toFixed(2)} {Math.abs(total - 1) > 0.01 ? '(must be 1.00)' : ''}
            </p>
            <div className="fq-cards-fit" style={{ ['--min' as string]: '200px' }}>
              <Field label={`Good fit at or above: ${w.good_fit}`} hint="assign to the usual partner, no extra step">
                <Range min={40} max={95} step={1} value={w.good_fit} color={theme.colors.sage} onChange={v => setW({ ...w, good_fit: v })} />
              </Field>
              <Field label={`Poor fit below: ${w.poor_fit}`} hint="recommend the best-fitting analyst instead">
                <Range min={20} max={90} step={1} value={w.poor_fit} color={theme.colors.red} onChange={v => setW({ ...w, poor_fit: v })} />
              </Field>
            </div>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <div><Button onClick={save} disabled={Math.abs(total - 1) > 0.01}>Save settings</Button></div>
          </div>
        </Card>

        <Card title="Skill adjustments" icon={GraduationCap} iconColor={theme.colors.sand}
          right={pending.length > 0 ? <Pill color={theme.colors.sand} solid>{pending.length} waiting</Pill> : <Hint>Nothing waiting</Hint>}>
          {pending.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {pending.map(x => (
                <div key={x.id} style={{ padding: '12px 14px', borderRadius: 14, border: `1.5px solid ${theme.colors.sand}80`, background: theme.colors.sand + '10',
                  display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Avatar name={x.analyst_name} size={30} />
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{x.analyst_name} · {x.category} {x.adjustment > 0 ? '+' : ''}{x.adjustment}</div>
                    <div style={{ fontSize: 12, color: theme.colors.grey }}>“{x.reason}” · {fmtDate(x.created_at)}</div>
                  </div>
                  <Button small onClick={async () => { await api.patch(`/assignment/skills/${x.id}`, { approved: true }); skills.reload(); }}>Approve</Button>
                  <Button small variant="danger" onClick={async () => { await api.patch(`/assignment/skills/${x.id}`, { approved: false }); skills.reload(); }}>Reject</Button>
                </div>
              ))}
            </div>
          )}
          <div className="fq-cards-fit" style={{ ['--min' as string]: '140px', alignItems: 'end' }}>
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
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 220px' }}><Field label="Reason"><input value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} placeholder="e.g. finished the forecasting course" style={inputStyle} /></Field></div>
            <Button disabled={!adj.analyst_id || !adj.category || !adj.reason.trim()} onClick={addAdjustment}>Add</Button>
          </div>
          <div style={{ marginTop: 16 }}>
            {!skills.data ? <Loading error={skills.error} /> : (
              <Table head={['Analyst', 'Type', 'Change', 'Reason', 'Set by', 'Status']}>
                {skills.data.filter(x => x.approved).map(x => (
                  <tr key={x.id}>
                    <td style={td}>{x.analyst_name}</td><td style={td}>{x.category}</td>
                    <td style={td}>{x.adjustment > 0 ? '+' : ''}{x.adjustment}</td><td style={{ ...td, minWidth: 140 }}>{x.reason}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{x.set_by} · {fmtDate(x.created_at)}</td>
                    <td style={td}><Pill color={theme.colors.sage}>applied</Pill></td>
                  </tr>
                ))}
              </Table>
            )}
            <p style={{ fontSize: 11, color: theme.colors.grey, margin: '10px 0 0' }}>Analysts' "I'm comfortable with this type" flags wait here for approval. Feedback and actual hours on closed tickets also update skill and track record automatically.</p>
          </div>
        </Card>
      </div>
    </Page>
  );
}

function Range({ min, max, step, value, color, onChange }: {
  min: number; max: number; step: number; value: number; color: string; onChange: (v: number) => void;
}) {
  const p = `${((value - min) / (max - min)) * 100}%`;
  return <input type="range" className="fq-range" min={min} max={max} step={step} value={value}
    style={{ ['--c' as string]: color, ['--p' as string]: p }} onChange={e => onChange(Number(e.target.value))} />;
}
