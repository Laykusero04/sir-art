import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { SlotFilters } from "../lib/types";
import { controlClass, Field } from "./ui";

type Option = { id: string; label: string };

export function Filters({
  value,
  onChange,
  showTeacher = true,
}: {
  value: SlotFilters;
  onChange: (next: SlotFilters) => void;
  showTeacher?: boolean;
}) {
  const [years, setYears] = useState<Option[]>([]);
  const [periods, setPeriods] = useState<Array<Option & { school_year_id: string }>>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [grades, setGrades] = useState<Option[]>([]);
  const [teachers, setTeachers] = useState<Option[]>([]);

  useEffect(() => {
    void (async () => {
      const [yearRes, periodRes, categoryRes, gradeRes, teacherRes] = await Promise.all([
        supabase.from("school_years").select("id, label, is_current").order("start_date"),
        supabase.from("grading_periods").select("id, name, school_year_id, sequence").order("sequence"),
        supabase.from("document_categories").select("id, name").eq("is_active", true).order("sort_order"),
        supabase.from("grade_levels").select("id, name").order("sort_order"),
        supabase.from("profiles").select("id, full_name").eq("role", "teacher").eq("is_active", true).order("full_name"),
      ]);
      setYears((yearRes.data ?? []).map((row) => ({ id: row.id, label: row.label })));
      setPeriods((periodRes.data ?? []).map((row) => ({ id: row.id, label: row.name, school_year_id: row.school_year_id })));
      setCategories((categoryRes.data ?? []).map((row) => ({ id: row.id, label: row.name })));
      setGrades((gradeRes.data ?? []).map((row) => ({ id: row.id, label: row.name })));
      setTeachers((teacherRes.data ?? []).map((row) => ({ id: row.id, label: row.full_name })));
      if (!value.schoolYearId) {
        const current = (yearRes.data ?? []).find((row) => row.is_current);
        if (current) onChange({ ...value, schoolYearId: current.id });
      }
    })();
    // Load once. The current-year default is applied from this first result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const periodOptions = periods.filter((period) => !value.schoolYearId || period.school_year_id === value.schoolYearId);

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="School year">
        <select className={controlClass} value={value.schoolYearId} onChange={(event) => onChange({ ...value, schoolYearId: event.target.value, gradingPeriodId: "" })}>
          <option value="">All</option>
          {years.map((year) => (
            <option key={year.id} value={year.id}>{year.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Grading period">
        <select className={controlClass} value={value.gradingPeriodId} onChange={(event) => onChange({ ...value, gradingPeriodId: event.target.value })}>
          <option value="">All</option>
          {periodOptions.map((period) => (
            <option key={period.id} value={period.id}>{period.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Category">
        <select className={controlClass} value={value.categoryId} onChange={(event) => onChange({ ...value, categoryId: event.target.value })}>
          <option value="">All</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Grade level">
        <select className={controlClass} value={value.gradeLevelId} onChange={(event) => onChange({ ...value, gradeLevelId: event.target.value })}>
          <option value="">All</option>
          {grades.map((grade) => (
            <option key={grade.id} value={grade.id}>{grade.label}</option>
          ))}
        </select>
      </Field>
      {showTeacher ? (
        <Field label="Teacher">
          <select className={controlClass} value={value.teacherId} onChange={(event) => onChange({ ...value, teacherId: event.target.value })}>
            <option value="">All</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.label}</option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Status">
        <select className={controlClass} value={value.status} onChange={(event) => onChange({ ...value, status: event.target.value })}>
          <option value="">All</option>
          <option value="not_submitted">Not submitted</option>
          <option value="submitted">Submitted</option>
          <option value="under_review">Under review</option>
          <option value="needs_revision">Needs revision</option>
          <option value="approved">Approved</option>
          <option value="overdue">Overdue</option>
          <option value="missing">Missing</option>
          <option value="due_today">Due today</option>
        </select>
      </Field>
    </div>
  );
}
