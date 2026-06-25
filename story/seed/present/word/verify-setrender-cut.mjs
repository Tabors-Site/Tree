#!/usr/bin/env node
// set-render — the field-set-sugar collapse (23.md). Was: an inner doVerb(set-<kind>, field:
// qualities.render) + skipAudit:true (so the outer wouldn't double-stamp). Now: set-render returns
// its OWN stampsFact (do:set-render, params {field:"qualities.render", value:block}) and the target's
// reducer folds it via applySetQualities (set-render added to SET_ACTIONS). One act, one fact, fold —
// no inner doVerb, no skipAudit. Proves: a REAL set-render lays exactly ONE do:set-render fact and the
// target's qualities.render folds from it.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_setrender_cut-" + process.pid);
process.env.PORT = "3843";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "setrender-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "setrendercut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "setrendercut-src");
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
const runOp = async (target, op, params) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: ident.nameId },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, op, params, {
      identity: ident,
      moment: sc,
      currentHistory: "0",
    });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

console.log(
  `\n  verify-setrender-cut (set-render = one do:set-render fact → reducer folds qualities.render)\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  const rootSpace = String(getSpaceRootId());

  const c = await runOp({ kind: "space", id: rootSpace }, "create-matter", {
    name: "drum.txt",
    content: "tick\n",
  });
  const mId = String(c.result?.matterId);
  mId ? ok(`seeded a matter`) : bad(`seed`, c.refused?.message);
  const target = { kind: "matter", id: mId };

  // ── set-render on it ──
  const block = { model: "seed:drum", scale: 2 };
  const r = await runOp(target, "set-render", block);
  const facts = r.deltaF || [];
  const renderFacts = facts.filter((f) => f.act === "set-render");
  const innerSetFacts = facts.filter((f) => f.act === "set-matter");
  renderFacts.length === 1 && innerSetFacts.length === 0
    ? ok(
        `set-render lays exactly ONE do:set-render fact; zero inner set-matter facts (the sugar is gone)`,
      )
    : bad(`one fact`, { acts: facts.map((f) => f.act) });

  const rf = renderFacts[0];
  rf &&
  rf.verb === "do" &&
  rf.of?.kind === "matter" &&
  String(rf.of?.id) === mId &&
  rf.params?.field === "qualities.render"
    ? ok(
        `the do:set-render fact: of {matter, id}, params.field = qualities.render (the qualities set the reducer folds)`,
      )
    : bad(
        `fact shape`,
        rf ? { verb: rf.verb, of: rf.of, params: rf.params } : "no render fact",
      );

  // ── the reducer FOLDS qualities.render from the one fact (applySetQualities, set-render in SET_ACTIONS) ──
  const slot = await loadOrFold("matter", mId, "0");
  slot?.state?.qualities?.render?.model === "seed:drum" &&
  slot?.state?.qualities?.render?.scale === 2
    ? ok(
        `qualities.render folds from the one fact (model="seed:drum", scale=2) — applySetQualities derived it`,
      )
    : bad(`folds qualities.render`, { render: slot?.state?.qualities?.render });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
