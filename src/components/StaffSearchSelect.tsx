import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchClinicStaff } from "@/lib/clinic-data";

// ---------------------------------------------------------------------------
// A doctor/nurse picker you can type into, replacing the boxes where reception
// used to type a raw staff ID ("Doc-3", "Nur-315") from memory.
//
// Same contract as ClinicSearchSelect: the form still stores the real staff
// id, typing only filters the list, and the id is set when someone is actually
// chosen — then cleared again if the text is edited afterwards. So what gets
// saved can never be a half-typed name or a misspelt id.
//
// The dropdown itself follows the patient search in the walk-in form on the
// queue page: name on top, id underneath, matched on either.
// ---------------------------------------------------------------------------

export interface StaffOption {
  staffId: string;
  fullName: string;
  role: "doctor" | "nurse";
}

const ROLE_LABEL: Record<StaffOption["role"], string> = {
  doctor: "Doctor",
  nurse: "Nurse",
};

/**
 * Doctors and nurses who work at a clinic, for the pickers.
 *
 * Reuses fetchClinicStaff — the same read the admin pages use, under the same
 * query key, so the result is shared rather than fetched again. It covers
 * staff who serve several clinics, not only those based at this one.
 */
export function useClinicClinicians(clinicId: number | null | undefined): {
  clinicians: StaffOption[];
  loading: boolean;
  error: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["clinic-staff", clinicId],
    queryFn: () => fetchClinicStaff(clinicId!),
    enabled: clinicId != null,
    staleTime: 5 * 60_000,
  });
  const clinicians = useMemo<StaffOption[]>(
    () =>
      (data ?? [])
        .filter((s) => s.role === "doctor" || s.role === "nurse")
        .map((s) => ({
          staffId: s.staffId,
          fullName: s.fullName,
          role: s.role as StaffOption["role"],
        })),
    [data],
  );
  return { clinicians, loading: isLoading && clinicId != null, error: isError };
}

const MAX_SHOWN = 8;
const DEFAULT_INPUT_CLASS =
  "w-full px-3 py-2 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white";

export function StaffSearchSelect(props: {
  id?: string;
  options: StaffOption[];
  /** The chosen staff id (e.g. "Doc-3"), or "" when nobody is chosen. */
  value: string;
  onChange: (staffId: string) => void;
  loading?: boolean;
  /** The list couldn't be loaded. */
  error?: boolean;
  placeholder?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  /** Shown under the box when something is typed but nobody is chosen. */
  pendingHint?: string;
  /**
   * Escape pressed with the list already closed — lets a caller that shows
   * this inline (the handoff row) treat it as "cancel".
   */
  onEscape?: () => void;
  /**
   * List sits in the page flow instead of floating over it. Needed inside a
   * container that clips its overflow, like a queue row.
   */
  inlineList?: boolean;
}) {
  const autoId = useId();
  const id = props.id ?? autoId;
  const listId = `${id}-list`;

  const selected = props.options.find((o) => o.staffId === props.value);
  const [text, setText] = useState(
    selected ? `${selected.fullName} (${selected.staffId})` : "",
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  // Set when the person's own typing is what cleared the value, so the effect
  // below knows to leave their text alone instead of treating it as a reset.
  const clearedByTyping = useRef(false);

  // Keep the text in step when the value is set or cleared from outside — a
  // form resetting itself after submit, or the list arriving after the value.
  useEffect(() => {
    if (selected) {
      setText(`${selected.fullName} (${selected.staffId})`);
    } else if (clearedByTyping.current) {
      clearedByTyping.current = false;
    } else {
      setText("");
    }
  }, [selected?.staffId, selected?.fullName]);

  // Close when the person clicks elsewhere.
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const term = text.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!term) return props.options;
    return props.options.filter(
      (o) =>
        o.fullName.toLowerCase().includes(term) ||
        o.staffId.toLowerCase().includes(term) ||
        ROLE_LABEL[o.role].toLowerCase().includes(term),
    );
  }, [term, props.options]);
  const shown = matches.slice(0, MAX_SHOWN);

  const choose = (o: StaffOption) => {
    props.onChange(o.staffId);
    setText(`${o.fullName} (${o.staffId})`);
    setOpen(false);
  };

  const showList = open && !selected && !props.loading;
  const pending = !open && !selected && term.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={
          showList && shown[active] ? `${id}-opt-${active}` : undefined
        }
        aria-invalid={pending ? true : undefined}
        autoFocus={props.autoFocus}
        disabled={props.loading}
        value={text}
        placeholder={
          props.loading
            ? "Loading staff…"
            : props.error
              ? "Couldn't load staff — try again"
              : (props.placeholder ?? "Search by name or ID…")
        }
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (props.value) {
            clearedByTyping.current = true;
            props.onChange("");
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (showList) setOpen(false);
            else props.onEscape?.();
          } else if (e.key === "ArrowDown" && shown.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, shown.length - 1));
          } else if (e.key === "ArrowUp" && shown.length > 0) {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && showList && shown.length > 0) {
            // Enter inside a form would otherwise submit it with nobody
            // chosen, silently dropping what was typed.
            if (term || active > 0) {
              e.preventDefault();
              choose(shown[active] ?? shown[0]);
            }
          }
        }}
        className={`${props.inputClassName ?? DEFAULT_INPUT_CLASS} ${pending ? "border-amber-400" : ""}`}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className={
            props.inlineList
              ? "mt-1 max-h-60 overflow-y-auto rounded-md border bg-white"
              : "absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-md border bg-white shadow-lg"
          }
        >
          {props.error && (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              The staff list couldn't be loaded. Check the connection and try
              again.
            </li>
          )}
          {!props.error && shown.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-muted-foreground">
              {props.options.length === 0
                ? "No doctors or nurses are listed for this clinic."
                : `No match for "${text.trim()}" — try a name or an ID like Doc-3.`}
            </li>
          )}
          {shown.map((o, i) => (
            <li
              key={o.staffId}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2.5 text-sm border-b last:border-b-0 ${
                i === active ? "bg-secondary" : ""
              }`}
            >
              <div className="font-medium">{o.fullName}</div>
              <div className="text-xs text-muted-foreground">
                {ROLE_LABEL[o.role]} · {o.staffId}
              </div>
            </li>
          ))}
          {matches.length > shown.length && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              + {matches.length - shown.length} more — keep typing to narrow it
              down.
            </li>
          )}
        </ul>
      )}

      {pending && (
        <p className="mt-1 text-xs text-amber-700">
          {props.pendingHint ?? "Choose someone from the list."}
        </p>
      )}
    </div>
  );
}
