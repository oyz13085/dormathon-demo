import { useState, type ReactNode } from 'react';
import { Search, Flag, Paperclip, Link2, MessageSquare, MoreHorizontal, FileText, ExternalLink,
  RotateCcw, TrendingUp, MessagesSquare, RefreshCw } from 'lucide-react';
import { theme } from '../../theme';
import { api, qs } from '../../api/client';
import type { Deliverable, Dept, Feedback, Ticket } from '../../api/types';
import { useApi, useSession } from '../../session';
import { DepartmentChip } from '../../components/DepartmentChip';
import { Button, Empty, Loading, Modal, Pill, card, fmtDate, initials, inputStyle } from '../../components/ui';

interface RevisionRow { category: string; delivered: number; revisions: number }
interface UnderRow { category: string; n_closed: number; actual_over_estimate: number; too_low_votes: number }
type TicketDetail = Ticket & { deliverables: Deliverable[] };

const tint = (d: Dept) => theme.dept[d] + '12';
const edge = (d: Dept) => theme.dept[d] + '30';

export default function Library() {
  const { meta } = useSession();
  const [q, setQ] = useState('');
  const [division, setDivision] = useState<Dept | ''>('');
  const [category, setCategory] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<'newest' | 'revision'>('newest');
  const [open, setOpen] = useState<Deliverable | null>(null);
  const [panel, setPanel] = useState<'rework' | 'under' | 'feedback' | null>(null);

  const lib = useApi<Deliverable[]>(`/deliverables/${qs({ role: 'lead', q, division, category, date_from: from, date_to: to })}`);
  const stats = useApi<{ revisions_by_category: RevisionRow[] }>('/deliverables/stats');
  const feedback = useApi<Feedback[]>(`/feedback/${qs({ role: 'lead' })}`);
  const under = useApi<UnderRow[]>('/prediction/underestimated');

  const items = [...(lib.data ?? [])].sort((a, b) => sort === 'revision'
    ? Number(b.requester_rating === 'Needs revision') - Number(a.requester_rating === 'Needs revision') || b.uploaded_at.localeCompare(a.uploaded_at)
    : b.uploaded_at.localeCompare(a.uploaded_at));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space.gap }}>
      {/* Three summary widgets */}
      <div className="fq-grid3">
        <ReworkWidget rows={stats.data?.revisions_by_category} error={stats.error} onMore={() => setPanel('rework')} />
        <UnderWidget rows={under.data} error={under.error} onMore={() => setPanel('under')} />
        <FeedbackWidget rows={feedback.data} error={feedback.error} onMore={() => setPanel('feedback')} />
      </div>

      {/* Filters */}
      <section style={{ ...card, padding: '14px 18px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: theme.font.title, fontWeight: 600, marginRight: 6 }}>Deliverables library</h2>
        <span style={{ fontSize: 12, color: theme.colors.grey }}>{lib.data ? `${items.length} item${items.length === 1 ? '' : 's'}` : ''}</span>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative', minWidth: 200 }}>
          <Search size={14} color={theme.colors.grey} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title or summary" style={{ ...inputStyle, paddingLeft: 30, borderRadius: theme.radius.pill }} />
        </div>
        <select value={division} onChange={e => setDivision(e.target.value as Dept)} style={{ ...inputStyle, width: 'auto' }} aria-label="Department">
          <option value="">All departments</option>{(meta?.departments ?? []).map(d => <option key={d}>{d}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="Category">
          <option value="">All types</option>{(meta?.categories ?? []).map(c => <option key={c}>{c}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="From" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inputStyle, width: 'auto' }} aria-label="To" />
        <select value={sort} onChange={e => setSort(e.target.value as 'newest' | 'revision')} style={{ ...inputStyle, width: 'auto' }} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="revision">Needs revision first</option>
        </select>
      </section>

      {/* Deliverable cards, three per row */}
      {!lib.data ? <Loading error={lib.error} /> : items.length === 0 ? <section style={card}><Empty>No deliverables match.</Empty></section> : (
        <div className="fq-grid3">
          {items.map(d => <DeliverableCard key={d.id} d={d} onOpen={() => setOpen(d)} />)}
        </div>
      )}

      {open && <DeliverableDetail d={open} feedback={(feedback.data ?? []).filter(f => f.ticket_id === open.ticket_id)} onClose={() => setOpen(null)} />}
      {panel === 'rework' && <Modal title="Rework by ticket type" onClose={() => setPanel(null)}><ReworkList rows={stats.data?.revisions_by_category ?? []} /></Modal>}
      {panel === 'under' && <Modal title="Regularly underestimated ticket types" onClose={() => setPanel(null)}><UnderList rows={under.data ?? []} /></Modal>}
      {panel === 'feedback' && <Modal title="All feedback" onClose={() => setPanel(null)} width={640}><FeedbackList rows={feedback.data ?? []} /></Modal>}
    </div>
  );
}

// ── Deliverable card ─────────────────────────────────────────────────────────────

function Tag({ children }: { children: ReactNode }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, color: theme.colors.grey,
      background: theme.colors.card, border: `1px solid ${theme.colors.track}` }}>{children}</span>
  );
}

