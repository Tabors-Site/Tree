#!/usr/bin/env node
// verify-boot-files . a FILES-ONLY genesis boot against the append-only file store.
//
// Proves the genesis sequence (the earth forming, genesis.js Steps 1-5) runs against the
// append-only file store alone: connectDB() opens the store dir (configureStore + journal replay),
// then ensureIAm → seedFold → ensureSpaceRoot → setIAmHomeSpace → a couple seed delegates lay their
// facts on per-reel files. Afterward loadOrFold("being", I, "0") folds the I-Am back from those
// files, and the place root folds back from files too. The store base is the only storage selector.
//
// Run: cd story/seed && node present/word/verify-boot-files.mjs

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(__dirname, "../..");

// Files-only: a temp store base is the sole storage selector.
delete process.env.TREEOS_STORE_ROOT;
const STORE_BASE = mkdtempSync(join(tmpdir(), "treeos-bootfiles-"));
process.env.TREEOS_STORE_BASE = STORE_BASE;
// Keep the auto-generated story key out of the repo cwd.
process.env.STORY_KEY_DIR = mkdtempSync(join(tmpdir(), "treeos-bootkeys-"));
// JWT_SECRET is a setup prerequisite (credentials.js asserts it at import) — not a store dependency.
process.env.JWT_SECRET = process.env.JWT_SECRET || "boot-files-0123456789abcdef";

let pass = 0,
  fail = 0;
