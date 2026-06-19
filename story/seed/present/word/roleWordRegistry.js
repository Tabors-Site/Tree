// The bridge registry (host): (role, be-op) -> a parsed `.word` program.
//
// Where a BE op would dispatch to its JS role handler, the stamper first consults
// this registry; if a `.word` program is present it runs via the evaluator in
// LIVE mode with the moment's moment, else it falls through to the JS handler
// (2.md Phase 4, the dual registry, preferring `.word`). This is the only new
// host code the conversion needs; the rest is deletion. See bridge.md.
//
// Standalone for now: built and validated here, wired into cherub's birthHandler
// and the world-sequencing JS deleted only once the diff gate is green.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "./parser.js";
import { evaluate } from "./evaluator.js";

const k = (role, op) => `${role}:${op}`;

// (role, op) -> the `.word` file that replaces its JS handler.
// (role, op) -> the `.word` file, resolved relative to THIS engine file. Co-located
// slices live with their role (`../roles/<role>/...`, CONVERTING.md); engine-local ones
// (transitional) sit beside this file. As roles self-register via registerRoleWord, these
// built-ins shrink to zero.
// The PROJECTION (same shape as wakes' _registry): (role:op) -> { fileUrl, disabled }.
// Populated in-memory at module-load for the SYNCHRONOUS hot path (resolveRoleWord), and
// reconciled with the chain at boot (rehydrateWordsFromFacts). The chain — declare-word /
// disable-word facts — is the source of truth; this map is its live fold. A word, once
// declared, is a fact forever: you DISABLE (a new fact), never delete. (No part-of-speech
// tag: the part of speech is the ANGLE — do=verb, see=noun, `a X is a role`=role-noun,
// seed=instantiable-noun — intrinsic to how the word is declared/used. A separate `shape`
// field would be a redundant copy of that truth, and a redundant copy drifts.)
const REGISTRY = new Map([
  [k("cherub", "birth"), { role: "cherub", op: "birth", fileUrl: "../roles/cherub/cherub.word" }],
  [k("cherub", "connect"), { role: "cherub", op: "connect", fileUrl: "../roles/cherub/cherub-connect.word" }],
]);

// The per-branch DISABLED overlay: branch -> Set<"role:op"> turned off ON that branch. A
// word's EXISTENCE (declared + backed, in REGISTRY) is branch-INDEPENDENT; its ENABLED state
// is per-BRANCH, folded from disable/enable facts (each laid on its own branch). This is what
// lets an extension's words be ON in one branch and OFF in another of the SAME story.
// V2 is per-EXACT-branch; lineage inheritance (a disable on an ancestor dimming descendants,
// mirroring wakes' _isInHistoryLineage) is the V2.1 refinement.
const _historyDisabled = new Map();
const _disabledOn = (key, branch) => !!_historyDisabled.get(String(branch))?.has(key);

// The root story (heaven), where the base/seed vocabulary lives. It is the fallback for a
// BRANCHLESS resolve — an existence query with no act context (a verifier, a global check).
// This is NOT an act-default drifting to "0": a real act always threads its own branch.
const ROOT = "0";
// The resolved #main branch, cached at boot (declareWordsToChain / rehydrate resolve the
// pointer via getDefaultHistory). resolveRoleWord is SYNC and can't await the pointer, so it
// PREFERS the cached #main over the root when an act gave no branch.
let _mainHistory = null;

const irCache = new Map();
function wordOf(file) {
  if (!irCache.has(file)) {
    // a role registers a URL (new URL("./x.word", import.meta.url)); the built-in map
    // holds paths relative to THIS engine file. Resolve both.
    const url = file instanceof URL ? file
      : (typeof file === "string" && (file.startsWith("file:") || file.startsWith("/"))) ? file
      : new URL(`./${file}`, import.meta.url);
    irCache.set(file, parse(readFileSync(url, "utf8")));
  }
  return irCache.get(file);
}

// A role co-locates its `.word` and registers it (CONVERTING.md): from the role file,
// `registerRoleWord("cherub", "birth", new URL("./cherub.word", import.meta.url))`. Called
// at role-load (pre-genesis, BEFORE the chain is writable), so it just populates the
// in-memory projection (the sync resolveRoleWord works immediately). genesis later walks
// the projection and DECLARES each word as a fact once the chain is up (declareWordsToChain).
export function registerRoleWord(role, op, fileUrl) {
  REGISTRY.set(k(role, op), { role, op, fileUrl });
}

