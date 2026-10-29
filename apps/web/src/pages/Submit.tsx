import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, Empty, ErrorText, Field, PageHeader, Panel, StatusBadge, controlClass } from "../components/ui";
import { callRpc, openStoredFile } from "../lib/api";
import { errorText, formatDate, formatWhen } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Slot } from "../lib/types";

export function SubmitList() {
  const [slots, setSlots] = useState<Slot[]>([]);
  useEffect(() => {
    void supabase
      .from("slot_overview")
      .select("*")
      .in("workflow_status", ["not_submitted", "submitted", "needs_revision"])
      .eq("counts_toward_compliance", true)
      .order("deadline")
      .then(({ data }) => setSlots((data ?? []) as Slot[]));
  }, []);
  return (
    <div>
      <PageHeader title="Submit document" lede="Choose one of your open requirements." />
      <div data-guide="list">
      {slots.length === 0 ? <Empty>You have no open requirements.</Empty> : (
        <div className="space-y-2">
          {slots.map((slot) => (
            <Link key={slot.id} to={`/submit/${slot.id}`} className="block">
              <Panel className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{slot.requirement_title}</p>
                  <p className="text-sm text-muted">Due {formatDate(slot.deadline)}</p>
                </div>
                <StatusBadge status={slot.workflow_status} overdue={slot.is_overdue} />
              </Panel>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export function SubmitForm() {
  const { slotId } = useParams();
  const { profile } = useAuth();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.from("slot_overview").select("*").eq("id", slotId).maybeSingle().then(({ data }) => setSlot((data ?? null) as Slot | null));
  }, [slotId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!slot || !profile || !files?.length) return;
    setBusy(true);
    setError(null);
    const uploaded: Array<{ path: string; name: string }> = [];
    try {
      for (const file of Array.from(files)) {
        const fileId = crypto.randomUUID();
        const safeName = file.name.replace(/[^\w.\-() ]+/g, "_");
        const path = `${slot.school_id}/${slot.school_year_id}/${slot.requirement_id}/${profile.id}/${fileId}/${safeName}`;
        const { error: uploadError } = await supabase.storage.from("school-documents").upload(path, file, { upsert: false });
        if (uploadError) throw new Error(uploadError.message);
        uploaded.push({ path, name: file.name });
      }
      const confirmation = await callRpc<{ version: number; submitted_at: string; is_late: boolean }>("register_submission", {
        p_slot: slot.id,
        p_files: uploaded,
        p_notes: notes,
      });
      setResult(`Version ${confirmation.version} received on ${formatWhen(confirmation.submitted_at)}${confirmation.is_late ? " and marked late." : "."}`);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!slot) return <p className="text-sm text-muted">Loading requirement…</p>;
  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={slot.requirement_title} lede={`Due ${formatDate(slot.deadline)} · ${slot.category_name}`} />
      <Panel guide="instructions">
        <p className="whitespace-pre-wrap text-sm">{slot.instructions || "No extra instructions."}</p>
        {slot.template_path ? (
          <Button type="button" className="mt-3" tone="ghost" onClick={() => void openStoredFile(slot.template_path || "").catch((caught) => setError(errorText(caught)))}>
            Download template ({slot.template_filename})
          </Button>
        ) : null}
      </Panel>
      <div data-guide="files">
      <Field label="Files">
        <input className={controlClass} type="file" required multiple={slot.max_files > 1} accept={slot.allowed_extensions.map((ext) => `.${ext}`).join(",")} onChange={(event) => setFiles(event.target.files)} />
      </Field>
      </div>
      <div data-guide="notes">
      <Field label="Notes">
        <textarea className={controlClass} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      {result ? <p className="text-sm font-semibold text-teal-dark">{result}</p> : null}
      <div data-guide="upload">
      <Button type="submit" disabled={busy}>{busy ? "Uploading…" : slot.workflow_status === "needs_revision" ? "Resubmit" : "Upload"}</Button>
      </div>
    </form>
  );
}
