// Adds an error callback to every Firestore onSnapshot() call that lacks one.
//
// Why: onSnapshot takes an optional third argument that runs if the listener
// fails — a missing index, a permission denial, a lost connection. Without
// it, Firestore swallows the error entirely: the page shows an empty list and
// looks like "no data" rather than "this broke". That's how a missing import
// in nurse-service stayed hidden until a page crashed outright.
//
// This edits source files. Run it on a clean git tree so `git diff` shows
// exactly what changed, and `git checkout .` undoes everything if needed.
//
//   node scripts/add-listener-error-handlers.mjs
//
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "src/lib/doctor-service.ts",
  "src/lib/nurse-service.ts",
  "src/lib/patient-service.ts",
  "src/lib/pharmacist-service.ts",
];

/** Walks from just after "onSnapshot(" to its matching close paren. */
function scanCall(src, start) {
  let i = start,
    depth = 1,
    inStr = null,
    args = 1;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return { end: i, args };
      i++;
      continue;
    }
    if (c === "," && depth === 1) {
      args++;
      i++;
      continue;
    }
    i++;
  }
  return null;
}

function indentAt(src, idx) {
  const lineStart = src.lastIndexOf("\n", idx) + 1;
  const m = src.slice(lineStart).match(/^[ \t]*/);
  return m ? m[0] : "";
}

let totalPatched = 0;

for (const file of FILES) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    console.log(`Skipping ${file} — not found`);
    continue;
  }

  const hits = [];
  const re = /onSnapshot\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const info = scanCall(src, m.index + m[0].length);
    if (!info) continue;
    const body = src.slice(m.index + m[0].length, info.end);
    const trailingComma = /,\s*$/.test(body);
    const realArgs = trailingComma ? info.args - 1 : info.args;
    if (realArgs < 3) hits.push({ callStart: m.index, end: info.end });
  }

  if (hits.length === 0) {
    console.log(`${file}: already clean`);
    continue;
  }

  let out = src;
  for (const h of [...hits].reverse()) {
    const indent = indentAt(out, h.callStart);
    const before = out.slice(0, h.end);
    const after = out.slice(h.end);
    const trimmed = before.replace(/,?\s*$/, "");
    const handler =
      `,\n${indent}  (err) => {\n` +
      `${indent}    // Added so this listener can't fail silently.\n` +
      `${indent}    console.error("Firestore listener failed:", err);\n` +
      `${indent}  },\n${indent}`;
    out = trimmed + handler + after;
  }

  writeFileSync(file, out, "utf8");
  console.log(`${file}: added ${hits.length} error handler(s)`);
  totalPatched += hits.length;
}

console.log(`\n${totalPatched} listener(s) patched.`);
console.log("Run `git diff` to review, then check the Problems tab.");
