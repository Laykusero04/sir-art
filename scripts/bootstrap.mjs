import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).trim()];
    }),
);

const base = env.SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
const password = "SchoolDocs-Demo-2026";

const schoolId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
const yearId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
const grades = [
  ["Kinder", 0],
  ["Grade 1", 1],
  ["Grade 2", 2],
  ["Grade 3", 3],
  ["Grade 4", 4],
  ["Grade 5", 5],
  ["Grade 6", 6],
].map(([name, sort], index) => ({
  id: `c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a${String(index).padStart(2, "0")}`,
  school_id: schoolId,
  name,
  sort_order: sort,
}));
const grade1 = grades[1].id;
const grade2 = grades[2].id;

const categories = [
  ["Daily Lesson Log (DLL)", "Instructional documents", false],
  ["Daily Lesson Plan (DLP)", "Instructional documents", false],
  ["Weekly lesson plan", "Instructional documents", false],
  ["Instructional materials", "Instructional documents", false],
  ["Table of Specifications (TOS)", "Assessment documents", false],
  ["Summative test", "Assessment documents", false],
  ["Answer key", "Assessment documents", false],
  ["Assessment results", "Assessment documents", false],
  ["School Form 1 (SF1)", "Learner records", true],
  ["Enrollment documents", "Learner records", true],
  ["Other learner records", "Learner records", true],
  ["Teacher attendance", "Attendance documents", false],
  ["Attendance summary", "Attendance documents", false],
  ["Accomplishment report", "School reports", false],
  ["Committee report", "School reports", false],
].map(([name, group, sensitive], index) => ({
  id: `d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a${String(index).padStart(2, "0")}`,
  school_id: schoolId,
  name,
  group_name: group,
  is_sensitive: sensitive,
  sort_order: index + 1,
  is_active: true,
}));

const accounts = [
  ["admin@schooldocs.test", "School Administrator", "administrator"],
  ["principal@schooldocs.test", "School Principal", "principal"],
  ["teacher.grade1@schooldocs.test", "Maria Santos", "teacher"],
  ["teacher.grade2@schooldocs.test", "Juan Reyes", "teacher"],
];

