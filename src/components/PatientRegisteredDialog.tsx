import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Mail, MessageSquare } from "lucide-react";
import { auth } from "@/firebase";
import { Spinner } from "@/components/Loading";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { patientUserIdOf, updatePatientContact } from "@/lib/clinic-data";
import { looksLikeEmail } from "@/lib/login-identifier";
import {
  describeChannelFailure,
  describeInviteFailure,
  describeSentChannel,
  sendPatientInvite,
  type InviteChannelOutcome,
  type InviteFailure,
  type InviteLoginBy,
  type SendInviteResult,
} from "@/lib/patient-invite";
import { useContactCheck } from "@/lib/use-contact-check";

export interface RegisteredPatient {
  patientId: string;
  name: string;
  phone: string;
  email: string;
}

/** What happened, so the page can say the right thing once the dialog is gone. */
export type RegisteredDialogOutcome = "sent" | "skipped";

/** Failures where trying again, unchanged, can't help. */
const FINAL_FAILURES: InviteFailure[] = [
  "already-has-account",
  "patient-not-found",
  "not-eligible",
  "other-clinic",
  "unauthenticated",
];

const inputClass =
  "w-full px-3 py-2 border rounded-md text-sm outline-none focus:ring-2 focus:ring-[oklch(0.55_0.18_245)] bg-white";

function Outcome({
  channel,
  outcome,
  where,
}: {
  channel: "sms" | "email";
  outcome: InviteChannelOutcome;
  where: string;
}) {
  if (outcome.status === "skipped") return null;
  const label = channel === "sms" ? "Text message" : "Email";
  if (outcome.status === "sent") {
    // Test mode is a calm grey note, not a success tick and not a warning; the
    // live wording is the same whether or not the message arrives.
    return (
      <li
        className={
          outcome.mode === "test" ? "text-muted-foreground" : "text-emerald-800"
        }
        data-testid={`invite-${channel}-sent`}
        data-mode={outcome.mode}
      >
        <strong className="text-foreground">
          {label} to {where}.
        </strong>{" "}
        {describeSentChannel(channel, outcome.mode)}
      </li>
    );
  }
  return (
    <li
      className="text-[oklch(0.45_0.2_25)]"
      data-testid={`invite-${channel}-failed`}
    >
      <strong>{label} not sent.</strong>{" "}
      {describeChannelFailure(outcome.reason)}
    </li>
  );
}

/**
 * Shown, centred, right after a patient is registered at the desk. Confirms the
 * patient was created and asks whether to send them a login link (a link to
 * choose their own password) by text and/or e-mail.
 *
 * Reception is never stuck in here:
 *   - "Skip for now" (and closing the dialog) leaves the patient exactly as
 *     registered, with no login link sent;
 *   - the phone number and e-mail are editable right here, so a wrong or
 *     already-used address is corrected on the spot and sent again;
 *   - an e-mail that another account owns can be sidestepped by having the
 *     patient sign in with their Patient ID instead.
 * Every failure says what went wrong in plain words and leaves those options.
 */
