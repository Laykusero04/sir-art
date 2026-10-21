import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button, Empty, ErrorText, PageHeader, Panel, StatusBadge } from "../components/ui";
import { errorText, formatDate, manilaDateKey } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Slot } from "../lib/types";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function shiftMonth(year: number, month: number, delta: number) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function monthBounds(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: new Date(`${year}-${pad(month)}-01T00:00:00+08:00`).toISOString(),
    end: new Date(`${year}-${pad(month)}-${pad(last)}T23:59:59+08:00`).toISOString(),
    days: last,
    lead: (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7,
  };
}

function monthTitle(year: number, month: number) {
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function CalendarPage() {
  const { profile } = useAuth();
  const todayKey = manilaDateKey();
  const [cursor, setCursor] = useState(() => {
    const [year, month] = todayKey.split("-").map(Number);
    return { year, month };
  });
  const [selected, setSelected] = useState(todayKey);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bounds = monthBounds(cursor.year, cursor.month);

  useEffect(() => {
    const prefix = `${cursor.year}-${pad(cursor.month)}`;
    setSelected(todayKey.startsWith(prefix) ? todayKey : `${prefix}-01`);
  }, [cursor.year, cursor.month, todayKey]);

  useEffect(() => {
    if (!profile) return;
    void supabase
      .from("slot_overview")
      .select("*")
      .is("cancelled_at", null)
      .gte("deadline", bounds.start)
      .lte("deadline", bounds.end)
      .order("deadline")
      .then(({ data, error: loadError }) => {
        if (loadError) setError(errorText(loadError));
        else setError(null);
        setSlots((data ?? []) as Slot[]);
      });
  }, [profile, bounds.start, bounds.end]);

  const byDay = useMemo(() => {
    const grouped = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = manilaDateKey(slot.deadline);
      grouped.set(key, [...(grouped.get(key) ?? []), slot]);
    }
    return grouped;
  }, [slots]);

  if (!profile) return null;

  const selectedSlots = byDay.get(selected) ?? [];
  const cells = [
    ...Array.from({ length: bounds.lead }, () => null),
    ...Array.from({ length: bounds.days }, (_, index) => index + 1),
  ];

  function openPath(slot: Slot) {
    if (profile?.role === "administrator") return `/dashboard?teacher=${slot.teacher_id}`;
    if (slot.workflow_status === "approved") return "/history";
    return `/submit/${slot.id}`;
  }

  return (
    <div>
      <PageHeader
        title="Calendar"
        lede="Each deadline is shown on its Manila date. Cancelled slots are left off the month."
        action={
          <div className="flex gap-2">
            <Button tone="ghost" onClick={() => setCursor((current) => shiftMonth(current.year, current.month, -1))}>Previous</Button>
            <Button tone="ghost" onClick={() => {
              const [year, month] = todayKey.split("-").map(Number);
              setCursor({ year, month });
            }}>This month</Button>
            <Button tone="ghost" onClick={() => setCursor((current) => shiftMonth(current.year, current.month, 1))}>Next</Button>
          </div>
        }
      />
      <ErrorText>{error}</ErrorText>
      <h2 className="mb-3 font-display text-2xl">{monthTitle(cursor.year, cursor.month)}</h2>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
        {weekdays.map((day) => <div key={day} className="py-1">{day}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="min-h-24 rounded-md bg-paper" />;
          const key = `${cursor.year}-${pad(cursor.month)}-${pad(day)}`;
          const items = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selected;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(key)}
              className={`min-h-24 rounded-md border p-1 text-left ${isSelected ? "border-teal bg-teal/5" : "border-line bg-card"} ${isToday ? "ring-2 ring-teal" : ""}`}
            >
              <span className={`text-xs font-semibold ${isToday ? "text-teal-dark" : ""}`}>{day}</span>
              <span className="mt-1 block space-y-0.5">
                {items.slice(0, 2).map((slot) => (
                  <span key={slot.id} className={`block truncate text-[11px] ${slot.is_overdue ? "text-rose" : slot.workflow_status === "approved" ? "text-green" : "text-ink"}`}>
                    {slot.requirement_title}
                  </span>
                ))}
                {items.length > 2 ? <span className="block text-[11px] text-muted">+{items.length - 2}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
      <Panel className="mt-4">
        <h2 className="font-display text-2xl">Due {formatDate(`${selected}T12:00:00+08:00`)}</h2>
        {selectedSlots.length === 0 ? <Empty>Nothing is due on this date.</Empty> : (
          <ul className="mt-3 space-y-2">
            {selectedSlots.map((slot) => (
              <li key={slot.id}>
                <Link to={openPath(slot)} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                  <span>
                    <span className="block font-semibold">{slot.requirement_title}</span>
                    <span className="text-sm text-muted">{profile.role === "administrator" ? slot.teacher_name : slot.category_name}</span>
                  </span>
                  <StatusBadge status={slot.workflow_status} late={slot.is_late} overdue={slot.is_overdue} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
