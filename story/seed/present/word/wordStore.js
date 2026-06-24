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
// Generalizes ableWordRegistry's (able:op) coin fold to any word + a full descriptor:
// same act names, same I-is-the-seed-vocabulary actor, same "disable is a new fact" rule.
// (9.md §2/§6; the words-stack doctrine; the wakes pattern of an in-memory projection over facts.)

const COIN = "coin";
const RETIRE = "retire";

// Every word-fact needs an actor (the being whose authority declares it). I declares the seed
// vocabulary; an extension installer or a being in world declares its own. Mirrors ableWordRegistry.
async function _actor(actorBeingId) {
  if (actorBeingId) return String(actorBeingId);
  const { I } = await import("../../materials/being/seedBeings.js");
  return String(I); // the origin being declares the seed vocabulary
}

let _iAmId = null;
async function _iAm() {
  if (_iAmId == null) {
    const { I } = await import("../../materials/being/seedBeings.js");
    _iAmId = String(I);
  }
  return _iAmId;
}

// BEDROCK (project_iam_genesis_immutable): is `name`'s current heaven ("0") declaration I's? Then
// it is genesis bedrock — immutable on "0" by anyone but I (per-history shadowing is still allowed).
// Covers EVERY word kind (op/type/reducer/concept/ableword), since all are I's words on "0". Reads
// the latest "0" coin fact's author. Only consulted on a non-I write to "0" (rare).
async function _isIAmBedrock(name) {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const decl = await Fact.find({
    verb: "do",
    act: COIN,
    "params.word": String(name),
    history: "0",
  })
    .sort({ seq: -1, date: -1 }) // ORDER, not the clock: one '0' word-reel → seq is truth (623/12)
    .limit(1)
    .lean();
  return decl.length > 0 && String(decl[0].through) === (await _iAm());
}

// Lay facts THROUGH a proper act (assign opens it, the stamper seals it), never a bare emit.
// Ride the caller's moment if given, else open I's own act. Same shape as ableWordRegistry.
async function _inAct(moment, label, fn) {
  if (moment) return fn(moment);
  const { withIAmAct } = await import("../../sprout.js");
  return withIAmAct(label, fn);
}

// Bind a word to its host: lay a coin fact carrying the binding descriptor. The descriptor
// is SERIALIZABLE -- handlers are refs to code matter, not inline functions, because a fact is data.
// Re-binding lays a fresh coin fact; the fold's last declaration wins (the words-stack rule).
// Returns { word, history }.
export async function bindWord(
  name,
  descriptor = {},
  {
    moment = null,
    history = "0",
    actorBeingId = null,
    skipIfUnchanged = false,
  } = {},
) {
  if (!name || typeof name !== "string")
    throw new Error("bindWord: a non-empty word name is required");
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
      if (
        JSON.stringify(curBinding) === JSON.stringify(binding) &&
        curOwner === ownerExtension
      )
        return { word: name, history: String(history), skipped: true };
    }
  }
  // BEDROCK guard — AFTER the dedup, so I's idempotent genesis re-declares skip above and only a
  // real override by ANOTHER reaches here. A non-I cannot re-declare an I "0" word on "0".
  if (
    String(history) === "0" &&
    String(actor) !== (await _iAm()) &&
    (await _isIAmBedrock(name))
  ) {
    throw new Error(
      `the I genesis word "${name}" is bedrock on heaven and cannot be re-declared by another — only I may, or shadow it on your own history`,
    );
  }
  await _inAct(moment, `I coin the word ${name}`, (ctx) =>
    emitFact(
      {
        through: actor,
        history: String(history),
        verb: "do",
        act: COIN,
        of: { kind: "being", id: actor },
        params: { word: name, ownerExtension, binding },
      },
      ctx,
    ),
  );
  if (String(history) === "0")
    _projection.set(name, { ...binding, ownerExtension }); // live projection: binding + provenance
  return { word: name, history: String(history) };
}

// Disable a word: lay a retire fact. The declaration stays on the chain forever; this is
// the "new word that says it can't be used". A later re-bind (a fresh declare) re-enables it.
export async function disableWord(
  name,
  { moment = null, history = "0", actorBeingId = null } = {},
) {
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _actor(actorBeingId);
  // BEDROCK: same guard as bindWord — a non-I cannot disable an I "0" word (shadow on a history).
  if (
    String(history) === "0" &&
    String(actor) !== (await _iAm()) &&
    (await _isIAmBedrock(name))
  ) {
    throw new Error(
      `the I genesis word "${name}" is bedrock on heaven and cannot be disabled by another — only I may, or shadow it on your own history`,
    );
  }
  await _inAct(moment, `I retire the word ${name}`, (ctx) =>
    emitFact(
      {
        through: actor,
        history: String(history),
        verb: "do",
        act: RETIRE,
        of: { kind: "being", id: actor },
        params: { word: name },
      },
      ctx,
    ),
  );
  if (String(history) === "0") _projection.delete(String(name));
}

