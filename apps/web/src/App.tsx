import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { Shell } from "./components/Shell";
import { errorText, homeFor } from "./lib/format";
import { supabaseConfigError } from "./lib/supabase";
import type { Role } from "./lib/types";
import { AuditPage, CategoriesPage, RolesPage, SchoolSetup, SystemSettings, UsersPage } from "./pages/admin/AdminPages";
import { ResetPassword } from "./pages/auth/ResetPassword";
import { SignIn } from "./pages/auth/SignIn";
import { CalendarPage } from "./pages/Calendar";
import { ComplianceDashboard, Dashboard } from "./pages/Dashboard";
import { PrivacyNotice } from "./pages/PrivacyNotice";
import { Feedback, History, Notifications, ProfilePage, Reports, Repository, Roster, SchoolSettings } from "./pages/Records";
import { RequirementDetail, RequirementForm, Requirements } from "./pages/Requirements";
import { ReviewDetail, ReviewQueue } from "./pages/Review";
import { SubmitForm, SubmitList } from "./pages/Submit";

function Gate({ roles }: { roles?: Role[] }) {
  const { session, profile, loading, blocked } = useAuth();
  if (supabaseConfigError) return <Centered>{supabaseConfigError}</Centered>;
  if (loading) return <Centered>Loading SchoolDocs…</Centered>;
  if (!session) return <Navigate to="/login" replace />;
  if (blocked) return <Centered>{errorText({ message: blocked })}</Centered>;
  if (!profile) return <Centered>This account has no school profile yet.</Centered>;
  if (!profile.privacy_notice_accepted_at) return <PrivacyNotice />;
  if (roles && !roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
  return <Shell />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center px-6 text-center text-sm">{children}</div>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<SignIn />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Gate roles={["teacher", "administrator"]} />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/calendar" element={<CalendarPage />} />
      </Route>
      <Route element={<Gate roles={["principal", "teacher"]} />}>
        <Route path="/requirements" element={<Requirements />} />
        <Route path="/requirements/:id" element={<RequirementDetail />} />
      </Route>
      <Route element={<Gate roles={["principal"]} />}>
        <Route path="/requirements/new" element={<RequirementForm />} />
        <Route path="/review" element={<ReviewQueue />} />
        <Route path="/review/:slotId" element={<ReviewDetail />} />
        <Route path="/settings" element={<SchoolSettings />} />
        <Route path="/admin/setup" element={<SchoolSetup />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/categories" element={<CategoriesPage />} />
      </Route>
      <Route element={<Gate roles={["administrator"]} />}>
        <Route path="/compliance" element={<ComplianceDashboard />} />
        <Route path="/roster" element={<Roster />} />
        <Route path="/repository" element={<Repository />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/admin/audit" element={<AuditPage />} />
        <Route path="/admin/roles" element={<RolesPage />} />
        <Route path="/admin/settings" element={<SystemSettings />} />
      </Route>
      <Route element={<Gate roles={["teacher"]} />}>
        <Route path="/submit" element={<SubmitList />} />
        <Route path="/submit/:slotId" element={<SubmitForm />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/history" element={<History />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route element={<Gate />}>
        <Route path="/notifications" element={<Notifications />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
