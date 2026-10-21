import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import { Button, ErrorText, Field, controlClass } from "../../components/ui";
import { homeFor } from "../../lib/format";
import { supabase, supabaseConfigError } from "../../lib/supabase";

export function SignIn() {
  const { session, profile, loading } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "forgot">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && session && profile) return <Navigate to={homeFor(profile.role)} replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    if (mode === "forgot") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setBusy(false);
      if (resetError) setError(resetError.message);
      else setMessage("If that email has an account, a reset link is on its way.");
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (signInError) setError(signInError.message);
  }

  return (
    <div className="grid min-h-screen md:grid-cols-2">
      <section className="flex flex-col justify-between bg-sidebar px-8 py-10 text-white">
        <div>
          <p className="text-xs tracking-[0.22em] text-gold">ELEMENTARY SCHOOL OFFICE</p>
          <h1 className="mt-4 font-display text-5xl leading-tight">SchoolDocs PH</h1>
          <p className="mt-4 max-w-md text-lg text-white/80">
            Track required school documents, deadlines, and teacher submissions in one place.
          </p>
        </div>
        <p className="text-sm text-white/80">
          <span className="block text-xs tracking-[0.16em] text-gold">AUTHOR</span>
          <span className="mt-1 block font-display text-xl text-white">Arturo Dumlao Pangilinan Jr.</span>
        </p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h2 className="font-display text-3xl">{mode === "sign-in" ? "Sign in" : "Reset password"}</h2>
          <p className="text-sm text-muted">Teacher accounts are created by the principal. There is no public signup.</p>
          {supabaseConfigError ? <ErrorText>{supabaseConfigError}</ErrorText> : null}
          <Field label="Email">
            <input className={controlClass} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </Field>
          {mode === "sign-in" ? (
            <Field label="Password">
              <input className={controlClass} type="password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
          ) : null}
          <ErrorText>{error}</ErrorText>
          {message ? <p className="text-sm text-teal-dark">{message}</p> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Send reset link"}
          </Button>
          <button
            type="button"
            className="text-sm font-semibold text-teal"
            onClick={() => {
              setMode(mode === "sign-in" ? "forgot" : "sign-in");
              setError(null);
              setMessage(null);
            }}
          >
            {mode === "sign-in" ? "Forgot password" : "Back to sign in"}
          </button>
        </form>
      </section>
    </div>
  );
}
