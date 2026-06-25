#!/usr/bin/env node
// Live gate for the Word cherub slice: run the evaluator's form-being against the
// REAL substrate (the file store + genesis) and verify it actually births a being,
// the proof that the Word evaluator drives the live substrate, not just a dry-run.
// Isolated file store under a per-pid scratch dir, fresh-wiped at start.
import os from "os";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storyRoot = path.resolve(__dirname, "../../.."); // .../story

for (const line of fs
  .readFileSync(path.resolve(storyRoot, ".env"), "utf8")
  .split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim(),
    v = t.slice(eq + 1).trim();
  if (v && !process.env[k]) process.env[k] = v;
}
// The Mongo rip: storage is now a directory under store/, selected by
// TREEOS_STORE_BASE. Point the engine at a per-pid scratch base, fresh-wiped,
// so this rig runs files-only with no MONGODB_URI and no shared state.
const STORE_BASE = path.join(os.tmpdir(), "story_word_cherub-" + process.pid);
process.env.TREEOS_STORE_BASE = STORE_BASE;
fs.rmSync(STORE_BASE, { recursive: true, force: true });
delete process.env.MONGODB_URI;

// Open the file store (make the data dir + replay any journal). This rig runs
// its own minimal genesis below rather than the full begin.js boot, so it must
// configure the store itself before the first read/write.
const { connectDB } = await import("../../seedStory/dbConfig.js");
await connectDB();

await import("../../materials/space/ops.js");
await import("../../materials/matter/ops.js");
await import("../../materials/being/ops.js");

const { ensureSpaceRoot, ensureIAm } = await import("../../sprout.js");
const { findByName } = await import("../../materials/projections.js");
const { factFind } = await import("./_factStoreTest.mjs");
const { ensureSeedDelegates } =
  await import("../../materials/being/seedDelegates.js");
const { sealFacts } = await import("../../past/fact/facts.js");
const { generateNameKeypair } = await import("../../materials/name/keys.js");
const { evaluate } = await import("./evaluator.js");

let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log(`  ✓ ${l}`);
};
const bad = (l, d) => {
  fail++;
  console.log(`  ✗ ${l}`);
  if (d) console.log(`      ${d}`);
};

