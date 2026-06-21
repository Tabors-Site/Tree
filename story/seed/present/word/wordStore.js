// wordStore.js . a word is a FOLD of coin facts, not a registry entry.
//
// This is the connecter as a fold (philosophy/word/10.md §2). `bindWord` lays a coin
// fact carrying the word's binding descriptor; `getWord` folds the coin / retire
// facts back into the current descriptor, the same call that reconstructs a Being from its facts.
// No registry: language stops being the one exception to facts -> fold -> story.
//
// It is all matter, so a handler in the descriptor is a REF to code matter (a CAS id, or a seed
// bundled-handler key), never an inline function -- a fact is data. A composite word carries no
// handler at all, only a `can[]` grant-set pointing at words that already answer; words stack.
//
// Generalizes roleWordRegistry's (role:op) coin fold to any word + a full descriptor:
// same act names, same I_AM-is-the-seed-vocabulary actor, same "disable is a new fact" rule.
// (9.md §2/§6; the words-stack doctrine; the wakes pattern of an in-memory projection over facts.)

const COIN = "coin";
const RETIRE = "retire";

// Every word-fact needs an actor (the being whose authority declares it). I_AM declares the seed
// vocabulary; an extension installer or a being in world declares its own. Mirrors roleWordRegistry.
async function _actor(actorBeingId) {
  if (actorBeingId) return String(actorBeingId);
  const { I_AM } = await import("../../materials/being/seedBeings.js");
  return String(I_AM); // the origin being declares the seed vocabulary
}

let _iAmId = null;
async function _iAm() {
  if (_iAmId == null) { const { I_AM } = await import("../../materials/being/seedBeings.js"); _iAmId = String(I_AM); }
  return _iAmId;
}

// BEDROCK (project_iam_genesis_immutable): is `name`'s current heaven ("0") declaration I_AM's? Then
// it is genesis bedrock — immutable on "0" by anyone but I_AM (per-history shadowing is still allowed).
// Covers EVERY word kind (op/type/reducer/concept/roleword), since all are I_AM's words on "0". Reads
// the latest "0" coin fact's author. Only consulted on a non-I_AM write to "0" (rare).
async function _isIAmBedrock(name) {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const decl = await Fact.find({ verb: "do", act: COIN, "params.word": String(name), history: "0" })
    .sort({ date: -1, seq: -1 }).limit(1).lean();
  return decl.length > 0 && String(decl[0].through) === (await _iAm());
}

// Lay facts THROUGH a proper act (assign opens it, the stamper seals it), never a bare emit.
// Ride the caller's moment if given, else open I_AM's own act. Same shape as roleWordRegistry.
async function _inAct(moment, label, fn) {
  if (moment) return fn(moment);
  const { withIAmAct } = await import("../../sprout.js");
  return withIAmAct(label, fn);
}

