# SchoolDocs PH

School Document Tracking and Monitoring System

By Arturo Dumlao Pangilinan Jr.

One elementary school. The principal sets up the school, teacher accounts, and the documents teachers must submit. Teachers upload the files. The principal approves them or sends them back. The administrator sees who is done, who is late, and who has not submitted.

React, TypeScript, Tailwind CSS, and Supabase (`klrseniuwskmbutprwxw`). Local app: `http://localhost:5173`.

```text
cd apps/web
npm install
npm run dev
```

Demo password: `SchoolDocs-Demo-2026`

| Role | Email |
|---|---|
| Administrator | admin@schooldocs.test |
| Principal | principal@schooldocs.test |
| Teacher, Grade 1 | teacher.grade1@schooldocs.test |
| Teacher, Grade 2 | teacher.grade2@schooldocs.test |

If a later decision conflicts with this file, update this file in the same change. A box is marked only when it is true on the hosted project. Checked 21 October 2026.

| Phase | Progress |
|---|---|
| 1. Core system | 20 of 21 |
| 2. Productivity | 4 of 6 |
| 3. Later | 0 of 4 |

Still open: invite a teacher from the app, a category template file, and saved report filters.

### Phase 1

- [x] Accounts, profiles, and role permissions
- [x] Sign-in loads the user’s profile
- [x] School, year, grades, and sections
- [x] Categories, requirements, and slots
- [x] Upload, private files, and version history
- [x] Review by the principal
- [x] Dashboard counts
- [x] Excel and PDF reports
- [x] Notifications, reminders, and the audit log
- [ ] Invite a user from the app
- [x] Upload a real file and open it again
- [x] Approve, return, and reopen in the browser
- [x] Open an Excel export and a PDF and confirm the same rows

**Sign-off**

- [x] A teacher cannot open another teacher’s file
- [x] An administrator cannot approve a file
- [x] A late upload stays late after approval
- [x] A waiting file past the deadline counts as overdue
- [x] A return keeps the old version
- [x] A deactivated requirement leaves the totals and keeps approved files
- [x] Excel and PDF contain the same rows
- [x] Approval and the audit row save together

### Phase 2

- [x] Scheduled deadline reminders
- [x] Recurring requirements
- [x] Calendar
- [x] Assign from a pasted teacher list
- [ ] Category template file
- [ ] Saved report filters

### Phase 3

- [ ] More than one school
- [ ] Trends across school years
- [ ] Second approver
- [ ] External file store

Keep `school_id` on every table so more than one school can be added later. The administrator can already count schools, principals, and teachers. The principal still edits one school.

## Roles

A person has one role. Sign-in is email and password. There is no public signup. The principal invites teachers. The app does not store passwords.

| | Teacher | Principal | Administrator |
|---|---|---|---|
| Main job | Upload assigned files | Set up the school and review files | Watch compliance |
| Can approve | No | Yes | No |
| Can open a submitted file | Own files | Yes | No |
| Reports | Own work | No | School reports |

The principal sees the teachers invited to their school on Teacher accounts. The principal also manages years, grades, sections, subjects, categories, templates, requirements, reminders, and announcements. The administrator sees school counts, the compliance page, the calendar, the roster, the list of approved files, reports, the audit log, and the file-size cap.

## How a document moves

The principal creates a requirement and assigns teachers. One requirement for one teacher is one slot. That slot is what the counts use.

`not_submitted` → `submitted` → `under_review` → `approved`

A return sets `needs_revision`. The teacher uploads a new version. The principal can reopen an approved file, which also sets `needs_revision` and keeps the old files.

A teacher may replace the file only while it is `submitted` and nobody has started the review. That keeps the same version. A return always makes a new version.

Overdue means the deadline has passed and the slot is not approved. Late means the file arrived after the deadline. Late stays late after approval. Reports show “Approved (late)”.

Dates use `Asia/Manila`. A date-only deadline is stored as 23:59:59 that day. The database clock decides late and overdue.

## Counts

Inactive requirements and cancelled slots are left out.

| Count | Meaning |
|---|---|
| Total required | Open slots |
| Approved | Status `approved` |
| Pending submission | Not submitted, or needs revision, and the deadline is still ahead |
| Awaiting review | Submitted or under review |
| Needs revision | Status `needs_revision` |
| Overdue | Not approved, and the deadline has passed |
| Missing | Not submitted |

Submission rate is slots with at least one file. Approval rate is approved slots. On-time approval rate is approved slots that are not late.

The same numbers can be grouped by teacher, grade, or category. Filters are school year, grading period, category, grade, teacher, and status. Excel and PDF use the same rows.

## Rules

- Allowed files: `pdf`, `docx`, `xlsx`, `pptx`, `jpg`, `png`. Default is `pdf` and `docx`. Default size is 20 MB. The administrator can raise the cap to 50 MB.
- Files sit in the private bucket `school-documents`. A download link lasts 5 minutes. Learner-record categories are sensitive. The administrator gets no file link.
- A category may hold one blank template. The principal can rename it, mark it as a learner record, or delete it when no requirement uses it. Deactivate a category that requirements still use. A teacher who has a slot in that category can download the template.
- Assignment can target a teacher, a grade, a section, a subject, all active teachers, or a pasted list of names, emails, or employee numbers. A line that matches nobody, or more than one person, is skipped. Existing slots stay put when the roster changes.
- A requirement can repeat weekly or monthly. The day after the deadline, the next copy is created in the same school year. Nothing is created after the school year ends.
- Reminders are in-app. The principal can remind one teacher or everyone still missing a file. A daily job at 00:15 Manila time reminds open slots from 0 to 14 days before the deadline, and once more after the deadline. The same scheduled reminder is not sent twice.
- The audit row is saved in the same step as the change. Teachers see their own history. The principal sees document events. The administrator sees the full log.
- The first sign-in shows a privacy notice. The school is the personal information controller. Old submissions are not deleted automatically.

## Pages

**Principal:** School setup, Teacher accounts, Categories and templates, Document requirements, Submission review, Notifications, School settings.

**Teacher:** Dashboard, Calendar, My requirements, Submit document, Feedback and revisions, Submission history, Notifications, Profile.

**Administrator:** Schools, Compliance, Calendar, Teachers, Document repository, Reports, Notifications, Audit log, Roles and permissions, System settings.

The week on the calendar starts Monday. The administrator opens a teacher’s compliance from a day. The teacher opens the upload, or their history when the file is already approved.

## Where the code lives

```text
apps/web/          React app
supabase/          Database and the invite-user function
scripts/           Demo school and the four accounts
docs/              This file
```

The browser uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Workflow changes go through SQL functions, which also write the audit row. The principal invites a teacher through the `invite-user` function. Reports are built in the browser from `report_dataset`.
