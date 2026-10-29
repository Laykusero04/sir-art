import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { Button, Empty, ErrorText, Field, PageHeader, Panel, controlClass } from "../../components/ui";
import { callRpc, openStoredFile } from "../../lib/api";
import { errorText, formatWhen } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import type { Role } from "../../lib/types";

const extensions = ["pdf", "docx", "xlsx", "pptx", "jpg", "png"];

async function functionError(error: unknown) {
  if (error && typeof error === "object" && "context" in error) {
    const context = (error as { context?: { json?: () => Promise<{ error?: string; message?: string }> } }).context;
    if (typeof context?.json === "function") {
      try {
        const body = await context.json();
        if (body?.error) return body.error;
        if (body?.message) return body.message;
      } catch {
        // The body was empty or not JSON.
      }
    }
  }
  return errorText(error);
}

export function SchoolSetup() {
  const [school, setSchool] = useState({ name: "", deped_school_id: "", address: "", district: "", division: "", region: "", contact_email: "" });
  const [inactive, setInactive] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [years, setYears] = useState<Array<{ id: string; label: string; is_current: boolean }>>([]);
  const [yearLabel, setYearLabel] = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");

  async function load() {
    const schoolRes = await supabase.from("schools").select("name, deped_school_id, address, district, division, region, contact_email").maybeSingle();
    if (schoolRes.data) {
      setSchool({
        name: schoolRes.data.name ?? "",
        deped_school_id: schoolRes.data.deped_school_id ?? "",
        address: schoolRes.data.address ?? "",
        district: schoolRes.data.district ?? "",
        division: schoolRes.data.division ?? "",
        region: schoolRes.data.region ?? "",
        contact_email: schoolRes.data.contact_email ?? "",
      });
    }
    const inactiveRes = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_active", false);
    setInactive(inactiveRes.count ?? 0);
    const yearRes = await supabase.from("school_years").select("id, label, is_current").order("start_date");
    setYears(yearRes.data ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader title="School setup" lede="Master records for this school. The administrator monitors compliance and does not approve files." />
      <div data-guide="status" className="grid gap-3 sm:grid-cols-3">
        <Panel><p className="text-sm text-muted">Inactive accounts</p><p className="font-display text-3xl">{inactive}</p></Panel>
        <Panel><p className="text-sm text-muted">Storage errors</p><p className="text-sm">No storage errors recorded.</p></Panel>
        <Panel><Link className="font-semibold text-teal" to="/admin/users">Teacher accounts</Link></Panel>
      </div>
      <form data-guide="profile" className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        void supabase.from("schools").select("id").maybeSingle().then(async ({ data }) => {
          if (!data) return;
          const { data: updated, error } = await supabase.from("schools").update(school).eq("id", data.id).select("id");
          if (error) setMessage(error.message);
          else if (!updated?.length) setMessage("The school profile was not saved. Apply the latest database migration, then try again.");
          else setMessage("School profile saved.");
        });
      }}>
        {(["name", "deped_school_id", "address", "district", "division", "region", "contact_email"] as const).map((key) => (
          <Field key={key} label={key.replaceAll("_", " ")}>
            <input className={controlClass} value={school[key]} onChange={(event) => setSchool({ ...school, [key]: event.target.value })} />
          </Field>
        ))}
        <Button type="submit">Save school</Button>
      </form>
      <Panel guide="years" className="space-y-3">
        <h2 className="font-display text-2xl">School years</h2>
        {years.map((year) => <p key={year.id}>{year.label}{year.is_current ? " · current" : ""}</p>)}
        <div className="grid gap-3 sm:grid-cols-3">
          <input className={controlClass} placeholder="2026-2027" value={yearLabel} onChange={(event) => setYearLabel(event.target.value)} />
          <input className={controlClass} type="date" value={yearStart} onChange={(event) => setYearStart(event.target.value)} />
          <input className={controlClass} type="date" value={yearEnd} onChange={(event) => setYearEnd(event.target.value)} />
        </div>
        <Button onClick={() => void (async () => {
          const { data: schoolRow } = await supabase.from("schools").select("id").maybeSingle();
          if (!schoolRow) return;
          await supabase.from("school_years").insert({ school_id: schoolRow.id, label: yearLabel, start_date: yearStart, end_date: yearEnd, is_current: years.length === 0 });
          setYearLabel("");
          await load();
        })()}>Add school year</Button>
      </Panel>
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}

