import { Bell, BookOpen, Briefcase, CheckCircle, Clock, FlaskConical, Repeat, Scale, ShieldCheck, Table2, Target, XCircle } from 'lucide-react';
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

function BusinessCase({ fq, jira, nTest }: { fq: Replay['policies'][string]; jira: Replay['policies'][string]; nTest: number }) {
  const fewer = Math.round((jira.missed_deadlines - fq.missed_deadlines) * 10) / 10;
  const hoSaved = Math.round(((jira.handover_hours ?? 0) - (fq.handover_hours ?? 0)) * 10) / 10;
  return (
    <HighlightRow>
      <Highlight icon={Briefcase} color={fewer > 0 ? theme.colors.sage : theme.colors.red} title="Deadlines kept">
        On the same {nTest} tickets, FairQueue missed <strong>{fq.missed_deadlines}</strong> deadlines vs <strong>{jira.missed_deadlines}</strong> with
        Jira-style balancing{fewer > 0 ? <>: <strong>{fewer} fewer</strong> broken promises to the departments.</> : '.'}
      </Highlight>
      <Highlight icon={Repeat} color={hoSaved > 0 ? theme.colors.sage : theme.colors.grey} title="Handover time">
        About <strong>{fq.handover_hours ?? '—'}h</strong> lost to handovers vs <strong>{jira.handover_hours ?? '—'}h</strong>
        {hoSaved > 0 ? <>: <strong>{hoSaved}h</strong> of analyst time back.</> : '.'}
      </Highlight>
      <Highlight icon={Clock} color={theme.colors.ink} title="Lateness when a deadline is missed">
        <strong>{fq.days_late ?? '—'}</strong> days late in total vs <strong>{jira.days_late ?? '—'}</strong> Jira-style.
        <div style={{ fontSize: 12, color: theme.colors.grey, marginTop: 4 }}>Fewer misses, but the ones left are not shorter.</div>
      </Highlight>
    </HighlightRow>
  );
}

