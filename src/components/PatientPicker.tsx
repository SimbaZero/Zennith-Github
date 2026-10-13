import { useEffect, useId, useRef, useState } from "react";
import { Check, UserSearch } from "lucide-react";
import { Spinner } from "@/components/Loading";
import { findPatient, searchPatientsByName } from "@/lib/clinic-data";
import { canonicalPatientId } from "@/lib/patient-id";
import type { PatientSummary } from "@/lib/clinic-data";

// One box for "which patient": type the ID (any capitalisation) OR a name.
//
// * An ID ("pat-828", "PAT-828", "Pat 828") is normalised to "Pat-828" and
//   checked, so the capitalisation can't be the reason a patient isn't found.
// * Anything else is treated as a name. Every match is listed WITH its ID, and
//   nothing is chosen until the person clicks one: two patients with the same
//   name are shown side by side so they can tell which is which, rather than
//   the first being picked silently.
//
// The parent keeps the chosen ID in `value` (empty until one is settled), so
// the form can't submit a name that doesn't belong to a patient.

const DEBOUNCE_MS = 300;

export function PatientPicker({
  value,
  onChange,
  clinicId,
  id,
  label = "Patient ID or name",
  placeholder = "e.g. Pat-828, or start typing a name",
  disabled,
  className = "",
}: {
  value: string;
  onChange: (patientId: string) => void;
  /** Search is limited to this clinic's patients when given. */
  clinicId?: number | null;
  id?: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const reactId = useId();
  const inputId = id ?? `patient-picker-${reactId}`;
  const listId = `${inputId}-list`;
  const [text, setText] = useState(value);
  const [results, setResults] = useState<PatientSummary[]>([]);
  const [confirmed, setConfirmed] = useState<PatientSummary | null>(null);
  const [state, setState] = useState<
    "idle" | "searching" | "none" | "unavailable" | "not-found"
  >("idle");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  // The text we wrote ourselves when a row was chosen; typing it back out as
  // "Name (Pat-1)" must not start another search.
  const settledText = useRef<string | null>(null);

  // The form was reset from outside (e.g. after a booking is saved): clear the
  // box if it is still showing a settled patient or a typed ID.
  useEffect(() => {
    if (value === "" && (confirmed || canonicalPatientId(text))) {
      setText("");
      setConfirmed(null);
      settledText.current = null;
      setState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  useEffect(() => {
    const t = text.trim();
    if (settledText.current !== null && t === settledText.current) return;
    settledText.current = null;
    const mine = ++seq.current;
    setConfirmed(null);
    if (!t) {
      setResults([]);
      setState("idle");
      onChange("");
      return;
    }

    const canon = canonicalPatientId(t);
    if (canon) {
      // An ID: pass the canonical form straight up, then confirm it exists.
      onChange(canon);
      setResults([]);
      setState("searching");
      const timer = setTimeout(async () => {
        try {
          const found = await findPatient(canon, clinicId ?? null);
          if (mine !== seq.current) return;
          if (found) {
            setConfirmed(found);
            setState("idle");
          } else {
            setState("not-found");
          }
        } catch {
          if (mine === seq.current) setState("unavailable");
        }
      }, DEBOUNCE_MS);
      return () => clearTimeout(timer);
    }

    // A name: nothing is chosen until a row is clicked.
    onChange("");
    if (t.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }
    setState("searching");
    const timer = setTimeout(async () => {
      try {
        const rows = await searchPatientsByName(t, clinicId ?? null);
        if (mine !== seq.current) return;
        setResults(rows);
        setState(rows.length === 0 ? "none" : "idle");
        setOpen(true);
      } catch (err) {
        if (mine !== seq.current) return;
        console.warn("Patient name search failed:", err);
        setResults([]);
        setState("unavailable");
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, clinicId]);

  const choose = (p: PatientSummary) => {
    const shown = `${p.name} (${p.patientId})`;
    settledText.current = shown;
    setText(shown);
    setConfirmed(p);
    setResults([]);
    setState("idle");
    setOpen(false);
    onChange(p.patientId);
  };

  // How many results share each name, so lookalikes can be flagged.
  const nameCount = new Map<string, number>();
  for (const r of results) {
    const k = r.name.trim().toLowerCase();
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }
  const hasDuplicates = [...nameCount.values()].some((n) => n > 1);
  const showList = open && results.length > 0 && !confirmed;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <label
        htmlFor={inputId}
        className="text-[11px] tracking-wider text-muted-foreground block mb-1"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && showList && results.length === 1) {
              e.preventDefault();
              choose(results[0]);
            }
          }}
          className="w-full px-3 py-2 pr-9 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white disabled:opacity-60"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
          {state === "searching" ? (
            <Spinner size={14} label="Searching" />
          ) : confirmed ? (
            <Check size={14} className="text-emerald-600" aria-hidden />
          ) : (
            <UserSearch size={14} aria-hidden />
          )}
        </span>
      </div>

      {confirmed && (
        <p className="mt-1 text-xs text-emerald-800">
          {confirmed.name} · {confirmed.patientId}
          {confirmed.lastVisit && confirmed.lastVisit !== "—"
            ? ` · last visit ${confirmed.lastVisit}`
            : ""}
        </p>
      )}
      {state === "not-found" && (
        <p role="status" className="mt-1 text-xs text-destructive">
          No patient with ID {value} at this clinic.
        </p>
      )}
      {state === "none" && (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          No patient matches “{text.trim()}”. Try the Patient ID instead.
        </p>
      )}
      {state === "unavailable" && (
        <p role="status" className="mt-1 text-xs text-amber-800">
          Search isn't available right now — enter the Patient ID instead.
        </p>
      )}

      {showList && (
        <div className="absolute z-30 mt-1 w-full rounded-md border bg-white shadow-lg">
          {hasDuplicates && (
            <p className="border-b bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
              More than one patient has the same name. Check the ID, then click
              the right one to confirm.
            </p>
          )}
          <ul id={listId} role="listbox" className="max-h-56 overflow-y-auto">
            {results.map((p) => {
              const dup = (nameCount.get(p.name.trim().toLowerCase()) ?? 0) > 1;
              return (
                <li
                  key={p.patientId}
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(p);
                  }}
                  className="flex cursor-pointer items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-secondary"
                >
                  <span className="min-w-0 truncate">
                    {p.name}
                    {dup && (
                      <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
                        same name
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-xs font-semibold">
                      {p.patientId}
                    </span>
                    {p.lastVisit && p.lastVisit !== "—" && (
                      <span className="block text-[10px] text-muted-foreground">
                        last visit {p.lastVisit}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
