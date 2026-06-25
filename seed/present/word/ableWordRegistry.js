// The word registry (host): (able, op) -> a parsed `.word` program (a THEOREM word's body).
//
// DOCTRINE (Tabor): every word is a `.word` — a theorem, run by the evaluator — UNLESS it is an
// AXIOM, a word that bottoms out in the host (its body is a do.ref handler or native matter,
// resolved by wordStore.resolveWordFromFold / resolveDoOpFromFold and run by doVerb). There is NO
// `.js` handler backup for a theorem: a word either IS a `.word`, or it is an axiom — never a
// `.word` with a JS fallback. (The earlier 2.md Phase-4 "dual registry, prefer `.word` else fall
// through to the JS handler" was the conversion TRANSITION; the JS able-handlers are deleted as
// each `.word` lands. This is now the resolver for theorem words, not a bridge with a fallback.)
//
// runAbleWord runs a `.word` in ONE moment (legacy in-moment accumulation); runWordToStore runs it
// as a SEQUENCE OF MOMENTS (the spacebar — one act, one moment, one commit; see moments.md). The
// REGISTRY (the per-history overlay below) is the live fold of the chain's coin/retire facts.

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse } from "./parser.js";
import { evaluate } from "./evaluator.js";
import { resolveAbleWordSource } from "./wordStore.js";
import { floorHostEnv } from "../../store/words/cherub/floorHostEnv.js";

const k = (able, op) => `${able}:${op}`;

// Merge the SHARED floor of host predicates (floorHostEnv: hasAuthorityOver / isAncestorOf /
// hasCredentialAuthority / findByName) UNDER the caller's env, so a .word's `If <caller> has
// authority over <target>:` cond resolves LIVE instead of failing closed (cond.js's fail-closed
// default when ctx.env.host has no matching fn). Strictly additive: the caller's own env.host wins
// on a name clash (it is spread LAST), so any per-op host env (connectHostEnv, credentialHostEnv,
// …) is untouched; a word that wired none now gets the floor. Returns a fresh env to spread.
function _withFloorHost(env = {}) {
  const { host: callerHost, ...restEnv } = env;
  return { ...restEnv, host: { ...floorHostEnv(), ...(callerHost || {}) } };
}

// (able, op) -> the `.word` file that replaces its JS handler.
// The engine now holds ZERO built-in words: every word self-registers via
// registerAbleWord from its own bundle's module-load (the credentialOps pattern).
// Cherub was the LAST built-in entry here; it moved to seed/store/words/cherub/ and
// now self-registers (its able.js calls registerAbleWord at load). The map starts
// EMPTY and is filled by those registrations + rehydrateWordsFromFacts at boot.
// The PROJECTION (same shape as wakes' _registry): (able:op) -> { fileUrl, disabled }.
// Populated in-memory at module-load for the SYNCHRONOUS hot path (resolveAbleWord), and
// reconciled with the chain at boot (rehydrateWordsFromFacts). The chain — coin /
// retire facts — is the source of truth; this map is its live fold. A word, once
// declared, is a fact forever: you DISABLE (a new fact), never delete. (No part-of-speech
// tag: the part of speech is the ANGLE — do=verb, see=noun, `a X is a able`=able-noun,
// seed=instantiable-noun — intrinsic to how the word is declared/used. A separate `shape`
// field would be a redundant copy of that truth, and a redundant copy drifts.)
const REGISTRY = new Map();

// The per-history DISABLED overlay: history -> Set<"able:op"> turned off ON that history. A
// word's EXISTENCE (declared + backed, in REGISTRY) is history-INDEPENDENT; its ENABLED state
// is per-HISTORY, folded from disable/enable facts (each laid on its own history). This is what
// lets an extension's words be ON in one history and OFF in another of the SAME story.
// V2 is per-EXACT-history; lineage inheritance (a disable on an ancestor dimming descendants,
// mirroring wakes' _isInHistoryLineage) is the V2.1 refinement.
const _historyDisabled = new Map();
const _disabledOn = (key, history) =>
  !!_historyDisabled.get(String(history))?.has(key);

// The root story (heaven), where the base/seed vocabulary lives. It is the fallback for a
// HISTORYLESS resolve — an existence query with no act context (a verifier, a global check).
// This is NOT an act-default drifting to "0": a real act always threads its own history.
const ROOT = "0";
// The resolved #main history, cached at boot (declareAbleWordsToFold / rehydrate resolve the
// pointer via getDefaultHistory). resolveAbleWord is SYNC and can't await the pointer, so it
// PREFERS the cached #main over the root when an act gave no history.
let _mainHistory = null;