async function api(path, { method = "GET", body, prefer } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function upsert(table, rows) {
  await api(`/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

const probe = await fetch(`${base}/rest/v1/schools?select=id&limit=1`, {
  headers: { apikey: secret, Authorization: `Bearer ${secret}` },
});
if (probe.status === 404) {
  console.error("The database tables are not on the Supabase project yet.");
  console.error("Run both files in supabase/migrations in the Supabase SQL editor, then run this script again.");
  process.exit(1);
}
if (!probe.ok) {
  console.error(await probe.text());
  process.exit(1);
}

await upsert("schools", [{
  id: schoolId,
  name: "Demo Elementary School",
  deped_school_id: "000000",
  address: "Sample Street, Sample City",
  district: "Demo District",
  division: "Demo Division",
  region: "NCR",
  contact_email: "office@schooldocs.test",
}]);

await api("/rest/v1/system_settings?on_conflict=school_id", {
  method: "POST",
  prefer: "resolution=merge-duplicates,return=minimal",
  body: [{
    school_id: schoolId,
    max_file_size_mb: 20,
    allowed_extensions: ["pdf", "docx", "xlsx", "pptx", "jpg", "png"],
    backup_note: "Daily Supabase backups cover the database. Confirm the storage backup plan in the Supabase project.",
    reminder_template: "Please submit this required school document before the deadline.",
  }],
});

await upsert("school_years", [{
  id: yearId,
  school_id: schoolId,
  label: "2026-2027",
  start_date: "2026-06-15",
  end_date: "2027-03-31",
  is_current: true,
}]);

await upsert("grading_periods", [
  ["First Quarter", 1, "2026-06-15", "2026-08-14"],
  ["Second Quarter", 2, "2026-08-17", "2026-10-16"],
  ["Third Quarter", 3, "2026-10-19", "2027-01-08"],
  ["Fourth Quarter", 4, "2027-01-11", "2027-03-31"],
].map(([name, sequence, start, end], index) => ({
  id: `e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a${String(index).padStart(2, "0")}`,
  school_year_id: yearId,
  name,
  sequence,
  start_date: start,
  end_date: end,
})));

await upsert("grade_levels", grades);
await upsert("subjects", ["Filipino", "English", "Mathematics", "Science", "Araling Panlipunan", "MAPEH"].map((name, index) => ({
  id: `f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a${String(index).padStart(2, "0")}`,
  school_id: schoolId,
  name,
})));
await upsert("document_categories", categories);

const existing = await api("/auth/v1/admin/users?page=1&per_page=200");
const byEmail = new Map((existing.users ?? []).map((user) => [user.email, user]));

for (const [email, fullName, role] of accounts) {
  if (!byEmail.has(email)) {
    const created = await api("/auth/v1/admin/users", {
      method: "POST",
      body: { email, password, email_confirm: true, user_metadata: { full_name: fullName } },
    });
    byEmail.set(email, created);
  }
  const user = byEmail.get(email);
  await upsert("profiles", [{
    id: user.id,
    school_id: schoolId,
    full_name: fullName,
    email,
    role,
    is_active: true,
  }]);
}

const teacher1 = byEmail.get("teacher.grade1@schooldocs.test").id;
const teacher2 = byEmail.get("teacher.grade2@schooldocs.test").id;
const principal = byEmail.get("principal@schooldocs.test").id;

const section1 = "a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01";
const section2 = "a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02";
await upsert("sections", [
  { id: section1, school_id: schoolId, grade_level_id: grade1, school_year_id: yearId, name: "Rizal", adviser_id: teacher1 },
  { id: section2, school_id: schoolId, grade_level_id: grade2, school_year_id: yearId, name: "Bonifacio", adviser_id: teacher2 },
]);

await api("/rest/v1/teacher_assignments?on_conflict=profile_id,school_year_id", {
  method: "POST",
  prefer: "resolution=merge-duplicates,return=representation",
  body: [
    { id: "a2eebc99-9c0b-4ef8-bb6d-6bb9bd380a01", profile_id: teacher1, school_year_id: yearId, grade_level_id: grade1, section_id: section1 },
    { id: "a2eebc99-9c0b-4ef8-bb6d-6bb9bd380a02", profile_id: teacher2, school_year_id: yearId, grade_level_id: grade2, section_id: section2 },
  ],
});

const dll = "a3eebc99-9c0b-4ef8-bb6d-6bb9bd380a01";
const tos = "a3eebc99-9c0b-4ef8-bb6d-6bb9bd380a02";
await upsert("requirements", [
  {
    id: dll,
    school_id: schoolId,
    category_id: categories[0].id,
    school_year_id: yearId,
    grading_period_id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02",
    title: "Daily Lesson Log - Week 1",
    instructions: "Upload the DLL for the current week. PDF or DOCX is accepted.",
    deadline: "2026-10-24T15:59:59Z",
    allowed_extensions: ["pdf", "docx"],
    max_files: 1,
    max_size_mb: 20,
    state: "active",
    created_by: principal,
  },
  {
    id: tos,
    school_id: schoolId,
    category_id: categories[4].id,
    school_year_id: yearId,
    grading_period_id: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02",
    title: "Table of Specifications",
    instructions: "Upload the TOS for the quarterly assessment.",
    deadline: "2026-10-18T15:59:59Z",
    allowed_extensions: ["pdf", "docx"],
    max_files: 1,
    max_size_mb: 20,
    state: "active",
    created_by: principal,
  },
]);

await upsert("assignments", [
  { id: "a4eebc99-9c0b-4ef8-bb6d-6bb9bd380a01", requirement_id: dll, target_type: "grade_level", teacher_id: null, grade_level_id: grade1, section_id: null, subject_id: null, created_by: principal },
  { id: "a4eebc99-9c0b-4ef8-bb6d-6bb9bd380a02", requirement_id: tos, target_type: "all_teachers", teacher_id: null, grade_level_id: null, section_id: null, subject_id: null, created_by: principal },
]);

await upsert("compliance_slots", [
  { id: "a5eebc99-9c0b-4ef8-bb6d-6bb9bd380a01", school_id: schoolId, requirement_id: dll, teacher_id: teacher1, deadline: "2026-10-24T15:59:59Z", workflow_status: "not_submitted" },
  { id: "a5eebc99-9c0b-4ef8-bb6d-6bb9bd380a02", school_id: schoolId, requirement_id: tos, teacher_id: teacher1, deadline: "2026-10-18T15:59:59Z", workflow_status: "not_submitted" },
  { id: "a5eebc99-9c0b-4ef8-bb6d-6bb9bd380a03", school_id: schoolId, requirement_id: tos, teacher_id: teacher2, deadline: "2026-10-18T15:59:59Z", workflow_status: "not_submitted" },
]);

console.log("Demo school is ready.");
console.log("Password for every demo account: SchoolDocs-Demo-2026");
for (const [email, , role] of accounts) console.log(`${role}: ${email}`);
