#!/usr/bin/env node
// credential-reset (credential-reset.word), LIVE with ZERO stubs. The CONTROL strand (the
// authority gate + the refuse + the return) is .word; the crypto mint/decrypt + the
// authority fold + the three ordered set-being writes (applyResetWrites) are host: escapes
// wired by credentialHost.js. Proves: an authorized reset re-mints the credential (three
// set-being facts, the row changes, plaintext returned) and an UNAUTHORIZED asker is
// refused with NO writes. CALLER mode. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/reality_word_credreset_cut";
process.env.PORT = "3792";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "credreset-secret-0123456789";
process.env.REALITY_KEY_DIR = path.join(os.tmpdir(), "credresetcut-keys-" + process.pid);
fs.rmSync(process.env.REALITY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "credresetcut-src");
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
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveRoleWord, runRoleWord } = await import(`${R}/seed/present/word/roleWordRegistry.js`);
const { credentialHostEnv } = await import(`${R}/seed/materials/being/credentialHost.js`);
const { comparePassword, decryptCredential } = await import(`${R}/seed/materials/being/identity/credentials.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };
const ident = { beingId: I_AM, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({ spec: { name, parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultRole: "global" }, identity: I_AM, moment: ctx, branch: "0" });
    bid = b.beingId;
  });
  return bid;
};

console.log(`\n  verify-credreset-cut (REAL credential-reset op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  const ir = resolveRoleWord("credential", "credential-reset");
  ir ? ok(`credential-reset.word resolves through the bridge (self-registered)`) : bad(`resolves`, "null");

  const victim = await birth("victim");
  const before = await loadOrFold("being", String(victim), "0");
  const beforeHash = before?.state?.password;

  // ── 1. authorized reset (via the REAL op, I_AM authority) → re-mints the credential ──
  const sc = { actId: randomUUID(), actorAct: { branch: "0", by: "i-am" }, identity: ident, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  let res = null, refused = null;
  try {
    res = await doVerb({ kind: "being", id: String(victim) }, "credential-reset", {}, { identity: ident, moment: sc });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
  } catch (e) { refused = e; }
  const r = res?.result ?? res;
  r?.targetBeingId === String(victim) && typeof r?.plaintext === "string" && r.plaintext.length > 0
    ? ok(`reset @victim → targetBeingId + a fresh plaintext returned (never into a fact)`)
    : bad(`reset`, refused?.message || r);

  // ── 2. three NATIVE do:set-being facts (password + the two inner-key auth writes) ──
  const setBeings = (sc.deltaF || []).filter((f) => f.act === "set-being");
  const fields = setBeings.map((f) => f.params?.field);
  setBeings.length === 3 && fields.includes("password") && fields.includes("qualities.auth.credentialPlain") && fields.includes("qualities.auth.tokensInvalidBefore")
    ? ok(`three NATIVE do:set-being facts: password + qualities.auth.credentialPlain + tokensInvalidBefore (verb-native writes)`)
    : bad(`writes`, fields);

  // ── 3. the row re-minted with REAL values (NOT unresolved "$credential.x" placeholders).
  //  This is the assertion that catches the resolveValue dotted-descent bug: a literal
  //  "$credential.hash" is truthy and differs from beforeHash, so a truthiness-only check
  //  green-lit a fully corrupt re-mint (locked-out password + fail-open token revocation). ──
  const after = await loadOrFold("being", String(victim), "0");
  const auth = after?.state?.qualities?.auth || {};
  const pw = after?.state?.password;
  const noPlaceholders = ![pw, auth.credentialPlain, auth.tokensInvalidBefore].some((x) => String(x).startsWith("$"));
  const pwReal = typeof pw === "string" && pw.startsWith("scrypt$") && pw !== beforeHash;
  const pwVerifies = pwReal && await comparePassword(r.plaintext, pw);
  const plainReal = auth.credentialPlain && decryptCredential(auth.credentialPlain) === r.plaintext;
  const cutoffReal = auth.tokensInvalidBefore && !Number.isNaN(new Date(auth.tokensInvalidBefore).getTime());
  noPlaceholders && pwReal && pwVerifies && plainReal && cutoffReal
    ? ok(`@victim row re-minted with REAL values: scrypt$ hash verifies vs the returned plaintext, credentialPlain decrypts to it, tokensInvalidBefore parses (no "$..." placeholders)`)
    : bad(`row values`, { noPlaceholders, pwReal, pwVerifies, plainReal, cutoffReal, password: pw, credentialPlain: auth.credentialPlain, tokensInvalidBefore: auth.tokensInvalidBefore });

  // ── 3b. rule 7 for the WRITES: the cleartext rides ONLY the return, never a set-being
  //  fact value (credentialPlain stores the AES blob, not the cleartext). ──
  const leakInWrites = setBeings.some((f) => JSON.stringify(f.params?.value ?? "").includes(r.plaintext));
  !leakInWrites
    ? ok(`rule 7 (writes): the cleartext appears in NO set-being fact value`)
    : bad(`rule7-writes`, setBeings.map((f) => f.params?.field));

  // ── 3c. rule 7 for the AUDIT fact: the do:credential-reset op record auto-captures the
  //  op result; confirm the reveal is STRIPPED, so NO fact (set-being OR audit) carries the
  //  cleartext. This assertion FAILED before stripForAudit (the audit result.plaintext). ──
  const leakAnywhere = (sc.deltaF || []).some((f) =>
    JSON.stringify(f.result ?? null).includes(r.plaintext) || JSON.stringify(f.params ?? null).includes(r.plaintext));
  !leakAnywhere
    ? ok(`rule 7 (audit): the cleartext appears in NO fact at all (the do-op audit result is stripped)`)
    : bad(`rule7-audit`, (sc.deltaF || []).filter((f) => JSON.stringify(f.result ?? f.params ?? "").includes(r.plaintext)).map((f) => f.act));

  // ── 4. an asker with NO credential authority → refuse, NO writes ──
  // (Harness note: every I_AM-birthed being resolves to I_AM authority — trueName
  //  threads to I_AM — so an "unauthorized" caller here is one whose name does not
  //  resolve at all, the exact `if (!askerName) return false` path the gate fails
  //  closed on. The authority FOLD itself is the SAME hasCredentialAuthority the JS
  //  calls, unchanged; this proves the .word's `If not authorized: refuse` wiring.)
  const noAuth = "noauth-" + randomUUID();
  const sc2 = { actId: randomUUID(), actorAct: { branch: "0", by: noAuth }, identity: { beingId: noAuth }, deltaF: [], foldedSeqs: new Map(), afterSeal: [] };
  let gateRefused = null;
  try {
    await runRoleWord(ir, { moment: sc2, branch: "0", trigger: { caller: noAuth, target: String(victim), branch: "0" }, env: { host: credentialHostEnv() } });
  } catch (e) { gateRefused = e; }
  gateRefused && /no credential authority/i.test(gateRefused.message) && !(sc2.deltaF || []).some((f) => f.act === "set-being")
    ? ok(`an asker with no credential authority → refuse "no credential authority", NO writes`)
    : bad(`gate`, gateRefused?.message || (sc2.deltaF || []).map((f) => f.act));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
