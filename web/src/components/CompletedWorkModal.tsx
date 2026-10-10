import { useRef, useState } from 'react';
import { Download, ExternalLink, FileText, Paperclip, RotateCcw, ThumbsUp } from 'lucide-react';
import { theme } from '../theme';
import { api } from '../api/client';
import { apiUrl, postReview, type Review } from '../api/requester';
import { formatBytes, type RevisionRequest } from '../api/requesterRevisions';
import { useSession } from '../session';
import { StatusPill } from './StatusPill';
import { DepartmentChip } from './DepartmentChip';
import { Button, Detail, Modal, Notice, Pill, SectionTitle, fmtDate } from './ui';
import { REVIEW_COLOR, analystName, canReview, reviewStatus, safeUrl, type CompletedWork, type WorkVersion } from './completedWork';
import { RevisionRequestForm } from './RevisionRequestForm';

export function CompletedWorkModal({ work: w, onClose }: { work: CompletedWork; onClose: () => void }) {
  const status = reviewStatus(w);
  // History is worth showing once there's more than the current review to tell
  const hasHistory = w.versions.length > 1
    || w.versions.some(v => v.reviews.length > 1 || v.revision_requests.length > 0);

  return (
    <Modal title={w.latest.ticket_title} onClose={onClose} width={660} centered>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, fontSize: 13 }}>
        <span style={{ fontSize: 12, color: theme.colors.grey, marginTop: -8 }}>Ticket #{w.ticketId} · Version {w.latest.version}</span>

        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '16px 24px' }}>
          <Detail label="Department"><DepartmentChip dept={w.latest.division} size="sm" /></Detail>
          <Detail label="Assigned analyst">{analystName(w)}</Detail>
          <Detail label="Completed">{fmtDate(w.latest.uploaded_at)}</Detail>
          <Detail label="Deliverable version">Version {w.latest.version}</Detail>
          <Detail label="Review status"><Pill color={REVIEW_COLOR[status]}>{status}</Pill></Detail>
          <Detail label="Ticket status"><StatusPill status={w.latest.ticket_status} /></Detail>
        </dl>

        <section>
          <SectionTitle>Original request</SectionTitle>
          <Prose text={w.description} empty="No description was provided." />
        </section>

        <section>
          <SectionTitle>Completed work summary</SectionTitle>
          <Prose text={w.latest.summary} empty="The analyst didn't add a summary." />
        </section>

        <section>
          <SectionTitle>Files and links{hasHistory ? ` · version ${w.latest.version}` : ''}</SectionTitle>
          {w.latest.kind === 'None'
            ? <p style={{ margin: 0, color: theme.colors.grey }}>No files or links were attached.</p>
            : <Attachment d={w.latest} />}
        </section>

        {hasHistory && (
          <section>
            <SectionTitle>Version history</SectionTitle>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {w.versions.map(v => <li key={v.id}><VersionEntry v={v} current={v.id === w.latest.id} /></li>)}
            </ol>
          </section>
        )}

        <ReviewPanel work={w} />
      </div>
    </Modal>
  );
}

function Prose({ text, empty }: { text?: string | null; empty: string }) {
  return text?.trim()
    ? <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</p>
    : <p style={{ margin: 0, color: theme.colors.grey }}>{empty}</p>;
}

const linkStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, color: theme.colors.accent, fontWeight: 600,
  fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap',
};

function Attachment({ d }: { d: WorkVersion }) {
  const isFile = d.kind === 'File';
  const url = isFile ? api.fileUrl(d.id) : safeUrl(d.url);
  const name = isFile ? (d.file_name ?? 'File') : (d.title || d.url || 'Link');
  const sub = isFile ? (d.file_type ? d.file_type.toUpperCase() : 'File') : (url ? hostname(url) : 'Link');
  const Icon = isFile ? FileText : ExternalLink;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12,
      border: `1px solid ${theme.colors.track}`, background: theme.colors.card }}>
      <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 8, background: theme.colors.track, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={15} color={theme.colors.ink} strokeWidth={1.5} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ display: 'block', fontSize: 12, color: theme.colors.grey }}>{sub}</span>
      </span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" style={linkStyle}
          aria-label={`${isFile ? 'Download' : 'Open'} ${name} (opens in a new tab)`}>
          {isFile ? <><Download size={13} aria-hidden="true" /> Download</> : <>Open <ExternalLink size={13} aria-hidden="true" /></>}
        </a>
      ) : <span style={{ fontSize: 12, color: theme.colors.grey }}>Link unavailable</span>}
    </div>
  );
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function VersionEntry({ v, current }: { v: WorkVersion; current: boolean }) {
  const requestFor = (r: Review) => v.revision_requests.find(q => q.review_id === r.id);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderRadius: 12,
      border: `1px solid ${theme.colors.track}`, background: current ? theme.colors.card : theme.colors.background + '80' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Version {v.version}</strong>
        {current && <Pill color={theme.colors.accent}>Current</Pill>}
        <span style={{ fontSize: 12, color: theme.colors.grey, flex: 1 }}>Submitted {fmtDate(v.uploaded_at)} · {v.analyst_name ?? '—'}</span>
        <Pill color={REVIEW_COLOR[v.review_status]}>{v.review_status}</Pill>
      </div>
      <Prose text={v.summary} empty="No summary." />
      {v.kind !== 'None' && !current && <Attachment d={v} />}

      {v.reviews.length > 0 && (
        <ol aria-label={`Reviews of version ${v.version}`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {v.reviews.map(r => <li key={r.id}><ReviewEntry r={r} request={requestFor(r)} /></li>)}
        </ol>
      )}
    </div>
  );
}

