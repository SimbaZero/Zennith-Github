import { useEffect, useMemo, useRef, useState } from "react";
import { inputClass } from "@/lib/form-ui";

// ---------------------------------------------------------------------------
// A clinic picker you can type into. Replaces a plain <select> on signup,
// where the list of clinics grows as new ones are approved.
//
// The form still stores a clinic id (as text). Typing only filters the list;
// the id is set when a clinic is actually chosen, and cleared again if the
// person edits the text afterwards — so the form can never submit a name that
// doesn't match a real clinic.
// ---------------------------------------------------------------------------

export interface ClinicSearchOption {
  clinicId: number;
  clinicName: string;
}

export function ClinicSearchSelect(props: {
  id: string;
  clinics: ClinicSearchOption[];
  /** Selected clinic id as text, or "" when nothing is chosen. */
  value: string;
  onChange: (clinicId: string) => void;
  loading?: boolean;
  invalid?: boolean;
  errorId?: string;
}) {
  const selected = props.clinics.find(
    (c) => String(c.clinicId) === props.value,
  );
  const [text, setText] = useState(selected?.clinicName ?? "");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Keep the text in step when the value is set or cleared from outside.
  useEffect(() => {
    setText(selected?.clinicName ?? "");
  }, [selected?.clinicName]);

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

  const matches = useMemo(() => {
    const term = text.trim().toLowerCase();
    if (!term || selected) return props.clinics;
    return props.clinics.filter((c) =>
      c.clinicName.toLowerCase().includes(term),
    );
  }, [text, selected, props.clinics]);

  return (
    <div ref={boxRef} className="relative">
      <input
        id={props.id}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-invalid={props.invalid ? true : undefined}
        aria-describedby={props.errorId}
        disabled={props.loading}
        value={text}
        placeholder={
          props.loading ? "Loading clinics..." : "Search for your clinic"
        }
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (props.value) props.onChange("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter" && open && matches.length === 1) {
            e.preventDefault();
            props.onChange(String(matches[0].clinicId));
            setText(matches[0].clinicName);
            setOpen(false);
          }
        }}
        className={inputClass(!!props.invalid, "bg-white")}
      />
      {open && !props.loading && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-white shadow-lg"
        >
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No clinic matches "{text.trim()}".
            </li>
          )}
          {matches.map((c) => (
            <li
              key={c.clinicId}
              role="option"
              aria-selected={String(c.clinicId) === props.value}
              onMouseDown={(e) => {
                e.preventDefault();
                props.onChange(String(c.clinicId));
                setText(c.clinicName);
                setOpen(false);
              }}
              className="cursor-pointer px-3 py-2 text-sm hover:bg-secondary"
            >
              {c.clinicName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
