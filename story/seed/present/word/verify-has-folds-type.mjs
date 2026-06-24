#!/usr/bin/env node
// verify-has-folds-type — the DECLARATION HALF of the matter-type ← fold convergence (all-rules-fold).
//
// "A meal has a calorie." is the SCHEMA: declaring that Word folds a matter TYPE `meal` carrying a
// FIELD `calorie` — no JS registry edit, the type is a fact (a kind:"type" coin) on the chain. This
// verifier asserts:
//   1. the parser shapes "A meal has a calorie." → {kind:"has", subject:"meal", property:"calorie",
//      optional:false} (the real node shape the apply-pass reads);
//   2. running that Word via runWordToStore lays a kind:"type" coin for `meal` with the calorie field;
//   3. getMatterType("meal") (FOLD) returns a typeDef carrying that field, with NO Map entry (the Map
//      never had "meal" — it folded purely from the `has` fact);
//   4. "A meal may have a garnish." APPENDS a second field optional:true (the field-set is the fold of
//      BOTH facts);
//   5. re-declaring "A meal has a calorie." is a CAS no-op (skipIfUnchanged — the fold already carries it);
//   6. the evaluator no longer THROWS on has/accepts/carries/claims (the regression guard).
//
// Models verify-typesfold's boot harness (a real DB + begin.js boot; the seed vocabulary on "0").
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R = path.resolve(__dirname, "../../..");
const DB = "mongodb://localhost:27017/story_hasfoldstype";
process.env.PORT = "3843";
process.env.MONGODB_URI = DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || "hasfoldstype-0123456789";
process.env.STORY_KEY_DIR = path.join(
  os.tmpdir(),
  "hasfoldstype-keys-" + process.pid,
);
fs.rmSync(process.env.STORY_KEY_DIR, { recursive: true, force: true });
const SRC = path.join(os.tmpdir(), "hasfoldstype-src");
fs.rmSync(SRC, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(SRC, "x.txt"), "x\n");
process.env.SOURCE_TREE_ROOT = SRC;
{
  const mongoose = (await import(`${R}/node_modules/mongoose/index.js`))
    .default;
  const conn = await mongoose.createConnection(DB).asPromise();
  await conn.dropDatabase();
  await conn.close();
}

// ── (6) the REGRESSION guard runs BEFORE boot (standalone — evaluator imports only pure cond.js) ──
let pass = 0,
  fail = 0;
const ok = (l) => {
  pass++;
  console.log("  ✓ " + l);
};
const bad = (l, d) => {
  fail++;
  console.log("  ✗ " + l);
  if (d !== undefined) console.log("      " + JSON.stringify(d));
};
console.log(
  '\n  verify-has-folds-type ("a X has Y" folds type X with field Y)\n',
);

const { parse } = await import("./parser.js");
const { evaluate } = await import("./evaluator.js");

// (1) the parser shape
{
  const ir = parse("A meal has a calorie.");
  const n = ir[0];
  n &&
  n.kind === "has" &&
  n.subject === "meal" &&
  n.property === "calorie" &&
  n.optional === false
    ? ok(
        '(1) parse("A meal has a calorie.") → {kind:has, subject:meal, property:calorie, optional:false}',
      )
    : bad("(1) parser shape", n);
}

// (6) the evaluator no longer throws on has/accepts/carries/claims (it folds them IS-side into ctx.laws)
{
  const nodes = [
    {
      kind: "has",
      subject: "meal",
      property: "calorie",
      optional: false,
      gloss: null,
    },
    { kind: "accepts", subject: "meal", items: ["text"] },
    { kind: "carries", subject: "meal", items: ["image/png"] },
    { kind: "claims", subject: "meal", items: [".meal"] },
  ];
  const ctx = {
    dryRun: true,
    history: "0",
    identity: { beingId: "b1" },
    bindings: {},
    beings: {},
    trigger: {},
    env: {},
    flows: [],
  };
  try {
    await evaluate(nodes, ctx);
    (ctx.laws || []).length === 4
      ? ok(
          "(6) evaluator folds has/accepts/carries/claims IS-side (4 laws), no throw (regression guard)",
        )
      : bad("(6) 4 laws collected", { laws: (ctx.laws || []).length });
  } catch (e) {
    bad("(6) evaluator threw on a type-schema node", e.message);
  }
}

