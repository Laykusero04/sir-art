export const statusLabel: Record<string, string> = {
  not_submitted: "Not submitted",
  submitted: "Submitted",
  under_review: "Under review",
  needs_revision: "Needs revision",
  approved: "Approved",
  draft: "Draft",
  active: "Active",
  inactive: "Inactive",
};

const manilaDate = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const manilaWhen = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const manilaKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function manilaDateKey(value: string | Date = new Date()) {
  return manilaKey.format(value instanceof Date ? value : new Date(value));
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return manilaDate.format(new Date(value));
}

export function formatWhen(value: string | null | undefined) {
  if (!value) return "—";
  return manilaWhen.format(new Date(value));
}

export function errorText(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: string }).message);
    if (message.includes("PGRST205") || message.includes("schema cache")) {
      return "The SchoolDocs database has not been set up on this Supabase project yet.";
    }
    return message;
  }
  return "Something went wrong.";
}

export function homeFor(role: string) {
  if (role === "principal") return "/admin/setup";
  return "/dashboard";
}
