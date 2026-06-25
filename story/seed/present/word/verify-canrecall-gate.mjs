#!/usr/bin/env node
// B2 (623/12, ARMED): the canRecall consciousness-level gate ENFORCES. A being recalls a WIDER fold
// (saw: world/lineage/moment/place/foreign-thread) iff its able grants the recall VIEW; its OWN
// thread (recalled) is always free; I bypasses. Proves the gate BITES (an ungranted being is
// refused the world) AND lets the granted being through. Run: node seed/present/word/verify-canrecall-gate.mjs

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_canrecall-" + process.pid);
process.env.PORT = "3816";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "canrecall-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "canrecall-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "canrecall-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { evaluate } = await import(`${R}/seed/present/word/evaluator.js`);
const { registerAble, canRecallScope } = await import(
  `${R}/seed/present/ables/registry.js`
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

console.log(
  `\n  verify-canrecall-gate (the consciousness-level gate enforces — ungranted is refused)\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));

  // a "mute" able: no recall grants at all (only `do move`) — a deliberately ungranted consciousness.
  registerAble(
    "mute",
    { description: "no recall grant", can: [{ verb: "do", word: "move" }] },
    "live",
  );

  let sage = null,
    mute = null;
  await withIAmAct("birth sage(global)", async (m) => {
    sage = (
      await birthBeing({
        spec: {
          name: "sage",
          parentBeingId: cherub.id,
          homeId: cherub.state?.homeSpace,
          cognition: "scripted",
          defaultAble: "global",
        },
        identity: I,
        moment: m,
        history: "0",
      })
    ).beingId;
  });
  await withIAmAct("birth mute(no-recall)", async (m) => {
    mute = (
      await birthBeing({
        spec: {
          name: "mute",
          parentBeingId: cherub.id,
          homeId: cherub.state?.homeSpace,
          cognition: "scripted",
          defaultAble: "mute",
        },
        identity: I,
        moment: m,
        history: "0",
      })
    ).beingId;
  });
  await new Promise((r) => setTimeout(r, 1200));

  // 1. the helper: global GRANTS world; mute does NOT; I bypasses
  (await canRecallScope(sage, "world", "0")) === true
    ? ok(`canRecallScope(global being, "world") → true (granted)`)
    : bad(`global grants world`);
  (await canRecallScope(mute, "world", "0")) === false
    ? ok(
        `canRecallScope(ungranted being, "world") → false (the gate will refuse)`,
      )
    : bad(`ungranted refused`);
  (await canRecallScope(I, "world", "0")) === true
    ? ok(`canRecallScope(I, "world") → true (universal authority bypass)`)
    : bad(`I bypass`);

  // 2. the gate BITES: an ungranted being recalling the world is REFUSED (WordRefusal)
  const muteCtx = {
    dryRun: false,
    history: "0",
    identity: { beingId: String(mute), nameId: String(mute), name: "mute" },
    bindings: {},
    deltaF: [],
    flows: [],
  };
  let refused = false;
  try {
    await evaluate({ kind: "recall", of: "world", as: "w" }, muteCtx);
  } catch (e) {
    refused = !!(e && (e.__wordRefusal || /not granted/.test(e.message)));
  }
  refused
    ? ok(`recall world as the ungranted being → REFUSED (the gate enforces)`)
    : bad(`gate did not refuse`, muteCtx.bindings.w?.length);

  // 3. but the ungranted being recalls its OWN thread freely (recalled is always yours)
  const muteCtx2 = {
    dryRun: false,
    history: "0",
    identity: { beingId: String(mute), nameId: String(mute), name: "mute" },
    bindings: {},
    deltaF: [],
    flows: [],
  };
  let ownOk = false;
  try {
    await evaluate({ kind: "recall", of: String(mute), as: "mine" }, muteCtx2);
    ownOk = Array.isArray(muteCtx2.bindings.mine);
  } catch {
    ownOk = false;
  }
  ownOk
    ? ok(
        `recall OWN thread as the ungranted being → allowed (recalled needs no grant)`,
      )
    : bad(`own thread refused`);

  // 4. the granted being still recalls the world (no regression — re-confirms recall-live's path)
  const sageCtx = {
    dryRun: false,
    history: "0",
    identity: { beingId: String(sage), nameId: String(sage), name: "sage" },
    bindings: {},
    deltaF: [],
    flows: [],
  };
  let sageOk = false;
  try {
    await evaluate({ kind: "recall", of: "world", as: "w" }, sageCtx);
    sageOk = Array.isArray(sageCtx.bindings.w) && sageCtx.bindings.w.length > 0;
  } catch {
    sageOk = false;
  }
  sageOk
    ? ok(`recall world as the granted (global) being → allowed`)
    : bad(`granted being refused`);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
