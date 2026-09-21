// Routes every Firestore transaction through runTransactionOnline, which
// fails fast with a clear message when offline instead of Firebase's vague
// "unavailable" error.
//
// Swaps the import only — call sites stay exactly as they are, because the
// wrapper is imported under the same name (runTransaction). Run on a clean
// git tree; `git diff` shows the change, `git checkout .` undoes it.
//
//   node scripts/use-offline-transactions.mjs
//
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "src/lib/auth.ts",
  "src/lib/clinic-data.ts",
  "src/lib/nurse-service.ts",
];

const WRAPPER_IMPORT =
  'import { runTransactionOnline as runTransaction } from "@/lib/offline";';

for (const file of FILES) {
  let src = readFileSync(file, "utf8");

  if (src.includes("runTransactionOnline")) {
    console.log(`${file}: already done`);
    continue;
  }

  const before = src;
  src = src.replace(/^[ \t]*runTransaction,[ \t]*\r?\n/m, "");
  if (src === before) {
    console.log(
      `${file}: couldn't find the import line — skipped, check by hand`,
    );
    continue;
  }

  src = src.replace(
    /(\} from "firebase\/firestore";)/,
    `$1\n${WRAPPER_IMPORT}`,
  );

  writeFileSync(file, src, "utf8");
  console.log(`${file}: transactions now offline-aware`);
}
