import { useEffect, useState } from 'react';
import { theme } from '../theme';
import { api } from '../api/client';
import type { RecommendationCard } from '../api/types';
import { useApi } from '../session';
import { FitGauge } from './RecommendationCard';
import { Button, Field, Loading, Modal, Notice, Pill, inputStyle, initials } from './ui';

/**
 * Pick who takes over a ticket, the same way the lead assigns tickets: every analyst is
 * listed alphabetically (not in the AI's order) with their fit, free hours and chance of
 * meeting the deadline. The suggestion is only marked; the lead chooses.
 */
export function ReassignDialog({ ticketId, title, fromName, suggestedId, defaultReason, onClose, onDone }: {
  ticketId: number;
  title: string;
  fromName?: string | null;
  suggestedId?: number | null;
  defaultReason?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const card = useApi<RecommendationCard>(`/assignment/recommend/${ticketId}`);
  const [chosen, setChosen] = useState<number | null>(null);
  const [support, setSupport] = useState<number | ''>('');
  const [reason, setReason] = useState(defaultReason ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = card.data?.current_assignee_id ?? null;
  const people = [...(card.data?.candidates ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  useEffect(() => { setError(null); }, [chosen]);

  async function confirm() {
    if (chosen === null) return;
    setBusy(true);
    try {
      const r = await api.post<{ ticket: { assignee_name: string }; handover: boolean }>('/assignment/assign', {
        ticket_id: ticketId, analyst_id: chosen, support_id: support || undefined,
        override_reason: reason.trim() || undefined, decided_by: 'lead',
      });
      onDone(`"${title}" moved to ${r.ticket.assignee_name}${r.handover ? ' (counted as a handover)' : ''}.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Reassign: ${title}`} onClose={onClose} width={680}>
      {!card.data ? <Loading error={card.error} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, color: theme.colors.grey }}>
            {fromName ? <>Currently with <strong style={{ color: theme.colors.ink }}>{fromName}</strong>. </> : null}
            Needs about {card.data.hours.likely}h ({card.data.hours.low}–{card.data.hours.high}h). Choose who takes it over.
          </p>

          <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {people.map(c => {
              const isCurrent = c.analyst_id === current;
              const selected = chosen === c.analyst_id;
              const meet = Math.round(c.breakdown.deadline * 100);
              return (
                <button key={c.analyst_id} role="radio" aria-checked={selected} disabled={isCurrent}
                  onClick={() => setChosen(c.analyst_id)} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 14, textAlign: 'left',
                    font: 'inherit', color: 'inherit', cursor: isCurrent ? 'not-allowed' : 'pointer', opacity: isCurrent ? 0.5 : 1,
                    background: selected ? theme.colors.accent + '12' : theme.colors.background,
                    border: `1.5px solid ${selected ? theme.colors.accent : 'transparent'}`,
                  }}>
                  <span style={{ width: 32, height: 32, borderRadius: '50%', background: selected ? theme.colors.accent : theme.colors.ink,
                    color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {initials(c.name)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 14 }}>{c.name}</strong>
                      {isCurrent && <Pill>currently assigned</Pill>}
                      {c.analyst_id === suggestedId && <Pill color={theme.colors.accent}>Suggested</Pill>}
                      {c.low_confidence && <Pill color={theme.colors.grey}>little history on this type</Pill>}
                    </div>
                    <div style={{ fontSize: 12, color: theme.colors.grey, marginTop: 2 }}>
                      {c.free_hours}h free this week · {meet}% chance of meeting the deadline · {c.past_in_category} past tickets of this type
                    </div>
                  </div>
                  <FitGauge fit={c.fit} low={c.low_confidence} good={card.data!.thresholds.good_fit} poor={card.data!.thresholds.poor_fit} />
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12 }}>
            <Field label="Supporting analyst (optional)">
              <select value={support} onChange={e => setSupport(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
                <option value="">None</option>
                {people.filter(c => c.analyst_id !== chosen && c.analyst_id !== current).map(c =>
                  <option key={c.analyst_id} value={c.analyst_id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Reason (recorded in the override log)">
              <input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          {error && <Notice tone="error">{error}</Notice>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={confirm} disabled={chosen === null || busy || !reason.trim()}>
              {busy ? 'Moving…' : chosen === null ? 'Choose an analyst' : `Move to ${people.find(p => p.analyst_id === chosen)?.name}`}
            </Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