// Bind a word to its host: lay a coin fact carrying the binding descriptor. The descriptor
// is SERIALIZABLE -- handlers are refs to code matter, not inline functions, because a fact is data.
// Re-binding lays a fresh coin fact; the fold's last declaration wins (the words-stack rule).
// Returns { word, history }.
export async function bindWord(name, descriptor = {}, { moment = null, history = "0", actorBeingId = null, skipIfUnchanged = false } = {}) {
  if (!name || typeof name !== "string") throw new Error("bindWord: a non-empty word name is required");
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _actor(actorBeingId);
  const { ownerExtension = "seed", ...rest } = descriptor;
  // Keep only what a fact can hold: JSON round-trip drops any function (a seed handler must be
  // passed as a ref). What survives is the word's serializable binding.
  const binding = JSON.parse(JSON.stringify(rest));
  // Idempotency (the genesis fold reruns every boot): if the word's latest binding already matches,
  // skip the redundant coin fact, so a reboot does not grow the chain by a declare per boot.
  // Safe by construction: a content difference always differs as JSON, so this never skips a real change.
  if (skipIfUnchanged) {
    const current = await getWord(name, history);
    if (current) {
      // getWord now surfaces ownerExtension (the provenance) alongside the binding; strip it
      // for the binding compare and check it separately, else the dedup never matches and a
      // reboot re-declares every op (chain growth).
      const { word: _w, ownerExtension: curOwner, ...curBinding } = current;
      if (JSON.stringify(curBinding) === JSON.stringify(binding) && curOwner === ownerExtension) return { word: name, history: String(history), skipped: true };
    }
  }
  // BEDROCK guard — AFTER the dedup, so I_AM's idempotent genesis re-declares skip above and only a
  // real override by ANOTHER reaches here. A non-I_AM cannot re-declare an I_AM "0" word on "0".
  if (String(history) === "0" && String(actor) !== (await _iAm()) && await _isIAmBedrock(name)) {
    throw new Error(`the I_AM genesis word "${name}" is bedrock on heaven and cannot be re-declared by another — only I_AM may, or shadow it on your own history`);
  }
  await _inAct(moment, `I coin the word ${name}`, (ctx) => emitFact({
    through: actor, history: String(history), verb: "do", act: COIN,
    of: { kind: "being", id: actor },
    params: { word: name, ownerExtension, binding },
  }, ctx));
  if (String(history) === "0") _projection.set(name, { ...binding, ownerExtension }); // live projection: binding + provenance
  return { word: name, history: String(history) };
}

// Disable a word: lay a retire fact. The declaration stays on the chain forever; this is
// the "new word that says it can't be used". A later re-bind (a fresh declare) re-enables it.
export async function disableWord(name, { moment = null, history = "0", actorBeingId = null } = {}) {
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _actor(actorBeingId);
  // BEDROCK: same guard as bindWord — a non-I_AM cannot disable an I_AM "0" word (shadow on a history).
  if (String(history) === "0" && String(actor) !== (await _iAm()) && await _isIAmBedrock(name)) {
    throw new Error(`the I_AM genesis word "${name}" is bedrock on heaven and cannot be disabled by another — only I_AM may, or shadow it on your own history`);
  }
  await _inAct(moment, `I retire the word ${name}`, (ctx) => emitFact({
    through: actor, history: String(history), verb: "do", act: RETIRE,
    of: { kind: "being", id: actor },
    params: { word: name },
  }, ctx));
  if (String(history) === "0") _projection.delete(String(name));
}

// Ask for a word: fold its coin / retire facts into the current descriptor. Heaven
// ("0", the seed vocabulary) is inherited by every history; a history's own facts layer on top, in
// date/seq order, last action wins. A word whose last action is a disable folds to null (it is not
// deleted, it is off). This is the read path the verb dispatch will use instead of a registry get.
export async function getWord(name, history = "0") {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const histories = String(history) === "0" ? ["0"] : ["0", String(history)];
  const facts = await Fact.find({
    verb: "do", act: { $in: [COIN, RETIRE] }, "params.word": String(name),
    history: { $in: histories },
  }).sort({ date: 1, seq: 1 }).lean();
  let binding = null, owner = null;
  for (const f of facts) {
    if (f.act === COIN) { binding = f.params?.binding ?? {}; owner = f.params?.ownerExtension ?? null; }
    else { binding = null; owner = null; } // disable wins until a later re-declare
  }
  return binding ? { word: String(name), ...binding, ownerExtension: owner } : null;
}

// ── the live projection: an in-memory fold of the vocabulary, for sync reads ──
//
// getWord reads the chain per call (correct, slow). The verb dispatch needs a SYNC, fast read of the
// current vocabulary, so _projection holds the fold of coin / retire facts on heaven
// "0" (the story vocabulary, inherited by every history), kept current as bindWord lays facts and
// rebuilt from the chain at boot by rehydrateWordProjection. A cache of the fold, not a registry:
// the facts are the truth, this is their reading (the wakes / Being-row pattern).
const _projection = new Map(); // word name -> binding

