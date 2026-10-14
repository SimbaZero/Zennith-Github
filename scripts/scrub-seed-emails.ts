// One-off cleanup of the e-mail addresses already stored on demo/test people:
//
//   bun scripts/scrub-seed-emails.ts --dry-run          # show what would change
//   bun scripts/scrub-seed-emails.ts                    # make the changes
//   bun scripts/scrub-seed-emails.ts --include-logins   # ALSO change the sign-in
//        # address of people who can log in with a real address (see below)
//
// Two kinds of address are replaced, on every `users` document:
//   1. INVALID ones (spaces and the like, e.g. "sipho.van der merwe90102@zennith.test")
//      -> repaired in place ("sipho.vandermerwe90102@zennith.test"). They can
//      never be a login, so this is safe for everyone.
//   2. Addresses on a real provider (gmail.com, icloud.com, uj.ac.za, a typo
//      like gmail.vom...) -> firstname.lastname@zennith.test, with the user
//      number added if that name is already taken.
//
// Real-provider addresses that someone SIGNS IN with are the catch: the
// address is also their Firebase Auth email and their profile username, so
// changing the `users` record alone would split the three apart. By default
// those people are only listed ("has a login - skipped"). --include-logins
// changes all three together (users.email/emailLower, profiles.email/username,
// and the Firebase Auth email), after which they sign in with the new address
// and their existing password; the old address stops working.
//
// It only changes the fields named above, never anything else, and only ever
// writes to documents that already exist. It acts as the project's service
// account (FIREBASE_SERVICE_ACCOUNT in `.env`), so it bypasses the rules.
// Messages recorded in test mode (the e-mail outbox) are not touched.
import {
  firestoreAdminFromEnv,
  type FirestoreDoc,
} from "../src/server/firestore-admin";
import {
  demoEmailFor,
  isDemoAddress,
  isValidEmail,
  repairDemoAddress,
} from "./lib/demo-emails";

export interface EmailChange {
  userDocId: string;
  userId: number | null;
  name: string;
  from: string;
  to: string;
  kind: "repair-invalid" | "replace-real";
  /** A profile (sign-in) document that uses the old address, if any. */
  profile?: {
    id: string;
    username: string;
    emailMatches: boolean;
    usernameMatches: boolean;
  };
}

export interface EmailScrubPlan {
  changes: EmailChange[];
  /** Has a real sign-in on the address: listed, not changed, without --include-logins. */
  hasLogin: EmailChange[];
  untouched: number;
}

const lower = (v: unknown) =>
  String(v ?? "")
    .trim()
    .toLowerCase();