const irCache = new Map();
function wordOf(file) {
  if (!irCache.has(file)) {
    // a able registers a URL (new URL("./x.word", import.meta.url)); the built-in map
    // holds paths relative to THIS engine file. Resolve both.
    const url =
      file instanceof URL
        ? file
        : typeof file === "string" && file.startsWith("file:")
          ? new URL(file) // a source string from the fold
          : typeof file === "string" && file.startsWith("/")
            ? file
            : new URL(`./${file}`, import.meta.url);
    irCache.set(file, parse(readFileSync(url, "utf8")));
  }
  return irCache.get(file);
}

// A able co-locates its `.word` and registers it (CONVERTING.md): from the able file,
// `registerAbleWord("cherub", "birth", new URL("./cherub.word", import.meta.url))`. Called
// at able-load (pre-genesis, BEFORE the chain is writable), so it just populates the
// in-memory projection (the sync resolveAbleWord works immediately). genesis later walks
// the projection, and declareAbleWordsToFold declares each into the unified wordStore fold.
export function registerAbleWord(able, op, fileUrl) {
  REGISTRY.set(k(able, op), { able, op, fileUrl });
}

// The registered able-words (the pre-genesis buffer) — declareAbleWordsToFold reads these to declare
// each into the unified wordStore fold (ABLES-UNIFICATION.md WP-2). Each: { able, op, fileUrl }.
export function listRegistered() {
  return [...REGISTRY.values()];
}

// Resolve a able's op to its `.word` IR for a HISTORY, or null when no theorem `.word` is bound
// (no JS fallback — an axiom resolves via wordStore.resolveDoOpFromFold; an unbound/disabled
// theorem refuses). Resolves iff DECLARED + BACKED (existence — the `.word` file present; a gone
// extension leaves the declaration but no code) AND NOT disabled ON this history (the
// per-history overlay). A missing history falls back to #main (the cached default pointer),
// NEVER the literal "0" — resolve the pointer, don't assume the id (never-default-history-zero).
// Stays SYNCHRONOUS (never reads the chain).
export function resolveAbleWord(able, op, history) {
  // PHASE 2 cutover: the runtime read is the UNIFIED wordStore fold + the per-history overlay, via
  // resolveAbleWordViaFold. The REGISTRY Map is now ONLY the pre-genesis registration buffer
  // (declareAbleWordsToFold flushes it into the fold); resolveAbleWord no longer reads it. Parity
  // proven by verify-ablewordfold (phase 1) before this cutover. Stays SYNCHRONOUS.
  return resolveAbleWordViaFold(able, op, history);
}

// ABLES-UNIFICATION phase-1 parity path: resolve a able-word's IR by reading the UNIFIED wordStore
// fold (existence + source, sync) + the per-history overlay (enabled). verify-ablewordfold compares
// this to resolveAbleWord (the REGISTRY path) to prove the read cutover is a no-op before REGISTRY is
// deleted in phase 2. Same SYNC contract as resolveAbleWord (the overlay is an in-memory index).
export function resolveAbleWordViaFold(able, op, history) {
  const b = history ?? _mainHistory ?? ROOT;
  if (_disabledOn(k(able, op), b)) return null;
  const source = resolveAbleWordSource(able, op); // sync read of the unified fold
  if (!source) return null;
  try {
    return wordOf(source);
  } catch {
    return null;
  } // declared but unbacked
}

// ── the chain backing: coin / retire facts (the vocabulary's durable truth) ──
//
// The word vocabulary is a FOLD of the chain (the wakes pattern): the REGISTRY above is the
// projection; these facts are the source. Declaring a word lays a permanent `do:coin`
// fact; you never delete a word, you DISABLE it (a `do:retire` fact). At boot,
// rehydrateWordsFromFacts replays them into the map. EVERY fact needs an ACTOR — the being
// who declares/disables the word (its authority): I for the seed vocabulary, the installer
// for an extension's words, the operator for a disable. Only the DECLARATION is a fact; the
// parsed IR is read lazily from the file (like wakes never persists the runtime cursor).

const WORD_COIN = "coin";
const WORD_RETIRE = "retire";

