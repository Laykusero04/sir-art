import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Filters } from "../components/Filters";
import { Button, Empty, ErrorText, Field, PageHeader, Panel, StatusBadge, controlClass } from "../components/ui";
import { callRpc, filterArgs, openStoredFile } from "../lib/api";
import { errorText, formatDate, formatWhen } from "../lib/format";
import { downloadExcel, downloadPdf, type ReportDataset } from "../lib/reports";
import { supabase } from "../lib/supabase";
import { emptyFilters, type Slot, type SlotFilters } from "../lib/types";

const reports = [
  ["school_wide", "School-wide compliance"],
  ["teacher", "Teacher compliance"],
  ["grade_level", "Grade-level compliance"],
  ["missing", "Missing documents"],
  ["overdue", "Overdue documents"],
  ["revision", "Document revision"],
  ["history", "Submission history"],
] as const;

type SavedFilter = {
  id: string;
  name: string;
  report_type: (typeof reports)[number][0];
  school_year_id: string | null;
  grading_period_id: string | null;
  category_id: string | null;
  grade_level_id: string | null;
  teacher_id: string | null;
  status: string | null;
};

export function Reports() {
  const { profile } = useAuth();
  const [filters, setFilters] = useState<SlotFilters>(emptyFilters);
  const [type, setType] = useState<(typeof reports)[number][0]>("school_wide");
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [filterName, setFilterName] = useState("");
  const [filtersReady, setFiltersReady] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const monitor = profile?.role === "administrator";

  async function loadSaved() {
    if (!monitor) return;
    const { data, error: loadError } = await supabase
      .from("saved_report_filters")
      .select("id, name, report_type, school_year_id, grading_period_id, category_id, grade_level_id, teacher_id, status")
      .order("name");
    if (loadError) {
      if (/saved_report_filters|schema cache/.test(loadError.message)) setFiltersReady(false);
      else setError(errorText(loadError));
      return;
    }
    setFiltersReady(true);
    setSaved((data ?? []) as SavedFilter[]);
  }

  useEffect(() => {
    void loadSaved();
  }, [monitor]);

  function applySaved(row: SavedFilter) {
    setType(row.report_type);
    setFilters({
      schoolYearId: row.school_year_id ?? "",
      gradingPeriodId: row.grading_period_id ?? "",
      categoryId: row.category_id ?? "",
      gradeLevelId: row.grade_level_id ?? "",
      teacherId: row.teacher_id ?? "",
      status: row.status ?? "",
    });
    setMessage(`Applied "${row.name}".`);
    setError(null);
  }

  async function saveFilter() {
    const name = filterName.trim();
    setError(null);
    setMessage(null);
    if (!profile) return;
    if (!name) {
      setError("Name the filter before saving it.");
      return;
    }
    if (!filtersReady) {
      setError("Saved filters are not on the database yet.");
      return;
    }
    const payload = {
      name,
      report_type: type,
      school_year_id: filters.schoolYearId || null,
      grading_period_id: filters.gradingPeriodId || null,
      category_id: filters.categoryId || null,
      grade_level_id: filters.gradeLevelId || null,
      teacher_id: filters.teacherId || null,
      status: filters.status || null,
      school_id: profile.school_id,
      owner_id: profile.id,
    };
    const existing = saved.find((row) => row.name.toLowerCase() === name.toLowerCase());
    const result = existing
      ? await supabase.from("saved_report_filters").update(payload).eq("id", existing.id)
      : await supabase.from("saved_report_filters").insert(payload);
    if (result.error) {
      setError(errorText(result.error));
      return;
    }
    setFilterName("");
    setMessage("Filter saved.");
    await loadSaved();
  }

  async function removeSaved(row: SavedFilter) {
    setError(null);
    setMessage(null);
    const { error: deleteError } = await supabase.from("saved_report_filters").delete().eq("id", row.id);
    if (deleteError) {
      setError(errorText(deleteError));
      return;
    }
    setMessage(`Removed "${row.name}".`);
    await loadSaved();
  }

  async function exportReport(format: "xlsx" | "pdf") {
    setBusy(true);
    setError(null);
    try {
      const dataset = await callRpc<ReportDataset>("report_dataset", { p_type: type, ...filterArgs(filters) });
      if (format === "xlsx") downloadExcel(dataset);
      else await downloadPdf(dataset);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  const reportLabel = Object.fromEntries(reports);

  return (
    <div>
      <PageHeader title="Reports" lede="Excel and PDF use the same rows and the same filter header." />
      <Filters value={filters} onChange={setFilters} />
      <div data-guide="export" className="space-y-4">
      <Field label="Report">
        <select className={controlClass} value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          {reports.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void exportReport("xlsx")}>Export Excel</Button>
        <Button tone="ghost" disabled={busy} onClick={() => void exportReport("pdf")}>Export PDF</Button>
      </div>
      </div>
      {monitor ? (
        <Panel guide="saved" className="mt-4 space-y-3">
          <h2 className="font-display text-2xl">Saved filters</h2>
          {!filtersReady ? <p className="text-sm text-muted">Saved filters are not on the database yet.</p> : null}
          <div className="flex flex-wrap gap-2">
            <input className={controlClass} placeholder="Filter name" value={filterName} onChange={(event) => setFilterName(event.target.value)} />
            <Button tone="ghost" onClick={() => void saveFilter()}>Save filter</Button>
          </div>
          {saved.length === 0 ? <p className="text-sm text-muted">No saved filters yet.</p> : saved.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
              <p className="text-sm"><span className="font-semibold">{row.name}</span> · {reportLabel[row.report_type]}</p>
              <div className="flex gap-2">
                <Button tone="ghost" onClick={() => applySaved(row)}>Apply</Button>
                <Button tone="ghost" onClick={() => void removeSaved(row)}>Delete</Button>
              </div>
            </div>
          ))}
        </Panel>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {message ? <p className="mt-3 text-sm font-semibold text-teal-dark">{message}</p> : null}
    </div>
  );
}

export function Notifications() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Array<{ id: string; title: string; body: string | null; created_at: string; read_at: string | null }>>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [role, setRole] = useState("teacher");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("notifications").select("id, title, body, created_at, read_at").order("created_at", { ascending: false });
    setRows(data ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader title="Notifications" />
      {profile?.role === "principal" ? (
        <Panel guide="announce" className="space-y-3">
          <h2 className="font-display text-2xl">Announcement</h2>
          <Field label="Title"><input className={controlClass} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="Message"><textarea className={controlClass} rows={3} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
          <Field label="Send to">
            <select className={controlClass} value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="teacher">Teachers</option>
              <option value="principal">Principals</option>
              <option value="administrator">Administrators</option>
            </select>
          </Field>
          <Button onClick={() => void callRpc("create_announcement", { p_title: title, p_body: body, p_role: role, p_user_ids: [] }).then(() => {
            setMessage("Announcement sent.");
            setTitle("");
            setBody("");
            return load();
          })}>Send</Button>
          {message ? <p className="text-sm text-teal-dark">{message}</p> : null}
        </Panel>
      ) : null}
      <div data-guide="inbox">
      {rows.length === 0 ? <Empty>No notifications.</Empty> : rows.map((row) => (
        <button
          key={row.id}
          className="block w-full text-left"
          onClick={() => void supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", row.id).then(load)}
        >
          <Panel className={row.read_at ? "opacity-70" : ""}>
            <p className="font-semibold">{row.title}</p>
            <p className="text-sm">{row.body}</p>
            <p className="text-xs text-muted">{formatWhen(row.created_at)}{row.read_at ? "" : " · Unread"}</p>
          </Panel>
        </button>
      ))}
      </div>
    </div>
  );
}

export function Repository() {
  const { profile } = useAuth();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [files, setFiles] = useState<Record<string, Array<{ storage_path: string; original_filename: string }>>>({});

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from("slot_overview").select("*").eq("workflow_status", "approved").is("cancelled_at", null).order("approved_at", { ascending: false });
      const approved = (data ?? []) as Slot[];
      setSlots(approved);
      if (approved.length === 0) return;
      const { data: submissions } = await supabase
        .from("submissions")
        .select("slot_id, version, submission_files(storage_path, original_filename)")
        .in("slot_id", approved.map((slot) => slot.id));
      const grouped: Record<string, Array<{ storage_path: string; original_filename: string }>> = {};
      for (const row of submissions ?? []) {
        const typed = row as unknown as { slot_id: string; version: number; submission_files: Array<{ storage_path: string; original_filename: string }> };
        const current = grouped[typed.slot_id];
        if (!current || (typed.version && typed.version >= (current as unknown as { version?: number }).version!)) {
          grouped[typed.slot_id] = typed.submission_files;
        }
      }
      setFiles(grouped);
    })();
  }, []);

  return (
    <div>
      <PageHeader title="Document repository" lede="Approved work stays on this list, including late approvals. Opening a submitted file stays with the principal." />
      <div data-guide="list">
      {slots.length === 0 ? <Empty>No approved documents yet.</Empty> : (
        <div className="space-y-2">
          {slots.map((slot) => (
            <Panel key={slot.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{slot.requirement_title}</p>
                <p className="text-sm text-muted">{slot.teacher_name} · {slot.category_name} · {slot.school_year_label} · approved {formatDate(slot.approved_at)}</p>
              </div>
              <StatusBadge status="approved" late={slot.is_late} />
              {profile?.role === "principal" ? (
                <div className="flex gap-2">
                  {(files[slot.id] ?? []).map((file) => (
                    <Button key={file.storage_path} tone="ghost" onClick={() => void openStoredFile(file.storage_path)}>{file.original_filename}</Button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">{(files[slot.id] ?? []).map((file) => file.original_filename).join(", ") || "File on record"}</p>
              )}
            </Panel>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export function Roster() {
  const [teachers, setTeachers] = useState<Array<{ id: string; full_name: string; email: string }>>([]);
  useEffect(() => {
    void supabase.from("profiles").select("id, full_name, email").eq("role", "teacher").order("full_name").then(({ data }) => setTeachers(data ?? []));
  }, []);
  return (
    <div>
      <PageHeader title="Teachers" lede="Open a teacher to see their filtered compliance." />
      <div data-guide="list">
      {teachers.length === 0 ? <Empty>No teachers are visible for your account.</Empty> : (
        <div className="space-y-2">
          {teachers.map((teacher) => (
            <Link key={teacher.id} to={`/dashboard?teacher=${teacher.id}`} className="block">
              <Panel>
                <p className="font-semibold">{teacher.full_name}</p>
                <p className="text-sm text-muted">{teacher.email}</p>
              </Panel>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export function History() {
  const [rows, setRows] = useState<Array<{ id: string; version: number; submitted_at: string; submitted_late: boolean; notes: string | null; slot_id: string; submission_files: Array<{ storage_path: string; original_filename: string }> }>>([]);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const slotRes = await supabase.from("slot_overview").select("*");
      const map: Record<string, Slot> = {};
      for (const slot of (slotRes.data ?? []) as Slot[]) map[slot.id] = slot;
      setSlots(map);
      const submissionRes = await supabase
        .from("submissions")
        .select("id, version, submitted_at, submitted_late, notes, slot_id, submission_files(storage_path, original_filename)")
        .order("submitted_at", { ascending: false });
      if (submissionRes.error) setError(errorText(submissionRes.error));
      setRows((submissionRes.data ?? []) as typeof rows);
    })();
  }, []);
  return (
    <div>
      <PageHeader title="Submission history" lede="Open a file from any version you submitted." />
      <ErrorText>{error}</ErrorText>
      <div data-guide="list">
      {rows.length === 0 ? <Empty>No submissions yet.</Empty> : rows.map((row) => (
        <Panel key={row.id} className="mb-2">
          <p className="font-semibold">{slots[row.slot_id]?.requirement_title || "Requirement"} · version {row.version}</p>
          <p className="text-sm text-muted">{formatWhen(row.submitted_at)}{row.submitted_late ? " · late" : ""}</p>
          {row.notes ? <p className="text-sm">{row.notes}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {(row.submission_files ?? []).map((file) => (
              <Button key={file.storage_path} tone="ghost" onClick={() => void openStoredFile(file.storage_path).catch((caught) => setError(errorText(caught)))}>
                {file.original_filename}
              </Button>
            ))}
          </div>
        </Panel>
      ))}
      </div>
    </div>
  );
}

export function Feedback() {
  const [slots, setSlots] = useState<Slot[]>([]);
  useEffect(() => {
    void supabase.from("slot_overview").select("*").eq("workflow_status", "needs_revision").then(({ data }) => setSlots((data ?? []) as Slot[]));
  }, []);
  return (
    <div>
      <PageHeader title="Feedback and revisions" />
      <div data-guide="list">
      {slots.length === 0 ? <Empty>Nothing has been returned for revision.</Empty> : slots.map((slot) => (
        <Link key={slot.id} to={`/submit/${slot.id}`} className="mb-2 block">
          <Panel>
            <p className="font-semibold">{slot.requirement_title}</p>
            <p className="text-sm text-muted">Due {formatDate(slot.deadline)}. Open it to read the comment and resubmit.</p>
          </Panel>
        </Link>
      ))}
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { profile, refresh } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [message, setMessage] = useState<string | null>(null);
  if (!profile) return null;
  return (
    <form className="max-w-lg space-y-4" onSubmit={(event) => {
      event.preventDefault();
      void supabase.from("profiles").update({ full_name: name }).eq("id", profile.id).then(async ({ error }) => {
        if (error) setMessage(error.message);
        else {
          setMessage("Profile saved.");
          await refresh();
        }
      });
    }}>
      <PageHeader title="Profile" lede={profile.email} />
      <div data-guide="name">
      <Field label="Name"><input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} /></Field>
      </div>
      <p data-guide="assignment" className="text-sm text-muted">Grade and section assignments are maintained by the principal.</p>
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit">Save</Button>
    </form>
  );
}

export function SchoolSettings() {
  const [school, setSchool] = useState<{ name: string; address: string | null; deped_school_id: string | null } | null>(null);
  const [template, setTemplate] = useState("");
  const [leadDays, setLeadDays] = useState("1");
  const [scheduled, setScheduled] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void supabase.from("schools").select("name, address, deped_school_id").maybeSingle().then(({ data }) => setSchool(data));
    void supabase.from("system_settings").select("reminder_template, reminder_lead_days, scheduled_reminders").maybeSingle().then(async ({ data, error }) => {
      if (error || !data) {
        const fallback = await supabase.from("system_settings").select("reminder_template").maybeSingle();
        setTemplate(fallback.data?.reminder_template ?? "");
        if (error) setMessage(error.message);
        return;
      }
      setTemplate(data.reminder_template ?? "");
      setLeadDays(String(data.reminder_lead_days ?? 1));
      setScheduled(data.scheduled_reminders ?? true);
    });
  }, []);
  return (
    <form className="max-w-xl space-y-4" onSubmit={(event) => {
      event.preventDefault();
      const days = Number(leadDays);
      if (!Number.isInteger(days) || days < 0 || days > 14) {
        setMessage("Choose 0 to 14 days before the deadline.");
        return;
      }
      void supabase.from("system_settings").select("school_id").maybeSingle().then(async ({ data }) => {
        if (!data) return;
        const saved = await supabase.from("system_settings").update({
          reminder_template: template,
          reminder_lead_days: days,
          scheduled_reminders: scheduled,
        }).eq("school_id", data.school_id);
        if (!saved.error) {
          setMessage("Reminder schedule saved.");
          return;
        }
        const textOnly = await supabase.from("system_settings").update({ reminder_template: template }).eq("school_id", data.school_id);
        setMessage(textOnly.error ? textOnly.error.message : "Reminder text saved. The deadline schedule is not on the database yet.");
      });
    }}>
      <PageHeader title="School settings" lede="Scheduled reminders go out every day at 12:15 a.m. Manila time." />
      <Panel guide="school">
        <p className="font-semibold">{school?.name}</p>
        <p className="text-sm text-muted">{school?.address || "No address yet"} · DepEd ID {school?.deped_school_id || "—"}</p>
      </Panel>
      <div data-guide="reminders" className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={scheduled} onChange={(event) => setScheduled(event.target.checked)} />
        Send deadline and overdue reminders
      </label>
      <Field label="Days before the deadline">
        <input className={controlClass} type="number" min={0} max={14} required value={leadDays} onChange={(event) => setLeadDays(event.target.value)} />
      </Field>
      <Field label="Default reminder text">
        <textarea className={controlClass} rows={3} value={template} onChange={(event) => setTemplate(event.target.value)} />
      </Field>
      <p className="text-sm text-muted">Each open slot gets one reminder inside this window, and one more after the deadline if it is still not approved.</p>
      </div>
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit">Save reminder schedule</Button>
    </form>
  );
}
