#!/usr/bin/env node
// take-able.word (the acquisition walk-in slice), LIVE through the bridge with ZERO
// stubs. The CONTROL strand (the gate chain + idempotency) is .word; the acquisition
// lookups + the grant-record build are see escapes wired by acquisitionHost.js. Proves a
// being takes a grabbable able (a do:take-able fact lands carrying the grant record, the
// reducer folds the grant, the being holds the able); the idempotent re-take STILL stamps
// its do:take-able act (every act makes a fact) but folds no duplicate; and the refusals.
// Full begin.js boot. Scratch DB, wiped.

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const SCRATCH_DB = "mongodb://localhost:27017/story_word_takeable_cut";
process.env.PORT = "3788";
process.env.MONGODB_URI = SCRATCH_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "takeable-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "takeablecut-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "takeablecut-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`))
    .default;
  const conn = await mongoose.createConnection(SCRATCH_DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

await import(`${R}/begin.js`);

const { findByName, loadOrFold } = await import(
  `${R}/seed/materials/projections.js`
);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { withIAmAct } = await import(`${R}/seed/sprout.js`);
const { birthBeing } = await import(
  `${R}/seed/materials/being/identity/birth.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { resolveAbleWord, runAbleWord } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { acquisitionHostEnv } = await import(
  `${R}/seed/store/words/acquisition/acquisitionHost.js`
);

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

const cherub = await poll(() => findByName("being", "cherub", "0"));
const birth = async (name) => {
  let bid = null;
  await withIAmAct(`birth ${name}`, async (ctx) => {
    const b = await birthBeing({
      spec: {
        name,
        parentBeingId: cherub.id,
        homeId: cherub.state?.homeSpace,
        cognition: "scripted",
        defaultAble: "global",
      },
      identity: I,
      moment: ctx,
      history: "0",
    });
    bid = b.beingId;
  });
  return bid;
};

// drive the REAL take-able op via doVerb → the cut handler → take-able.word; seal here
async function takeAble(caller, able, space) {
  const branch = "0";
  const sc = {
    actId: randomUUID(),
    actorAct: { branch, history: branch, by: String(caller) },
    identity: { beingId: String(caller), nameId: String(caller) },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(
      { kind: "space", id: String(space) },
      "take-able",
      { able },
      {
        identity: { beingId: String(caller) },
        moment: sc,
        currentHistory: "0",
      },
    );
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    const result = res?.result ?? res; // doVerb may wrap the handler return
    return { result, deltaF: sc.deltaF, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, deltaF: sc.deltaF, refused: e };
    throw e;
  }
}

console.log(
  `\n  verify-take-able-cut (REAL take-able op via doVerb → the cut)\n  DB: ${SCRATCH_DB.split("/").pop()}\n`,
);
try {
  if (!cherub) {
    console.log("  FATAL: genesis failed");
    process.exit(1);
  }
  const ir = resolveAbleWord("acquisition", "take-able");
  ir
    ? ok(`take-able.word resolves through the bridge (self-registered)`)
    : bad(`take-able resolves`, "null");

  // a space with a GRABBABLE able (warrior) + a NON-grabbable able (sage)
  let arena = null;
  await withIAmAct("create arena", async (ctx) => {
    const res = await doVerb(
      { kind: "space", id: String(getSpaceRootId()) },
      "create-space",
      { name: "arena", type: "generic" },
      { identity: I, moment: ctx },
    );
    arena = String(res.spaceId);
  });
  // real install path (host.js): one able per do:set-space at qualities.ables.<name>
  await withIAmAct("install warrior", async (ctx) => {
    await doVerb(
      { kind: "space", id: arena },
      "set-space",
      {
        field: "qualities.ables.warrior",
        value: {
          canSee: [],
          canDo: [],
          canSummon: [],
          acquisition: { grabbed: true },
        },
        merge: false,
      },
      { identity: I, moment: ctx },
    );
  });
  await withIAmAct("install sage", async (ctx) => {
    await doVerb(
      { kind: "space", id: arena },
      "set-space",
      {
        field: "qualities.ables.sage",
        value: {
          canSee: [],
          canDo: [],
          canSummon: [],
          acquisition: { grabbed: false },
        },
        merge: false,
      },
      { identity: I, moment: ctx },
    );
  });
  arena
    ? ok(
        `arena space created with a grabbable able (warrior) + a non-grabbable (sage)`,
      )
    : bad(`arena`, "no space");

  const taker = await birth("taker");
  // (set-space now invalidates the ancestor cache itself — no manual force-fresh needed.)
  console.log(
    `  arena=${arena.slice(0, 10)} taker=${String(taker).slice(0, 10)}\n`,
  );

  // ── 1. take a grabbable able → granted, a real grant-able fact, the being holds it ──
  const t = await takeAble(taker, "warrior", arena);
  t.result?.granted === true && t.result?.able === "warrior"
    ? ok(`take warrior → granted:true`)
    : bad(`granted`, t.refused?.message || t.result);
  const takeFact = (t.deltaF || []).find(
    (f) => f.act === "take-able" && f.params?.able === "warrior",
  );
  takeFact
    ? ok(`a real do:take-able fact laid (the act — every act makes a fact)`)
    : bad(
        `take fact`,
        t.deltaF?.map((f) => f.act),
      );
  takeFact?.params?.grantedBy
    ? ok(
        `it carries the grant record (grantedBy, no clock) — applyAbleGrants folds the grant from the take`,
      )
    : bad(`grant record on the take fact`, takeFact?.params);
  String(takeFact?.by) === String(taker)
    ? ok(
        `the take attributes to the CALLER (nameId = @taker) — caller-attribution default`,
      )
    : bad(
        `caller attribution`,
        `nameId=${takeFact?.by}, want ${String(taker).slice(0, 10)}`,
      );
  const slot = await loadOrFold("being", String(taker), "0");
  (slot?.state?.qualities?.ablesGranted || []).some(
    (r) => (r.able || r) === "warrior",
  )
    ? ok(`@taker now HOLDS the warrior able (ablesGranted)`)
    : bad(`holds able`, slot?.state?.qualities?.ablesGranted);

  // ── 2. idempotent re-take → the take IS stamped (every act makes a fact), but NO duplicate grant ──
  const t2 = await takeAble(taker, "warrior", arena);
  const reTakeFact = (t2.deltaF || []).find(
    (f) => f.act === "take-able" && f.params?.able === "warrior",
  );
  t2.result?.already === true && reTakeFact && !reTakeFact.params?.grantedBy
    ? ok(
        `re-take → already:true; the take IS stamped (do:take-able, outcome:already) but carries NO grant record → nothing re-folds`,
      )
    : bad(`idempotent re-take`, {
        already: t2.result?.already,
        fact: reTakeFact?.params,
      });
  const slot2 = await loadOrFold("being", String(taker), "0");
  (slot2?.state?.qualities?.ablesGranted || []).filter(
    (r) => (r.able || r) === "warrior",
  ).length === 1
    ? ok(
        `@taker still holds warrior EXACTLY once (the re-take folded no duplicate)`,
      )
    : bad(`no duplicate grant`, slot2?.state?.qualities?.ablesGranted);

  // ── 3. a NON-grabbable able → refuse ──
  const t3 = await takeAble(taker, "sage", arena);
  t3.refused && /not take-acquirable/i.test(t3.refused.message)
    ? ok(`take sage (grabbed:false) → refuse "not take-acquirable"`)
    : bad(`not grabbable`, t3.refused?.message || t3.result);

  // ── 4. a able NOT installed → refuse ──
  const t4 = await takeAble(taker, "ghostable", arena);
  t4.refused && /not installed/i.test(t4.refused.message)
    ? ok(`take an uninstalled able → refuse "not installed"`)
    : bad(`not installed`, t4.refused?.message || t4.result);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  process.exit(3);
}
