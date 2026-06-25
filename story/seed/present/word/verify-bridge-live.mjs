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
// Full begin.js boot. Scratch file store under a per-pid base, wiped at start and end.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../.."); // story/
const SCRATCH = path.join(os.tmpdir(), "story_word_bridge_live-" + process.pid);
process.env.PORT = "3864";
process.env.TREEOS_STORE_BASE = SCRATCH;
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "bridgelive-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "bridgelive-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "bridgelive-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

// Full genesis: I, cherub (+ its ables, incl. the self-registered cherub.word and
// the do:grant-able / human able the flow dispatches), the seed delegates, the story.
await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { resolveAbleWord, runAbleWord, bornBeingFrom } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
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
  if (d) console.log(`      ${d}`);
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
  `\n  verify-bridge-live (runAbleWord drives the full 5-act diff)\n  store: ${SCRATCH.split("/").pop()}\n`,
);
try {
  const history = "0";
  const cherub = await poll(() => findByName("being", "cherub", history));
  if (!cherub) {
    console.log("  FATAL: genesis failed (no cherub)");
    process.exit(1);
  }
  const arrival = await findByName("being", "arrival", history);
  const placeRoot = String(getSpaceRootId());
  console.log(
    `  cherub=${cherub.id} placeRoot=${placeRoot} history=${history}`,
  );

  // the arriving Name (the father, via arrival), declared first so form-being's
  // trueName = a declared Name.
  let ownerName = null;
  {
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
  }
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

  await runAbleWord(ir, {
    moment,
    history,
    trigger: { name: "tabor-prime", password: "wordpass" },
    bindings: {
      ownerName: String(ownerName),
      placeRoot,
    },
    beings: {
      Cherub: String(cherub.id),
      ...(arrival ? { Arrival: String(arrival.id) } : {}),
    },
    through: String(cherub.id),
    iam: "i-am",
  });

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
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  try {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  } catch {}
  process.exit(3);
}
