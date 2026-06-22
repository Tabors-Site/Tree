// matterWord.js — native-words-via-matter (20.md:113-129 / 21.md P5). The kernel stops being a
// privileged lump: a word's body can be MATTER — a content-addressed blob — instead of sub-words.
// A "native word" is just a word whose body is matter of an EXECUTABLE TYPE. The fold binding
// carries `matter: { hash, type, effect, entry }`; dispatch fetches the blob from CAS by hash and
// runs it through that matter TYPE's run-op (the executor). Even the native floor is then "the words
// whose matter is native," sitting in the same fold as everything else.
//
// ONE typing system (Tabor): a "resource" — a model, a code blob, a wasm module — is NOT a separate
// category; it is just MATTER OF A TYPE. "Resource types" collapse into matter types. So the driver
// registry below is the per-matter-type run-op (an executable matter type knows how to run its
// bytes); when wired, it reads the type off the matter record and dispatches to that type's run-op.
// There is no "extension" and no "resource" layer — only Word (composes words, or points at matter)
// and Matter (typed bytes; some types are executable).
//
// EFFECT-CLASS is the see/stamp line at the native boundary (the same is-be cut as 17.md, one level
// down): a PURE word (same input → same output, no IO/time/randomness) is replay-safe — it folds
// like compiled Word and is cached by hash. An EFFECTFUL word touches the outside; its result is a
// FACT-SOURCE — stamped once and trusted, never recomputed. Pure is computation; effectful is where
// the not-Word world injects data into the chain.
//
// The honest seam (20.md:125): a matter-backed word is a TRUST boundary, not a VERIFY boundary — the
// host runs opaque bytes it cannot re-derive from the chain. WASM is the sweet spot: sandboxed (no
// ambient authority unless granted) and deterministic, so a pure wasm word stays replay-safe. This
// module is the driver layer + the effect-class cache; wiring it UNDER live dispatch is a later,
// coordinated step (it does not touch the verb dispatch yet).

import { getWordSync } from "./wordStore.js";

// The RUN-OP HANDLER registry: matter type -> run-op(blob, inputs, opts) -> Promise<any>. An
// executable matter type DECLARES its executability + effect-class in the MATTER-TYPE REGISTRY
// (materials/matter/types.js, the `executable` field); THIS registers its executor — the same
// name/handler split do-ops use (the op's name is declared on the type; its handler is registered
// separately, here). Not a parallel truth table: the type registry says WHICH types run and their
// effect-class; this says HOW each runs.
const _drivers = new Map();

export function registerDriver(type, fn) { _drivers.set(String(type), fn); } // register a type's run-op handler
export function hasDriver(type) { return _drivers.has(String(type)); }
export function driverTypes() { return [..._drivers.keys()]; }

// ── the wasm matter type: sandboxed + deterministic ──
// No import object is passed, so the module gets NO host capability — no IO, no clock, no
// randomness. That absence is exactly what keeps a pure wasm word replay-safe: it can only compute
// over its inputs. (Granting capabilities later = explicitly handing it an import object; that makes
// it effectful by construction.)
registerDriver("wasm", async (blob, inputs, { entry = "run" } = {}) => {
  // The numeric ABI: a wasm export takes NUMBERS only. A structured input (object/string/array) must
  // cross via the JSON-over-linear-memory marshalling — the module exports `memory` + an allocator,
  // the host writes the serialized arg and passes (ptr, len), then reads the result back. That
  // convention is still to be CO-DESIGNED with the verb lane (21.md P5; it also shapes the word
  // author's side). Until it lands, FAIL LOUD here rather than let `fn(object)` coerce to NaN — a
  // silent wrong answer on a wasm word would be the worst outcome.
  if (!inputs.every((i) => typeof i === "number")) {
    throw new Error(
      `wasm matter word "${entry}": the numeric ABI takes numbers only — a structured input needs ` +
      `the JSON-over-linear-memory marshalling convention (not wired yet, co-design pending). ` +
      `Use the "js" matter type for structured params, or pass numbers.`,
    );
  }
  const mod = await WebAssembly.compile(blob);
  const inst = await WebAssembly.instantiate(mod, {}); // {} imports = no ambient authority
  const fn = inst.exports[entry];
  if (typeof fn !== "function") throw new Error(`wasm matter word exports no "${entry}" function`);
  return fn(...inputs);
});

