#!/usr/bin/env node
// The bridge's live entry point, end to end. Where verify-cherub-live.mjs hand-built
// the I-through-Cherub ctx and called evaluate() directly, THIS drives the SAME
// five-act diff through `runAbleWord` from a REALISTIC summoner moment (the arrival's
// attribution, `_inOp` NOT preset) — proving runAbleWord derives the actor model the
// green diff proved (overrides identity + actorAct.by to i-am, shares the chain),
// so the birthHandler cut is a trivial call into this one tested entry point.
//
// Two assertions beyond the green seven: the laid facts attribute to I (the
// override worked), and the caller's own moment is UNTOUCHED (the derivation is
// clean — the host session strand that follows reads the real moment, not i-am).
// Isolated test DB, wiped at start and end.
import os from "os";

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
process.env.MONGODB_URI = "mongodb://localhost:27017/story-word-bridge-live";

const mongoose = (await import("../../seedStory/dbConfig.js")).default;
if (mongoose.connection.readyState !== 1) {
  await new Promise((res, rej) => {
    mongoose.connection.once("connected", res);
    mongoose.connection.once("error", rej);
  });
}
if (mongoose.connection.name !== "story-word-bridge-live") {
  console.log(`  REFUSING wrong DB ${mongoose.connection.name}`);
  process.exit(2);
}

await import("../../materials/space/ops.js");
await import("../../materials/matter/ops.js");
await import("../../materials/being/ops.js");
// grant-able + cherub were carved into store-word bundles; import them so do:grant-able
// dispatches and resolveAbleWord("cherub","birth") resolves (the engine built-in map is retired).
await import("../../store/words/grant-able/index.js");
await import("../../store/words/cherub/able.js");

const { registerAble } = await import("../../present/ables/registry.js");
const { humanAble } = await import("../../present/ables/human/able.js");
try {
  registerAble("human", humanAble);
} catch {
  /* already registered */
}

const { ensureSpaceRoot, ensureIAm } = await import("../../sprout.js");
const { findByName } = await import("../../materials/projections.js");
const { ensureSeedDelegates } =
  await import("../../materials/being/seedDelegates.js");