/** What the scrub would do. Pure; no database. */
export function planEmailScrub(
  users: Pick<FirestoreDoc, "id" | "data">[],
  profiles: Pick<FirestoreDoc, "id" | "data">[],
  options: { includeLogins?: boolean } = {},
): EmailScrubPlan {
  const plan: EmailScrubPlan = { changes: [], hasLogin: [], untouched: 0 };

  const profileByUserId = new Map<number, Pick<FirestoreDoc, "id" | "data">>();
  for (const p of profiles) {
    const n = Number(p.data.legacyUserId);
    if (Number.isFinite(n)) profileByUserId.set(n, p);
  }

  // Every address in use or already planned, so replacements stay unique.
  const taken = new Set<string>();
  for (const u of users) {
    const e = lower(u.data.email);
    if (e && isValidEmail(e)) taken.add(e);
  }

  for (const u of users) {
    const raw = typeof u.data.email === "string" ? u.data.email.trim() : "";
    if (!raw) {
      plan.untouched++;
      continue;
    }
    const valid = isValidEmail(raw);
    const demo = isDemoAddress(raw);
    if (valid && demo) {
      plan.untouched++;
      continue;
    }

    const userId = Number.isFinite(Number(u.data.userId))
      ? Number(u.data.userId)
      : Number.isFinite(Number(u.id))
        ? Number(u.id)
        : null;
    const name = [u.data.names, u.data.surname]
      .filter((x) => typeof x === "string" && x.trim())
      .join(" ")
      .trim();

    let to: string;
    let kind: EmailChange["kind"];
    if (demo && !valid) {
      to = repairDemoAddress(raw);
      kind = "repair-invalid";
    } else {
      to = demoEmailFor(
        { names: u.data.names, surname: u.data.surname, userId },
        taken,
      );
      kind = "replace-real";
    }
    // Never produce an address another person already has.
    if (taken.has(to) && lower(to) !== lower(raw)) {
      to = to.replace("@", `.${userId ?? u.id}@`);
    }
    taken.add(to);

    const p = userId != null ? profileByUserId.get(userId) : undefined;
    const change: EmailChange = {
      userDocId: u.id,
      userId,
      name: name || u.id,
      from: raw,
      to,
      kind,
      ...(p
        ? {
            profile: {
              id: p.id,
              username: String(p.data.username ?? ""),
              emailMatches: lower(p.data.email) === lower(raw),
              usernameMatches: lower(p.data.username) === lower(raw),
            },
          }
        : {}),
    };

    // A real address someone signs in with is only changed on request.
    const signsInWithIt =
      kind === "replace-real" &&
      !!change.profile &&
      (change.profile.emailMatches || change.profile.usernameMatches);
    if (signsInWithIt && !options.includeLogins) plan.hasLogin.push(change);
    else plan.changes.push(change);
  }
  return plan;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const includeLogins = process.argv.includes("--include-logins");
  let fs;
  try {
    fs = firestoreAdminFromEnv(undefined);
  } catch (error) {
    console.error(
      `\nCan't connect: ${error instanceof Error ? error.message : error}\n` +
        "Set FIREBASE_SERVICE_ACCOUNT in .env (the service account JSON on one line),\n" +
        "and run this from the project folder so bun can find .env.\n",
    );
    process.exit(1);
  }

  console.log(
    `Project: ${fs.projectId}${dryRun ? "  (dry run - nothing will be written)" : ""}` +
      `${includeLogins ? "  [including people who sign in with a real address]" : ""}`,
  );
  const [users, profiles] = await Promise.all([
    fs.query("users", []),
    fs.query("profiles", []),
  ]);
  console.log(`users: ${users.length}   profiles: ${profiles.length}`);

  const plan = planEmailScrub(users, profiles, { includeLogins });

  let written = 0;
  let failed = 0;
  for (const c of plan.changes) {
    const note = c.profile
      ? ` (+ profile ${c.profile.id}${includeLogins && c.kind === "replace-real" ? " and sign-in" : ""})`
      : "";
    const line = `${c.kind === "repair-invalid" ? "repair " : "replace"} ${c.userDocId} ${c.name}: ${c.from} -> ${c.to}${note}`;
    if (dryRun) {
      console.log(`  would ${line}`);
      continue;
    }
    try {
      await fs.write(
        "users",
        c.userDocId,
        { email: c.to, emailLower: c.to.toLowerCase() },
        { mask: ["email", "emailLower"], precondition: { exists: true } },
      );
      if (c.profile) {
        const data: Record<string, string> = {};
        if (c.profile.emailMatches) data.email = c.to;
        if (c.profile.usernameMatches) data.username = c.to;
        if (Object.keys(data).length) {
          await fs.write("profiles", c.profile.id, data, {
            mask: Object.keys(data),
            precondition: { exists: true },
          });
        }
        if (includeLogins && c.kind === "replace-real") {
          const r = await fs.identity("accounts:update", {
            localId: c.profile.id,
            email: c.to,
            emailVerified: false,
          });
          if (!r.ok)
            console.error(
              `    sign-in address NOT changed for ${c.profile.id}: ${JSON.stringify(r.json).slice(0, 160)}`,
            );
        }
      }
      written++;
      console.log(`  ${line}`);
    } catch (error) {
      failed++;
      console.error(
        `  FAILED ${c.userDocId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  console.log(
    `\n${dryRun ? "Would change" : "Changed"}: ${dryRun ? plan.changes.length : written}` +
      `   already fine / no address: ${plan.untouched}` +
      `   has a login, skipped: ${plan.hasLogin.length}` +
      (failed ? `   FAILED: ${failed}` : ""),
  );
  for (const c of plan.hasLogin)
    console.log(
      `  has a login, skipped: ${c.userDocId} ${c.name}: ${c.from} (would become ${c.to})`,
    );
  if (plan.hasLogin.length)
    console.log(
      "  Re-run with --include-logins to change those too (they then sign in with the new address).",
    );
  if (failed > 0) process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
