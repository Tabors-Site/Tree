#!/usr/bin/env node
// create-space (create.word), LIVE through the bridge with ZERO stubs. The actor gate +
// the return are .word; resolve-birth-space (validate / coord / hook / sibling-unique /
// max-children UNDER the parent-lock / uuid) is a host escape wired by spaceHost.js,
// calling the non-emitting materials/space/spaces.js resolveBirthSpace. The dispatcher
// lays the ONE do:create-space fact (no self-emit, no skipAudit) — the spacebar lift.
// Proves: a REAL create-space via doVerb runs the .word, lands one birth fact (NO null
// terms), the fact folds the row, sibling-name uniqueness refuses, the no-actor gate
// refuses, and the parent-lock releases on afterSeal (a 2nd create under root succeeds).
// CALLER mode. Full begin.js boot (genesis runs the kernel path — UNTOUCHED — so green
// boot also proves resolveBirthSpace didn't disturb createSpace). Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_createspace_cut-" + process.pid);
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.PORT = "3798";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
delete process.env.MONGODB_URI;
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "createspace-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "createspacecut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "createspacecut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// Scratch file store is fresh-wiped above (TREEOS_STORE_BASE); begin.js opens it on boot.
await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
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
const create = async (target, params, who = ident) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: who?.nameId || null },
    identity: who,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, "create-space", params, {
      identity: who,
      moment: sc,
      currentHistory: "0",
    });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    // Mimic the real moment-seal: fire afterSeal (the parent-lock release) post-seal.
    for (const cb of sc.afterSeal || []) {
      try {
        await cb();
      } catch {
        /* ignore */
      }
    }
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    for (const cb of sc.afterSeal || []) {
      try {
        await cb();
      } catch {}
    }
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

console.log(
  `\n  verify-createspace-cut (REAL create-space op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  resolveAbleWord("space", "create-space")
    ? ok(`create.word resolves through the bridge (self-registered)`)
    : bad(`resolves`, "null");

  const rootSpace = String(getSpaceRootId());

  // ── 1. create a space under the place root → spaceId returned ──
  const c = await create(
    { kind: "space", id: rootSpace },
    { name: "alpha", type: "2d" },
  );
  c.result?.spaceId
    ? ok(
        `create-space under root → spaceId returned (the .word resolve-birth-space ran)`,
      )
    : bad(`create`, c.refused?.message || c.result);
  const spaceId = String(c.result?.spaceId);

  // ── 2. the do:create-space fact lands: of.id = the new space, through = the caller ──
  const cf = (c.deltaF || []).find((f) => f.act === "create-space");
  cf && String(cf.of?.id) === spaceId && String(cf.through) === String(I)
    ? ok(
        `do:create-space fact lands: of.id = spaceId, through = the caller (I)`,
      )
    : bad(`fact`, cf ? { ofId: cf.of?.id, through: cf.through } : "no fact");

  // ── 3. NO NULL TERMS: the birth params declare only the fields that ARE ──
  const p = cf?.params || {};
  const nullish = Object.entries(p).filter(([, v]) => v === null);
  p.name === "alpha" && String(p.parent) === rootSpace && nullish.length === 0
    ? ok(
        `birth params: name "alpha", parent = root, owner present (root), NO null terms`,
      )
    : bad(`no-null-terms`, { params: p, nullish });

  // ── 4. the space row folds (name + parent) ──
  const slot = await loadOrFold("space", spaceId, "0");
  slot?.state?.name === "alpha" && String(slot?.state?.parent) === rootSpace
    ? ok(`@space folds: name "alpha", parent = root`)
    : bad(`fold`, slot?.state);

  // ── 5. sibling-name uniqueness refuses (the resolveBirthSpace floor ran) ──
  const dup = await create({ kind: "space", id: rootSpace }, { name: "alpha" });
  dup.refused
    ? ok(
        `duplicate sibling name → refuse "${dup.refused.message?.slice(0, 40)}..."`,
      )
    : bad(`uniqueness`, dup.result);

  // ── 6. the parent-lock released on afterSeal: a 2nd DISTINCT create under root succeeds ──
  const c2 = await create({ kind: "space", id: rootSpace }, { name: "beta" });
  c2.result?.spaceId
    ? ok(
        `2nd create under root (name "beta") succeeds → the afterSeal lock-release works (no RESOURCE_CONFLICT)`,
      )
    : bad(`lock-release`, c2.refused?.message || c2.result);

  // ── 7. the no-actor gate refuses (the .word's "requires an identified actor") ──
  const n = await create(
    { kind: "space", id: rootSpace },
    { name: "gamma" },
    {},
  );
  n.refused
    ? ok(`no actor → refuse "${n.refused.message?.slice(0, 48)}..."`)
    : bad(`actor gate`, n.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