function kindLabel(d: Deliverable): string {
  return d.kind === 'File' ? `#${(d.file_type ?? 'file').toUpperCase()}` : d.kind === 'Link' ? '#Link' : '#No deliverable';
}

function DeliverableCard({ d, onOpen }: { d: Deliverable; onOpen: () => void }) {
  const KindIcon = d.kind === 'File' ? FileText : d.kind === 'Link' ? Link2 : MessageSquare;
  const revision = d.requester_rating === 'Needs revision';
  return (
    <button onClick={onOpen} className="fq-lift" style={{
      textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', width: '100%',
      background: tint(d.division), border: `1px solid ${edge(d.division)}`, borderRadius: 18, padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10, minHeight: 250,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Tag>#{d.category}</Tag>
        <Tag>{kindLabel(d)}</Tag>
        <span style={{ flex: 1 }} />
        <MoreHorizontal size={16} color={theme.colors.grey} />
      </div>

      <div>
        <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3, color: d.division === 'IT' || d.division === 'Marketing' ? theme.colors.ink : theme.dept[d.division] }}>
          {d.ticket_title}
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: theme.colors.grey, lineHeight: 1.45, display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.summary}</p>
      </div>

      {d.kind !== 'None' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10,
          background: theme.colors.card, border: `1px solid ${theme.colors.track}`, fontSize: 12 }}>
          <KindIcon size={14} color={theme.colors.ink} strokeWidth={1.5} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.kind === 'File' ? d.file_name : (d.title ?? d.url)}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, fontSize: 11,
          background: theme.colors.card, border: `1px solid ${theme.colors.track}` }}>
          <Flag size={11} color={theme.colors.grey} /> {fmtDate(d.uploaded_at)}
        </span>
        {d.version > 1 && <Pill>v{d.version}</Pill>}
        {d.requester_rating
          ? <Pill color={revision ? theme.colors.red : theme.colors.sage}>{d.requester_rating}</Pill>
          : <Pill color={theme.colors.grey}>Awaiting rating</Pill>}
      </div>

      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: theme.colors.ink, color: '#fff', fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(d.analyst_name)}</span>
        <span style={{ color: theme.colors.grey, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.analyst_name} → {d.requester}
        </span>
        <span style={{ flex: 1 }} />
        {d.kind === 'File' && <Paperclip size={13} color={theme.colors.grey} />}
        {d.kind === 'Link' && <Link2 size={13} color={theme.colors.grey} />}
        {d.revision_note && <MessageSquare size={13} color={theme.colors.red} />}
      </div>
    </button>
  );
}

// ── Detail modal ─────────────────────────────────────────────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: theme.colors.grey, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{children}</div>
    </div>
  );
}