export function UsersPage() {
  const { profile, schoolName } = useAuth();
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; email: string; role: Role; is_active: boolean }>>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!profile) return;
    const { data, error: loadError } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active")
      .eq("school_id", profile.school_id)
      .eq("role", "teacher")
      .order("full_name");
    if (loadError) setError(errorText(loadError));
    setUsers(data ?? []);
  }

  useEffect(() => {
    void load();
  }, [profile?.school_id]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teacher accounts"
        lede={`Teachers invited to ${schoolName}. A new invite is added to this list.`}
      />
      <form data-guide="invite" className="grid gap-3 sm:grid-cols-4" onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setMessage(null);
        setInviteUrl(null);
        void supabase.functions.invoke("invite-user", {
          body: { email, full_name: fullName, role: "teacher", redirect_to: `${window.location.origin}/reset-password` },
        }).then(async ({ data, error: invokeError }) => {
          setBusy(false);
          if (invokeError) {
            setError(await functionError(invokeError));
            return;
          }
          setMessage(data?.emailed ? `Invite sent to ${email}.` : `Account created for ${email}. Copy the invite link.`);
          setInviteUrl(typeof data?.invite_url === "string" ? data.invite_url : null);
          setFullName("");
          setEmail("");
          await load();
        }).catch((invokeError: unknown) => {
          setBusy(false);
          setError(errorText(invokeError));
        });
      }}>
        <input className={controlClass} placeholder="Full name" required value={fullName} onChange={(event) => setFullName(event.target.value)} />
        <input className={controlClass} type="email" placeholder="Email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <input className={controlClass} value="Teacher" readOnly />
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send invite"}</Button>
      </form>
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-teal-dark">{message}</p> : null}
      {inviteUrl ? (
        <Panel className="space-y-2">
          <p className="text-sm font-semibold">Invite link</p>
          <input className={`${controlClass} w-full`} readOnly value={inviteUrl} />
          <Button tone="ghost" onClick={() => void navigator.clipboard.writeText(inviteUrl)}>Copy link</Button>
        </Panel>
      ) : null}
      <div data-guide="teachers">
      <h2 className="text-sm font-semibold">{users.length} {users.length === 1 ? "teacher" : "teachers"} in this school</h2>
      {users.length === 0 ? <Empty>No teachers invited to this school yet.</Empty> : users.map((user) => (
        <Panel key={user.id} className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{user.full_name}</p>
            <p className="text-sm text-muted">{user.email} · {user.is_active ? "Active" : "Deactivated"}</p>
          </div>
          {user.role === "teacher" ? (
            <Button tone="ghost" onClick={() => void supabase.from("profiles").update({ is_active: !user.is_active }).eq("id", user.id).then(load)}>
              {user.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          ) : null}
        </Panel>
      ))}
      </div>
    </div>
  );
}

export function RolesPage() {
  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Roles and permissions" lede="Each person has one role. The principal invites teachers." />
      <div data-guide="roles" className="space-y-4">
      <Panel>
        <p className="font-semibold">Teacher</p>
        <p className="mt-1 text-sm text-muted">Submits assigned documents and reads their own files and feedback.</p>
      </Panel>
      <Panel>
        <p className="font-semibold">Principal</p>
        <p className="mt-1 text-sm text-muted">Sets up the school, teacher accounts, and category templates. Creates requirements and approves or returns every submission.</p>
      </Panel>
      <Panel>
        <p className="font-semibold">Administrator</p>
        <p className="mt-1 text-sm text-muted">Monitors compliance, deadlines, reports, and the audit log. This role cannot approve a file or open a submitted file.</p>
      </Panel>
      </div>
    </div>
  );
}

