import { supabase } from "./supabase";
import type { SlotFilters, Summary } from "./types";

export async function callRpc<T>(fn: string, args?: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  if (data && typeof data === "object" && "ok" in data && (data as { ok: boolean }).ok === false) {
    throw new Error(String((data as { message?: string }).message || "Request failed."));
  }
  return data as T;
}

export function filterArgs(filters: SlotFilters) {
  return {
    p_school_year: filters.schoolYearId || null,
    p_grading_period: filters.gradingPeriodId || null,
    p_category: filters.categoryId || null,
    p_grade_level: filters.gradeLevelId || null,
    p_teacher: filters.teacherId || null,
    p_status: filters.status || null,
  };
}

export function loadSummary(filters: SlotFilters) {
  return callRpc<Summary>("compliance_summary", filterArgs(filters));
}

export async function openStoredFile(path: string) {
  const { data, error } = await supabase.storage.from("school-documents").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Could not open the file.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}
