#!/usr/bin/env node
// verify-config-5d — story CONFIG now lives on the ONE 5D library reel as config-set/config-delete
// NAME-ACTS (no ./config heaven space). Boots, then: (1) the boot migration's seedVersion is a
// bodiless name-act on the library reel; (2) set→get round-trips; (3) the value survives a reload
// (it folds back from the reel); (4) delete folds away; (5) the write is bodiless + name-signed.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_config5d-" + process.pid);
process.env.PORT = "3852"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "config5d-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "config5d-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "config5d-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const sc = await import(`${R}/seed/storyConfig.js`);
const { getStoryDomain } = await import(`${R}/seed/ibp/address.js`);
const { factFind, factFindOne, factCount } = await import(`${R}/seed/present/word/_factStoreTest.mjs`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d).slice(0, 240)); };
console.log("\n  verify-config-5d (config on the library reel as name-acts)\n");
try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);
  const story = getStoryDomain();

  // 1. The boot migration persisted seedVersion as a bodiless name-act on the library reel.
  const seedV = await poll(() => factFindOne({ "of.kind": "library", "of.id": story, act: "config-set", "params.key": "seedVersion" }), (v) => !!v);
  (seedV && seedV.through == null && seedV.by && seedV.verb === "name")
    ? ok(`boot wrote seedVersion as a name-act on the library reel (by=${seedV.by}, through=null, verb=${seedV.verb})`)
    : bad("seedVersion not a library name-act", seedV);

  // 2. set → get round-trip (writes a config-set name-act, updates the cache).
  await sc.setStoryConfigValue("timezone", "America/Chicago", { identity: { nameId: "i-am" } });
  sc.getStoryConfigValue("timezone") === "America/Chicago"
    ? ok("setStoryConfigValue → getStoryConfigValue round-trips")
    : bad("config set/get failed", sc.getStoryConfigValue("timezone"));

  // 3. survives a reload — the cache is rebuilt by folding the library reel.
  await sc.reloadStoryConfig();
  sc.getStoryConfigValue("timezone") === "America/Chicago"
    ? ok("config survives reloadStoryConfig (folded back from the library reel)")
    : bad("config lost on reload", sc.getStoryConfigValue("timezone"));

  // 4. delete folds away on reload.
  await sc.deleteStoryConfigValue("timezone", { identity: { nameId: "i-am" } });
  await sc.reloadStoryConfig();
  sc.getStoryConfigValue("timezone") == null
    ? ok("config-delete folds away on reload")
    : bad("config not deleted", sc.getStoryConfigValue("timezone"));

  // 5. the config write is a bodiless name-act on the library reel (not a do/space fact).
  const tzFact = factFindOne({ "of.kind": "library", "of.id": story, act: "config-set", "params.key": "timezone" });
  (tzFact && tzFact.through == null && tzFact.verb === "name")
    ? ok("config write landed bodiless (through=null, verb:name) on the library reel — no ./config space")
    : bad("config write not a library name-act", tzFact);

  // 6. the dispatch path: a config name-act opened INSIDE a being-act moment (as set-config/
  //    share-book do via doVerb) lands cleanly — no moment/lock conflict between the being-chain
  //    (the outer dispatch) and the name-chain (the nested library write).
  const { withIAmAct } = await import(`${R}/seed/sprout.js`);
  await withIAmAct("dispatch-sim", async () => {
    await sc.setStoryConfigValue("locale", "en-US", { identity: { beingId: "i-am" } });
  });
  await sc.reloadStoryConfig();
  sc.getStoryConfigValue("locale") === "en-US"
    ? ok("a config name-act nested inside a being-act moment lands cleanly (the dispatch path)")
    : bad("nested name-act inside a being-act failed", sc.getStoryConfigValue("locale"));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("  ✗ threw: " + e.message); console.log("    " + String(e.stack).split("\n").slice(1, 6).join("\n    "));
  fail++;
  console.log(`\n  ${pass} passed, ${fail} failed\n`);
}
process.exit(fail > 0 ? 1 : 0);
