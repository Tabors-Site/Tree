// The world-strand gate for the cherub deletion (a fast, dry pre-check).
// Run:  node story/seed/present/word/verify-cherub-shape.mjs
//
// Asserts cherub.word reproduces the WORLD strand the deletion must preserve:
// the five acts in order, the surfaced actor model (I through Cherub), the
// owner (the new Name), and the lineage (mother Cherub, father Arrival). This is
// the cheap shape check; the engine's verify-word-cherub.mjs is the live gate,
// and the full 5-act live byte-diff (after doVerb-in-live-mode lands) is the
// final one. Green here = the .word is a faithful world strand to cut against.

import { readFileSync } from "node:fs";
import { parse } from "./parser.js";
import { evaluate } from "./evaluator.js";

const results = [];
const check = (label, ok, d = "") => {
  results.push(`${ok ? "ok  " : "FAIL"} ${label}${d ? " — " + d : ""}`);
  return ok;
};

const flow = parse(
  readFileSync(
    new URL("../../store/words/cherub/cherub.word", import.meta.url),
    "utf8",
  ),
)[0];
check(
  "cherub.word is one flow with 5 effects",
  flow?.kind === "flow" && flow.effects?.length === 5,
  `effects=${flow?.effects?.length}`,
);

// the five acts, in order (verb:op) — the world strand the JS handler lays
const EXPECT = [
  "do:create-space",
  "be:form-being",
  "do:set-space",
  "do:grant-able",
  "do:set-being",
];
const got = (flow.effects || []).map((e) => `${e.verb}:${e.act}`);
check(
  "the five acts are in the right order",
  JSON.stringify(got) === JSON.stringify(EXPECT),
  got.join(", "),
);

// the implicit-actor model: every act by "I" (the Name), through Cherub (the being)
const allThrough = (flow.effects || []).every(
  (e) => e.by === "I" && e.through === "Cherub",
);
check(
  "every act is by I (the Name) through Cherub (the mother being)",
  allThrough,
);

// the being is the new Name's own (trueName), not I's
const fb = (flow.effects || []).find((e) => e.act === "form-being");
check(
  "form-being sets the being's trueName to the new Name",
  fb?.params?.trueName === "$ownerName",
  String(fb?.params?.trueName),
);

// lineage: mother Cherub, father Arrival
const lin = (flow.effects || []).find((e) => e.act === "set-being")?.params
  ?.value;
check(
  "lineage records mother Cherub, father Arrival",
  lin?.mother === "Cherub" && lin?.father === "Arrival",
  JSON.stringify(lin),
);

// dry-run lays exactly the five facts, in order
const ctx = {
  dryRun: true,
  history: "main",
  moment: { actId: "<actId>" },
  identity: { beingId: "Cherub", name: "cherub", nameId: "I" },
  trigger: { name: "tabor-prime", password: "pw" },
  env: { I: "I" },
  bindings: { placeRoot: "<placeRoot>", ownerName: "tabor" },
};
const facts = await evaluate(flow, ctx);
const factShape = facts.map((f) => `${f.verb}:${f.act}`);
check(
  "dry-run lays the five facts in order",
  JSON.stringify(factShape) ===
    JSON.stringify([
      "do:create-space",
      "be:birth",
      "do:set-space",
      "do:grant-able",
      "do:set-being",
    ]),
  factShape.join(", "),
);

const failures = results.filter((r) => r.startsWith("FAIL")).length;
console.log("\n" + results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} passed\n`);
process.exit(failures ? 1 : 0);