function AlertThreshold({ a }: { a: NonNullable<Replay['alert_threshold']> }) {
  const pct = (v: number | null) => v === null ? '—' : `${Math.round(v * 100)}%`;
  return (
    <Card title="Alert threshold" icon={Bell} iconColor={theme.colors.accent}
      right={<Hint>Current {Math.round(a.current * 100)}% · suggested {Math.round(a.suggested * 100)}%</Hint>}>
      <Table head={['Alert at ≥', 'Real misses', 'Misses caught', 'Alerts / day']}>
        {a.sweep.filter((_, i) => i % 2 === 0 || a.sweep[i].threshold === a.current || a.sweep[i].threshold === a.suggested).map(x => {
          const cur = Math.abs(x.threshold - a.current) < 1e-6, sug = Math.abs(x.threshold - a.suggested) < 1e-6;
          return (
            <tr key={x.threshold} style={{ background: cur ? theme.colors.accent + '12' : undefined }}>
              <td style={{ ...td, fontWeight: cur || sug ? 700 : 400, whiteSpace: 'nowrap' }}>
                {Math.round(x.threshold * 100)}% {cur && <Pill color={theme.colors.accent}>current</Pill>} {sug && !cur && <Pill color={theme.colors.sage}>suggested</Pill>}
              </td>
              <td style={td}>{pct(x.precision)}</td>
              <td style={td}>{pct(x.recall)}</td>
              <td style={td}>{x.alerts_per_day}</td>
            </tr>
          );
        })}
      </Table>
      <p style={{ fontSize: 12, color: theme.colors.grey, margin: '10px 0 0' }}>
        Measured on the real assignments in the test period. Suggested = {a.rule}.
      </p>
    </Card>
  );
}

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
  // Alert quality on the real assignments at the current threshold (FairQueue's own replay prevents most misses, so few alerts fire there)
  const atCurrent = data.alert_threshold?.sweep.find(x => Math.abs(x.threshold - data.alert_threshold!.current) < 1e-6);

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
          <StatTile icon={Target} color={theme.colors.ink} label="Alerts that were real misses"
            value={`${Math.round((atCurrent?.precision ?? fq.alert_precision) * 100)}%`}
            hint={atCurrent ? `${Math.round((atCurrent.recall ?? 0) * 100)}% of misses caught · ${atCurrent.alerts_per_day} a day` : `${fq.alerts_per_day} alerts a day`} />
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
              <td style={td}>{v.alerts_per_day ? `${Math.round(v.alert_precision * 100)}%` : '—'}</td>
              <td style={td}>{v.alerts_per_day}</td>
              <td style={td}>{v.alerts_per_day ? `${Math.round(v.cause_label_accuracy * 100)}%` : '—'}</td>
            </tr>
          ))}
        </Table>
        <p style={{ fontSize: 12, color: theme.colors.grey, margin: '10px 0 0' }}>
          Workload spread = average weekly gap between the busiest and least busy analyst. Alert columns show — where no alerts fired.
        </p>
      </Card>

      <BusinessCase fq={fq} jira={jira} nTest={data.n_test} />

      <div className="fq-cards-fit" style={{ ['--min' as string]: '460px', gap: theme.space.gap, alignItems: 'start' }}>
        <Card title="Prediction models" icon={Target} iconColor={theme.colors.sage}
          right={<Hint>Test period · lower is better</Hint>}>
          {hm ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
              {hm.test_mae && (
                <Table head={['Hours estimate', 'Mean error']}>
                  {([['category_median', 'Category median (baseline)'], ['lightgbm', 'LightGBM'], ['empirical', 'Category × priority'],
                    ['chosen_with_analyst', 'Chosen model, analyst known']] as const).filter(([k]) => hm.test_mae![k] !== undefined).map(([k, label]) => (
                    <tr key={k} style={{ background: k === 'chosen_with_analyst' ? theme.colors.sage + '12' : undefined }}>
                      <td style={{ ...td, fontWeight: k === 'chosen_with_analyst' ? 700 : 400 }}>{label}</td>
                      <td style={{ ...td, fontWeight: k === 'chosen_with_analyst' ? 700 : 400 }}>{hm.test_mae![k]}h</td>
                    </tr>
                  ))}
                </Table>
              )}
              <div style={{ fontSize: 12, color: theme.colors.grey, lineHeight: 1.5 }}>
                {hm.method && <>Chosen on a validation slice of the training period: <strong style={{ color: theme.colors.ink }}>{hm.method === 'empirical' ? 'category × priority × analyst speed' : 'LightGBM'}</strong>. </>}
                The low–high range contains the actual hours {Math.round(hm.interval_coverage_low_high * 100)}% of the time (target 80%).
              </div>
              {data.handover_model && (
                <div>Handover model Brier <strong>{data.handover_model.brier_model}</strong> vs base rate {data.handover_model.brier_base_rate}{' '}
                  <Pill color={data.handover_model.beats_baseline ? theme.colors.sage : theme.colors.red}>{data.handover_model.beats_baseline ? 'beats baseline' : 'does not beat baseline'}</Pill></div>
              )}
            </div>
          ) : <p style={{ margin: 0, fontSize: 13 }}>Models not trained yet.</p>}
        </Card>

        {data.robustness && (
          <Card title="Robustness" icon={ShieldCheck} iconColor={theme.colors.sage}
            right={<Hint>Hours model refitted on damaged data, scored on true hours</Hint>}>
            <Table head={['Damage', 'Model', 'Baseline', '']}>
              {data.robustness.map(x => (
                <tr key={x.case}>
                  <td style={{ ...td, minWidth: 180 }}>{x.case}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{x.mae_model}h</td>
                  <td style={td}>{x.mae_baseline}h</td>
                  <td style={td}>{x.beats_baseline ? <Pill color={theme.colors.sage}>holds</Pill> : <Pill color={theme.colors.red}>breaks</Pill>}</td>
                </tr>
              ))}
            </Table>
          </Card>
        )}

        {data.alert_threshold && <AlertThreshold a={data.alert_threshold} />}
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
