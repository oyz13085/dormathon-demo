import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Image, Upload, X } from 'lucide-react';
import { theme } from '../theme';
import { useSession } from '../session';
import { Button, Notice, inputStyle } from './ui';
import { analystName, type CompletedWork } from './completedWork';
import {
  ATTACHMENT_RULES, REVISION_API_READY, REVISION_REASONS, addFiles, fileExtension, formatBytes,
  submitRevisionRequest, validateDraft, type DraftErrors, type RevisionDraft,
} from '../api/requesterRevisions';

const EMPTY: RevisionDraft = { reason: null, problem: '', location: '', requestedChanges: '', files: [] };

// Asking for changes, on unreviewed work or after marking it Useful (that review stays). The next upload is a new version
export function RevisionRequestForm({ work: w, onCancel, onSubmitted }: {
  work: CompletedWork; onCancel: () => void; onSubmitted: (message: string) => void;
}) {
  const { user, role } = useSession();   // role picks /requester/new or /analyst/new for the New request link
  const [draft, setDraft] = useState<RevisionDraft>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof DraftErrors, boolean>>>({});
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();

  const errors = validateDraft(draft);
  const valid = Object.keys(errors).length === 0;
  const show = (k: keyof DraftErrors) => touched[k] ? errors[k] : undefined;
  const set = <K extends keyof RevisionDraft>(k: K, v: RevisionDraft[K]) => setDraft(d => ({ ...d, [k]: v }));

  function take(list: FileList | null) {
    if (!list?.length) return;
    const { files, errors } = addFiles(draft.files, [...list]);
    set('files', files);
    setFileErrors(errors);
  }

  async function submit() {
    setTouched({ reason: true, problem: true, requestedChanges: true });
    if (!valid || !REVISION_API_READY || inFlight.current) return;
    inFlight.current = true; setPending(true); setSubmitError(null);
    try {
      const result = await submitRevisionRequest(w.latest.id, draft, user);
      const files = result.revision_request.attachments.length;
      // Report what the server says happened to the ticket, not what we expect
      onSubmitted(`Revision request sent${files ? ` with ${files} attachment${files === 1 ? '' : 's'}` : ''}. `
        + (result.ticket.status === 'In progress'
          ? `The ticket is back In progress with ${analystName(w)}.`
          : `The ticket is now ${result.ticket.status}.`));
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      inFlight.current = false; setPending(false);
    }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }} noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, borderRadius: 14,
        border: `1px solid ${theme.colors.track}`, background: theme.colors.background + '80' }}>
      <div>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Request a revision</h4>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: theme.colors.grey, lineHeight: 1.5 }}>
          {w.latest.requester_rating === 'Useful' ? 'Your Useful review stays in the history. ' : `The ticket goes back to ${analystName(w)} as In progress. `}
          {analystName(w)}'s next upload becomes version {w.latest.version + 1} for you to review.
        </p>
      </div>

      <fieldset style={{ margin: 0, padding: 0, border: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}
        aria-describedby={show('reason') ? `${id}-reason-err` : undefined}>
        <legend style={labelStyle}>Reason for revision <Required /></legend>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 6 }}>
          {REVISION_REASONS.map((r, i) => {
            const on = draft.reason === r.value;
            return (
              <label key={r.value} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                fontSize: 13, background: theme.colors.card,
                border: `1.5px solid ${on ? theme.colors.accent : theme.colors.track}`,
              }}>
                <input type="radio" name={`${id}-reason`} value={r.value} checked={on} autoFocus={i === 0}
                  onChange={() => { set('reason', r.value); setTouched(t => ({ ...t, reason: true })); }}
                  style={{ accentColor: theme.colors.accent, margin: 0 }} />
                {r.label}
              </label>
            );
          })}
        </div>
        <FieldError id={`${id}-reason-err`} message={show('reason')} />
        {draft.reason === 'additional_changes' && (
          <div role="status" style={{ marginTop: 4 }}>
            <Notice tone="info">
              <span style={{ fontSize: 12, lineHeight: 1.5 }}>
                Revisions are for changes within this ticket's original request. For substantial new work, such as a new
                analysis, dataset or deliverable, please <Link to={`/${role}/new`} style={{ color: theme.colors.accent, fontWeight: 600 }}>
                submit a New request</Link> instead.
              </span>
            </Notice>
          </div>
        )}
      </fieldset>

      <TextField id={`${id}-problem`} label="What is the problem?" required multiline
        hint="What's wrong or missing in the current version?"
        value={draft.problem} onChange={v => set('problem', v)} onBlur={() => setTouched(t => ({ ...t, problem: true }))}
        error={show('problem')} />

      <TextField id={`${id}-location`} label="Where should the analyst look?"
        hint="Optional. For example a page, slide, sheet tab or chart name."
        value={draft.location} onChange={v => set('location', v)} />

      <TextField id={`${id}-changes`} label="What changes do you want?" required multiline
        hint="Describe the result you expect in the next version."
        value={draft.requestedChanges} onChange={v => set('requestedChanges', v)}
        onBlur={() => setTouched(t => ({ ...t, requestedChanges: true }))} error={show('requestedChanges')} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span id={`${id}-files-label`} style={labelStyle}>
          Supporting attachments <span style={{ fontWeight: 400, color: theme.colors.grey }}>(Optional)</span>
        </span>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '14px 16px', borderRadius: 12,
            border: `1.5px dashed ${dragging ? theme.colors.accent : theme.colors.grey + '80'}`,
            background: dragging ? theme.colors.accent + '0D' : theme.colors.card,
          }}>
          <Button variant="outline" small onClick={() => fileInput.current?.click()}
            disabled={draft.files.length >= ATTACHMENT_RULES.maxFiles}>
            <Upload size={12} aria-hidden="true" /> Add files
          </Button>
          <span id={`${id}-files-hint`} style={{ fontSize: 12, color: theme.colors.grey, flex: 1, minWidth: 200, lineHeight: 1.5 }}>
            Drop files here, or add annotated screenshots and documents. PNG, JPG, PDF, CSV or XLSX,
            up to {ATTACHMENT_RULES.maxFiles} files and {formatBytes(ATTACHMENT_RULES.maxFileBytes)} each.
          </span>
          <input ref={fileInput} type="file" multiple accept={ATTACHMENT_RULES.accept} hidden
            aria-labelledby={`${id}-files-label`} aria-describedby={`${id}-files-hint`}
            onChange={e => { take(e.target.files); e.target.value = ''; }} />
        </div>

        {fileErrors.length > 0 && (
          <div role="alert">
            <Notice tone="warn">
              <ul style={{ margin: 0, paddingLeft: 18 }}>{fileErrors.map(m => <li key={m}>{m}</li>)}</ul>
            </Notice>
          </div>
        )}

        {draft.files.length > 0 && (
          <ul aria-label="Attached files" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {draft.files.map((f, i) => {
              const isImage = ['png', 'jpg', 'jpeg'].includes(fileExtension(f.name));
              const Icon = isImage ? Image : FileText;
              return (
                <li key={`${f.name}-${f.size}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 10, background: theme.colors.card, border: `1px solid ${theme.colors.track}` }}>
                  <Icon size={15} color={theme.colors.grey} strokeWidth={1.5} aria-hidden="true" />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <span style={{ fontSize: 12, color: theme.colors.grey, whiteSpace: 'nowrap' }}>{formatBytes(f.size)}</span>
                  <button type="button" aria-label={`Remove ${f.name}`}
                    onClick={() => { set('files', draft.files.filter((_, j) => j !== i)); setFileErrors([]); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, lineHeight: 0, borderRadius: 6 }}>
                    <X size={14} color={theme.colors.grey} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!REVISION_API_READY && (
        <div>
          <Notice tone="info">
            <strong>Sending isn't available yet.</strong> FairQueue needs a backend update before it can keep your Useful
            review in the history and store attachments. Nothing has been sent, and the ticket is still closed.
          </Notice>
        </div>
      )}
      {submitError && <Notice tone="error">{submitError}</Notice>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button type="submit" variant="danger" disabled={!REVISION_API_READY || pending}>
          {pending ? 'Sending…' : 'Send revision request'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}

const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: theme.colors.ink, padding: 0 };

function Required() {
  return <span aria-hidden="true" style={{ color: theme.colors.red }}>*</span>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span id={id} style={{ fontSize: 12, color: theme.colors.red }}>{message}</span> : null;
}

function TextField({ id, label, hint, required, multiline, value, onChange, onBlur, error }: {
  id: string; label: string; hint?: ReactNode; required?: boolean; multiline?: boolean;
  value: string; onChange: (v: string) => void; onBlur?: () => void; error?: string;
}) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  const common = {
    id, value, required, onBlur, 'aria-invalid': !!error, 'aria-describedby': describedBy,
    style: { ...inputStyle, borderColor: error ? theme.colors.red : theme.colors.track, ...(multiline ? { resize: 'vertical' as const } : {}) },
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label htmlFor={id} style={labelStyle}>{label} {required && <Required />}</label>
      {hint && <span id={`${id}-hint`} style={{ fontSize: 12, color: theme.colors.grey }}>{hint}</span>}
      {multiline
        ? <textarea {...common} rows={3} onChange={e => onChange(e.target.value)} />
        : <input {...common} type="text" onChange={e => onChange(e.target.value)} />}
      <FieldError id={`${id}-err`} message={error} />
    </div>
  );
}
