import { useId, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// A date box for forms, built on the same popover + calendar as the main
// Appointments page rather than the browser's native <input type="date">.
//
// The native picker is drawn by the browser, outside the page, so nothing in the
// page can stop it running off the edge of a narrow window - which is what
// happened in the booking forms, where the date box sits in a multi-column grid
// near the right-hand side. This popover flips and shifts to stay inside the
// window, and scrolls inside itself if there still isn't room.
//
// `value` and `onChange` use "YYYY-MM-DD", exactly as the native input did, so a
// form can swap one for the other.

/** "2026-10-12" -> a Date at LOCAL midnight (no UTC shifting a day). */
export function fromIsoDay(iso: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/** A Date from the calendar -> "YYYY-MM-DD" from its LOCAL parts. */
export function toIsoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DateField({
  label,
  value,
  onChange,
  id,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  id?: string;
  className?: string;
}) {
  const reactId = useId();
  const triggerId = id ?? `date-field-${reactId}`;
  const [open, setOpen] = useState(false);
  const selected = fromIsoDay(value);
  return (
    <div className={className}>
      <label
        htmlFor={triggerId}
        className="text-[11px] tracking-wider text-muted-foreground block mb-1"
      >
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={triggerId}
            type="button"
            aria-haspopup="dialog"
            className="flex w-full items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-left text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)]"
          >
            <span className={value ? "" : "text-muted-foreground"}>
              {value || "Choose a date"}
            </span>
            <CalendarDays size={14} className="shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          className="w-auto overflow-auto p-0"
          style={{
            maxHeight: "var(--radix-popover-content-available-height)",
            maxWidth: "var(--radix-popover-content-available-width)",
          }}
        >
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(d) => {
              if (!d) return;
              onChange(toIsoDay(d));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