const { sealFacts } = await import("../../past/fact/facts.js");
const { nameVerb } = await import("../../ibp/verbs/name.js");
const { resolveAbleWord, runAbleWord, bornBeingFrom } =
  await import("./ableWordRegistry.js");

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
  `\n  verify-bridge-live (runAbleWord drives the full 5-act diff)\n  DB: ${mongoose.connection.name}\n`,
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
  // fold-only dispatch: the words declare themselves onto I's reel BEFORE any do-op dispatches
  // (ensureSpaceRoot's create-space). Mirrors genesis.js (ensureIAm -> the words -> the story).
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
  });
  const spaceRoot = await withRetry(() => ensureSpaceRoot());
  await withRetry(() => ensureSeedDelegates(spaceRoot._id));
  const history = "0";
  const cherub = await findByName("being", "cherub", history);
  if (!cherub) throw new Error("no cherub");
  const arrival = await findByName("being", "arrival", history);
  console.log(
    `  cherub=${cherub.id} placeRoot=${spaceRoot._id} history=${history}`,
  );

  // the arriving Name (the father, via arrival), declared first so form-being's
  // trueName = a declared Name.
  let ownerName = null;
  await withRetry(async () => {
    const sc = {
      actId: randomUUID(),
      actorAct: { history, by: "i-am" },
      identity: { beingId: "i-am", name: "I", nameId: "i-am" },
      deltaF: [],
      foldedSeqs: new Map(),
      afterSeal: [],
    };
    ownerName = (
      await nameVerb(
        "declare",
        { name: "tabor", password: "pw12345678", soulType: "human" },
        { identity: sc.identity, moment: sc, currentHistory: history },
      )
    ).nameId;
    await sealFacts(sc.deltaF);
  });
  console.log(
    `  arriving Name (father) = ${String(ownerName).slice(0, 14)}…\n`,
  );

  const ir = resolveAbleWord("cherub", "birth");

  // A REALISTIC summoner moment: attribution is the arriving NAME (NOT i-am), and
  // `_inOp` is NOT preset — exactly what birthHandler hands the bridge. runAbleWord
  // must derive the i-am-through-Cherub actor model itself.
  const moment = {
    actId: randomUUID(),
    actorAct: { history, by: String(ownerName) },
    identity: {
      beingId: String(arrival?.id ?? "arrival"),
      name: "tabor",
      nameId: String(ownerName),
    },
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  const sealedActorAct = JSON.stringify(moment.actorAct);

  await withRetry(() =>
    runAbleWord(ir, {
      moment,
      history,
      trigger: { name: "tabor-prime", password: "wordpass" },
      bindings: {
        ownerName: String(ownerName),
        placeRoot: String(spaceRoot._id),
      },
      beings: {
        Cherub: String(cherub.id),
        ...(arrival ? { Arrival: String(arrival.id) } : {}),
      },
      through: String(cherub.id),
      iam: "i-am",
    }),
  );

  console.log(`  runAbleWord laid ${moment.deltaF.length} fact(s):`);
  for (const f of moment.deltaF)
    console.log(
      `    ${f.verb}:${f.act} (by ${String(f.by).slice(0, 8)}) -> ${f.of?.kind}:${String(f.of?.id ?? "").slice(0, 10)}`,
    );
  console.log("");

  // ── the green seven (the world strand the cut must preserve) ──
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

  const setSpace = moment.deltaF.find((f) => f.act === "set-space");
  String(setSpace?.params?.value ?? setSpace?.params?.owner) === newBeingId
    ? ok(`home owner set to the new being`)
    : bad(`home owner = new being`, JSON.stringify(setSpace?.params));

  const humanGrant = moment.deltaF.find(
    (f) => f.act === "grant-able" && f.params?.able === "human",
  );
  humanGrant
    ? ok(`human able granted on the new being`)
    : bad(`human able granted`, "no human grant-able fact");

  const lv = moment.deltaF.find((f) => f.act === "set-being")?.params?.value;
  String(lv?.mother) === String(cherub.id) &&
  (!arrival || String(lv?.father) === String(arrival.id))
    ? ok(
        `lineage: mother=Cherub, father=Arrival (proper names resolved to ids)`,
      )
    : bad(`lineage`, JSON.stringify(lv));

  await sealFacts(moment.deltaF);
  const born = await findByName("being", "tabor-prime", history);
  born
    ? ok(
        `@tabor-prime materializes after seal (${String(born.id).slice(0, 10)}…)`,
      )
    : bad(`@tabor-prime materializes`, "no row");

  // ── the two new assertions: the derivation is correct AND clean ──
  const allByIam = moment.deltaF.every((f) => String(f.by) === "i-am");
  allByIam
    ? ok(`every laid fact attributes to I (the actor-model override worked)`)
    : bad(`facts attribute to I`, moment.deltaF.map((f) => f.by).join(", "));

  JSON.stringify(moment.actorAct) === sealedActorAct
    ? ok(
        `caller's moment.actorAct UNTOUCHED (derivation is clean, session strand safe)`,
      )
    : bad(
        `caller moment untouched`,
        `was ${sealedActorAct}, now ${JSON.stringify(moment.actorAct)}`,
      );

  // ── bornBeingFrom: what the session strand reads ──
  const being = bornBeingFrom(moment.deltaF);
  being &&
  being.name === "tabor-prime" &&
  String(being.trueName) === String(ownerName) &&
  being._id
    ? ok(
        `bornBeingFrom reconstructs { _id, name:@tabor-prime, trueName } for the session strand`,
      )
    : bad(`bornBeingFrom`, JSON.stringify(being));

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
