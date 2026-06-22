#!/usr/bin/env node
// I_AM GENESIS IMMUTABILITY (Tabor): the CORE STORY genesis words are I_AM's bedrock — a
// non-I_AM actor may NOT disable/re-declare one ON HEAVEN ("0"). But per-branch SHADOWING (the
// V2 overlay, your own vocabulary) stays allowed, and I_AM may change its own. Proves the guard
// protects the root without breaking V2. Full boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_genesis_immutable";
process.env.PORT = "3808";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "genimm-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "genimm-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "genimm-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`)).default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { disableWord, resolveAbleWord } = await import(`${R}/seed/present/word/ableWordRegistry.js`);
const { createBranch } = await import(`${R}/seed/materials/history/historyCreation.js`);
const { I_AM } = await import(`${R}/seed/materials/being/seedBeings.js`);

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${typeof d === "string" ? d : JSON.stringify(d)}`); };
const poll = async (fn, t = 60000, e = 250) => { const t0 = Date.now(); while (Date.now() - t0 < t) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, e)); } return null; };

console.log(`\n  verify-genesis-immutable (I_AM's bedrock vocabulary is unoverridable on heaven)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) { console.log("  FATAL: genesis failed"); process.exit(1); }
  await new Promise((r) => setTimeout(r, 1200)); // let declareWords + rehydrate settle
  const notIAm = String(cherub.id); // cherub is a real being, NOT I_AM

  // move:move is a genesis word (I_AM declared it on heaven "0") — sanity: it resolves on "0"
  resolveAbleWord("move", "move", "0") ? ok(`move:move is a live genesis word on heaven`) : bad(`move:move not resolving`, "expected IR on 0");

  // 1. a non-I_AM actor disabling a genesis word ON HEAVEN → DENIED
  let denied = null;
  try { await disableWord("move", "move", { actorBeingId: notIAm, history: "0" }); }
  catch (e) { denied = e.message; }
  denied && /bedrock/.test(denied) ? ok(`non-I_AM disabling a genesis word on heaven → DENIED ("${denied.slice(0, 48)}…")`)
                                   : bad(`should have denied`, denied || "no throw");
  resolveAbleWord("move", "move", "0") ? ok(`the bedrock held — move:move still live on heaven after the refused disable`) : bad(`bedrock changed`, "move:move went null on 0");

  // 2. the SAME non-I_AM actor SHADOWING on a real branch → ALLOWED (V2 per-branch overlay)
  const made = await createBranch({ parent: "0", anchor: { atSeq: 1 }, createdBy: String(I_AM) });
  const BR = made.path;
  let shadowErr = null;
  try { await disableWord("move", "move", { actorBeingId: notIAm, history: BR }); }
  catch (e) { shadowErr = e.message; }
  !shadowErr ? ok(`non-I_AM shadowing the word on branch "${BR}" → allowed (V2 preserved)`) : bad(`shadow should be allowed`, shadowErr);
  (!resolveAbleWord("move", "move", BR) && resolveAbleWord("move", "move", "0"))
    ? ok(`off on "${BR}", still live on heaven — a local view, the root untouched`)
    : bad(`shadow scope wrong`, { onBranch: !!resolveAbleWord("move", "move", BR), heaven: !!resolveAbleWord("move", "move", "0") });

  // 3. I_AM disabling its own genesis word on heaven → ALLOWED (no actorBeingId → I_AM)
  let iamErr = null;
  try { await disableWord("move", "move", { history: "0" }); }
  catch (e) { iamErr = e.message; }
  !iamErr ? ok(`I_AM may disable its own genesis word on heaven (only I_AM may)`) : bad(`I_AM should be allowed`, iamErr);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