export async function rehydrateWordProjection(history = "0") {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const facts = await Fact.find({ verb: "do", act: { $in: [COIN, RETIRE] }, history: String(history), "params.word": { $exists: true } })
    .sort({ date: 1, seq: 1 }).lean();
  _projection.clear();
  for (const f of facts) {
    const name = f.params?.word;
    if (!name) continue;
    if (f.act === COIN) _projection.set(String(name), { ...(f.params.binding ?? {}), ownerExtension: f.params.ownerExtension });
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
// For each op matching the filter, register its bundled handler by ref and lay a coin fact
// carrying its serializable descriptor; the op then resolves from the fold (resolveDoOpFromFold) as
// well as the Map, until the Map is retired. NOTE: authAction is a function (not serializable), so an
// op that refines its auth key keeps that refinement on the Map path until the host-ref form lands.
// Returns the count declared. filter: { target } or { ownerExtension } (see operations.listOperations).
export async function declareOpsToFold({ moment = null, history = "0", filter = {} } = {}) {
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
      // args (the op's field schema) rides the fold so descriptor.js builds forms from the fold,
      // not the Map (10.md step 6). Serializable, so a fact holds it.
      args: op.args ? JSON.parse(JSON.stringify(op.args)) : undefined,
      useNamespaceKey: op.useNamespaceKey ? true : undefined,
    }, { moment, history, skipIfUnchanged: true });
    n++;
  }
  return n;
}

// List the folded OP words (do-ops) from the live projection — the fold-based replacement for
// operations.listOperations (10.md step 6: descriptor + catalogs read the fold, not the Map). Same
// shape the callers used: {name, ...binding} (targets, factAction, ownerExtension, args, ...).
export function listFoldedOps() {
  const out = [];
  for (const [name, b] of _projection) {
    if (b?.kind === "op") out.push({ name, ...b });
  }
  return out;
}

// ── matter TYPES as words (the types-Map migration, mirroring the do-ops above) ──
//
// A matter type is a word with kind:"type" carrying its serializable shape (contentKinds, ops,
// render, claims, ...). declareTypesToFold mirrors the registered types into the fold; getMatterType
// resolves a type from the fold (resolveTypeFromFold) as well as the Map, until the Map retires.
// (Like the do-ops, the types Map stays as the bootstrap buffer: seed types register at module load,
// before seedFold can declare them, and getMatterType is read during the bootstrap that builds them.)
export async function declareTypesToFold({ moment = null, history = "0" } = {}) {
  const { listMatterTypes } = await import("../../materials/matter/types.js");
  let n = 0;
  for (const t of listMatterTypes()) {
    await bindWord(t.name, {
      ownerExtension: t.ownerExtension || "seed",
      kind: "type",
      description: t.description ?? null,
      contentKinds: Array.isArray(t.contentKinds) ? [...t.contentKinds] : ["text", "none"],
      mimeTypes: Array.isArray(t.mimeTypes) ? [...t.mimeTypes] : null,
      ops: Array.isArray(t.ops) ? [...t.ops] : [],
      render: t.render && typeof t.render === "object" ? { ...t.render } : null,
      claims: t.claims && typeof t.claims === "object" ? JSON.parse(JSON.stringify(t.claims)) : null,
    }, { moment, history, skipIfUnchanged: true });
    n++;
  }
  return n;
}

// Resolve a matter TYPE from the fold into the def getMatterType returns (mirrors resolveDoOpFromFold).
// Null when the word is unbound, disabled, or not a type. Rebuilds the Map's field shape so a fold
// read is value-identical to a Map read (proven by verify-typesfold before getMatterType reads it).
export function resolveTypeFromFold(name) {
  const w = getWordSync(name);
  if (!w || w.kind !== "type") return null;
  return {
    name: String(name),
    description: w.description ?? null,
    contentKinds: Array.isArray(w.contentKinds) && w.contentKinds.length ? [...w.contentKinds] : ["text", "none"],
    mimeTypes: Array.isArray(w.mimeTypes) ? [...w.mimeTypes] : null,
    ops: Array.isArray(w.ops) ? [...w.ops] : [],
    render: w.render && typeof w.render === "object" ? { ...w.render } : null,
    claims: w.claims && typeof w.claims === "object" ? w.claims : null,
    ownerExtension: w.ownerExtension || "seed",
  };
}

