// Server-only: turns what someone typed into the sign-in box into the Firebase
// Auth e-mail(s) to try.
//
// This has to run on the server because the profile documents can't be read
// before sign-in (the rules require a signed-in user), and the alternative -
// signing every visitor in anonymously just to look themselves up - would leave
// an anonymous account behind on every attempt.
//
// It returns candidate e-mail addresses and nothing else, and it can't be asked
// anything the sign-in itself wouldn't have to reveal: a candidate list only
// matters to someone who also has the password. It does let a caller learn the
// contact e-mail for a username, which is the same information the profiles
// collection already gives any signed-in user (a known, documented limitation).
import {
  looksLikeEmail,
  loginCandidates,
  normaliseIdentifier,
  type LoginProfileHint,
} from "../lib/login-identifier";
import {
  FirestoreConfigError,
  firestoreAdminFromEnv,
  type FirestoreAdmin,
} from "./firestore-admin";

export async function lookUpLoginCandidates(
  identifier: unknown,
  env?: unknown,
): Promise<{ candidates: string[]; resolved: boolean }> {
  const id = normaliseIdentifier(
    typeof identifier === "string" ? identifier : "",
  );
  // Whatever happens below, the plain interpretation is always available.
  const plain = loginCandidates(id);
  if (!id) return { candidates: plain, resolved: false };

  let fs;
  try {
    fs = firestoreAdminFromEnv(env);
  } catch (error) {
    if (error instanceof FirestoreConfigError)
      return { candidates: plain, resolved: false };
    throw error;
  }

  return candidatesFrom(fs, id);
}

/** The part after the database is reachable; split out so it can be tested. */
export async function candidatesFrom(
  fs: Pick<FirestoreAdmin, "query">,
  id: string,
): Promise<{ candidates: string[]; resolved: boolean }> {
  try {
    const field = looksLikeEmail(id) ? "email" : "username";
    const docs = await fs.query("profiles", [
      { field, op: "EQUAL", value: id },
    ]);
    const hints: LoginProfileHint[] = docs.slice(0, 3).map((d) => ({
      username: d.data.username,
      email: d.data.email,
      builtin: d.data.builtin,
    }));
    return { candidates: loginCandidates(id, hints), resolved: true };
  } catch (error) {
    console.error(
      "[login-lookup] profile lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return { candidates: loginCandidates(id), resolved: false };
  }
}
