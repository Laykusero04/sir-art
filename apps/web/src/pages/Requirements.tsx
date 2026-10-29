import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, Empty, ErrorText, Field, PageHeader, Panel, StatusBadge, controlClass } from "../components/ui";
import { callRpc, openStoredFile } from "../lib/api";
import { errorText, formatDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Slot } from "../lib/types";

type Requirement = {
  id: string;
  title: string;
  instructions: string | null;
  state: "draft" | "active" | "inactive";
  deadline: string;
  category_id: string;
  school_year_id: string;
  grading_period_id: string | null;
  recurrence_rule: "weekly" | "monthly" | null;
  document_categories: { name: string; template_path?: string | null; template_filename?: string | null } | null;
};

function repeatLabel(rule: string | null | undefined) {
  if (rule === "weekly") return "Every week";
  if (rule === "monthly") return "Every month";
  return "Does not repeat";
}

type RosterTeacher = { id: string; full_name: string; email: string; employee_number: string | null };

function normalizeToken(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchingTeachers(token: string, teachers: RosterTeacher[]) {
  const key = normalizeToken(token);
  if (!key) return [];
  const bracket = token.match(/<([^>]+)>/)?.[1];
  const keys = bracket ? [key, normalizeToken(bracket)] : [key];
  return teachers.filter((teacher) => keys.some((candidate) =>
    teacher.email.toLowerCase() === candidate
    || normalizeToken(teacher.full_name) === candidate
    || (teacher.employee_number ? teacher.employee_number.toLowerCase() === candidate : false)
  ));
}

function parseTeacherList(value: string, teachers: RosterTeacher[]) {
  const matched: RosterTeacher[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  const seen = new Set<string>();

  function take(token: string) {
    const hits = matchingTeachers(token, teachers);
    if (hits.length > 1) {
      ambiguous.push(token.trim());
      return;
    }
    if (hits.length === 1) {
      if (!seen.has(hits[0].id)) {
        seen.add(hits[0].id);
        matched.push(hits[0]);
      }
      return;
    }
    unmatched.push(token.trim());
  }

  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const whole = matchingTeachers(trimmed, teachers);
    if (whole.length === 1) {
      take(trimmed);
      continue;
    }
    if (whole.length > 1) {
      ambiguous.push(trimmed);
      continue;
    }
    const pieces = trimmed.split(/[,;]+/).map((piece) => piece.trim()).filter(Boolean);
    if (pieces.length > 1) pieces.forEach(take);
    else unmatched.push(trimmed);
  }

  return { matched, unmatched, ambiguous };
}

const extensions = ["pdf", "docx", "xlsx", "pptx", "jpg", "png"];

export function Requirements() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Requirement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const principal = profile?.role === "principal";

  useEffect(() => {
    void supabase
      .from("requirements")
      .select("id, title, instructions, state, deadline, category_id, school_year_id, grading_period_id, recurrence_rule, document_categories(name)")
      .order("created_at", { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(errorText(loadError));
        setRows((data ?? []) as unknown as Requirement[]);
      });
  }, []);

  return (
    <div>
      <PageHeader
        title={principal ? "Document requirements" : "Assigned requirements"}
        lede={principal ? "Save a draft, assign teachers, then activate it." : "Requirements that fall inside your assignments."}
        action={principal ? <Link data-guide="new" to="/requirements/new"><Button>New requirement</Button></Link> : null}
      />
      <ErrorText>{error}</ErrorText>
      <div data-guide="list">
      {rows.length === 0 ? <Empty>No requirements yet.</Empty> : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Link key={row.id} to={`/requirements/${row.id}`} className="block">
              <Panel className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{row.title}</p>
                  <p className="text-sm text-muted">{row.document_categories?.name} · due {formatDate(row.deadline)} · {repeatLabel(row.recurrence_rule)}</p>
                </div>
                <StatusBadge status={row.state} />
              </Panel>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export function RequirementForm() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [yearId, setYearId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [chosen, setChosen] = useState<string[]>(["pdf", "docx"]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [years, setYears] = useState<Array<{ id: string; label: string }>>([]);
  const [periods, setPeriods] = useState<Array<{ id: string; name: string; school_year_id: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      supabase.from("document_categories").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("school_years").select("id, label, is_current").order("start_date"),
      supabase.from("grading_periods").select("id, name, school_year_id").order("sequence"),
    ]).then(([categoriesRes, yearsRes, periodsRes]) => {
      setCategories(categoriesRes.data ?? []);
      setYears(yearsRes.data ?? []);
      setPeriods(periodsRes.data ?? []);
      const current = (yearsRes.data ?? []).find((year) => year.is_current);
      if (current) setYearId(current.id);
    });
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const id = await callRpc<string>("create_requirement", {
        p_title: title,
        p_instructions: instructions,
        p_category: categoryId,
        p_school_year: yearId,
        p_grading_period: periodId || null,
        p_deadline: deadline,
        p_extensions: chosen,
        p_max_files: 1,
        p_max_size_mb: 20,
        p_reviewer_ids: [],
        ...(recurrence ? { p_recurrence: recurrence } : {}),
      });
      navigate(`/requirements/${id}`);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <form onSubmit={save} className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="New requirement" lede="This stays a draft until you assign teachers and activate it." />
      <div data-guide="details" className="space-y-4">
      <Field label="Title"><input className={controlClass} required value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <Field label="Instructions"><textarea className={controlClass} rows={4} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></Field>
      </div>
      <div data-guide="schedule" className="space-y-4">
      <Field label="Category">
        <select className={controlClass} required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">Choose</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </Field>
      <Field label="School year">
        <select className={controlClass} required value={yearId} onChange={(event) => setYearId(event.target.value)}>
          {years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
        </select>
      </Field>
      <Field label="Grading period">
        <select className={controlClass} value={periodId} onChange={(event) => setPeriodId(event.target.value)}>
          <option value="">Whole year</option>
          {periods.filter((period) => period.school_year_id === yearId).map((period) => (
            <option key={period.id} value={period.id}>{period.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Deadline"><input className={controlClass} type="date" required value={deadline} onChange={(event) => setDeadline(event.target.value)} /></Field>
      <Field label="Repeats">
        <select className={controlClass} value={recurrence} onChange={(event) => setRecurrence(event.target.value)}>
          <option value="">Does not repeat</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </select>
      </Field>
      </div>
      <fieldset data-guide="files">
        <legend className="text-sm font-semibold">Allowed files</legend>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {extensions.map((ext) => (
            <label key={ext} className="flex items-center gap-1 font-normal">
              <input
                type="checkbox"
                checked={chosen.includes(ext)}
                onChange={(event) => setChosen(event.target.checked ? [...chosen, ext] : chosen.filter((item) => item !== ext))}
              />
              {ext}
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorText>{error}</ErrorText>
      <div data-guide="save">
        <Button type="submit">Save draft</Button>
      </div>
    </form>
  );
}

export function RequirementDetail() {
  const { id } = useParams();
  const { profile } = useAuth();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [teachers, setTeachers] = useState<RosterTeacher[]>([]);
  const [pasted, setPasted] = useState("");
  const [grades, setGrades] = useState<Array<{ id: string; name: string }>>([]);
  const [target, setTarget] = useState("all_teachers");
  const [targetId, setTargetId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [deadline, setDeadline] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const columns = "id, title, instructions, state, deadline, category_id, school_year_id, grading_period_id, recurrence_rule, document_categories(name, template_path, template_filename)";
    const full = await supabase.from("requirements").select(columns).eq("id", id).maybeSingle();
    let data = full.data;
    let loadError = full.error;
    if (loadError && /template_path|template_filename/.test(loadError.message)) {
      const fallback = await supabase
        .from("requirements")
        .select("id, title, instructions, state, deadline, category_id, school_year_id, grading_period_id, recurrence_rule, document_categories(name)")
        .eq("id", id)
        .maybeSingle();
      data = fallback.data as typeof data;
      loadError = fallback.error;
    }
    if (loadError) setError(errorText(loadError));
    const row = data as unknown as Requirement | null;
    setRequirement(row);
    setInstructions(row?.instructions ?? "");
    setDeadline(row?.deadline ? row.deadline.slice(0, 10) : "");
    setRecurrence(row?.recurrence_rule ?? "");
    const slotRes = await supabase.from("slot_overview").select("*").eq("requirement_id", id).is("cancelled_at", null);
    setSlots((slotRes.data ?? []) as Slot[]);
  }

  useEffect(() => {
    void load();
    void supabase.from("profiles").select("id, full_name, email, employee_number").eq("role", "teacher").eq("is_active", true).then(({ data }) => setTeachers(data ?? []));
    void supabase.from("grade_levels").select("id, name").order("sort_order").then(({ data }) => setGrades(data ?? []));
  }, [id]);

  async function assignPasted() {
    setError(null);
    setMessage(null);
    const parsed = parseTeacherList(pasted, teachers);
    if (parsed.matched.length + parsed.unmatched.length + parsed.ambiguous.length === 0) {
      setError("Paste at least one teacher name or email.");
      return;
    }
    if (teachers.length === 0) {
      setError("No active teachers are available to match.");
      return;
    }
    if (parsed.ambiguous.length > 0) {
      setError(`More than one teacher matches ${parsed.ambiguous.join(", ")}.`);
      return;
    }
    const openIds = new Set(slots.map((slot) => slot.teacher_id));
    const already = parsed.matched.filter((teacher) => openIds.has(teacher.id));
    const fresh = parsed.matched.filter((teacher) => !openIds.has(teacher.id));
    try {
      for (const teacher of fresh) {
        await callRpc("add_assignment", {
          p_requirement: requirement?.id,
          p_target: "teacher",
          p_teacher: teacher.id,
          p_grade_level: null,
          p_section: null,
          p_subject: null,
        });
      }
      const parts: string[] = [];
      if (fresh.length > 0) parts.push(`Assigned ${fresh.length} teacher${fresh.length === 1 ? "" : "s"}.`);
      if (already.length > 0) parts.push(`Already on this requirement: ${already.map((teacher) => teacher.full_name).join(", ")}.`);
      if (parsed.unmatched.length > 0) parts.push(`Not found: ${parsed.unmatched.join(", ")}.`);
      setMessage(parts.join(" ") || "No teachers were assigned.");
      if (parsed.unmatched.length === 0) setPasted("");
      await load();
    } catch (caught) {
      setError(errorText(caught));
      await load();
    }
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  if (!requirement) return <ErrorText>{error || "Loading requirement…"}</ErrorText>;
  const principal = profile?.role === "principal";

  return (
    <div className="space-y-4">
      <PageHeader title={requirement.title} lede={requirement.document_categories?.name} action={<StatusBadge status={requirement.state} />} />
      <Panel guide="summary">
        <p className="whitespace-pre-wrap text-sm">{requirement.instructions || "No instructions."}</p>
        <p className="mt-2 text-sm text-muted">Due {formatDate(requirement.deadline)} · {repeatLabel(requirement.recurrence_rule)} · {slots.length} open slot{slots.length === 1 ? "" : "s"}</p>
        {requirement.document_categories?.template_path ? (
          <Button className="mt-3" tone="ghost" onClick={() => void openStoredFile(requirement.document_categories?.template_path || "").catch((caught) => setError(errorText(caught)))}>
            Download template ({requirement.document_categories.template_filename})
          </Button>
        ) : null}
        {requirement.recurrence_rule ? <p className="mt-2 text-sm text-muted">The next occurrence opens the day after this deadline, through the end of the school year. This occurrence stays in the totals and in history.</p> : null}
      </Panel>
      {principal && requirement.state !== "inactive" ? (
        <Panel guide="assignment" className="space-y-3">
          <h2 className="font-display text-2xl">Assignment</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Assign to">
              <select className={controlClass} value={target} onChange={(event) => setTarget(event.target.value)}>
                <option value="all_teachers">All active teachers</option>
                <option value="teacher">One teacher</option>
                <option value="grade_level">Grade level</option>
              </select>
            </Field>
            {target !== "all_teachers" ? (
              <Field label={target === "teacher" ? "Teacher" : "Grade level"}>
                <select className={controlClass} value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">Choose</option>
                  {(target === "teacher" ? teachers.map((teacher) => ({ id: teacher.id, label: teacher.full_name })) : grades.map((grade) => ({ id: grade.id, label: grade.name }))).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
          <Button onClick={() => void run(() => callRpc("add_assignment", {
            p_requirement: requirement.id,
            p_target: target,
            p_teacher: target === "teacher" ? targetId : null,
            p_grade_level: target === "grade_level" ? targetId : null,
            p_section: null,
            p_subject: null,
          }), "Assignment saved.")}>Add assignment</Button>
          <Field label="Paste teacher list">
            <textarea className={controlClass} rows={4} value={pasted} placeholder={"One name or email per line\nMaria Santos\nteacher.grade2@schooldocs.test"} onChange={(event) => setPasted(event.target.value)} />
          </Field>
          <Button tone="ghost" onClick={() => void assignPasted()}>Assign pasted teachers</Button>
          {requirement.state === "draft" ? (
            <Button onClick={() => void run(async () => {
              const count = await callRpc<number>("activate_requirement", { p_requirement: requirement.id });
              setMessage(`Activated for ${count} teacher${count === 1 ? "" : "s"}.`);
            }, "")}>Activate</Button>
          ) : (
            <Button tone="danger" onClick={() => void run(() => callRpc("deactivate_requirement", { p_requirement: requirement.id }), "Requirement deactivated.")}>Deactivate</Button>
          )}
          <Field label="Update instructions">
            <textarea className={controlClass} rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
          </Field>
          <Field label="Update deadline">
            <input className={controlClass} type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} />
          </Field>
          <Field label="Repeats">
            <select className={controlClass} value={recurrence} onChange={(event) => setRecurrence(event.target.value)}>
              <option value="">Does not repeat</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </Field>
          <Button tone="ghost" onClick={() => void run(() => callRpc("set_requirement_recurrence", {
            p_requirement: requirement.id,
            p_rule: recurrence || null,
          }), "Repeat saved.")}>Save repeat</Button>
          <Button tone="ghost" onClick={() => void run(() => callRpc("update_requirement", {
            p_requirement: requirement.id,
            p_instructions: instructions,
            p_deadline: deadline || null,
          }), "Requirement updated.")}>Save changes</Button>
          <Button tone="ghost" onClick={() => void run(async () => {
            const count = await callRpc<number>("send_reminder", { p_requirement: requirement.id, p_teacher_ids: [] });
            setMessage(`Reminder sent to ${count} teacher${count === 1 ? "" : "s"}.`);
          }, "")}>Remind missing and overdue</Button>
        </Panel>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm font-semibold text-teal-dark">{message}</p> : null}
      <div data-guide="slots" className="space-y-2">
        {slots.map((slot) => (
          <Panel key={slot.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{slot.teacher_name}</p>
              <p className="text-sm text-muted">{slot.grade_level_name || "Unassigned"} · due {formatDate(slot.deadline)}</p>
            </div>
            <StatusBadge status={slot.workflow_status} late={slot.is_late} overdue={slot.is_overdue} />
            {principal ? (
              <form className="flex gap-2" onSubmit={(event) => {
                event.preventDefault();
                void run(() => callRpc("cancel_slot", { p_slot: slot.id, p_reason: reason || "Cancelled by principal" }), "Slot cancelled.");
              }}>
                <input className={controlClass} placeholder="Cancel reason" value={reason} onChange={(event) => setReason(event.target.value)} />
                <Button tone="ghost" type="submit">Cancel slot</Button>
              </form>
            ) : null}
          </Panel>
        ))}
      </div>
    </div>
  );
}
