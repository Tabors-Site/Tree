// Live-chain parity: JS computeHash vs the Rust native addon vs the stored _id, over EVERY fact and act
// in the on-disk chain. Proves the JS→Rust hash delegation (hash.js → rust/treehash-node) is
// byte-identical on the REAL chain, not just synthetic vectors. A green run is the green light to flip
// TREEOS_NATIVE_HASH on. Run: node test/native-hash-parity.mjs
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { computeHash, contentOf } from "../seed/past/fact/hash.js";
import { computeActId } from "../seed/past/act/actHash.js";
import { configureStore, listAllFacts, listAllActs, storeRoot } from "../seed/past/fileStore.js";

const require = createRequire(import.meta.url);
const native = require("../rust/treehash-node/treehash_node.node");

configureStore({}); // default story → store/past
console.log("store:", storeRoot());

// ── facts: JS == native == stored _id ────────────────────────────────────────
let facts = 0,
  factBad = 0;
for (const f of listAllFacts()) {
  facts++;
  const js = computeHash(f.p, contentOf(f)); // pure-JS path (flag off in this harness)
  const rs = native.factId(f.p, JSON.stringify(f)); // Rust, direct
  if (js !== rs || js !== f._id) {
    if (factBad++ < 5)
      console.log(`  FACT mismatch seq=${f.seq} _id=${String(f._id).slice(0, 12)} js=${js.slice(0, 12)} rs=${rs.slice(0, 12)}`);
  }
}

// ── acts: JS == native == stored _id (per story dir under acts/) ──────────────
let acts = 0,
  actBad = 0;
let stories = [];
try {
  stories = readdirSync(join(storeRoot(), "acts")).filter((d) => d !== "_index" && d !== "_patches");
} catch {}
for (const story of stories) {
  for (const a of listAllActs(story)) {
    acts++;
    const js = computeActId(a.p, a); // = computeHash(a.p, contentOfAct(a))
    const rs = native.actId(a.p, JSON.stringify(a));
    if (js !== rs || js !== a._id) {
      if (actBad++ < 5)
        console.log(`  ACT mismatch _id=${String(a._id).slice(0, 12)} js=${js.slice(0, 12)} rs=${rs.slice(0, 12)}`);
    }
  }
}

console.log(`\nfacts: ${facts}  mismatches: ${factBad}`);
console.log(`acts:  ${acts}  mismatches: ${actBad}`);
const ok = factBad === 0 && actBad === 0;
console.log(ok ? "\n✓ PARITY: JS == Rust == stored _id across the whole live chain" : "\n✗ PARITY FAILED");
process.exit(ok ? 0 : 1);
