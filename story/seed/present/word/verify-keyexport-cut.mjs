#!/usr/bin/env node
// key-export (key.word), LIVE through the bridge with ZERO stubs. The CONTROL strand
// (resolve the Name via `see`, the double gate, the §7 return) is .word; the crypto key
// reader + the BIP39 derive + the asker-attributed audit are host: escapes wired by
// keyHost.js. Proves: the trueName resolution + the I_AM hard-refusal (the story key is
// never exportable), and RULE 7 — the audit fact carries only `exportedNameId`, never any
// key bytes. The full authorized REVEAL (a connected non-I_AM Name with an unlocked key)
// needs a human-registration fixture; the .word + keyHost reuse the SAME loadSigningKey /
// seedFromPrivateKeyPem / entropyToMnemonic / emitFact the JS handler calls, so the crypto
// + audit are behavior-preserving by construction. CALLER mode. Full begin.js boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_keyexport_cut";
process.env.PORT = "3793";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "keyexport-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "keyexportcut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "keyexportcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { resolveRoleWord, runRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { keyHostEnv } = await import(`${R}/seed/store/words/key/keyHost.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};

console.log(`\n  verify-keyexport-cut (key.word via the bridge — gate + resolution + rule 7)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const ir = resolveRoleWord("name", "key-export");
  ir ? ok(`key.word resolves through the bridge (self-registered)`) : bad(`resolves`, "null");

  // ── 1. I_AM hard-refusal: a being whose trueName resolves to i-am is NOT a door to
  //       the story key. The `see` reads the trueName; gate 1 refuses before anything. ──
  const being = await birth("keyholder");
  const trueName = (await loadOrFold("being", String(being), "0"))?.state?.trueName;
  console.log(`  @keyholder trueName = ${trueName}\n`);
  const sc = { actId: randomUUID(), actorAct: { branch: "0", by: "i-am" }, identity: { beingId: String(being), nameId: "i-am" }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  let refused = null;
  try {
    await runRoleWord(ir, { moment: sc, branch: "0", trigger: { target: { kind: "being", id: String(being) }, caller: "i-am", asker: String(being), branch: "0" }, env: { host: keyHostEnv() } });
  } catch (e) { refused = e; }
  refused && /story \(I_AM\) key is never exportable/i.test(refused.message) && !(sc.deltaF || []).length
    ? ok(`@keyholder (trueName→i-am) → refuse "the story (I_AM) key is never exportable" [code ${refused.code}], NO fact`)
    : bad(`i-am gate`, refused?.message || sc.deltaF?.map((f) => f.act));
  refused?.code === "FORBIDDEN" ? ok(`the I_AM refusal carries code FORBIDDEN (gate, fail-closed)`) : bad(`code`, refused?.code);

  // ── 2. RULE 7: the audit fact (recordExport) records WHO exported WHICH Name — the key
  //       is NOWHERE in it. Drive the host audit directly and inspect the fact's params. ──
  const sc2 = { actId: randomUUID(), actorAct: { branch: "0", by: "i-am" }, identity: { beingId: String(being) }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  await keyHostEnv().recordExport({ args: [String(being), "did:key:zSomeExportedName"] }, { moment: sc2 });
  const audit = (sc2.deltaF || []).find((f) => f.act === "key-export");
  const cleanParams = audit && JSON.stringify(Object.keys(audit.params || {}).sort()) === JSON.stringify(["exportedNameId"]);
  // rule 7: the only param is the PUBLIC exportedNameId; no private key / mnemonic / PEM
  // field anywhere. (exportedNameId is a public did:key id, never the secret.)
  const noSecret = audit && !/private|mnemonic|BEGIN |pem/i.test(JSON.stringify(audit.params || {}));
  audit && cleanParams && noSecret && audit.through === String(being)
    ? ok(`rule 7: audit fact params = {exportedNameId} only (public id), NO key material, attributed to the asker`)
    : bad(`rule 7`, { params: audit?.params });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  (note: the authorized key REVEAL — a connected non-I_AM Name with an unlocked key —`);
  console.log(`   needs a human-registration fixture; gate + resolution + rule-7 proven here.)`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
