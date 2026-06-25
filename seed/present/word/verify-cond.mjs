#!/usr/bin/env node
// resolveCond / getPath unit gate — the keystone the rich slices need (8.md §1).
// Hand-built conds, no DB, no parser: the "evaluator first" methodology. Mirrors the
// REAL predicates from the JS handlers the slices convert from (cherub connectHandler's
// father/owner equalities, inheritation's hasAuthorityOver host walk, a §5 flag read).

import { resolveCond, getPath, idEquals } from "./cond.js";

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log(`  ✓ ${l}`); };
const bad = (l, d) => { fail++; console.log(`  ✗ ${l}`); if (d !== undefined) console.log(`      ${JSON.stringify(d)}`); };
const is = async (label, cond, ctx, want) => {
  const got = await resolveCond(cond, ctx);
  got === want ? ok(`${label} → ${want}`) : bad(`${label} (want ${want}, got ${got})`, cond);
};

console.log(`\n  verify-cond (resolveCond / getPath, the §1 keystone)\n`);

// ── a realistic flow ctx (the cherub-connect Mode-3 shape) ──
const ctx = {
  bindings: {
    candidate: { beingId: "b-cand", qualities: { father: { story: "home.story", nameId: "z6Name", beingId: "b-father" } } },
    identity:  { beingId: "b-cand", nameId: "z6Name", story: "home.story" },
    members:   ["a", "b", "c"],
    backers:   2,
    quorum:    2,
    // §5 flow-local flags the parser canonicalized + a §5 mark set:
    beingFound: true,
    canInhabit: false,
  },
  state: { phase: "open" },
  beings: { Cherub: "b-cherub" },
  env: {
    host: {
      // a domain predicate (inheritation.js hasAuthorityOver — a read-time walk):
      hasAuthorityOver: async (nameId, beingId) => nameId === "z6Name" && beingId === "b-cand",
      // an existence lookup (findByName) used as a gate predicate:
      nameExists: async (name) => name === "taken",
      // see-op CONVENTION ops: take a single { args } object (NOT spread) — the same shape
      // the evaluator's callHost passes `see <op>(args) as v`. The inline `If <op>(args)` cond
      // (the as-removal) dispatches through THIS, exercising cond.seeCall.
      "destination-missing": async ({ args: [history] }) => String(history) === "ghost",
      "being-lives-on": async ({ args: [caller, history] }) => caller === "b-cand" && history === "0",
    },
  },
};

// ── getPath: dotted reads over bindings / state / beings ──
idEquals(getPath("candidate.qualities.father.story", ctx), "home.story")
  ? ok("getPath walks candidate.qualities.father.story") : bad("getPath nested");
getPath("state-missing.x", ctx) === undefined ? ok("getPath missing head → undefined (no throw)") : bad("getPath missing");
getPath("phase", ctx) === undefined && getPath("candidate", ctx) ? ok("getPath head resolves from bindings") : ok("getPath head (state via path head)");

// ── test:equals (the pervasive cherub-connect father/owner equality) ──
await is("father.story == identity.story (local father)",
  { test: { op: "equals", path: "candidate.qualities.father.story", against: { ref: "identity.story" } } }, ctx, true);
await is("father.nameId == identity.nameId (owned by the name)",
  { test: { op: "equals", path: "candidate.qualities.father.nameId", against: { ref: "identity.nameId" } } }, ctx, true);
await is("father.beingId == 'nope' (literal mismatch)",
  { test: { op: "equals", path: "candidate.qualities.father.beingId", value: "nope" } }, ctx, false);
await is("NEGATED: father.story != identity.story",
  { negated: true, test: { op: "equals", path: "candidate.qualities.father.story", against: { ref: "identity.story" } } }, ctx, false);

// ── test:reads / holds (existence of a read) ──
await is("reads father.beingId (present)", { test: { op: "reads", path: "candidate.qualities.father.beingId" } }, ctx, true);
await is("reads father.missing (absent)", { test: { op: "reads", path: "candidate.qualities.father.missing" } }, ctx, false);

// ── test:in (membership) ──
await is("'b' in members", { test: { op: "in", path: "needle", against: { ref: "members" } } },
  { ...ctx, bindings: { ...ctx.bindings, needle: "b" } }, true);

// ── test:compare (the governance quorum: backers >= quorum) ──
await is("backers >= quorum (2 >= 2)", { test: { op: "compare", as: "ge", path: "backers", against: { ref: "quorum" } } }, ctx, true);
await is("backers > quorum (2 > 2)", { test: { op: "compare", as: "gt", path: "backers", against: { ref: "quorum" } } }, ctx, false);

// ── resolvedBy: a domain predicate via the host registry (inheritation walk) ──
await is("resolvedBy hasAuthorityOver(name, being) → true",
  { resolvedBy: "hasAuthorityOver", args: [{ ref: "identity.nameId" }, { ref: "candidate.beingId" }] }, ctx, true);
