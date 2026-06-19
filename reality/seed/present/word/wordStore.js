// wordStore.js . a word is a FOLD of declare-word facts, not a registry entry.
//
// This is the connecter as a fold (philosophy/word/10.md §2). `bindWord` lays a declare-word
// fact carrying the word's binding descriptor; `getWord` folds the declare-word / disable-word
// facts back into the current descriptor, the same call that reconstructs a Being from its facts.
// No registry: language stops being the one exception to facts -> fold -> reality.
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
export async function bindWord(name, descriptor = {}, { moment = null, branch = "0", actorBeingId = null } = {}) {
  if (!name || typeof name !== "string") throw new Error("bindWord: a non-empty word name is required");
  const { emitFact } = await import("../../past/fact/facts.js");
  const actor = await _actor(actorBeingId);
  const { ownerExtension = "seed", ...rest } = descriptor;
  // Keep only what a fact can hold: JSON round-trip drops any function (a seed handler must be
  // passed as a ref). What survives is the word's serializable binding.
  const binding = JSON.parse(JSON.stringify(rest));
  await _inAct(moment, `I declare the word ${name}`, (ctx) => emitFact({
    through: actor, branch: String(branch), verb: "do", act: DECLARE,
    of: { kind: "being", id: actor },
    params: { word: name, ownerExtension, binding },
  }, ctx));
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
