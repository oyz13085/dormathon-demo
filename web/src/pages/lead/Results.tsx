import { theme } from '../../theme';
import type { Replay } from '../../api/types';
import { useApi } from '../../session';
import { Card, Grid, Loading, Notice, Pill, Table, td } from '../../components/ui';

const POLICY_LABEL: Record<string, string> = {
  actual: 'What actually happened',
  round_robin: 'Assign by turn',
  fewest_open: 'Fewest open tickets',
  fairqueue: 'FairQueue',
  fairqueue_conservative: 'FairQueue (conservative count)',
};

export default function Results() {
  const { data, error } = useApi<Replay>('/prediction/replay');
  if (!data) return <Card title="Replay results"><Loading error={error} /></Card>;
  const policies = Object.entries(data.policies);
  const best = (k: 'missed_deadlines' | 'handovers_per_100' | 'workload_spread_hours') =>
    Math.min(...policies.filter(([p]) => p !== 'fairqueue_conservative').map(([, v]) => v[k]));
  const s = data.checks.simulator, a = data.checks.agreement;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
      <Notice tone={data.data_source === 'synthetic' ? 'warn' : 'ok'}>
        <strong>Data: {data.data_source}.</strong> {data.data_note} Test period {data.test_period[0]} to {data.test_period[1]},
        {' '}{data.n_test} tickets replayed in arrival order ({data.n_train} earlier tickets used for training and calibration).
      </Notice>

      <Card title="Replay: test-period tickets through four policies">
        <Table head={['Policy', 'Missed deadlines', 'Handovers / 100', 'Workload spread (h/week)', 'Alert precision', 'Alerts / day', 'Cause labels right']}>
          {policies.map(([p, v]) => (
            <tr key={p} style={{ background: p === 'fairqueue' ? theme.colors.accent + '10' : undefined }}>
              <td style={{ ...td, fontWeight: p.startsWith('fairqueue') ? 700 : 400 }}>{POLICY_LABEL[p] ?? p}</td>
              <td style={{ ...td, fontWeight: v.missed_deadlines === best('missed_deadlines') ? 700 : 400 }}>{v.missed_deadlines} <span style={{ color: theme.colors.grey }}>({v.missed_pct}%)</span></td>
              <td style={{ ...td, fontWeight: v.handovers_per_100 === best('handovers_per_100') ? 700 : 400 }}>{v.handovers_per_100}</td>
              <td style={{ ...td, fontWeight: v.workload_spread_hours === best('workload_spread_hours') ? 700 : 400 }}>{v.workload_spread_hours}</td>
              <td style={td}>{Math.round(v.alert_precision * 100)}%</td>
              <td style={td}>{v.alerts_per_day}</td>
              <td style={td}>{Math.round(v.cause_label_accuracy * 100)}%</td>
            </tr>
          ))}
        </Table>
        <p style={{ fontSize: 12, color: theme.colors.grey, marginBottom: 0 }}>
          Bold = best in the column. Workload spread = average weekly gap between the busiest and least busy analyst.
          The replay uses the current fit weights and thresholds from Fit settings.
        </p>
      </Card>

      <Grid cols="repeat(auto-fit, minmax(280px, 1fr))">
        <Card title="1. Simulator check">
          <p style={{ margin: 0, fontSize: 13 }}>Replaying what actually happened: <strong>{s.simulated_missed}</strong> missed in the simulator vs <strong>{s.real_missed}</strong> in reality.</p>
          <p style={{ margin: '8px 0 0' }}>{s.passes ? <Pill color={theme.colors.sage}>passes</Pill> : <Pill color={theme.colors.red}>does not pass: treat policy gaps with caution</Pill>}</p>
          <p style={{ fontSize: 12, color: theme.colors.grey }}>Calibrated on the training period: {data.focus_hours_per_day} focus hours a day, median close-time error {s.calibration_median_close_error_hours}h.</p>
        </Card>
        <Card title="2. Agreement check">
          <p style={{ margin: 0, fontSize: 13 }}>
            Where the real assignee matched FairQueue's pick ({a.n_matched} tickets), {a.missed_pct_when_matched ?? '—'}% missed.
            Where it didn't ({a.n_not_matched}), {a.missed_pct_when_not ?? '—'}% missed.
          </p>
          <p style={{ fontSize: 12, color: theme.colors.grey }}>Real outcomes only: no simulation involved.</p>
        </Card>
        <Card title="3. Conservative counting">
          <p style={{ margin: 0, fontSize: 13 }}>
            Counting a gain only where FairQueue's pick had handled the ticket type before: {data.checks.conservative.conservative_missed} missed
            (vs {data.checks.conservative.fairqueue_missed} uncounted).
          </p>
        </Card>
        <Card title="Hours prediction error">
          {data.hours_model ? (
            <p style={{ margin: 0, fontSize: 13 }}>
              Model {data.hours_model.mae_model}h vs category-median baseline {data.hours_model.mae_category_median}h mean absolute error.{' '}
              {data.hours_model.beats_baseline ? <Pill color={theme.colors.sage}>beats baseline</Pill> : <Pill color={theme.colors.red}>does not beat baseline</Pill>}
              <br /><span style={{ fontSize: 12, color: theme.colors.grey }}>Low–high range contains the actual hours {Math.round(data.hours_model.interval_coverage_low_high * 100)}% of the time (target 80%).</span>
            </p>
          ) : <p style={{ margin: 0 }}>Models not trained yet.</p>}
          {data.handover_model && (
            <p style={{ fontSize: 13 }}>Handover model Brier {data.handover_model.brier_model} vs base rate {data.handover_model.brier_base_rate}{' '}
              {data.handover_model.beats_baseline ? <Pill color={theme.colors.sage}>beats baseline</Pill> : <Pill color={theme.colors.red}>does not beat baseline</Pill>}</p>
          )}
        </Card>
      </Grid>

      <Card title="Assumptions">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
          {data.assumptions.map(x => <li key={x}>{x}</li>)}
          <li>Departments are mapped from the source data's projects (data/department_map.csv); the mapping is illustrative.</li>
        </ul>
      </Card>
    </div>
  );
}
