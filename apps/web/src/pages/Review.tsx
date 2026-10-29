import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, Empty, ErrorText, Field, PageHeader, Panel, StatusBadge, controlClass } from "../components/ui";
import { callRpc, openStoredFile } from "../lib/api";
import { errorText, formatDate, formatWhen } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Slot } from "../lib/types";

type FileRow = { storage_path: string; original_filename: string };
type ReviewRow = { action: string; comment: string | null; created_at: string; profiles: { full_name: string } | null };
type Submission = {
  id: string;
  version: number;
  notes: string | null;
  submitted_at: string;
  submitted_late: boolean;
  submission_files: FileRow[];
  reviews: ReviewRow[];
};

export function ReviewQueue() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase
      .from("slot_overview")
      .select("*")
      .in("workflow_status", ["submitted", "under_review"])
      .is("cancelled_at", null)
      .order("deadline")
      .then(({ data, error: loadError }) => {
        if (loadError) setError(errorText(loadError));
        setSlots((data ?? []) as Slot[]);
      });
  }, []);

  return (
    <div>
      <PageHeader title="Submission review" lede="Files waiting for a decision." />
      <ErrorText>{error}</ErrorText>
      <div data-guide="list">
      {slots.length === 0 ? <Empty>Nothing is waiting for review.</Empty> : (
        <div className="space-y-2">
          {slots.map((slot) => (
            <Link key={slot.id} to={`/review/${slot.id}`} className="block">
              <Panel className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{slot.requirement_title}</p>
                  <p className="text-sm text-muted">{slot.teacher_name} · due {formatDate(slot.deadline)}</p>
                </div>
                <StatusBadge status={slot.workflow_status} late={slot.is_late} overdue={slot.is_overdue} />
              </Panel>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export function ReviewDetail() {
  const { slotId } = useParams();
  const { profile } = useAuth();
  const [slot, setSlot] = useState<Slot | null>(null);
  const [versions, setVersions] = useState<Submission[]>([]);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const slotRes = await supabase.from("slot_overview").select("*").eq("id", slotId).maybeSingle();
    setSlot((slotRes.data ?? null) as Slot | null);
    const versionRes = await supabase
      .from("submissions")
      .select("id, version, notes, submitted_at, submitted_late, submission_files(storage_path, original_filename), reviews(action, comment, created_at, profiles(full_name))")
      .eq("slot_id", slotId)
      .order("version", { ascending: false });
    if (versionRes.error) setError(errorText(versionRes.error));
    setVersions((versionRes.data ?? []) as unknown as Submission[]);
  }

  useEffect(() => {
    void load();
  }, [slotId]);

  async function act(action: string) {
    setError(null);
    setMessage(null);
    try {
      await callRpc("review_slot", { p_slot: slotId, p_action: action, p_comment: comment });
      setComment("");
      setMessage("Decision saved.");
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  if (!slot) return <p className="text-sm text-muted">Loading submission…</p>;
  const canReview = profile?.role === "principal";
  const canApprove = profile?.role === "principal";
  const open = slot.workflow_status === "submitted" || slot.workflow_status === "under_review";

  return (
    <div className="space-y-4">
      <PageHeader title={slot.requirement_title} lede={`${slot.teacher_name} · due ${formatDate(slot.deadline)}`} action={<StatusBadge status={slot.workflow_status} late={slot.is_late} overdue={slot.is_overdue} />} />
      <p data-guide="instructions" className="whitespace-pre-wrap text-sm">{slot.instructions}</p>
      <div data-guide="versions" className="space-y-4">
      {versions.map((version) => (
        <Panel key={version.id}>
          <p className="font-semibold">Version {version.version} · {formatWhen(version.submitted_at)}{version.submitted_late ? " · late" : ""}</p>
          {version.notes ? <p className="mt-1 text-sm">{version.notes}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {version.submission_files.map((file) => (
              <Button key={file.storage_path} tone="ghost" onClick={() => void openStoredFile(file.storage_path).catch((caught) => setError(errorText(caught)))}>
                {file.original_filename}
              </Button>
            ))}
          </div>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            {version.reviews.map((review, index) => (
              <li key={`${review.created_at}-${index}`}>{review.profiles?.full_name} · {review.action}{review.comment ? ` · ${review.comment}` : ""}</li>
            ))}
          </ul>
        </Panel>
      ))}
      </div>
      {canReview ? (
        <Panel guide="decision" className="space-y-3">
          <Field label="Comment">
            <textarea className={controlClass} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {slot.workflow_status === "submitted" ? <Button tone="ghost" onClick={() => void act("start")}>Start review</Button> : null}
            {open && canApprove ? <Button onClick={() => void act("approve")}>Approve</Button> : null}
            {open && canReview ? <Button tone="danger" onClick={() => void act("return")}>Return for revision</Button> : null}
            {slot.workflow_status === "approved" && profile?.role === "principal" ? <Button tone="danger" onClick={() => void act("reopen")}>Reopen</Button> : null}
          </div>
          <ErrorText>{error}</ErrorText>
          {message ? <p className="text-sm font-semibold text-teal-dark">{message}</p> : null}
        </Panel>
      ) : <ErrorText>{error}</ErrorText>}
    </div>
  );
}
