import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/types";

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  schoolName: string;
  loading: boolean;
  blocked: string | null;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [schoolName, setSchoolName] = useState("SchoolDocs PH");
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function loadProfile(next: Session | null) {
    if (!next) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", next.user.id).maybeSingle();
    if (error) {
      setBlocked(error.message);
      setProfile(null);
      setLoading(false);
      return;
    }
    if (!data) {
      setBlocked("This account does not have a school profile yet.");
      setProfile(null);
      setLoading(false);
      return;
    }
    if (!data.is_active) {
      setBlocked("This account is deactivated.");
      await supabase.auth.signOut();
      setProfile(null);
      setLoading(false);
      return;
    }
    setBlocked(null);
    setProfile(data as Profile);
    const { data: school } = await supabase.from("schools").select("name").eq("id", data.school_id).maybeSingle();
    if (school?.name) setSchoolName(school.name);
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    void loadProfile(session);
  }, [session]);

  const value = useMemo(
    () => ({
      session,
      profile,
      schoolName,
      loading,
      blocked,
      refresh: () => loadProfile(session),
    }),
    [session, profile, schoolName, loading, blocked],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing.");
  return value;
}
