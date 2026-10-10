// Shapes returned by the FairQueue API (backend/fairqueue). Keep in sync with the engines.

export type Dept = "HR" | "IT" | "Finance" | "Marketing";
export type Priority = "Low" | "Medium" | "High" | "Critical";
export type TicketStatus = "Unassigned" | "Assigned" | "In progress" | "Waiting" | "Closed";
export type Role = "requester" | "analyst" | "lead";

export interface Meta {
  departments: Dept[];
  categories: string[];
  analysts: { id: number; name: string; role_title?: string }[];
  requesters: { name: string; division: Dept | null; is_analyst?: boolean }[];
  llm: { model: string; enabled: boolean };
  alerts: { threshold: number; max_per_day: number };
}

export interface Ticket {
  id: number;
  requester: string;
  title: string;
  division: Dept;
  description?: string | null;
  category?: string | null;
  priority: Priority;
  status: TicketStatus;
  assignee_id?: number | null;
  assignee_name?: string | null;
  deadline: string;
  pred_low?: number;
  pred_likely?: number;
  pred_high?: number;
  confidence?: "High" | "Low";
  created_at?: string;
  closed_at?: string | null;
  actual_hours?: number | null;
  deliverable_count?: number;
  // risk (lead, and the analyst's own queue)
  p_miss?: number | null;
  cause?: string | null;
  explanation?: string | null;
  facts?: string[] | null;
  action?: string | null;
  alert?: boolean;
  expected_completion?: string | null;
  expected_note?: string;
  relation?: "assigned" | "requested";
}

export interface Counts {
  total: number;
  solved: number;
  in_progress: number;
  unassigned: number;
  waiting: number;
  hours_in_queue?: number;
  missed: number;
  at_risk?: number;
}
export interface DeptCounts extends Counts { division: Dept }
export interface Summary { team: Counts | null; departments: DeptCounts[] }

export interface RiskItem {
  ticket_id: number;
  ticket_title: string;
  division: Dept;
  priority: Priority;
  status: TicketStatus;
  deadline: string;
  assignee_name?: string | null;
  p_miss: number;
  cause: string;
  explanation: string;
  facts: string[];
  action: string;
  impact: number;
  risk_x_impact: number;
  hours_needed: number;
  hours_available: number;
  expected_completion?: string | null;
  alert: boolean;
}
export interface RiskList {
  threshold: number;
  cap_per_day: number;
  alerts: RiskItem[];
  suppressed: number;
  watch: RiskItem[];
}

export interface Candidate {
  analyst_id: number;
  name: string;
  fit: number;
  breakdown: { skill: number; track: number; pairing: number; capacity: number; deadline: number };
  past_in_category: number;
  past_with_requester: number;
  free_hours: number;
  open_hours: number;
  low_confidence: boolean;
  p_handover: number;
  explanation: string;
  load_penalty: number;
}

export interface SimilarWork {
  deliverable_id: number;
  ticket_id: number;
  title: string;
  summary?: string;
  delivered_on: string;
  division: Dept;
  score: number;
}

export interface RecommendationCard {
  ticket_id: number;
  title: string;
  division: Dept;
  category: string;
  hours: { low: number; likely: number; high: number };
  confidence: "High" | "Low";
  thresholds: { good_fit: number; poor_fit: number };
  decision: "good" | "possible" | "poor" | "low_confidence" | "no_partner";
  note: string;
  explanation: string;
  facts: string[];
  recommended: Candidate | null;
  usual_partner: Candidate | null;
  support: Candidate | null;
  candidates: Candidate[];
  similar_work?: SimilarWork[];
  current_assignee_id?: number | null;
}

