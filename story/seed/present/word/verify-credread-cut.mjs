#!/usr/bin/env node
// credential-read (credential-read.word), LIVE through the bridge with ZERO stubs. The
// gate→read→reveal mirror of credential-reset. The authority gate is a `see` PREDICATE,
// readCredential (loadTargetRow + the credentialPlain blob + decrypt) is the one crypto
// host escape, the cleartext rides the RETURN. Proves: an authorized read returns the
// SAME cleartext a prior reset minted, RULE 7 holds (the credential-read audit fact never
// records the cleartext — stripForAudit redacts it), and an unauthorized asker is refused.
// Chains credential-reset (to mint a credential to read). CALLER mode. Full begin.js boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_credread_cut-" + process.pid);
process.env.PORT = "3794";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "credread-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "credreadcut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "credreadcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord, runAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { credentialHostEnv } = await import(
  `${R}/seed/store/words/credential/credentialHost.js`
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
const ident = { beingId: I, name: "i-am", nameId: "i-am" };

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({
      spec: {
        name,
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
      },
      identity: I,
      moment: ctx,
      history: "0",
    });
    bid = b.beingId;
  });
  return bid;
};
const drive = async (op, target) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  const res = await doVerb(
    { kind: "being", id: String(target) },
    op,
    {},
    { identity: ident, moment: sc, currentHistory: "0" },
  );
  if (sc.deltaF.length) await sealFacts(sc.deltaF);
  return { result: res?.result ?? res, deltaF: sc.deltaF };
};

console.log(
  `\n  verify-credread-cut (REAL credential-read op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  const ir = resolveAbleWord("credential", "credential-read");
  ir
    ? ok(`credential-read.word resolves through the bridge (self-registered)`)
    : bad(`resolves`, "null");

  const victim = await birth("victim");
  // mint a credential to read (credential-reset, already cut to the ULTIMATE form)
  const reset = await drive("credential-reset", victim);
  const minted = reset.result?.plaintext;

  // ── 1. authorized read → returns the SAME cleartext the reset minted ──
  const rd = await drive("credential-read", victim);
  rd.result?.hasPlain === true &&
  typeof rd.result?.plaintext === "string" &&
  rd.result.plaintext === minted
    ? ok(
        `read @victim → hasPlain:true, plaintext === the reset's minted cleartext (read decrypts the stored blob)`,
      )
    : bad(`read`, {
        read: rd.result?.plaintext?.slice?.(0, 8),
        minted: minted?.slice?.(0, 8),
      });

  // ── 2. RULE 7: the credential-read audit fact NEVER records the cleartext ──
  const auditFact = (rd.deltaF || []).find((f) => f.act === "credential-read");
  const leaks = minted && JSON.stringify(auditFact || {}).includes(minted);
  auditFact && !leaks
    ? ok(
        `rule 7: the credential-read audit fact records the read but NOT the cleartext (stripForAudit redacts the reveal)`,
      )
    : bad(`rule 7`, { hasFact: !!auditFact, leaks });

  // ── 3. an asker with NO credential authority → refuse, NO reveal ──
  const noAuth = "noauth-" + randomUUID();
  const sc2 = {
    actId: randomUUID(),
    actorAct: { history: "0", by: noAuth },
    identity: { beingId: noAuth },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  let refused = null;
  try {
    await runAbleWord(ir, {
      moment: sc2,
      history: "0",
      trigger: { caller: noAuth, target: String(victim), branch: "0" },
      env: { host: credentialHostEnv() },
    });
  } catch (e) {
    refused = e;
  }
  refused && /no credential authority/i.test(refused.message)
    ? ok(
        `an asker with no credential authority → refuse "no credential authority" [code ${refused.code}], NO reveal`,
      )
    : bad(`gate`, refused?.message);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
