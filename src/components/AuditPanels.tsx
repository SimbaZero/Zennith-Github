import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { AuditEmptyLine } from "@/components/AuditEventList";
import { eventTime } from "@/lib/audit-phrasing";
import type { Flag } from "@/lib/audit-insights";

// The building blocks of an audit page — a titled section, a stat tile, the
// "Worth a look" list.
//
// These are the same patterns as the admin Audit Logs page (admin.audit.tsx),
// written as shared exports so another page can use them. The admin page still
// has its own file-local copies of Section / FlagsSection / MiniStat; pointing
// it at these is a small follow-up (it wasn't touched when these were added).

/** A titled, bordered block. Every part of an audit page uses this so the
 *  sections read as separate things rather than one long list. */
export function AuditSection({
  icon,
  title,
  count,
  hint,
  tone = "plain",
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  hint: string;
  tone?: "plain" | "amber";
  children: ReactNode;
}) {
  return (
    <section
      className={`bg-white rounded-xl border overflow-hidden ${
        tone === "amber" ? "border-amber-300" : ""
      }`}
    >
      <div
        className={`px-5 py-3 border-b flex flex-wrap items-center gap-x-2 gap-y-0.5 ${
          tone === "amber" ? "bg-amber-50" : ""
        }`}
      >
        {icon}
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5 bg-white">
          {count}
        </span>
        <p className="basis-full sm:basis-auto sm:ml-2 text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      {children}
    </section>
  );
}

export function AuditMiniStat({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-xl border p-4 ${alert ? "border-red-300 bg-red-50" : ""}`}
    >
      <p className="text-xs tracking-wider text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${alert ? "text-red-600" : ""}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Things that may be worth reviewing — not findings that anything went wrong.
 * "Mark as reviewed" only hides the prompt for whoever clicks it; it never
 * touches the underlying record.
 */
export function AuditFlagsSection({
  flags,
  onDismiss,
  note,
}: {
  flags: Flag[];
  onDismiss: (id: string) => void;
  /** Shown under the list — for anything the reader needs to know about what
   *  this list can and can't see. */
  note?: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <AuditSection
      icon={<AlertTriangle size={16} className="text-amber-600" />}
      title="Worth a look"
      count={flags.length}
      hint="Things that may be worth reviewing — not a sign that anything went wrong"
    >
      {flags.length === 0 ? (
        <AuditEmptyLine>Nothing needs a look right now.</AuditEmptyLine>
      ) : (
        <ul className="divide-y">
          {flags.map((f) => (
            <li key={f.id}>
              <button
                onClick={() => setOpen(open === f.id ? null : f.id)}
                aria-expanded={open === f.id}
                className="w-full text-left px-5 py-3 hover:bg-secondary/40 flex items-start gap-3"
              >
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                    f.severity === "critical" ? "bg-red-600" : "bg-amber-500"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {f.detail}
                  </p>
                </div>
                <ChevronDown
                  size={14}
                  className={`mt-1 shrink-0 text-muted-foreground transition ${
                    open === f.id ? "rotate-180" : ""
                  }`}
                />
              </button>
              {open === f.id && (
                <div className="px-5 pb-4 pl-10">
                  <p className="text-xs tracking-wider text-muted-foreground mb-2">
                    WHAT HAPPENED
                  </p>
                  <ol className="border-l-2 pl-4 space-y-2">
                    {f.evidence.map((e, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-mono text-muted-foreground mr-2">
                          {eventTime(e.when)}
                        </span>
                        {e.text}
                      </li>
                    ))}
                  </ol>
                  <button
                    onClick={() => onDismiss(f.id)}
                    className="mt-3 text-xs font-medium border px-3 py-2 rounded-md hover:bg-secondary"
                  >
                    Mark as reviewed
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="px-5 py-3 border-t text-xs text-muted-foreground">
          {note}
        </p>
      )}
    </AuditSection>
  );
}
