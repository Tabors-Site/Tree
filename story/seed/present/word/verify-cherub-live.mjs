#!/usr/bin/env node
// The FULL live diff for the cherub deletion (step 1): run ALL FIVE acts of
// cherub.word through the evaluator LIVE against the real substrate, and assert
// the world strand the cut must preserve (create-space, be:birth, set-space,
// grant-able, set-being) under the resolved actor model (I_AM through Cherub,
// the being the new Name's own, mother Cherub / father Arrival).
//
// Builds on verify-word-cherub.mjs (which proved form-being live). The new piece
// is the home-id flow: env.mintId pre-mints the home id (like the JS handler's
// uuidv4), create-space builds it there, form-being + set-space reference it.
// Isolated test DB, wiped at start and end.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storyRoot = path.resolve(__dirname, "../../..");
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
process.env.MONGODB_URI = "mongodb://localhost:27017/story-word-cherub-live";

const mongoose = (await import("../../seedStory/dbConfig.js")).default;
if (mongoose.connection.readyState !== 1) {
  await new Promise((res, rej) => {
    mongoose.connection.once("connected", res);
    mongoose.connection.once("error", rej);
  });
}
if (mongoose.connection.name !== "story-word-cherub-live") {
  console.log(`  REFUSING wrong DB ${mongoose.connection.name}`);
  process.exit(2);
}

await import("../../materials/space/ops.js");
await import("../../materials/matter/ops.js");
await import("../../materials/being/ops.js");

// genesis-completeness shim for the isolated test DB: the real boot registers the
// seed ables during genesis; here we register the one cherub.word grants (human)
// so the explicit grant-able op (which checks the registry) resolves it.
const { registerAble } = await import("../../present/ables/registry.js");
const { humanAble } = await import("../../present/ables/human/able.js");
try {
  registerAble("human", humanAble);
} catch {
  /* already registered */
}
// The full boot imports cherub/able.js (via services.js / beOps.js), whose top-level
// registerAbleWord("cherub","birth"|"connect") self-registers the cherub words. The
// isolated test DB skips that boot, so import the module here to populate the registry —
// otherwise resolveAbleWord("cherub","birth") returns null. (Sibling cut harnesses import
// it for cherubBeOps; cherub-live needs only the registration side effect.)
await import("../../store/words/cherub/able.js");
// cherub.word's flow emits a do:grant-able; that op self-registers on import of its
// word module (the full boot pulls it in). Import it so the dispatched act resolves.
await import("../../store/words/grant-able/index.js");

const { ensureSpaceRoot, ensureIAm } = await import("../../sprout.js");
const { findByName } = await import("../../materials/projections.js");
const { ensureSeedDelegates } =
  await import("../../materials/being/seedDelegates.js");