// Resolve a role's op to its `.word` IR for a BRANCH, or null to fall through to the JS
// handler. Resolves iff DECLARED + BACKED (existence — the `.word` file present; a gone
// extension leaves the declaration but no code) AND NOT disabled ON this branch (the
// per-branch overlay). A missing branch falls back to #main (the cached default pointer),
// NEVER the literal "0" — resolve the pointer, don't assume the id (never-default-branch-zero).
// Stays SYNCHRONOUS (never reads the chain).
export function resolveRoleWord(role, op, branch) {
  // an ACT passes its real branch; a branchless query falls back to the cached #main, then
  // to the root story (heaven) where the base vocabulary lives. The root fallback is NOT an
  // act defaulting to "0" — acts always thread their own branch.
  const b = branch ?? _mainHistory ?? ROOT;
  const key = k(role, op);
  const entry = REGISTRY.get(key);
  if (!entry || !entry.fileUrl || _disabledOn(key, b)) return null;
  try { return wordOf(entry.fileUrl); }
  catch { return null; } // declared but unbacked: the .word file/code is absent
}

// ── the chain backing: declare-word / disable-word facts (the vocabulary's durable truth) ──
//
// The word vocabulary is a FOLD of the chain (the wakes pattern): the REGISTRY above is the
// projection; these facts are the source. Declaring a word lays a permanent `do:declare-word`
// fact; you never delete a word, you DISABLE it (a `do:disable-word` fact). At boot,
// rehydrateWordsFromFacts replays them into the map. EVERY fact needs an ACTOR — the being
// who declares/disables the word (its authority): I_AM for the seed vocabulary, the installer
// for an extension's words, the operator for a disable. Only the DECLARATION is a fact; the
// parsed IR is read lazily from the file (like wakes never persists the runtime cursor).

const WORD_DECLARE = "declare-word";
const WORD_DISABLE = "disable-word";

async function _wordActor(actorBeingId) {
  if (actorBeingId) return String(actorBeingId);
  const { I_AM } = await import("../../materials/being/seedBeings.js");
  return String(I_AM); // the origin being declares the seed vocabulary
}

// I_AM's genesis vocabulary is the BEDROCK — declared by I_AM on heaven ("0"). It can never be
// disabled or re-declared ON HEAVEN by anyone but I_AM: the one exception to "words stack" (the
// CORE STORY terms are all I_AM's, immutable). A branch may still SHADOW a word locally (the
// per-branch overlay = your own vocabulary, V2), which is NOT a change to the root. _genesisWords
// is folded from the chain at rehydrate (declare-word facts authored by I_AM on "0").
const _genesisWords = new Set(); // k(role, op) of words I_AM declared on heaven

let _iAmId = null;
async function _iAm() {
  if (_iAmId == null) { const { I_AM } = await import("../../materials/being/seedBeings.js"); _iAmId = String(I_AM); }
  return _iAmId;
}

// A non-I_AM actor may not disable / re-declare an I_AM genesis word ON HEAVEN ("0"). Per-branch
// shadowing (a disable on a non-"0" branch) is allowed — that's the local-vocabulary feature.
async function _assertMayChange(role, op, actor, br, verb) {
  if (String(br) === "0" && _genesisWords.has(k(role, op)) && String(actor) !== (await _iAm())) {
    throw new Error(`the I_AM genesis word ${role}:${op} is bedrock on heaven and cannot be ${verb} by another — only I_AM may, or shadow it on your own branch`);
  }
}

// Resolve #main (the pointer), never the literal "0", and cache it for the sync
// resolveRoleWord. Used wherever a branch isn't given.
async function _ensureMainHistory() {
  const { getDefaultHistory } = await import("../../materials/history/historyRegistry.js");
  _mainHistory = await getDefaultHistory();
  return _mainHistory;
}

// Lay facts THROUGH a proper act — a Name making an act, opened by assign and sealed by the
// stamper — NEVER a bare standalone emit (that would sidestep the stamper). Ride the caller's
// moment if one was given, else open I_AM's own act (I_AM is the actor that makes the words).
async function _inAct(moment, label, fn) {
  if (moment) return fn(moment);
  const { withIAmAct } = await import("../../sprout.js");
  return withIAmAct(label, fn);
}

// Lay a `do:declare-word` fact for every registered word not already on the chain (idempotent
// across restarts). Called once at genesis, AFTER ensureIAm + the chain is writable (the fact
// needs an actor). Registration buffered the words pre-genesis; this flushes them.
export async function declareWordsToChain({ moment = null, branch = null, actorBeingId = null } = {}) {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _wordActor(actorBeingId);
  await _ensureMainHistory(); // cache #main so the sync resolveRoleWord has a fallback
  // The seed vocabulary is I_AM's, declared on HEAVEN / root ("0") — a DELIBERATE heaven pin
  // (I_AM's ops stay on heaven; the root vocabulary is inherited by EVERY branch). NOT #main,
  // which people can repoint. An explicit `branch` overrides (e.g. an extension on its branch).
  const br = branch != null ? String(branch) : "0";
  const existing = await Fact.find({ verb: "do", act: WORD_DECLARE }).select("params").lean();
  const onChain = new Set(existing.map((f) => k(f.params?.role, f.params?.op)));
  const pending = [...REGISTRY.values()].filter((w) => !onChain.has(k(w.role, w.op)));
  if (!pending.length) return 0;
  // One I_AM act lays all the declarations (one act, many facts — like genesis), through the
  // stamper. Never a standalone emit.
  await _inAct(moment, "I declare the words", async (ctx) => {
    for (const w of pending) {
      await emitFact({
        through: actor, history: br, verb: "do", act: WORD_DECLARE,
        of: { kind: "being", id: actor },
        params: { role: w.role, op: w.op, source: String(w.fileUrl) },
      }, ctx);
    }
  });
  return pending.length;
}

