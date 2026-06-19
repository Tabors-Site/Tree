#!/usr/bin/env node
// verify-projection . the live word projection: a sync in-memory fold of the vocabulary, rebuilt
// from the chain at boot (rehydrateWordProjection, after seedFold seals). The dispatch's fast path.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_projection";
process.env.PORT = "3837"; process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "projection-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "projection-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "projection-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{ const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default; const conn = await mongoose.createConnection(DB).asPromise(); await conn.dropDatabase(); await conn.close(); }
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { getWordSync, getWord } = await import(`${R}/seed/present/word/wordStore.js`);
const pollFor = async (fn, pred, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (pred(v)) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
console.log(`\n  verify-projection (the live word projection, sync fold for dispatch)\n`);
try {
  await pollFor(() => findByName("being", "cherub", "0"), (v) => !!v);
  // poll until the projection is rebuilt (rehydrate runs after seedFold seals, post-delegates)
  const op = await pollFor(() => getWordSync("set-space"), (v) => v && v.kind === "op");
  (op && op.kind === "op" && op.do?.ref === "set-space") ? ok(`getWordSync("set-space") returns the op binding, sync, from the projection`) : bad(`op sync`, op);
  const being = getWordSync("being");
  (being && being.kind === "concept") ? ok(`getWordSync("being") returns the concept, sync`) : bad(`concept sync`, being);
  (getWordSync("nonesuch-xyz") === null) ? ok(`an unbound word reads null (sync)`) : bad(`unbound null`, getWordSync("nonesuch-xyz"));
  const opAsync = await getWord("set-space");
  (opAsync && opAsync.do?.ref === op?.do?.ref) ? ok(`the sync projection agrees with the async chain fold (getWord)`) : bad(`sync vs async`, { sync: op?.do?.ref, async: opAsync?.do?.ref });
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) { console.log(`\n  ! crashed: ${err.stack || err.message}`); process.exit(3); }
