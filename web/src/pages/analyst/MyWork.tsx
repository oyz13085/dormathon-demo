import { useState } from 'react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Deliverable, Feedback, SkillAdjustment } from '../../api/types';
import { useApi, useSession } from '../../session';
import { Briefcase, GraduationCap, PackageCheck, Paperclip, RotateCcw, ThumbsUp, Timer } from 'lucide-react';
import { Button, Card, Empty, Field, Hint, Loading, Modal, Notice, Page, Pill, StatRow, StatTile, fmtDate, inputStyle } from '../../components/ui';
import { RevisionDetailsModal } from '../../components/RevisionDetailsModal';

export default function MyWork() {
  const { user, analystId, meta } = useSession();
  const work = useApi<Deliverable[]>(`/deliverables/${qs({ role: 'analyst', user })}`);
  const feedback = useApi<Feedback[]>(`/feedback/${qs({ role: 'analyst', user })}`);
  const flags = useApi<SkillAdjustment[]>(analystId ? `/assignment/skills${qs({ analyst_id: analystId })}` : null);
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [revisionFor, setRevisionFor] = useState<Deliverable | null>(null);

  async function flag() {
    try {
      await api.post('/assignment/skills', { analyst_id: analystId, category, adjustment: 0.15, reason, set_by: user, role: 'analyst' });
      setMsg(`Sent to the team lead: you're comfortable with ${category} tickets.`);
      setCategory(''); setReason('');
      flags.reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  const delivered = work.data ?? [];
  const useful = delivered.filter(d => d.requester_rating === 'Useful').length;
  const revise = delivered.filter(d => d.requester_rating === 'Needs revision').length;
  const timed = (feedback.data ?? []).filter(f => f.pred_likely && f.actual_hours);
  const onEstimate = timed.filter(f => Math.abs(f.actual_hours! - f.pred_likely!) <= 0.25 * f.pred_likely!).length;
  const pendingFlags = (flags.data ?? []).filter(f => !f.approved).length;

  return (
    <Page>
      <Card title="My work & feedback" icon={Briefcase} iconColor={theme.colors.accent}
        right={<Hint>Useful for reviews and for handing over before leave</Hint>}>
        {!work.data ? <Loading error={work.error} /> : (
          <StatRow>
            <StatTile icon={PackageCheck} color={theme.colors.ink} label="Delivered" value={delivered.length} hint="closed with a hand-back" />
            <StatTile icon={ThumbsUp} color={theme.colors.sage} label="Rated useful" value={useful} hint="by the requester" />
            <StatTile icon={RotateCcw} color={theme.colors.red} label="Needs revision" value={revise} hint={revise ? 'open a tile for the note' : 'nothing to redo'} />
            <StatTile icon={Timer} color={theme.colors.accent} label="On estimate" value={timed.length ? `${Math.round((100 * onEstimate) / timed.length)}%` : '—'}
              hint="closed within ±25% of the estimate" />
            <StatTile icon={GraduationCap} color={theme.colors.sand} label="Skill flags" value={pendingFlags} hint="waiting for the lead" />
          </StatRow>
        )}
      </Card>

      <div className="fq-split" style={{ ['--side' as string]: '400px' }}>
        <Card title="My completed work" icon={PackageCheck} iconColor={theme.colors.sage} right={<Hint>Click a tile for the details</Hint>}>
          {!work.data ? <Loading error={work.error} /> : delivered.length === 0 ? <Empty>Nothing delivered yet.</Empty> : (
            <div className="fq-cards" style={{ ['--min' as string]: '260px' }}>
              {delivered.map(d => (
                <WorkTile key={d.id} d={d} onViewRevision={() => setRevisionFor(d)}
                  actualHours={(feedback.data ?? []).find(f => f.ticket_id === d.ticket_id)?.actual_hours} />
              ))}
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap, minWidth: 0 }}>
          <Card title="Estimates vs actual" icon={Timer} iconColor={theme.colors.accent}>
            {!feedback.data ? <Loading error={feedback.error} /> : feedback.data.length === 0 ? <Empty>No feedback yet.</Empty> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {feedback.data.map(f => {
                  const over = f.pred_likely && f.actual_hours ? f.actual_hours / f.pred_likely : null;
                  const c = over === null ? theme.colors.grey : over > 1.25 ? theme.colors.red : over < 0.75 ? theme.colors.sand : theme.colors.sage;
                  return (
                    <div key={f.id} style={{ padding: '10px 12px', borderRadius: 12, background: theme.colors.background, display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</div>
                        <div style={{ fontSize: 11, color: theme.colors.grey }}>estimate {f.pred_likely ?? '—'}h · actual {f.actual_hours ?? '—'}h</div>
                      </div>
                      {f.estimate_rating && <Pill color={c}>{f.estimate_rating}</Pill>}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="I'm comfortable with this type" icon={GraduationCap} iconColor={theme.colors.sand}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 12, color: theme.colors.grey }}>
                Raise your skill for a ticket type, e.g. after training. The team lead approves it before it changes your fit.
              </p>
              <Field label="Ticket type">
                <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
                  <option value="">Select…</option>
                  {(meta?.categories ?? []).map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Why"><input value={reason} onChange={e => setReason(e.target.value)} style={inputStyle} /></Field>
              <div><Button disabled={!category} onClick={flag}>Send to lead</Button></div>
              {msg && <Notice tone="ok">{msg}</Notice>}
              {(flags.data ?? []).map(f => (
                <div key={f.id} style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{f.category}</strong> {f.adjustment > 0 ? '+' : ''}{f.adjustment}
                  {f.approved ? <Pill color={theme.colors.sage}>approved</Pill> : <Pill color={theme.colors.sand}>waiting for lead</Pill>}
                  <span style={{ color: theme.colors.grey }}>{fmtDate(f.created_at)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      {revisionFor && <RevisionDetailsModal deliverable={revisionFor} user={user} onClose={() => setRevisionFor(null)} />}
    </Page>
  );
}

function attachmentLabel(d: Deliverable): string {
  if (d.kind === 'File') return '1 attachment';
  if (d.kind === 'Link') return '1 link';
  return 'No attachments';
}

function WorkTile({ d, actualHours, onViewRevision }: { d: Deliverable; actualHours?: number | null; onViewRevision: () => void }) {
  const [show, setShow] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <>
      <article onClick={() => setShow(true)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        className="fq-lift" style={{ border: `1.5px solid ${hover ? theme.colors.accent : theme.colors.track}`, borderRadius: 14,
          padding: '14px 16px', minWidth: 0, minHeight: 190, display: 'flex', flexDirection: 'column', gap: 6,
          cursor: 'pointer', boxShadow: hover ? theme.shadow : 'none', transition: 'border-color 0.15s, box-shadow 0.15s' }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: theme.colors.ink, lineHeight: 1.35,
          overflowWrap: 'anywhere', minWidth: 0 }}>{d.ticket_title}</h4>
        {d.summary && (
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: theme.colors.grey }}>{d.summary}</p>
        )}
        <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: theme.colors.ink }}>{fmtDate(d.uploaded_at)}</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: theme.colors.grey }}>
            <Paperclip size={11} strokeWidth={1.5} />{attachmentLabel(d)}
          </span>
        </div>
      </article>
      {show && (
        <Modal title={d.ticket_title} onClose={() => setShow(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, lineHeight: 1.6 }}>
            {d.summary && <p style={{ margin: 0, fontSize: 14, color: theme.colors.ink }}>{d.summary}</p>}
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', margin: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <dt style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.05em', color: theme.colors.grey }}>Actual hours</dt>
                <dd style={{ margin: 0, fontSize: 13, fontWeight: 600, color: theme.colors.ink }}>
                  {actualHours != null ? `${actualHours}h` : '—'}
                </dd>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <dt style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.05em', color: theme.colors.grey }}>Delivered</dt>
                <dd style={{ margin: 0, fontSize: 13, fontWeight: 600, color: theme.colors.ink }}>{fmtDate(d.uploaded_at)}</dd>
              </div>
            </dl>
            {d.kind === 'File' && d.file_name && (
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.05em', color: theme.colors.grey }}>Files</p>
                <a href={api.fileUrl(d.id)} target="_blank" rel="noreferrer"
                  style={{ fontWeight: 600, color: theme.colors.accent }}>{d.file_name}</a>
              </div>
            )}
            {d.kind === 'Link' && d.url && (
              <div>
                <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.05em', color: theme.colors.grey }}>Links</p>
                <a href={d.url} target="_blank" rel="noreferrer"
                  style={{ fontWeight: 600, color: theme.colors.accent, overflowWrap: 'anywhere' }}>{d.url}</a>
              </div>
            )}
            <div style={{ borderTop: `1px solid ${theme.colors.track}`, paddingTop: 12 }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: theme.colors.grey }}>Requester's note</p>
              {d.requester_rating && (
                <p style={{ margin: '0 0 4px' }}>
                  <Pill color={d.requester_rating === 'Useful' ? theme.colors.sage : theme.colors.red}>
                    {d.requester_rating}
                  </Pill>
                </p>
              )}
              <p style={{ margin: 0, color: theme.colors.ink }}>{d.revision_note ?? 'No note left.'}</p>
              {d.requester_rating === 'Needs revision' && (
                <div style={{ marginTop: 10 }}>
                  <Button small variant="outline" onClick={() => { setShow(false); onViewRevision(); }}>View Revision Details</Button>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
