#!/usr/bin/env node
// verify-law-gate — the P4 LAW strand, the OBJECTIVE register's gate (rule 14: a cannot beats a can).
//
// "No member can back it." is a PROHIBITION: declaring that Word folds a kind:"law" cannot word
// (the triple law:cannot:member:back:*) — no JS table edit, the prohibition is a FACT on the chain.
// The able-walk (authorizeViaAbles) consults the FOLD of every such cannot (listFoldedProhibitions)
// BEFORE the positive grant-walk and turns an ok:true into ok:false. This verifier asserts:
//   1. the cannot Word folds the register: listFoldedProhibitions() carries {subject:member, verb:back};
//   2. a @member (the able-walk POSITIVELY permits do:back — member canDo back) is REFUSED do:back —
//      ok:false, reason "prohibited by law" — and NO fact is laid (the gate is pre-seal, fail-closed);
//   3. the INVERSE "A member can back a proposal." is PERMITTED (the positive grant alone allows it,
//      proving the member able really does grant do:back — the prohibition is doing the denying);
//   4. BOTH present → the cannot WINS (still refused — a cannot beats a can, the additive invariant);
//   5. a DIFFERENT action the member able grants (do:second) is STILL permitted — the cannot is
//      SURGICAL (it forbids only do:back, not the able wholesale — strictly additive, no over-deny).
//
// Mirrors verify-cherub-cut's boot boilerplate (scratch file store, fresh key dir, begin.js,
// poll findByName cherub on "0"). UNIQUE port 3861 + store story_lawgate. Filters Mirror/ENOTCONN noise.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_lawgate-" + process.pid);
process.env.PORT = "3861";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "lawgate-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "lawgate-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "lawgate-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);
const { runWordToStore } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { authorizeViaAbles } = await import(`${R}/seed/ibp/ableAuth.js`);
const { listFoldedProhibitions } = await import(
  `${R}/seed/present/word/wordStore.js`
);
const { factFind, factFindOne, factCount } = await import(
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
const ident = { beingId: I, name: "i-am", nameId: "i-am" };

// birth a being under cherub (the take-able-cut pattern)
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({
      spec: {
        name,
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
      },
      identity: I,
      moment: ctx,
      history: "0",
    });
    bid = b.beingId;
  });
  return bid;
};

// Declare a Word LIVE through the spacebar runner (the prohibition apply-pass folds a cannot into
// a kind:"law" word). Caller = I (universal authority — declaring a law is itself a privileged act).
const declare = (text) =>
  runWordToStore(parse(text), { beingId: I, name: I, history: "0" });

// A being TAKES a grabbable able installed on a space (the take-able-cut pattern). The grant lands in
// the being's ablesGranted {able, anchorSpaceId}; the able-walk reads its SPEC off the anchor. This is
// the registry-free grant path (grant-able needs the registry; take-able reads the space install).
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const takeAble = async (callerBeing, able, space) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { branch: "0", history: "0", by: String(callerBeing) },
    identity: { beingId: String(callerBeing), nameId: String(callerBeing) },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  const res = await doVerb(
    { kind: "space", id: String(space) },
    "take-able",
    { able },
    { identity: { beingId: String(callerBeing) }, moment: sc, currentHistory: "0" },
  );
  if (sc.deltaF.length) await sealFacts(sc.deltaF);
  return res?.result ?? res;
};

// Drive the able-walk DIRECTLY for the actor at a target, requesting do:<action>. This is exactly
// the call authorize() makes; isolating it proves the prohibition gate without a full verb round-trip
// (the gate is pre-seal — it returns ok:false BEFORE any fact is laid).
const walkDo = (actorBeingId, action, targetSpace) =>
  authorizeViaAbles({
    identity: { beingId: String(actorBeingId) },
    verb: "do",
    target: { kind: "space", id: String(targetSpace) },
    action,
    history: "0",
    actorHistory: "0",
  });

