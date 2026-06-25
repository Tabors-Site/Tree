#!/usr/bin/env node
// The CUT's validation: drive cherub's REAL birthHandler (cherubBeOps.birth.handler)
// for a SUBSEQUENT registration — the exact site the cut swaps from
// _registerHumanWithFreshHome (JS) to cherub.word (the bridge) — and assert the
// born being is identical either way. Run on HEAD first (baseline, the JS path),
// then after the cut (the .word path); both must be GREEN and IDENTICAL.
//
// Boots a FULL story via begin.js (the e2e pattern) so cherub holds its grant-able
// authority (the piecemeal ensureSeedDelegates boot doesn't anoint the seed ables).
// Mirrors beVerb's moment setup (_inOp=true around the handler). Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../.."); // story/
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_cherub_cut-" + process.pid);
process.env.PORT = "3796";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "cherubcut-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "cherubcut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "cherubcut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`); // full genesis: I, cherub (+ its ables), delegates

const { findByName, loadProjection } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
const { cherubBeOps } = await import(`${R}/seed/store/words/cherub/able.js`);

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d) console.log(`      ${d}`);
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

// Drive birthHandler exactly as beVerb does: a fresh moment with _inOp set, then
// seal, then drain afterSeal (the first-being angel grant).
async function register({ name, password, nameId }) {
  const branch = "0";
  const moment = {
    actId: randomUUID(),
    actorAct: { branch, by: nameId || "i-am" },
    identity: { beingId: "i-am", name: "i-am", nameId: nameId || "i-am" },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
    _inOp: true,
  };
  const res = await cherubBeOps.birth.handler({
    payload: { name, password },
    ctx: { nameId: nameId || null, moment, req: {} },
  });
  await sealFacts(moment.deltaF);
  for (const fn of moment.afterSeal || []) {
    try {
      await fn();
    } catch {
      /* angel grant; tolerated */
    }
  }
  return { res, deltaF: moment.deltaF };
}

console.log(
  `\n  verify-cherub-cut (birthHandler subsequent path, the cut site)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  const branch = "0";
  const cherub = await poll(() => findByName("being", "cherub", branch));
  if (!cherub) {
    console.log("  FATAL: genesis failed (no cherub)");
    process.exit(1);
  }
  const arrival = await findByName("being", "arrival", branch);
  console.log(
    `  cherub=${String(cherub?.id).slice(0, 10)} arrival=${String(arrival?.id).slice(0, 10)}\n`,
  );

  // ── 1. the FIRST human (takes the first-being path, NOT cut) ──
  await register({ name: "founder", password: "founderpw1" });
  const founder = await poll(() => findByName("being", "founder", branch));
  founder
    ? ok(`first human @founder registered (first-being path)`)
    : bad(`@founder registered`, "no row");

  // ── 2. the arriving NAME for the subsequent being ──
  let ownerName = null;
  {
    const sc = {
      actId: randomUUID(),
      actorAct: { branch, by: "i-am" },
      identity: { beingId: "i-am", name: "I", nameId: "i-am" },
      deltaF: [],
      foldedSeqs: new Map(),
      afterSeal: [],
    };
    ownerName = (
      await nameVerb(
        "declare",
        { name: "newcomer", password: "pw12345678", soulType: "human" },
        { identity: sc.identity, moment: sc, currentHistory: branch },
      )
    ).nameId;
    await sealFacts(sc.deltaF);
  }
  console.log(`  arriving Name = ${String(ownerName).slice(0, 14)}…\n`);

  // ── 3. the SUBSEQUENT human (THE CUT SITE: birthHandler subsequent path) ──
  const { res, deltaF } = await register({
    name: "comer-being",
    password: "comerpw123",
    nameId: String(ownerName),
  });
  console.log(
    `  birthHandler laid ${deltaF.length} world fact(s); returned firstUser=${res?.firstUser}, name=${res?.name}\n`,
  );

  // ── assertions ──
  res?.name === "comer-being"
    ? ok(`return names @comer-being`)
    : bad(`return name`, res?.name);
  res?.firstUser === false
    ? ok(`return firstUser=false (subsequent path taken)`)
    : bad(`firstUser=false`, String(res?.firstUser));
  res?.identityToken
    ? ok(`session strand minted an identity token`)
    : bad(`identity token`, "none");
  res?.homeSpaceId
    ? ok(`return carries homeSpaceId (portal lands at home)`)
    : bad(`homeSpaceId`, String(res?.homeSpaceId));

  const born = await poll(() => findByName("being", "comer-being", branch));
  born
    ? ok(
        `@comer-being materializes after seal (${String(born.id).slice(0, 10)}…)`,
      )
    : bad(`@comer-being materializes`, "no row");

  const proj = born
    ? await loadProjection("being", String(born.id), branch)
    : null;
  String(proj?.state?.trueName) === String(ownerName)
    ? ok(`being is the arriving Name's own (trueName = the Name)`)
    : bad(`trueName = arriving Name`, String(proj?.state?.trueName));

  const lineage = proj?.state?.qualities?.lineage;
  String(lineage?.mother) === String(cherub?.id) &&
  String(lineage?.father) === String(arrival?.id)
    ? ok(`lineage: mother=Cherub, father=Arrival`)
    : bad(`lineage`, JSON.stringify(lineage));

  const home = res?.homeSpaceId
    ? await loadProjection("space", String(res.homeSpaceId), branch)
    : null;
  String(home?.state?.members?.owner ?? home?.state?.owner) === String(born?.id)
    ? ok(`home space owned by the new being`)
    : bad(
        `home owner`,
        JSON.stringify(home?.state?.members ?? home?.state?.owner),
      );

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