function ReviewEntry({ r, request }: { r: Review; request?: RevisionRequest }) {
  const when = r.created_at ? fmtDate(r.created_at) : 'time not recorded';
  const who = r.reviewed_by ?? (r.source === 'legacy' ? 'earlier review' : '—');
  return (
    <div style={{ paddingLeft: 10, borderLeft: `2px solid ${REVIEW_COLOR[r.rating]}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
        <Pill color={REVIEW_COLOR[r.rating]}>{r.rating}</Pill>
        <span style={{ color: theme.colors.grey }}>{who} · {when}</span>
      </span>
      {request ? <RequestDetails q={request} /> : r.note && (
        <p style={{ margin: 0, fontSize: 12 }}><span style={{ color: theme.colors.grey }}>Revision reason: </span>{r.note}</p>
      )}
    </div>
  );
}

// Also used by the analyst's RevisionDetailsModal, so both sides see a request the same way
export function RequestDetails({ q }: { q: RevisionRequest }) {
  const row = (label: string, text: string) => (
    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
      <span style={{ color: theme.colors.grey }}>{label}: </span>{text}
    </p>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {row('Reason', q.reason_label)}
      {row('Problem', q.problem)}
      {q.location && row('Where to look', q.location)}
      {row('Changes wanted', q.requested_changes)}
      {q.attachments.length > 0 && (
        <ul aria-label="Revision attachments" style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {q.attachments.map(a => (
            <li key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <Paperclip size={12} color={theme.colors.grey} aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file_name}</span>
              <span style={{ color: theme.colors.grey }}>{formatBytes(a.size_bytes)}</span>
              <a href={apiUrl(a.url)} target="_blank" rel="noopener noreferrer" style={linkStyle}
                aria-label={`Download ${a.file_name} (opens in a new tab)`}>
                <Download size={12} aria-hidden="true" /> Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewPanel({ work: w }: { work: CompletedWork }) {
  const { user, refresh } = useSession();
  const [mode, setMode] = useState<'choose' | 'revise'>('choose');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const inFlight = useRef(false);   // blocks a second click before React re-renders
  const choices = useRef<HTMLDivElement>(null);   // Button has no ref; focus goes back to Needs revision through this
  // Asking for more changes after Useful: only the newest version, and only while the ticket is closed
  const [revisingUseful, setRevisingUseful] = useState(false);
  const requestRevisionButton = useRef<HTMLButtonElement>(null);
  const canReviseUseful = w.latest.requester_rating === 'Useful' && w.latest.ticket_status === 'Closed';
  const lastRequest = w.latest.revision_requests.at(-1);

  // Needs revision goes through RevisionRequestForm, the same structured request as after Useful
  async function markUseful() {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      await postReview(w.latest.id, user, 'Useful');
      setSaved('Saved. You marked this work as useful.');
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false; setPending(false);
    }
  }

  const box: React.CSSProperties = { paddingTop: 16, borderTop: `1px solid ${theme.colors.track}`, display: 'flex', flexDirection: 'column', gap: 6 };

  if (saved || !canReview(w)) {
    const rating = w.latest.requester_rating;
    return (
      <section style={box} aria-live="polite">
        <SectionTitle>Your review</SectionTitle>
        {saved && <Notice tone="ok">{saved}</Notice>}
        {!saved && rating === 'Useful' && <p style={{ margin: 0 }}>You marked this work as useful.</p>}
        {canReviseUseful && !revisingUseful && (
          <div style={{ marginTop: 6 }}>
            <button ref={requestRevisionButton} type="button" onClick={() => setRevisingUseful(true)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: theme.radius.pill,
              border: `1.5px solid ${theme.colors.red}`, background: 'transparent', color: theme.colors.red,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <RotateCcw size={12} aria-hidden="true" /> Request revision
            </button>
          </div>
        )}
        {canReviseUseful && revisingUseful && (
          <div style={{ marginTop: 6 }}>
            <RevisionRequestForm work={w}
              onCancel={() => { setRevisingUseful(false); setTimeout(() => requestRevisionButton.current?.focus()); }}
              onSubmitted={message => { setRevisingUseful(false); setSaved(message); refresh(); }} />
          </div>
        )}
        {!saved && rating === 'Needs revision' && (
          <p style={{ margin: 0 }}>
            You asked for a revision
            {lastRequest ? <>: <em>{lastRequest.reason_label.toLowerCase()}</em>.</> : w.latest.revision_note ? <>: <em>{w.latest.revision_note}</em></> : '.'}
            {w.latest.ticket_status !== 'Closed' && <> {analystName(w)} is working on the next version.</>}
          </p>
        )}
        {!rating && <p style={{ margin: 0, color: theme.colors.grey }}>This work can be reviewed once the ticket is closed.</p>}
      </section>
    );
  }

  return (
    <section style={box} aria-live="polite">
      <SectionTitle>Was this what you needed?</SectionTitle>
      {error && <Notice tone="error">{error}</Notice>}
      {mode === 'choose' ? (
        <div ref={choices} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={markUseful} disabled={pending}>
            <ThumbsUp size={13} aria-hidden="true" /> {pending ? 'Saving…' : 'Useful'}
          </Button>
          <Button variant="danger" onClick={() => { setMode('revise'); setError(null); }} disabled={pending}>
            <RotateCcw size={13} aria-hidden="true" /> Needs revision
          </Button>
        </div>
      ) : (
        <RevisionRequestForm work={w}
          onCancel={() => { setMode('choose'); setTimeout(() => choices.current?.querySelectorAll('button')[1]?.focus()); }}
          onSubmitted={message => { setMode('choose'); setSaved(message); refresh(); }} />
      )}
    </section>
  );
}
