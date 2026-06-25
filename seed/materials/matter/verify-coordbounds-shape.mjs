#!/usr/bin/env node
// assertMatterCoordInBounds SHAPE gate — the regression for the closed silent-drop hole.
// A present-but-non-finite axis must REFUSE, never silently vanish from the sealed row
// (the clamp-lie in another coat). The shape-throw fires BEFORE any space lookup, so this
// is a pure unit test — no DB, no boot (the "evaluator first" methodology, like verify-cond).
//
// Mirrors the same hole move.word's z gate closes; this guards the shared canonical copy
// that create-matter (.word + JS) and set-matter all route through (matter/coordBounds.js).

import { assertMatterCoordInBounds, assertCoordWithinSize } from "./coordBounds.js";

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); };

// a matterDoc with NO spaceId → the size lookup is skipped, so only the SHAPE gate runs
// (the throw we're testing happens before any loadOrFold).
const noSpace = { spaceId: null };

console.log(`\n  verify-coordbounds-shape (the closed silent-drop hole)\n`);

const throws = async (label, raw, re) => {
  try {
    const out = await assertMatterCoordInBounds(noSpace, raw, "0");
    bad(`${label} — expected refuse, got`, out);
  } catch (e) {
    (e?.code && re.test(e.message || "")) ? ok(`${label} → refuse "${(e.message || "").slice(0, 44)}…"`)
      : bad(`${label} — wrong error`, e?.message || String(e));
  }
};
const yields = async (label, raw, want) => {
  try {
    const out = await assertMatterCoordInBounds(noSpace, raw, "0");
    JSON.stringify(out) === JSON.stringify(want) ? ok(`${label} → ${JSON.stringify(out)}`)
      : bad(`${label} (want ${JSON.stringify(want)}, got ${JSON.stringify(out)})`);
  } catch (e) { bad(`${label} — unexpected throw`, e?.message || String(e)); }
};

// ── the bug: a PRESENT but non-finite axis must refuse, not silently drop ──
await throws("z:'foo' (garbage z)            ", { x: 1, y: 1, z: "foo" }, /coord\.z.*finite number/i);
await throws("x:'foo' (garbage x)            ", { x: "foo", y: 1 }, /coord\.x.*finite number/i);
await throws("y:NaN                          ", { x: 1, y: NaN }, /coord\.y.*finite number/i);
await throws("z:Infinity                     ", { x: 1, y: 1, z: Infinity }, /coord\.z.*finite number/i);
await throws("x:{} (object, not a number)    ", { x: {}, y: 1 }, /coord\.x.*finite number/i);

// ── preserved: absent axes are a legit partial update (skip, never throw) ──
await yields("partial {x} (no y/z)           ", { x: 5 }, { x: 5 });
await yields("{x,y}, z undefined             ", { x: 5, y: 2, z: undefined }, { x: 5, y: 2 });
await yields("{x,y}, z:null (treated absent) ", { x: 5, y: 2, z: null }, { x: 5, y: 2 });
await yields("x:0 (finite, not falsy-dropped)", { x: 0, y: 0 }, { x: 0, y: 0 });
await yields("empty {} → null (no coord)     ", {}, null);

// ── assertCoordWithinSize: the ONE bounds-math copy (move + create-matter + set-matter ──
//    all call THIS). Proves the cell-vs-position semantics are RIGHT, not just preserved. ──
const SIZE = { x: 10, y: 10, z: 10 };
const inBounds = (label, coord) => {
  try { assertCoordWithinSize(coord, SIZE, { op: "move", noun: "container" }); ok(`${label} → in bounds`); }
  catch (e) { bad(`${label} — unexpected refuse`, e?.message || String(e)); }
};
const outBounds = (label, coord) => {
  try { assertCoordWithinSize(coord, SIZE, { op: "move", noun: "container" }); bad(`${label} — expected refuse, passed`); }
  catch (e) { (e?.code && /out of bounds/i.test(e.message || "")) ? ok(`${label} → refuse "${(e.message || "").slice(0, 38)}…"`) : bad(`${label} — wrong error`, e?.message); }
};
inBounds ("int cell 9 in size-10 (last cell) ", { x: 9, y: 9 });
outBounds("int cell 10 in size-10 (no cell)  ", { x: 10, y: 0 });
inBounds ("float 9.999 in size-10 (position) ", { x: 9.999, y: 0 });
inBounds ("float 0 (origin)                  ", { x: 0, y: 0 });
outBounds("float 10.0 in size-10 (the edge)  ", { x: 10.0, y: 0 }); // 10.0 is integer in JS → cell 10 → out
outBounds("negative -1                       ", { x: -1, y: 0 });
inBounds ("non-finite axis skipped (no throw)", { x: "foo", y: 5 }); // shape is gated upstream; helper skips non-finite
// an axis whose size has no positive cap is unbounded (the `cap === null` skip):
try {
  assertCoordWithinSize({ x: 9999 }, { x: 0 }, { op: "move", noun: "container" });
  ok("size cap 0 on x → x unbounded (skip)");
} catch (e) { bad("size cap 0 should not bound", e?.message); }
// a null size → no bounds at all (the early return):
try { assertCoordWithinSize({ x: 9999 }, null); ok("null size → no bounds (early return)"); }
catch (e) { bad("null size should not throw", e?.message); }

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