export function CategoriesPage() {
  const [rows, setRows] = useState<Array<{ id: string; name: string; is_sensitive: boolean; is_active: boolean; template_path: string | null; template_filename: string | null }>>([]);
  const [name, setName] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [schoolId, setSchoolId] = useState("");
  const [maxMb, setMaxMb] = useState(20);
  const [templatesReady, setTemplatesReady] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [templateBusyId, setTemplateBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSensitive, setEditSensitive] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function load() {
    const school = await supabase.from("schools").select("id").maybeSingle();
    setSchoolId(school.data?.id ?? "");
    const settings = await supabase.from("system_settings").select("max_file_size_mb").maybeSingle();
    if (settings.data?.max_file_size_mb) setMaxMb(settings.data.max_file_size_mb);
    const full = await supabase.from("document_categories").select("id, name, is_sensitive, is_active, template_path, template_filename").order("sort_order");
    if (full.error && /template_path|template_filename/.test(full.error.message)) {
      setTemplatesReady(false);
      const plain = await supabase.from("document_categories").select("id, name, is_sensitive, is_active").order("sort_order");
      setRows((plain.data ?? []).map((row) => ({ ...row, template_path: null, template_filename: null })));
      return;
    }
    setTemplatesReady(true);
    setRows(full.data ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function saveTemplate(categoryId: string) {
    const file = files[categoryId];
    setError(null);
    setMessage(null);
    if (!file || !schoolId) {
      setError("Choose a template file.");
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!extensions.includes(ext)) {
      setError("Use a pdf, docx, xlsx, pptx, jpg, or png file.");
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      setError(`That file is larger than ${maxMb} MB.`);
      return;
    }
    setTemplateBusyId(categoryId);
    const fileId = crypto.randomUUID();
    const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
    const path = `${schoolId}/templates/${categoryId}/${fileId}/${safeName}`;
    const { error: uploadError } = await supabase.storage.from("school-documents").upload(path, file, { upsert: false });
    if (uploadError) {
      setTemplateBusyId(null);
      setError(uploadError.message);
      return;
    }
    try {
      await callRpc("set_category_template", { p_category: categoryId, p_path: path, p_filename: file.name });
      setFiles((current) => ({ ...current, [categoryId]: null }));
      setMessage("Template saved.");
      await load();
    } catch (caught) {
      await supabase.storage.from("school-documents").remove([path]);
      setError(errorText(caught));
    } finally {
      setTemplateBusyId(null);
    }
  }

  function startEdit(row: { id: string; name: string; is_sensitive: boolean }) {
    setError(null);
    setMessage(null);
    setEditingId(row.id);
    setEditName(row.name);
    setEditSensitive(row.is_sensitive);
  }

  async function saveEdit(categoryId: string) {
    const trimmed = editName.trim();
    if (!trimmed) {
      setError("Enter a category name.");
      return;
    }
    setBusyId(categoryId);
    setError(null);
    setMessage(null);
    const { error: updateError } = await supabase
      .from("document_categories")
      .update({ name: trimmed, is_sensitive: editSensitive })
      .eq("id", categoryId);
    setBusyId(null);
    if (updateError) {
      setError(updateError.code === "23505" ? "That category name is already used." : updateError.message);
      return;
    }
    setEditingId(null);
    setMessage("Category saved.");
    await load();
  }

  async function deleteCategory(row: { id: string; name: string; template_path: string | null }) {
    setError(null);
    setMessage(null);
    const used = await supabase.from("requirements").select("id", { count: "exact", head: true }).eq("category_id", row.id);
    if (used.error) {
      setError(errorText(used.error));
      return;
    }
    if ((used.count ?? 0) > 0) {
      setPendingDeleteId(null);
      setError(`${row.name} is used by a requirement. Deactivate it instead.`);
      return;
    }
    setPendingDeleteId(row.id);
  }

  async function confirmDelete(row: { id: string; name: string; template_path: string | null }) {
    setBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      if (row.template_path) {
        await callRpc("set_category_template", { p_category: row.id, p_path: null, p_filename: null });
      }
      const { error: deleteError } = await supabase.from("document_categories").delete().eq("id", row.id);
      if (deleteError) {
        setError(deleteError.code === "23503" ? `${row.name} is used by a requirement. Deactivate it instead.` : deleteError.message);
        return;
      }
      if (editingId === row.id) setEditingId(null);
      setPendingDeleteId(null);
      setMessage(`${row.name} deleted.`);
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function removeTemplate(categoryId: string) {
    setError(null);
    setMessage(null);
    setTemplateBusyId(categoryId);
    try {
      await callRpc("set_category_template", { p_category: categoryId, p_path: null, p_filename: null });
      setMessage("Template removed.");
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setTemplateBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Categories and templates" lede="Rename a category, or delete it when no requirement uses it. Deactivate a category that requirements already use. A template is a blank file teachers download before they upload." />
      {!templatesReady ? <p className="text-sm text-muted">Template files are not on the database yet.</p> : null}
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm font-semibold text-teal-dark">{message}</p> : null}
      <form data-guide="add" className="flex flex-wrap gap-3" onSubmit={(event) => {
        event.preventDefault();
        void (async () => {
          if (!schoolId) return;
          setError(null);
          setMessage(null);
          const { error: insertError } = await supabase.from("document_categories").insert({ school_id: schoolId, name: name.trim(), is_sensitive: sensitive, sort_order: rows.length + 1 });
          if (insertError) {
            setError(insertError.code === "23505" ? "That category name is already used." : insertError.message);
            return;
          }
          setName("");
          setSensitive(false);
          setMessage("Category added.");
          await load();
        })();
      }}>
        <input className={controlClass} placeholder="Category name" required value={name} onChange={(event) => setName(event.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sensitive} onChange={(event) => setSensitive(event.target.checked)} /> Learner record</label>
        <Button type="submit">Add category</Button>
      </form>
      <div data-guide="categories">
      {rows.map((row) => (
        <Panel key={row.id} className="space-y-3">
          {editingId === row.id ? (
            <form className="flex flex-wrap items-center gap-3" onSubmit={(event) => {
              event.preventDefault();
              void saveEdit(row.id);
            }}>
              <input className={controlClass} value={editName} required onChange={(event) => setEditName(event.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editSensitive} onChange={(event) => setEditSensitive(event.target.checked)} /> Learner record
              </label>
              <Button type="submit" disabled={busyId === row.id}>{busyId === row.id ? "Saving…" : "Save"}</Button>
              <Button type="button" tone="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-semibold">{row.name}{row.is_sensitive ? " · learner record" : ""}{row.is_active ? "" : " · inactive"}</p>
              <div className="flex flex-wrap items-center gap-2">
                {pendingDeleteId === row.id ? (
                  <>
                    <span className="text-sm">Delete {row.name}?</span>
                    <Button type="button" tone="danger" disabled={busyId === row.id} onClick={() => void confirmDelete(row)}>{busyId === row.id ? "Deleting…" : "Delete"}</Button>
                    <Button type="button" tone="ghost" onClick={() => setPendingDeleteId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button type="button" tone="ghost" onClick={() => startEdit(row)}>Edit</Button>
                    <Button type="button" tone="ghost" disabled={busyId === row.id} onClick={() => void supabase.from("document_categories").update({ is_active: !row.is_active }).eq("id", row.id).then(({ error: updateError }) => {
                      if (updateError) setError(updateError.message);
                      else void load();
                    })}>
                      {row.is_active ? "Deactivate" : "Activate"}
                    </Button>
                    <Button type="button" tone="danger" disabled={busyId === row.id} onClick={() => void deleteCategory(row)}>Delete</Button>
                  </>
                )}
              </div>
            </div>
          )}
          {templatesReady ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">{row.template_filename ? `Template: ${row.template_filename}` : "No template file."}</p>
              <input
                key={row.template_path ?? "empty"}
                className={controlClass}
                type="file"
                accept={extensions.map((ext) => `.${ext}`).join(",")}
                onChange={(event) => setFiles((current) => ({ ...current, [row.id]: event.target.files?.[0] ?? null }))}
              />
              <div className="flex flex-wrap gap-2">
                <Button disabled={templateBusyId === row.id} onClick={() => void saveTemplate(row.id)}>{templateBusyId === row.id ? "Saving…" : "Save template"}</Button>
                {row.template_path ? (
                  <Button type="button" tone="ghost" onClick={() => void openStoredFile(row.template_path || "").catch((caught) => setError(errorText(caught)))}>Download</Button>
                ) : null}
                {row.template_path ? (
                  <Button type="button" tone="ghost" disabled={templateBusyId === row.id} onClick={() => void removeTemplate(row.id)}>Remove template</Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </Panel>
      ))}
      </div>
    </div>
  );
}

export function AuditPage() {
  const [rows, setRows] = useState<Array<{ id: string; action: string; entity_type: string; created_at: string; details: Record<string, unknown> }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void supabase.from("audit_logs").select("id, action, entity_type, created_at, details").order("created_at", { ascending: false }).limit(200).then(({ data, error: loadError }) => {
      if (loadError) setError(errorText(loadError));
      setRows((data ?? []) as Array<{ id: string; action: string; entity_type: string; created_at: string; details: Record<string, unknown> }>);
    });
  }, []);
  return (
    <div>
      <PageHeader title="Audit log" />
      <ErrorText>{error}</ErrorText>
      <div data-guide="log">
      {rows.length === 0 ? <Empty>No activity recorded yet.</Empty> : rows.map((row) => (
        <Panel key={row.id} className="mb-2">
          <p className="font-semibold">{row.action} · {row.entity_type}</p>
          <p className="text-sm text-muted">{formatWhen(row.created_at)}</p>
        </Panel>
      ))}
      </div>
    </div>
  );
}

export function SystemSettings() {
  const [cap, setCap] = useState(20);
  const [chosen, setChosen] = useState<string[]>(extensions);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    void supabase.from("system_settings").select("max_file_size_mb, allowed_extensions, backup_note").maybeSingle().then(({ data }) => {
      if (!data) return;
      setCap(data.max_file_size_mb);
      setChosen(data.allowed_extensions);
      setNote(data.backup_note ?? "");
    });
  }, []);
  return (
    <form className="max-w-xl space-y-4" onSubmit={(event) => {
      event.preventDefault();
      void supabase.from("system_settings").select("school_id").maybeSingle().then(async ({ data }) => {
        if (!data) return;
        const { error } = await supabase.from("system_settings").update({ max_file_size_mb: cap, allowed_extensions: chosen, backup_note: note }).eq("school_id", data.school_id);
        setMessage(error ? error.message : "Settings saved.");
      });
    }}>
      <PageHeader title="System settings" />
      <div data-guide="size">
      <Field label="Maximum file size (MB, up to 50)">
        <input className={controlClass} type="number" min={1} max={50} value={cap} onChange={(event) => setCap(Number(event.target.value))} />
      </Field>
      </div>
      <div data-guide="types" className="flex flex-wrap gap-3 text-sm">
        {extensions.map((ext) => (
          <label key={ext} className="flex items-center gap-1">
            <input type="checkbox" checked={chosen.includes(ext)} onChange={(event) => setChosen(event.target.checked ? [...chosen, ext] : chosen.filter((item) => item !== ext))} />
            {ext}
          </label>
        ))}
      </div>
      <div data-guide="backup">
      <Field label="Backup note">
        <textarea className={controlClass} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      </div>
      {message ? <p className="text-sm">{message}</p> : null}
      <Button type="submit">Save settings</Button>
    </form>
  );
}