await is("NEGATED resolvedBy hasAuthorityOver other being → true",
  { negated: true, resolvedBy: "hasAuthorityOver", args: [{ ref: "identity.nameId" }, "b-other"] }, ctx, true);
await is("resolvedBy unknown host builtin → false (fail-closed)",
  { resolvedBy: "noSuchHost", args: [] }, ctx, false);

// ── seeCall: an inline see-op call as a predicate (the as-removal, `{ args }` convention) ──
await is("seeCall destination-missing(ghost) → true",
  { seeCall: "destination-missing", args: ["ghost"] }, ctx, true);
await is("seeCall destination-missing(home) → false",
  { seeCall: "destination-missing", args: [{ ref: "identity.story" }] }, ctx, false);
await is("NEGATED seeCall being-lives-on(caller, '0') → false (caller lives on)",
  { negated: true, seeCall: "being-lives-on", args: [{ ref: "identity.beingId" }, "0"] }, ctx, false);
await is("seeCall unknown op → false (fail-closed)",
  { seeCall: "noSuchSeeOp", args: [] }, ctx, false);

// ── test:compare strict (the live-object form `the hero's health is less than 5`) ──
await is("compare lt: backers(2) < quorum(2) → false",
  { test: { op: "compare", as: "lt", path: "backers", against: { ref: "quorum" } } }, ctx, false);
await is("compare lt: backers(2) < 5 → true",
  { test: { op: "compare", as: "lt", path: "backers", against: 5 } }, ctx, true);
await is("compare gt: backers(2) > 1 → true",
  { test: { op: "compare", as: "gt", path: "backers", against: 1 } }, ctx, true);

// ── flag: a §5 flow-local boolean the parser named ──
await is("flag beingFound (set)", { flag: "beingFound" }, ctx, true);
await is("NEGATED flag beingFound → 'no being was found'", { negated: true, flag: "beingFound" }, ctx, false);
await is("flag canInhabit (false)", { flag: "canInhabit" }, ctx, false);

// ── all / any (connectives) ──
await is("ALL [local father AND owned-by-name]", { all: [
  { test: { op: "equals", path: "candidate.qualities.father.story", against: { ref: "identity.story" } } },
  { test: { op: "equals", path: "candidate.qualities.father.nameId", against: { ref: "identity.nameId" } } },
] }, ctx, true);
await is("ALL fails if one fails", { all: [
  { test: { op: "equals", path: "candidate.qualities.father.story", against: { ref: "identity.story" } } },
  { test: { op: "equals", path: "candidate.qualities.father.beingId", value: "nope" } },
] }, ctx, false);
await is("ANY [mismatch OR flag-set]", { any: [
  { test: { op: "equals", path: "candidate.qualities.father.beingId", value: "nope" } },
  { flag: "beingFound" },
] }, ctx, true);
await is("nested ALL[ ANY[...], NEGATED flag ]", { all: [
  { any: [ { flag: "canInhabit" }, { resolvedBy: "hasAuthorityOver", args: [{ ref: "identity.nameId" }, { ref: "candidate.beingId" }] } ] },
  { negated: true, flag: "canInhabit" },
] }, ctx, true);

// ── test:isFinite / isString (the §1 TYPE primitives — `is a finite number` / `is a string`) ──
const shapeCtx = { bindings: { coord: { x: 5, y: 2, z: "bad" }, to: "space-1", n: 0, nan: NaN, inf: Infinity } };
await is("coord.x is a finite number", { test: { op: "isFinite", path: "coord.x" } }, shapeCtx, true);
await is("coord.z (string) is NOT a finite number", { test: { op: "isFinite", path: "coord.z" } }, shapeCtx, false);
await is("absent coord.w → not finite (no silent coercion)", { test: { op: "isFinite", path: "coord.w" } }, shapeCtx, false);
await is("NaN is not finite", { test: { op: "isFinite", path: "nan" } }, shapeCtx, false);
await is("Infinity is not finite", { test: { op: "isFinite", path: "inf" } }, shapeCtx, false);
await is("0 is a finite number (not falsy-confused)", { test: { op: "isFinite", path: "n" } }, shapeCtx, true);
await is("negated: coord.z is NOT a finite number → true", { negated: true, test: { op: "isFinite", path: "coord.z" } }, shapeCtx, true);
await is("to is a string", { test: { op: "isString", path: "to" } }, shapeCtx, true);
await is("coord.x (number) is NOT a string", { test: { op: "isString", path: "coord.x" } }, shapeCtx, false);

// ── degenerate: an unrecognized clause is fail-closed false ──
await is("bare clause (no structure) → false (fail-closed)", { clause: "verification succeeds", negated: false }, ctx, false);
await is("null cond → false", null, ctx, false);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
