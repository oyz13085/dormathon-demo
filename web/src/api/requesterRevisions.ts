// Revision requests, including after the requester has already marked work Useful.
// POST /requester/deliverables/{id}/revision-requests keeps every earlier review and stores the files
// apart from the analyst's deliverables. Set REVISION_API_READY to false to switch sending off again.
import { API_BASE, qs } from './client';

export const REVISION_API_READY = true;

export type RevisionReason = 'fix_issue' | 'clarify_improve' | 'additional_changes';

export const REVISION_REASONS: { value: RevisionReason; label: string }[] = [
  { value: 'fix_issue', label: 'Fix an error or issue' },
  { value: 'clarify_improve', label: 'Clarify or improve existing work' },
  { value: 'additional_changes', label: 'Request additional changes' },
];

export interface RevisionDraft {
  reason: RevisionReason | null;
  problem: string;
  location: string;            // optional: where the analyst should look
  requestedChanges: string;
  files: File[];
}

// A saved revision request. Attachments belong to the request, not to any deliverable version
export interface RevisionRequest {
  id: number;
  review_id: number;               // the Needs revision review this request belongs to
  deliverable_id: number;
  ticket_id: number;
  reason: RevisionReason;
  reason_label: string;
  problem: string;
  location: string | null;
  requested_changes: string;
  attachments: { id: number; file_name: string; file_type: string; size_bytes: number; url: string }[];   // url is an API path
  created_by: string;
  created_at: string;
}

// A ticket's revision requests, oldest first. The server allows only the requester and the assigned analyst
export const ticketRevisionRequestsPath = (ticketId: number, user: string) =>
  `/requester/tickets/${ticketId}/revision-requests${qs({ user })}`;

// ── File rules ─────────────────────────────────────────────────────────────────

export const ATTACHMENT_RULES = {
  extensions: ['png', 'jpg', 'jpeg', 'pdf', 'csv', 'xlsx'],
  accept: '.png,.jpg,.jpeg,.pdf,.csv,.xlsx,image/png,image/jpeg,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  maxFiles: 5,
  maxFileBytes: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
};

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Adds what fits and explains what doesn't. Checks the extension, since Windows often reports CSV without a MIME type
export function addFiles(current: File[], incoming: File[]): { files: File[]; errors: string[] } {
  const files = [...current];
  const errors: string[] = [];
  const { extensions, maxFiles, maxFileBytes, maxTotalBytes } = ATTACHMENT_RULES;
  for (const f of incoming) {
    if (!extensions.includes(fileExtension(f.name))) {
      errors.push(`${f.name}: only PNG, JPG, PDF, CSV and XLSX files can be attached.`); continue;
    }
    if (f.size === 0) { errors.push(`${f.name} is empty.`); continue; }
    if (f.size > maxFileBytes) { errors.push(`${f.name} is ${formatBytes(f.size)}; the limit is ${formatBytes(maxFileBytes)} per file.`); continue; }
    if (files.some(x => x.name === f.name && x.size === f.size)) { errors.push(`${f.name} is already attached.`); continue; }
    if (files.length >= maxFiles) { errors.push(`You can attach up to ${maxFiles} files; ${f.name} wasn't added.`); continue; }
    if (files.reduce((s, x) => s + x.size, 0) + f.size > maxTotalBytes) {
      errors.push(`${f.name} wasn't added: attachments can total at most ${formatBytes(maxTotalBytes)}.`); continue;
    }
    files.push(f);
  }
  return { files, errors };
}

// ── Form validation ────────────────────────────────────────────────────────────

export type DraftErrors = Partial<Record<'reason' | 'problem' | 'requestedChanges', string>>;

// Attachments are optional: files are only checked when added (see addFiles), never required here
export function validateDraft(d: RevisionDraft): DraftErrors {
  const e: DraftErrors = {};
  if (!d.reason) e.reason = 'Choose a reason for the revision.';
  if (!d.problem.trim()) e.problem = 'Describe the problem.';
  if (!d.requestedChanges.trim()) e.requestedChanges = 'Describe the changes you want.';
  return e;
}

// ── Submission (enabled once the backend is ready) ─────────────────────────────

export function buildRevisionForm(d: RevisionDraft, requester: string): FormData {
  const form = new FormData();
  form.append('requester', requester);
  form.append('reason', d.reason ?? '');
  form.append('problem', d.problem.trim());
  if (d.location.trim()) form.append('location', d.location.trim());
  form.append('requested_changes', d.requestedChanges.trim());
  d.files.forEach(f => form.append('files', f, f.name));
  return form;
}

export interface RevisionResult {
  revision_request: RevisionRequest;
  ticket: { id: number; status: string };   // the server's word on whether the ticket reopened
}

export async function submitRevisionRequest(deliverableId: number, d: RevisionDraft, requester: string): Promise<RevisionResult> {
  if (!REVISION_API_READY) throw new Error("Revision requests can't be sent yet: the backend endpoint isn't available.");
  const res = await fetch(`${API_BASE}/requester/deliverables/${deliverableId}/revision-requests`, {
    method: 'POST', body: buildRevisionForm(d, requester),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try { const body = await res.json(); detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body); } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return res.json() as Promise<RevisionResult>;
}
