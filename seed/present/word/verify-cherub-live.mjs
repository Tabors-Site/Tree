#!/usr/bin/env node
// The FULL live diff for the cherub deletion (step 1): run ALL FIVE acts of
// cherub.word through the evaluator LIVE against the real store, and assert
// the world strand the cut must preserve (create-space, be:birth, set-space,
// grant-able, set-being) under the resolved actor model (I through Cherub,
// the being the new Name's own, mother Cherub / father Arrival).
//
// Builds on verify-word-cherub.mjs (which proved form-being live). The new piece
// is the home-id flow: env.mintId pre-mints the home id (like the JS handler's
// uuidv4), create-space builds it there, form-being + set-space reference it.
// Full begin.js boot. Scratch file store under a per-pid base, wiped at start and end.
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../.."); // story/
const SCRATCH = path.join(os.tmpdir(), "story_word_cherub_live-" + process.pid);
process.env.PORT = "3863";
process.env.TREEOS_STORE_BASE = SCRATCH;
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "cherublive-secret-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "cherublive-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "cherublive-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;

// (scratch file store fresh-wiped above; no DB to drop)

// Full genesis: I, cherub (+ its ables, including the self-registered cherub.word
// and the do:grant-able / human able the flow needs), the seed delegates, the story.
await import(`${R}/begin.js`);

const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { nameVerb } = await import(`${R}/seed/ibp/verbs/name.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { evaluate } = await import(`${R}/seed/present/word/evaluator.js`);
const { resolveAbleWord } = await import(
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
  `\n  verify-cherub-live (the full 5-act diff)\n  store: ${SCRATCH.split("/").pop()}\n`,
);
try {
  const branch = "0";
  const cherub = await poll(() => findByName("being", "cherub", branch));
  if (!cherub) {
    console.log("  FATAL: genesis failed (no cherub)");
    process.exit(1);
  }
  const arrival = await findByName("being", "arrival", branch); // the father being (the floor); may be absent
  const placeRoot = String(getSpaceRootId());
  console.log(
    `  cherub=${cherub.id} placeRoot=${placeRoot} branch=${branch}`,
  );

  // the arriving Name (the father, via arrival) — declared first so the being
  // can be its own (form-being's trueName = a declared Name).
  let ownerName = null;
  {
    const sc = {
      actId: randomUUID(),
      actorAct: { branch, history: branch, by: "i-am" },
      identity: { beingId: "i-am", name: "I", nameId: "i-am" },
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
  }
  console.log(
    `  arriving Name (father) = ${String(ownerName).slice(0, 14)}…\n`,
  );

  // run cherub.word's full flow LIVE through the bridge's resolved IR
  const ir = resolveAbleWord("cherub", "birth");
  const flow = ir[0];
  // The actor is I (the story), acting THROUGH the Cherub being (bridge.md:
  // "by I, through Cherub"). name = "i-am" short-circuits authorize (the
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
      placeRoot,
    },
    beings: {
      Cherub: String(cherub.id),
      ...(arrival ? { Arrival: String(arrival.id) } : {}),
    }, // proper-name -> id (7.md)
    trigger: { name: "tabor-prime", password: "wordpass" },
    deltaF: moment.deltaF,
    flows: [],
  };
  await evaluate(flow, ctx);

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
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
} catch (err) {
  console.log(`\n  ! crashed: ${err.stack || err.message}`);
  try {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  } catch {}
  process.exit(3);
}
