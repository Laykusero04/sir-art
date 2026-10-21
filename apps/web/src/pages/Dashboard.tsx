import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Filters } from "../components/Filters";
import { Empty, ErrorText, PageHeader, Panel, StatusBadge } from "../components/ui";
import { loadSummary } from "../lib/api";
import { errorText, formatDate } from "../lib/format";
import { supabase } from "../lib/supabase";
import { emptyFilters, type Slot, type SlotFilters, type Summary } from "../lib/types";

const cards: Array<[keyof Summary, string]> = [
  ["total_required", "Total required"],
  ["approved", "Approved"],
  ["pending_submission", "Pending submission"],
  ["awaiting_review", "Awaiting review"],
  ["needs_revision", "Needs revision"],
  ["overdue", "Overdue"],
];

type DirectoryPerson = { full_name: string; email: string; is_active: boolean };
type DirectorySchool = {
  school_id: string;
  school_name: string;
  deped_school_id: string | null;
  district: string | null;
  division: string | null;
  region: string | null;
  principals: DirectoryPerson[];
  teachers: DirectoryPerson[];
  administrators: DirectoryPerson[];
};

function activeCount(people: DirectoryPerson[]) {
  return people.filter((person) => person.is_active).length;
}

export function SchoolCensus() {
  const [schools, setSchools] = useState<DirectorySchool[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const directory = await supabase.rpc("school_directory");
      if (!directory.error && Array.isArray(directory.data)) {
        setSchools(directory.data as DirectorySchool[]);
        setError(null);
        return;
      }
      const schoolRes = await supabase.from("schools").select("id, name, deped_school_id, district, division, region").order("name");
      const peopleRes = await supabase.from("profiles").select("school_id, full_name, email, role, is_active").order("full_name");
      if (schoolRes.error || peopleRes.error) {
        setError(errorText(schoolRes.error || peopleRes.error));
        return;
      }
      const people = peopleRes.data ?? [];
      setSchools((schoolRes.data ?? []).map((school) => ({
        school_id: school.id,
        school_name: school.name,
        deped_school_id: school.deped_school_id,
        district: school.district,
        division: school.division,
        region: school.region,
        principals: people.filter((person) => person.school_id === school.id && person.role === "principal"),
        teachers: people.filter((person) => person.school_id === school.id && person.role === "teacher"),
        administrators: people.filter((person) => person.school_id === school.id && person.role === "administrator"),
      })));
      setError(null);
    })();
  }, []);

  const principals = schools.reduce((sum, school) => sum + activeCount(school.principals), 0);
  const teachers = schools.reduce((sum, school) => sum + activeCount(school.teachers), 0);
  const inactiveTeachers = schools.reduce((sum, school) => sum + school.teachers.filter((person) => !person.is_active).length, 0);
  const totals: Array<[string, number]> = [
    ["Schools", schools.length],
    ["Principals", principals],
    ["Teachers", teachers],
    ["Inactive teachers", inactiveTeachers],
  ];

  return (
    <div>
      <PageHeader
        title="Schools"
        lede="Counts of schools, principals, and teachers. The principal sets up the school, the teacher accounts, and the templates."
      />
      <ErrorText>{error}</ErrorText>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {totals.map(([label, value]) => (
          <Panel key={label}>
            <p className="text-sm text-muted">{label}</p>
            <p className="font-display text-4xl">{value}</p>
          </Panel>
        ))}
      </div>
      <div className="mt-6 space-y-3">
        {schools.length === 0 ? <Empty>No schools are on record.</Empty> : schools.map((school) => (
          <Panel key={school.school_id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl">{school.school_name}</h2>
                <p className="text-sm text-muted">
                  {[school.district, school.division, school.region].filter(Boolean).join(" · ") || "No location on record"}
                  {school.deped_school_id ? ` · DepEd ${school.deped_school_id}` : ""}
                </p>
              </div>
              <p className="text-sm text-muted">{activeCount(school.teachers)} active teachers</p>
            </div>
            <div>
              <p className="text-sm font-semibold">Principal</p>
              {school.principals.length === 0 ? <p className="text-sm text-muted">No principal yet.</p> : school.principals.map((person) => (
                <p key={person.email} className="text-sm">{person.full_name} · {person.email}{person.is_active ? "" : " · inactive"}</p>
              ))}
            </div>
            <div>
              <p className="text-sm font-semibold">Teachers</p>
              {school.teachers.length === 0 ? <p className="text-sm text-muted">No teachers yet.</p> : (
                <ul className="mt-1 space-y-1 text-sm">
                  {school.teachers.map((person) => (
                    <li key={person.email}>{person.full_name} · {person.email}{person.is_active ? "" : " · inactive"}</li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}

export function Dashboard() {
  const { profile } = useAuth();
  if (profile?.role === "administrator") return <SchoolCensus />;
  return <ComplianceDashboard />;
}

export function ComplianceDashboard() {
  const { profile } = useAuth();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<SlotFilters>({ ...emptyFilters, teacherId: params.get("teacher") ?? "" });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [overdue, setOverdue] = useState<Slot[]>([]);
  const [waiting, setWaiting] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    void (async () => {
      try {
        setSummary(await loadSummary(filters));
        let query = supabase
          .from("slot_overview")
          .select("*")
          .eq("counts_toward_compliance", true)
          .order("deadline");
        if (filters.schoolYearId) query = query.eq("school_year_id", filters.schoolYearId);
        if (profile.role === "teacher") {
          const { data } = await query.in("workflow_status", ["not_submitted", "needs_revision"]).limit(3);
          setWaiting((data ?? []) as Slot[]);
        } else {
          const { data } = await query.eq("is_overdue", true).limit(8);
          setOverdue((data ?? []) as Slot[]);
        }
        setError(null);
      } catch (caught) {
        setError(errorText(caught));
      }
    })();
  }, [filters, profile]);

  if (!profile) return null;

  return (
    <div>
      <PageHeader
        title={profile.role === "teacher" ? "My compliance" : "Compliance dashboard"}
        lede="Counts follow the requirement, the deadline, and whether a file has been approved."
      />
      <Filters value={filters} onChange={setFilters} showTeacher={profile.role !== "teacher"} />
      <ErrorText>{error}</ErrorText>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([key, label]) => (
          <Panel key={key}>
            <p className="text-sm text-muted">{label}</p>
            <p className="font-display text-4xl">{summary ? String(summary[key]) : "—"}</p>
          </Panel>
        ))}
      </div>
      {summary ? (
        <p className="mt-4 text-sm text-muted">
          Submission rate {summary.submission_rate}% · Approval rate {summary.approval_rate}% · On-time approval {summary.on_time_approval_rate}%
        </p>
      ) : null}

      {profile.role === "teacher" ? (
        <div className="mt-6">
          <h2 className="mb-2 font-display text-2xl">Waiting on you</h2>
          {waiting.length === 0 ? <Empty>Nothing is waiting on you for this filter.</Empty> : (
            <div className="space-y-2">
              {waiting.map((slot) => (
                <Link key={slot.id} to={`/submit/${slot.id}`} className="block">
                  <Panel className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{slot.requirement_title}</p>
                      <p className="text-sm text-muted">Due {formatDate(slot.deadline)}</p>
                    </div>
                    <StatusBadge status={slot.workflow_status} overdue={slot.is_overdue} late={slot.is_late} />
                  </Panel>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Panel>
            <h2 className="font-display text-2xl">By teacher</h2>
            {(summary?.by_teacher.length ?? 0) === 0 ? <Empty>No slots in this filter.</Empty> : (
              <ul className="mt-3 space-y-2 text-sm">
                {summary?.by_teacher.map((row) => (
                  <li key={row.teacher_id} className="flex justify-between gap-3 border-b border-line py-2">
                    <span>{row.teacher_name}<span className="block text-muted">{row.grade_level_name}</span></span>
                    <span>{row.approved}/{row.total_required} approved · {row.overdue} overdue</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel>
            <h2 className="font-display text-2xl">Overdue</h2>
            {overdue.length === 0 ? <Empty>No overdue requirements in this filter.</Empty> : (
              <ul className="mt-3 space-y-2 text-sm">
                {overdue.map((slot) => (
                  <li key={slot.id} className="border-b border-line py-2">
                    <p className="font-semibold">{slot.requirement_title}</p>
                    <p className="text-muted">{slot.teacher_name} · due {formatDate(slot.deadline)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
