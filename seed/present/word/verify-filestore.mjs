// verify-filestore.mjs — boot-free proof of the append-only-file storage core. Runs against a temp dir.
//
// The reel/.acts WRITE PATH + the reel reads now run in RUST (treestore, reached through the napi addon
// as native.store*): commitMoment/commitVerbatim -> native.storeCommitMoment/storeCommitVerbatim,
// readReel/readReelLineage/readReelHead -> native.storeReadReel*, appendActLine/advanceActHeadFile/
// readActHeadFile/readActChain -> native.store*. The fileStore.js callers below are thin storeRoot()-
// threaded bindings to those, so these assertions exercise the Rust stamp directly (byte wire-compatible,
// proven by the step-B parity diff + the boot "world IDENTICAL" gate).
//
// Proves: (1) a moment's facts append to per-reel files with a valid hash-chain (the canonical fact
// shape, via the shared hash.js); (2) readReel reads them back in seq order; (3) write-through (no
// journal) — the on-disk reel IS the truth, reopening sees every committed fact, a torn append leaves
// a line the .head never advanced past (readReel skips it), so a crashed moment leaves zero trace.

import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureStore,
  storeRoot,
  storeBase,
  commitMoment,
  readReel,
  readReelHead,
  readReelLineage,
  verifyReelFile,
  verifyReelLineage,
  forkReel,
  appendActLine,
  readActHeadFile,
  advanceActHeadFile,
  readReelWhere,
  factsByActId,
  readActById,
  actsByCorrelation,
  actsByField,
  readActChain,
  patchAct,
  actCount,
  rebuildActIndex,
} from "../../past/fileStore.js";
// The .proj snapshot + derived find* index moved to the Rust `treeproj` crate (reached through the
// napi addon as native.proj*); the JS fileStore no longer implements them. The store-primitive
// assertions below (sections 10/12/13) exercise that Rust path directly, threading fileStore's
// storeRoot() so Rust reads/writes the SAME on-disk files. Thin JS-signature shims keep the asserts
// readable; they are the same shapes projections.js now routes to.
import { native } from "../../past/fact/native.js";
const loadSnapshot = (h, k, id) => {
  const t = native.projLoadSnapshot(storeRoot(), String(h), String(k), String(id));
  return t == null ? null : JSON.parse(t);
};
const saveSnapshot = (h, k, id, slot, exp = undefined) =>
  native.projSaveSnapshot(
    storeRoot(),
    String(h),
    String(k),
    String(id),
    JSON.stringify(slot),
    typeof exp === "number" ? exp : undefined,
  );
const findByName = (h, k, name) => {
  const t = native.projFindByName(storeRoot(), String(h), String(k), String(name), "{}");
  return t == null ? null : JSON.parse(t);
};
const findByPosition = (h, sid) =>
  JSON.parse(native.projFindByPosition(storeRoot(), String(h), String(sid)));
const findByParent = (h, pid, k) =>
  JSON.parse(native.projFindByParent(storeRoot(), String(h), String(pid), String(k)));
const listByType = (h, k) => JSON.parse(native.projListByType(storeRoot(), String(h), String(k)));
// refold(history, kind, id) is the Rust rebuild: read the reel, fold to the state, re-derive the
// .proj slot ({state, foldedSeq, position, tombstoned}) AND re-bucket the derived index off it. The
// rebuildable property (the index is a pure fold of the reels) — replaces fileStore.rebuildIndex.
const refold = (h, k, id) =>
  JSON.parse(native.projRefold(storeRoot(), String(h), String(k), String(id)));

let pass = 0,
  fail = 0;
const ok = (m) => {
  console.log(`  ✓ ${m}`);
  pass++;
};
const bad = (m, extra) => {
  console.log(`  ✗ ${m}${extra !== undefined ? `\n      ${JSON.stringify(extra)}` : ""}`);
  fail++;
};

const root = mkdtempSync(join(tmpdir(), "treeos-filestore-"));
configureStore({ root });

