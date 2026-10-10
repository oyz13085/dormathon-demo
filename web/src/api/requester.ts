// Requester API (/requester/*): completed work with full review history, and reviews.
import { API_BASE, api, qs } from './client';
import type { Dept, TicketStatus } from './types';
import type { RevisionRequest } from './requesterRevisions';

export type Rating = 'Useful' | 'Needs revision';

// One entry in a version's review history. Reviews are only ever added, never changed
export interface Review {
  id: number;
  rating: Rating;
  note: string | null;
  reviewed_by: string | null;     // null for ratings imported from before history was kept
  source: 'requester' | 'legacy';
  created_at: string | null;      // null when the time wasn't recorded
}

export interface ApiVersion {
  id: number;                      // deliverable id
  ticket_id: number;
  version: number;
  kind: 'File' | 'Link' | 'None';
  title: string | null;
  file_name: string | null;
  file_type: string | null;
  url: string | null;
  summary: string | null;
  uploaded_at: string;
  analyst_name: string | null;
  requester_rating: Rating | null;
  revision_note: string | null;
  file_url: string | null;         // path on the API, for File deliverables
  review_status: 'Awaiting review' | Rating;
  reviews: Review[];
  revision_requests: RevisionRequest[];
}

export interface ApiCompletedItem {
  ticket_id: number;
  title: string;
  division: Dept;
  category: string | null;
  description: string | null;
  status: TicketStatus;
  assignee_name: string | null;
  versions: ApiVersion[];          // newest first
}

export const completedWorkPath = (requester: string) => `/requester/completed-work${qs({ requester })}`;

export const postReview = (deliverableId: number, requester: string, rating: Rating, note?: string) =>
  api.post<unknown>(`/requester/deliverables/${deliverableId}/reviews`, { requester, rating, note });

// API paths come back relative; the browser needs the API host in front
export const apiUrl = (path: string) => `${API_BASE}${path}`;
