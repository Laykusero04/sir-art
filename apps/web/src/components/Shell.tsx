import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import type { Role } from "../lib/types";
import { GuideProvider } from "./Guide";

const links: Record<Role, Array<[string, string]>> = {
  principal: [
    ["/admin/setup", "School setup"],
    ["/admin/users", "Teacher accounts"],
    ["/admin/categories", "Categories and templates"],
    ["/requirements", "Document requirements"],
    ["/review", "Submission review"],
    ["/notifications", "Notifications"],
    ["/settings", "School settings"],
  ],
  teacher: [
    ["/dashboard", "Dashboard"],
    ["/calendar", "Calendar"],
    ["/requirements", "My requirements"],
    ["/submit", "Submit document"],
    ["/feedback", "Feedback and revisions"],
    ["/history", "Submission history"],
    ["/notifications", "Notifications"],
    ["/profile", "Profile"],
  ],
  administrator: [
    ["/dashboard", "Schools"],
    ["/compliance", "Compliance"],
    ["/calendar", "Calendar"],
    ["/roster", "Teachers"],
    ["/repository", "Document repository"],
    ["/reports", "Reports"],
    ["/notifications", "Notifications"],
    ["/admin/audit", "Audit log"],
    ["/admin/roles", "Roles and permissions"],
    ["/admin/settings", "System settings"],
  ],
};

export function Shell() {
  const { profile, schoolName } = useAuth();
  const [open, setOpen] = useState(false);
  if (!profile) return null;
  const items = links[profile.role];

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside
        className={`${open ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-20 flex w-60 flex-col bg-sidebar text-white transition md:static md:translate-x-0`}
      >
        <div className="border-b border-white/10 px-4 py-5">
          <p className="font-display text-2xl leading-none">SchoolDocs</p>
          <p className="mt-1 text-xs tracking-[0.18em] text-gold">PH</p>
          <p className="mt-3 text-sm text-white/75">{schoolName}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {items.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${isActive ? "bg-white/15 font-semibold" : "text-white/80 hover:bg-white/10"}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4 text-sm">
          <p className="font-semibold">{profile.full_name}</p>
          <p className="capitalize text-white/60">{profile.role}</p>
          <button className="mt-3 block text-gold" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
          <p className="mt-4 text-xs leading-5 text-white/50">
            Author
            <span className="block text-white/80">Arturo Dumlao Pangilinan Jr.</span>
          </p>
        </div>
      </aside>
      {open ? <button className="fixed inset-0 z-10 bg-ink/40 md:hidden" onClick={() => setOpen(false)} aria-label="Close menu" /> : null}
      <div className="min-w-0">
        <header className="flex items-center justify-between border-b border-line bg-card px-4 py-3 md:hidden">
          <button className="font-semibold" onClick={() => setOpen(true)}>
            Menu
          </button>
          <span className="font-display text-lg">SchoolDocs PH</span>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <GuideProvider role={profile.role}>
            <Outlet />
          </GuideProvider>
        </main>
      </div>
    </div>
  );
}