// ── the js matter type: works, but leaks more ──
// Full ambient authority unless externally sandboxed — a WIDER trust hole than wasm. Provided for
// where determinism/sandbox is not required (or behind an outer sandbox); never the default for a
// word that claims to be pure. The body is JS source defining `entry` (default `run`).
registerDriver("js", async (blob, inputs, { entry = "run" } = {}) => {
  const src = blob.toString("utf8");
  // eslint-disable-next-line no-new-func
  const fn = new Function(`${src}\n; return typeof ${entry} === "function" ? ${entry} : null;`)();
  if (typeof fn !== "function") throw new Error(`js matter word exports no "${entry}" function`);
  return fn(...inputs);
});

// Effect-class cache for PURE words: (matterHash + inputs) -> result. A pure word is re-derivable,
// so caching by content-hash is free and safe — nothing recomputes the same pure word twice.
// Effectful words are NEVER cached (their result is a one-time fact-source).
const _pureCache = new Map();
const cacheKey = (hash, inputs) => `${hash}::${JSON.stringify(inputs)}`;

/**
 * Run a matter-backed word.
 * @param {{hash:string, type:string, effect?:"pure"|"effectful", entry?:string}} matter
 *        type = the matter TYPE (e.g. "wasm" / "js"); the matter-type registry says whether it is
 *        executable + its default effect-class. `effect`/`entry` here OVERRIDE the type's defaults
 *        for this specific word.
 * @param {any[]} inputs
 * @param {{ getContent:(hash:string)=>Promise<Buffer|null>, getMatterType?:(name:string)=>any }} deps
 *        getContent = CAS reader (contentStore.getContent); getMatterType injectable (defaults to the
 *        matter-type registry — passed in only for boot-free callers/tests).
 * @returns {Promise<{ result:any, effect:string, cached:boolean, type:string }>}
 */
export async function runMatterWord(matter, inputs = [], { getContent, getMatterType } = {}) {
  const { hash, type, effect: effectOverride, entry: entryOverride } = matter || {};

  // The matter TYPE is the source of truth for executability + the effect-class (Tabor: resource
  // types ARE matter types; effect-class is a property of the type). A word may override the effect
  // for its own instance, but a non-executable type cannot be run at all.
  const resolveType = getMatterType || (async (t) => (await import("../../materials/matter/types.js")).getMatterType(t));
  const typeDef = await resolveType(String(type));
  if (!typeDef || !typeDef.executable) {
    throw new Error(`matter type "${type}" is not executable (no run-op declared in the matter-type registry)`);
  }
  const effect = effectOverride === "pure" || effectOverride === "effectful" ? effectOverride : typeDef.executable.effect;
  const entry = entryOverride || typeDef.executable.entry || "run";

  const driver = _drivers.get(String(type));
  if (!driver) throw new Error(`matter type "${type}" is executable but has no registered run-op handler`);
  if (typeof getContent !== "function") throw new Error("runMatterWord needs a CAS reader (getContent)");

  if (effect === "pure") {
    const k = cacheKey(hash, inputs);
    if (_pureCache.has(k)) return { result: _pureCache.get(k), effect, cached: true, type };
  }

  const raw = await getContent(String(hash));
  if (!raw) throw new Error(`matter word body not found in CAS: ${hash}`);
  const blob = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const result = await driver(blob, inputs, { entry });

  if (effect === "pure") _pureCache.set(cacheKey(hash, inputs), result); // replay-safe → cache it
  return { result, effect, cached: false, type };
}

export function clearMatterCache() { _pureCache.clear(); }