const ok = (m) => {
  console.log(`  ✓ ${m}`);
  pass++;
};
const bad = (m, extra) => {
  console.log(`  ✗ ${m}${extra !== undefined ? `\n      ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`);
  fail++;
};

console.log(`\n  verify-boot-files (files-only genesis against the append-only file store)\n`);
console.log(`  store base: ${STORE_BASE}\n`);

try {
  // 1. Open the file store (configureStore + journal replay). No network, no URI:
  //    the store base directory is the only storage selector.
  const { connectDB, isDbHealthy } = await import(`${SEED}/seedStory/dbConfig.js`);
  const conn = await connectDB({ story: "bootfiles" });
  isDbHealthy()
    ? ok(`connectDB opened the file store at ${conn.root} (replayed ${conn.replayed}); isDbHealthy()`)
    : bad(`connectDB / isDbHealthy`, conn);

  const { I } = await import(`${SEED}/materials/being/seedBeings.js`);
  const {
    ensureIAm,
    ensureSpaceRoot,
    setIAmHomeSpace,
    getSpaceRootId,
    getIAmBeingId,
    withGenesisGuard,
  } = await import(`${SEED}/sprout.js`);
  const { findByName, findByHeavenSpace, loadOrFold } = await import(
    `${SEED}/materials/projections.js`
  );
  const { HEAVEN_SPACE } = await import(`${SEED}/materials/space/heavenSpaces.js`);
  const { seedFold } = await import(`${SEED}/present/word/wordFold.js`);
  const { ensureSeedDelegates } = await import(
    `${SEED}/materials/being/seedDelegates.js`
  );

  // FAITHFUL TO GENESIS: register the do-ops BEFORE seedFold, exactly as genesis.js does.
  // genesis.js pulls in services.js (the four-verb bundle) whose side-effect imports load every
  // material's ops file (materials/space/ops.js, materials/matter/ops.js, materials/being/ops.js,
  // the store/words/* bundles, ...), each calling registerOperation at module load. Without this,
  // seedFold's declareOpsToFold sees an empty registry and bootstrap do-ops (set-being / set-space /
  // create-space) never resolve from the fold. Importing services.js fires all those registrations.
  await import(`${SEED}/services.js`);
  // The ables ops genesis registers explicitly (registerLlmAssignerOps / registerAbleManagerOps /
  // ...). Mirror them so the boot-end fold catches them too. Harmless if the boot sequence here
  // doesn't dispatch them.
  const { registerLlmAssignerOps } = await import(
    `${SEED}/store/words/llm-assigner/ops.js`
  );
  registerLlmAssignerOps();
  const { registerAbleManagerOps } = await import(
    `${SEED}/store/words/able-manager/ops.js`
  );
  registerAbleManagerOps();

  // Run the genesis sequence exactly as genesis.js does (the !plantedFromSeed branch), minus the
  // host apparatus. Steps: ensureIAm → seedFold → ensureSpaceRoot → setIAmHomeSpace → delegates.
  await withGenesisGuard(async () => {
    // Step 1: "I am what? I am" — births the I-Am alone (name:declare + be:birth).
    await ensureIAm();
    ok(`Step 1 ensureIAm() returned (the I-Am laid its first facts on files)`);

    // Step 1.5: seedFold — the seed declares itself (concepts + do-ops) onto I's reel.
    await seedFold({ moment: null });
    ok(`Step 2 seedFold({moment:null}) returned (the word descent coined to files)`);

    // Step 2: ensureSpaceRoot — place root + heaven + tier-3 heaven spaces.
    await ensureSpaceRoot();
    ok(`Step 3 ensureSpaceRoot() returned (place root + heaven spaces laid)`);

    // Step 3: setIAmHomeSpace — point the I-Am's home at heaven now that it exists.
    const heavenSlot = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
    if (heavenSlot) await setIAmHomeSpace(heavenSlot.id);
    heavenSlot
      ? ok(`Step 4 setIAmHomeSpace(heaven=${String(heavenSlot.id).slice(0, 8)})`)
      : bad(`Step 4 heaven space not found after ensureSpaceRoot`);

    // Step 4: a couple seed delegates (ensureSeedDelegates births the whole roster, each its own moment).
    const delegateResult = await ensureSeedDelegates(getSpaceRootId());
    const roster = delegateResult?.rosterUpdate || {};
    Object.keys(roster).length >= 2
      ? ok(`Step 5 ensureSeedDelegates birthed ${Object.keys(roster).length} delegates: ${Object.keys(roster).slice(0, 4).join(", ")}...`)
      : bad(`Step 5 ensureSeedDelegates roster too small`, roster);
  });

  // ── ASSERT: fold back from FILES alone ──

  // (a) loadOrFold("being", I, "0") cold-folds the I-Am from its file reel.
  const iam = await loadOrFold("being", I, "0");
  iam && (iam.name === I || iam.trueName === I || String(iam.id) === I)
    ? ok(`loadOrFold("being", "${I}", "0") folds the I-Am back from files: name=${iam.name}, position=${iam.position ?? "null"}`)
    : bad(`loadOrFold being I`, iam);

  // (b) findByName also resolves the I-Am from the file-backed index.
  const iamByName = await findByName("being", I, "0");
  iamByName && String(iamByName.id) === I
    ? ok(`findByName("being","${I}","0") resolves from the file index (id=${iamByName.id})`)
    : bad(`findByName being I`, iamByName);

  // loadOrFold returns the projection SLOT ({ state, foldedSeq, position, ... }) — the folded
  // fields (heavenSpace, name, parent, ...) live under .state. Read at that level.
  const heavenSpaceOf = (slot) => slot?.state?.heavenSpace ?? slot?.heavenSpace;

  // (c) the place (space) root folds back from files.
  const rootId = getSpaceRootId();
  const rootFold = rootId ? await loadOrFold("space", String(rootId), "0") : null;
  heavenSpaceOf(rootFold) === HEAVEN_SPACE.SPACE_ROOT
    ? ok(`place root folds from files: id=${String(rootId).slice(0, 8)}, heavenSpace=${heavenSpaceOf(rootFold)}`)
    : bad(`place root fold`, { rootId, heavenSpace: heavenSpaceOf(rootFold), keys: rootFold ? Object.keys(rootFold) : null });

  // (d) the heaven space root folds back from files too.
  const heaven = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
  const heavenFold = heaven ? await loadOrFold("space", String(heaven.id), "0") : null;
  heavenSpaceOf(heavenFold) === HEAVEN_SPACE.HEAVEN
    ? ok(`heaven space folds from files: id=${String(heaven.id).slice(0, 8)}`)
    : bad(`heaven fold`, { heaven: heaven?.id, heavenSpace: heavenSpaceOf(heavenFold) });

  // ── Tabor's gate: .proj is a CACHE, the reels are the TRUTH. Nuke EVERY .proj, re-fold the world
  //    from the facts alone, assert it's identical. If deleting a .proj changes/loses anything, that
  //    .proj was secretly truth — a bug. This is the one-line test for the whole storage model.
  const { readdirSync } = await import("node:fs");
  // Resolve the reel ids ONCE, BEFORE the nuke — findByName reads the slot's .proj, so after the
  // nuke it returns null. (This re-resolution-after-delete was a test bug masking a true PASS.)
  const cherubId = String((await findByName("being", "cherub", "0"))?.id ?? "");
  const targets = [["being", I], ["space", String(rootId)], ["space", String(heaven.id)], ["being", cherubId]].filter(([, id]) => id);
  const stateOf = async (fn, kind, id) => JSON.stringify((await fn(kind, String(id)))?.state ?? null);
  const before = await Promise.all(targets.map(([k, id]) => stateOf((kk, ii) => loadOrFold(kk, ii, "0"), k, id)));
  // delete every .proj under the store (recursive; reels/journal/acts — the truth — untouched)
  const walk = (d) => { let n = 0; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) n += walk(p); else if (e.name.endsWith(".proj")) { rmSync(p, { force: true }); n++; } } return n; };
  const nuked = walk(conn.root);
  // re-fold each reel from the facts alone (rebuild reads the reel, re-derives, rewrites the cache)
  const { rebuild } = await import(`${SEED}/present/stamper/2-fold/foldEngine.js`);
  const after = await Promise.all(targets.map(([k, id]) => stateOf((kk, ii) => rebuild(kk, ii, { history: "0" }), k, id)));
  const identical = before.every((b, i) => b === after[i]);
  if (identical) {
    ok(`.proj is a TRUE CACHE: nuked ${nuked} snapshots, re-folded ${targets.length} reels (being+space+delegate) from facts → world IDENTICAL`);
  } else {
    const which = targets.map(([k, id], i) => before[i] === after[i] ? null : `${k}:${String(id).slice(0, 8)} (proj=${(before[i] || "").length}b rebuilt=${(after[i] || "").length}b)`).filter(Boolean);
    bad(`.proj cache-purity FAILED — deleting .proj changed: ${which.join(", ")}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  rmSync(STORE_BASE, { recursive: true, force: true });
  rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err && (err.stack || err.message)}`);
  // Surface the precise failing module/call for the boot report.
  process.exit(3);
}