export function PatientRegisteredDialog({
  patient,
  onClose,
}: {
  patient: RegisteredPatient;
  onClose: (outcome: RegisteredDialogOutcome) => void;
}) {
  // What the record holds right now, so only a real change is saved.
  const [saved, setSaved] = useState({
    phone: patient.phone,
    email: patient.email,
  });
  const [phone, setPhone] = useState(patient.phone);
  const [email, setEmail] = useState(patient.email);
  // null = "follow whether there is anything typed in the box".
  const [smsTick, setSmsTick] = useState<boolean | null>(null);
  const [emailTick, setEmailTick] = useState<boolean | null>(null);
  const [loginBy, setLoginBy] = useState<InviteLoginBy>("email");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState<SendInviteResult | null>(null);
  // Whose record this is, so their own details aren't "already registered".
  const [ownUserId, setOwnUserId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    patientUserIdOf(patient.patientId)
      .then((id) => live && setOwnUserId(id))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [patient.patientId]);

  const usePhone = smsTick ?? !!phone.trim();
  const useEmail = emailTick ?? !!email.trim();
  const emailBad = !!email.trim() && !looksLikeEmail(email);

  const contact = useContactCheck(
    ownUserId != null ? email : "",
    ownUserId != null && phone.trim() ? [phone.trim()] : [],
    ownUserId,
  );
  const found = contact.status === "done" ? contact.result : null;
  const emailShared = !!found?.email;
  const phoneShared = !!found?.phones[phone.trim()];

  const sent =
    result?.ok === true &&
    (result.sms.status === "sent" || result.email.status === "sent");
  const finished = sent;
  // Everything that was "sent" was only recorded (test mode).
  const sentModes =
    result?.ok === true
      ? [result.sms, result.email].flatMap((o) =>
          o.status === "sent" ? [o.mode] : [],
        )
      : [];
  const testOnly = sentModes.length > 0 && sentModes.every((m) => m === "test");
  const final = result?.ok === false && FINAL_FAILURES.includes(result.reason);
  const nothingChosen =
    !(usePhone && phone.trim()) && !(useEmail && email.trim());
  const edited =
    phone.trim() !== saved.phone.trim() || email.trim() !== saved.email.trim();

  const close = (outcome?: RegisteredDialogOutcome) => {
    if (busy) return;
    onClose(outcome ?? (sent ? "sent" : "skipped"));
  };

  const send = async (by: InviteLoginBy = loginBy) => {
    if (emailBad && useEmail) {
      setProblem("That e-mail address doesn't look right.");
      return;
    }
    setBusy(true);
    setProblem("");
    setResult(null);
    try {
      // Correcting a number or address saves it to the patient's record first:
      // the server sends to what the record holds, never to what's typed here.
      const changed =
        phone.trim() !== saved.phone.trim() ||
        email.trim() !== saved.email.trim();
      if (changed) {
        try {
          await updatePatientContact(patient.patientId, {
            contactNum: phone,
            email,
          });
          setSaved({ phone: phone.trim(), email: email.trim() });
        } catch (error) {
          console.error(error);
          setProblem(
            error instanceof Error && error.message
              ? `Couldn't save the corrected contact details: ${error.message}`
              : "Couldn't save the corrected contact details. Check the connection and try again, or skip for now.",
          );
          return;
        }
      }
      const idToken = (await auth.currentUser?.getIdToken()) ?? "";
      setLoginBy(by);
      setResult(
        await sendPatientInvite({
          data: {
            idToken,
            patientId: patient.patientId,
            sms: usePhone && !!phone.trim(),
            email: useEmail && !!email.trim(),
            loginBy: by,
          },
        }),
      );
    } catch (error) {
      console.error(error);
      setResult({ ok: false, reason: "server-error" });
    } finally {
      setBusy(false);
    }
  };

  const failedReason = result?.ok === false ? result.reason : null;
  const emailTrouble =
    failedReason === "email-in-use" || failedReason === "username-taken";

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        data-testid="registered-dialog"
        className="max-h-[90vh] max-w-md overflow-y-auto"
        onInteractOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-emerald-700">
            <CheckCircle2 size={22} aria-hidden />
            <span className="text-sm font-medium">Patient registered</span>
          </div>
          <DialogTitle>{patient.name}</DialogTitle>
          <DialogDescription>
            Patient ID{" "}
            <span className="font-mono font-semibold text-foreground">
              {patient.patientId}
            </span>{" "}
            has been created.
          </DialogDescription>
        </DialogHeader>

        {finished ? (
          <div className="space-y-3 text-sm" data-testid="invite-result">
            <ul className="space-y-1">
              {result?.ok && (
                <>
                  <Outcome
                    channel="sms"
                    outcome={result.sms}
                    where={phone.trim()}
                  />
                  <Outcome
                    channel="email"
                    outcome={result.email}
                    where={email.trim()}
                  />
                </>
              )}
            </ul>
            {result?.ok && (
              <p className="text-muted-foreground">
                {testOnly ? "Once messaging is on, they'll" : "They will"} sign
                in with{" "}
                <span className="font-mono font-semibold text-foreground">
                  {result.username}
                </span>
                . The link works once and lasts 7 days.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-lg border border-[oklch(0.85_0.08_245)] bg-[oklch(0.97_0.03_245)] p-3">
              <KeyRound
                size={18}
                className="mt-0.5 shrink-0 text-[oklch(0.4_0.15_245)]"
              />
              <p className="text-sm">
                <strong>Send a login link?</strong> They get a link to choose
                their own password, so they can see their appointments and
                record. The message also tells them what to sign in with.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={usePhone}
                    onChange={(e) => setSmsTick(e.target.checked)}
                    disabled={busy}
                  />
                  <MessageSquare
                    size={14}
                    className="text-muted-foreground"
                    aria-hidden
                  />
                  Send by text message
                </label>
                <input
                  aria-label="Mobile number"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Mobile number, e.g. 082 123 4567"
                  disabled={busy}
                  className={`${inputClass} mt-1.5`}
                />
                {phoneShared && (
                  <p
                    role="status"
                    className="mt-1 text-xs text-amber-800"
                    data-testid="phone-shared"
                  >
                    This number is already registered to another patient.
                  </p>
                )}
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={useEmail}
                    onChange={(e) => setEmailTick(e.target.checked)}
                    disabled={busy}
                  />
                  <Mail
                    size={14}
                    className="text-muted-foreground"
                    aria-hidden
                  />
                  Send by email
                </label>
                <input
                  aria-label="Email address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  disabled={busy}
                  className={`${inputClass} mt-1.5`}
                />
                {emailBad && (
                  <p className="mt-1 text-xs text-[oklch(0.45_0.2_25)]">
                    That e-mail address doesn't look right.
                  </p>
                )}
                {emailShared && (
                  <p
                    role="status"
                    className="mt-1 text-xs text-amber-800"
                    data-testid="email-shared"
                  >
                    This email is already registered to another patient.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* What went wrong, in plain words, with a way forward. */}
        {!finished && result && (
          <div
            role="status"
            data-testid="invite-result"
            className="space-y-2 rounded-lg border bg-secondary/40 p-3 text-sm"
          >
            {result.ok ? (
              <ul className="space-y-1">
                <Outcome
                  channel="sms"
                  outcome={result.sms}
                  where={phone.trim()}
                />
                <Outcome
                  channel="email"
                  outcome={result.email}
                  where={email.trim()}
                />
              </ul>
            ) : (
              <p
                className="text-[oklch(0.45_0.2_25)]"
                data-testid="invite-error"
              >
                {describeInviteFailure(result.reason, result.retryAt)}
              </p>
            )}
            {result.ok && (
              <p className="text-muted-foreground">
                Fix the details above and try again, or skip for now — the
                patient profile is kept either way.
              </p>
            )}
          </div>
        )}
        {problem && (
          <p
            role="alert"
            className="text-sm text-[oklch(0.45_0.2_25)]"
            data-testid="invite-problem"
          >
            {problem}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {finished ? (
            <button
              type="button"
              onClick={() => close("sent")}
              className="rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm font-medium text-white"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => close("skipped")}
                disabled={busy}
                className="rounded-md border px-4 py-2 text-sm hover:bg-secondary disabled:opacity-60"
              >
                {final ? "Close" : "Skip for now"}
              </button>
              {emailTrouble && failedReason === "email-in-use" && (
                <button
                  type="button"
                  onClick={() => send("patient-id")}
                  disabled={busy}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-secondary disabled:opacity-60"
                >
                  Use their Patient ID to sign in
                </button>
              )}
              {!final && (
                <button
                  type="button"
                  onClick={() => send()}
                  disabled={busy || nothingChosen}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-[oklch(0.18_0.06_260)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {busy && <Spinner />}
                  {busy
                    ? "Sending…"
                    : result
                      ? edited
                        ? "Save changes & try again"
                        : "Try again"
                      : "Send login link"}
                </button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