// List the folded TYPE words from the live projection (the fold-based listMatterTypes).
export function listFoldedTypes() {
  const out = [];
  for (const [name, b] of _projection) {
    if (b?.kind === "type") out.push(resolveTypeFromFold(name));
  }
  return out;
}

// ── role-words as words (the roleWordRegistry unification; ROLES-UNIFICATION.md) ──
//
// A role-word is a word named "role:op", kind:"roleword", carrying its IR SOURCE (the .word file).
// The parsed IR stays HOST (roleWordRegistry's irCache); the fold carries only role:op -> source, the
// same shape as an op's do.ref. declareRoleWordsToFold mirrors declareOpsToFold (reads the registered
// role-words); resolveRoleWordSource is the sync source-read roleWordRegistry's resolveRoleWord uses.
export async function declareRoleWordsToFold({ moment = null, history = "0" } = {}) {
  const { listRegistered } = await import("./roleWordRegistry.js");
  let n = 0;
  for (const w of listRegistered()) {
    await bindWord(`${w.role}:${w.op}`, {
      kind: "roleword", role: w.role, op: w.op, source: String(w.fileUrl),
    }, { moment, history, skipIfUnchanged: true });
    n++;
  }
  return n;
}

// Resolve a role-word's IR SOURCE from the fold (sync). Null when unbound or not a roleword. The
// caller turns the source into the parsed IR via the host irCache (wordOf).
export function resolveRoleWordSource(role, op) {
  const w = getWordSync(`${role}:${op}`);
  if (!w || w.kind !== "roleword") return null;
  return w.source || null;
}

// ── reducers as words (the reducer-Map migration; the per-kind fold logic) ──
//
// A reducer is the fold logic for an aggregate KIND (being/space/matter/name): {initial, reduce,
// isGone?}, the functions the fold engine runs to fold a reel into state. The functions stay HOST
// (the bottom turtle); what folds is the MAPPING — a word (kind:"reducer") saying "this kind's
// reducer is THESE host functions", carrying their refs. reducers.get reads the fold first, the
// static registry as the bootstrap / non-boot backstop. Named "<kind>-reducer" so it never collides
// with the concept word of the same kind (10.md's "reducer is a field on the kind word" is the
// eventual unification; a distinct word keeps this isolated from declareConcepts for now).
export async function declareReducersToFold({ moment = null, history = "0" } = {}) {
  const reducers = await import("../../materials/reducers.js");
  let n = 0;
  for (const kind of reducers.types()) {
    const r = reducers.get(kind); // fold-first get falls to the static registry here (kind not folded yet)
    registerHostHandler(`reducer:${kind}:initial`, r.initial);
    registerHostHandler(`reducer:${kind}:reduce`, r.reduce);
    const binding = {
      kind: "reducer",
      forKind: kind,
      initial: { ref: `reducer:${kind}:initial` },
      reduce: { ref: `reducer:${kind}:reduce` },
    };
    if (typeof r.isGone === "function") { // optional (only matter tombstones today)
      registerHostHandler(`reducer:${kind}:isGone`, r.isGone);
      binding.isGone = { ref: `reducer:${kind}:isGone` };
    }
    await bindWord(`${kind}-reducer`, binding, { moment, history, skipIfUnchanged: true });
    n++;
  }
  return n;
}

