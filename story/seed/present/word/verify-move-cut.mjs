#!/usr/bin/env node
// move (move.word), LIVE through the bridge with ZERO stubs. The mode fork + every refuse +
// the §7 return are .word; resolve-source (the source-space READ, loadOrFold("space", dest)
// for the dest-exists check, loadOrFold over space/matter for the subject's parent / containing space, and the coord
// bounds check against the container's size) is the host escape wired by moveHost.js's
// moveHostEnv. Proves: a REAL do:move via doVerb runs the .word, folds the moved subject's
// row (coord in-space, spaceId cross-space), lands the do:move fact targeting the SUBJECT
// (through = caller, params carry fromSpaceId), and the gates (both-modes, out-of-bounds,
// missing dest, space-into-itself) refuse exactly as the JS did. CALLER mode.
// Full begin.js boot. Scratch DB, wiped.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_word_move_cut-" + process.pid);
process.env.PORT = "3847";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "move-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "movecut-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "movecut-src");
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
    // mimic the real moment-seal: fire afterSeal (e.g. the create-space parent-lock release)
    for (const fn of sc.afterSeal || []) {
      try {
        await fn();
      } catch {}
    }
    return { result: res?.result ?? res, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
};

console.log(`\n  verify-move-cut (REAL do:move op via doVerb → the cut)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  resolveAbleWord("move", "move")
    ? ok(`move.word resolves through the bridge (self-registered from move/index.js)`)
    : bad(`resolves`, "null");
  const rootSpace = String(getSpaceRootId());

  // ── seed: a sized container space + a matter inside it, and a 2nd destination space ──
  const room = await runOp({ kind: "space", id: rootSpace }, "create-space", {
    name: "room", size: { x: 10, y: 10 },
  });
  const roomId = String(room.result?.spaceId);
  const dest = await runOp({ kind: "space", id: rootSpace }, "create-space", {
    name: "dest", size: { x: 10, y: 10 },
  });
  const destId = String(dest.result?.spaceId);
  const m = await runOp({ kind: "space", id: roomId }, "create-matter", {
    name: "thing.txt", content: "t\n", coord: { x: 1, y: 1 },
  });
  const mId = String(m.result?.matterId);
  roomId && destId && mId
    ? ok(`seeded room (10×10), dest (10×10), and thing.txt at (1,1) in room`)
    : bad(`seed`, { room: room.refused?.message, dest: dest.refused?.message, m: m.refused?.message });
  const matter = { kind: "matter", id: mId };

  // ── 1. coord-mode move: thing.txt → (5,5) inside room. The row folds the new coord. ──
  const c = await runOp(matter, "move", { coord: { x: 5, y: 5 } });
  const slotC = mId ? await loadOrFold("matter", mId, "0") : null;
  c.result?.moved &&
  c.result?.mode === "coord" &&
  slotC?.state?.coord?.x === 5 &&
  slotC?.state?.coord?.y === 5
    ? ok(`coord-mode move via the .word → the matter row FOLDS coord (5,5)`)
    : bad(`coord move`, {
        result: c.result,
        refused: c.refused?.message,
        coord: slotC?.state?.coord,
      });

  // ── 2. the do:move fact: verb do, targets the MATTER (not the room), through = caller, ──
  //    params carry coord + fromSpaceId (the source room — the live-SEE invalidation hint).
  const cf = (c.deltaF || []).find((f) => f.act === "move");
  cf &&
  cf.verb === "do" &&
  String(cf.of?.id) === mId &&
  cf.of?.kind === "matter" &&
  String(cf.through) === String(I) &&
  String(cf.params?.fromSpaceId) === roomId
    ? ok(
        `do:move fact: of {matter, matterId}, through = caller, params.fromSpaceId = room (resolve-source host read)`,
      )
    : bad(`fact`, cf ? { verb: cf.verb, of: cf.of, through: cf.through, params: cf.params } : "no fact");

  // ── 3. container-mode move: thing.txt → dest space. The row folds the new spaceId. ──
  // resolve-source's dest-exists check reads the dest through the curated projection layer
  // (loadOrFold("space", dest, history)), folded from the file store. The dest
  // was born by the REAL create-space op above and sealed onto its reel, so loadOrFold
  // cold-folds it and the dest-exists gate passes with no extra setup (the real fold, not a
  // stubbed Space row, is what the gate reads, exactly the live path).
  const k = await runOp(matter, "move", { to: destId });
  const slotK = mId ? await loadOrFold("matter", mId, "0") : null;
  k.result?.moved &&
  k.result?.mode === "container" &&
  String(slotK?.state?.spaceId) === destId
    ? ok(`container-mode move via the .word → the matter row FOLDS spaceId = dest`)
    : bad(`container move`, {
        result: k.result,
        refused: k.refused?.message,
        spaceId: slotK?.state?.spaceId,
      });

  // ── 4. out-of-bounds coord → refuse (resolve-source bounds check throws the same IbpError) ──
  //    (thing.txt now lives in dest, a 10×10 space; (99,99) is out of bounds.)
  const oob = await runOp(matter, "move", { coord: { x: 99, y: 99 } });
  oob.refused && /out of bounds/i.test(oob.refused.message || "")
    ? ok(`out-of-bounds coord → refuse "${(oob.refused.message || "").slice(0, 40)}…"`)
    : bad(`oob gate`, oob.refused?.message || oob.result);

  // ── 5. missing destination → refuse (resolve-source dest-exists check) ──
  const noDest = await runOp(matter, "move", { to: "no-such-space-xyz" });
  noDest.refused && /not found/i.test(noDest.refused.message || "")
    ? ok(`missing dest → refuse "${(noDest.refused.message || "").slice(0, 40)}…"`)
    : bad(`missing-dest gate`, noDest.refused?.message || noDest.result);

  // ── 6. both coord AND to → refuse (require-mode: exactly one mode) ──
  const both = await runOp(matter, "move", { coord: { x: 1, y: 1 }, to: destId });
  both.refused
    ? ok(`both coord+to → refuse "${(both.refused.message || "").slice(0, 40)}…"`)
    : bad(`require-mode gate`, both.result);

  // ── 7. space into itself → refuse (the native Word self-move gate) ──
  const self = await runOp({ kind: "space", id: roomId }, "move", { to: roomId });
  self.refused && /into itself/i.test(self.refused.message || "")
    ? ok(`space into itself → refuse "${(self.refused.message || "").slice(0, 40)}…"`)
    : bad(`self-move gate`, self.refused?.message || self.result);

  // ── 8. neither coord NOR to → refuse (native presence gate: must specify a mode) ──
  const neither = await runOp(matter, "move", {});
  neither.refused && /must specify either/i.test(neither.refused.message || "")
    ? ok(`no coord, no to → refuse "${(neither.refused.message || "").slice(0, 40)}…"`)
    : bad(`mode-absent gate`, neither.refused?.message || neither.result);

  // ── 9. non-finite coord.x → refuse (native `is a finite number` shape gate) ──
  const badX = await runOp(matter, "move", { coord: { x: "foo", y: 1 } });
  badX.refused && /must be \{ x, y/i.test(badX.refused.message || "")
    ? ok(`coord.x="foo" → refuse "${(badX.refused.message || "").slice(0, 40)}…"`)
    : bad(`coord-shape gate (x)`, badX.refused?.message || badX.result);

  // ── 10. non-finite coord.z → refuse (the closed silent-accept hole: z used to slip the ──
  //    shape check and get skipped by the bounds loop, sealing a move with a garbage z). ──
  const badZ = await runOp(matter, "move", { coord: { x: 1, y: 1, z: "foo" } });
  const slotZ = mId ? await loadOrFold("matter", mId, "0") : null;
  badZ.refused && /coord\.z/i.test(badZ.refused.message || "") &&
  slotZ?.state?.coord?.z === undefined
    ? ok(`coord.z="foo" → refuse "${(badZ.refused.message || "").slice(0, 40)}…" (no garbage z sealed)`)
    : bad(`coord-shape gate (z) — the closed hole`, {
        refused: badZ.refused?.message,
        result: badZ.result,
        sealedZ: slotZ?.state?.coord?.z,
      });

  // ── 11. non-string `to` → refuse (native `is a string` shape gate) ──
  const badTo = await runOp(matter, "move", { to: 12345 });
  badTo.refused && /space id string/i.test(badTo.refused.message || "")
    ? ok(`to=12345 → refuse "${(badTo.refused.message || "").slice(0, 40)}…"`)
    : bad(`to-shape gate`, badTo.refused?.message || badTo.result);

  // ── 12. WRONG-KIND subject (a being) → refuse (native require-subject-kind gate). The ──
  //    gate must fire BEFORE resolve-source — else detectTargetKind/loadOrFold would try to ──
  //    read a being as space/matter. Proves the native `not a space, not a matter` gate ──
  //    is equivalent to the deleted detectTargetKind host fn for the refuse branch (untested ──
  //    before this), AND that the two kind-deciders (gate reads .kind; resolve-source's ──
  //    detectTargetKind reads .kind) never both run on a non-typed subject. ──
  const beingSubj = await runOp({ kind: "being", id: String(I) }, "move", { to: destId });
  beingSubj.refused && /space or matter/i.test(beingSubj.refused.message || "") &&
  !/not found/i.test(beingSubj.refused.message || "") // NOT a resolve-source "being not found" — the gate caught it first
    ? ok(`being subject → refuse "${(beingSubj.refused.message || "").slice(0, 40)}…" (gate fired before the read)`)
    : bad(`subject-kind gate (being)`, beingSubj.refused?.message || beingSubj.result);

  // ── 13. BARE-STRING subject (ambiguous for a two-kind op) → must NOT move. detectTargetKind ──
  //    returns null for a string; the native gate's absent .kind refuses identically. ──
  const strSubj = await runOp("a-bare-string-id-xyz", "move", { coord: { x: 1, y: 1 } });
  (strSubj.refused || !strSubj.result?.moved)
    ? ok(`bare-string subject → not moved (refused: "${((strSubj.refused?.message) || "no result").slice(0, 36)}…")`)
    : bad(`bare-string subject leaked a move`, strSubj.result);

  // ── 14. integer/float BOUNDS boundary (the cell-vs-position semantics, in the 10×10 dest). ──
  //    Proves the shared assertCoordWithinSize math is RIGHT, not just preserved: an integer ──
  //    coord is a 0-indexed cell (9 valid, 10 out), a float is a continuous position (9.5 in). ──
  const cell9 = await runOp(matter, "move", { coord: { x: 9, y: 9 } });
  const cell10 = await runOp(matter, "move", { coord: { x: 10, y: 0 } });
  const pos95 = await runOp(matter, "move", { coord: { x: 9.5, y: 0.5 } });
  cell9.result?.moved &&
  cell10.refused && /out of bounds/i.test(cell10.refused.message || "") &&
  pos95.result?.moved
    ? ok(`bounds boundary: int 9 ✓, int 10 ✗ "${(cell10.refused.message || "").slice(0, 30)}…", float 9.5 ✓ (cell vs position)`)
    : bad(`bounds boundary`, {
        cell9: cell9.result?.moved ?? cell9.refused?.message,
        cell10: cell10.refused?.message ?? cell10.result,
        pos95: pos95.result?.moved ?? pos95.refused?.message,
      });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
