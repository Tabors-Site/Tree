// verify-words-stack.mjs — CLI for the drift gate (driftCheck.js). Exit 1 if any concept-word body
// carries an ungrounded word (the hard gate). Forward references are reported as info — the root
// names the verbs, a noun names its properties; strict stacking lives in the header-descent.
import { checkDrift } from "./driftCheck.js";

const { drift, fwdRefs } = checkDrift();
const driftWords = Object.entries(drift);

console.log("  verify-words-stack (the kernel cannot drift)\n");
if (driftWords.length) {
  console.log("  ✗ DRIFT — ungrounded words with no page:");
  for (const [w, set] of driftWords) console.log(`      ${w}: ${[...set].join(", ")}`);
} else {
  console.log("  ✓ no drift — every body-word stacks: a prior concept, the grammar, the host floor, a word the book defines, or the curated vocabulary");
}
const fwd = Object.entries(fwdRefs);
console.log(`  ℹ forward refs (the root names verbs; a noun names its properties): ${fwd.length ? fwd.map(([w, s]) => `${w}→${[...s].join("/")}`).join("  ") : "none"}`);
console.log(driftWords.length ? "\n  1 failed" : "\n  1 passed, 0 failed");
process.exit(driftWords.length ? 1 : 0);