// Resolve a kind's reducer from the fold into {initial, reduce, isGone?} (the host functions from
// their refs). Null when the word is unbound or not a reducer. reducers.get reads this fold-first.
export function resolveReducerFromFold(kind) {
  const w = getWordSync(`${kind}-reducer`);
  if (!w || w.kind !== "reducer") return null;
  const initial = w.initial?.ref ? resolveHostHandler(w.initial.ref) : null;
  const reduce = w.reduce?.ref ? resolveHostHandler(w.reduce.ref) : null;
  if (typeof initial !== "function" || typeof reduce !== "function") return null;
  const out = { initial, reduce };
  if (w.isGone?.ref) {
    const isGone = resolveHostHandler(w.isGone.ref);
    if (typeof isGone === "function") out.isGone = isGone;
  }
  return out;
}

// ── NAME ops as words (the NAME_OPS-Map migration; mirrors declareOpsToFold) ──
//
// A NAME op (declare/connect/release/set-password/banish) is a word named "name:<op>",
// kind:"nameop", carrying its handler by host ref (the handler stays bottom-turtle JS in
// ibp/nameOps.js, a function, never serialized into the fact). Verb-NAMESPACED like role-words
// ("role:op") and reducers ("<kind>-reducer"), NOT bare: the live projection is one shared map keyed
// by word name, so a bare "connect"/"release" would collide with a do-op/type of the same name and,
// once BE folds the same way, with be:connect/be:release. The "name:" prefix isolates them and lets
// the BE/SEE verb-op cutovers coexist. declareNameOpsToFold mirrors declareOpsToFold; the NAME_OPS
// object stays only as the load-time registration buffer this reads (like the operations Map).
export async function declareNameOpsToFold({ moment = null, history = "0" } = {}) {
  const { listNameOpNames, getNameOp } = await import("../../ibp/nameOps.js");
  let n = 0;
  for (const opName of listNameOpNames()) {
    const op = getNameOp(opName);
    if (!op?.handler) continue;
    const ref = `name-op:${opName}`;
    registerHostHandler(ref, op.handler);
    await bindWord(`name:${opName}`, {
      ownerExtension: "seed",
      kind: "nameop",
      do: { ref }, // the runnable answer (the handler), resolved host-side from its ref
      args: op.args ? JSON.parse(JSON.stringify(op.args)) : undefined,
      label: op.label,
      description: op.description,
    }, { moment, history, skipIfUnchanged: true });
    n++;
  }
  return n;
}

// Resolve a NAME op from the fold into the spec nameVerb dispatches (the handler from its ref). Null
// when unbound, disabled, not a nameop, or the handler ref is unresolvable. The op name arrives BARE
// (the verb dispatches "declare"); this namespaces it to the "name:<op>" word. Mirrors
// resolveDoOpFromFold; nameVerb dispatches on this instead of getNameOp(NAME_OPS).
export function resolveNameOpFromFold(opName) {
  const w = getWordSync(`name:${opName}`);
  if (!w || w.kind !== "nameop" || !w.do?.ref) return null;
  const handler = resolveHostHandler(w.do.ref);
  if (!handler) return null;
  return { handler, args: w.args, label: w.label, description: w.description, ownerExtension: w.ownerExtension || "seed", _fromFold: true };
}

// ── BE ops as words (the BE_OPS-Map migration; the twin of the NAME ops above) ──
//
// A BE op (birth/connect/release/switch/death/truename) is a word named "be:<op>", kind:"beop",
// carrying its handler by host ref (the handler lives with cherub's role, a function, never
// serialized). Verb-namespaced "be:<op>" so be:connect/be:release never collide with name:connect/
// name:release in the shared projection. Unlike NAME, a BE op also carries `bootstrap` (birth/connect
// skip assertVerbCaller — the caller has no identity yet); it's a serializable boolean, so it rides
// the binding. BE_OPS stays as the load-time registration buffer this reads. I_AM's own genesis
// be:birth (sprout.js) is a raw emitFact, never beVerb, so it predates + grounds this fold untouched.
export async function declareBeOpsToFold({ moment = null, history = "0" } = {}) {
  const { listBeOpNames, getBeOp } = await import("../../ibp/beOps.js");
  let n = 0;
  for (const opName of listBeOpNames()) {
    const op = getBeOp(opName);
    if (!op?.handler) continue;
    const ref = `be-op:${opName}`;
    registerHostHandler(ref, op.handler);
    await bindWord(`be:${opName}`, {
      ownerExtension: "seed",
      kind: "beop",
      do: { ref },
      bootstrap: op.bootstrap ? true : undefined, // birth/connect skip the caller assertion
      // factAction + skipAudit let a .word-authored BE op return factParams and have the BE
      // dispatcher stamp the one auto-Fact (mirroring the do-op fold) instead of a hardcoded
      // writeBeFact. The act defaults to the op name (be:truename); skipAudit suppresses the stamp.
      factAction: op.factAction || opName,
      skipAudit: op.skipAudit ? true : undefined,
      args: op.args ? JSON.parse(JSON.stringify(op.args)) : undefined,
      label: op.label,
      description: op.description,
    }, { moment, history, skipIfUnchanged: true });
    n++;
  }
  return n;
}