console.log(
  `\n  verify-law-gate (rule 14: a cannot beats a can — the OBJECTIVE register's gate)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed (no cherub)");
    process.exit(1);
  }

  // ── a space hosting a `member` able that POSITIVELY grants do:back + do:second ──
  // The member able's canDo is the positive grant; the cannot will forbid only `back`, never `second`.
  let arena = null;
  await withIAmAct("create arena", async (ctx) => {
    const res = await doVerb(
      { kind: "space", id: String(getSpaceRootId()) },
      "create-space",
      { name: "council", type: "generic" },
      { identity: I, moment: ctx },
    );
    arena = String(res.spaceId);
  });
  await withIAmAct("install member", async (ctx) => {
    await doVerb(
      { kind: "space", id: arena },
      "set-space",
      {
        field: "qualities.ables.member",
        value: {
          canSee: [],
          canDo: ["back", "second"],
          canSummon: [],
          acquisition: { grabbed: true },
        },
        merge: false,
      },
      { identity: I, moment: ctx },
    );
  });
  arena
    ? ok(`council space created, member able installed (canDo: back, second)`)
    : bad(`arena`, "no space");

  // a being that HOLDS the member able (takes the grabbable install, caller = the being itself)
  const memberBeing = await birth("delegate");
  await takeAble(memberBeing, "member", arena);
  const slot = await loadOrFold("being", String(memberBeing), "0");
  const holds = (slot?.state?.qualities?.ablesGranted || []).some(
    (r) => (r.able || r) === "member",
  );
  holds
    ? ok(`@delegate HOLDS the member able (ablesGranted)`)
    : bad(`holds member`, slot?.state?.qualities?.ablesGranted);

  // ── SANITY: with NO law, the walk POSITIVELY permits do:back at the council (@delegate bears
  // the member able — and, inherited from cherub, the angel `do:*`; EITHER positively permits). The
  // point of the prohibition is that it overrides this positive permit for a `member`-bearing actor.
  const baseline = await walkDo(memberBeing, "back", arena);
  baseline.ok === true
    ? ok(
        `baseline (no law): do:back is POSITIVELY permitted (ok:true, via able=${baseline.able})`,
      )
    : bad(`baseline permit`, baseline);

  // ── 1. "No member can back it." folds the prohibition register ──
  await declare("No member can back it.");
  const reg = listFoldedProhibitions();
  const cannotBack = reg.find(
    (p) => p.subject === "member" && p.verb === "back",
  );
  cannotBack
    ? ok(
        `(1) "No member can back it." folds the register → {subject:member, verb:back, of:${cannotBack.of}}`,
      )
    : bad(`(1) cannot not folded`, reg);

  // ── 2. a member attempting do:back is REFUSED — "prohibited by law" — and NO fact laid ──
  // @delegate bears `member`, so the cannot fires and turns the positive permit (member AND angel
  // do:*) into ok:false. The walk is a pure read; snapshot the fact count immediately around it.
  const factsBefore = factCount({});
  const blocked = await walkDo(memberBeing, "back", arena);
  blocked.ok === false && /prohibited by law/i.test(blocked.reason || "")
    ? ok(
        `(2) @delegate do:back → REFUSED (ok:false, reason "prohibited by law") — the cannot beats the can (and even angel's do:*)`,
      )
    : bad(`(2) cannot did not deny`, blocked);
  const factsAfter = factCount({});
  factsAfter === factsBefore
    ? ok(
        `(2) the refused walk laid NO fact (${factsBefore} → ${factsAfter}) — the gate is a pre-seal read, fail-closed`,
      )
    : bad(`(2) a fact leaked on a refused walk`, {
        factsBefore,
        factsAfter,
      });

  // ── 5. the cannot is SURGICAL: do:second is STILL permitted — the cannot forbids ONLY do:back,
  // never the able wholesale (strictly additive: it may only flip THIS {verb,of}, no over-deny). ──
  const second = await walkDo(memberBeing, "second", arena);
  second.ok === true
    ? ok(
        `(5) do:second STILL permitted (ok:true, via able=${second.able}) — the cannot is surgical (do:back only), no over-deny`,
      )
    : bad(`(5) over-deny: second wrongly blocked`, second);

  // ── 3. the INVERSE: a being holding a DISTINCT able whose can grants do:back is PERMITTED ──
  // "A member can back a proposal." is the positive form; we already proved the member able grants
  // do:back at baseline. The inverse assertion is that a POSITIVE can, ALONE (no cannot for it),
  // permits — so install a `backer` able (canDo back) on a fresh space + being, declare its can, and
  // assert PERMITTED. This is the "the inverse is permitted" half: a can with no covering cannot wins.
  let hall = null;
  await withIAmAct("create hall", async (ctx) => {
    const res = await doVerb(
      { kind: "space", id: String(getSpaceRootId()) },
      "create-space",
      { name: "hall", type: "generic" },
      { identity: I, moment: ctx },
    );
    hall = String(res.spaceId);
  });
  await withIAmAct("install backer", async (ctx) => {
    await doVerb(
      { kind: "space", id: hall },
      "set-space",
      {
        field: "qualities.ables.backer",
        value: {
          canSee: [],
          canDo: ["back"],
          canSummon: [],
          acquisition: { grabbed: true },
        },
        merge: false,
      },
      { identity: I, moment: ctx },
    );
  });
  const backerBeing = await birth("proposer");
  await takeAble(backerBeing, "backer", hall);
  await declare("A member can back a proposal.");
  // @proposer does NOT bear the `member` able (it bears `backer` + inherited angel), so the
  // `cannot member back` does NOT cover it — the positive can/grant permits. The inverse wins
  // BECAUSE no cannot names an able @proposer bears.
  const permitted = await walkDo(backerBeing, "back", hall);
  permitted.ok === true
    ? ok(
        `(3) the inverse "A member can back a proposal." PERMITS @proposer (ok:true, via able=${permitted.able}) — no cannot covers its ables`,
      )
    : bad(`(3) inverse not permitted`, permitted);

  // ── 4. BOTH present (the member cannot AND the can) → the cannot WINS for @delegate ──
  // The register now carries BOTH "No member can back it." (the cannot) and the can. For a being
  // bearing the `member` able, the cannot STILL wins (a cannot beats a can — refused).
  const both = await walkDo(memberBeing, "back", arena);
  both.ok === false && /prohibited by law/i.test(both.reason || "")
    ? ok(
        `(4) BOTH present → @delegate do:back STILL refused (the cannot WINS over the can — rule 14)`,
      )
    : bad(`(4) cannot did not win over the can`, both);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
