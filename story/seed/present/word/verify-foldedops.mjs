#!/usr/bin/env node
// verify-foldedops — 10.md step 6: the fold carries op `args` + a fold-based op-lister, and the
// running-system readers (authorize's ext-scope gate, descriptor's matter-actions + op-catalog)
// read the fold via getWordSync/listFoldedOps, not the operations Map.
import fs from "fs"; import os from "os"; import path from "path"; import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = path.join(os.tmpdir(), "story_foldedops-" + process.pid);
process.env.PORT = "3841"; process.env.TREEOS_STORE_BASE = DB;
fs.rmSync(DB, { recursive: true, force: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || "foldedops-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "foldedops-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "foldedops-src"); fs.rmSync(SRC, { recursive: true, force: true }); fs.mkdirSync(SRC, { recursive: true }); fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
// (scratch file store fresh-wiped above; no DB to drop)
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { listFoldedOps, getWordSync } = await import(`${R}/seed/present/word/wordStore.js`);
const poll = async (fn, t = 20000, e = 300) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return await fn(); };
let pass = 0, fail = 0; const ok = (l) => { pass++; console.log("  ✓ " + l); }; const bad = (l, d) => { fail++; console.log("  ✗ " + l); if (d !== undefined) console.log("      " + JSON.stringify(d)); };
console.log("\n  verify-foldedops (step 6: the readers read the fold)\n");
try {
  await poll(() => findByName("being", "cherub", "0"), (v) => !!v);
  const ops = listFoldedOps();
  ops.length > 30 ? ok(`listFoldedOps() returns ${ops.length} op-words from the live fold`) : bad(`listFoldedOps count`, ops.length);
  const setSpace = getWordSync("set-space");
  (setSpace && setSpace.kind === "op" && Array.isArray(setSpace.targets) && setSpace.factAction)
    ? ok(`getWordSync("set-space") -> {kind:op, targets, factAction} (the shape auth + descriptor read)`)
    : bad(`getWordSync set-space`, setSpace);
  const createMatter = getWordSync("create-matter");
  (createMatter && createMatter.args && typeof createMatter.args === "object")
    ? ok(`create-matter folds WITH args (descriptor builds forms from the fold's args)`)
    : bad(`args on the fold`, createMatter ? Object.keys(createMatter) : null);
  const wellFormed = ops.every((o) => o.name && o.ownerExtension && Array.isArray(o.targets));
  wellFormed ? ok(`every folded op carries {name, ownerExtension, targets} (the catalog + ext-scope shape)`) : bad(`op shape`, ops.find((o) => !o.name || !o.ownerExtension || !Array.isArray(o.targets)));
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) { console.log("\n  ! crashed: " + (e.stack || e.message)); process.exit(3); }
