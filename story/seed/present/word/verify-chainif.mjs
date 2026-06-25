#!/usr/bin/env node
// verify-chainif — a BRANCH IS A FACT (20.md §80, P4).
//
// A being speaks a Word with an `If`. In per-act-moment mode (runWordToStore) the branch is no
// longer a silent inline choice: the condition is a SEE (resolveCond, no fact) and the chosen way
// is a DO — a `do:if` fact on the being's own reel carrying which way it went. The taken consequent
// chains on that do:if act (the head advanced to it); the untaken way never reaches the chain. And
// every act recomputes from (p, opening), so the run is byte-identical on replay.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_chainif-" + process.pid);
process.env.PORT = "3839";
process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "chainif-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "chainif-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "chainif-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);
const { runWordToStore } = await import(`${R}/seed/present/word/ableWordRegistry.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { verifyActChain } = await import(`${R}/seed/past/act/actHash.js`);
const { factFindOne, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
const { actFindOne, actCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await sleep(e); }
  return null;
};
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-chainif (a branch is a fact: the see chooses, the do stamps the way)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await sleep(1200);

  // Birth a being to speak the Word (a fresh idle chain, so the branch doesn't fork I's busy reel).
  let speaker = null;
  await withIAmAct("birth brancher", async (m) => {
    const b = await birthBeing({
      spec: { name: "brancher", parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultAble: "global" },
      identity: I, moment: m, history: "0",
    });
    speaker = b.beingId;
  });
  await sleep(1000);
  const slot = await loadOrFold("being", String(speaker), "0");
  const position = slot?.position || slot?.state?.homeSpace || cherub.state?.homeSpace;

  // The Word: an If over a trigger value. Parse a known-good flow+If structure (the cherub/test
  // shape), then swap the then/else with REAL create-space acts (`I make X` is a top-level life
  // act, not a body effect) so the taken consequent lays a queryable fact. then ⇒ notebook; else
  // ⇒ ledger.
  const mkActs = (s) => (Array.isArray(parse(s)) ? parse(s) : [parse(s)]).filter((n) => n.kind === "act");
  const flowSrc = [
    "When the gate opens:",
    "  If the pass equals good:",
    "    queue the guest.",
    "  Otherwise:",
    "    deny the guest.",
  ].join("\n");
  const flowIr = parse(flowSrc)[0];
  const body = flowIr.body || flowIr.effects || [];
  const ifNode = body.find((n) => n.kind === "if");
  if (!ifNode) { bad("flow parsed with an If node", { flowIr }); }
  else {
    ifNode.then = mkActs("I make notebook.");
    ifNode.else = mkActs("I make ledger.");
    ok("the Word parsed to a flow with an If (then ⇒ make notebook, else ⇒ make ledger)");
  }
  const ir = [flowIr];

  const story = getStoryDomain();
  const actsBefore = actCount({ through: String(speaker) }, story);

  // RUN: pass = good ⇒ the THEN way fires.
  await runWordToStore(ir, {
    beingId: String(speaker), name: "brancher", history: "0",
    position: String(position), trigger: { pass: "good" },
  });
  await sleep(1500);

  // 1. THE BRANCH IS A FACT: a do:if landed on the being's reel, taken=then.
  const ifFact = factFindOne({ act: "if", through: String(speaker) });
  ifFact && ifFact.params?.taken === "then"
    ? ok("a do:if fact landed on the being's reel, taken=then — the branch is a fact")
    : bad("do:if fact (taken=then)", { ifFact });

  // 2. THE TAKEN WAY CHAINS ON IT: notebook's create-space act has p == the do:if act.
  const nbFact = factFindOne({ act: "create-space", through: String(speaker) });
  const nbActId = nbFact?.actId;
  const nbAct = nbActId ? actFindOne({ _id: nbActId }, story) : null;
  nbFact && ifFact && nbAct && String(nbAct.p) === String(ifFact.actId)
    ? ok("the taken consequent (make notebook) chains on the do:if act (its p == the do:if actId)")
    : bad("consequent chains on do:if", { ifActId: ifFact?.actId, nbActId, nbActP: nbAct?.p });

  // 3. THE UNTAKEN WAY MAKES NO FACT: ledger was never created; exactly one create-space landed.
  const ledger = await findByName("space", "ledger", "0");
  const createCount = factCount({ act: "create-space", through: String(speaker) });
  !ledger && createCount === 1
    ? ok("the untaken way (make ledger) made no fact — ledger absent, one create-space only")
    : bad("untaken way silent", { ledger: !!ledger, createCount });

  // 4. ONE MOMENT PER ACT: the chain grew by exactly 2 acts (the do:if, then the consequent).
  const actsAfter = actCount({ through: String(speaker) }, story);
  actsAfter - actsBefore === 2
    ? ok(`the chain grew by exactly 2 acts (${actsBefore} → ${actsAfter}): the do:if + the taken consequent`)
    : bad("chain grew by 2", { actsBefore, actsAfter });

  // 5. REPLAY-INTEGRAL: every act recomputes from (p, opening) down to genesis (content-addressed).
  const chain = await verifyActChain(story, "0", String(speaker));
  chain.ok
    ? ok(`verifyActChain walks the brancher's reel clean (${chain.count} acts) — byte-identical on replay`)
    : bad("verifyActChain clean", chain);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