// Disable a word: append a `do:disable-word` fact (permanent) + flip the projection, so
// resolveRoleWord returns null and acts using it fall through / refuse. The declaration
// stays on the chain forever; this is itself the "new word that says it can't be used".
export async function disableWord(role, op, { moment = null, branch = null, actorBeingId = null } = {}) {
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _wordActor(actorBeingId);
  const br = branch != null ? String(branch) : await _ensureMainHistory();
  await _assertMayChange(role, op, actor, br, "disabled");
  await _inAct(moment, `I disable the word ${role}:${op}`, (ctx) => emitFact({
    through: actor, history: br, verb: "do", act: WORD_DISABLE,
    of: { kind: "being", id: actor },
    params: { role, op },
  }, ctx));
  let s = _historyDisabled.get(br);
  if (!s) { s = new Set(); _historyDisabled.set(br, s); }
  s.add(k(role, op)); // disabled ON this branch only
}

// Re-enable a disabled word: a fresh `do:declare-word` fact (the fold's last action wins).
export async function enableWord(role, op, { moment = null, branch = null, actorBeingId = null } = {}) {
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _wordActor(actorBeingId);
  const br = branch != null ? String(branch) : await _ensureMainHistory();
  await _assertMayChange(role, op, actor, br, "re-declared");
  const entry0 = REGISTRY.get(k(role, op));
  await _inAct(moment, `I enable the word ${role}:${op}`, (ctx) => emitFact({
    through: actor, history: br, verb: "do", act: WORD_DECLARE,
    of: { kind: "being", id: actor },
    params: { role, op, source: String(entry0?.fileUrl ?? "") },
  }, ctx));
  _historyDisabled.get(br)?.delete(k(role, op)); // re-enabled ON this branch
}

// Rehydrate the projection from the chain (boot/recovery): replay declare-word / disable-word
// facts in date/seq order (declare = enable + ensure present, disable = mark off; last action
// wins), grouped by the fact's branch into the per-branch overlay. Mirrors wakes
// rehydrateFromFacts. Per-EXACT-branch (V2); lineage inheritance (a disable on an ancestor
// dimming descendants, mirroring wakes' _isInHistoryLineage) is the V2.1 refinement. Also
// caches #main so the sync resolveRoleWord can fall back to it (never the literal "0").
export async function rehydrateWordsFromFacts() {
  const { default: Fact } = await import("../../past/fact/fact.js");
  await _ensureMainHistory();
  const facts = await Fact.find({ verb: "do", act: { $in: [WORD_DECLARE, WORD_DISABLE] } })
    .sort({ date: 1, seq: 1 }).lean();
  _historyDisabled.clear();
  _genesisWords.clear();
  const iAmId = await _iAm();
  for (const f of facts) {
    const role = f.params?.role, op = f.params?.op;
    if (!role || !op) continue;
    const key = k(role, op);
    // BEDROCK: a word I_AM declared on heaven ("0") is genesis — protected from non-I_AM override
    if (f.act === WORD_DECLARE && String(f.through) === iAmId && String(f.history) === "0") _genesisWords.add(key);
    // EXISTENCE (branch-independent): ensure a declared word is in REGISTRY. One declared on
    // the chain but absent from memory (extension/code not loaded) is recorded with its
    // source; resolve returns null for it (the .word file is absent — declared, unbacked).
    if (f.act === WORD_DECLARE && !REGISTRY.has(key)) {
      REGISTRY.set(key, { role, op, fileUrl: f.params?.source || null });
    }
    // ENABLED state (per EXACT branch): last action on the fact's branch wins (disable adds,
    // declare/enable removes). Facts always carry a branch; fall back to #main, never "0".
    const br = String(f.history ?? _mainHistory);
    let s = _historyDisabled.get(br);
    if (f.act === WORD_DISABLE) { if (!s) { s = new Set(); _historyDisabled.set(br, s); } s.add(key); }
    else if (s) s.delete(key);
  }
  return facts.length;
}

