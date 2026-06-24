#!/usr/bin/env node
// verify-chainloop — a LOOP IS A FOLD that grows the chain (20.md §27, P4).
//
// A being speaks a `for each` over three items. In per-act-moment mode each pass's body-act opens
// its OWN moment, so the loop grows the chain by one act per pass — three passes, three acts,
// chained in order, the chain head the program counter. No JS counter drives the chain; the facts
// ARE the iterations. Every act recomputes from (p, opening), so the loop replays byte-identical.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_chainloop";
process.env.PORT = "3840";
process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "chainloop-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "chainloop-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "chainloop-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default;
  const conn = await mongoose.createConnection(DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}
await import(`${R}/begin.js`);
const { findByName, loadOrFold } = await import(`${R}/seed/materials/projections.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { birthBeing } = await import(`${R}/seed/materials/being/identity/birth.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);
const { runWordToStore } = await import(`${R}/seed/present/word/ableWordRegistry.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { verifyActChain } = await import(`${R}/seed/past/act/actHash.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const { default: Act } = await import(`${R}/seed/past/act/act.js`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const poll = async (fn, t = 60000, e = 250) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await sleep(e); }
  return null;
};
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-chainloop (a loop is a fold: each pass grows the chain by its facts)\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await sleep(1200);

  let speaker = null;
  await withIAmAct("birth looper", async (m) => {
    const b = await birthBeing({
      spec: { name: "looper", parentBeingId: cherub.id, homeId: cherub.state?.homeSpace, cognition: "scripted", defaultAble: "global" },
      identity: I, moment: m, history: "0",
    });
    speaker = b.beingId;
  });
  await sleep(1000);
  const slot = await loadOrFold("being", String(speaker), "0");
  const position = slot?.position || slot?.state?.homeSpace || cherub.state?.homeSpace;

  // The Word: a for-each over three names, each pass making a space named for the item. `make X` is
  // a top-level life act, so build the foreach IR around a parsed create-space whose name is the
  // per-pass binding ($item).
  const mkActs = (s) => (Array.isArray(parse(s)) ? parse(s) : [parse(s)]).filter((n) => n.kind === "act");
  const body = mkActs("I make placeholder.");
  body.forEach((a) => { a.params = { ...(a.params || {}), name: "$item" }; });
  const foreach = { kind: "foreach", bind: "item", in: { ref: "items" }, body };
  const ir = [{ kind: "flow", binds: [], body: [foreach] }];
  const items = ["alpha", "beta", "gamma"];

  const actsBefore = await Act.countDocuments({ through: String(speaker) });

  await runWordToStore(ir, {
    beingId: String(speaker), name: "looper", history: "0",
    position: String(position), bindings: { items },
  });
  await sleep(1800);

  // 1. THE LOOP RAN: a space exists for each of the three items.
  const made = [];
  for (const nm of items) { const s = await findByName("space", nm, "0"); if (s) made.push(nm); }
  made.length === 3
    ? ok(`the for-each ran three passes — spaces ${made.join(", ")} all exist`)
    : bad("three spaces made", { made });

  // 2. EACH PASS GREW THE CHAIN BY ONE ACT: three create-space facts, three distinct actIds.
  const facts = await Fact.find({ act: "create-space", through: String(speaker) }).select("actId").lean();
  const actIds = [...new Set(facts.map((f) => String(f.actId)))];
  actIds.length === 3
    ? ok("three create-space facts, three DISTINCT actIds — one moment per pass, not a run-on")
    : bad("three distinct actIds", { actIds });

  // 3. THE CHAIN GREW BY EXACTLY THREE ACTS (the three passes, nothing else).
  const actsAfter = await Act.countDocuments({ through: String(speaker) });
  actsAfter - actsBefore === 3
    ? ok(`the chain grew by exactly 3 acts (${actsBefore} → ${actsAfter}): one per loop pass`)
    : bad("chain grew by 3", { actsBefore, actsAfter });

  // 4. THE PASSES CHAIN IN ORDER: following p from the head, the three create-space acts are
  //    contiguous (each pass chains on the one before — the chain head is the program counter).
  const acts = await Act.find({ _id: { $in: actIds } }).select("_id p").lean();
  const byId = new Map(acts.map((a) => [String(a._id), String(a.p)]));
  let contiguous = false;
  for (const tail of actIds) {
    // walk forward: is there an ordering a1<-a2<-a3 where each p is the previous?
    const others = actIds.filter((x) => x !== tail);
    if (others.length === 2) {
      const [b, c] = others;
      // tail is the last pass: tail.p in {b,c}; the middle's p is the remaining one
      const tp = byId.get(tail);
      if (tp === b && byId.get(b) === c) { contiguous = true; break; }
      if (tp === c && byId.get(c) === b) { contiguous = true; break; }
    }
  }
  contiguous
    ? ok("the three passes chain in order — each pass's act p-links to the pass before")
    : bad("passes chain in order", { byId: Object.fromEntries(byId) });

  // 5. REPLAY-INTEGRAL: every act recomputes from (p, opening) down to genesis.
  const chain = await verifyActChain(getStoryDomain(), "0", String(speaker));
  chain.ok
    ? ok(`verifyActChain walks the looper's reel clean (${chain.count} acts) — byte-identical on replay`)
    : bad("verifyActChain clean", chain);

  // ── while: the conditional loop ends on a SEE-read, not a count (20.md §29) ──
  // `While the counter is greater than 0:` make a ring space, then a host-tick decrements the
  // counter the next pass's see reads. The loop runs until the see goes false.
  const whileSrc = ["When the run starts:", "  While the counter is greater than 0:", "    queue the guest."].join("\n");
  const wf = parse(whileSrc)[0];
  const whileNode = (wf.body || wf.effects || []).find((n) => n.kind === "while");
  whileNode
    ? ok("the Word parsed to a flow with a While loop")
    : bad("flow parsed with a While node", { wf });
  const ring = mkActs("I make placeholder.");
  ring.forEach((a) => { a.params = { ...(a.params || {}), name: "$label" }; });
  whileNode.body = [...ring, { kind: "act", host: "tick", params: {} }];

  const actsBeforeW = await Act.countDocuments({ through: String(speaker) });
  const wres = await runWordToStore([wf], {
    beingId: String(speaker), name: "looper", history: "0", position: String(position),
    bindings: { counter: 3, label: "ring3" },
    env: { host: { tick: (p, ctx) => { ctx.bindings.counter -= 1; ctx.bindings.label = "ring" + ctx.bindings.counter; } } },
  });
  await sleep(1800);

  // 6. THE WHILE TERMINATED ON A FOLD-READ: the counter the see read drove to 0.
  wres.bindings?.counter === 0
    ? ok("the while ran until its see went false (counter 3 → 0) — ended on a fold-read, not a count")
    : bad("while ended on fold-read", { counter: wres.bindings?.counter });

  // 7. THE WHILE GREW THE CHAIN: three ring spaces, the chain grew by exactly three.
  const rings = [];
  for (const nm of ["ring3", "ring2", "ring1"]) { const s = await findByName("space", nm, "0"); if (s) rings.push(nm); }
  const actsAfterW = await Act.countDocuments({ through: String(speaker) });
  rings.length === 3 && actsAfterW - actsBeforeW === 3
    ? ok(`the while grew the chain by 3 (one per pass): ${rings.join(", ")}`)
    : bad("while grew the chain by 3", { rings, actsBeforeW, actsAfterW });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
