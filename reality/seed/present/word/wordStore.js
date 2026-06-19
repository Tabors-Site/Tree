// wordStore.js . a word is a FOLD of declare-word facts, not a registry entry.
//
// This is the connecter as a fold (philosophy/word/10.md §2). `bindWord` lays a declare-word
// fact carrying the word's binding descriptor; `getWord` folds the declare-word / disable-word
// facts back into the current descriptor, the same call that reconstructs a Being from its facts.
// No registry: language stops being the one exception to facts -> fold -> story.
//
// It is all matter, so a handler in the descriptor is a REF to code matter (a CAS id, or a seed
// bundled-handler key), never an inline function -- a fact is data. A composite word carries no
// handler at all, only a `can[]` grant-set pointing at words that already answer; words stack.
//
// Generalizes roleWordRegistry's (role:op) declare-word fold to any word + a full descriptor:
// same act names, same I_AM-is-the-seed-vocabulary actor, same "disable is a new fact" rule.
// (9.md §2/§6; the words-stack doctrine; the wakes pattern of an in-memory projection over facts.)

const DECLARE = "declare-word";
const DISABLE = "disable-word";

// Every word-fact needs an actor (the being whose authority declares it). I_AM declares the seed
// vocabulary; an extension installer or a being in world declares its own. Mirrors roleWordRegistry.
async function _actor(actorBeingId) {
  if (actorBeingId) return String(actorBeingId);
  const { I_AM } = await import("../../materials/being/seedBeings.js");
  return String(I_AM); // the origin being declares the seed vocabulary
}

// Lay facts THROUGH a proper act (assign opens it, the stamper seals it), never a bare emit.
// Ride the caller's moment if given, else open I_AM's own act. Same shape as roleWordRegistry.
async function _inAct(moment, label, fn) {
  if (moment) return fn(moment);
  const { withIAmAct } = await import("../../sprout.js");
  return withIAmAct(label, fn);
}

// Bind a word to its host: lay a declare-word fact carrying the binding descriptor. The descriptor
// is SERIALIZABLE -- handlers are refs to code matter, not inline functions, because a fact is data.
// Re-binding lays a fresh declare-word fact; the fold's last declaration wins (the words-stack rule).
// Returns { word, branch }.
export async function bindWord(name, descriptor = {}, { moment = null, branch = "0", actorBeingId = null, skipIfUnchanged = false } = {}) {
  if (!name || typeof name !== "string") throw new Error("bindWord: a non-empty word name is required");
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _actor(actorBeingId);
  const { ownerExtension = "seed", ...rest } = descriptor;
  // Keep only what a fact can hold: JSON round-trip drops any function (a seed handler must be
  // passed as a ref). What survives is the word's serializable binding.
  const binding = JSON.parse(JSON.stringify(rest));
  // Idempotency (the genesis fold reruns every boot): if the word's latest binding already matches,
  // skip the redundant declare-word fact, so a reboot does not grow the chain by a declare per boot.
  // Safe by construction: a content difference always differs as JSON, so this never skips a real change.
  if (skipIfUnchanged) {
    const current = await getWord(name, branch);
    if (current) {
      const { word: _w, ...curBinding } = current;
      if (JSON.stringify(curBinding) === JSON.stringify(binding)) return { word: name, branch: String(branch), skipped: true };
    }
  }
  await _inAct(moment, `I declare the word ${name}`, (ctx) => emitFact({
    through: actor, branch: String(branch), verb: "do", act: DECLARE,
    of: { kind: "being", id: actor },
    params: { word: name, ownerExtension, binding },
  }, ctx));
  if (String(branch) === "0") _projection.set(name, binding); // keep the live projection current
  return { word: name, branch: String(branch) };
}

// Disable a word: lay a disable-word fact. The declaration stays on the chain forever; this is
// the "new word that says it can't be used". A later re-bind (a fresh declare) re-enables it.
export async function disableWord(name, { moment = null, branch = "0", actorBeingId = null } = {}) {
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _actor(actorBeingId);
  await _inAct(moment, `I disable the word ${name}`, (ctx) => emitFact({
    through: actor, branch: String(branch), verb: "do", act: DISABLE,
    of: { kind: "being", id: actor },
    params: { word: name },
  }, ctx));
  if (String(branch) === "0") _projection.delete(String(name));
}

// Ask for a word: fold its declare-word / disable-word facts into the current descriptor. Heaven
// ("0", the seed vocabulary) is inherited by every branch; a branch's own facts layer on top, in
// date/seq order, last action wins. A word whose last action is a disable folds to null (it is not
// deleted, it is off). This is the read path the verb dispatch will use instead of a registry get.
export async function getWord(name, branch = "0") {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const branches = String(branch) === "0" ? ["0"] : ["0", String(branch)];
  const facts = await Fact.find({
    verb: "do", act: { $in: [DECLARE, DISABLE] }, "params.word": String(name),
    branch: { $in: branches },
  }).sort({ date: 1, seq: 1 }).lean();
  let binding = null;
  for (const f of facts) {
    if (f.act === DECLARE) binding = f.params?.binding ?? {};
    else binding = null; // disable wins until a later re-declare
  }
  return binding ? { word: String(name), ...binding } : null;
}

