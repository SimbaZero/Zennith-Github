import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/Loading";
import { ClinicMiniMap } from "@/components/ClinicMiniMap";
import { usePublicQueueSummary } from "@/lib/clinic-data";
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
  /** Stored location, if the clinic has one; drives the mini-map. */
  coordinates?: string;
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
  //
  // A clinic being chosen fills the box. The value going away is NOT always an
  // outside reset: it is also what happens the moment the person edits a chosen
  // clinic's name (typing clears the id). Wiping the box then threw away what
  // they had just typed, so the text is only cleared when it still shows the
  // old clinic's name, i.e. the form was reset from outside.
  const lastName = useRef<string | undefined>(selected?.clinicName);
  useEffect(() => {
    const name = selected?.clinicName;
    if (name) setText(name);
    else if (lastName.current && text === lastName.current) setText("");
    lastName.current = name;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        placeholder={props.loading ? "" : "Search for your clinic"}
        aria-busy={props.loading || undefined}
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
      {props.loading && (
        <Spinner
          label="Loading clinics"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      )}
      {open && !props.loading && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto rounded-md border bg-white shadow-lg"
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
              className="cursor-pointer border-b px-3 py-2 last:border-b-0 hover:bg-secondary"
            >
              <ClinicOptionCard clinic={c} />
            </li>
          ))}
          {matches.length > 0 && (
            <li
              role="presentation"
              className="border-t bg-secondary/40 px-3 py-1.5 text-[10px] text-muted-foreground"
            >
              Maps ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                OpenStreetMap contributors
              </a>
              . Queue figures are live and show counts only.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * One clinic in the list: where it is, and how busy it is right now.
 *
 * The queue figures come from usePublicQueueSummary - the same live read the
 * landing page uses, and the same `queue` collection the receptionist works
 * from - so what a patient sees here is what reception sees. Counts only: no
 * name or reason ever reaches this component. The subscription exists only
 * while the list is open, because the card is only mounted then.
 */
/** Twice the size the thumbnail used to be (112 x 72): it was too small to read. */
const MAP_WIDTH = 224;
const MAP_HEIGHT = 144;

function ClinicOptionCard({ clinic }: { clinic: ClinicSearchOption }) {
  const q = usePublicQueueSummary(clinic.clinicId);
  const load =
    q.waiting <= 3
      ? "bg-emerald-500"
      : q.waiting <= 8
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    // The thumbnail is twice the size it was, so beside the text it only fits
    // when the card is wide enough; a narrow card puts the map above instead of
    // squeezing the text. (Container query: it's the card's width that matters,
    // not the screen's.)
    <div className="@container">
      <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:gap-3">
        <ClinicMiniMap
          coordinates={clinic.coordinates}
          name={clinic.clinicName}
          width={MAP_WIDTH}
          height={MAP_HEIGHT}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{clinic.clinicName}</p>
          {q.loading ? (
            <p className="mt-1 text-xs text-muted-foreground">
              <Spinner size={11} className="mr-1 inline" />
              Checking the queue…
            </p>
          ) : (
            <>
              <p className="mt-1 flex items-center gap-1.5 text-xs">
                <span aria-hidden className={`h-2 w-2 rounded-full ${load}`} />
                {q.waiting === 0
                  ? "No one waiting"
                  : `${q.waiting} ${q.waiting === 1 ? "person" : "people"} waiting`}
              </p>
              <p className="text-xs text-muted-foreground">
                {q.avgWaitMin != null
                  ? `About ${q.avgWaitMin} min typical wait today`
                  : "Wait estimate not available yet"}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
