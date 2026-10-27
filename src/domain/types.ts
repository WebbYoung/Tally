export type Role = "registration" | "attendance" | "feedback";
export type Field = "id" | "channel" | "grade" | "time" | "rating";
export type MetricKey =
  | "registered"
  | "attended"
  | "attendanceRate"
  | "duplicates"
  | "walkIns"
  | "feedbackRate"
  | "satisfaction";
export interface Row {
  rowNumber: number;
  values: Record<string, string>;
}
export interface Source {
  id: string;
  name: string;
  sheet: string;
  hash: string;
  role: Role;
  headers: string[];
  rows: Row[];
  mapping: Partial<Record<Field, string>>;
  confirmed: boolean;
  warnings: string[];
}
export interface Policy {
  version: number;
  duplicate: "first" | "last";
  invitations: "unknown" | "allAttendees" | "registeredAttendees" | "custom";
  invitedIds: string[];
  ratingMin: number;
  ratingMax: number;
  excludedRefs: string[];
}
export interface Project {
  name: string;
  date: string;
  demo: boolean;
  sources: Source[];
  policy: Policy;
}
export interface Ref {
  sourceId: string;
  file: string;
  sheet: string;
  row: number;
  key: string;
}
export interface Person {
  id: string;
  channel: string;
  grade: string;
  time: string;
  rating: number | null;
  ref: Ref;
}
export interface Issue {
  kind:
    | "missingId"
    | "duplicateRegistration"
    | "duplicateAttendance"
    | "duplicateFeedback"
    | "overlap"
    | "walkIn"
    | "unmatchedFeedback"
    | "invalidRating";
  message: string;
  refs: Ref[];
}
export interface Metric {
  key: MetricKey;
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  numerator: number | null;
  denominator: number | null;
  evidence: Ref[];
  denominatorEvidence: Ref[];
  note: string;
}
export interface Result {
  metrics: Record<MetricKey, Metric>;
  issues: Issue[];
  registered: Person[];
  attendees: Person[];
  registeredAttendees: Person[];
  feedback: Person[];
  eligibleFeedback: Person[];
  ready: boolean;
  warnings: string[];
  totalRows: number;
}
export interface Snapshot {
  id: string;
  createdAt: string;
  label: string;
  project: Project;
  result: Result;
  fingerprint: string;
  engineVersion: string;
}
export interface Plan {
  metric:
    | "attendanceRate"
    | "registered"
    | "attended"
    | "feedbackRate"
    | "satisfaction";
  groupBy: "channel" | "grade" | "none";
  order: "desc" | "asc";
  title: string;
}
export interface AnalysisRow {
  name: string;
  value: number | null;
  numerator: number;
  denominator: number;
  evidence: Ref[];
  denominatorEvidence: Ref[];
}
export interface AnalysisRecord {
  id: string;
  snapshotId: string;
  createdAt: string;
  plan: Plan;
  rows: AnalysisRow[];
}
export interface Claim {
  id: string;
  text: string;
  snapshotId: string;
  metric: MetricKey;
  value: number | null;
  evidence: Ref[];
}
export const ROLE_LABELS: Record<Role, string> = {
  registration: "报名表",
  attendance: "签到表",
  feedback: "反馈表",
};
export const FIELD_LABELS: Record<Field, string> = {
  id: "人员标识",
  channel: "报名渠道",
  grade: "年级",
  time: "签到时间",
  rating: "满意度评分",
};
export const DEFAULT_POLICY: Policy = {
  version: 1,
  duplicate: "first",
  invitations: "unknown",
  invitedIds: [],
  ratingMin: 1,
  ratingMax: 5,
  excludedRefs: [],
};
export const ENGINE_VERSION = "0.1.0";
