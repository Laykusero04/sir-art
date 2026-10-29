import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { Role } from "../lib/types";
import { GuideContext } from "./guide-context";
import { Button } from "./ui";

type Step = { title: string; body: string; target: string };

const counts =
  "Total required counts open slots. Approved is finished. Pending submission still needs a file and the deadline is ahead. Awaiting review is with the principal. Needs revision was sent back. Overdue means the deadline passed and the file is not approved.";

const rates =
  "Submission rate is slots with at least one file. Approval rate is approved slots. On-time approval leaves out files that arrived late.";

const filtersTeacher =
  "Use these to narrow this page. School year opens on the current year. Grading period, category, and grade level limit which documents are included. Status can show not submitted, submitted, under review, needs revision, approved, overdue, missing, or due today.";

const filtersMonitor =
  "Use these to narrow this page. School year opens on the current year. You can also pick a grading period, category, grade level, or one teacher. Status can show not submitted, submitted, under review, needs revision, approved, overdue, missing, or due today.";

function calendar(role: Role): Step[] {
  const day =
    role === "administrator"
      ? "This list is everything due on the day you selected. Open a row to see that teacher's compliance. You cannot upload or approve from here."
      : "This list is everything due on the day you selected. Open a row to upload it, or to open your history when the file is already approved.";
  return [
    { title: "Calendar", body: "Each box is a Manila date. A ring marks today. A name in red is overdue, and a name in green is approved.", target: "header" },
    { title: "Change the month", body: "Previous and Next move one month. This month jumps back to today.", target: "month-nav" },
    { title: "The month", body: "Click a date to select it. A date shows up to two document names, then a count of the rest.", target: "month" },
    { title: "The selected day", body: day, target: "day" },
  ];
}

