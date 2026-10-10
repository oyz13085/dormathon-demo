// Leave advisor (/leave-advisor/*). Mirrors backend/fairqueue/leave_advisor/schemas.py.
// Advisory only: nothing here reassigns a ticket or approves leave. The Team Lead decides both.
import { api } from './client';
import type { Leave, WhatIf } from './types';

export interface LeaveInput {
  analyst_id: number;
  start_date: string;
  end_date: string;
}

// Rule-based score from permitted parts only; not produced by the AI. A part with value null has no data
export interface Suitability {
  score: number | null;
  method: 'rule-based';
  parts: { key: 'skills' | 'experience' | 'domain' | 'capacity' | 'deadline'; label: string; value: number | null; weight: number }[];
  skills: { declared: string[]; lists_this_type: boolean };
  experience: { closed_this_type: number; closed_for_department: number; closed_total: number };
  capacity: { booked_hours_now: number; booked_hours_after: number; hours_ahead_in_queue: number;
              working_hours_before_deadline: number; handover_overhead_hours: number; finish_if_taken: string | null; fits: boolean };
}

export type Choice = 'keep' | 'reassign';

export interface Suggestion {
  ticket_id: number;
  title: string;
  deadline: string;
  priority: string;
  status: string;
  impact: string;
  recommended: { id: number; name: string; role: string | null } | null;
  suitability: Suitability | null;
  reason: string;
  urgency: { level: string; risk: 'High' | 'Medium' | 'Low'; why: string };
  projected_completion: string | null;       // if reassigned to the recommended colleague
  projected_if_kept: string | null;
  proposed_revised_deadline: string | null;  // a proposal only; the official deadline never changes
  suggested_deadline: string | null;         // original date if the forecast meets it, else the forecast; null = none
  team_effect: { colleague: string; hours_now: number; hours_after: number; extra_hours: number;
                 their_tickets_pushed_at_risk: number } | null;
  decided_by: 'ai' | 'rule_based' | 'rejected' | 'blocked';
  handover_feasible: 'yes' | 'no' | 'unknown';
}

export interface Suggestions {
  valid: boolean;
  errors: string[];
  warnings: string[];
  leave?: { start_date: string; end_date: string; return_date: string };
  calendar?: { configured: boolean; label: string; detail: string };
  source?: 'ai' | 'rule_based' | 'none_needed';
  ai?: { status: 'ok' | 'unavailable' | 'disabled' | 'not_needed'; provider: string; reason: string | null;
         model: string | null; request_ids: string[]; turns: number; reused?: boolean };
  tickets: Suggestion[];
  stats?: { affected: number; reassigned: number; by_urgency: Record<string, number>; urgent_handovers: number;
            extra_team_hours: number; extra_hours_by_colleague: Record<string, number>; at_risk_if_kept: number;
            without_replacement: number };
  reassigned: { ticket_id: number; title: string; priority: string; deadline: string;
                to: { id: number; name: string; role: string | null }; still_with_them: boolean; decided_by_ai: boolean }[];
  note?: string;
  cached: boolean;
}

// The one call that may invoke the AI. The backend caches it per analyst, dates and data
export const previewLeave = (b: LeaveInput) => api.post<Suggestions>('/leave-advisor/preview', b);
export const submitLeave = (b: LeaveInput & { reason?: string; choices: Record<number, Choice> }) =>
  api.post<{ leave: Leave; plan_id: number; whatif: WhatIf; reassigned: false;
             proposed_handovers: { ticket_id: number; title: string; to: { id: number; name: string } }[] }>('/leave-advisor/requests', b);

// Hands one of your own tickets to its recommended colleague now (the backend re-checks everything first)
export const reassignTicket = (b: LeaveInput & { ticket_id: number; to_analyst_id: number; user: string }) =>
  api.post<{ ticket: { id: number; assignee_id: number; assignee_name: string; deadline: string }; handover_id: number;
             to: { id: number; name: string; role: string | null }; decided_by_ai: boolean; suggestions: Suggestions }>(
    '/leave-advisor/reassign', b);
