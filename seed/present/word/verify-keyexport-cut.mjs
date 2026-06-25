#!/usr/bin/env node
// verify-keyexport-cut — the REAL key-export op via doVerb → the cut. key.word is the
// CONTROL strand (resolve the Name via `see`, the double gate, the §7 return); the crypto
// key reader + the BIP39 derive are host: escapes wired by keyHost.js. THE CUT: the .word
// lays NO fact — the audit (who exported which Name's key) is the dispatcher's ONE auto-Fact.
// The cut promotes the returned `nameId` into _factParams {exportedNameId} + forces
// _factTarget at the ASKER's being, and do.js stamps the caller-attributed do:key-export
// audit, the key NOWHERE in it (stripForAudit drops the privateKeyPem/mnemonic reveals).
//
// Proves: (1) the I hard-refusal (the story key is never exportable) lays NO fact;
// (2) the AUTHORIZED REVEAL — a connected non-I sovereign Name with a system-encrypted
// key — returns the PEM + 24-word mnemonic to the asker over the wire; and (3) RULE 7 — the
// auto-Fact carries only {exportedNameId} (a public did:key id), attributed to the asker, the
// key material NOWHERE in the durable fact (params or result). CALLER mode. Full begin.js boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_keyexport_cut-" + process.pid);
process.env.PORT = "3793";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "keyexport-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "keyexportcut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "keyexportcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { sealFacts, emitFact } = await import(`${R}/seed/past/fact/facts.js`);
const { generateNameKeypair } = await import(
  `${R}/seed/materials/name/keys.js`
);
const { encryptCredential } = await import(
  `${R}/seed/materials/name/credentials.js`
);

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d !== undefined)
    console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
};
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return null;
};

const cherub = await poll(() => findByName("being", "cherub", "0"));

// Birth a being expressing a given trueName (default: the mother's, i.e. i-am via cherub).
const birth = async (name, trueName) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const spec = {
      name,
      parentBeingId: cherub.id,
      homeId: cherub.state?.homeSpace,
      cognition: "scripted",
      defaultAble: "global",
    };
    if (trueName) spec.trueName = trueName;
    const b = await birthBeing({
      spec,
      identity: I,
      moment: ctx,
      history: "0",
    });
    bid = b.beingId;
  });
  return bid;
};

// Mint a sovereign Name row with a SYSTEM-ENCRYPTED private key (not password-locked),
// so loadSigningKey decrypts it server-side without a live session — the authorized REVEAL
// path. Returns { nameId, privateKeyPem }.
const mintSovereignName = async () => {
  const kp = generateNameKeypair(); // { publicKeyPem, privateKeyPem, nameId }
  const enc = encryptCredential(kp.privateKeyPem); // system-encrypted at rest (not password-locked)
  const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
  await withIAmAct(`mint name ${kp.nameId.slice(0, 12)}`, async (ctx) => {
    await emitFact(
      {
        verb: "name",
        act: "declare",
        through: I,
        // A Name has no reel of its own; the declare lands on the LIBRARY reel, keyed by nameId.
        of: { kind: "library", id: getStoryDomain() },
        params: {
          nameId: kp.nameId,
          spec: {
            parentNameId: I,
            privateKeyEnc: enc,
            identity: { alg: "ed25519", keyEnc: "system", v: 1 },
            soulType: "scripted",
          },
        },
        actId: ctx.actId,
        history: "0",
      },
      ctx,
    );
  });
  return { nameId: kp.nameId, privateKeyPem: kp.privateKeyPem };
};

// Drive the REAL key-export op through doVerb (→ the cut → key.word + the dispatcher auto-Fact).
const exportKey = async (beingId, identity) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: identity?.nameId || "i-am" },
    identity,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(
      { kind: "being", id: String(beingId) },
      "key-export",
      {},
      { identity, moment: sc, currentHistory: "0" },
    );
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

console.log(
  `\n  verify-keyexport-cut (REAL key-export op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  resolveAbleWord("name", "key-export")
    ? ok(`key.word resolves through the bridge (self-registered)`)
    : bad(`resolves`, "null");

  // ── 1. I hard-refusal: a being whose trueName resolves to i-am is NOT a door to the
  //       story key. Gate 1 refuses; the dispatcher lays NO fact. ──
  const iamBeing = await birth("keyholder");
  const tn = (await loadOrFold("being", String(iamBeing), "0"))?.state
    ?.trueName;
  console.log(`  @keyholder trueName = ${tn}\n`);
  const r1 = await exportKey(iamBeing, {
    beingId: String(iamBeing),
    nameId: "i-am",
  });
  r1.refused &&
  /story \(I\) key is never exportable/i.test(r1.refused.message) &&
  !(r1.deltaF || []).length
    ? ok(
        `@keyholder (trueName→i-am) → refuse "the story (I) key is never exportable" [code ${r1.refused.code}], NO fact`,
      )
    : bad(`i-am gate`, r1.refused?.message || r1.deltaF?.map((f) => f.act));
  r1.refused?.code === "FORBIDDEN"
    ? ok(`the I refusal carries code FORBIDDEN (gate, fail-closed)`)
    : bad(`code`, r1.refused?.code);

  // ── 2. the AUTHORIZED REVEAL: a connected non-I sovereign Name exports its own key. ──
  const { nameId, privateKeyPem } = await mintSovereignName();
  const sovBeing = await birth("sovereign", nameId); // a being expressing the sovereign Name
  console.log(`  @sovereign trueName = ${nameId.slice(0, 18)}…\n`);
  const r2 = await exportKey(sovBeing, { beingId: String(sovBeing), nameId });
  r2.result?.hasKey === true &&
  r2.result?.privateKeyPem === privateKeyPem &&
  typeof r2.result?.mnemonic === "string"
    ? ok(
        `export @sovereign (acting AS the Name) → hasKey:true, privateKeyPem === the minted key, 24-word mnemonic returned to the asker`,
      )
    : bad(
        `reveal`,
        r2.refused?.message || {
          hasKey: r2.result?.hasKey,
          pemMatch: r2.result?.privateKeyPem === privateKeyPem,
          mnemonic: typeof r2.result?.mnemonic,
        },
      );

  // ── 3. RULE 7: the do:key-export audit fact records WHO exported WHICH Name — attributed
  //       to the asker, of the asker's being, params {exportedNameId} only, the key NOWHERE. ──
  const audit = (r2.deltaF || []).find((f) => f.act === "key-export");
  const cleanParams =
    audit &&
    JSON.stringify(Object.keys(audit.params || {}).sort()) ===
      JSON.stringify(["exportedNameId"]);
  const exportedOk = audit && audit.params?.exportedNameId === nameId;
  // the key material must be NOWHERE in the durable fact — neither params nor the recorded result.
  const noSecret =
    audit &&
    !JSON.stringify(audit).includes(privateKeyPem) &&
    (typeof r2.result?.mnemonic !== "string" ||
      !JSON.stringify(audit).includes(r2.result.mnemonic)) &&
    !/-----BEGIN/.test(JSON.stringify(audit));
  audit &&
  cleanParams &&
  exportedOk &&
  noSecret &&
  audit.through === String(sovBeing) &&
  String(audit.of?.id) === String(sovBeing)
    ? ok(
        `rule 7: do:key-export fact = params {exportedNameId} only, through = the asker, of = the asker's being, NO key material (params or result)`,
      )
    : bad(`rule 7`, {
        params: audit?.params,
        through: audit?.through,
        of: audit?.of,
        noSecret,
      });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