const { sealFacts } = await import("../../past/fact/facts.js");
const { nameVerb } = await import("../../ibp/verbs/name.js");
const { evaluate } = await import("./evaluator.js");
const { resolveAbleWord } = await import("./ableWordRegistry.js");

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
async function withRetry(fn, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String(e?.message || e);
      if (
        i < tries - 1 &&
        /catalog changes|acquire .* lock|please retry|WriteConflict|TransientTransaction/i.test(
          m,
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
  `\n  verify-cherub-live (the full 5-act diff)\n  DB: ${mongoose.connection.name}\n`,
);
try {
  await mongoose.connection.db.dropDatabase();
  for (const c of [
    "facts",
    "acts",
    "beings",
    "spaces",
    "matters",
    "reels",
    "reelheads",
    "names",
    "stamps",
  ]) {
    try {
      await mongoose.connection.db.createCollection(c);
    } catch {}
  }
  await withRetry(() => ensureIAm());
  // fold-only dispatch: the words declare themselves onto I_AM's reel BEFORE any do-op dispatches
  // (ensureSpaceRoot's create-space). Mirrors genesis.js (ensureIAm -> the words -> the story).
  await withRetry(async () => {
    const wc = {
      actId: randomUUID(),
      actorAct: { history: "0", by: "i-am" },
      identity: { beingId: "i-am", name: "I_AM", nameId: "i-am" },
      deltaF: [],
      foldedSeqs: new Map(),
      afterSeal: [],
    };
    const { seedFold } = await import("./wordFold.js");
    await seedFold({ moment: wc });
    await sealFacts(wc.deltaF);
    const { rehydrateWordProjection } = await import("./wordStore.js");
    await rehydrateWordProjection("0");
  });
  const spaceRoot = await withRetry(() => ensureSpaceRoot());
  await withRetry(() => ensureSeedDelegates(spaceRoot._id));
  const branch = "0";
  const cherub = await findByName("being", "cherub", branch);
  if (!cherub) throw new Error("no cherub");
  const arrival = await findByName("being", "arrival", branch); // the father being (the floor); may be absent
  console.log(
    `  cherub=${cherub.id} placeRoot=${spaceRoot._id} branch=${branch}`,
  );

  // the arriving Name (the father, via arrival) — declared first so the being
  // can be its own (form-being's trueName = a declared Name).
  let ownerName = null;
  await withRetry(async () => {
    const sc = {
      actId: randomUUID(),
      actorAct: { branch, history: branch, by: "i-am" },
      identity: { beingId: "i-am", name: "I_AM", nameId: "i-am" },
      deltaF: [],
      foldedSeqs: new Map(),
      afterSeal: [],
    };
    ownerName = (
      await nameVerb(
        "declare",
        { name: "tabor", password: "pw12345678", soulType: "human" },
        { identity: sc.identity, moment: sc, currentHistory: branch },
      )
    ).nameId;
    await sealFacts(sc.deltaF);
  });
  console.log(
    `  arriving Name (father) = ${String(ownerName).slice(0, 14)}…\n`,
  );

  // run cherub.word's full flow LIVE through the bridge's resolved IR
  const ir = resolveAbleWord("cherub", "birth");
  const flow = ir[0];
  // The actor is I_AM (the story), acting THROUGH the Cherub being (bridge.md:
  // "by I_AM, through Cherub"). name = "i-am" short-circuits authorize (the
  // bootstrap axiom), beingId = cherub is the being. _inOp mirrors runAbleWord
  // (the whole flow is one op; do-acts dispatch as nested sub-ops).
  const moment = {
    actId: randomUUID(),
    actorAct: { branch, history: branch, by: "i-am" },
    identity: { beingId: String(cherub.id), name: "i-am", nameId: "i-am" },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
    _inOp: true,
  };
  const ctx = {
    dryRun: false,
    branch,
    history: branch,
    moment,
    identity: moment.identity,
    env: { iam: "i-am", mintId: () => randomUUID() }, // pre-mint ids for `bind` sites (the home)
    bindings: {
      name: "tabor-prime",
      password: "wordpass",
      ownerName: String(ownerName),
      placeRoot: String(spaceRoot._id),
    },
    beings: {
      Cherub: String(cherub.id),
      ...(arrival ? { Arrival: String(arrival.id) } : {}),
    }, // proper-name -> id (7.md)
    trigger: { name: "tabor-prime", password: "wordpass" },
    deltaF: moment.deltaF,
    flows: [],
  };
  await withRetry(() => evaluate(flow, ctx));

  console.log(`  cherub.word laid ${moment.deltaF.length} fact(s):`);
  for (const f of moment.deltaF)
    console.log(
      `    ${f.verb}:${f.act} -> ${f.of?.kind}:${String(f.of?.id ?? "").slice(0, 10)}`,
    );
  console.log("");

  const shape = moment.deltaF.map((f) => `${f.verb}:${f.act}`);
  const EXPECT = [
    "do:create-space",
    "be:birth",
    "do:set-space",
    "do:grant-able",
    "do:set-being",
  ];
  EXPECT.every((e) => shape.includes(e))
    ? ok(`all five world acts present (${shape.join(", ")})`)
    : bad(`five acts present`, shape.join(", "));

  const birth = moment.deltaF.find((f) => f.verb === "be" && f.act === "birth");
  birth?.params?.name === "tabor-prime"
    ? ok(`be:birth names @tabor-prime`)
    : bad(`be:birth names @tabor-prime`, birth?.params?.name);
  String(birth?.params?.trueName) === String(ownerName)
    ? ok(`being is the new Name's own (trueName = the arriving Name)`)
    : bad(`trueName = arriving Name`, `got ${birth?.params?.trueName}`);
  const newBeingId = String(birth?.of?.id ?? birth?.through);

  // the home owner = the new being (JS handler step 3: set-space owner = result.beingId)
  const setSpace = moment.deltaF.find((f) => f.act === "set-space");
  String(setSpace?.params?.value ?? setSpace?.params?.owner) === newBeingId
    ? ok(`home owner set to the new being`)
    : bad(`home owner = new being`, JSON.stringify(setSpace?.params));

  // the human able is granted (JS handler step 4, the explicit grant cherub.word reproduces)
  const humanGrant = moment.deltaF.find(
    (f) => f.act === "grant-able" && f.params?.able === "human",
  );
  humanGrant
    ? ok(`human able granted on the new being`)
    : bad(`human able granted`, "no human grant-able fact");

  // lineage mother = Cherub, father = Arrival, resolved to being ids (JS handler step 5)
  const lv = moment.deltaF.find((f) => f.act === "set-being")?.params?.value;
  String(lv?.mother) === String(cherub.id) &&
  (!arrival || String(lv?.father) === String(arrival.id))
    ? ok(
        `lineage: mother=Cherub, father=Arrival (proper names resolved to ids)`,
      )
    : bad(`lineage`, JSON.stringify(lv));

  await sealFacts(moment.deltaF);
  const born = await findByName("being", "tabor-prime", branch);
  born
    ? ok(
        `@tabor-prime materializes after seal (${String(born.id).slice(0, 10)}…)`,
      )
    : bad(`@tabor-prime materializes`, "no row");

  // double-push guard (engine's flag): a LIVE plain-verb emit() with a SHARED
  // deltaF (as runAbleWord sets) must list the fact ONCE, not twice. cherub.word
  // never reaches emit() (all doVerb/form-being), but the rich slices will, so
  // probe emit() directly: a be-op != form-being falls through evalAct to emit().
  const probeSc = {
    actId: randomUUID(),
    actorAct: { branch, history: branch, by: "i-am" },
    identity: { beingId: String(cherub.id), name: "i-am", nameId: "i-am" },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
    _inOp: true,
  };
  const probeCtx = {
    dryRun: false,
    branch,
    history: branch,
    moment: probeSc,
    identity: probeSc.identity,
    env: { iam: "i-am" },
    bindings: {},
    flows: [],
    deltaF: probeSc.deltaF /* SHARED, as runAbleWord does */,
  };
  await evaluate(
    [{ kind: "act", verb: "be", act: "probe-emit", by: "I" }],
    probeCtx,
  );
  probeSc.deltaF.length === 1
    ? ok(
        `live plain emit() lists the fact ONCE (no double-push on shared deltaF)`,
      )
    : bad(
        `emit() double-push guard`,
        `deltaF.length=${probeSc.deltaF.length} (expected 1)`,
      );

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  try {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  } catch {}
  process.exit(3);
}
