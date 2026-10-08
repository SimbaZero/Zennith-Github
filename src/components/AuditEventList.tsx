import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ClipboardList, Users } from "lucide-react";
import { eventTime } from "@/lib/audit-phrasing";

// A list of audit events written as plain sentences, grouped by day.
//
// Shared by the admin Audit Logs page and the activity log at the bottom of the
// reception queue, so an event looks the same in both. A row that has extra
// detail opens on click; rows without any are just a line, so the default view
// stays short.

export type AuditRow = {
  id: string;
  when: string;
  /** One plain sentence, e.g. "Reception updated Pat-204's personal details". */
  text: string;
  /** Extra lines, shown only when the row is opened. */
  detail: string[];
  /** Colours the sentence for events that deserve a second glance. */
  emphasis?: "critical" | "warn";
};

export function AuditEmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-5 py-6 text-sm text-muted-foreground">{children}</p>;
}

/** Events as plain sentences, grouped by day. A row with extra detail opens on
 *  click; the rest are just a line, so the default view stays short. */
export function AuditEventList({
  rows,
  tone,
  empty,
}: {
  rows: AuditRow[];
  tone: "staff" | "queue";
  empty: string;
}) {
  // Group by day so a long list reads as a timeline rather than a wall.
  const grouped = useMemo(() => {
    const map = new Map<string, AuditRow[]>();
    for (const r of rows) {
      const day = new Date(r.when).toLocaleDateString("en-ZA", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(r);
    }
    return [...map.entries()];
  }, [rows]);

  if (grouped.length === 0) return <AuditEmptyLine>{empty}</AuditEmptyLine>;
  return (
    <div className="divide-y">
      {grouped.map(([day, dayRows]) => (
        <div key={day}>
          <div className="px-5 py-2 bg-secondary/40">
            <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              {day}
            </p>
          </div>
          <ul className="divide-y">
            {dayRows.map((r) => (
              <AuditEventRow key={r.id} row={r} tone={tone} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AuditEventRow({
  row,
  tone,
}: {
  row: AuditRow;
  tone: "staff" | "queue";
}) {
  const [open, setOpen] = useState(false);
  const expandable = row.detail.length > 0;
  const body = (
    <>
      <span
        className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          tone === "queue"
            ? "bg-[oklch(0.95_0.05_245)] text-[oklch(0.45_0.15_245)]"
            : "bg-[oklch(0.95_0.04_290)] text-[oklch(0.45_0.15_290)]"
        }`}
      >
        {tone === "queue" ? <ClipboardList size={13} /> : <Users size={13} />}
      </span>
      <p
        className={`flex-1 min-w-0 text-sm py-1 ${
          row.emphasis === "critical"
            ? "text-red-600 font-medium"
            : row.emphasis === "warn"
              ? "text-orange-600"
              : ""
        }`}
      >
        {row.text}
      </p>
      <span className="text-xs text-muted-foreground tabular-nums shrink-0 py-1.5">
        {eventTime(row.when)}
      </span>
      {expandable && (
        <ChevronDown
          size={14}
          className={`mt-2 shrink-0 text-muted-foreground transition ${
            open ? "rotate-180" : ""
          }`}
        />
      )}
      {/* Same width as the chevron, so times line up whether or not a row opens. */}
      {!expandable && <span aria-hidden className="w-3.5 shrink-0" />}
    </>
  );
  return (
    <li>
      {expandable ? (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full text-left px-5 py-2.5 flex items-start gap-3 hover:bg-secondary/30"
        >
          {body}
        </button>
      ) : (
        <div className="px-5 py-2.5 flex items-start gap-3">{body}</div>
      )}
      {expandable && open && (
        <ul className="px-5 pb-3 pl-[3.75rem] space-y-1">
          {row.detail.map((line, i) => (
            <li key={i} className="text-xs text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
