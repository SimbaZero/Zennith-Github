import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PASSWORD_RULES } from "@/lib/form-rules";
import { inputClass } from "@/lib/form-ui";

// ---------------------------------------------------------------------------
// Shared building blocks for the signup and clinic-registration forms:
//   - Field: a labelled input. Password fields get a show/hide eye so people
//     can check what they typed. A field with an error turns red and shows
//     its message directly underneath.
//   - FieldError: the same red message for the inputs that aren't plain
//     text (a select, a checkbox). Their red styling is inputClass, in
//     form-ui.ts.
//   - PasswordChecklist: live ticks for the password rules.
// ---------------------------------------------------------------------------

/** Red message shown directly under the field it belongs to. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive mt-1">
      {message}
    </p>
  );
}

export function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  error,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
  /** Extra content under the input, above the error (e.g. a checklist). */
  hint?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium block mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && shown ? "text" : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={inputClass(!!error, isPassword ? "pr-11" : "")}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 px-3 flex items-center text-muted-foreground hover:text-foreground"
          >
            {shown ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {hint}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** Live ticks for the password rules. Appears once the person starts typing. */
export function PasswordChecklist({ value }: { value: string }) {
  if (!value) return null;
  return (
    <ul
      className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs"
      aria-label="Password requirements"
    >
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        return (
          <li
            key={rule.key}
            className={met ? "text-green-700" : "text-muted-foreground"}
          >
            {met ? "✓" : "○"} {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
