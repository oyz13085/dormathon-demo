import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Priority, RecommendationCard as CardData, Ticket } from '../../api/types';
import { useApi, useSession } from '../../session';
import { RecommendationCard } from '../../components/RecommendationCard';
import { TicketTable } from '../../components/TicketTable';
import { Button, Card, Field, Grid, Loading, Modal, Notice, fmtDate, inputStyle } from '../../components/ui';

export default function Assign() {
  const { division, refresh } = useSession();
  const [params, setParams] = useSearchParams();
  const tickets = useApi<Ticket[]>(`/tickets/${qs({ role: 'lead', division })}`);
  const open = (tickets.data ?? []).filter(t => t.status !== 'Closed')
    .sort((a, b) => Number(!!a.assignee_id) - Number(!!b.assignee_id) || (a.confidence === 'Low' ? -1 : 0) || a.deadline.localeCompare(b.deadline));
  const selectedId = Number(params.get('ticket')) || open.find(t => !t.assignee_id)?.id || null;
  const selected = (tickets.data ?? []).find(t => t.id === selectedId) ?? null;
  const card = useApi<CardData>(selectedId ? `/assignment/recommend/${selectedId}` : null);
  const [override, setOverride] = useState<{ support?: boolean } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => { setMsg(null); }, [selectedId]);

  async function assign(analystId: number, reason?: string, supportId?: number) {
    try {
      const r = await api.post<{ ticket: Ticket; accepted: boolean; handover: boolean }>('/assignment/assign',
        { ticket_id: selectedId, analyst_id: analystId, override_reason: reason, support_id: supportId, decided_by: 'lead' });
      setMsg({ tone: 'ok', text: `Assigned to ${r.ticket.assignee_name}${r.accepted ? '' : ' (override logged)'}${r.handover ? '. Counted as a handover.' : '.'}` });
      setOverride(null);
      refresh();
    } catch (e) { setMsg({ tone: 'error', text: (e as Error).message }); }
  }

  return (
    <Grid cols="minmax(0,1fr) minmax(0,1.1fr)">
      <Card title="Open tickets" right={<span style={{ fontSize: 12, color: theme.colors.grey }}>Unassigned first · click to see the recommendation</span>}>
        {!tickets.data ? <Loading error={tickets.error} /> : (
          <TicketTable tickets={open} showPredictions showAssignee tabs={['Unassigned', 'All']}
            selectedId={selectedId} onSelect={t => setParams({ ticket: String(t.id) })} />
        )}
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
        <Card>
          {!selectedId ? <p style={{ margin: 0, color: theme.colors.grey }}>Pick a ticket.</p>
            : !card.data ? <Loading error={card.error} /> : (
              <>
                {msg && <div style={{ marginBottom: 12 }}><Notice tone={msg.tone}>{msg.text}</Notice></div>}
                {selected?.assignee_name && (
                  <div style={{ marginBottom: 12 }}>
                    <Notice>Currently with <strong>{selected.assignee_name}</strong>. Choosing someone else counts as a handover.</Notice>
                  </div>
                )}
                <RecommendationCard card={card.data}
                  onAccept={card.data.recommended && card.data.recommended.analyst_id !== selected?.assignee_id
                    ? () => assign(card.data!.recommended!.analyst_id) : undefined}
                  onOverride={() => setOverride({})}
                  onAddSupport={card.data.support ? () => assign(card.data!.recommended!.analyst_id, undefined, card.data!.support!.analyst_id) : undefined} />
              </>
            )}
        </Card>

        {selected && <PriorityCard ticket={selected} onDone={refresh} />}

        {card.data?.similar_work && card.data.similar_work.length > 0 && (
          <Card title="Similar work already delivered" icon={BookOpen} iconColor={theme.colors.sage}>
            {card.data.similar_work.map(w => (
              <p key={w.deliverable_id} style={{ margin: '0 0 8px', fontSize: 13 }}>
                Similar work delivered on {fmtDate(w.delivered_on)}:{' '}
                <a href={api.fileUrl(w.deliverable_id)} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: theme.colors.ink }}>{w.title}</a>
                <span style={{ display: 'block', fontSize: 12, color: theme.colors.grey }}>{w.summary}</span>
              </p>
            ))}
          </Card>
        )}

        {selected?.assignee_id && (
          <Button variant="danger" small onClick={async () => { await api.post(`/assignment/unassign/${selected.id}`, {}); refresh(); }}>
            Move back to Unassigned
          </Button>
        )}
      </div>

      {override && card.data && (
        <OverrideModal card={card.data} onClose={() => setOverride(null)}
          onConfirm={(id, reason, support) => assign(id, reason, support)} />
      )}
    </Grid>
  );
}

function OverrideModal({ card, onClose, onConfirm }: {
  card: CardData; onClose: () => void; onConfirm: (analystId: number, reason: string, supportId?: number) => void;
}) {
  const [analyst, setAnalyst] = useState<number | ''>('');
  const [support, setSupport] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const needsReason = !!card.recommended && analyst !== card.recommended.analyst_id;
  return (
    <Modal title={card.recommended ? 'Override the recommendation' : 'Choose an analyst'} onClose={onClose} width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Analyst">
          <select value={analyst} onChange={e => setAnalyst(Number(e.target.value))} style={inputStyle}>
            <option value="">Select…</option>
            {card.candidates.map(c => <option key={c.analyst_id} value={c.analyst_id}>{c.name} (fit {c.fit}{c.low_confidence ? ', low confidence' : ''})</option>)}
          </select>
        </Field>
        <Field label="Supporting analyst (optional)">
          <select value={support} onChange={e => setSupport(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
            <option value="">None</option>
            {card.candidates.filter(c => c.analyst_id !== analyst).map(c => <option key={c.analyst_id} value={c.analyst_id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={needsReason ? 'Reason (recorded in the override log)' : 'Note (optional)'}>
          <input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button disabled={!analyst || (needsReason && !reason.trim())} onClick={() => onConfirm(Number(analyst), reason, support || undefined)}>Assign</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

function PriorityCard({ ticket, onDone }: { ticket: Ticket; onDone: () => void }) {
  const [priority, setPriority] = useState<Priority>(ticket.priority);
  const [reason, setReason] = useState('');
  useEffect(() => { setPriority(ticket.priority); setReason(''); }, [ticket.id, ticket.priority]);
  const changed = priority !== ticket.priority;
  return (
    <Card title="Priority (the lead has the final say)">
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ width: 140 }}>
          <Field label="Priority">
            <select value={priority} onChange={e => setPriority(e.target.value as Priority)} style={inputStyle}>
              {(['Low', 'Medium', 'High', 'Critical'] as Priority[]).map(p => <option key={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Field label="Reason"><input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} /></Field>
        </div>
        <Button disabled={!changed} onClick={async () => { await api.patch(`/tickets/${ticket.id}/priority`, { priority, reason, by: 'lead' }); onDone(); }}>
          Save
        </Button>
      </div>
    </Card>
  );
}
