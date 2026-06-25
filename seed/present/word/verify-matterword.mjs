#!/usr/bin/env node
// verify-matterword — the P5 executor boundary (native-words-via-matter). Boot-free unit test:
//   1. a real WASM blob runs SANDBOXED (no imports); effect-class comes FROM the matter type (pure);
//   2. a PURE word caches by (hash, inputs) — second run cached, different inputs not;
//   3. a word may OVERRIDE the type's effect to effectful → never cached (a fact-source);
//   4. the JS matter type runs too (the wider trust hole);
//   5. a NON-executable matter type refuses to run (the registry is the source of truth);
//   6. error paths: an unknown/non-executable type → refuse; body missing from CAS → throw.
import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const { runMatterWord, clearMatterCache, hasDriver, driverTypes } = await import(`${R}/seed/present/word/matterWord.js`);

let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 240)); };
console.log("\n  verify-matterword (P5: a word's body is matter; the type declares executability + effect)\n");

// A minimal WASM module: (func (export "run") (param i32) (result i32) local.get 0; i32.const 2; i32.mul)
const WASM_DOUBLE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x41, 0x02, 0x6c, 0x0b,
]);

// A fake CAS — { hash -> Buffer }. (Production: contentStore.putContent/getContent.)
const cas = new Map();
cas.set("wasm-double", Buffer.from(WASM_DOUBLE));
cas.set("js-inc", Buffer.from("function run(x){return x + 100;}"));
const getContent = async (h) => cas.get(String(h)) || null;

// The matter-type registry, injected (the production path reads materials/matter/types.js). Mirrors
// the real registrations: wasm = executable+pure, js = executable+effectful, generic = inert.
const TYPES = {
  wasm:    { executable: { effect: "pure", entry: "run" } },
  js:      { executable: { effect: "effectful", entry: "run" } },
  generic: { executable: null },
};
const getMatterType = (t) => TYPES[String(t)] || null;
const deps = { getContent, getMatterType };

try {
  clearMatterCache();

  // 1. WASM runs sandboxed; effect (pure) sourced FROM the type (no effect on the ref).
  hasDriver("wasm") || bad("no wasm run-op handler registered", driverTypes());
  const r1 = await runMatterWord({ hash: "wasm-double", type: "wasm", entry: "run" }, [21], deps);
  (r1.result === 42 && r1.cached === false && r1.type === "wasm" && r1.effect === "pure")
    ? ok(`wasm ran sandboxed: run(21)=${r1.result}; effect "pure" came from the matter type, not the ref`)
    : bad("wasm run wrong", r1);

  // 2. PURE caches by (hash, inputs) — the type said pure, so the second run is a cache hit.
  const r2 = await runMatterWord({ hash: "wasm-double", type: "wasm" }, [21], deps);
  const r3 = await runMatterWord({ hash: "wasm-double", type: "wasm" }, [10], deps);
  (r2.cached === true && r2.result === 42 && r3.cached === false && r3.result === 20)
    ? ok(`pure word cached by hash: run(21) hits cache (replay-safe), run(10)=20 is fresh`)
    : bad("pure cache wrong", { r2, r3 });

  // 3. A word OVERRIDES the type's effect to effectful → never cached.
  const e1 = await runMatterWord({ hash: "wasm-double", type: "wasm", effect: "effectful" }, [7], deps);
  const e2 = await runMatterWord({ hash: "wasm-double", type: "wasm", effect: "effectful" }, [7], deps);
  (e1.cached === false && e2.cached === false && e1.effect === "effectful")
    ? ok(`effect override: a word marks its wasm instance effectful → both runs fresh (a fact-source)`)
    : bad("effect override / effectful caching wrong", { e1, e2 });

  // 4. JS matter type runs (override to pure for the check).
  const j1 = await runMatterWord({ hash: "js-inc", type: "js", effect: "pure" }, [5], deps);
  (j1.result === 105 && j1.type === "js")
    ? ok(`js matter type ran: run(5)=${j1.result} (effectful by default; the wider trust hole)`)
    : bad("js run wrong", j1);

  // 5. A NON-executable matter type refuses — the registry is the source of truth.
  let refusedInert = false;
  try { await runMatterWord({ hash: "wasm-double", type: "generic" }, [1], deps); } catch { refusedInert = true; }
  refusedInert
    ? ok(`a non-executable type ("generic") refuses to run (executability is declared on the type)`)
    : bad("non-executable type did not refuse");

  // 6. error paths: unknown type (not in registry) → not executable → throw; missing CAS body → throw.
  let threwUnknown = false, threwBlob = false;
  try { await runMatterWord({ hash: "x", type: "ruby" }, [], deps); } catch { threwUnknown = true; }
  try { await runMatterWord({ hash: "nope", type: "wasm" }, [], deps); } catch { threwBlob = true; }
  (threwUnknown && threwBlob)
    ? ok("error paths: unknown type → not-executable throw; missing CAS body → not-found throw")
    : bad("error paths did not throw", { threwUnknown, threwBlob });

  // 7. wasm structured-input FAILS LOUD (no silent NaN) — the marshalling convention is co-design pending.
  let threwStruct = false, structMsg = "";
  try { await runMatterWord({ hash: "wasm-double", type: "wasm" }, [{ a: 1 }], deps); } catch (err) { threwStruct = true; structMsg = err.message; }
  (threwStruct && /marshalling/.test(structMsg))
    ? ok(`wasm structured-input fails loud (numeric ABI; structured marshalling is co-design pending, not a silent NaN)`)
    : bad("wasm structured-input did not fail loud", { threwStruct, structMsg });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 6).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