// Resolve a BE op from the fold into the spec beVerb dispatches (handler + bootstrap, from the ref).
// Null when unbound, disabled, not a beop, or the handler ref is unresolvable. The op name arrives
// BARE (beVerb dispatches "birth"); this namespaces it to the "be:<op>" word. Mirrors
// resolveNameOpFromFold; beVerb dispatches on this instead of getBeOp(BE_OPS).
export function resolveBeOpFromFold(opName) {
  const w = getWordSync(`be:${opName}`);
  if (!w || w.kind !== "beop" || !w.do?.ref) return null;
  const handler = resolveHostHandler(w.do.ref);
  if (!handler) return null;
  return { handler, bootstrap: !!w.bootstrap, factAction: w.factAction || opName, skipAudit: !!w.skipAudit, args: w.args, label: w.label, description: w.description, ownerExtension: w.ownerExtension || "seed", _fromFold: true };
}

// ── SEE ops as words (the seeOps-REGISTRY migration; the third verb-op set) ──
//
// A SEE op is a word named "see:<op>", kind:"seeop", carrying its handler by host ref. SEE is read-
// only — no fact, no bootstrap, no targets — so the binding is just the handler ref + args +
// description. seeVerb dispatches resolveSeeOpFromFold; the seeOps REGISTRY stays as the registration
// buffer + the routing check (isSeeOpName) + the metadata reads (listSeeOperations). The op name may
// itself contain a colon (the "<ext>:<name>" extension form) — the "see:" prefix nests cleanly into
// the word key ("see:food:meals"), no collision with name:/be:/role:op words.
export async function declareSeeOpsToFold({ moment = null, history = "0" } = {}) {
  const { listSeeOperations, getSeeOperation } = await import("../../ibp/seeOps.js");
  let n = 0;
  for (const { name } of listSeeOperations()) {
    const op = getSeeOperation(name);
    if (!op?.handler) continue;
    const ref = `see-op:${name}`;
    registerHostHandler(ref, op.handler);
    await bindWord(`see:${name}`, {
      ownerExtension: op.ownerExtension || "seed",
      kind: "seeop",
      do: { ref },
      args: op.args ? JSON.parse(JSON.stringify(op.args)) : undefined,
      description: op.description || undefined,
    }, { moment, history, skipIfUnchanged: true });
    n++;
  }
  return n;
}

// Resolve a SEE op from the fold into the spec seeVerb dispatches (the handler from its ref). Null
// when unbound, disabled, not a seeop, or the handler ref is unresolvable. The op name arrives BARE
// (seeVerb dispatches "place" / "arrival-view" / "food:meals"); this namespaces it to the "see:<op>"
// word. Mirrors resolveNameOpFromFold / resolveBeOpFromFold.
export function resolveSeeOpFromFold(name) {
  const w = getWordSync(`see:${name}`);
  if (!w || w.kind !== "seeop" || !w.do?.ref) return null;
  const handler = resolveHostHandler(w.do.ref);
  if (!handler) return null;
  return { name, handler, args: w.args, description: w.description, ownerExtension: w.ownerExtension || "seed", _fromFold: true };
}