// ── the live projection: an in-memory fold of the vocabulary, for sync reads ──
//
// getWord reads the chain per call (correct, slow). The verb dispatch needs a SYNC, fast read of the
// current vocabulary, so _projection holds the fold of declare-word / disable-word facts on heaven
// "0" (the story vocabulary, inherited by every branch), kept current as bindWord lays facts and
// rebuilt from the chain at boot by rehydrateWordProjection. A cache of the fold, not a registry:
// the facts are the truth, this is their reading (the wakes / Being-row pattern).
const _projection = new Map(); // word name -> binding

export async function rehydrateWordProjection(branch = "0") {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const facts = await Fact.find({ verb: "do", act: { $in: [DECLARE, DISABLE] }, branch: String(branch), "params.word": { $exists: true } })
    .sort({ date: 1, seq: 1 }).lean();
  _projection.clear();
  for (const f of facts) {
    const name = f.params?.word;
    if (!name) continue;
    if (f.act === DECLARE) _projection.set(String(name), f.params.binding ?? {});
    else _projection.delete(String(name)); // disable; a later declare re-adds
  }
  return _projection.size;
}

// Sync read of the live projection (the dispatch's path; no per-call chain read). Same shape as
// getWord, or null when the word is unbound or disabled.
export function getWordSync(name) {
  const b = _projection.get(String(name));
  return b ? { word: String(name), ...b } : null;
}

// ── the host side: resolving a word's handler ref to runnable code ──
//
// A word's do-answer is a code matter, carried in the fact as a ref (do.ref). For a SEED word the
// matter is bundled in the build, so the host holds it here by ref; for an in-world word the ref is
// a CAS code matter resolved from the store (not yet wired). This table is host, the bottom turtle,
// NOT a registry of words: the words are the fold; this only maps a ref to the bundled function.
const _hostHandlers = new Map();

export function registerHostHandler(ref, fn) {
  if (typeof ref !== "string" || !ref) throw new Error("registerHostHandler: a non-empty ref is required");
  if (typeof fn !== "function") throw new Error("registerHostHandler: fn must be a function");
  _hostHandlers.set(ref, fn);
}

export function resolveHostHandler(ref) {
  return _hostHandlers.get(String(ref)) || null;
}

// Resolve a do-word from the FOLD into the op spec doVerb dispatches (the handler from its ref).
// Returns null when the word is unbound, disabled, has no do-answer, or its handler matter is not
// resolvable. doVerb calls this only on an operations-Map miss, so the fold is an additive source.
export function resolveDoOpFromFold(name) {
  const word = getWordSync(name);
  if (!word?.do?.ref) return null;
  const handler = resolveHostHandler(word.do.ref);
  if (!handler) return null;
  const spec = {
    handler,
    targets: Array.isArray(word.targets) && word.targets.length ? word.targets : ["being", "space", "matter"],
    matterTypes: Array.isArray(word.matterTypes) && word.matterTypes.length ? word.matterTypes : null,
    factAction: typeof word.factAction === "string" && word.factAction ? word.factAction : String(name),
    skipAudit: !!word.skipAudit,
    ownerExtension: word.ownerExtension || "seed",
    _fromFold: true,
  };
  // authAction is a function (the auth-key refinement) carried in the fact as a host ref. Resolve it
  // so a fold op refines its auth (e.g. grant-role -> grant-role:<role>) exactly as a Map op does.
  if (word.authAction?.ref) {
    const fn = resolveHostHandler(word.authAction.ref);
    if (typeof fn === "function") spec.authAction = fn;
  }
  return spec;
}

// Declare existing registered ops into the fold (the do-ops migration bridge, one concept at a time).
// For each op matching the filter, register its bundled handler by ref and lay a declare-word fact
// carrying its serializable descriptor; the op then resolves from the fold (resolveDoOpFromFold) as
// well as the Map, until the Map is retired. NOTE: authAction is a function (not serializable), so an
// op that refines its auth key keeps that refinement on the Map path until the host-ref form lands.
// Returns the count declared. filter: { target } or { ownerExtension } (see operations.listOperations).
export async function declareOpsToFold({ moment = null, branch = "0", filter = {} } = {}) {
  const { listOperations, getOperation } = await import("../../ibp/operations.js");
  const names = listOperations(filter).map((o) => o.name);
  let n = 0;
  for (const name of names) {
    const op = getOperation(name);
    if (!op?.handler) continue;
    registerHostHandler(name, op.handler);
    // authAction is a function (the auth-key refinement); carry it as a host ref so the fold op keeps it.
    const authRef = typeof op.authAction === "function" ? `${name}:authAction` : null;
    if (authRef) registerHostHandler(authRef, op.authAction);
    await bindWord(name, {
      ownerExtension: op.ownerExtension || "seed",
      kind: "op",
      do: { ref: name },
      authAction: authRef ? { ref: authRef } : undefined,
      targets: Array.isArray(op.targets) ? [...op.targets] : ["being"],
      matterTypes: Array.isArray(op.matterTypes) && op.matterTypes.length ? [...op.matterTypes] : undefined,
      factAction: typeof op.factAction === "string" && op.factAction ? op.factAction : name,
      skipAudit: !!op.skipAudit,
      useNamespaceKey: op.useNamespaceKey ? true : undefined,
    }, { moment, branch, skipIfUnchanged: true });
    n++;
  }
  return n;
}