// A thin retry wrapper kept from the Mongo path. The file store is single-writer
// (no transaction/lock contention), so its predicate never matches and fn runs once;
// it stays as a harmless guard around the genesis steps.
async function withRetry(fn, label, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      if (
        i < tries - 1 &&
        /catalog changes|acquire .* lock|please retry|WriteConflict|TransientTransaction/i.test(
          msg,
        )
      ) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

console.log(
  `\n  verify-word-cherub (live)\n  store: ${STORE_BASE.split("/").pop()}\n`,
);

try {
  // (the file store was fresh-wiped above; no DB to drop and no collections to
  //  pre-create . the reels/journal dirs are made on demand by configureStore.)
  console.log(
    "  genesis: ensureIAm + the words + ensureSpaceRoot + ensureSeedDelegates",
  );
  await withRetry(() => ensureIAm(), "ensureIAm"); // the I being (Name/Being refactor)
  // fold-only dispatch: the words declare themselves onto I's reel BEFORE any do-op dispatches.
  await withRetry(async () => {
    const wc = {
      actId: randomUUID(),
      actorAct: { history: "0", by: "i-am" },
      identity: { beingId: "i-am", name: "I", nameId: "i-am" },
      deltaF: [],
      foldedSeqs: new Map(),
      afterSeal: [],
    };
    const { seedFold } = await import("./wordFold.js");
    await seedFold({ moment: wc });
    await sealFacts(wc.deltaF);
    const { rehydrateWordProjection } = await import("./wordStore.js");
    await rehydrateWordProjection("0");
  }, "declareSeedWords");
  const spaceRoot = await withRetry(() => ensureSpaceRoot(), "ensureSpaceRoot");
  await withRetry(
    () => ensureSeedDelegates(spaceRoot._id),
    "ensureSeedDelegates",
  );

  const branch = "0"; // genesis facts above landed on branch=0 (the root)
  const cherub = await findByName("being", "cherub", branch);
  if (!cherub) throw new Error("no cherub being found via findByName");
  console.log(
    `  cherub=${cherub.id}  home=${spaceRoot._id}  branch=${branch}\n`,
  );

  // a fresh Name for the child (the "mint a new Name (host: keys.generate)" step)
  const { nameId } = generateNameKeypair();

  const moment = {
    actId: randomUUID(),
    actorAct: { branch, by: cherub.trueName },
    identity: {
      beingId: String(cherub.id),
      name: "cherub",
      nameId: cherub.trueName,
    },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };

  // run the Word form-being live: the evaluator dispatches to the real birthBeing
  const ctx = {
    dryRun: false,
    branch,
    moment,
    identity: moment.identity,
    env: { I: String(cherub.id) },
    bindings: {},
    deltaF: [],
    flows: [],
  };
  const formBeing = {
    kind: "act",
    verb: "be",
    act: "form-being",
    by: "Cherub",
    bind: "child",
    params: {
      name: "worduser",
      password: "wordpass",
      cognition: "human",
      defaultAble: "human",
      parentBeingId: String(cherub.id),
      homeId: String(spaceRoot._id),
      // trueName omitted: a fresh Name must be NAME-declared first (its own slice);
      // birthBeing defaults to the (declared) mother Name, so the birth path runs.
    },
  };

  await withRetry(() => evaluate([formBeing], ctx), "form-being");
  console.log(`  evaluator laid ${moment.deltaF.length} fact(s) into deltaF:`);
  for (const f of moment.deltaF)
    console.log(`    ${f.verb}:${f.act} -> ${f.of?.kind}:${f.of?.id}`);

  const birthFact = moment.deltaF.find(
    (f) => f.verb === "be" && f.act === "birth",
  );
  birthFact
    ? ok(`form-being produced a be:birth fact`)
    : bad(
        `a be:birth fact is in deltaF`,
        JSON.stringify(moment.deltaF).slice(0, 300),
      );

  // the Word IR's params reached the real birthBeing (the fact is authoritative)
  birthFact?.params?.name === "worduser"
    ? ok(`be:birth names @worduser`)
    : bad(`be:birth names @worduser`, `name=${birthFact?.params?.name}`);
  String(birthFact?.params?.parentBeingId) === String(cherub.id)
    ? ok(`be:birth parents to cherub`)
    : bad(
        `be:birth parents to cherub`,
        `parent=${birthFact?.params?.parentBeingId}`,
      );

  // seal the moment (commits the be:birth fact), then run the moment's
  // afterSeal hooks. Under "one word = one moment" birthBeing no longer pools
  // the able grants into moment.deltaF. It queues them onto moment.afterSeal,
  // each its OWN moment (an inherited grant THROUGH the parent, plus the global
  // anoint THROUGH I), laid AFTER the be:birth lands so the child exists
  // on-chain before it is granted to. The production act-seal (stamper
  // sealAct) fires those hooks; this low-level rig drives sealFacts(deltaF)
  // directly, so we run them by hand here, the same callbacks sealAct runs.
  await sealFacts(moment.deltaF);
  for (const cb of moment.afterSeal || []) await cb();

  const born = await findByName("being", "worduser", branch); // fold-aware read
  born
    ? ok(
        `@worduser materializes after seal (id ${String(born.id).slice(0, 12)}…)`,
      )
    : bad(`@worduser materializes after seal`, "no row found");

  // one act, several facts (across moments): birthBeing lays the inherited and
  // global able grants on the new being. They land on the child's reel (not in
  // the caller's deltaF), so read them from the store, the file-store peer of
  // the old global Fact.find({ verb:"do", act:"grant-able", "of.id": child }).
  const grants = factFind({
    verb: "do",
    act: "grant-able",
    "of.id": String(birthFact?.of?.id),
  });
  grants.length >= 1
    ? ok(`birthBeing laid ${grants.length} able grant(s) on the new being`)
    : bad(`able grants laid`, "none");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  fs.rmSync(STORE_BASE, { recursive: true, force: true }); // drop the scratch store
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  try {
    fs.rmSync(STORE_BASE, { recursive: true, force: true });
  } catch {}
  process.exit(3);
}
