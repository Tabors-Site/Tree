#!/usr/bin/env node
// form-portal as a TRUE one-moment COMPOSITE word: portal.word composes `do create-matter with
// { nested ibpa spec }` (the nested-object grammar). form-portal is WORD-SOLE (no handler) +
// ranAsMoments, so the nested do:create-matter deed pools INTO the op's ONE moment (atomic with
// the caller's transaction) and form-portal lays NO own fact (no do:form-portal audit). Proves
// the one-moment composition + nested-param grammar end to end. Full begin.js boot. Scratch DB.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_portal_compose-" + process.pid);
process.env.PORT = "3801";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "portalcompose-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "portalcompose-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "portalcompose-src");
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
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);

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

console.log(
  `\n  verify-portal-compose (form-portal composes create-matter via nested-param grammar)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  const spaceRoot = getSpaceRootId();
  const FOREIGN = "bing.com#0/library";

  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  const raw = await doVerb(
    { kind: "space", id: String(spaceRoot) },
    "form-portal",
    { target: FOREIGN, name: "test portal" },
    { identity: ident, moment: sc, currentHistory: "0" },
  );
  const result = raw?.result ?? raw;

  // 1. the composite returns formed + a content-addressed matterId
  result?.formed === true && result?.matterId
    ? ok(
        `form-portal returned formed:true + matterId ${String(result.matterId).slice(0, 10)}…`,
      )
    : bad(`form-portal return`, result);

  // 2. ONE MOMENT (not the run-on): form-portal is a PURE-COMPOSITION, so the nested
  //    `do create-matter` deed pools INTO the form-portal op's ONE moment — it IS in the
  //    op's deltaF (atomic with the caller's transaction, runOpWord runs the .word in the
  //    op's moment), and form-portal lays NO fact of its own (ranAsMoments → no
  //    do:form-portal audit). So deltaF holds EXACTLY one do:create-matter and NO
  //    do:form-portal.
  const acts = sc.deltaF.map((f) => `${f.verb}:${f.act}`);
  const createMatterDeeds = sc.deltaF.filter(
    (f) => f.verb === "do" && f.act === "create-matter",
  );
  createMatterDeeds.length === 1 &&
  !sc.deltaF.some((f) => f.act === "form-portal")
    ? ok(
        `create-matter is in the op's ONE moment (deltaF holds exactly one do:create-matter, atomic with the caller), no do:form-portal audit (ranAsMoments) — op deltaF [${acts.join(", ") || "empty"}]`,
      )
    : bad(`moment model`, acts);

  // Seal the op's one moment to the store — under the one-moment model NOTHING
  // materializes until this seal (the deed rides the caller's deltaF, not its own).
  await sealFacts(sc.deltaF);

  // 3. the folded portal matter is caller-attributed (qualities.portal.createdBy = the caller)
  const pm = await poll(() =>
    loadOrFold("matter", String(result.matterId), "0"),
  );
  pm?.state?.qualities?.portal?.createdBy === String(I)
    ? ok(
        `portal matter attributed to the caller (qualities.portal.createdBy = I)`,
      )
    : bad(`attribution`, pm?.state?.qualities?.portal);

  // 4. the ibpa matter materializes with the folded nested content + qualities
  const matter = await poll(() =>
    loadOrFold("matter", String(result.matterId), "0"),
  );
  matter?.state?.type === "ibpa" &&
  matter?.state?.content?.target === FOREIGN &&
  matter?.state?.qualities?.portal?.target === FOREIGN
    ? ok(
        `the portal matter folds: type ibpa, content.target + qualities.portal.target = ${FOREIGN}`,
      )
    : bad(`folded matter`, matter?.state);

  // 5. the matter id is content-addressed (reproducible) — it is a real hash, not a uuid
  typeof result.matterId === "string" &&
  result.matterId.length >= 16 &&
  !result.matterId.includes("-")
    ? ok(`matterId is content-addressed (not a uuid)`)
    : bad(`content-addressed id`, result.matterId);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
