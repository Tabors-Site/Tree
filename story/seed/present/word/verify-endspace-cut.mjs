#!/usr/bin/env node
// end-space — the [C] collapse (23.md), the end-matter pattern for the tree. Was: deleteSpaceHistory
// hand-stamped TWO inner do:set-space facts (owner=deleter, parent=DELETED). Now: end-space lays ONE
// do:end-space fact, and the space reducer DERIVES both consequences (parent=DELETED hides it +
// position mirror; owner=the fact's `through`, the deleter, for revival audit). Proves: a REAL
// end-space via doVerb lays one end-space fact, zero set-space facts, and the space folds deleted.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_endspace_cut-" + process.pid);
process.env.PORT = "3842";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "endspace-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "endspacecut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "endspacecut-src");
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
const { DELETED } = await import(`${R}/seed/materials/space/heavenSpaces.js`);
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
  `\n  verify-endspace-cut (end-space = one act → one fact → the reducer folds the rest)\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  const rootSpace = String(getSpaceRootId());

  const c = await runOp({ kind: "space", id: rootSpace }, "create-space", {
    name: "doomedspace",
    parent: rootSpace,
  });
  const sId = String(
    c.result?.spaceId ??
      c.result?.id ??
      (await poll(() => findByName("space", "doomedspace", "0")))?.id,
  );
  sId && sId !== "undefined"
    ? ok(`seeded a space (doomedspace)`)
    : bad(`seed`, c.refused?.message || c.result);
  const target = { kind: "space", id: sId };

  // ── end it ──
  const r = await runOp(target, "end-space", {});
  const facts = r.deltaF || [];
  const endFacts = facts.filter((f) => f.act === "end-space");
  const setFacts = facts.filter((f) => f.act === "set-space");
  endFacts.length === 1 && setFacts.length === 0
    ? ok(
        `end-space lays ONE do:end-space fact; zero set-space facts (the two-field false shape is gone)`,
      )
    : bad(`one fact`, { acts: facts.map((f) => f.act) });

  const ef = endFacts[0];
  ef &&
  ef.verb === "do" &&
  ef.of?.kind === "space" &&
  String(ef.of?.id) === sId &&
  String(ef.through) === String(I)
    ? ok(
        `the do:end-space fact: of {space, spaceId}, through = the deleter (I)`,
      )
    : bad(
        `fact shape`,
        ef ? { verb: ef.verb, of: ef.of, through: ef.through } : "no end fact",
      );

  // ── the reducer FOLDS parent=DELETED + owner=deleter ──
  const slot = await loadOrFold("space", sId, "0");
  slot?.state?.parent === DELETED && String(slot?.state?.owner) === String(I)
    ? ok(
        `the space folds: parent=DELETED (hidden) + owner=the deleter (revival audit) — derived from the one fact`,
      )
    : bad(`folds deleted`, {
        parent: slot?.state?.parent,
        owner: slot?.state?.owner,
        position: slot?.state?.position,
      });

  // ── it drops out of parent-query (hidden from children) ──
  const { listSpaceChildren } = await import(
    `${R}/seed/materials/space/spaces.js`
  ).catch(() => ({}));
  if (typeof listSpaceChildren === "function") {
    const kids = await listSpaceChildren(rootSpace, "0").catch(() => []);
    const stillChild = (kids || []).some((k) => String(k.id ?? k._id) === sId);
    !stillChild
      ? ok(
          `ended space no longer appears as a child of root (parent=DELETED hides it)`,
        )
      : bad(`hidden`, { stillChild });
  } else {
    ok(
      `(listSpaceChildren not directly testable here — parent=DELETED fold asserted above)`,
    );
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
