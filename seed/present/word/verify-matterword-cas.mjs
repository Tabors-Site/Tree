#!/usr/bin/env node
// verify-matterword-cas — the REAL-CAS end-to-end for native-words-via-matter (P5 engine half).
// Boots, then: stores a wasm body in the actual content store, binds it as a WORD's body (matter
// ref on the binding), resolves it via resolveMatterWord, and runs it via runWordBody — proving the
// production path (real putContent/getContent + the live matter-type registry), not the injected fake.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_matterword_cas-" + process.pid);
process.env.PORT = "3855"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "matcas-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "matcas-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "matcas-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { storeMatterBody, resolveMatterWord, runWordBody, seeMatterWord } = await import(`${R}/seed/present/word/matterWord.js`);
const { bindWord, getWordSync } = await import(`${R}/seed/present/word/wordStore.js`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 240)); };
console.log("\n  verify-matterword-cas (P5 engine half: a word's body in the REAL CAS, run end-to-end)\n");

// (func (export "run") (param i32) (result i32) local.get 0; i32.const 2; i32.mul)
const WASM_DOUBLE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x41, 0x02, 0x6c, 0x0b,
]);

try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);

  // 1. Store the wasm body in the REAL content store → a CAS ref.
  const matter = await storeMatterBody(Buffer.from(WASM_DOUBLE), "wasm");
  (matter && /^[a-f0-9]{16,}$/i.test(String(matter.hash)) && matter.type === "wasm")
    ? ok(`storeMatterBody → CAS ref { hash: ${String(matter.hash).slice(0, 12)}…, type: wasm }`)
    : bad("storeMatterBody did not return a CAS ref", matter);

  // 2. Bind it as a WORD's body (the binding carries the matter ref) + resolve it.
  await bindWord("double-body", { kind: "op", matter }, { history: "0" });
  const ref = resolveMatterWord("double-body");
  (ref && ref.hash === matter.hash && ref.type === "wasm")
    ? ok(`resolveMatterWord("double-body") → the matter body (a matter-bodied word, not handler-dispatched)`)
    : bad("resolveMatterWord did not find the matter body", { ref, binding: getWordSync("double-body") });

  // 3. Run it through the PRODUCTION entry — real CAS fetch + the live matter-type registry.
  const r = await runWordBody(ref, [21]);
  (r && r.result === 42 && r.type === "wasm" && r.effect === "pure")
    ? ok(`runWordBody(ref, [21]) = ${r.result} via real CAS + registry; effect "pure" from the wasm matter type`)
    : bad("runWordBody wrong", r);

  // 4. A NON-matter word (a normal concept) has no matter body → null (the handler path, not here).
  resolveMatterWord("see") == null
    ? ok(`a non-matter word ("see") resolves to null — only matter-bodied words route to runWordBody`)
    : bad("a non-matter word wrongly resolved as matter", resolveMatterWord("see"));

  // 5. SEE path: a PURE matter word computes via seeMatterWord and makes NO fact.
  const { factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
  const before = factCount({});
  const see1 = await seeMatterWord("double-body", [21]);
  const after = factCount({});
  (see1.isMatter === true && see1.result === 42 && after === before)
    ? ok(`seeMatterWord (pure) computed run(21)=42 on the see path and stamped NO fact (${after - before} new facts)`)
    : bad("pure see-compute wrong or stamped a fact", { see1, delta: after - before });

  // 6. SEE path REFUSES an effectful matter word (a fact-source must go through DO).
  const jsMatter = await storeMatterBody("function run(x){return x + 1;}", "js"); // js = effectful by default
  await bindWord("inc-body", { kind: "op", matter: jsMatter }, { history: "0" });
  let refusedEffectful = false, refMsg = "";
  try { await seeMatterWord("inc-body", [5]); } catch (e) { refusedEffectful = true; refMsg = e.message; }
  (refusedEffectful && /effectful/.test(refMsg))
    ? ok(`seeMatterWord refuses an effectful word ("inc-body", js) — a fact-source must go via DO`)
    : bad("effectful word was not refused on the see path", { refusedEffectful, refMsg });

  // 7. A non-matter word → {isMatter:false}, so the see-dispatch falls through to normal resolution.
  const see3 = await seeMatterWord("see", []);
  see3.isMatter === false
    ? ok(`seeMatterWord("see") → isMatter:false (the see-dispatch falls through to its normal path)`)
    : bad("non-matter word not passed through", see3);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 6).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
