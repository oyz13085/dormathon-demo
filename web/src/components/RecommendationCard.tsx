import { CheckCircle, XCircle, Clock, UserPlus } from 'lucide-react';
import { PieChart, Pie, Cell } from 'recharts';
import { theme } from '../theme';
import type { Candidate, RecommendationCard as Card } from '../api/types';
import { Notice, Pill, Table, initials, td } from './ui';

export function FitGauge({ fit, low, size = 44, good = 70, poor = 50 }: { fit: number; low?: boolean; size?: number; good?: number; poor?: number }) {
  const color = low ? theme.colors.grey : fit >= good ? theme.colors.sage : fit >= poor ? theme.colors.sand : theme.colors.red;
  return (
    <div style={{ position: 'relative', width: size, height: size / 2 + 4, overflow: 'hidden' }}>
      <PieChart width={size} height={size}>
        <Pie data={[{ v: fit }, { v: 100 - fit }]} cx={size / 2} cy={size / 2} startAngle={180} endAngle={0}
          innerRadius={size * 0.38} outerRadius={size / 2} dataKey="v" strokeWidth={0} isAnimationActive={false}>
          <Cell fill={color} /><Cell fill={theme.colors.track} />
        </Pie>
      </PieChart>
      <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center', fontSize: 11, fontWeight: 700 }}>{fit}</span>
    </div>
  );
}

const DECISION: Record<Card['decision'], { label: string; color: string }> = {
  good: { label: 'Good fit: usual partner', color: theme.colors.sage },
  possible: { label: 'Possible fit: usual partner with a note', color: theme.colors.sand },
  poor: { label: 'Poor fit: someone else recommended', color: theme.colors.red },
  low_confidence: { label: 'Low confidence: lead decides', color: theme.colors.grey },
  no_partner: { label: 'No usual partner: best fit', color: theme.colors.ink },
};

function Person({ c, tag, highlight, thresholds }: { c: Candidate; tag: string; highlight?: boolean; thresholds: Card['thresholds'] }) {
  return (
    <div style={{
      flex: 1, minWidth: 200, borderRadius: 14, padding: '12px 14px',
      background: highlight ? theme.colors.accent + '0D' : theme.colors.background,
      border: `1.5px solid ${highlight ? theme.colors.accent + '40' : theme.colors.track}`,
    }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: highlight ? theme.colors.accent : theme.colors.grey, letterSpacing: 0.5, textTransform: 'uppercase' }}>{tag}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: highlight ? theme.colors.accent : theme.colors.ink,
          color: '#fff', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(c.name)}</span>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{c.name}</p>
          <p style={{ margin: 0, fontSize: 11, color: theme.colors.grey }}>{c.open_hours}h open · {c.free_hours}h free</p>
        </div>
        <FitGauge fit={c.fit} low={c.low_confidence} good={thresholds.good_fit} poor={thresholds.poor_fit} />
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.45 }}>{c.explanation}</p>
    </div>
  );
}

export function RecommendationCard({ card, onAccept, onOverride, onAddSupport }: {
  card: Card; onAccept?: () => void; onOverride?: () => void; onAddSupport?: () => void;
}) {
  const d = DECISION[card.decision];
  const partnerIsRec = card.recommended && card.usual_partner && card.recommended.analyst_id === card.usual_partner.analyst_id;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <p style={{ margin: '0 0 2px', fontSize: 12, color: theme.colors.grey }}>#{card.ticket_id} · {card.division} · {card.category}</p>
          <h3 style={{ margin: 0, fontSize: 18 }}>{card.title}</h3>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Pill color={d.color}>{d.label}</Pill>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, background: theme.colors.background, borderRadius: 10, padding: '6px 12px' }}>
            <Clock size={13} color={theme.colors.grey} />
            <strong style={{ fontSize: 13 }}>{card.hours.likely}h</strong>
            <span style={{ fontSize: 11, color: theme.colors.grey }}>({card.hours.low}–{card.hours.high})</span>
          </span>
        </div>
      </div>

      {card.note && <Notice tone={card.decision === 'good' ? 'ok' : card.decision === 'possible' ? 'warn' : card.decision === 'poor' ? 'error' : 'info'}>{card.note}</Notice>}

      {card.recommended && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Person c={card.recommended} tag={partnerIsRec ? 'Recommended · usual partner' : 'Recommended'} highlight thresholds={card.thresholds} />
          {card.usual_partner && !partnerIsRec && <Person c={card.usual_partner} tag="Usual partner" thresholds={card.thresholds} />}
          {card.support && <Person c={card.support} tag="Suggested support" thresholds={card.thresholds} />}
        </div>
      )}

      {card.recommended && card.facts?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {card.facts.map(f => (
            <span key={f} style={{ padding: '4px 12px', borderRadius: theme.radius.pill, fontSize: 12, background: theme.colors.background,
              color: theme.colors.ink, border: `1px solid ${theme.colors.track}` }}>{f}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {card.recommended && onAccept && (
          <button onClick={onAccept} style={btn(true)}><CheckCircle size={14} /> Accept {card.recommended.name}</button>
        )}
        {onOverride && (
          <button onClick={onOverride} style={btn(false)}>
            <XCircle size={14} /> {card.recommended ? 'Override' : 'Choose analyst'}
          </button>
        )}
        {card.support && onAddSupport && (
          <button onClick={onAddSupport} style={btn(false)}><UserPlus size={14} /> Accept with {card.support.name} supporting</button>
        )}
      </div>

      <details>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: theme.colors.grey }}>
          Fit for every analyst on this ticket type (Fit = 100 × weighted skill, track record, pairing, capacity, deadline)
        </summary>
        <div style={{ marginTop: 8 }}>
          <Table head={['Analyst', 'Fit', 'Skill', 'Track', 'Pairing', 'Capacity', 'Deadline', 'Past on type', 'Handover risk']}>
            {card.candidates.map(c => (
              <tr key={c.analyst_id}>
                <td style={td}>{c.name}</td>
                <td style={{ ...td, fontWeight: 700 }}>{c.low_confidence ? <span title="Little history on this type">{c.fit}*</span> : c.fit}</td>
                {(['skill', 'track', 'pairing', 'capacity', 'deadline'] as const).map(k => <td key={k} style={td}>{c.breakdown[k].toFixed(2)}</td>)}
                <td style={td}>{c.past_in_category}</td>
                <td style={td}>{Math.round(c.p_handover * 100)}%</td>
              </tr>
            ))}
          </Table>
          <p style={{ fontSize: 11, color: theme.colors.grey }}>* low confidence: fewer than 2 past tickets of this type, so the score says little. Fit is per ticket type, never an overall rating of a person.</p>
        </div>
      </details>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: theme.radius.pill, cursor: 'pointer',
    fontSize: 13, fontWeight: 600, background: primary ? theme.colors.ink : 'transparent',
    color: primary ? '#fff' : theme.colors.ink, border: primary ? 'none' : `1.5px solid ${theme.colors.ink}`,
  };
}
