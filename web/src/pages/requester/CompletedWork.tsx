import { useState } from 'react';
import { FileText, Link2, MessageSquare, ThumbsUp, RotateCcw } from 'lucide-react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Deliverable } from '../../api/types';
import { useApi, useSession } from '../../session';
import { DepartmentChip } from '../../components/DepartmentChip';
import { Button, Card, Empty, Loading, Modal, Notice, Pill, fmtDate, inputStyle } from '../../components/ui';

export function DeliverableBody({ d }: { d: Deliverable }) {
  const Icon = d.kind === 'File' ? FileText : d.kind === 'Link' ? Link2 : MessageSquare;
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: theme.colors.track, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} color={theme.colors.ink} strokeWidth={1.5} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>{d.ticket_title}</strong>
          <DepartmentChip dept={d.division} size="sm" />
          {d.version > 1 && <Pill>v{d.version}</Pill>}
        </div>
        <p style={{ margin: '4px 0', fontSize: 13, lineHeight: 1.5 }}>{d.summary}</p>
        <div style={{ fontSize: 12, color: theme.colors.grey }}>
          {d.kind === 'None' ? 'No deliverable' : (
            <a href={api.fileUrl(d.id)} target="_blank" rel="noreferrer" style={{ color: theme.colors.accent, fontWeight: 600 }}>
              {d.kind === 'File' ? `Open ${d.file_name}` : 'Open link'}
            </a>
          )}
          {' · '}{d.analyst_name} · {fmtDate(d.uploaded_at)}
        </div>
      </div>
    </div>
  );
}

export default function CompletedWork() {
  const { user, refresh } = useSession();
  const { data, error, reload } = useApi<Deliverable[]>(`/deliverables/${qs({ role: 'requester', user })}`);
  const [revising, setRevising] = useState<Deliverable | null>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  async function rate(d: Deliverable, rating: 'Useful' | 'Needs revision', revisionNote?: string) {
    try {
      await api.patch(`/deliverables/${d.id}/rate`, { rating, note: revisionNote, by: user });
      setMsg(rating === 'Useful' ? `Marked "${d.ticket_title}" useful.` : `"${d.ticket_title}" reopened as a new version.`);
      setRevising(null); setNote('');
      reload(); refresh();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <Card title="My completed work">
      {msg && <div style={{ marginBottom: 12 }}><Notice tone="ok">{msg}</Notice></div>}
      {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>Nothing delivered yet.</Empty> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.map(d => (
            <div key={d.id} style={{ padding: 14, borderRadius: 14, background: theme.colors.background + '80',
              border: `1px solid ${theme.colors.track}` }}>
              <DeliverableBody d={d} />
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {d.requester_rating ? (
                  <Pill color={d.requester_rating === 'Useful' ? theme.colors.sage : theme.colors.red}>
                    {d.requester_rating}{d.revision_note ? `: ${d.revision_note}` : ''}
                  </Pill>
                ) : (
                  <>
                    <Button small onClick={() => rate(d, 'Useful')}><ThumbsUp size={12} /> Useful</Button>
                    <Button small variant="danger" onClick={() => setRevising(d)}><RotateCcw size={12} /> Needs revision</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {revising && (
        <Modal title={`Needs revision: ${revising.ticket_title}`} onClose={() => setRevising(null)}>
          <p style={{ marginTop: 0, fontSize: 13 }}>The ticket goes back to the analyst as a new version, so the rework is tracked.</p>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="What needs to change?"
            style={{ ...inputStyle, resize: 'vertical' }} />
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Button variant="danger" disabled={!note.trim()} onClick={() => rate(revising, 'Needs revision', note)}>Send back</Button>
            <Button variant="ghost" onClick={() => setRevising(null)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}
