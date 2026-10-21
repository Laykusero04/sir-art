import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorText, Field, Panel, controlClass } from "../../components/ui";
import { supabase } from "../../lib/supabase";

export function ResetPassword() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else setMessage("Password updated. You can sign in with it now.");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Panel className="w-full">
        <h1 className="font-display text-3xl">Choose a new password</h1>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label="New password">
            <input className={controlClass} type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          {message ? <p className="text-sm text-teal-dark">{message}</p> : null}
          <Button type="submit">Update password</Button>
          <div>
            <Link className="text-sm font-semibold text-teal" to="/login">Back to sign in</Link>
          </div>
        </form>
      </Panel>
    </div>
  );
}
