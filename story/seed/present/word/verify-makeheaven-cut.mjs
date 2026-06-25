#!/usr/bin/env node
// make-heaven (make-heaven.word), LIVE via doVerb with ZERO stubs. WORD-SOLE, host-less — the word
// AUTHORS its fact (factParams { heavenSpace } + a {kind,id} factTarget). Proves: a do:make-heaven
// fact lands on the space's reel carrying { heavenSpace }, the @space fold sets state.heavenSpace,
// and a missing marker refuses. Acts as I (the I-only authorize gate passes). Full begin.js boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_makeheaven_cut-" + process.pid);
process.env.PORT = "3797";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "makeheaven-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "makeheavencut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "makeheavencut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`);
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

async function doOp(target, op, params) {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(target, op, params, { identity: ident, moment: sc, currentHistory: "0" });
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    return { result: null, deltaF: sc.deltaF, refused: e };
  }
}
const fact = (deltaF) => (deltaF || []).find((f) => f.act === "make-heaven");

console.log(`\n  verify-makeheaven-cut (REAL make-heaven via doVerb → runOpWord)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const rootId = await poll(() => {
    try {
      return getSpaceRootId();
    } catch {
      return null;
    }
  });
  if (!rootId) {
    console.log("  FATAL: genesis failed (no story root)");
    process.exit(1);
  }
  const sp = await doOp({ kind: "space", id: String(rootId) }, "create-space", { name: "heavenish" });
  const spaceId = sp.result?.spaceId || sp.result?._factTarget?.id;
  spaceId ? ok(`created space "heavenish" → ${String(spaceId).slice(0, 8)}`) : bad("create", sp.refused?.message);
  const target = { kind: "space", id: String(spaceId) };

  // ── 1. make-heaven → one do:make-heaven { heavenSpace } on the space reel ──
  const a = await doOp(target, "make-heaven", { heavenSpace: "test-region" });
  const fa = fact(a.deltaF);
  fa && fa.params?.heavenSpace === "test-region" && String(fa.of?.id) === String(spaceId)
    ? ok(`make-heaven → do:make-heaven { heavenSpace:"test-region" } on the space reel`)
    : bad("fact", a.refused?.message || (fa && { params: fa.params, of: fa.of }));

  // ── 2. fold sets state.heavenSpace ──
  {
    const slot = await loadOrFold("space", String(spaceId), "0");
    slot?.state?.heavenSpace === "test-region"
      ? ok("@space fold: state.heavenSpace=test-region")
      : bad("fold", slot?.state?.heavenSpace);
  }

  // ── 3. refuse: no marker ──
  const b = await doOp(target, "make-heaven", {});
  b.refused && /heavenSpace marker/i.test(b.refused.message) && !fact(b.deltaF)
    ? ok(`no marker → refuse "requires a heavenSpace marker", NO fact`)
    : bad("refuse", b.refused?.message || b.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