// ── boot the substrate for the FOLD assertions (2)-(5) ──
await import(`${R}/begin.js`);
const { findByName } = await import(`${R}/seed/materials/projections.js`);
const { runWordToStore } = await import(
  `${R}/seed/present/word/ableWordRegistry.js`
);
const { getMatterType, listMatterTypes } = await import(
  `${R}/seed/materials/matter/types.js`
);
const { resolveTypeFromFold } = await import(
  `${R}/seed/present/word/wordStore.js`
);
const { I } = await import(`${R}/seed/materials/being/seedBeings.js`);
const { default: Fact } = await import(`${R}/seed/past/fact/fact.js`);
const { doVerb } = await import(`${R}/seed/ibp/verbs/do.js`);
const { sealFacts } = await import(`${R}/seed/past/fact/facts.js`);
const { getSpaceRootId } = await import(`${R}/seed/sprout.js`);
const { randomUUID } = await import("crypto");
const poll = async (fn, ck, t = 20000, e = 300) => {
  const t0 = Date.now();
  while (Date.now() - t0 < t) {
    const v = await fn();
    if (ck ? ck(v) : v) return v;
    await new Promise((r) => setTimeout(r, e));
  }
  return await fn();
};
// A REAL create-matter via doVerb (caller = I), the same shape verify-creatematter-cut uses.
const ident = { beingId: I, name: "i-am", nameId: "i-am" };
const createMatter = async (params) => {
  const sc = {
    actId: randomUUID(),
    actorAct: { history: "0", by: "i-am" },
    identity: ident,
    deltaF: [],
    foldedSeqs: new Map(),
    afterSeal: [],
  };
  try {
    const res = await doVerb(
      { kind: "space", id: String(getSpaceRootId()) },
      "create-matter",
      params,
      { identity: ident, moment: sc, currentHistory: "0" },
    );
    if (sc.deltaF.length) await sealFacts(sc.deltaF);
    return { result: res?.result ?? res, refused: null };
  } catch (e) {
    if (e && (e.name === "IbpError" || e.code))
      return { result: null, refused: e };
    throw e;
  }
};