const screens: Record<string, Step[]> = {
  "teacher:/dashboard": [
    { title: "My compliance", body: "These numbers are only the documents assigned to you.", target: "header" },
    { title: "Filters", body: filtersTeacher, target: "filters" },
    { title: "The counts", body: counts, target: "counts" },
    { title: "The rates", body: rates, target: "rates" },
    { title: "Waiting on you", body: "These files still need you. Open one to upload it.", target: "waiting" },
  ],
  "teacher:/calendar": calendar("teacher"),
  "teacher:/requirements": [
    { title: "Assigned requirements", body: "This is every requirement that includes you. The line under the title shows the category, the deadline, and whether it repeats.", target: "header" },
    { title: "The list", body: "Open a row to read the instructions, download a template when there is one, and see your own status.", target: "list" },
  ],
  "teacher:/requirements/:id": [
    { title: "This requirement", body: "The badge is the requirement's state. The title is the document the principal asked for.", target: "header" },
    { title: "Instructions", body: "Read the note and the deadline here. Download template gets the blank file, when the principal attached one.", target: "summary" },
    { title: "Your slot", body: "Your name, deadline, and status are here. Needs revision means upload a new version. Approved means this one is finished.", target: "slots" },
  ],
  "teacher:/submit": [
    { title: "Submit document", body: "This page lists requirements you can still file: not submitted, already submitted but not yet in review, or sent back.", target: "header" },
    { title: "Choose one", body: "Open a row to upload the file. The badge shows where that document stands, and Overdue means the deadline has passed.", target: "list" },
  ],
  "teacher:/submit/:id": [
    { title: "This upload", body: "The title is the requirement. The line under it is the deadline and the category.", target: "header" },
    { title: "Instructions", body: "Read this before you upload. Download template gets the blank file when one exists.", target: "instructions" },
    { title: "Files", body: "Choose the file from your computer. PDF and Word are the usual types. You can replace a file only before someone starts the review.", target: "files" },
    { title: "Notes", body: "Add a short note for the principal. It is saved with this version.", target: "notes" },
    { title: "Upload", body: "Upload sends the file. If the principal sent it back, the button says Resubmit and that creates a new version.", target: "upload" },
  ],
  "teacher:/feedback": [
    { title: "Feedback and revisions", body: "This page lists files the principal sent back. Nothing else appears here.", target: "header" },
    { title: "What to fix", body: "Open a row to read the comment and upload a new version. The deadline on the row is unchanged.", target: "list" },
  ],
  "teacher:/history": [
    { title: "Submission history", body: "Every version you have sent is kept, including files that were returned or replaced.", target: "header" },
    { title: "A version", body: "Each card is one version. Open the file name to download it. Late means that version arrived after the deadline.", target: "list" },
  ],
  "teacher:/notifications": [
    { title: "Notifications", body: "Reminders and announcements for you land here.", target: "header" },
    { title: "Your inbox", body: "Unread items stay at full strength. Click one to mark it read.", target: "inbox" },
  ],
  "teacher:/profile": [
    { title: "Profile", body: "This is the name and email on your account. The email is how you sign in.", target: "header" },
    { title: "Your name", body: "Change the name the school sees, then save.", target: "name" },
    { title: "Grade and section", body: "The principal keeps your grade and section. You cannot change those here.", target: "assignment" },
  ],
  "principal:/admin/setup": [
    { title: "School setup", body: "Start here. The school record, the school year, and the link to teacher accounts live on this page.", target: "header" },
    { title: "At a glance", body: "Inactive accounts counts people who cannot sign in. Teacher accounts opens the invite page.", target: "status" },
    { title: "School profile", body: "These fields are the school's name, DepEd ID, address, and office email. Save school writes them.", target: "profile" },
    { title: "School years", body: "The current year is marked. Add a year with its label and start and end dates before you create requirements in it.", target: "years" },
  ],
  "principal:/admin/users": [
    { title: "Teacher accounts", body: "This list is the teachers invited to your school. There is no public signup.", target: "header" },
    { title: "Send an invite", body: "Type the teacher's name and email, then send the invite. The role stays Teacher. They set a password from the link.", target: "invite" },
    { title: "The roster", body: "Each card is one teacher. Deactivate stops that person from signing in. Reactivate turns the account back on. Their old files stay.", target: "teachers" },
  ],
  "principal:/admin/categories": [
    { title: "Categories and templates", body: "A category is a kind of document, such as a lesson plan. A template is the blank file teachers download before they upload.", target: "header" },
    { title: "Add a category", body: "Name it, mark Learner record when the file can hold learner information, then add it.", target: "add" },
    { title: "Each category", body: "Edit renames it. Deactivate hides it from new requirements while old ones stay. Delete works only when no requirement uses it. Save template attaches one blank file.", target: "categories" },
  ],
  "principal:/requirements": [
    { title: "Document requirements", body: "A requirement is one document teachers must submit, with a deadline. It stays a draft until you assign teachers and activate it.", target: "header" },
    { title: "New requirement", body: "This starts a draft. You choose the category, the year, and the deadline on the next page.", target: "new" },
    { title: "The list", body: "Open a row to assign teachers, change the deadline, activate it, or remind people who have not submitted.", target: "list" },
  ],
  "principal:/requirements/new": [
    { title: "New requirement", body: "Saving creates a draft. Teachers do not see it until you assign them and activate it.", target: "header" },
    { title: "What it is", body: "The title is what teachers see. Instructions tell them what to put in the file.", target: "details" },
    { title: "When it is due", body: "Pick the category, school year, and an optional grading period. The deadline is the end of that Manila date. Repeats creates the next copy the day after the deadline, until the school year ends.", target: "schedule" },
    { title: "Allowed files", body: "PDF and Word are selected to start. Add or remove types teachers may upload.", target: "files" },
    { title: "Save draft", body: "This keeps the requirement as a draft and opens the page where you assign teachers.", target: "save" },
  ],
  "principal:/requirements/:id": [
    { title: "This requirement", body: "The badge is draft, active, or inactive. Teachers receive slots only after you activate it.", target: "header" },
    { title: "Summary", body: "Instructions, deadline, and how many slots are open. Download template appears when this category has a blank file.", target: "summary" },
    { title: "Assignment", body: "Assign everyone, one teacher, a grade, or a pasted list of names and emails. A line that matches nobody, or more than one person, is skipped. Activate sends it. Deactivate stops new work and keeps approved files. Remind missing and overdue writes to the teachers who still owe it.", target: "assignment" },
    { title: "Slots", body: "Each row is one teacher. The badge is their status. Cancel slot removes that person from the totals. Type a reason first.", target: "slots" },
  ],
  "principal:/review": [
    { title: "Submission review", body: "These are files waiting for your decision. Submitted means you have not started. Under review means you have.", target: "header" },
    { title: "The queue", body: "Open a row to read the file, approve it, or send it back. The teacher and the deadline are on the row.", target: "list" },
  ],
  "principal:/review/:id": [
    { title: "This submission", body: "The badge is the current status. Late stays on the badge after you approve it.", target: "header" },
    { title: "Instructions", body: "This is the note you wrote when you created the requirement.", target: "instructions" },
    { title: "Versions", body: "The newest version is first. Open a file name to read it. Comments from earlier decisions are listed under that version.", target: "versions" },
    { title: "Your decision", body: "Start review marks that you have opened it. Approve accepts the file. Return for revision sends it back and keeps the old version. Reopen does the same to an approved file. Put the reason in the comment.", target: "decision" },
  ],
  "principal:/notifications": [
    { title: "Notifications", body: "Your reminders are listed below. You can also send an announcement from this page.", target: "header" },
    { title: "Announcement", body: "Write a title and a message, choose who receives it, then send. It appears in their notifications.", target: "announce" },
    { title: "Your inbox", body: "Unread items stay at full strength. Click one to mark it read.", target: "inbox" },
  ],
  "principal:/settings": [
    { title: "School settings", body: "This page controls the daily reminder. The job runs at 12:15 a.m. Manila time.", target: "header" },
    { title: "The school", body: "This is the school name on record. Change the address and DepEd ID from School setup.", target: "school" },
    { title: "Reminders", body: "Turn reminders on or off. Days before the deadline can be 0 to 14. Each open slot gets one reminder in that window, and one more after the deadline if it is still not approved. Save reminder schedule keeps the text and the timing.", target: "reminders" },
  ],
  "administrator:/dashboard": [
    { title: "Schools", body: "This page counts schools, principals, and teachers. You watch the roster. You do not set up the school.", target: "header" },
    { title: "The totals", body: "Schools, principals, and teachers count active people. Inactive teachers are accounts the principal turned off.", target: "totals" },
    { title: "Each school", body: "A card names the school, its location, the principal, and the teachers. Inactive is marked on the person.", target: "schools" },
  ],
  "administrator:/compliance": [
    { title: "Compliance", body: "These counts show who is done, who is late, and who has not submitted. You cannot approve a file.", target: "header" },
    { title: "Filters", body: filtersMonitor, target: "filters" },
    { title: "The counts", body: counts, target: "counts" },
    { title: "The rates", body: rates, target: "rates" },
    { title: "By teacher", body: "Each line is one teacher: how many are approved, how many are required, and how many are overdue.", target: "by-teacher" },
    { title: "Overdue", body: "These slots are past the deadline and not approved. The teacher and the due date are on the row.", target: "overdue" },
  ],
  "administrator:/calendar": calendar("administrator"),
  "administrator:/roster": [
    { title: "Teachers", body: "This is the teacher list you can open. It does not invite anyone. The principal does that.", target: "header" },
    { title: "Open a teacher", body: "Click a name to open compliance filtered to that teacher.", target: "list" },
  ],
  "administrator:/repository": [
    { title: "Document repository", body: "Approved files stay on this list, including ones that were late. You can see the file name. You cannot open the file.", target: "header" },
    { title: "The list", body: "Each row is one approved slot: the document, the teacher, the category, the school year, and the approval date.", target: "list" },
  ],
  "administrator:/reports": [
    { title: "Reports", body: "Excel and PDF use the same rows. The filter you set here is the filter printed on the file.", target: "header" },
    { title: "Filters", body: filtersMonitor, target: "filters" },
    { title: "Export", body: "Choose the report, then Export Excel or Export PDF. School-wide, teacher, grade, missing, overdue, revision, and history are the choices.", target: "export" },
    { title: "Saved filters", body: "Name the current filter and save it. Apply puts it back. Delete removes that saved filter only.", target: "saved" },
  ],
  "administrator:/notifications": [
    { title: "Notifications", body: "Reminders and announcements sent to you are listed here.", target: "header" },
    { title: "Your inbox", body: "Unread items stay at full strength. Click one to mark it read.", target: "inbox" },
  ],
  "administrator:/admin/audit": [
    { title: "Audit log", body: "This is the record of changes in the school. A row is written in the same step as the change.", target: "header" },
    { title: "Each row", body: "The first line is the action and what it changed. The second line is when it happened.", target: "log" },
  ],
  "administrator:/admin/roles": [
    { title: "Roles and permissions", body: "A person has one role. The principal invites teachers. You cannot change a role from this page.", target: "header" },
    { title: "What each role can do", body: "A teacher uploads their own files. A principal sets up the school and approves files. You monitor compliance, reports, and the audit log, and you cannot approve or open a submitted file.", target: "roles" },
  ],
  "administrator:/admin/settings": [
    { title: "System settings", body: "These limits apply to files teachers upload.", target: "header" },
    { title: "File size", body: "This is the largest file, in megabytes. The cap can go up to 50.", target: "size" },
    { title: "File types", body: "Checked types are the ones a teacher may upload. PDF, Word, Excel, PowerPoint, and images are the choices.", target: "types" },
    { title: "Backup note", body: "This note is stored with the settings. Save settings writes the size, the types, and the note.", target: "backup" },
  ],
};

