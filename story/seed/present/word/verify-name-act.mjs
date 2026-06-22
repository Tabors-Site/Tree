#!/usr/bin/env node
// verify-name-act — the 5D NAME-ACT: a Name acts with NO being (the being stays home), the act-chain
// keyed by the name on history "5d", the fact bodiless (through=null, verb:"name") on the library
// reel (kind="library", history "0"). Boots, opens a withNameAct, lays a library fact, asserts the
// fact landed bodiless + the name-act-chain advanced + verifyActChain walks it clean.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_name_act";
process.env.PORT = "3851"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "nameact-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "nameact-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "nameact-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { withNameAct } = await import(`${R}/seed/sprout.js`);
const { emitFact } = await import(`${R}/seed/past/fact/facts.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { default: ActHead } = await import(`${R}/seed/past/act/actHead.js`);
const { verifyActChain } = await import(`${R}/seed/past/act/actHash.js`);
const Fact = (await import(`${R}/seed/past/fact/fact.js`)).default;
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 240)); };
console.log("\n  verify-name-act (5D name-act: bodiless, name-keyed, history 5d)\n");
try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);
  const story = getStoryDomain();
  const nameId = "i-am";          // the I_AM name (loadSigningKey maps it to the story key)
  const libraryId = story;        // the story's single library reel id

  // Open a 5D name-act and lay a bodiless library fact (verb:"name", through:null, on the library reel "0").
  await withNameAct(nameId, "test name act", async (moment) => {
    await emitFact({ verb: "name", act: "test-5d-fact", through: null, by: nameId, of: { kind: "library", id: libraryId }, params: { hello: "world" }, actId: moment.actId, history: "0" }, moment);
  });

  // 1. The fact landed on the library reel — bodiless (through null), name-signed, history "0".
  const f = await Fact.findOne({ "of.kind": "library", "of.id": libraryId, act: "test-5d-fact" }).lean();
  (f && f.by === nameId && (f.through == null) && String(f.history) === "0")
    ? ok(`bodiless verb:name fact on the library reel (by=${f.by}, through=${f.through}, history=${f.history}, seq=${f.seq})`)
    : bad("library fact not laid right", f);

  // 2. The NAME-act-chain advanced — keyed <story>:5d:<name> (distinct from any being-chain).
  const head = await ActHead.findById(`${story}:5d:${nameId}`).lean();
  (head && head.headHash) ? ok(`name-act-chain advanced: ${story}:5d:${nameId} (head ${String(head.headHash).slice(0, 12)}…)`) : bad("no 5d name-act head", head);

  // 3. verifyActChain walks the name-chain clean.
  const v = await verifyActChain(story, "5d", nameId);
  (v.ok && v.count >= 1) ? ok(`verifyActChain(story, "5d", name) walks ${v.count} name-act(s) clean`) : bad("name-act-chain verify failed", v);

  // 4. The I_AM's 4D being-chain (<story>:0:i-am) is SEPARATE and untouched by the name-act.
  const beingHead = await ActHead.findById(`${story}:0:${nameId}`).lean();
  (beingHead && head && beingHead.headHash !== head.headHash)
    ? ok("the I_AM being-chain (0) and name-chain (5d) are distinct heads — no collision")
    : bad("being/name chains collided or missing", { beingHead, head });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 6).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