// I bedrock (the genesis vocabulary on "0" is immutable by anyone but I) now lives in
// wordStore.bindWord/disableWord as ONE guard over every word kind — op, type, reducer, concept,
// ableword — not just able-words. ableWordRegistry no longer carries its own bedrock set or guard.

// Resolve #main (the pointer), never the literal "0", and cache it for the sync
// resolveAbleWord. Used wherever a history isn't given.
async function _ensureMainHistory() {
  const { getDefaultHistory } =
    await import("../../materials/history/historyRegistry.js");
  _mainHistory = await getDefaultHistory();
  return _mainHistory;
}

// (declareWordsToChain removed with the unification: able-words are declared into the unified
// wordStore fold by declareAbleWordsToFold — in seedFold + the boot-end pass — as "able:op" words
// with kind:"ableword", not by a separate {able,op} fact path. The IR-laying act runs there.)

// Disable a word: append a `do:retire` fact (permanent) + flip the projection, so
// resolveAbleWord returns null and acts using it REFUSE (no JS backup — a disabled theorem just
// can't run). The declaration stays on the chain forever; this is itself the "new word that says
// it can't be used".
export async function disableWord(
  able,
  op,
  { moment = null, history = null, actorBeingId = null } = {},
) {
  const { disableWord: disableWordInFold } = await import("./wordStore.js");
  const br = history != null ? String(history) : await _ensureMainHistory();
  await disableWordInFold(`${able}:${op}`, {
    moment,
    history: br,
    actorBeingId,
  }); // the unified fold (bedrock-guarded there)
  let s = _historyDisabled.get(br);
  if (!s) {
    s = new Set();
    _historyDisabled.set(br, s);
  }
  s.add(k(able, op)); // disabled ON this history only (the sync overlay)
}

// Re-enable a disabled word: a fresh `do:coin` fact (the fold's last action wins).
export async function enableWord(
  able,
  op,
  { moment = null, history = null, actorBeingId = null } = {},
) {
  const { bindWord } = await import("./wordStore.js");
  const br = history != null ? String(history) : await _ensureMainHistory();
  const entry0 = REGISTRY.get(k(able, op)); // the registration buffer holds the IR source
  await bindWord(
    `${able}:${op}`,
    {
      kind: "ableword",
      able,
      op,
      source: String(entry0?.fileUrl ?? ""),
    },
    { moment, history: br, actorBeingId },
  ); // a fresh coin re-enables (bedrock-guarded in wordStore)
  _historyDisabled.get(br)?.delete(k(able, op)); // re-enabled ON this history (the sync overlay)
}

// Rehydrate the projection from the chain (boot/recovery): replay coin / retire
// facts in date/seq order (declare = enable + ensure present, disable = mark off; last action
// wins), grouped by the fact's history into the per-history overlay. Mirrors wakes
// rehydrateFromFacts. Per-EXACT-history (V2); lineage inheritance (a disable on an ancestor
// dimming descendants, mirroring wakes' _isInHistoryLineage) is the V2.1 refinement. Also
// caches #main so the sync resolveAbleWord can fall back to it (never the literal "0").
export async function rehydrateWordsFromFacts() {
  await _ensureMainHistory();
  // The able-words now live in the UNIFIED wordStore fold: a coin fact carries
  // params.word ("able:op") + params.binding.kind === "ableword"; a retire carries params.word.
  // Rebuild the per-history disabled overlay + the I bedrock set from them. resolveAbleWord reads
  // the fold for EXISTENCE, so REGISTRY is no longer populated here (it is the pre-genesis buffer).
  //
  // FileStore swap: coin/retire facts ride I's OWN being-reel (verb==="do",
  // act ∈ {coin,retire}; wordStore lays them on (history, "being", iAm)). The
  // curated getFactsOnReelWhere reads ONE reel, seq-ascending — already the
  // {history, seq} order this fold wants WITHIN a history.
  //
  // Per-branch overlay: a GLOBAL scan across EVERY history's reels would fold a
  // child branch BR's RETIRE (turning a word off there while it stays on for
  // main) for ALL branches at boot. The file store is
  // partitioned per-(history,kind,id); listHistories() is the enumeration peer
  // (the reels/ subdirs). We read I's reel on EVERY history and concatenate —
  // heaven "0" FIRST so an ableword's COIN (which rides the base-vocabulary reel)
  // is known before a branch's RETIRE (which rides only the branch reel; the
  // `if (!ablewordKeys.has(word)) continue` gate below would otherwise drop it).
  // The per-history bucketing (`br = f.history`) then lands each retire on its own
  // overlay. getFactsOnReelWhere reads ONE reel (the history's DIVERGENT facts,
  // not the lineage union), so a branch contributes only its own retire — no dup.
  const { getFactsOnReelWhere } = await import("../../past/fact/facts.js");
  const { listHistories } = await import("../../past/fileStore.js");
  const { I } = await import("../../materials/being/seedBeings.js");
  const iAm = String(I);
  const histories = listHistories();
  histories.sort((a, b) => (a === "0" ? -1 : b === "0" ? 1 : a < b ? -1 : a > b ? 1 : 0));
  const facts = [];
  for (const h of histories) {
    for (const f of getFactsOnReelWhere(
      h,
      "being",
      iAm,
      (f) => f.verb === "do" && (f.act === WORD_COIN || f.act === WORD_RETIRE),
    )) {
      facts.push(f);
    }
  }
  _historyDisabled.clear();
  const ablewordKeys = new Set(); // params.word of words whose declare marked them kind:"ableword"
  for (const f of facts) {
    const word = f.params?.word;
    if (!word) continue;
    if (f.act === WORD_COIN && f.params?.binding?.kind === "ableword")
      ablewordKeys.add(word);
    if (!ablewordKeys.has(word)) continue; // only able-words feed the per-history overlay
    // ENABLED state (per EXACT history): last action on the fact's history wins (disable adds,
    // declare/enable removes). Facts always carry a history; fall back to #main, never "0".
    const br = String(f.history ?? _mainHistory);
    let s = _historyDisabled.get(br);
    if (f.act === WORD_RETIRE) {
      if (!s) {
        s = new Set();
        _historyDisabled.set(br, s);
      }
      s.add(word);
    } else if (s) s.delete(word);
  }
  return facts.length;
}

