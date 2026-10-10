import { theme } from '../theme';
import type { Dept, TicketStatus } from '../api/types';
import type { ApiCompletedItem, ApiVersion } from '../api/requester';

// A version as the cards and modal use it: the API version plus its ticket's title, department and status
export interface WorkVersion extends ApiVersion {
  ticket_title: string;
  division: Dept;
  ticket_status: TicketStatus;
}

// One ticket's delivered work, loaded from GET /requester/completed-work
export interface CompletedWork {
  ticketId: number;
  latest: WorkVersion;
  versions: WorkVersion[];        // newest first
  description: string | null;     // the original request
  assigneeName: string | null;
}

export function fromApi(items: ApiCompletedItem[]): CompletedWork[] {
  return items.filter(i => i.versions.length > 0).map(i => {
    const versions = i.versions.map(v => ({ ...v, ticket_title: i.title, division: i.division, ticket_status: i.status }));
    return { ticketId: i.ticket_id, latest: versions[0], versions, description: i.description, assigneeName: i.assignee_name };
  });
}

export type ReviewStatus = 'Awaiting review' | 'Useful' | 'Needs revision';

export const REVIEW_COLOR: Record<ReviewStatus, string> = {
  'Awaiting review': theme.colors.sand, Useful: theme.colors.sage, 'Needs revision': theme.colors.red,
};

export function reviewStatus(w: CompletedWork): ReviewStatus {
  return w.latest.requester_rating ?? 'Awaiting review';
}

// Only the newest version of a closed ticket can be rated, and only once (the server enforces this too)
export function canReview(w: CompletedWork): boolean {
  return !w.latest.requester_rating && w.latest.ticket_status === 'Closed';
}

export function attachments(w: CompletedWork): WorkVersion[] {
  return w.versions.filter(d => d.kind !== 'None');
}

export function analystName(w: CompletedWork): string {
  return w.assigneeName ?? w.latest.analyst_name ?? '—';
}

// Links come from analysts; only ever render http(s) ones as clickable
export function safeUrl(url?: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export type ReviewFilter = 'All' | 'Awaiting review' | 'Reviewed';
export const REVIEW_FILTERS: ReviewFilter[] = ['All', 'Awaiting review', 'Reviewed'];

// Reviewed means the newest version has a rating, Useful or Needs revision
export function matchesReviewFilter(w: CompletedWork, f: ReviewFilter): boolean {
  return f === 'All' || (f === 'Reviewed') === !!w.latest.requester_rating;
}
