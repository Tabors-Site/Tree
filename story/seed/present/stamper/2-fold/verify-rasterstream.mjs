#!/usr/bin/env node
// verify-rasterstream — the live-rasterization core (25.md Pillar D).
// Boot-free at runtime: pure module logic + one buildInnerFace integration
// with a trivial able (explicit string caps, empty canSee, a folded face
// supplied = no store read). The innerFace import chain wants JWT_SECRET
// at load, so we read .env and dynamic-import it after.
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import {
  onRaster, offRaster, streamRasterFace, hasRasterSubscribers, _resetRaster,
} from "./rasterStream.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storyRoot = path.resolve(__dirname, "../../../..");
try {
  for (const line of fs.readFileSync(path.resolve(storyRoot, ".env"), "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i === -1) continue;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (v && !process.env[k]) process.env[k] = v;
  }
} catch {}
const { buildInnerFace } = await import("./innerFace.js");

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d) console.log(`      ${d}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\n  verify-rasterstream (live rasterization core)\n");

try {
  // 1. ordered emission: self -> caps -> world -> complete, seq monotonic.
  _resetRaster();
  const got = [];
  const un = onRaster("b1", (it) => got.push(it));
  streamRasterFace("b1", {
    able: "coder",
    position: { id: "s1", name: "home" },
    capabilities: { canDo: ["move", "look"], canSummon: [], canBe: ["birth"] },
    blocks: [{ key: "k1", source: "see", label: "L1", payload: 1 }, { key: "k2", source: "address", label: "L2", payload: 2 }],
    face: { tag: "FACE" },
  });
  const kinds = got.map((i) => i.kind);
  eq(kinds, ["position", "able", "can", "can", "see", "see", "complete"])
    ? ok(`order: position -> able -> can(canDo) -> can(canBe) -> see -> see -> complete`)
    : bad(`order`, kinds.join(","));
  got.every((it, i) => it.seq === i)
    ? ok(`seq is monotonic 0..${got.length - 1}`)
    : bad(`seq monotonic`, got.map((i) => i.seq).join(","));
  // empty canSummon dropped; canDo before canBe
  const cans = got.filter((i) => i.kind === "can").map((i) => i.verb);
  eq(cans, ["canDo", "canBe"]) ? ok(`empty capability verbs dropped (canSummon absent)`) : bad(`caps`, cans.join(","));
  const complete = got.find((i) => i.kind === "complete");
  complete && eq(complete.face, { tag: "FACE" }) ? ok(`complete carries the assembled face`) : bad(`complete.face`, JSON.stringify(complete));
  const seeBlocks = got.filter((i) => i.kind === "see");
  seeBlocks.length === 2 && seeBlocks[0].block.key === "k1" && seeBlocks[1].block.key === "k2"
    ? ok(`one "see" item per canSee block, in order`)
    : bad(`see blocks`, JSON.stringify(seeBlocks.map((s) => s.block?.key)));

  // 2. unsubscribe stops delivery.
  un();
  const before = got.length;
  streamRasterFace("b1", { able: "x", position: null, capabilities: {}, blocks: [], face: {} });
  got.length === before ? ok(`unsubscribe stops delivery`) : bad(`unsubscribe`, `${got.length} vs ${before}`);

  // 3. zero-cost when nobody watches.
  _resetRaster();
  !hasRasterSubscribers("bX") ? ok(`hasRasterSubscribers false when nobody watches`) : bad(`hasSubs`, "expected false");
  let touched = false;
  streamRasterFace("bX", { get able() { touched = true; return "x"; }, position: null, capabilities: {}, blocks: [], face: {} });
  !touched ? ok(`streamRasterFace is a no-op with no subscribers (zero work)`) : bad(`zero-cost`, "accessed parts with no subs");

  // 4. watch-all "*" receives every being's items, tagged with beingId.
  _resetRaster();
  const all = [];
  onRaster("*", (it) => all.push(it));
  hasRasterSubscribers("bZ") ? ok(`"*" makes hasRasterSubscribers true for any being`) : bad(`watch-all hasSubs`, "expected true");
  streamRasterFace("bZ", { able: "r", position: null, capabilities: {}, blocks: [], face: { f: 1 } });
  all.length === 3 && all.every((i) => i.beingId === "bZ")
    ? ok(`watch-all sees position/able/complete tagged beingId=bZ`)
    : bad(`watch-all`, JSON.stringify(all.map((i) => [i.kind, i.beingId])));

  // 5. INTEGRATION: buildInnerFace streams the same face it returns.
  _resetRaster();
  const able = { name: "tester", canDo: ["move", "look"], canSummon: [], canBe: [], canSee: [] };
  const ctx = {
    orientation: "forward",
    beingId: "b1",
    history: "0",
    foldedFace: { space: { _id: "s1", name: "home" }, _weave: [] },
  };
  // baseline: no subscriber -> the face is whatever it is, and nothing streamed.
  const baseline = [];
  // subscribe THEN build.
  onRaster("b1", (it) => baseline.push(it));
  const face = await buildInnerFace(able, ctx);
  const streamedKinds = baseline.map((i) => i.kind);
  eq(streamedKinds, ["position", "able", "can", "complete"])
    ? ok(`buildInnerFace streamed: position, able, can(canDo), complete`)
    : bad(`integration order`, streamedKinds.join(","));
  const pos = baseline.find((i) => i.kind === "position");
  pos && pos.value && pos.value.name === "home" ? ok(`streamed position = the folded space (home)`) : bad(`position`, JSON.stringify(pos));
  const canDo = baseline.find((i) => i.kind === "can" && i.verb === "canDo");
  canDo && eq(canDo.words, ["move", "look"]) ? ok(`streamed canDo = [move, look]`) : bad(`canDo`, JSON.stringify(canDo));
  const comp = baseline.find((i) => i.kind === "complete");
  comp && eq(comp.face, face)
    ? ok(`complete.face deep-equals the face buildInnerFace returned (no divergence)`)
    : bad(`complete === returned face`, "diverged");

  // 6. no subscriber -> buildInnerFace returns an identical face, streams nothing.
  _resetRaster();
  const noSub = [];
  // (no onRaster call)
  const face2 = await buildInnerFace(able, ctx);
  eq(face2, face) && noSub.length === 0
    ? ok(`unwatched buildInnerFace returns the same face, streams nothing (behavior unchanged)`)
    : bad(`unwatched`, "face differs or streamed");

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
