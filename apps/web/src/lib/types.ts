export type Role = "administrator" | "principal" | "teacher";

export type Profile = {
  id: string;
  school_id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  employee_number: string | null;
  phone: string | null;
  privacy_notice_accepted_at: string | null;
};

export type WorkflowStatus =
  | "not_submitted"
  | "submitted"
  | "under_review"
  | "needs_revision"
  | "approved";

export type Slot = {
  id: string;
  school_id: string;
  requirement_id: string;
  teacher_id: string;
  deadline: string;
  workflow_status: WorkflowStatus;
  is_late: boolean;
  approved_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  counts_toward_compliance: boolean;
  is_overdue: boolean;
  is_due_today: boolean;
  has_submission: boolean;
  version_count: number;
  latest_version: number | null;
  requirement_title: string;
  instructions: string | null;
  requirement_state: "draft" | "active" | "inactive";
  category_id: string;
  school_year_id: string;
  grading_period_id: string | null;
  allowed_extensions: string[];
  max_files: number;
  max_size_mb: number;
  category_name: string;
  is_sensitive: boolean;
  school_year_label: string;
  grading_period_name: string | null;
  teacher_name: string;
  grade_level_id: string | null;
  grade_level_name: string | null;
  section_name: string | null;
  template_path?: string | null;
  template_filename?: string | null;
};

export type Summary = {
  total_required: number;
  approved: number;
  pending_submission: number;
  awaiting_review: number;
  needs_revision: number;
  overdue: number;
  missing: number;
  with_submission: number;
  approved_on_time: number;
  submission_rate: number;
  approval_rate: number;
  on_time_approval_rate: number;
  by_teacher: Array<{
    teacher_id: string;
    teacher_name: string;
    grade_level_name: string;
    total_required: number;
    approved: number;
    pending_submission: number;
    awaiting_review: number;
    needs_revision: number;
    overdue: number;
  }>;
  by_grade: Array<{
    grade_level_name: string;
    total_required: number;
    approved: number;
    overdue: number;
  }>;
};

export type SlotFilters = {
  schoolYearId: string;
  gradingPeriodId: string;
  categoryId: string;
  gradeLevelId: string;
  teacherId: string;
  status: string;
};

export const emptyFilters: SlotFilters = {
  schoolYearId: "",
  gradingPeriodId: "",
  categoryId: "",
  gradeLevelId: "",
  teacherId: "",
  status: "",
};
