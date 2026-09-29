import { validateIdByType, type IdType } from "@/lib/sa-id";

// ---------------------------------------------------------------------------
// Validation shared by patient signup and clinic registration, kept out of the
// page components so both forms follow the same rules and the rules can be
// tested without rendering anything.
//
// NOTE: these checks run in the browser, which makes them a convenience for
// the person filling the form in, not a security boundary. Firebase enforces
// its own minimum (6 characters) on the server. To enforce the stronger
// password rule server-side too, turn on the password policy in the Firebase
// console (Authentication -> Settings -> Password policy).
// ---------------------------------------------------------------------------

export const QUOTA_MESSAGE =
  "We've reached today's free database limit, so nothing was saved. Please try again later.";

/** True when Firestore refused the request because the free daily quota is used up. */
export function isQuotaError(err: unknown): boolean {
  const code =
    err instanceof Object && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /resource-exhausted|quota/i.test(`${code} ${message}`);
}

/** Swaps a raw quota error for a message a person can act on. */
export function friendlyServerMessage(message: string): string {
  return /resource-exhausted|quota/i.test(message) ? QUOTA_MESSAGE : message;
}

/** Which signup field a message from the server is about (null = general). */
export function fieldForServerError(
  message: string,
): "idNumber" | "email" | "password" | null {
  if (/id number/i.test(message)) return "idNumber";
  if (/not enabled|could not create/i.test(message)) return null;
  if (/email/i.test(message)) return "email";
  if (/password/i.test(message)) return "password";
  return null;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function isValidPhone(value: string): boolean {
  return /^[+\d\s-]{7,}$/.test(value);
}

// ---- passwords -------------------------------------------------------------

export const PASSWORD_RULES = [
  { key: "length", label: "8+ characters", test: (p: string) => p.length >= 8 },
  { key: "letter", label: "a letter", test: (p: string) => /[A-Za-z]/.test(p) },
  { key: "number", label: "a number", test: (p: string) => /\d/.test(p) },
] as const;

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** null when the password is acceptable, otherwise what is missing. */
export function passwordProblem(password: string): string | null {
  const unmet = PASSWORD_RULES.filter((r) => !r.test(password)).map(
    (r) => r.label,
  );
  if (unmet.length === 0) return null;
  return `Password is not strong enough — it needs ${joinWithAnd(unmet)}.`;
}

// ---- patient signup --------------------------------------------------------

export interface SignupFormValues {
  name: string;
  email: string;
  phone: string;
  idType: IdType;
  idNumber: string;
  password: string;
  confirm: string;
  clinicId: string;
}

export type SignupField =
  "name" | "email" | "phone" | "idNumber" | "clinicId" | "password" | "confirm";

/** Top-to-bottom order on the page, so the first error gets the cursor. */
export const SIGNUP_FIELD_ORDER: SignupField[] = [
  "name",
  "email",
  "phone",
  "idNumber",
  "clinicId",
  "password",
  "confirm",
];

export type SignupErrors = Partial<Record<SignupField, string>>;

export function normalizeId(raw: string, type: IdType): string {
  const id = raw.replace(/\s+/g, "");
  return type === "sa_id" ? id : id.toUpperCase();
}

export function validateSignupForm(form: SignupFormValues): SignupErrors {
  const errors: SignupErrors = {};

  if (form.name.trim().length < 2) errors.name = "Enter your full name.";
  if (!isValidEmail(form.email))
    errors.email = "Enter a valid email address, like name@example.com.";
  if (!isValidPhone(form.phone))
    errors.phone = "Enter a valid phone number, like 082 123 4567.";

  const idCheck = validateIdByType(
    normalizeId(form.idNumber, form.idType),
    form.idType,
  );
  if (!idCheck.valid)
    errors.idNumber = idCheck.reason ?? "Check your ID number.";

  if (!form.clinicId) errors.clinicId = "Please choose your nearest clinic.";

  const weak = passwordProblem(form.password);
  if (weak) errors.password = weak;

  if (!form.confirm) errors.confirm = "Type your password again to confirm it.";
  else if (form.confirm !== form.password)
    errors.confirm = "Passwords do not match.";

  return errors;
}

// ---- clinic registration ---------------------------------------------------

export interface ClinicFormValues {
  clinicName: string;
  type: "public" | "private";
  address: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  registrationNumber: string;
  agreedToTerms: boolean;
  /** Private clinics only. */
  billingCycle: "monthly" | "annual";
  trialRequested: boolean;
  /** Blank means "use my contact email". */
  billingEmail: string;
}

export type ClinicField =
  | "clinicName"
  | "registrationNumber"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "billingEmail"
  | "agreedToTerms";

export const CLINIC_FIELD_ORDER: ClinicField[] = [
  "clinicName",
  "registrationNumber",
  "contactName",
  "contactEmail",
  "contactPhone",
  "billingEmail",
  "agreedToTerms",
];

export type ClinicErrors = Partial<Record<ClinicField, string>>;

export function validateClinicForm(form: ClinicFormValues): ClinicErrors {
  const errors: ClinicErrors = {};

  if (!form.clinicName.trim()) errors.clinicName = "Enter your clinic's name.";
  if (form.type === "private" && !form.registrationNumber.trim())
    errors.registrationNumber =
      "Private clinics need a practice registration number.";
  if (!form.contactName.trim()) errors.contactName = "Enter your name.";
  if (!isValidEmail(form.contactEmail))
    errors.contactEmail = "Enter a valid email address, like name@example.com.";
  if (form.contactPhone.trim() && !isValidPhone(form.contactPhone))
    errors.contactPhone = "Enter a valid phone number, or leave it blank.";
  if (
    form.type === "private" &&
    form.billingEmail.trim() &&
    !isValidEmail(form.billingEmail)
  )
    errors.billingEmail =
      "Enter a valid email address, or leave it blank to use your contact email.";
  if (!form.agreedToTerms)
    errors.agreedToTerms = "Please confirm you accept the plan terms.";

  return errors;
}