// Run a resolved `.word` program LIVE in the moment, reproducing the exact ctx the
// green diff proved (verify-cherub-live.mjs, 7/7). The program's acts emit into the
// moment's moment.deltaF via the evaluator's live path (do-acts -> doVerb, the
// form-being -> the real birthBeing). Returns the deltaF the program laid (the WORLD
// strand; the token/session strand stays host, reading via bornBeingFrom).
//
// The caller supplies the role's actor model and the flow's context:
//   trigger    the summon payload the flow binds (e.g. { name, password })
//   bindings   the rest of the flow's named context, NOT in the summon payload
//              (cherub:birth's ownerName = the arriving Name, placeRoot = the
//              story root the home is made under). Merged over trigger.
//   beings     proper-name -> being id (cherub:birth's { Cherub, Arrival }); the
//              evaluator resolves a proper noun to its id through this (7.md bridge).
//   through    the vessel being the acts run THROUGH (identity.beingId): cherub:birth
//              acts "by I_AM through Cherub", so through = the cherub being id.
//   iam        the bootstrap actor name; name === "i-am" short-circuits authorize
//              (the privileged birth acts are denied for an ordinary summoned name).
//
// ATTRIBUTION (two modes; `through` presence is the signal):
//   VESSEL mode (through != null) — the `.word` acts are I_AM's, acting THROUGH a vessel
//     (cherub:birth: I_AM through Cherub). The privileged seed acts go through doVerb's
//     authorize, which short-circuits on name === "i-am" (the bootstrap axiom); an
//     ordinary summoned name would be denied. So we run under a DERIVED identity (i-am,
//     beingId = the vessel) and override actorAct.by to i-am, so the facts attribute
//     to I_AM.
//   CALLER mode (through == null, THE DEFAULT) — the acts are the CALLER's: a DO-op cut
//     (take-role) or connect, where the being itself acts. We run under the REAL moment's
//     identity + actorAct, so the facts attribute to the being that did them (no per-cut
//     attribution workaround). Most slices want this.
// Either mode SHARES the real moment's deltaF / foldedSeqs / afterSeal by reference, so
// facts land on the real chain with seq continuity; only VESSEL mode overrides the actor.
export async function runRoleWord(
  ir,
  { moment, branch, trigger = {}, bindings = {}, beings = {}, through = null, iam = "i-am", env = {} },
) {
  moment.deltaF ??= [];
  const vessel = through != null;
  const identity = vessel
    ? { beingId: String(through), name: iam, nameId: iam }      // I_AM through the vessel
    : (moment.identity || { beingId: null });                // the caller (default)
  const wordCtx = {
    ...moment,
    identity,
    ...(vessel ? { actorAct: { ...(moment.actorAct || {}), by: iam } } : {}), // caller keeps its actorAct
    deltaF: moment.deltaF, // SAME array: facts land on the real moment
    _inOp: true,              // the whole program is ONE op (see below)
  };
  const ctx = {
    dryRun: false, moment: wordCtx, identity, history: branch,
    // default id-minter for `bind` sites (the home space): create-space honors the
    // target id, so a minted uuid becomes the home's id and later acts reference it.
    // A caller can override via env.mintId.
    env: { iam, mintId: () => randomUUID(), ...env },
    deltaF: moment.deltaF,
    bindings: { ...trigger, ...bindings },
    beings,
    trigger: { ...trigger },
    flows: [],
  };
  // The whole `.word` program is ONE op (e.g. the birth): `_inOp` stays set across
  // the run so its do-acts dispatch through doVerb as NESTED sub-ops and don't each
  // re-increment `_opCount` and trip sealAct's one-op-per-moment guard (do.js
  // L214-226). The derived wordCtx carries _inOp; the real moment is untouched.
  await evaluate(ir, ctx); // declarations register; the flow's effects run; §7 return sets ctx.result
  // Return BOTH strands (8.md Q3): the WORLD strand (deltaF, already on the real moment;
  // the birth cut reads it via bornBeingFrom) AND the §7 `return` result the transport
  // reads (token/seat for a connect-style flow, reveal, etc.). A WordRefusal propagates
  // out of evaluate() to the verb layer (no fact, the moment rolls back).
  return { deltaF: moment.deltaF, result: ctx.result };
}

// Reconstruct the just-born being from the `be:birth` fact a `.word` birth laid,
// so the host SESSION strand (`generateToken` / `unlockSigning`) can read it
// without waiting for the projection fold. The cut in birthHandler uses this:
// run cherub.word via the bridge, then `bornBeingFrom(moment.deltaF)` stands
// in for the being that `_registerHumanWithFreshHome` used to return.
export function bornBeingFrom(deltaF) {
  const f = (deltaF || []).find((x) => x.verb === "be" && x.act === "birth");
  if (!f) return null;
  const p = f.params || {};
  return {
    _id: f.of?.id ?? f.through,
    name: p.name,
    trueName: p.trueName,
    homeSpace: p.homeId ?? p.homeSpace ?? null,
  };
}