// ─────────────────────────────────────────────────────────────────────
// The production entries — wired to the REAL CAS + matter-type registry. The dispatch seam (verb
// lane) uses these: resolveMatterWord(name) asks "does this word have a matter body?", runWordBody
// runs it. A word whose binding carries `matter:{hash,type}` is RUN, not handler-dispatched —
// resolveWordFromFold requires a `do.ref` handler, so a pure matter-bodied word resolves HERE.
// ─────────────────────────────────────────────────────────────────────

// MIME per executable matter type, for the CAS ref the body is stored under.
const TYPE_MIME = { wasm: "application/wasm", js: "text/javascript" };

/**
 * Store a matter body (a code blob) in CAS and build the `matter` ref a word's binding carries.
 * @param {Buffer|Uint8Array|string} blob
 * @param {string} type   an executable matter type ("wasm" / "js" / ...)
 * @param {{effect?:"pure"|"effectful", entry?:string}} [opts]  per-word overrides of the type defaults
 * @returns {Promise<{hash:string, type:string, effect?:string, entry?:string}>}
 */
export async function storeMatterBody(blob, type, { effect, entry } = {}) {
  const { putContent } = await import("../../materials/matter/contentStore.js");
  const buf = Buffer.isBuffer(blob) ? blob
    : blob instanceof Uint8Array ? Buffer.from(blob)
    : Buffer.from(String(blob), "utf8");
  const ref = await putContent(buf, { mimeType: TYPE_MIME[String(type)] || "application/octet-stream", name: `word-body.${type}` });
  const matter = { hash: ref.hash, type: String(type) };
  if (effect) matter.effect = effect;
  if (entry) matter.entry = entry;
  return matter;
}

/**
 * Does this word have a MATTER body? Reads the live word-fold. Returns the matter ref (the dispatch
 * routes to runWordBody) or null (the normal handler/composition path). Sync — a cheap check at
 * resolution time, beside resolveWordFromFold.
 */
export function resolveMatterWord(name) {
  const w = getWordSync(name);
  const m = w?.matter;
  return m && typeof m === "object" && m.hash && m.type ? { word: String(name), hash: m.hash, type: m.type, effect: m.effect, entry: m.entry } : null;
}

/**
 * Run a word's matter body — the production entry the dispatch calls. Wires the REAL CAS reader +
 * matter-type registry; the matter type declares executability + effect-class.
 * @param {{hash:string, type:string, effect?:string, entry?:string}} matterRef
 * @param {any[]} inputs
 */
export async function runWordBody(matterRef, inputs = []) {
  const [{ getContent }, { getMatterType }] = await Promise.all([
    import("../../materials/matter/contentStore.js"),
    import("../../materials/matter/types.js"),
  ]);
  return runMatterWord(matterRef, inputs, { getContent, getMatterType });
}

/**
 * The SEE / compute path entry — the pure-half peer of runWordBody-via-do (the effect-class IS the
 * dispatch branch, the is-be cut one level down). A PURE matter word is computation: replay-safe,
 * makes NO fact, passes no auth ceremony — so it SEE-resolves here, returning the result and
 * stamping nothing. An EFFECTFUL matter word is a fact-source and is REFUSED here: it must go
 * through DO (auth + its one caller-attributed fact). A non-matter word returns {isMatter:false} so
 * the see-dispatch falls through to its normal resolution. The verb lane wires its see-dispatch to
 * call this, exactly as it wired do.js to runWordBody.
 * @returns {Promise<{isMatter:boolean, result?:any}>}
 */
export async function seeMatterWord(name, inputs = []) {
  const m = resolveMatterWord(name);
  if (!m) return { isMatter: false };
  const { getMatterType } = await import("../../materials/matter/types.js");
  const eff = m.effect ?? getMatterType(m.type)?.executable?.effect;
  if (eff !== "pure") {
    throw new Error(
      `matter word "${name}" is effectful — a fact-source must be invoked via DO (auth + its one fact), not SEE. ` +
      `Only a pure matter word (replay-safe, no fact) computes on the see path.`,
    );
  }
  const { result } = await runWordBody(m, inputs);
  return { isMatter: true, result };
}
