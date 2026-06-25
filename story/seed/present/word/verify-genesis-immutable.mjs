#!/usr/bin/env node
// I GENESIS IMMUTABILITY (Tabor): the CORE STORY genesis words are I's bedrock — a
// non-I actor may NOT disable/re-declare one ON HEAVEN ("0"). But per-branch SHADOWING (the
// V2 overlay, your own vocabulary) stays allowed, and I may change its own. Proves the guard
// protects the root without breaking V2. Full boot.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_genesis_immutable-" + process.pid);
process.env.PORT = "3808";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "genimm-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "genimm-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "genimm-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { disableWord, resolveAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { createBranch } = await import(
  `${R}/seed/materials/history/historyCreation.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);

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

console.log(
  `\n  verify-genesis-immutable (I's bedrock vocabulary is unoverridable on heaven)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  const cherub = await poll(() => findByName("being", "cherub", "0"));
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1200)); // let declareWords + rehydrate settle
  const notIAm = String(cherub.id); // cherub is a real being, NOT I

  // move:move is a genesis word (I declared it on heaven "0") — sanity: it resolves on "0"
  resolveAbleWord("move", "move", "0")
    ? ok(`move:move is a live genesis word on heaven`)
    : bad(`move:move not resolving`, "expected IR on 0");

  // 1. a non-I actor disabling a genesis word ON HEAVEN → DENIED
  let denied = null;
  try {
    await disableWord("move", "move", { actorBeingId: notIAm, history: "0" });
  } catch (e) {
    denied = e.message;
  }
  denied && /bedrock/.test(denied)
    ? ok(
        `non-I disabling a genesis word on heaven → DENIED ("${denied.slice(0, 48)}…")`,
      )
    : bad(`should have denied`, denied || "no throw");
  resolveAbleWord("move", "move", "0")
    ? ok(
        `the bedrock held — move:move still live on heaven after the refused disable`,
      )
    : bad(`bedrock changed`, "move:move went null on 0");

  // 2. the SAME non-I actor SHADOWING on a real branch → ALLOWED (V2 per-branch overlay)
  const made = await createBranch({
    parent: "0",
    anchor: { atSeq: 1 },
    createdBy: String(I),
  });
  const BR = made.path;
  let shadowErr = null;
  try {
    await disableWord("move", "move", { actorBeingId: notIAm, history: BR });
  } catch (e) {
    shadowErr = e.message;
  }
  !shadowErr
    ? ok(`non-I shadowing the word on branch "${BR}" → allowed (V2 preserved)`)
    : bad(`shadow should be allowed`, shadowErr);
  !resolveAbleWord("move", "move", BR) && resolveAbleWord("move", "move", "0")
    ? ok(
        `off on "${BR}", still live on heaven — a local view, the root untouched`,
      )
    : bad(`shadow scope wrong`, {
        onBranch: !!resolveAbleWord("move", "move", BR),
        heaven: !!resolveAbleWord("move", "move", "0"),
      });

  // 3. I disabling its own genesis word on heaven → ALLOWED (no actorBeingId → I)
  let iamErr = null;
  try {
    await disableWord("move", "move", { history: "0" });
  } catch (e) {
    iamErr = e.message;
  }
  !iamErr
    ? ok(`I may disable its own genesis word on heaven (only I may)`)
    : bad(`I should be allowed`, iamErr);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
