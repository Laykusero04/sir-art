import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { Button, Panel } from "../components/ui";
import { supabase } from "../lib/supabase";

export function PrivacyNotice() {
  const { profile, refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  async function accept() {
    if (!profile) return;
    setBusy(true);
    await supabase.from("profiles").update({ privacy_notice_accepted_at: new Date().toISOString() }).eq("id", profile.id);
    await refresh();
    setBusy(false);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-center px-4">
      <Panel>
        <p className="text-xs tracking-[0.16em] text-teal">DATA PRIVACY ACT OF 2012</p>
        <h1 className="mt-2 font-display text-3xl">Privacy notice</h1>
        <div className="mt-4 space-y-3 text-sm leading-6 text-ink">
          <p>
            The school is the personal information controller for SchoolDocs PH. The system is used to monitor required school documents and teacher submissions.
          </p>
          <p>
            Accounts store your name, email, role, and optional contact details. Uploaded files may contain learner information. Access is limited to your role. The school decides how long records are kept.
          </p>
          <p>Republic Act No. 10173 protects this information. Continue only if you understand that your activity in this system is recorded.</p>
        </div>
        <Button className="mt-5" disabled={busy} onClick={() => void accept()}>
          I understand
        </Button>
      </Panel>
    </div>
  );
}