// Ask for a word: fold its coin / retire facts into the current descriptor. Heaven
// ("0", the seed vocabulary) is inherited by every history; a history's own facts layer on top by
// HISTORY PRECEDENCE — heaven "0" folds first, the branch's own facts override it (last action wins
// within each, by seq). ORDER, never the clock (623/12): "0" < any branch id, so {history, seq}
// folds heaven then the branch. A word whose last action is a disable folds to null (off, not
// deleted). This is the read path the verb dispatch uses instead of a registry get.
export async function getWord(name, history = "0") {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const histories = String(history) === "0" ? ["0"] : ["0", String(history)];
  const facts = await Fact.find({
    verb: "do",
    act: { $in: [COIN, RETIRE] },
    "params.word": String(name),
    history: { $in: histories },
  })
    .sort({ history: 1, seq: 1 })
    .lean();
  let binding = null,
    owner = null;
  for (const f of facts) {
    if (f.act === COIN) {
      binding = f.params?.binding ?? {};
      owner = f.params?.ownerExtension ?? null;
    } else {
      binding = null;
      owner = null;
    } // disable wins until a later re-declare
  }
  return binding
    ? { word: String(name), ...binding, ownerExtension: owner }
    : null;
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
  const facts = await Fact.find({
    verb: "do",
    act: { $in: [COIN, RETIRE] },
    history: String(history),
    "params.word": { $exists: true },
  })
    .sort({ date: 1, seq: 1 })
    .lean();
  _projection.clear();
  for (const f of facts) {
    const name = f.params?.word;
    if (!name) continue;
    if (f.act === COIN)
      _projection.set(String(name), {
        ...(f.params.binding ?? {}),
        ownerExtension: f.params.ownerExtension,
      });
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
  if (typeof ref !== "string" || !ref)
    throw new Error("registerHostHandler: a non-empty ref is required");
  if (typeof fn !== "function")
    throw new Error("registerHostHandler: fn must be a function");
  _hostHandlers.set(ref, fn);
}

export function resolveHostHandler(ref) {
  return _hostHandlers.get(String(ref)) || null;
}

// Resolve ANY word from the FOLD into its raw binding spec — the ONE resolver under all four verb
// resolvers (17.md STEP 1). One `getWordSync` + one eager `resolveHostHandler` (a pure Map.get, safe
// ahead of the auth gate) + the kind-agnostic field set. The per-verb resolvers below are thin
// wrappers that prefix the name, assert the expected kind, and shape the return to their verb. The
// word already carries its `kind`; the verb is redundant with it (17.md). Returns null when unbound,
// disabled, has no do-answer (the runnable handler ref), or the handler ref is unresolvable.
export function resolveWordFromFold(name) {
  const w = getWordSync(name);
  if (!w) return null;
  // A word's BODY is EITHER a host-handler ref (do.ref → bottom-turtle JS) OR matter (a content-
  // addressed blob run through its matter TYPE's run-op — P5 native-words, matterWord.js). A
  // matter-bodied word resolves WITHOUT a host handler; the dispatcher routes it to runMatterWord
  // instead of calling a JS handler. Shape matches runMatterWord's `matter` param ({hash,type,
  // effect?,entry?}); the binding side (bindWord carrying matter:{…}) is the engine lane's wiring.
  const matter =
    w.matter && w.matter.hash && w.matter.type
      ? {
          hash: String(w.matter.hash),
          type: String(w.matter.type),
          ...(w.matter.effect === "pure" || w.matter.effect === "effectful"
            ? { effect: w.matter.effect }
            : {}),
          ...(typeof w.matter.entry === "string" && w.matter.entry
            ? { entry: w.matter.entry }
            : {}),
        }
      : null;
  const handler = w.do?.ref ? resolveHostHandler(w.do.ref) : null;
  // Unrunnable: neither a resolvable host handler nor a matter body. (A do.ref that fails to resolve
  // with NO matter fallback stays null — the prior "missing handler → null" contract, preserved.)
  if (!handler && !matter) return null;
  const spec = {
    name,
    kind: w.kind || null,
    handler,
    matter,
    factAction:
      typeof w.factAction === "string" && w.factAction ? w.factAction : null,
    factVerb: typeof w.factVerb === "string" && w.factVerb ? w.factVerb : null,
    noun: typeof w.noun === "string" && w.noun ? w.noun : null,
    // resultPolicy.keep: the fail-closed allowlist the keystone (emitWordFact) curates the stamped
    // fact's result to. Carried through so the dispatcher's resolved binding reaches the policy.
    resultPolicy:
      w.resultPolicy && Array.isArray(w.resultPolicy.keep)
        ? w.resultPolicy
        : null,
    bootstrap: !!w.bootstrap,
    targets: Array.isArray(w.targets) && w.targets.length ? w.targets : null,
    matterTypes:
      Array.isArray(w.matterTypes) && w.matterTypes.length
        ? w.matterTypes
        : null,
    args: w.args,
    label: w.label,
    description: w.description,
    ownerExtension: w.ownerExtension || "seed",
    _fromFold: true,
  };
  // authAction is a function (the auth-key refinement) carried as a host ref. Resolve it so a fold op
  // refines its auth (e.g. grant-able -> grant-able:<able>) exactly as a Map op does.
  if (w.authAction?.ref) {
    const fn = resolveHostHandler(w.authAction.ref);
    if (typeof fn === "function") spec.authAction = fn;
  }
  return spec;
}

// Resolve a do-word from the FOLD into the op spec doVerb dispatches. Thin wrapper over
// resolveWordFromFold (kind-agnostic, as the do path always was — a bare name with a do.ref is a
// do-op). doVerb calls this only on an operations-Map miss, so the fold is an additive source.
export function resolveDoOpFromFold(name) {
  const w = resolveWordFromFold(name);
  if (!w) return null;
  const spec = {
    handler: w.handler,
    matter: w.matter || null, // a native do-op: body is matter, dispatch routes to runMatterWord
    targets: w.targets || ["being", "space", "matter"],
    matterTypes: w.matterTypes,
    factAction: w.factAction || String(name),
    ownerExtension: w.ownerExtension,
    _fromFold: true,
  };
  if (w.authAction) spec.authAction = w.authAction;
  return spec;
}

// Declare existing registered ops into the fold (the do-ops migration bridge, one concept at a time).
// For each op matching the filter, register its bundled handler by ref and lay a coin fact
// carrying its serializable descriptor; the op then resolves from the fold (resolveDoOpFromFold) as
// well as the Map, until the Map is retired. NOTE: authAction is a function (not serializable), so an
// op that refines its auth key keeps that refinement on the Map path until the host-ref form lands.
// Returns the count declared. filter: { target } or { ownerExtension } (see operations.listOperations).
export async function declareOpsToFold({
  moment = null,
  history = "0",
  filter = {},
} = {}) {
  const { listOperations, getOperation } =
    await import("../../ibp/operations.js");
  const names = listOperations(filter).map((o) => o.name);
  let n = 0;
  for (const name of names) {
    const op = getOperation(name);
    if (!op?.handler) continue;
    registerHostHandler(name, op.handler);
    // authAction is a function (the auth-key refinement); carry it as a host ref so the fold op keeps it.
    const authRef =
      typeof op.authAction === "function" ? `${name}:authAction` : null;
    if (authRef) registerHostHandler(authRef, op.authAction);
    await bindWord(
      name,
      {
        ownerExtension: op.ownerExtension || "seed",
        kind: "op",
        do: { ref: name },
        authAction: authRef ? { ref: authRef } : undefined,
        targets: Array.isArray(op.targets) ? [...op.targets] : ["being"],
        matterTypes:
          Array.isArray(op.matterTypes) && op.matterTypes.length
            ? [...op.matterTypes]
            : undefined,
        factAction:
          typeof op.factAction === "string" && op.factAction
            ? op.factAction
            : name,
        // args (the op's field schema) rides the fold so descriptor.js builds forms from the fold,
        // not the Map (10.md step 6). Serializable, so a fact holds it.
        args: op.args ? JSON.parse(JSON.stringify(op.args)) : undefined,
        useNamespaceKey: op.useNamespaceKey ? true : undefined,
      },
      { moment, history, skipIfUnchanged: true },
    );
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
export async function declareTypesToFold({
  moment = null,
  history = "0",
} = {}) {
  const { listMatterTypes } = await import("../../materials/matter/types.js");
  let n = 0;
  for (const t of listMatterTypes()) {
    await bindWord(
      t.name,
      {
        ownerExtension: t.ownerExtension || "seed",
        kind: "type",
        description: t.description ?? null,
        contentKinds: Array.isArray(t.contentKinds)
          ? [...t.contentKinds]
          : ["text", "none"],
        mimeTypes: Array.isArray(t.mimeTypes) ? [...t.mimeTypes] : null,
        ops: Array.isArray(t.ops) ? [...t.ops] : [],
        render:
          t.render && typeof t.render === "object" ? { ...t.render } : null,
        claims:
          t.claims && typeof t.claims === "object"
            ? JSON.parse(JSON.stringify(t.claims))
            : null,
        executable:
          t.executable && typeof t.executable === "object"
            ? { ...t.executable }
            : null, // 21.md P5: the run-op + effect-class ride the fold
        // FIELDS — the type's attribute schema ("a X has Y"), folded from `has` laws (all-rules-fold).
        fields: Array.isArray(t.fields) ? [...t.fields] : [],
      },
      { moment, history, skipIfUnchanged: true },
    );
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
    contentKinds:
      Array.isArray(w.contentKinds) && w.contentKinds.length
        ? [...w.contentKinds]
        : ["text", "none"],
    mimeTypes: Array.isArray(w.mimeTypes) ? [...w.mimeTypes] : null,
    ops: Array.isArray(w.ops) ? [...w.ops] : [],
    render: w.render && typeof w.render === "object" ? { ...w.render } : null,
    claims: w.claims && typeof w.claims === "object" ? w.claims : null,
    executable:
      w.executable && typeof w.executable === "object"
        ? { ...w.executable }
        : null, // 21.md P5
    fields: Array.isArray(w.fields) ? [...w.fields] : [],
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

// ── the DECLARATION half of "a X has Y" (matter-type ← fold convergence; all-rules-fold) ──
//
// A `has` law ("A meal has a calorie.") declares a FIELD on a matter TYPE: the schema is a fact, not a
// JS registry edit. declareTypeFieldToFold APPENDS the field to the type word's `fields` array (the
// FOLD of every `has` fact for that subject is the field-set). If the type word exists, re-bind it with
// the field appended (CAS no-op on re-declare via skipIfUnchanged). If it does NOT yet exist,
// AUTO-CREATE a minimal type word so "a X has Y" alone introduces the type.
//
// GUARDS (the type-name shape + the genesis-immutable rule):
//   * the subject must match a matter-type NAME (SEED_NAME_RE / EXT_NAME_RE from types.js) — an invalid
//     name is a log.warn + skip, NEVER a throw (a bad `has` can't abort the whole word mid-fold).
//   * the MAX_REGISTERED ceiling is honored (a runaway word can't flood the type registry).
//   * AUTO-CREATE only on heaven history "0" (the seed vocabulary lives there); on a branch, a `has` on
//     an unknown type is a no-op skip (a branch can append a field to an existing type, not mint one).
//   * a `has` only APPENDS to `fields`; it NEVER rewrites contentKinds/ops/claims (I-genesis-immutable
//     — the type's intrinsic shape is bedrock; a field is additive).
const TYPE_SEED_NAME_RE = /^[a-z][a-z0-9-]*$/;
const TYPE_EXT_NAME_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
const TYPE_MAX_REGISTERED = 500;

export async function declareTypeFieldToFold(
  subject,
  field,
  { moment = null, history = "0" } = {},
) {
  const log = (await import("../../seedStory/log.js")).default;
  const name = String(subject || "");
  // NAME-SHAPE guard: only a valid matter-type name may carry a field. Invalid → warn + skip (the bad
  // `has` is inert; the rest of the word keeps folding). NEVER throw mid-fold.
  if (!TYPE_SEED_NAME_RE.test(name) && !TYPE_EXT_NAME_RE.test(name)) {
    log.warn(
      "WordStore",
      `declareTypeFieldToFold("${name}"): invalid type name (a "has" subject must be a matter-type name). Skipped.`,
    );
    return { skipped: true, reason: "invalid-name" };
  }
  const f = {
    name: String(field?.name ?? ""),
    optional: !!field?.optional,
    ...(field?.gloss != null
      ? { gloss: String(field.gloss) }
      : { gloss: null }),
  };
  if (!f.name) {
    log.warn(
      "WordStore",
      `declareTypeFieldToFold("${name}"): a field needs a name. Skipped.`,
    );
    return { skipped: true, reason: "no-field-name" };
  }
  // Read the subject's CURRENT type binding from the FOLD (all-rules-fold — never the Map).
  const existing = resolveTypeFromFold(name);
  if (existing) {
    // APPEND-ONLY: keep the type's intrinsic shape (contentKinds/ops/claims/…) verbatim; add the field.
    // skipIfUnchanged makes a re-declare of the same field a CAS no-op (the fold already carries it).
    const fields = [...(Array.isArray(existing.fields) ? existing.fields : [])];
    if (!fields.some((x) => x && x.name === f.name)) fields.push(f);
    return bindWord(
      name,
      {
        ownerExtension: existing.ownerExtension || "seed",
        kind: "type",
        description: existing.description ?? null,
        contentKinds: Array.isArray(existing.contentKinds)
          ? [...existing.contentKinds]
          : ["text", "none"],
        mimeTypes: Array.isArray(existing.mimeTypes)
          ? [...existing.mimeTypes]
          : null,
        ops: Array.isArray(existing.ops) ? [...existing.ops] : [],
        render:
          existing.render && typeof existing.render === "object"
            ? { ...existing.render }
            : null,
        claims:
          existing.claims && typeof existing.claims === "object"
            ? JSON.parse(JSON.stringify(existing.claims))
            : null,
        executable:
          existing.executable && typeof existing.executable === "object"
            ? { ...existing.executable }
            : null,
        fields,
      },
      { moment, history, skipIfUnchanged: true },
    );
  }
  // AUTO-CREATE a minimal type word — but ONLY on heaven "0" (the seed vocabulary). On a branch, a `has`
  // on an unknown type is a no-op skip (you append to an existing type, you don't mint one off heaven).
  if (String(history) !== "0") {
    log.warn(
      "WordStore",
      `declareTypeFieldToFold("${name}"): no such type on history "${history}" and auto-create is heaven-only. Skipped.`,
    );
    return { skipped: true, reason: "no-type-off-heaven" };
  }
  // MAX_REGISTERED ceiling: count the folded type words so a runaway word can't flood the registry.
  if (listFoldedTypes().length >= TYPE_MAX_REGISTERED) {
    log.error(
      "WordStore",
      `declareTypeFieldToFold("${name}"): type registry full (${TYPE_MAX_REGISTERED}). Rejected.`,
    );
    return { skipped: true, reason: "registry-full" };
  }
  return bindWord(
    name,
    {
      ownerExtension: "seed",
      kind: "type",
      description: null,
      contentKinds: ["text", "none"],
      mimeTypes: null,
      ops: [],
      render: null,
      claims: null,
      executable: null,
      fields: [f],
    },
    { moment, history, skipIfUnchanged: true },
  );
}

// declareTypeListToFold — the `accepts`/`carries`/`claims` siblings of `has` (the registry vocabulary).
// "A meal accepts text." → APPEND to contentKinds; "carries image/png" → mimeTypes; "claims .json" →
// claims.extensions/mimeTypes/schemes (the classification advertisement). Each appends to an EXISTING
// type word verbatim-elsewhere (append-only, I-genesis-immutable), auto-creating a minimal type on
// heaven "0" exactly as declareTypeFieldToFold does. `which` ∈ {contentKinds, mimeTypes, claims}.
async function declareTypeListToFold(
  subject,
  items,
  which,
  { moment = null, history = "0" } = {},
) {
  const log = (await import("../../seedStory/log.js")).default;
  const name = String(subject || "");
  if (!TYPE_SEED_NAME_RE.test(name) && !TYPE_EXT_NAME_RE.test(name)) {
    log.warn(
      "WordStore",
      `declareTypeListToFold("${name}", ${which}): invalid type name. Skipped.`,
    );
    return { skipped: true, reason: "invalid-name" };
  }
  const list = (Array.isArray(items) ? items : [])
    .map(String)
    .filter((s) => s.length);
  if (!list.length) return { skipped: true, reason: "no-items" };
  const existing = resolveTypeFromFold(name);
  if (!existing) {
    if (String(history) !== "0") {
      log.warn(
        "WordStore",
        `declareTypeListToFold("${name}"): no such type off heaven; auto-create is heaven-only. Skipped.`,
      );
      return { skipped: true, reason: "no-type-off-heaven" };
    }
    if (listFoldedTypes().length >= TYPE_MAX_REGISTERED) {
      log.error(
        "WordStore",
        `declareTypeListToFold("${name}"): type registry full. Rejected.`,
      );
      return { skipped: true, reason: "registry-full" };
    }
  }
  const base = existing || {
    ownerExtension: "seed",
    description: null,
    contentKinds: ["text", "none"],
    mimeTypes: null,
    ops: [],
    render: null,
    claims: null,
    executable: null,
    fields: [],
  };
  // append-only union into the chosen list (contentKinds/mimeTypes) or the claims block.
  const out = {
    ownerExtension: base.ownerExtension || "seed",
    kind: "type",
    description: base.description ?? null,
    contentKinds: Array.isArray(base.contentKinds)
      ? [...base.contentKinds]
      : ["text", "none"],
    mimeTypes: Array.isArray(base.mimeTypes) ? [...base.mimeTypes] : null,
    ops: Array.isArray(base.ops) ? [...base.ops] : [],
    render:
      base.render && typeof base.render === "object"
        ? { ...base.render }
        : null,
    claims:
      base.claims && typeof base.claims === "object"
        ? JSON.parse(JSON.stringify(base.claims))
        : null,
    executable:
      base.executable && typeof base.executable === "object"
        ? { ...base.executable }
        : null,
    fields: Array.isArray(base.fields) ? [...base.fields] : [],
  };
  const union = (cur, add) => {
    const seen = new Set(cur || []);
    for (const x of add)
      if (!seen.has(x)) {
        seen.add(x);
      }
    return [...seen];
  };
  if (which === "contentKinds")
    out.contentKinds = union(out.contentKinds, list);
  else if (which === "mimeTypes")
    out.mimeTypes = union(out.mimeTypes || [], list);
  else if (which === "claims") {
    // a claim item routes by SHAPE: ".ext" → extensions, "a/b" mime → mimeTypes, a bare scheme word →
    // schemes. The classification advertisement (types.js freezeClaims reads these on a getMatterType).
    const c =
      out.claims && typeof out.claims === "object" ? { ...out.claims } : {};
    const exts = [],
      mimes = [],
      schemes = [];
    for (const it of list) {
      if (it.startsWith(".")) exts.push(it.toLowerCase());
      else if (it.includes("/")) mimes.push(it.toLowerCase());
      else schemes.push(it.toLowerCase());
    }
    if (exts.length) c.extensions = union(c.extensions, exts);
    if (mimes.length) c.mimeTypes = union(c.mimeTypes, mimes);
    if (schemes.length) c.schemes = union(c.schemes, schemes);
    out.claims = c;
  }
  return bindWord(name, out, { moment, history, skipIfUnchanged: true });
}

// applyTypeSchemaLaw — the apply-pass dispatcher (runWordToStore calls this per type-schema law after
// the word runs). Routes `has` → a field, `accepts` → contentKinds, `carries` → mimeTypes, `claims` →
// the claims block. Reads the parser's real node fields ({subject, property, optional, gloss} for has;
// {subject, items} for the list siblings). A non-schema law is ignored (returns null).
export async function applyTypeSchemaLaw(
  law,
  { moment = null, history = "0" } = {},
) {
  if (!law || typeof law !== "object") return null;
  switch (law.kind) {
    case "has":
      return declareTypeFieldToFold(
        law.subject,
        {
          name: law.property,
          optional: !!law.optional,
          gloss: law.gloss ?? null,
        },
        { moment, history },
      );
    case "accepts":
      return declareTypeListToFold(law.subject, law.items, "contentKinds", {
        moment,
        history,
      });
    case "carries":
      return declareTypeListToFold(law.subject, law.items, "mimeTypes", {
        moment,
        history,
      });
    case "claims":
      return declareTypeListToFold(law.subject, law.items, "claims", {
        moment,
        history,
      });
    default:
      return null;
  }
}

// ── the PROHIBITION REGISTER (rule 14: a cannot beats a can) — the OBJECTIVE law half ──
//
// "A member cannot back a proposal." / "No member can back it." declares a PROHIBITION: a
// (subject-able, verb, of) triple the able-walk reads BEFORE the positive grant-walk and that turns
// an ok:true into ok:false (ableAuth.js). The register is NOT a JS table — it is the FOLD of every
// `cannot` fact, exactly as a matter-type's field-set is the fold of every `has` fact (all-rules-fold).
//
// Each distinct cannot is its own kind:"law" word so the fold is content-addressed + append-only:
// the word name encodes the triple ("law:cannot:<subject>:<verb>:<of>"), so re-declaring the SAME
// cannot is a CAS no-op (skipIfUnchanged), and a never-deleted law stays a fact forever (you'd retire
// it with a do:retire, the same as any word). The FOLD of all such words IS the prohibition register,
// read on demand by listFoldedProhibitions (the sync projection read, the wakes / type-word pattern).
//
// MIRRORS declareTypeFieldToFold's self-guards: a NAME-SHAPE guard on the subject (an able name), the
// MAX ceiling (a runaway word can't flood the register), heaven-only/append-only (the binding is the
// triple verbatim; re-declare is a no-op). A bad law is a log.warn + skip, NEVER a throw mid-fold.
const PROHIBITION_MAX = 2000;
const _prohibSeg = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export async function applyProhibitionLaw(
  law,
  { moment = null, history = "0" } = {},
) {
  const log = (await import("../../seedStory/log.js")).default;
  if (!law || typeof law !== "object") return null;
  // The parser shapes both "A X cannot Y …" and "No X can Y …" to {kind:"cannot"}; "prohibition"
  // is the doctrine's equivalent node name (evaluator collects both). Accept either.
  if (law.kind !== "cannot" && law.kind !== "prohibition") return null;
  const subject = _prohibSeg(law.subject); // the able the prohibition binds (e.g. "member")
  const verb = _prohibSeg(law.verb); // the auth verb / English verb the cannot names (see/do/back/…)
  if (!subject || !verb) {
    log.warn(
      "WordStore",
      `applyProhibitionLaw: a cannot needs a subject-able + a verb (got subject="${law.subject}", verb="${law.verb}"). Skipped.`,
    );
    return { skipped: true, reason: "incomplete-cannot" };
  }
  const of = law.of != null && law.of !== "it" ? _prohibSeg(law.of) : null; // the object (action/seeOp), or null = the whole verb
  // The triple → one word name. The FOLD of every such word for a (subject, verb, of) IS the register
  // entry; an identical re-declare is a CAS no-op. Each entry is content-addressed by its own name.
  const word = `law:cannot:${subject}:${verb}:${of ?? "*"}`;
  // MAX ceiling — count the folded prohibition words so a runaway word can't flood the register.
  const existing = getWordSync(word);
  if (!existing && listFoldedProhibitions().length >= PROHIBITION_MAX) {
    log.error(
      "WordStore",
      `applyProhibitionLaw("${word}"): prohibition register full (${PROHIBITION_MAX}). Rejected.`,
    );
    return { skipped: true, reason: "register-full" };
  }
  return bindWord(
    word,
    {
      ownerExtension: "seed",
      kind: "law",
      law: "cannot", // the law's polarity (a cannot beats a can — rule 14)
      subject, // the able the prohibition binds
      verb, // the verb it forbids
      of, // the object (action/seeOp/operation/intent), or null = the whole verb
      // the original prose, for audit (a gloss, never interpreted on read).
      gloss: typeof law.of === "string" ? `cannot ${law.verb} ${law.of}` : null,
    },
    { moment, history, skipIfUnchanged: true },
  );
}

// listFoldedProhibitions — the prohibition REGISTER, read on demand off the live projection (the fold
// of every `cannot` word). Each entry: {subject, verb, of}. ableAuth.js consults this BEFORE the
// positive able-walk (rule 14): a cannot covering the actor's ables for the requested {verb,
// action/seeOp} turns an ok:true into ok:false. Pure read (no chain hit), so the auth gate stays sync.
export function listFoldedProhibitions() {
  const out = [];
  for (const [, b] of _projection) {
    if (b?.kind === "law" && b?.law === "cannot")
      out.push({
        subject: String(b.subject),
        verb: String(b.verb),
        of: b.of != null ? String(b.of) : null,
      });
  }
  return out;
}

// ── able-words as words (the ableWordRegistry unification; ABLES-UNIFICATION.md) ──
//
// A able-word is a word named "able:op", kind:"ableword", carrying its IR SOURCE (the .word file).
// The parsed IR stays HOST (ableWordRegistry's irCache); the fold carries only able:op -> source, the
// same shape as an op's do.ref. declareAbleWordsToFold mirrors declareOpsToFold (reads the registered
// able-words); resolveAbleWordSource is the sync source-read ableWordRegistry's resolveAbleWord uses.
export async function declareAbleWordsToFold({
  moment = null,
  history = "0",
} = {}) {
  const { listRegistered } = await import("./ableWordRegistry.js");
  let n = 0;
  for (const w of listRegistered()) {
    await bindWord(
      `${w.able}:${w.op}`,
      {
        kind: "ableword",
        able: w.able,
        op: w.op,
        source: String(w.fileUrl),
      },
      { moment, history, skipIfUnchanged: true },
    );
    n++;
  }
  return n;
}

// Resolve a able-word's IR SOURCE from the fold (sync). Null when unbound or not a ableword. The
// caller turns the source into the parsed IR via the host irCache (wordOf).
export function resolveAbleWordSource(able, op) {
  const w = getWordSync(`${able}:${op}`);
  if (!w || w.kind !== "ableword") return null;
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
export async function declareReducersToFold({
  moment = null,
  history = "0",
} = {}) {
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
    if (typeof r.isGone === "function") {
      // optional (only matter tombstones today)
      registerHostHandler(`reducer:${kind}:isGone`, r.isGone);
      binding.isGone = { ref: `reducer:${kind}:isGone` };
    }
    await bindWord(`${kind}-reducer`, binding, {
      moment,
      history,
      skipIfUnchanged: true,
    });
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
  if (typeof initial !== "function" || typeof reduce !== "function")
    return null;
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
// ibp/nameOps.js, a function, never serialized into the fact). Verb-NAMESPACED like able-words
// ("able:op") and reducers ("<kind>-reducer"), NOT bare: the live projection is one shared map keyed
// by word name, so a bare "connect"/"release" would collide with a do-op/type of the same name and,
// once BE folds the same way, with be:connect/be:release. The "name:" prefix isolates them and lets
// the BE/SEE verb-op cutovers coexist. declareNameOpsToFold mirrors declareOpsToFold; the NAME_OPS
// object stays only as the load-time registration buffer this reads (like the operations Map).
export async function declareNameOpsToFold({
  moment = null,
  history = "0",
} = {}) {
  const { listNameOpNames, getNameOp } = await import("../../ibp/nameOps.js");
  let n = 0;
  for (const opName of listNameOpNames()) {
    const op = getNameOp(opName);
    if (!op?.handler) continue;
    const ref = `name-op:${opName}`;
    registerHostHandler(ref, op.handler);
    await bindWord(
      `name:${opName}`,
      {
        ownerExtension: "seed",
        kind: "nameop",
        do: { ref }, // the runnable answer (the handler), resolved host-side from its ref
        // factAction/factVerb/noun let nameVerb stamp the one name:<op> fact through the keystone
        // (emitWordFact), the twin of the be ops — instead of a hardcoded writeNameFact. The fact's
        // VERB (name) + target NOUN (name) ride the word explicitly (the hash-continuity anchor). The
        // keystone's per-kind result policy OMITS the result field for a nameop, so name:declare's
        // freshly minted `reveal` (private key + mnemonic) can never reach the chain — it rides the
        // handler RETURN to the asker only, as it always has (the no-result invariant, now enforced).
        factAction: op.factAction || opName,
        factVerb: "name",
        noun: "name",
        args: op.args ? JSON.parse(JSON.stringify(op.args)) : undefined,
        label: op.label,
        description: op.description,
      },
      { moment, history, skipIfUnchanged: true },
    );
    n++;
  }
  return n;
}

// Resolve a NAME op from the fold into the spec nameVerb dispatches (the handler from its ref). Null
// when unbound, disabled, not a nameop, or the handler ref is unresolvable. The op name arrives BARE
// (the verb dispatches "declare"); this namespaces it to the "name:<op>" word. Mirrors
// resolveDoOpFromFold; nameVerb dispatches on this instead of getNameOp(NAME_OPS).
export function resolveNameOpFromFold(opName) {
  const w = resolveWordFromFold(`name:${opName}`);
  if (!w || w.kind !== "nameop") return null;
  return {
    handler: w.handler,
    factAction: w.factAction || opName,
    factVerb: w.factVerb || "name",
    noun: w.noun || "name",
    args: w.args,
    label: w.label,
    description: w.description,
    ownerExtension: w.ownerExtension,
    _fromFold: true,
  };
}

// ── BE ops as words (the BE_OPS-Map migration; the twin of the NAME ops above) ──
//
// A BE op (birth/connect/release/switch/death/truename) is a word named "be:<op>", kind:"beop",
// carrying its handler by host ref (the handler lives with cherub's able, a function, never
// serialized). Verb-namespaced "be:<op>" so be:connect/be:release never collide with name:connect/
// name:release in the shared projection. Unlike NAME, a BE op also carries `bootstrap` (birth/connect
// skip assertVerbCaller — the caller has no identity yet); it's a serializable boolean, so it rides
// the binding. BE_OPS stays as the load-time registration buffer this reads. I's own genesis
// be:birth (sprout.js) is a raw emitFact, never beVerb, so it predates + grounds this fold untouched.
// Per-op result-curation for the be:<op> facts: a fail-CLOSED ALLOWLIST of what the stamped fact's
// `result` may record, restoring the old writeBeFact `safeResult`. The keystone (emitWordFact)
// otherwise falls through to stripForAudit — a DENYLIST that drops only known secret-named fields, so
// any FUTURE handler-result field not in REVEAL_KEYS/SECRET_KEYS would auto-land on the immutable
// chain (fail-OPEN). Only `connect` returns a rich auth result (beingId/name/seatHistory/firstUser/…),
// so only it must narrow back to {beingAddress, note}; the other BE ops return small word results
// stripForAudit already keeps minimal. The fact's `result` rides the CAS hash and a being-connect is
// security-sensitive, so the allowlist is the right posture (no minted key/token leaks today —
// identityToken is in REVEAL_KEYS — this keeps the surface fail-closed against future drift).
const BE_RESULT_POLICY = { connect: { keep: ["beingAddress", "note"] } };

export async function declareBeOpsToFold({
  moment = null,
  history = "0",
} = {}) {
  const { listBeOpNames, getBeOp } = await import("../../ibp/beOps.js");
  let n = 0;
  for (const opName of listBeOpNames()) {
    const op = getBeOp(opName);
    if (!op?.handler) continue;
    const ref = `be-op:${opName}`;
    registerHostHandler(ref, op.handler);
    await bindWord(
      `be:${opName}`,
      {
        ownerExtension: "seed",
        kind: "beop",
        do: { ref },
        bootstrap: op.bootstrap ? true : undefined, // birth/connect skip the caller assertion
        // factAction lets a .word-authored BE op return factParams and have the BE dispatcher stamp the
        // one auto-Fact (mirroring the do-op fold) instead of a hardcoded writeBeFact. The act defaults
        // to the op name (be:truename). EVERY ACT MAKES A FACT — the dispatcher stamps unconditionally,
        // so there is no skipAudit (an op can't opt out; birth's no-stamp is its own operation check).
        factAction: op.factAction || opName,
        // resultPolicy.keep is the fail-closed allowlist the keystone curates the stamped result to
        // (BE_RESULT_POLICY); undefined for ops that keep the stripForAudit default.
        resultPolicy: BE_RESULT_POLICY[opName],
        // The fact's VERB (be) + target NOUN (being) ride the word explicitly — the hash-continuity
        // anchor (17.md STEP 2); emitWordFact reads them instead of be.js hardcoding verb/of per site.
        factVerb: "be",
        noun: "being",
        args: op.args ? JSON.parse(JSON.stringify(op.args)) : undefined,
        label: op.label,
        description: op.description,
      },
      { moment, history, skipIfUnchanged: true },
    );
    n++;
  }
  return n;
}

// Resolve a BE op from the fold into the spec beVerb dispatches (handler + bootstrap, from the ref).
// Null when unbound, disabled, not a beop, or the handler ref is unresolvable. The op name arrives
// BARE (beVerb dispatches "birth"); this namespaces it to the "be:<op>" word. Mirrors
// resolveNameOpFromFold; beVerb dispatches on this instead of getBeOp(BE_OPS).
export function resolveBeOpFromFold(opName) {
  const w = resolveWordFromFold(`be:${opName}`);
  if (!w || w.kind !== "beop") return null;
  return {
    handler: w.handler,
    bootstrap: w.bootstrap,
    factAction: w.factAction || opName,
    factVerb: w.factVerb || "be",
    noun: w.noun || "being",
    resultPolicy: w.resultPolicy || null,
    args: w.args,
    label: w.label,
    description: w.description,
    ownerExtension: w.ownerExtension,
    _fromFold: true,
  };
}

// ── SEE ops as words (the seeOps-REGISTRY migration; the third verb-op set) ──
//
// A SEE op is a word named "see:<op>", kind:"seeop", carrying its handler by host ref. SEE is read-
// only — no fact, no bootstrap, no targets — so the binding is just the handler ref + args +
// description. seeVerb dispatches resolveSeeOpFromFold; the seeOps REGISTRY stays as the registration
// buffer + the routing check (isSeeOpName) + the metadata reads (listSeeOperations). The op name may
// itself contain a colon (the "<ext>:<name>" extension form) — the "see:" prefix nests cleanly into
// the word key ("see:food:meals"), no collision with name:/be:/able:op words.
export async function declareSeeOpsToFold({
  moment = null,
  history = "0",
} = {}) {
  const { listSeeOperations, getSeeOperation } =
    await import("../../ibp/seeOps.js");
  let n = 0;
  for (const { name } of listSeeOperations()) {
    const op = getSeeOperation(name);
    if (!op?.handler) continue;
    const ref = `see-op:${name}`;
    registerHostHandler(ref, op.handler);
    await bindWord(
      `see:${name}`,
      {
        ownerExtension: op.ownerExtension || "seed",
        kind: "seeop",
        do: { ref },
        args: op.args ? JSON.parse(JSON.stringify(op.args)) : undefined,
        description: op.description || undefined,
      },
      { moment, history, skipIfUnchanged: true },
    );
    n++;
  }
  return n;
}

// Resolve a SEE op from the fold into the spec seeVerb dispatches (the handler from its ref). Null
// when unbound, disabled, not a seeop, or the handler ref is unresolvable. The op name arrives BARE
// (seeVerb dispatches "place" / "arrival-view" / "food:meals"); this namespaces it to the "see:<op>"
// word. Mirrors resolveNameOpFromFold / resolveBeOpFromFold.
export function resolveSeeOpFromFold(name) {
  const w = resolveWordFromFold(`see:${name}`);
  if (!w || w.kind !== "seeop") return null;
  return {
    name,
    handler: w.handler,
    args: w.args,
    description: w.description,
    ownerExtension: w.ownerExtension,
    _fromFold: true,
  };
}