function stepsFor(role: Role, pathname: string): Step[] {
  if (pathname === "/requirements/new") return screens["principal:/requirements/new"];
  if (/^\/requirements\/[^/]+$/.test(pathname)) return screens[`${role}:/requirements/:id`] ?? screens["teacher:/requirements/:id"];
  if (/^\/submit\/[^/]+$/.test(pathname)) return screens["teacher:/submit/:id"];
  if (/^\/review\/[^/]+$/.test(pathname)) return screens["principal:/review/:id"];
  return screens[`${role}:${pathname}`] ?? [
    { title: "This page", body: "Use Guide on each page to see what that page is for and how to use its sections.", target: "header" },
  ];
}

function useTarget(name: string) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const selector = `[data-guide="${name}"]`;
    document.querySelector(selector)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    function measure() {
      const node = document.querySelector(selector);
      const next = node?.getBoundingClientRect() ?? null;
      setRect((current) => {
        if (!next) return current ? null : current;
        if (
          current &&
          Math.abs(current.top - next.top) < 1 &&
          Math.abs(current.left - next.left) < 1 &&
          Math.abs(current.width - next.width) < 1 &&
          Math.abs(current.height - next.height) < 1
        ) {
          return current;
        }
        return next;
      });
    }
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [name]);

  return rect;
}

