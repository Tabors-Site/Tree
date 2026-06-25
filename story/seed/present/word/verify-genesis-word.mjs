#!/usr/bin/env node
// verify-genesis-word (SLICE 1 — the grants) — proves the genesis.word READER end-to-end:
// the I reads story/seed/store/genesis.word and runs it via runWordToStore (the same path
// cognition uses to run a being's spoken Word), one grant = one moment, each landing the
// delegate's ablesGranted. The grant reducer dedupes by (able,anchor,grantor), so running
// genesis.word over the already-granted boot state is idempotent — it must complete with no
// refusal and leave each delegate's grants intact. Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = path.join(os.tmpdir(), "story_genesis_word-" + process.pid);
process.env.PORT = "3796";
process.env.TREEOS_STORE_BASE = SCRATCH_DB;
fs.rmSync(SCRATCH_DB, { recursive: true, force: true });
delete process.env.MONGODB_URI;
process.env.JWT_SECRET = process.env.JWT_SECRET || "genesisword-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(os.tmpdir(), "genesisword-keys-" + process.pid);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "genesisword-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

await import(`${R}/begin.js`);

const { findByName, loadProjection, findByHeavenSpace } = await import(
  `${R}/seed/materials/projections.js`
);
const { HEAVEN_SPACE } = await import(`${R}/seed/materials/space/heavenSpaces.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { SEED_DELEGATES } = await import(`${R}/seed/materials/being/seedDelegates.js`);
const { parse } = await import(`${R}/seed/present/word/parser.js`);
const { runWordToStore } = await import(`${R}/seed/present/word/ableWordRegistry.js`);

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

// Read the delegate's granted ables off the live projection (Map-safe).
const grantsOf = async (id) => {
  const slot = await loadProjection("being", String(id), "0");
  const q = slot?.state?.qualities;
  const ag = q instanceof Map ? q.get("ablesGranted") : q?.ablesGranted;
  // ablesGranted is a list (or map) of grants; normalize to a set of able names.
  const list = Array.isArray(ag) ? ag : ag ? Object.values(ag) : [];
  return new Set(list.map((g) => g?.able).filter(Boolean));
};

console.log(
  `\n  verify-genesis-word (slice 1: the grants, run by the I via runWordToStore)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  const heaven = await poll(() =>
    findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0"),
  );
  if (!heaven) {
    console.log("  FATAL: heaven did not materialize");
    process.exit(1);
  }
  const rootId = getSpaceRootId();
  const heavenId = String(heaven.id);
  ok(`boot reached: heaven ${heavenId.slice(0, 8)} · root ${String(rootId).slice(0, 8)}`);

  // Build the delegate proper-name → being id map the reader passes as `beings`.
  const beings = {};
  for (const spec of SEED_DELEGATES) {
    const slot = await findByName("being", spec.name, "0");
    if (slot) beings[spec.name] = String(slot.id);
  }
  Object.keys(beings).length >= SEED_DELEGATES.length - 1
    ? ok(`resolved ${Object.keys(beings).length}/${SEED_DELEGATES.length} delegate ids`)
    : bad(`delegate resolution`, beings);

  // Parse genesis.word (a header-less act sequence, the I's deeds).
  const src = fs.readFileSync(
    path.join(R, "seed", "store", "genesis.word"),
    "utf8",
  );
  let ir;
  try {
    ir = parse(src);
    ir ? ok(`genesis.word parses`) : bad(`genesis.word parse → null`);
  } catch (e) {
    bad(`genesis.word parse threw`, e.message);
    throw e;
  }

  // Run it as the I — the reader call shape from the plan. name:I is REQUIRED (authorize
  // short-circuits on identity.name === I; null would deny every grant).
  let run;
  try {
    // Delegates ride BINDINGS, not `beings`: resolveTarget reads bindings (`on the being
    // cherub` → the id), but resolveValue only auto-resolves proper names via `beings` — so an
    // able name that equals a delegate name (able "cherub") must stay a literal, not the id.
    run = await runWordToStore(ir, {
      beingId: I,
      name: I,
      history: "0",
      position: heavenId,
      bindings: { heaven: heavenId, root: String(rootId), ...beings },
    });
    ok(`genesis.word ran as the I (stamped ${run.stamped} act(s))`);
  } catch (e) {
    bad(`genesis.word run threw`, e.message);
    throw e;
  }

  // The grants landed: cherub holds angel (@heaven) + cherub (@root); arrival holds
  // arrival but NOT angel; public holds neither.
  const cg = await grantsOf(beings["cherub"]);
  cg.has("angel") && cg.has("cherub")
    ? ok(`@cherub granted angel + cherub`)
    : bad(`@cherub grants`, [...cg]);

  const ag = await grantsOf(beings["arrival"]);
  ag.has("arrival") && !ag.has("angel")
    ? ok(`@arrival granted arrival, NOT angel (anon-stance rule)`)
    : bad(`@arrival grants`, [...ag]);

  if (beings["public"]) {
    const pg = await grantsOf(beings["public"]);
    pg.size === 0
      ? ok(`@public granted nothing (never acts)`)
      : bad(`@public grants`, [...pg]);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