function DeliverableDetail({ d, feedback, onClose }: { d: Deliverable; feedback: Feedback[]; onClose: () => void }) {
  const ticket = useApi<TicketDetail>(`/tickets/${d.ticket_id}${qs({ role: 'lead' })}`);
  const t = ticket.data;
  const versions = [...(t?.deliverables ?? [])].sort((a, b) => b.version - a.version);

  return (
    <Modal title={d.ticket_title} onClose={onClose} width={680}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <DepartmentChip dept={d.division} size="sm" />
          <Tag>#{d.category}</Tag><Tag>{kindLabel(d)}</Tag>
          {d.version > 1 && <Pill>Version {d.version}</Pill>}
          {d.requester_rating && <Pill color={d.requester_rating === 'Useful' ? theme.colors.sage : theme.colors.red}>{d.requester_rating}</Pill>}
        </div>

        <div style={{ padding: 14, borderRadius: 14, background: tint(d.division), border: `1px solid ${edge(d.division)}` }}>
          <div style={{ fontSize: 11, color: theme.colors.grey, marginBottom: 4 }}>
            {d.kind === 'None' ? 'Why there is no deliverable' : 'Summary: what was asked, what was found, next step'}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{d.summary}</p>
          {d.kind !== 'None' && (
            <a href={api.fileUrl(d.id)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', display: 'inline-block', marginTop: 12 }}>
              <Button>{d.kind === 'File' ? <><FileText size={14} /> Open {d.file_name}</> : <><ExternalLink size={14} /> Open link</>}</Button>
            </a>
          )}
        </div>

        {d.revision_note && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 12, background: theme.colors.red + '10', fontSize: 13 }}>
            <RotateCcw size={14} color={theme.colors.red} style={{ marginTop: 2, flexShrink: 0 }} />
            <span><strong>Revision requested:</strong> {d.revision_note}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
          <Fact label="Requester">{d.requester}</Fact>
          <Fact label="Analyst">{d.analyst_name ?? '—'}</Fact>
          <Fact label="Delivered">{fmtDate(d.uploaded_at)}</Fact>
          <Fact label="Ticket status">{d.ticket_status}</Fact>
          <Fact label="Deadline">{t ? fmtDate(t.deadline) : '…'}</Fact>
          <Fact label="Estimate → actual">
            {t ? (t.actual_hours != null ? `${t.pred_likely ?? '—'}h → ${t.actual_hours}h` : `${t.pred_likely ?? '—'}h est. (not closed yet)`) : '…'}
          </Fact>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.grey, marginBottom: 6 }}>Versions</div>
          {!t ? <Loading error={ticket.error} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {versions.map(v => (
                <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '6px 10px',
                  borderRadius: 10, background: v.id === d.id ? theme.colors.background : 'transparent' }}>
                  <Pill>v{v.version}</Pill>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.file_name ?? v.title ?? v.kind}</span>
                  <span style={{ color: theme.colors.grey, fontSize: 12 }}>{fmtDate(v.uploaded_at)}</span>
                  {v.requester_rating && <Pill color={v.requester_rating === 'Useful' ? theme.colors.sage : theme.colors.red}>{v.requester_rating}</Pill>}
                  {v.kind !== 'None' && <a href={api.fileUrl(v.id)} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: theme.colors.accent, fontWeight: 600 }}>Open</a>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.grey, marginBottom: 6 }}>Feedback on this ticket</div>
          {feedback.length === 0 ? <span style={{ fontSize: 13, color: theme.colors.grey }}>No feedback yet.</span> : <FeedbackList rows={feedback} />}
        </div>
      </div>
    </Modal>
  );
}

// ── Summary widgets ──────────────────────────────────────────────────────────────

function Widget({ title, icon: Icon, color, value, caption, children, onMore, more = 'View all' }: {
  title: string; icon: React.ElementType; color: string; value: ReactNode; caption: string;
  children: ReactNode; onMore: () => void; more?: string;
}) {
  return (
    <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 210 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={13} color={color} strokeWidth={1.8} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{title}</span>
        <button onClick={onMore} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: theme.colors.accent, fontWeight: 600 }}>{more}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 12, color: theme.colors.grey }}>{caption}</span>
      </div>
      {children}
    </section>
  );
}

function MiniBar({ label, value, max, text, color }: { label: string; value: number; max: number; text: string; color: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 54px', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ height: 6, borderRadius: 3, background: theme.colors.track, overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(100, max ? (100 * value) / max : 0)}%`, background: color, borderRadius: 3 }} />
      </span>
      <span style={{ textAlign: 'right', color: theme.colors.grey }}>{text}</span>
    </div>
  );
}

