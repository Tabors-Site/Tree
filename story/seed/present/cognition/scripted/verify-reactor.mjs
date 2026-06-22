#!/usr/bin/env node
// verify-reactor — the live reactive script being core (25.md Pillar D).
// The being WATCHES the face form but ACTS only on the FINISHED face:
// triggers are state-based (when(state)/then(state)), evaluated once on the
// `complete` item, over the whole accumulated state. Unit tests on
// createReactor (pure, synthetic items) + integration over a real trivial
// face. .env loaded so the innerFace import chain resolves; no Mongo at
// runtime (foldedFace supplied, empty canSee).
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
const { createReactor, runReactorOverFace, runReactorMoment } = await import("./reactor.js");
const { faceItems } = await import("../../stamper/2-fold/rasterStream.js");
const { reactorCall } = await import("./reactorCall.js");

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d) console.log(`      ${d}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const drive = (reactor, items) => { for (const it of items) reactor.consume(it); return reactor; };

console.log("\n  verify-reactor (live reactive script being core)\n");
try {
  // 1. on the FINISHED face, a trigger reading the seen blocks decides the do.
  {
    const r = createReactor([
      { when: (st) => st.seen.some((b) => b.label === "food"),
        then: (st) => ({ op: "eat", target: st.seen.find((b) => b.label === "food").key }) },
    ]);
    drive(r, [
      { kind: "position", value: { name: "field" } },
      { kind: "able", value: "forager" },
      { kind: "can", verb: "canDo", words: ["eat", "move"] },
      { kind: "see", block: { key: "m7", label: "food" } },
      { kind: "complete", face: {} },
    ]);
    r.acted && eq(r.decided, { op: "eat", target: "m7" })
      ? ok(`finished face -> trigger over seen blocks decides { op:eat, target:m7 }`)
      : bad(`see trigger`, JSON.stringify(r.decided));
  }

  // 2. the being acts ONLY on complete -- no decision before the face finishes.
  {
    const r = createReactor([{ when: (st) => st.able === "x", then: () => ({ op: "go" }) }]);
    r.consume({ kind: "able", value: "x" });
    const beforeComplete = r.acted;
    r.consume({ kind: "complete" });
    const afterComplete = r.acted;
    !beforeComplete && afterComplete
      ? ok(`decides ONLY on complete — no act before the rasterization finishes`)
      : bad(`act-on-complete`, `before=${beforeComplete} after=${afterComplete}`);
  }

  // 3. ONE do per moment: two matchable triggers, the FIRST wins.
  {
    const r = createReactor([
      { when: () => true, then: () => ({ op: "first" }) },
      { when: () => true, then: () => ({ op: "second" }) },
    ]);
    drive(r, [{ kind: "can", verb: "canDo", words: ["x"] }, { kind: "complete" }]);
    eq(r.decided, { op: "first" }) ? ok(`one do per moment — first matching trigger wins`) : bad(`one-do`, JSON.stringify(r.decided));
  }

  // 4. whole-face state: a trigger reads can + see + position together.
  {
    const r = createReactor([
      { when: (st) => st.can.canDo.includes("greet") && st.seen.some((b) => b.label === "a being"),
        then: (st) => ({ op: "greet", target: st.seen.find((b) => b.label === "a being").key, at: st.position?.name }) },
    ]);
    drive(r, [
      { kind: "position", value: { name: "plaza" } },
      { kind: "can", verb: "canDo", words: ["greet"] },
      { kind: "see", block: { key: "b9", label: "a being" } },
      { kind: "complete" },
    ]);
    r.acted && eq(r.decided, { op: "greet", target: "b9", at: "plaza" })
      ? ok(`whole-face state — trigger reads can + see + position at once`)
      : bad(`state`, JSON.stringify(r.decided));
  }

  // 5. nothing matches the finished face -> no act (a see-moment).
  {
    const r = createReactor([
      { when: (st) => st.seen.some((b) => b.label === "danger"), then: () => ({ op: "flee" }) },
    ]);
    drive(r, [{ kind: "able", value: "calm" }, { kind: "see", block: { key: "m1", label: "flower" } }, { kind: "complete" }]);
    !r.acted && r.decided == null ? ok(`no trigger matches the finished face -> see-moment (no act)`) : bad(`no-act`, JSON.stringify(r.decided));
  }

  // 6. a throwing trigger is a no-match (a script can't crash its own moment).
  {
    const r = createReactor([
      { when: () => { throw new Error("boom"); }, then: () => ({ op: "x" }) },
      { when: (st) => st.able === "r", then: () => ({ op: "safe" }) },
    ]);
    drive(r, [{ kind: "able", value: "r" }, { kind: "complete" }]);
    eq(r.decided, { op: "safe" }) ? ok(`a throwing trigger is treated as no-match (fault-isolated)`) : bad(`throw`, JSON.stringify(r.decided));
  }

  // 7. INTEGRATION: react over a REAL face from buildInnerFace (decides on its complete).
  {
    const able = { name: "walker", canDo: ["move"], canSummon: [], canBe: [], canSee: [] };
    const ctx = { orientation: "forward", beingId: "b1", history: "0",
                  foldedFace: { space: { _id: "s1", name: "home" }, _weave: [] } };
    const res = await runReactorOverFace(
      [{ when: (st) => st.can.canDo.includes("move"), then: (st) => ({ op: "move", from: st.position?.name }) }],
      able, ctx,
    );
    res.acted && res.act?.op === "move" && res.act?.from === "home"
      ? ok(`runReactorOverFace decides "move" over the finished face (canDo:move, position:home)`)
      : bad(`integration fire`, JSON.stringify(res.act));
    res.face && res.face.able === "walker" && res.state.can.canDo.includes("move")
      ? ok(`returns the completed face + accumulated state`)
      : bad(`integration state/face`, JSON.stringify({ able: res.face?.able, can: res.state?.can }));
  }

  // 8. INTEGRATION negative: a trigger that doesn't match the face -> see-moment.
  {
    const able = { name: "waiter", canDo: ["wait"], canSummon: [], canBe: [], canSee: [] };
    const ctx = { orientation: "forward", beingId: "b2", history: "0",
                  foldedFace: { space: { _id: "s2", name: "hall" }, _weave: [] } };
    const res = await runReactorOverFace(
      [{ when: (st) => st.can.canDo?.includes("move"), then: () => ({ op: "move" }) }],
      able, ctx,
    );
    !res.acted && res.act == null ? ok(`no trigger matches the live face -> see-moment`) : bad(`integration no-act`, JSON.stringify(res.act));
  }

  // 9. faceItems replays a completed face in the SAME order the live stream emits.
  {
    const items = faceItems({
      position: { name: "home" }, able: "r",
      capabilities: { canDo: ["move"], canSummon: [], canBe: ["x"] },
      blocks: [{ key: "k1", label: "L" }],
    });
    eq(items.map((i) => i.kind), ["position", "able", "can", "can", "see", "complete"])
      ? ok(`faceItems order = position, able, can(canDo), can(canBe), see, complete (canSummon dropped)`)
      : bad(`faceItems order`, items.map((i) => i.kind).join(","));
    items.every((it, i) => it.seq === i) ? ok(`faceItems seq monotonic`) : bad(`faceItems seq`, items.map((i) => i.seq).join(","));
  }

  // 10. runReactorMoment over moment.innerFace: non-firing trigger -> see (boot-free, no dispatch).
  {
    const moment = {
      innerFace: { position: { name: "hall" }, able: "waiter", capabilities: { canDo: ["wait"] }, blocks: [] },
      deltaF: [],
    };
    const out = await runReactorMoment(
      [{ when: (st) => st.can.canDo?.includes("move"), then: () => "do move." }],
      { able: { name: "waiter" }, moment, beingId: "b1", username: "waiter" },
    );
    out?.kind === "see" ? ok(`runReactorMoment: no trigger matches the face -> see (no dispatch)`) : bad(`runReactorMoment see`, JSON.stringify(out));
  }

  // 11. reactorCall routes a reactor able's no-fire moment to a see (the dispatch path is wired).
  {
    const ctx = {
      toBeing: { _id: "b1", name: "waiter" },
      innerFace: { position: { name: "hall" }, able: "waiter", capabilities: { canDo: ["wait"] }, blocks: [] },
      deltaF: [], actorAct: { history: "0" },
    };
    const able = { name: "waiter", triggers: [{ when: (st) => st.can.canDo?.includes("move"), then: () => "do move." }] };
    const out = await reactorCall({ message: {}, ctx, able });
    out?.kind === "see" ? ok(`reactorCall: reactor able called, no trigger -> see (dispatch wired)`) : bad(`reactorCall`, JSON.stringify(out));
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
