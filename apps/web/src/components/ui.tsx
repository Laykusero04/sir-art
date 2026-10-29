import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useContext } from "react";
import { statusLabel } from "../lib/format";
import { GuideContext } from "./guide-context";

export function Button({
  tone = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "danger" }) {
  const tones = {
    primary: "bg-teal text-white hover:bg-teal-dark",
    ghost: "border border-line bg-card text-ink hover:bg-paper",
    danger: "bg-rose text-white hover:opacity-90",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${props.className ?? ""}`}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
      {label}
      {children}
    </label>
  );
}

export const controlClass =
  "rounded-md border border-line bg-white px-3 py-2 text-sm font-normal text-ink";

export function Panel({ children, className = "", guide }: { children: ReactNode; className?: string; guide?: string }) {
  return (
    <section data-guide={guide} className={`rounded-xl border border-line bg-card p-4 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

export function PageHeader({ title, lede, action }: { title: string; lede?: string; action?: ReactNode }) {
  return (
    <div data-guide="header" className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {lede ? <p className="mt-1 max-w-2xl text-sm text-muted">{lede}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {action}
        <PageGuideButton />
      </div>
    </div>
  );
}

function PageGuideButton() {
  const open = useContext(GuideContext);
  if (!open) return null;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-card px-3 py-2 text-sm font-semibold text-teal"
      onClick={open}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none">
        <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M7.1 6.7a1.95 1.95 0 0 1 3.72.78c0 1.25-1.35 1.55-1.82 2.22-.2.28-.2.5-.2.78"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="9" cy="12.55" r="0.8" fill="currentColor" />
      </svg>
      Guide
    </button>
  );
}

export function StatusBadge({
  status,
  late = false,
  overdue = false,
}: {
  status: string;
  late?: boolean;
  overdue?: boolean;
}) {
  const label = status === "approved" && late ? "Approved (late)" : statusLabel[status] || status;
  const tone =
    status === "approved"
      ? "bg-green/10 text-green"
      : status === "needs_revision"
        ? "bg-amber/10 text-amber"
        : status === "submitted" || status === "under_review"
          ? "bg-teal/10 text-teal-dark"
          : "bg-ink/5 text-muted";
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
      {overdue && status !== "approved" ? (
        <span className="rounded-full bg-rose/10 px-2 py-0.5 text-xs font-semibold text-rose">Overdue</span>
      ) : null}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-sm font-semibold text-rose">{children}</p>;
}