try {
  await poll(
    () => findByName("being", "i-am", "0"),
    (v) => !!v,
  );

  // SANITY: "meal" is NOT a Map type — the fold mints it purely from the `has` fact.
  const inMapBefore = listMatterTypes().some((t) => t.name === "meal");
  inMapBefore
    ? bad("pre: meal already in the Map (test fixture polluted)", "meal")
    : ok(
        'pre: "meal" is NOT a registered Map type (it will fold from the Word)',
      );

  // (2) run "A meal has a calorie." as a Word → lay a kind:"type" coin for `meal` with the field.
  await runWordToStore(parse("A meal has a calorie."), {
    beingId: I,
    name: I,
    history: "0",
  });
  const coin = await Fact.findOne({
    verb: "do",
    act: "coin",
    "params.word": "meal",
    history: "0",
  })
    .sort({ seq: -1 })
    .lean();
  coin &&
  coin.params?.binding?.kind === "type" &&
  Array.isArray(coin.params.binding.fields) &&
  coin.params.binding.fields.some(
    (f) => f.name === "calorie" && f.optional === false,
  )
    ? ok(
        "(2) running the Word laid a kind:type coin fact for `meal` carrying field {name:calorie, optional:false}",
      )
    : bad("(2) coin fact / field", coin?.params?.binding);

  // (3) getMatterType("meal") resolves from the FOLD (resolveTypeFromFold), NOT the Map.
  const fold = resolveTypeFromFold("meal");
  const got = getMatterType("meal");
  const hasCalorie = (d) =>
    d &&
    Array.isArray(d.fields) &&
    d.fields.some((f) => f.name === "calorie" && f.optional === false);
  hasCalorie(fold) && hasCalorie(got)
    ? ok(
        '(3) getMatterType("meal") returns a typeDef with the calorie field — resolved from the fold',
      )
    : bad("(3) fold typeDef", { fold, got });
  listMatterTypes().some((t) => t.name === "meal")
    ? bad("(3) meal leaked into the Map (should be fold-only)", "meal")
    : ok(
        '(3) NO Map entry for "meal" — the type exists purely as a fold of the `has` fact',
      );

  // (4) "A meal may have a garnish." APPENDS a second field optional:true (the fold of both facts).
  await runWordToStore(parse("A meal may have a garnish."), {
    beingId: I,
    name: I,
    history: "0",
  });
  const two = getMatterType("meal");
  const calorie = (two?.fields || []).find((f) => f.name === "calorie");
  const garnish = (two?.fields || []).find((f) => f.name === "garnish");
  calorie &&
  calorie.optional === false &&
  garnish &&
  garnish.optional === true &&
  two.fields.length === 2
    ? ok(
        '(4) "may have a garnish" appended field {garnish, optional:true} — the field-set is the FOLD of both facts',
      )
    : bad("(4) two fields", two?.fields);

  // (5) re-declaring "A meal has a calorie." is a CAS no-op (skipIfUnchanged — no new coin).
  const coinsBefore = await Fact.countDocuments({
    verb: "do",
    act: "coin",
    "params.word": "meal",
    history: "0",
  });
  await runWordToStore(parse("A meal has a calorie."), {
    beingId: I,
    name: I,
    history: "0",
  });
  const coinsAfter = await Fact.countDocuments({
    verb: "do",
    act: "coin",
    "params.word": "meal",
    history: "0",
  });
  const stillTwo = (getMatterType("meal")?.fields || []).length === 2;
  coinsAfter === coinsBefore && stillTwo
    ? ok(
        `(5) re-declaring "A meal has a calorie." is a CAS no-op (coin facts ${coinsBefore} → ${coinsAfter}, still 2 fields)`,
      )
    : bad("(5) re-declare not idempotent", {
        coinsBefore,
        coinsAfter,
        fields: getMatterType("meal")?.fields?.length,
      });

  // ── §4 REQUIRED-FIELD validation at create-matter (the `has` schema enforced) ──
  // `meal` carries a REQUIRED `calorie` (and an OPTIONAL `garnish`). A declared field Y maps to the
  // quality path qualities.<type>.<Y> — here qualities.meal.calorie.

  // (7) create-matter of type `meal` WITHOUT the required calorie → throws "requires field".
  const noCal = await createMatter({
    name: "lunch",
    type: "meal",
    content: null,
    qualities: { meal: { garnish: "parsley" } },
  });
  noCal.refused && /requires field "calorie"/.test(noCal.refused.message || "")
    ? ok(
        `(7) create-matter type=meal, no calorie → refused "${(noCal.refused.message || "").slice(0, 52)}..."`,
      )
    : bad(
        "(7) required-field missing did not refuse",
        noCal.refused?.message || noCal.result,
      );

  // (8) create-matter WITH the required calorie → succeeds (a matterId comes back).
  const withCal = await createMatter({
    name: "dinner",
    type: "meal",
    content: null,
    qualities: { meal: { calorie: 600 } },
  });
  withCal.result?.matterId && !withCal.refused
    ? ok(
        `(8) create-matter type=meal WITH calorie → succeeds (matterId ${String(withCal.result.matterId).slice(0, 10)}…)`,
      )
    : bad(
        "(8) required-field present should succeed",
        withCal.refused?.message || withCal.result,
      );

  // (9) the OPTIONAL garnish missing (but required calorie present) → succeeds. Optional ("may have")
  //     fields are never required (the validation is required-set, not a closed allowlist).
  const noGarnish = await createMatter({
    name: "snack",
    type: "meal",
    content: null,
    qualities: { meal: { calorie: 150 } },
  });
  noGarnish.result?.matterId && !noGarnish.refused
    ? ok(
        `(9) create-matter type=meal, calorie present + OPTIONAL garnish absent → succeeds (optional fields are not required)`,
      )
    : bad(
        "(9) optional-field absent should succeed",
        noGarnish.refused?.message || noGarnish.result,
      );

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.log("\n  ! crashed: " + (e.stack || e.message));
  process.exit(3);
}
