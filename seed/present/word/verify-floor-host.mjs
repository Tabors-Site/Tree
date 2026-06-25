#!/usr/bin/env node
// verify-floor-host — the P4 floor-host wiring: a .word's `If <caller> has authority over <target>:`
// cond resolves LIVE off the real being-tree, via the SHARED floor (floorHostEnv) that every .word
// runner merges UNDER the caller's env.host (ableWordRegistry._withFloorHost). The authority WALK
// (inheritation.js hasAuthorityOver) gates the branch:
//   * a caller WITH authority over the target → the cond is TRUE → the THEN branch runs;
//   * a caller WITHOUT authority → the cond is FALSE → the ELSE branch runs.
//
// The branch CHOICE is auditable: runWordToStore is per-act-moment, so evalIf lays a do:if fact
// carrying params.taken ("then" | "else") — the LIVE walk's verdict, on the chain. This verifier:
//   1. the PARSER lifts `<caller> has authority over <target>` → {resolvedBy:hasAuthorityOver, args}
//      (not a fail-closed bare clause) — the build fix that makes the floor reachable from prose;
//   2. an OWNER-Name caller (real authority over the target) → the THEN branch (do:if taken=then);
//   3. a STRANGER-Name caller (no authority) → the ELSE branch (do:if taken=else);
//   4. the SAME .word, the SAME runner, the ONLY difference the bound caller → the floor resolves
//      LIVE both ways (proving the inheritation walk, not a constant, gates the branch).
//
// Mirrors verify-cherub-cut's boot boilerplate (scratch file store, fresh key dir, begin.js,
// poll findByName cherub on "0"). UNIQUE port 3862 + store story_floorhost. Filters Mirror/ENOTCONN noise.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_floorhost-" + process.pid);
process.env.PORT = "3862";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "floorhost-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "floorhost-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "floorhost-src");
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
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);
const { runWordToStore } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { factFind, factCount } = await import(
  `${R}/seed/present/word/_factStoreTest.mjs`
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

const cherub = await poll(() => findByName("being", "cherub", "0"));

// declare a Name (a real soul Name the being-tree walk recognizes as an owner)
const declName = async (name) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: { beingId: "i-am", name: "I", nameId: "i-am" },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  const r = await nameVerb(
    "declare",
    { name, password: "pw12345678", soulType: "human" },
    { identity: sc.identity, moment: sc, currentHistory: "0" },
  );
  await sealFacts(sc.deltaF);
  return r.nameId;
};

// birth a being OWNED by a given Name (trueName = the owner). hasAuthorityOver(trueName, being) = true.
const birth = async (name, trueName) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({
      spec: {
        name,
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
        ...(trueName ? { trueName } : {}),
      },
      identity: I,
      moment: ctx,
      history: "0",
    });
    bid = b.beingId;
  });
  return bid;
};

// THE .word under test: a gate flow whose ONLY branch predicate is the authority walk. Running it
// per-act-moment lays a do:if fact carrying which branch the LIVE walk selected (params.taken).
const WORD = `When a being checks a target:
  If the caller has authority over the target:
    Return verdict: "held".
  Otherwise:
    Return verdict: "free".`;

// run the .word LIVE (the spacebar runner merges floorHostEnv under env.host), binding the caller +
// target the cond reads. Return BOTH the do:if fact's `taken` (the live walk's branch verdict, on the
// chain) AND the §7 return's verdict (what the taken branch produced) for THIS run.
const runFor = async (caller, target, tag) => {
  const before = factCount({ verb: "do", act: "if" });
  const { result } = await runWordToStore(parse(WORD), {
    beingId: String(target), // a real being acts as the moment's signer (any seated being)
    name: null,
    history: "0",
    bindings: { caller: String(caller), target: String(target) },
  });
  // the most recent do:if fact (this run's branch verdict) — sort({ seq: -1 }), take the head
  const f = factFind({ verb: "do", act: "if", history: "0" }).reduce(
    (best, c) => (best == null || (c.seq ?? 0) > (best.seq ?? 0) ? c : best),
    null,
  );
  const after = factCount({ verb: "do", act: "if" });
  return {
    taken: f?.params?.taken ?? null,
    verdict: result?.verdict ?? null,
    laidNew: after > before,
    tag,
  };
};

console.log(
  `\n  verify-floor-host (If <caller> has authority over <target>: resolves LIVE via floorHostEnv)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed (no cherub)");
    process.exit(1);
  }

  // ── 1. the PARSER lifts the authority clause to a resolvedBy (not a fail-closed bare clause) ──
  const ir = parse(WORD);
  const ifNode = (ir[0]?.effects || []).find((n) => n.kind === "if");
  const cond = ifNode?.cond;
  cond &&
  cond.resolvedBy === "hasAuthorityOver" &&
  Array.isArray(cond.args) &&
  cond.args[0]?.ref === "caller" &&
  cond.args[1]?.ref === "target"
    ? ok(
        `(1) parser lifts "<caller> has authority over <target>" → {resolvedBy:hasAuthorityOver, args:[caller,target]} (reaches the floor, not a fail-closed clause)`,
      )
    : bad(`(1) authority cond not lifted to resolvedBy`, cond);

  // a real authority pair: a being OWNED by ownerName, and a STRANGER Name with no relation to it
  const ownerName = await declName("owner-name");
  const strangerName = await declName("stranger-name");
  const target = await birth("subject", ownerName);
  const slot = await loadOrFold("being", String(target), "0");
  String(slot?.state?.trueName) === String(ownerName)
    ? ok(`@subject is owned by owner-name (trueName = owner-name)`)
    : bad(`trueName`, slot?.state?.trueName);

  // ── 2. an OWNER caller (real authority) → the THEN branch ──
  const held = await runFor(ownerName, target, "owner");
  held.laidNew && held.taken === "then" && held.verdict === "held"
    ? ok(
        `(2) caller=owner-name (HAS authority) → the THEN branch (do:if taken="then", verdict="held") — the live walk said yes`,
      )
    : bad(`(2) owner did not take THEN`, held);

  // ── 3. a STRANGER caller (no authority) → the ELSE branch ──
  const free = await runFor(strangerName, target, "stranger");
  free.laidNew && free.taken === "else" && free.verdict === "free"
    ? ok(
        `(3) caller=stranger-name (NO authority) → the ELSE branch (do:if taken="else", verdict="free") — the live walk said no`,
      )
    : bad(`(3) stranger did not take ELSE`, free);

  // ── 4. I (universal authority) → the THEN branch (the bootstrap axiom flows through the walk) ──
  const iam = await runFor("i-am", target, "i-am");
  iam.laidNew && iam.taken === "then" && iam.verdict === "held"
    ? ok(
        `(4) caller=I (universal authority) → the THEN branch — same .word, same runner, only the bound caller differs (the floor resolves LIVE both ways)`,
      )
    : bad(`(4) I did not take THEN`, iam);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