// Run a resolved `.word` program LIVE in the moment, reproducing the exact ctx the
// green diff proved (verify-cherub-live.mjs, 7/7). The program's acts emit into the
// moment's moment.deltaF via the evaluator's live path (do-acts -> doVerb, the
// form-being -> the real birthBeing). Returns the deltaF the program laid (the WORLD
// strand; the token/session strand stays host, reading via bornBeingFrom).
//
// The caller supplies the able's actor model and the flow's context:
//   trigger    the summon payload the flow binds (e.g. { name, password })
//   bindings   the rest of the flow's named context, NOT in the summon payload
//              (cherub:birth's ownerName = the arriving Name, placeRoot = the
//              story root the home is made under). Merged over trigger.
//   beings     proper-name -> being id (cherub:birth's { Cherub, Arrival }); the
//              evaluator resolves a proper noun to its id through this (7.md bridge).
//   through    the being being the acts run THROUGH (identity.beingId): cherub:birth
//              acts "by I through Cherub", so through = the cherub being id.
//   actorName        the bootstrap actor name; name === "i-am" short-circuits authorize
//              (the privileged birth acts are denied for an ordinary summoned name).
//
// ATTRIBUTION (two modes; `through` presence is the signal):
//   being mode (through != null) — the `.word` acts are I's, acting THROUGH a being
//     (cherub:birth: I through Cherub). The privileged seed acts go through doVerb's
//     authorize, which short-circuits on name === "i-am" (the bootstrap axiom); an
//     ordinary summoned name would be denied. So we run under a DERIVED identity (i-am,
//     beingId = the being) and override actorAct.by to i-am, so the facts attribute
//     to I.
//   CALLER mode (through == null, THE DEFAULT) — the acts are the CALLER's: a DO-op cut
//     (take-able) or connect, where the being itself acts. We run under the REAL moment's
//     identity + actorAct, so the facts attribute to the being that did them (no per-cut
//     attribution workaround). Most slices want this.
// Either mode SHARES the real moment's deltaF / foldedSeqs / afterSeal by reference, so
// facts land on the real chain with seq continuity; only being mode overrides the actor.
export async function runAbleWord(
  ir,
  {
    moment,
    history,
    trigger = {},
    bindings = {},
    beings = {},
    through = null,
    actorName = "i-am",
    env = {},
    identity: identityOverride = null,
  },
) {
  moment.deltaF ??= [];
  const being = through != null;
  // identity override (opt-in): a being acting AS ITSELF — e.g. a word-native LLM cognition emitting
  // its own Word (14.md) — passes its own {beingId, name} so the acts attribute to the being (through
  // = beingId) and sign by its OWN Name (by = moment.actorAct.by), NOT I. Without it: through-mode
  // = I through the being (seed-internal), caller-mode = moment.identity (the session caller).
  const identity =
    identityOverride ||
    (being
      ? { beingId: String(through), name: actorName, nameId: actorName } // I through the being
      : moment.identity || { beingId: null }); // the caller (default)
  const wordCtx = {
    ...moment,
    identity,
    ...(being ? { actorAct: { ...(moment.actorAct || {}), by: actorName } } : {}), // caller keeps its actorAct
    deltaF: moment.deltaF, // SAME array: facts land on the real moment
    _inOp: true, // the whole program is ONE op (see below)
  };
  const ctx = {
    dryRun: false,
    moment: wordCtx,
    identity,
    history,
    // default id-minter for `bind` sites (the home space): create-space honors the
    // target id, so a minted uuid becomes the home's id and later acts reference it.
    // A caller can override via env.mintId. env.host merges the shared floor predicates
    // (floorHostEnv) UNDER the caller's host, so `If … has authority over …:` resolves live.
    env: { I: actorName, mintId: () => randomUUID(), ..._withFloorHost(env) },
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

// runWordToStore — the SPACEBAR word-runner (the do-op N-moments path, the run-on cure).
//
// runAbleWord (above) runs a `.word` as ONE moment: _inOp stays set so all its acts pool into
// one deltaF and the caller seals them as a single act (cherub:birth = 5 facts, one moment). The
// spacebar says that is a run-on — N words crammed into one moment with the spaces deleted.
//
// runWordToStore runs the same Word as a SEQUENCE OF MOMENTS instead. It opens NO shared moment;
// it sets ctx.perActMoment.open = a withBeingAct cycle, so the evaluator opens a fresh moment for
// EACH fact-laying act (do / be / name / call), lays that act's ONE fact, and seals it to store,
// advancing the being's chain — then the next act is the next moment. A Word of N acts lays N
// acts/facts on the chain, one fact each. Declarations (is / can / law / ...) fold IS-side into
// ctx.laws (letters — they lay nothing); reads (see / recall) lay nothing; control flow (if /
// foreach) walks into nested acts, each its own moment. Bindings + laws + world-state thread
// across the moments on ctx, exactly as a story's words carry meaning forward.
//
// The being acts as ITSELF: every moment's act is signed BY its Name (withBeingAct resolves the
// being's trueName), THROUGH the being. `name` is the auth identity doVerb checks. Returns the
// §7 `return` result (if any), the folded `laws`, and the final `bindings`.
//
// Called OUTSIDE any open moment (the chain head it reads must be settled): the top-level word-run
// for the generative loop and the do-op store. Legacy callers stay on runAbleWord until cut over.
export async function runWordToStore(
  ir,
  {
    beingId,
    name = null,
    history,
    position = null,
    env = {},
    bindings = {},
    beings = {},
    trigger = {},
  } = {},
) {
  if (typeof beingId !== "string" || !beingId.length)
    throw new Error(
      "runWordToStore: beingId is required (the being that acts)",
    );
  if (typeof history !== "string" || !history.length)
    throw new Error('runWordToStore: history is required (pass "0" for main)');
  const { withBeingAct } = await import("../../sprout.js");
  // How many acts opened a moment this run. >0 means the being ACTED (deeds reached store);
  // 0 means a pure SEE (only declarations/reads — nothing to commit). This is the signal the
  // re-invocation hook reads: acted → call the being's next moment (the generative chain);
  // saw → rest (nothing to re-invoke from). See moments.md "the moments re-invoke each other."
  let stamped = 0;
  const ctx = {
    dryRun: false,
    // A read-ambient moment (history only): the floor `see`s / host computes that read the actor's
    // history (actorHistoryFrom) run BEFORE/BETWEEN the deeds, when there is no real moment yet. They
    // lay nothing, so this never seals. The DEEDS open their own moments via perActMoment.open
    // (stampOneAct swaps ctx.moment to the fresh withBeingAct moment for each, then restores this).
    moment: { actorAct: { history } },
    identity: { beingId: String(beingId), name },
    history,
    // where the being STANDS — create-space raises the new space under it (evalAct), and ops
    // that read the actor's position fold off it. Threaded from the being's presence.
    position: position ? String(position) : null,
    // env.host merges the shared floor predicates (floorHostEnv) UNDER the caller's host (additive;
    // the caller wins on a clash), so a generative-loop Word's `If … has authority over …:` cond
    // resolves LIVE against the being-tree instead of failing closed.
    env: { mintId: () => randomUUID(), ..._withFloorHost(env) },
    bindings: { ...trigger, ...bindings },
    beings,
    trigger: { ...trigger },
    flows: [],
    // The spacebar: each fact-laying act is its own word → its own moment → its own commit.
    // The opener is one withBeingAct cycle (open the act, lay its fact, seal to store).
    perActMoment: {
      open: (label, fn) => {
        stamped++; // a fact-laying act dispatched this moment — the being acted
        return withBeingAct(String(beingId), label, history, fn);
      },
    },
  };
  await evaluate(ir, ctx);
  // THE TYPE-SCHEMA APPLY-PASS (all-rules-fold, the DECLARATION half): a `has`/`accepts`/`carries`/
  // `claims` law folded IS-side into ctx.laws (it lays no act). After the word runs, fold each into a
  // kind:"type" word — "a meal has a calorie" lays a `meal` type coin carrying the `calorie` field (the
  // FOLD of every such fact is the type's schema). applyTypeSchemaLaw self-guards (name-shape, ceiling,
  // heaven-only auto-create, append-only); a bad law warns + skips, never aborting the word.
  const schemaLaws = (ctx.laws || []).filter(
    (l) =>
      l &&
      (l.kind === "has" ||
        l.kind === "accepts" ||
        l.kind === "carries" ||
        l.kind === "claims"),
  );
  if (schemaLaws.length) {
    const { applyTypeSchemaLaw } = await import("./wordStore.js");
    for (const law of schemaLaws) {
      const r = await applyTypeSchemaLaw(law, { history });
      // a coin fact laid by applyTypeSchemaLaw is a fact-to-store — count it as a deed so `acted`
      // reflects that the type schema advanced the chain (skipped CAS no-ops don't count).
      if (r && !r.skipped) stamped++;
    }
  }
  // THE PROHIBITION APPLY-PASS (rule 14, the OBJECTIVE law half): a `cannot`/`prohibition` law folded
  // IS-side into ctx.laws ("A member cannot back a proposal." / "No member can back it."). After the
  // word runs, fold each into a kind:"law" prohibition word — the FOLD of every such fact for a
  // (subject-able, verb, of) IS the objective prohibition register (listFoldedProhibitions), read on
  // demand by the able-walk (a cannot beats a can). applyProhibitionLaw self-guards (name-shape,
  // ceiling, content-addressed/append-only); a bad law warns + skips, never aborting the word.
  const prohibitionLaws = (ctx.laws || []).filter(
    (l) => l && (l.kind === "cannot" || l.kind === "prohibition"),
  );
  if (prohibitionLaws.length) {
    const { applyProhibitionLaw } = await import("./wordStore.js");
    for (const law of prohibitionLaws) {
      const r = await applyProhibitionLaw(law, { history });
      if (r && !r.skipped) stamped++;
    }
  }
  // `acted` is the re-invocation signal: true → the chain continues (call the next moment),
  // false → a SEE-rest (nothing committed, nothing to re-invoke from).
  return {
    result: ctx.result,
    laws: ctx.laws || [],
    bindings: ctx.bindings,
    stamped,
    acted: stamped > 0,
  };
}

// wordHasDeeds — does this parsed Word lay anything? True if it has a fact-laying node
// (act = do/be/name, call, closure, derive), scanning into control-flow bodies (flow/if/foreach/
// match). The cognition uses it as the act-vs-SEE cut: a Word with deeds → the being ACTED (seal
// the answer + stamp the deeds via runWordToStore); a Word with none (pure declaration/read) → a
// SEE (looked, laid nothing). Inclusive by design — err toward "has deeds" so a real act is never
// mistaken for a SEE (a false positive only costs an answer with zero deeds).
export function wordHasDeeds(node) {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(wordHasDeeds);
  if (typeof node !== "object") return false;
  const k = node.kind;
  if (k === "act" || k === "call" || k === "closure" || k === "derive")
    return true;
  if (wordHasDeeds(node.body) || wordHasDeeds(node.effects)) return true;
  if (wordHasDeeds(node.then) || wordHasDeeds(node.else)) return true;
  if (Array.isArray(node.cases))
    return node.cases.some(
      (c) => wordHasDeeds(c?.body) || wordHasDeeds(c?.effects),
    );
  return false;
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