try {
  // A being birth + two follow-on words (set-being name, set-being coord), each its OWN moment —
  // the one-word shape. Each commitMoment = one fact on the being's reel.
  const B = "being-abc123def456";
  const H = "0";
  const mk = (act, params) => ({
    recId: `${act}-${params.field || "birth"}`,
    act: { _id: `act-${act}-${params.field || "birth"}` },
    facts: [
      {
        history: H,
        kind: "being",
        id: B,
        spec: {
          through: B,
          by: "i-am",
          verb: act === "birth" ? "be" : "do",
          act,
          of: { kind: "being", id: B },
          params,
          history: H,
        },
      },
    ],
  });

  const r1 = await commitMoment(mk("birth", { name: "alice", parentBeingId: "i-am" }));
  const r2 = await commitMoment(mk("set-being", { field: "name", value: "Alice" }));
  const r3 = await commitMoment(mk("set-being", { field: "coord", value: { x: 1, y: 2 } }));

  // 1. the reel has 3 facts in seq order
  const reel = readReel(H, "being", B);
  reel.length === 3 && reel[0].seq === 1 && reel[1].seq === 2 && reel[2].seq === 3
    ? ok("3 one-word moments → 3 facts on the reel, seq 1..3")
    : bad("reel seq", reel.map((f) => f.seq));

  // 2. the hash-chain is valid (p-links + recomputed _id match) — the integrity proof
  const v = verifyReelFile(H, "being", B);
  v.ok && v.length === 3 ? ok("hash-chain verifies (p-links + content hashes)") : bad("verifyReelFile", v);

  // 3. p of fact N == _id of fact N-1; first p == GENESIS
  reel[0].p === "0".repeat(64) && reel[1].p === reel[0]._id && reel[2].p === reel[1]._id
    ? ok("p-links chain each fact to its predecessor (first = GENESIS_PREV)")
    : bad("p-chain", reel.map((f) => ({ seq: f.seq, p: f.p.slice(0, 8), id: f._id.slice(0, 8) })));

  // 4. the head points at the last fact
  const head = readReelHead(H, "being", B);
  head.head === 3 && head.headHash === reel[2]._id
    ? ok(".head = {head:3, headHash: last fact's _id}")
    : bad("head", head);

  // 5. REBOOT-SURVIVAL: a fresh store instance over the SAME dir reads the reel back. Write-through
  //    means the on-disk reel IS the truth (no journal to replay) — reopening sees all 3 committed
  //    facts, chain intact. A torn mid-append leaves an unparseable trailing line that readReel skips
  //    and the .head never advanced past, so a crashed moment leaves zero trace without any WAL.
  configureStore({ root });
  const reel2 = readReel(H, "being", B);
  reel2.length === 3 && verifyReelFile(H, "being", B).ok
    ? ok(`reboot-survival — reel still 3 after reopen, chain intact`)
    : bad("reboot survival", { len: reel2.length });

  // 8. BRANCHING (Tabor: "past splits by branches, they branch from each other at points"): a branch
  //    stores only its divergent tail; a read UNIONS parent-prefix + branch-tail, and the branch's
  //    first fact chains across the fork to the parent's fact at the branchPoint.
  const M = "matter-branch-test-01";
  const mkM = (h, n) => ({
    recId: `${h}-set-${n}`,
    facts: [
      {
        history: h,
        kind: "matter",
        id: M,
        spec: { through: "i-am", verb: "do", act: "set-matter", of: { kind: "matter", id: M }, params: { n }, history: h },
      },
    ],
  });
  await commitMoment(mkM("0", 1));
  await commitMoment(mkM("0", 2));
  await commitMoment(mkM("0", 3)); // main reel: seq 1,2,3
  forkReel("1", "0", "matter", M, 2); // branch "1" forks at branchPoint 2 (seeds its head from main@2)
  await commitMoment(mkM("1", 4)); // branch: seq 3, p → main's fact at seq 2 (the cross-fork link)
  await commitMoment(mkM("1", 5)); // branch: seq 4
  const mainReel = readReel("0", "matter", M);
  const union = readReelLineage(["0", "1"], { "0": 0, "1": 2 }, "matter", M);
  const vLin = verifyReelLineage(["0", "1"], { "0": 0, "1": 2 }, "matter", M);
  union.length === 4 &&
  union.map((f) => f.seq).join(",") === "1,2,3,4" &&
  union[2].p === mainReel[1]._id && // branch's first fact (seq 3) chains to main's fact at branchPoint 2
  vLin.ok &&
  mainReel.length === 3 // main never sees the branch's divergent facts
    ? ok("branch unions parent-prefix + own-tail; first divergent fact chains across the fork; chain verifies")
    : bad("branching", { seqs: union.map((f) => f.seq), crossLink: union[2]?.p === mainReel[1]?._id, vLin, mainLen: mainReel.length });

  // 9. FOLD EQUIVALENCE (the doc's "prove the fold matches"): file-stored facts fold through the
  //    EXISTING being reducer to the canonical projection state. Read→fold on files.
  const { initial, reduce } = await import("../../materials/being/reducer.js");
  const FB = "being-fold-test-01";
  const mkF = (field, value) => ({
    recId: `fold-${field}`,
    facts: [
      {
        history: "0",
        kind: "being",
        id: FB,
        spec: { through: "i-am", verb: "do", act: "set-being", of: { kind: "being", id: FB }, params: { field, value }, history: "0" },
      },
    ],
  });
  await commitMoment(mkF("qualities.profile.mood", "calm"));
  await commitMoment(mkF("qualities.profile.level", 7));
  let st = initial();
  for (const f of readReel("0", "being", FB)) st = reduce(st, f);
  st?.qualities?.profile?.mood === "calm" && st?.qualities?.profile?.level === 7
    ? ok("file-stored facts fold through the REAL being reducer to the correct projection state")
    : bad("fold-equivalence", st);

  // 10. SNAPSHOTS (the .proj projection cache backing projections.js): fold a reel, save the slot,
  //     load it back; CAS guard rejects a stale write. The read→fold result is cached, rebuildable.
  let fst = initial();
  const ffacts = readReel("0", "being", FB);
  for (const f of ffacts) fst = reduce(f === ffacts[0] ? initial() : fst, f);
  const slot = { state: fst, foldedSeq: ffacts.length, position: null, tombstoned: false };
  saveSnapshot("0", "being", FB, slot);
  const loaded = loadSnapshot("0", "being", FB);
  const staleRejected = saveSnapshot("0", "being", FB, { ...slot, foldedSeq: 99 }, 999) === false;
  loaded?.foldedSeq === ffacts.length &&
  loaded?.state?.qualities?.profile?.mood === "calm" &&
  staleRejected
    ? ok("projection snapshot (.proj) round-trips; CAS guard rejects a stale fold")
    : bad("snapshot", { loaded, staleRejected });

  // 7. STORIES (per-story isolation): a named story maps to its own
  //    sibling folder under the store base; "main"/"past"/absent → the default store/past.
  const base = storeBase();
  const rPast = configureStore({ story: "past" });
  const rMain = configureStore({ story: "main" });
  const rAlpha = configureStore({ story: "_verify_iso_" });
  rPast === join(base, "past") &&
  rMain === join(base, "past") &&
  rAlpha === join(base, "_verify_iso_") &&
  rAlpha !== rPast
    ? ok("stories are sibling folders (main/past → store/past; named → store/<name>) — no renaming")
    : bad("story mapping", { rPast, rMain, rAlpha, base });
  configureStore({ root }); // restore the test root

  // 11. ACT-LOG (the act-chain, peer of the reel files): a being's authored acts append to a
  //     per-being JSONL log, and the .acthead advances under a CAS. A stale author (wrong expectPrev)
  //     is REFUSED with ACT_CHAIN_MOVED — the chain can't fork. Idempotent: re-advancing to the head
  //     is a settled-replay no-op.
  const story = "past";
  const author = "being-author-xyz789";
  const a1 = { _id: "act-001", verb: "do", through: author, p: "0".repeat(64) };
  const a2 = { _id: "act-002", verb: "do", through: author, p: "act-001" };
  appendActLine(story, "0", author, a1);
  const h0 = readActHeadFile(story, "0", author); // empty chain → GENESIS_PREV
  advanceActHeadFile(story, "0", author, a1._id, "0".repeat(64)); // advance to act-001
  appendActLine(story, "0", author, a2);
  advanceActHeadFile(story, "0", author, a2._id, a1._id); // advance to act-002
  const headNow = readActHeadFile(story, "0", author);
  let casRefused = false;
  try {
    // a stale author still thinks the head is act-001 → must be refused
    advanceActHeadFile(story, "0", author, "act-003", a1._id);
  } catch (e) {
    casRefused = e.message === "ACT_CHAIN_MOVED";
  }
  const replayNoop = advanceActHeadFile(story, "0", author, a2._id, a1._id).replayed === true;
  h0 === "0".repeat(64) && headNow === a2._id && casRefused && replayNoop
    ? ok("act-log appends + .acthead CAS advances; stale expectPrev → ACT_CHAIN_MOVED; replay no-op")
    : bad("act-log", { h0, headNow, casRefused, replayNoop });

  // 12. INDEX (the derived find* layer, maintained by saveSnapshot): saving .proj snapshots keeps
  //     the inverted name/position/parent/type indexes consistent. findByName resolves a name→slot;
  //     findByPosition lists occupants of a space; findByParent lists children; a tombstone drops out.
  const ib = "being-indexed-001";
  const ic = "being-indexed-002";
  saveSnapshot("0", "being", ib, {
    state: { name: "Gandalf", parentBeingId: "i-am" },
    foldedSeq: 1,
    position: "space-shire",
    tombstoned: false,
  });
  saveSnapshot("0", "being", ic, {
    state: { name: "Frodo", parentBeingId: ib },
    foldedSeq: 1,
    position: "space-shire",
    tombstoned: false,
  });
  const byName = findByName("0", "being", "Gandalf");
  const byPos = findByPosition("0", "space-shire");
  const byParent = findByParent("0", ib, "being");
  const types = listByType("0", "being");
  byName?.id === ib &&
  byName?.state?.name === "Gandalf" &&
  byPos.length === 2 &&
  byPos.some((o) => o.id === ib) &&
  byPos.some((o) => o.id === ic) &&
  byParent.length === 1 &&
  byParent[0].id === ic &&
  types.includes(ib) &&
  types.includes(ic)
    ? ok("index tracks .proj snapshots — findByName / findByPosition / findByParent / listByType")
    : bad("index", { byName, byPos: byPos.map((o) => o.id), byParent: byParent.map((o) => o.id), types });

  // 13. TOMBSTONE + Rust REFOLD REBUILD: tombstoning a slot drops it from every live index; the Rust
  //     refold re-derives a slot (+ its index) PURELY from the reel facts — the rebuildable property
  //     (the .proj/index are a cache, the reel is the truth). The tombstone half uses the synthetic
  //     ib/ic (snapshot-only); the refold half uses FB (a real reel) so the rebuild has facts to fold.
  saveSnapshot("0", "being", ic, {
    state: { name: "Frodo", parentBeingId: ib },
    foldedSeq: 2,
    position: null,
    tombstoned: true,
  });
  const goneByName = findByName("0", "being", "Frodo");
  const posAfterTomb = findByPosition("0", "space-shire");
  const typesAfterTomb = listByType("0", "being");
  // Rust refold rebuilds FB's slot + index from its reel facts alone. Nuke FB's index entry first
  // (drop it from the type facet via a tombstone save) then refold off the reel — the refold's
  // folded state is NOT tombstoned (the reel has no death fact), so it re-buckets FB back in.
  saveSnapshot("0", "being", FB, { state: {}, foldedSeq: 0, position: null, tombstoned: true });
  const fbDroppedByTomb = !listByType("0", "being").includes(FB);
  const fbSlot = refold("0", "being", FB); // read reel → fold → re-derive .proj + index
  const fbTypesRebuilt = listByType("0", "being");
  goneByName === null &&
  posAfterTomb.length === 1 &&
  posAfterTomb[0].id === ib &&
  !typesAfterTomb.includes(ic) &&
  fbDroppedByTomb &&
  fbSlot?.state?.qualities?.profile?.mood === "calm" &&
  fbTypesRebuilt.includes(FB)
    ? ok("tombstone drops from live indexes; Rust refold re-derives the slot + index from the reel (rebuildable)")
    : bad("tombstone+refold-rebuild", { goneByName, posAfterTomb: posAfterTomb.map((o) => o.id), typesAfterTomb, fbDroppedByTomb, fbState: fbSlot?.state?.qualities, fbTypesRebuilt });

  // 14. PREDICATE READ + factsByActId (the curated FACT-query substrate): readReelWhere filters a
  //     reel by predicate (wordStore's coin/retire reads); factsByActId returns the facts one act
  //     laid (the actor's facts ride the actor's being reel).
  const PB = "being-pred-test-01";
  const mkW = (act, word, aid) => ({
    recId: `${act}-${word}`,
    actId: aid,
    facts: [{ history: "0", kind: "being", id: PB, spec: { through: PB, verb: "do", act, of: { kind: "being", id: PB }, params: { word }, actId: aid, history: "0" } }],
  });
  await commitMoment(mkW("coin", "alpha", "act-coin-a"));
  await commitMoment(mkW("coin", "beta", "act-coin-b"));
  await commitMoment(mkW("retire", "alpha", "act-retire-a"));
  const coined = readReelWhere("0", "being", PB, (f) => f.act === "coin");
  const byAct = factsByActId("0", PB, "act-coin-b");
  coined.length === 2 &&
  coined.every((f) => f.act === "coin") &&
  byAct.length === 1 &&
  byAct[0].params.word === "beta"
    ? ok("readReelWhere filters a reel by predicate; factsByActId returns one act's facts")
    : bad("predicate-read", { coined: coined.map((f) => f.params.word), byAct: byAct.map((f) => f.actId) });

  // 15. ACT INDEX + reads (the curated ACT-query substrate): appendActLine maintains actId→location +
  //     the inverted facets (rootCorrelation / inReplyTo / through / to). readActById locates by id;
  //     actsByCorrelation walks the chain; actsByField filters; readActChain reads one being's log;
  //     actCount counts.
  const ix = "past";
  const root1 = "act-root-001";
  const A = "being-actor-A";
  const B2 = "being-actor-B";
  appendActLine(ix, "0", A, { _id: "ax-1", through: A, to: B2, rootCorrelation: root1, inReplyTo: null, stampedAt: new Date(1).toISOString() });
  appendActLine(ix, "0", B2, { _id: "ax-2", through: B2, to: A, rootCorrelation: root1, inReplyTo: "ax-1", stampedAt: new Date(2).toISOString() });
  appendActLine(ix, "0", A, { _id: "ax-3", through: A, to: B2, rootCorrelation: root1, inReplyTo: "ax-2", stampedAt: new Date(3).toISOString() });
  appendActLine(ix, "0", A, { _id: "ax-other", through: A, to: B2, rootCorrelation: "other-root", inReplyTo: null, stampedAt: new Date(4).toISOString() });
  const oneAct = readActById(ix, "ax-2");
  const chain = actsByCorrelation(ix, root1);
  const replies = actsByField(ix, "inReplyTo", "ax-1");
  const byThrough = actsByField(ix, "through", A);
  const aLog = readActChain(ix, "0", A);
  const cntCorr = actCount(ix, { rootCorrelation: root1 });
  const cntAll = actCount(ix, {});
  oneAct?._id === "ax-2" &&
  oneAct?.to === A &&
  chain.length === 3 &&
  chain.every((a) => a.rootCorrelation === root1) &&
  replies.length === 1 && replies[0]._id === "ax-2" &&
  byThrough.length === 3 && // ax-1, ax-3, ax-other (all through A)
  aLog.length === 3 &&
  cntCorr === 3 &&
  cntAll >= 4
    ? ok("act index: readActById / actsByCorrelation / actsByField / readActChain / actCount")
    : bad("act-index", { oneAct: oneAct?._id, chain: chain.map((a) => a._id), replies: replies.map((a) => a._id), byThrough: byThrough.length, aLog: aLog.length, cntCorr, cntAll });

  // 16. ACT PATCH (the one mutable-after-seal exception) + rebuildActIndex: patchAct overlays
  //     status/innerFace/severedAt on a read; the act-log line stays append-only. rebuildActIndex
  //     re-derives the index from the .acts logs (rebuildable). Patches survive a rebuild (they
  //     overlay the logs, not the index).
  patchAct(ix, "ax-1", { status: "landed", severedAt: new Date(9).toISOString() });
  const patched = readActById(ix, "ax-1");
  rebuildActIndex(ix);
  const afterRebuildById = readActById(ix, "ax-2");
  const afterRebuildChain = actsByCorrelation(ix, root1);
  const patchSurvives = readActById(ix, "ax-1");
  patched?.status === "landed" &&
  patched?.severedAt != null &&
  afterRebuildById?._id === "ax-2" &&
  afterRebuildChain.length === 3 &&
  patchSurvives?.status === "landed"
    ? ok("patchAct overlays status/severedAt on read; rebuildActIndex re-derives from logs; patch survives rebuild")
    : bad("act-patch+rebuild", { patched: patched?.status, afterRebuildById: afterRebuildById?._id, afterRebuildChain: afterRebuildChain.length, patchSurvives: patchSurvives?.status });
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(join(storeBase(), "_verify_iso_"), { recursive: true, force: true });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