export interface Suggestion {
  category: string;
  category_method: string;
  confidence: "High" | "Low";
  priority: Priority;
  priority_reason: string;
  priority_method: "llm" | "rule-based";
  hours: { low: number; likely: number; high: number; method: string };
  recommendation: {
    decision: RecommendationCard["decision"];
    note?: string;
    explanation?: string;
    recommended: Pick<Candidate, "analyst_id" | "name" | "fit" | "explanation" | "low_confidence"> | null;
    usual_partner: Pick<Candidate, "analyst_id" | "name" | "fit" | "explanation" | "low_confidence"> | null;
    support: Pick<Candidate, "analyst_id" | "name" | "fit" | "explanation" | "low_confidence"> | null;
  };
  similar_work: SimilarWork[];
}

export interface Deliverable {
  id: number;
  ticket_id: number;
  ticket_title: string;
  ticket_status: TicketStatus;
  division: Dept;
  category: string;
  requester: string;
  kind: "File" | "Link" | "None";
  title?: string | null;
  file_name?: string | null;
  url?: string | null;
  file_type?: string | null;
  summary?: string | null;
  version: number;
  requester_rating?: "Useful" | "Needs revision" | null;
  revision_note?: string | null;
  uploaded_at: string;
  analyst_name?: string | null;
}

export interface Workload {
  analyst_id: number;
  name: string;
  role_title?: string;
  skills: string[];
  weekly_hours: number;
  open_hours: number;
  open_tickets: number;
}

export interface WhatIf {
  analyst_id: number;
  analyst_name: string;
  start_date: string;
  end_date: string;
  summary: string;
  broken: {
    ticket_id: number; title: string; division: Dept; priority: Priority; deadline: string;
    p_miss_before: number | null; p_miss_after: number; hours: number;
    takeover: { analyst_id: number; name: string; fit: number; p_miss_if_moved: number; explanation: string } | null;
  }[];
  unaffected: { ticket_id: number; title: string; deadline: string; p_miss_after: number }[];
}

export interface Leave {
  id: number;
  analyst_id: number;
  analyst_name: string;
  start_date: string;
  end_date: string;
  reason?: string | null;
  status: "Requested" | "Approved" | "Rejected";
  whatif?: WhatIf;
}

export interface ForecastWeek {
  week_start: string;
  label: string;
  demand_hours: number;
  capacity_hours: number;
  over_capacity: boolean;
  departments: Record<Dept, { hours: number; usual: number; season: boolean; spike: boolean; reason: string | null }>;
  spikes: Dept[];
  message: string;
}
export interface Forecast { weeks: ForecastWeek[]; method: string }

export interface FitSettings {
  w_skill: number; w_track: number; w_pairing: number; w_capacity: number; w_deadline: number;
  good_fit: number; poor_fit: number; updated_by?: string; updated_at?: string;
}

export interface SkillAdjustment {
  id: number; analyst_id: number; analyst_name: string; category: string; adjustment: number;
  reason?: string; set_by: string; approved: number; created_at: string;
}

export interface Feedback {
  id: number; ticket_id: number; title: string; category: string; given_by?: string; role?: string;
  actual_hours?: number; pred_likely?: number; estimate_rating?: string; better_suited_name?: string;
  comment?: string; created_at: string;
}

export interface PolicyResult {
  missed_deadlines: number; missed_pct: number; handovers_per_100: number; workload_spread_hours: number;
  alert_precision: number; alert_recall: number; alerts_per_day: number; cause_label_accuracy: number;
  by_department: Record<string, number>;
}
export interface Replay {
  data_source: "synthetic" | "mendeley";
  data_note: string;
  n_train: number; n_test: number; test_period: [string, string];
  focus_hours_per_day: number;
  assumptions: string[];
  policies: Record<string, PolicyResult>;
  checks: {
    simulator: { real_missed: number; simulated_missed: number; passes: boolean; calibration_median_close_error_hours: number };
    agreement: { n_matched: number; n_not_matched: number; missed_pct_when_matched: number | null; missed_pct_when_not: number | null };
    conservative: { fairqueue_missed: number; conservative_missed: number };
  };
  hours_model: { mae_model: number; mae_category_median: number; beats_baseline: boolean; interval_coverage_low_high: number } | null;
  handover_model: { brier_model: number; brier_base_rate: number; beats_baseline: boolean } | null;
}