export function GuideProvider({ role, children }: { role: Role; children: ReactNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <GuideContext.Provider value={() => setOpen(true)}>
      {children}
      {open ? <ScreenGuide role={role} pathname={pathname} onClose={() => setOpen(false)} /> : null}
    </GuideContext.Provider>
  );
}

function ScreenGuide({ role, pathname, onClose }: { role: Role; pathname: string; onClose: () => void }) {
  const pages = stepsFor(role, pathname);
  const [index, setIndex] = useState(0);
  const step = pages[Math.min(index, pages.length - 1)];
  const rect = useTarget(step.target);
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState({ width: 352, height: 220 });
  const last = index >= pages.length - 1;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    setCard((current) => (current.width === width && current.height === height ? current : { width, height }));
  });

  const margin = 12;
  const place = rect
    ? {
        left: Math.min(Math.max(margin, rect.left), window.innerWidth - card.width - margin),
        top: (() => {
          const below = rect.bottom + margin;
          if (below + card.height <= window.innerHeight - margin) return below;
          const above = rect.top - card.height - margin;
          if (above >= margin) return above;
          return Math.max(margin, window.innerHeight - card.height - margin);
        })(),
      }
    : null;

  const pad = 8;
  const hole = rect
    ? {
        top: Math.max(0, rect.top - pad),
        left: Math.max(0, rect.left - pad),
        right: Math.min(window.innerWidth, rect.right + pad),
        bottom: Math.min(window.innerHeight, rect.bottom + pad),
      }
    : null;

  return (
    <div className="fixed inset-0 z-40">
      {hole ? (
        <>
          <div className="absolute inset-x-0 top-0 bg-ink/50" style={{ height: hole.top }} onClick={onClose} />
          <div className="absolute inset-x-0 bottom-0 bg-ink/50" style={{ top: hole.bottom }} onClick={onClose} />
          <div className="absolute bg-ink/50" style={{ top: hole.top, left: 0, width: hole.left, height: hole.bottom - hole.top }} onClick={onClose} />
          <div className="absolute bg-ink/50" style={{ top: hole.top, left: hole.right, right: 0, height: hole.bottom - hole.top }} onClick={onClose} />
          <div
            className="pointer-events-none absolute rounded-xl ring-2 ring-teal"
            style={{ top: hole.top, left: hole.left, width: hole.right - hole.left, height: hole.bottom - hole.top }}
          />
          <div className="absolute" style={{ top: hole.top, left: hole.left, width: hole.right - hole.left, height: hole.bottom - hole.top }} />
        </>
      ) : (
        <div className="absolute inset-0 bg-ink/50" onClick={onClose} />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-line bg-card p-5 shadow-sm"
        style={place ? { top: place.top, left: place.left } : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs tracking-[0.16em] text-teal">THIS PAGE</p>
          <button className="text-sm font-semibold text-muted" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-3 text-xs font-semibold text-muted">
          {index + 1} of {pages.length}
        </p>
        <h2 id={titleId} className="mt-1 font-display text-2xl font-semibold text-ink">
          {step.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink">{step.body}</p>
        <div className="mt-4 flex gap-1.5" aria-hidden="true">
          {pages.map((page, dot) => (
            <span key={page.target + page.title} className={`h-1.5 flex-1 rounded-full ${dot === index ? "bg-teal" : "bg-line"}`} />
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between gap-2">
          <Button tone="ghost" onClick={onClose}>
            Skip
          </Button>
          <div className="flex gap-2">
            <Button tone="ghost" disabled={index === 0} onClick={() => setIndex((current) => current - 1)}>
              Back
            </Button>
            {last ? (
              <Button onClick={onClose}>Done</Button>
            ) : (
              <Button onClick={() => setIndex((current) => current + 1)}>Next</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
