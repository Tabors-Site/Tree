#!/usr/bin/env node
// verify-keystone-result — the result-contract policy on emitWordFact (the P0 unblock). Proves the
// unified keystone reproduces each result shape it collapses, and CANNOT leak a key:
//   1. NAME — a name-op fact carries NO result; a private key in the result NEVER reaches the chain
//      (the hard security floor, independent of field names / REVEAL_KEYS).
//   2. CONNECT — drives the REAL binding (resolveBeOpFromFold), proving BE_RESULT_POLICY is wired
//      (not fail-open) and the keystone curates to {beingAddress, note}; a session token + extras drop.
//   3. DEFAULT — stripForAudit still applied (a known reveal key is scrubbed; the rest is kept).
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_keystone-" + process.pid);
process.env.PORT = "3854"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "keystone-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "keystone-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "keystone-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { emitWordFact } = await import(`${R}/seed/ibp/factResult.js`);
const { factFind, factFindOne, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 300)); };
console.log("\n  verify-keystone-result (the result-contract policy — no key reaches the chain)\n");
const LEAK_KEY = "LEAK-PRIVATE-KEY-ZZZ", LEAK_MNE = "LEAK-MNEMONIC-WORDS-ZZZ", LEAK_TOK = "LEAK-SESSION-TOKEN-ZZZ", LEAK_PEM = "LEAK-PEM-DEFAULT-ZZZ";
try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);

  // 1. NAME — the keystone omits result entirely; the minted key never lands.
  await withIAmAct("keystone name", async (m) => {
    await emitWordFact(
      { factVerb: "name", factAction: "declare", noun: "name" },
      { through: "i-am", actId: m.actId, history: "0" },
      { _factParams: { spec: { handle: "sektest" } }, _factTarget: { id: "sektest-name" }, ok: true, nameId: "sektest-name",
        reveal: { privateKey: LEAK_KEY, words: LEAK_MNE, publicKey: "pub-ok" } },
      m,
    );
  });
  const nf = await poll(() => factFindOne({ verb: "name", act: "declare", "of.id": "sektest-name" }), (v) => !!v);
  // result == null (not a populated object) — byte-identical to writeNameFact, which passes no
  // result so the schema defaults it null. The security assertion is hasKey === false.
  const nameClean = nf && nf.result == null && !JSON.stringify(nf).includes(LEAK_KEY) && !JSON.stringify(nf).includes(LEAK_MNE);
  nameClean
    ? ok(`NAME fact carries no result (null, == writeNameFact); the minted private key + mnemonic are absent from the chain (params=${JSON.stringify(nf.params)})`)
    : bad("NAME fact leaked a key or stamped a populated result", { result: nf?.result, hasKey: JSON.stringify(nf).includes(LEAK_KEY) });

  // 2. CONNECT — drive the REAL binding the system builds (resolveBeOpFromFold), NOT a fabricated
  //    one. (The verb lane caught that hand-injecting resultPolicy false-greens against a binding
  //    that never exists.) The keystone curates the result to the binding's resultPolicy.keep
  //    allowlist; if the real binding lacks the policy (the fail-open the verb lane fixed via
  //    BE_RESULT_POLICY in declareBeOpsToFold), this assertion fails loud.
  const { resolveBeOpFromFold } = await import(`${R}/seed/present/word/wordStore.js`);
  const connectBinding = resolveBeOpFromFold("connect");
  (connectBinding && connectBinding.factVerb === "be" && connectBinding.resultPolicy && Array.isArray(connectBinding.resultPolicy.keep))
    ? ok(`the REAL connect binding carries resultPolicy.keep=${JSON.stringify(connectBinding.resultPolicy.keep)} (BE_RESULT_POLICY wired — not fail-open to stripForAudit)`)
    : bad("the real connect binding has no resultPolicy.keep — keystone would fall through to the denylist (fail-open)", connectBinding);
  await withIAmAct("keystone connect", async (m) => {
    await emitWordFact(
      connectBinding,
      { through: "i-am", actId: m.actId, history: "0" },
      { _factParams: { name: "x" }, _factTarget: { id: "conn-b1" }, beingAddress: "reality::/x@conn-b1", note: "connected", token: LEAK_TOK, extra: "should-not-appear" },
      m,
    );
  });
  const cf = await poll(() => factFindOne({ verb: "be", act: "connect", "of.id": "conn-b1" }), (v) => !!v);
  const keys = cf?.result ? Object.keys(cf.result).sort() : [];
  const connClean = cf && cf.result && keys.join(",") === "beingAddress,note" && !JSON.stringify(cf).includes(LEAK_TOK) && !JSON.stringify(cf).includes("should-not-appear");
  connClean
    ? ok(`CONNECT fact (REAL binding) curated to {beingAddress, note}; session token + extras dropped (result=${JSON.stringify(cf.result)})`)
    : bad("CONNECT result not curated", { keys, result: cf?.result });

  // 3. DEFAULT — stripForAudit still scrubs a known reveal key, keeps the rest.
  await withIAmAct("keystone default", async (m) => {
    await emitWordFact(
      { factVerb: "be", factAction: "release", noun: "being" },
      { through: "i-am", actId: m.actId, history: "0" },
      { _factParams: {}, _factTarget: { id: "rel-b2" }, ok: true, privateKeyPem: LEAK_PEM },
      m,
    );
  });
  const df = await poll(() => factFindOne({ verb: "be", act: "release", "of.id": "rel-b2" }), (v) => !!v);
  const defClean = df && df.result && df.result.ok === true && !JSON.stringify(df).includes(LEAK_PEM);
  defClean
    ? ok(`DEFAULT path still stripForAudit: privateKeyPem scrubbed, ok:true kept (result keys=${Object.keys(df.result).join(",")})`)
    : bad("DEFAULT path did not scrub / lost the result", { result: df?.result, hasPem: JSON.stringify(df).includes(LEAK_PEM) });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 6).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
