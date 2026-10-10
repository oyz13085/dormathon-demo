import { BookOpen, CheckCircle, Clock, FlaskConical, Repeat, Scale, ShieldCheck, Table2, Target, XCircle } from 'lucide-react';
import { theme } from '../../theme';
import type { Replay } from '../../api/types';
import { useApi } from '../../session';
import { Card, Highlight, HighlightRow, Hint, Loading, Notice, Page, Pill, StatRow, StatTile, Table, td } from '../../components/ui';

const POLICY_LABEL: Record<string, string> = {
  actual: 'What actually happened',
  round_robin: 'Assign by turn',
  fewest_open: 'Fewest open tickets (Jira-style)',
  fairqueue: 'FairQueue',
  fairqueue_conservative: 'FairQueue (conservative count)',
};

export default function Results() {
  const { data, error } = useApi<Replay>('/prediction/replay');
  if (!data) return <Card title="Replay results" icon={FlaskConical}><Loading error={error} /></Card>;
  const policies = Object.entries(data.policies);
  const best = (k: 'missed_deadlines' | 'handovers_per_100' | 'workload_spread_hours') =>
    Math.min(...policies.filter(([p]) => p !== 'fairqueue_conservative').map(([, v]) => v[k]));
  const s = data.checks.simulator, a = data.checks.agreement, c = data.checks.conservative;
  const fq = data.policies.fairqueue, jira = data.policies.fewest_open;
  const better = (x: number, y: number) => (x < y ? theme.colors.sage : x > y ? theme.colors.red : theme.colors.ink);
  const hm = data.hours_model;

  return (
    <Page>
      <Card title="Replay results" icon={FlaskConical} iconColor={theme.colors.accent}
        right={<Pill color={data.data_source === 'synthetic' ? theme.colors.sand : theme.colors.sage} solid>{data.data_source} data</Pill>}>
        <StatRow>
          <StatTile icon={Clock} color={better(fq.missed_deadlines, jira.missed_deadlines)} label="Missed deadlines" value={fq.missed_deadlines}
            hint={`vs ${jira.missed_deadlines} with Jira-style balancing`} />
          <StatTile icon={Repeat} color={better(fq.handovers_per_100, jira.handovers_per_100)} label="Handovers / 100" value={fq.handovers_per_100}
            hint={`vs ${jira.handovers_per_100} Jira-style`} />
          <StatTile icon={Scale} color={better(fq.workload_spread_hours, jira.workload_spread_hours)} label="Workload spread" value={`${fq.workload_spread_hours}h`}
            hint={`busiest vs least busy · ${jira.workload_spread_hours}h Jira-style`} />
          <StatTile icon={Target} color={theme.colors.ink} label="Alert precision" value={`${Math.round(fq.alert_precision * 100)}%`}
            hint={`${fq.alerts_per_day} alerts a day`} />
          {hm && <StatTile icon={Clock} color={hm.beats_baseline ? theme.colors.sage : theme.colors.red} label="Hours error" value={`${hm.mae_model}h`}
            hint={`vs ${hm.mae_category_median}h category median`} />}
        </StatRow>
        <div style={{ marginTop: 14 }}>
          <Notice tone={data.data_source === 'synthetic' ? 'warn' : 'ok'}>
            {data.data_note} Test period {data.test_period[0]} to {data.test_period[1]}: {data.n_test} tickets replayed in arrival order
            ({data.n_train} earlier tickets used for training and calibration).
          </Notice>
        </div>
      </Card>

      <HighlightRow>
        <Highlight icon={s.passes ? ShieldCheck : XCircle} color={s.passes ? theme.colors.sage : theme.colors.red} title="1 · Simulator check">
          Replaying what happened gives <strong>{s.simulated_missed}</strong> missed vs <strong>{s.real_missed}</strong> in reality.{' '}
          {s.passes ? 'Passes.' : 'Does not pass: treat policy gaps with caution.'}
          <div style={{ fontSize: 12, color: theme.colors.grey, marginTop: 4 }}>
            {data.focus_hours_per_day} focus hours a day; median close-time error {s.calibration_median_close_error_hours}h.
          </div>
        </Highlight>
        <Highlight icon={CheckCircle} color={theme.colors.accent} title="2 · Agreement check">
          When the real assignee matched FairQueue's pick ({a.n_matched}), <strong>{a.missed_pct_when_matched ?? '—'}%</strong> missed;
          otherwise ({a.n_not_matched}) <strong>{a.missed_pct_when_not ?? '—'}%</strong>.
          <div style={{ fontSize: 12, color: theme.colors.grey, marginTop: 4 }}>Real outcomes only, no simulation.</div>
        </Highlight>
        <Highlight icon={Scale} color={theme.colors.ink} title="3 · Conservative counting">
          Counting gains only where FairQueue's pick had done that ticket type: <strong>{c.conservative_missed}</strong> missed
          (vs {c.fairqueue_missed} uncounted).
        </Highlight>
      </HighlightRow>

      <Card title="Four policies on the same tickets" icon={Table2} iconColor={theme.colors.accent}
        right={<Hint>Bold = best in the column · uses the current fit settings</Hint>}>
        <Table head={['Policy', 'Missed deadlines', 'Handovers / 100', 'Workload spread (h/week)', 'Alert precision', 'Alerts / day', 'Cause labels right']}>
          {policies.map(([p, v]) => (
            <tr key={p} style={{ background: p === 'fairqueue' ? theme.colors.accent + '10' : undefined }}>
              <td style={{ ...td, fontWeight: p.startsWith('fairqueue') ? 700 : 400, whiteSpace: 'nowrap' }}>{POLICY_LABEL[p] ?? p}</td>
              <td style={{ ...td, fontWeight: v.missed_deadlines === best('missed_deadlines') ? 700 : 400 }}>{v.missed_deadlines} <span style={{ color: theme.colors.grey }}>({v.missed_pct}%)</span></td>
              <td style={{ ...td, fontWeight: v.handovers_per_100 === best('handovers_per_100') ? 700 : 400 }}>{v.handovers_per_100}</td>
              <td style={{ ...td, fontWeight: v.workload_spread_hours === best('workload_spread_hours') ? 700 : 400 }}>{v.workload_spread_hours}</td>
              <td style={td}>{Math.round(v.alert_precision * 100)}%</td>
              <td style={td}>{v.alerts_per_day}</td>
              <td style={td}>{Math.round(v.cause_label_accuracy * 100)}%</td>
            </tr>
          ))}
        </Table>
        <p style={{ fontSize: 12, color: theme.colors.grey, margin: '10px 0 0' }}>
          Workload spread = average weekly gap between the busiest and least busy analyst.
        </p>
      </Card>

      <div className="fq-cards-fit" style={{ ['--min' as string]: '320px', gap: theme.space.gap }}>
        <Card title="Prediction models" icon={Target} iconColor={theme.colors.sage}>
          {hm ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div>Hours model <strong>{hm.mae_model}h</strong> mean absolute error vs category median <strong>{hm.mae_category_median}h</strong>{' '}
                <Pill color={hm.beats_baseline ? theme.colors.sage : theme.colors.red}>{hm.beats_baseline ? 'beats baseline' : 'does not beat baseline'}</Pill></div>
              <div style={{ fontSize: 12, color: theme.colors.grey }}>The low–high range contains the actual hours {Math.round(hm.interval_coverage_low_high * 100)}% of the time (target 80%).</div>
              {data.handover_model && (
                <div>Handover model Brier <strong>{data.handover_model.brier_model}</strong> vs base rate {data.handover_model.brier_base_rate}{' '}
                  <Pill color={data.handover_model.beats_baseline ? theme.colors.sage : theme.colors.red}>{data.handover_model.beats_baseline ? 'beats baseline' : 'does not beat baseline'}</Pill></div>
              )}
            </div>
          ) : <p style={{ margin: 0, fontSize: 13 }}>Models not trained yet.</p>}
        </Card>
        <Card title="Assumptions" icon={BookOpen} iconColor={theme.colors.grey}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, listStyle: 'disc' }}>
            {data.assumptions.map(x => <li key={x}>{x}</li>)}
            <li>Departments are mapped from the source data's projects (data/department_map.csv); the mapping is illustrative.</li>
          </ul>
        </Card>
      </div>
    </Page>
  );
}
