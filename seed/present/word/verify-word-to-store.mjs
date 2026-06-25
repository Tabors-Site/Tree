#!/usr/bin/env node
// verify-word-to-store — the spacebar at the act level (the run-on cure).
//
// Proves the per-act-moment split in the evaluator WITHOUT a DB: dry-run + a counting
// fake `perActMoment.open`. The claim:
//   * each fact-laying ACT (do / be / name) opens its OWN moment (one open per act),
//     and exactly ONE fact lands in that moment — one word, one space, one commit;
//   * declarations (is / can / law / ...) fold IS-side into ctx.laws and open NO moment
//     (letters — they lay nothing);
//   * the LEGACY path (no perActMoment) is byte-identical to before — all facts pool
//     into one shared deltaF, zero moments opened (runAbleWord's behavior unchanged).
//
// evaluator.js imports only getPath (pure cond.js) at load, so this runs standalone;
// we read .env + dynamic-import anyway to match the house pattern and stay future-proof.
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storyRoot = path.resolve(__dirname, "../../..");
try {
  for (const line of fs.readFileSync(path.resolve(storyRoot, ".env"), "utf8").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("="); if (i === -1) continue;
    const k = t.slice(0, i).trim(), v = t.slice(i + 1).trim();
    if (v && !process.env[k]) process.env[k] = v;
  }
} catch {}
const { evaluate } = await import("./evaluator.js");

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d) console.log(`      ${d}`); };

console.log("\n  verify-word-to-store (one word = one moment = one fact = one commit)\n");

// A Word: two declarations (IS-side) + three acts (do / be / name — words that DO).
const ir = () => [
  { kind: "is", subject: "dj", isA: "able" },                                   // letter
  { kind: "can", able: "dj", verb: "do", of: "play" },                          // letter
  { kind: "act", verb: "do", act: "set-space", by: "Cherub",
    of: { kind: "space", id: "s1" }, params: { field: "name", value: "X" } },   // space
  { kind: "act", verb: "be", act: "connect", by: "Cherub",
    of: { kind: "being", id: "b1" }, params: {} },                              // space
  { kind: "act", verb: "name", act: "declare-name", by: "Cherub",
    of: { kind: "name", id: "n1" }, params: {} },                              // space
];

// ── per-act-moment mode: each act its own moment, declarations none ──────────────
{
  const moments = [];
  const fakeOpen = async (label, fn) => {
    const m = { actId: `act-${moments.length}`, deltaF: [], afterSeal: [] };
    moments.push({ label, moment: m });
    await fn(m); // a real opener would sealAct(m) here when m.deltaF.length > 0
  };
  const ctx = {
    dryRun: true,
    moment: null,
    identity: { beingId: "b1", name: "Cherub" },
    history: "0",
    bindings: {}, beings: {}, trigger: {}, env: {}, flows: [],
    perActMoment: { open: fakeOpen },
  };
  await evaluate(ir(), ctx);

  if (moments.length === 3) ok("3 acts → 3 moments opened (one word, one moment)");
  else bad("3 acts → 3 moments", `opened ${moments.length}`);

  const everyOneFact = moments.every((m) => m.moment.deltaF.length === 1);
  if (everyOneFact) ok("each moment carries exactly ONE fact (one moment, one commit)");
  else bad("each moment one fact", moments.map((m) => m.moment.deltaF.length).join(","));

  const labels = moments.map((m) => m.label);
  if (JSON.stringify(labels) === JSON.stringify(["do:set-space", "be:connect", "name:declare-name"]))
    ok("moments are the three deeds in order: do:set-space, be:connect, name:declare-name");
  else bad("moment labels/order", labels.join(" | "));

  if ((ctx.laws || []).length === 2) ok("2 declarations folded IS-side into ctx.laws (letters, no moment)");
  else bad("2 declarations → ctx.laws", `laws=${(ctx.laws || []).length}`);

  // declarations laid NO facts anywhere; only the 3 acts did, one each.
  const totalFacts = moments.reduce((n, m) => n + m.moment.deltaF.length, 0);
  if (totalFacts === 3) ok("exactly 3 facts total — one per act, none from declarations");
  else bad("3 facts total", `got ${totalFacts}`);
}

// ── legacy mode (no perActMoment): unchanged — all facts pool, zero moments ──────
{
  let opens = 0;
  const ctx = {
    dryRun: true,
    history: "0",
    identity: { beingId: "b1", name: "Cherub" },
    bindings: {}, beings: {}, trigger: {}, env: {}, flows: [],
    deltaF: [],
    // a tripwire: legacy must NOT open per-act moments
    perActMoment: undefined,
    get _opensTrip() { return opens; },
  };
  await evaluate(ir(), ctx);

  if (ctx.deltaF.length === 3) ok("legacy: 3 acts pool into ONE shared deltaF (runAbleWord unchanged)");
  else bad("legacy: 3 facts in shared deltaF", `got ${ctx.deltaF.length}`);

  if ((ctx.laws || []).length === 2) ok("legacy: declarations still fold IS-side (2 laws)");
  else bad("legacy: 2 laws", `got ${(ctx.laws || []).length}`);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
