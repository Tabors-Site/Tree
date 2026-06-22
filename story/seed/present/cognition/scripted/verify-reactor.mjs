#!/usr/bin/env node
// verify-reactor — the live reactive script being core (25.md Pillar D).
// Unit tests on createReactor (pure, synthetic items) + one integration
// over a real trivial face. .env loaded so the innerFace import chain
// resolves; no Mongo at runtime (foldedFace supplied, empty canSee).
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";

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
const { createReactor, runReactorOverFace } = await import("./reactor.js");

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d) console.log(`      ${d}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// helper: drive a reactor through a list of synthetic items
const drive = (reactor, items) => { for (const it of items) reactor.consume(it); return reactor; };

console.log("\n  verify-reactor (live reactive script being core)\n");
try {
  // 1. a "see"-block trigger fires the instant the block lands, decides the do.
  {
    const r = createReactor([
      { when: (it) => it.kind === "see" && it.block?.label === "food",
        then: (it) => ({ op: "eat", target: it.block.key }) },
    ]);
    drive(r, [
      { seq: 0, kind: "position", value: { name: "field" } },
      { seq: 1, kind: "role", value: "forager" },
      { seq: 2, kind: "can", verb: "canDo", words: ["eat", "move"] },
      { seq: 3, kind: "see", block: { key: "m7", label: "food" } },
      { seq: 4, kind: "complete", face: {} },
    ]);
    r.acted && eq(r.decided, { op: "eat", target: "m7" })
      ? ok(`fires on the matching see-block -> { op:eat, target:m7 }`)
      : bad(`see trigger`, JSON.stringify(r.decided));
  }

  // 2. ONE do per moment: two matchable triggers, the FIRST wins.
  {
    const r = createReactor([
      { when: (it) => it.kind === "can", then: () => ({ op: "first" }) },
      { when: (it) => it.kind === "can", then: () => ({ op: "second" }) },
    ]);
    drive(r, [
      { seq: 0, kind: "can", verb: "canDo", words: ["x"] },
      { seq: 1, kind: "can", verb: "canBe", words: ["y"] },
      { seq: 2, kind: "complete" },
    ]);
    eq(r.decided, { op: "first" }) ? ok(`one do per moment — first trigger wins, later items ignored`) : bad(`one-do`, JSON.stringify(r.decided));
  }

  // 3. state accumulates: a later trigger reads what earlier items established.
  {
    const r = createReactor([
      { when: (it, st) => it.kind === "see" && st.can.canDo.includes("greet"),
        then: (it, st) => ({ op: "greet", target: it.block.key, at: st.position?.name }) },
    ]);
    drive(r, [
      { seq: 0, kind: "position", value: { name: "plaza" } },
      { seq: 1, kind: "can", verb: "canDo", words: ["greet"] },
      { seq: 2, kind: "see", block: { key: "b9", label: "a being" } },
      { seq: 3, kind: "complete" },
    ]);
    r.acted && eq(r.decided, { op: "greet", target: "b9", at: "plaza" })
      ? ok(`state accumulates — trigger reads earlier can + position`)
      : bad(`state`, JSON.stringify(r.decided));
  }

  // 4. nothing matches -> no act (a see-moment), and `complete` never fires.
  {
    const r = createReactor([
      { when: (it) => it.kind === "see" && it.block?.label === "danger", then: () => ({ op: "flee" }) },
      { when: (it) => it.kind === "complete", then: () => ({ op: "should-never-fire" }) },
    ]);
    drive(r, [
      { seq: 0, kind: "role", value: "calm" },
      { seq: 1, kind: "see", block: { key: "m1", label: "flower" } },
      { seq: 2, kind: "complete" },
    ]);
    !r.acted && r.decided == null ? ok(`no match -> see-moment (no act); complete never fires a trigger`) : bad(`no-act`, JSON.stringify(r.decided));
  }

  // 5. a throwing trigger is a no-match (a script can't crash its own moment).
  {
    const r = createReactor([
      { when: () => { throw new Error("boom"); }, then: () => ({ op: "x" }) },
      { when: (it) => it.kind === "role", then: () => ({ op: "safe" }) },
    ]);
    drive(r, [{ seq: 0, kind: "role", value: "r" }, { seq: 1, kind: "complete" }]);
    eq(r.decided, { op: "safe" }) ? ok(`a throwing trigger is treated as no-match (fault-isolated)`) : bad(`throw`, JSON.stringify(r.decided));
  }

  // 6. INTEGRATION: react over a REAL forming face from buildInnerFace.
  {
    const role = { name: "walker", canDo: ["move"], canSummon: [], canBe: [], canSee: [] };
    const ctx = { orientation: "forward", beingId: "b1", history: "0",
                  foldedFace: { space: { _id: "s1", name: "home" }, _weave: [] } };
    const res = await runReactorOverFace(
      [{ when: (it) => it.kind === "can" && it.verb === "canDo" && it.words.includes("move"),
         then: (it, st) => ({ op: "move", from: st.position?.name }) }],
      role, ctx,
    );
    res.acted && res.act?.op === "move" && res.act?.from === "home"
      ? ok(`runReactorOverFace fires "move" over the live face (saw canDo:move, position:home)`)
      : bad(`integration fire`, JSON.stringify(res.act));
    res.face && res.face.role === "walker" && res.state.can.canDo.includes("move")
      ? ok(`returns the completed face + accumulated state`)
      : bad(`integration state/face`, JSON.stringify({ role: res.face?.role, can: res.state?.can }));
  }

  // 7. INTEGRATION negative: a trigger that doesn't match -> see-moment.
  {
    const role = { name: "waiter", canDo: ["wait"], canSummon: [], canBe: [], canSee: [] };
    const ctx = { orientation: "forward", beingId: "b2", history: "0",
                  foldedFace: { space: { _id: "s2", name: "hall" }, _weave: [] } };
    const res = await runReactorOverFace(
      [{ when: (it) => it.kind === "can" && it.words?.includes("move"), then: () => ({ op: "move" }) }],
      role, ctx,
    );
    !res.acted && res.act == null ? ok(`no trigger matches the live face -> see-moment`) : bad(`integration no-act`, JSON.stringify(res.act));
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