function ReworkWidget({ rows, error, onMore }: { rows?: RevisionRow[] | null; error: string | null; onMore: () => void }) {
  if (!rows) return <section style={card}><Loading error={error} /></section>;
  const delivered = rows.reduce((s, r) => s + r.delivered, 0);
  const revisions = rows.reduce((s, r) => s + r.revisions, 0);
  const top = [...rows].sort((a, b) => b.revisions / b.delivered - a.revisions / a.delivered).slice(0, 3);
  return (
    <Widget title="Quality check" icon={RotateCcw} color={theme.colors.red} onMore={onMore}
      value={`${delivered ? Math.round((100 * revisions) / delivered) : 0}%`} caption={`needed revision (${revisions} of ${delivered})`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {top.map(r => <MiniBar key={r.category} label={r.category} value={r.revisions} max={r.delivered}
          text={`${r.revisions}/${r.delivered}`} color={r.revisions ? theme.colors.red : theme.colors.sage} />)}
      </div>
    </Widget>
  );
}

function UnderWidget({ rows, error, onMore }: { rows?: UnderRow[] | null; error: string | null; onMore: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  if (!rows) return <section style={card}><Loading error={error} /></section>;
  const flagged = rows.filter(r => r.actual_over_estimate > 1.15);
  const max = Math.max(1.5, ...rows.map(r => r.actual_over_estimate));
  async function retrain() {
    setMsg('Retraining…');
    try {
      const r = await api.post<{ hours: { mae_model: number; mae_category_median: number }; live_tickets_added: number }>('/prediction/retrain', {});
      setMsg(`Retrained with ${r.live_tickets_added} live tickets: error ${r.hours.mae_model}h vs ${r.hours.mae_category_median}h baseline.`);
    } catch (e) { setMsg((e as Error).message); }
  }
  return (
    <Widget title="Underestimated types" icon={TrendingUp} color={theme.colors.sand} onMore={onMore}
      value={flagged.length} caption={flagged.length === 1 ? 'type runs >15% over estimate' : 'types run >15% over estimate'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.slice(0, 3).map(r => <MiniBar key={r.category} label={r.category} value={r.actual_over_estimate} max={max}
          text={`${r.actual_over_estimate}×`} color={r.actual_over_estimate > 1.15 ? theme.colors.sand : theme.colors.sage} />)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
        <Button small variant="outline" onClick={retrain}><RefreshCw size={11} /> Retrain with feedback</Button>
        {msg && <span style={{ fontSize: 11, color: theme.colors.grey }}>{msg}</span>}
      </div>
    </Widget>
  );
}

function FeedbackWidget({ rows, error, onMore }: { rows?: Feedback[] | null; error: string | null; onMore: () => void }) {
  if (!rows) return <section style={card}><Loading error={error} /></section>;
  const tooLow = rows.filter(f => f.estimate_rating === 'Too low').length;
  return (
    <Widget title="Feedback" icon={MessagesSquare} color={theme.colors.accent} onMore={onMore}
      value={rows.length} caption={`entries · ${tooLow} said "too low"`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.slice(0, 2).map(f => (
          <div key={f.id} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 10, background: theme.colors.background }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</strong>
              <span style={{ color: f.estimate_rating === 'Too low' ? theme.colors.red : theme.colors.grey }}>{f.estimate_rating ?? '—'}</span>
            </div>
            {f.comment && <div style={{ color: theme.colors.grey, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.comment}</div>}
          </div>
        ))}
        {rows.length === 0 && <span style={{ fontSize: 12, color: theme.colors.grey }}>No feedback yet.</span>}
      </div>
    </Widget>
  );
}

// ── Full lists for the "View all" modals ─────────────────────────────────────────

function ReworkList({ rows }: { rows: RevisionRow[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(r => <MiniBar key={r.category} label={r.category} value={r.revisions} max={r.delivered}
        text={`${r.revisions}/${r.delivered}`} color={r.revisions ? theme.colors.red : theme.colors.sage} />)}
      <p style={{ margin: '6px 0 0', fontSize: 12, color: theme.colors.grey }}>Deliverables marked "Needs revision" out of all delivered, per ticket type.</p>
    </div>
  );
}

function UnderList({ rows }: { rows: UnderRow[] }) {
  const max = Math.max(1.5, ...rows.map(r => r.actual_over_estimate));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(r => (
        <div key={r.category}>
          <MiniBar label={r.category} value={r.actual_over_estimate} max={max} text={`${r.actual_over_estimate}×`}
            color={r.actual_over_estimate > 1.15 ? theme.colors.sand : theme.colors.sage} />
          <div style={{ fontSize: 11, color: theme.colors.grey, marginLeft: 100 }}>{r.n_closed} closed · {r.too_low_votes} "too low" votes</div>
        </div>
      ))}
      <p style={{ margin: '6px 0 0', fontSize: 12, color: theme.colors.grey }}>Actual hours ÷ estimated hours on closed tickets. Above 1.15× is flagged.</p>
    </div>
  );
}

function FeedbackList({ rows }: { rows: Feedback[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
      {rows.map(f => (
        <div key={f.id} style={{ padding: '8px 12px', borderRadius: 10, background: theme.colors.background }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{f.title}</strong>
            <span style={{ color: theme.colors.grey, fontSize: 12 }}>{f.category} · {fmtDate(f.created_at)}{f.given_by ? ` · ${f.given_by}` : ''}</span>
            <span style={{ flex: 1 }} />
            {f.estimate_rating && <Pill color={f.estimate_rating === 'About right' ? theme.colors.sage : theme.colors.sand}>{f.estimate_rating}</Pill>}
          </div>
          <div style={{ fontSize: 12, marginTop: 2 }}>
            Estimate {f.pred_likely ?? '—'}h, actual {f.actual_hours ?? '—'}h
            {f.better_suited_name && <> · better suited: {f.better_suited_name}</>}
          </div>
          {f.comment && <div style={{ fontSize: 12, color: theme.colors.grey }}>{f.comment}</div>}
        </div>
      ))}
    </div>
  );
}
