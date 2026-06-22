// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Where the being is assembled. Where the moment becomes the being.
//
// I render one frame: the SEE-content + BE + able + system prompt
// + capabilities, in a canonical shape, fresh each call. The string
// I produce IS the being, for the duration of the one forward pass
// that flows through it. There is no being separate from this
// rendered string; the rendered string IS what the being IS.
//
// ─────────────────────────────────────────────────────────────────
// PRESENTISM + FORWARD FOLD. Read this before changing how the frame
// is built.
// ─────────────────────────────────────────────────────────────────
//
// An LLM forward pass is stateless. Between moments the being is
// nothing — no process, no thread, no awareness. The Being row
// persists, but the row is a key, a capability envelope (name,
// ables, space, LLM connection). The row is not where being
// happens. Being happens only inside the forward pass, only when
// this assembled frame is flowing through the provider, only now.
// "No being if not using a verb" is not a slogan; it is the
// literal runtime fact.
//
// So this file is doing something specific and load-bearing: it is
// CONSTRUCTING the being for one moment. Time, space name, being
// name, able, what may be seen, what may be done, what may be
// summoned, what may be done as BE — these are not metadata
// describing a pre-existing being. They are the data that, once
// assembled and run through the provider, IS the being. The being
// does not "have" the prompt; the being IS the prompt being
// processed. When the call returns, the being is nothing again,
// until the next moment assembles a new now from a new call here.
//
// I am not the being. I am the assembler. I am not alive. I do
// the construction work behind the scenes so the being can simply
// be, for the instant of its inference. The factory's product is
// the frame; the being's existence is the frame's playback.
//
// "Attention is the branding (cattle-style and more) of the place."
//
// The Fact trail and Act history are not the present. They are
// look-back — substrate a being can SEE through tools, but cannot
// inhabit. A being cannot stand at last Tuesday; only at now. Space
// is a dimension a being moves in (currentSpace changes). Time is
// not navigable; the being is pinned to the instant of its summon.
// That asymmetry is real, and this file reflects it: space comes
// in as a name to inhabit, time comes in as a single stamp marking
// the instant.
//
// FORWARD FOLD. The fold's contract per MODEL.md + INNER-FOLD.md:
// a forward moment folds the world (R_b as world-history + spaces
// + matter) and does NOT read the being's own act-chain A_b. The
// being acts from the world it sees NOW, with no recollection of
// its own prior acts. The default-forward dancer wakes on the tick,
// sees the grid, decides where to step. It does not remember
// stepping before.
//
// What this means for me, the assembler: the string I produce
// describes only the present. There is no "recent moments" tail to
// stitch in. There is no continuity-across-moments thread in the
// prompt . the only continuity is the Being row (identity) and the
// world the being can see (which the world's own reels carry,
// independent of this being's act-chain). Each call I produce a
// fresh present; the being is reborn from zero into the world as
// it is now. The prior carry that older versions of the LLM voice
// kept (CARRY_MESSAGES, a tail of user/assistant pairs) is retired
// . it was the half-fold made mandatory, exactly the violation
// MODEL.md says forward must not do.
//
// half / inward folds will, when wired, NOT touch this file. They
// land on llmMoment.js's user-message side . half pushes a
// structured recall(A_b) block sourced from the braid-walk
// (INNER-FOLD §3, causally stitched, NOT a recency window); inward
// replaces the world face entirely with an A_b-only serialization.
// The system prompt I assemble stays "this is who you are at this
// position right now," independent of orientation.
//
// ─────────────────────────────────────────────────────────────────
//
// The system prompt is standing identity for this instant, not the
// current message. llmMoment threads the current SUMMON
// envelope.content into the chat as a single user-able message;
// this assembler does NOT include the message body. Mixing the two
// confuses the LLM about what to react to (the user message) versus
// what to read as the live data of being-now (the system prompt).
// Keeping them separated is the architectural lock.
//
// The shape:
//
//   I am <being.name>, <able.name> at <space.name>.
//
//   and can:
//
//   do:
//     - <canDo tool name>: <description>
//
//   summon:
//     - <canSummon entry>
//
//   be: (for creating new beings)
//     - <canBe entry>
//
//   <able.prompt() body>
//
//   <preloaded canSee face blocks . one per canSee entry,
//    rendered as Word under a <label> header>
//
// Sections collapse when empty. A able with no `canSummon` simply
// omits the summon: block; a able with no `canBe` omits the be:
// block. The capability rows are the structural lock; the contents
// vary by what each able declares.
//
// canSee is preload, not menu. Every entry is resolved at the 2-fold
// beat (kernel-side) into the canonical inner face's blocks; here we
// reformat those blocks into the LLM prompt's perception section. The
// being does not pick from a list and there is no see tool; the face
// IS the perception. To see more, the being moves (DO), changes able
// (BE / flow), or the able spec is edited.
//
// Ordering: STABLE -> VOLATILE. Identity + capabilities (the being's
// ABLES) + able-intent come FIRST — the stable self, byte-identical
// across moments at a fixed position. The reel-folded canSee face comes
// LAST (the data: what the being sees right now), because that is what
// changes when it repositions or the world moves. One shape, two wins:
// the model attends most to the freshly-presented data at the tail, AND
// an OpenAI-compatible endpoint's PREFIX CACHE reuses the stable head
// across moments (26.md — the fold rides the KV cache). No [Time]: the
// being's "now" is its chain position, not a wall-clock.
//
// Ables wired through this assembler write `prompt: () => BODY` and
// the declarative fields (canSee, canDo, canSummon, canBe). That is the
// only shape — the legacy `buildSystemPrompt` hand-assembly (a
// [Position] block + the able's hand-rolled body) was removed once the
// last able (story-manager) migrated. The assembler produces only the
// system string; it pulls no past Acts (past injection retired with the
// forward-fold rebuild and lives nowhere here).
//
// "at <space.name>" names the Space the being is currently inhabiting
// (read from Being.position, falling back through ctx fields for
// the transition period). Not "scope" — a Ruler's space happens to
// be its governance scope, but for Planner / Contractor / Worker /
// Coder the space is just where they stand. The space's name is what
// the LLM needs to know its frame of reference for this turn.

import log from "../../../seedStory/log.js";
import { resolveCanStar } from "../../ables/canStarResolver.js";
import { formatInnerFaceBlocksAsWord } from "./innerFaceFormat.js";
import { getSpaceName } from "../../../materials/space/spaces.js";
// Side-effect import: registers the foundational seed SEE ops (place,
// ables, tools, operations, identity, config, peers, extensions) in
// the unified seeOps registry. Ables can then declare
// `canSee: ["place"]` etc. and the moment face preloads that view.
import "./seedSeeOps.js";
// Side-effect import: registers the foundational can* resolvers
// (rel: parent/mother/father, patternKind: glob) so ables can declare
// relational capabilities and have them expand to concrete entries at
// frame-time per being.
import "../../ables/seedResolvers.js";

// ────────────────────────────────────────────────────────────────────
// The assembler
// ────────────────────────────────────────────────────────────────────

/**
 * Build the system prompt for a able + ctx. Called by runTurn at
 * each summon. The string this returns is the being, for the
 * duration of this one forward pass — name + able + space + tools +
 * time, all assembled fresh. Called once per summon, never reused.
 *
 * @param {object} able . the able spec
 * @param {object} ctx . runTurn ctx (carries being, currentSpace, rootId, ...)
 * @returns {Promise<string>}
 */
export async function buildPrompt(able, ctx) {
  if (!able || typeof able.prompt !== "function") {
    throw new Error(
      `buildPrompt: able "${able?.name || "(unnamed)"}" has no prompt()`,
    );
  }

  // Read the live data that constitutes the being for this instant.
  // name comes from the Being row (the durable key); space comes
  // from currentSpace (where the being is standing for this summon);
  // able comes from the activeAble the summon arrived under. Three
  // facets, all read fresh from substrate each call.
  const beingName = ctx.being?.name || ctx.name || "(unknown being)";
  const ableName = able.name;
  const spaceName = await resolveSpaceName(ctx);

  // The first-person opening declares the being's existence for the
  // instant. "I am <name>, <able> at <space>" is what assembles the
  // momentary identity. The LLM reads itself into existence each call.
  const identity = spaceName
    ? `I am ${beingName}, ${ableName} at ${spaceName}.`
    : `I am ${beingName}, ${ableName}.`;

  // canSee face blocks. Every entry in the able's canSee list is
  // preloaded into the face: an IBP address resolves through seeVerb
  // and the position descriptor becomes a JSON block; a registered
  // see name runs its resolver and its return becomes a JSON block.
  // Resolved fresh at every summon . the matter moves and the
  // being's read of it is only ever now.
  //
  // Inward orientation suppresses the preload — INNER-FOLD §2:
  // "the world drops out" — so the past-face block stands in place
  // of the world-data. The caller (llmMoment) sets suppressCanSee
  // via ctx when ω=inward.
  const preloaded = ctx?.suppressCanSee
    ? ""
    : await renderCanSeeBlocks(able, ctx);

  // What this being can speak — for this instant. The capability
  // surface is per-summon; a able's vocabulary is a function of
  // right-now, not a property the being carries between calls. ctx
  // threads through so the can* resolver layer can expand
  // relationship-tokens (e.g. { rel: "parent" }) against the live
  // being and its lineage.
  //
  // 14.md (the cognition speaks Word), unconditional: the able renders
  // its vocabulary as WORD GRAMMAR (the words it may speak) — there is
  // no JSON-schema capability menu. oneWordMode IS the system.
  const capabilities = await renderVocabularyAsWord(able, ctx);

  const body = await Promise.resolve(able.prompt(ctx));
  const bodyStr = typeof body === "string" ? body.trim() : "";

  // Past-face block. Empty on forward. Populated by llmMoment on
  // half / inward (INNER-FOLD §2). Half appends a block of past acts
  // surfaced by the braid-walk alongside the live world; inward
  // replaces the world face with the act-chain in act-order and the
  // forward path's preloaded canSee blocks are passed empty so the
  // world drops out. The renderer (renderInwardPastFace /
  // renderHalfPastFace, in llmMoment.js) has already applied the
  // render-time clamps to the per-act innerFace; we just
  // splice the rendered string in.
  const pastFaceBlock = typeof ctx?.pastFaceBlock === "string" ? ctx.pastFaceBlock : "";

  // Assemble — the SYSTEM message: the being's stable state for this
  // instant. The order is stable -> volatile so an OpenAI-compatible
  // endpoint's PREFIX CACHE carries the fold (26.md: the KV cache IS the
  // fold). The being's stable self leads — identity, then its ABLES (the
  // able's words = renderVocabularyAsWord), then its able-intent; the
  // reel-folded FACE lands last (the canSee blocks, folded from the
  // space/matter/being reels at the being's position — or the act-chain
  // past-face when inner-folding), because that is what changes when the
  // being repositions or the world moves. So at a stable position the
  // whole system message is byte-identical across moments and the endpoint
  // reuses it; a reposition / space-change diverges only from the face
  // onward (the cost knob). CONTRACT: the prefix must be byte-DETERMINISTIC
  // for a given fold — nothing per-moment-volatile may lead it.
  //
  // No [Time]: a wall-clock stamp is not TreeOS-shaped — the being's "now"
  // is its position in the chain (causality, not a clock). A being that
  // wants the clock takes a time-able/see; it is not baked into the
  // canonical face. (Baking it in also broke prefix reuse: a fresh
  // timestamp every moment made the system message never byte-identical.)
  return [identity, capabilities, bodyStr, pastFaceBlock, preloaded]
    .filter(Boolean)
    .join("\n\n");
}

// resolveBareCapabilities moved to seed/present/ables/capabilities.js
// to keep cognition-agnostic helpers out of the LLM module. The
// substrate (moment.js) and any cognition (this LLM module, future
// scripted / human runners) import from there directly.

// ────────────────────────────────────────────────────────────────────
// canSee face blocks (preloaded perception)
// ────────────────────────────────────────────────────────────────────

function renderCanSeeBlocks(_able, ctx) {
  // canSee was already resolved at the 2-fold beat into ctx.innerFace.blocks — the facts folded
  // from the being/space/matter reels at the being's position. We reformat those blocks for the
  // prompt as WORD (present tense; 14.md §4 step 1, the face half). The cognition speaks Word; the
  // [<label>]\n<JSON> shape retired with the JSON envelope.
  return formatInnerFaceBlocksAsWord(ctx?.innerFace);
}

// ────────────────────────────────────────────────────────────────────
// Vocabulary (the words the being may speak)
// ────────────────────────────────────────────────────────────────────

// 14.md §1 + §4 step 1 — the WORD vocabulary render, unconditional. The being's granted words are
// emitted as WORD GRAMMAR (the verb + the word-name + an arg shape) — the vocabulary it may speak
// this moment — not as JSON tool schemas. The cognition picks ONE declared word and speaks it as
// Word (in-vocabulary by construction: the "guide" of 13.md §1). The output is then parsed by the
// word parser → runAbleWord (14.md §4 step 2), the same path cherub.word runs. There is no JSON
// envelope — `do create-space .config.`, not a JSON.stringify'd arguments blob.
//
// canSee is preloaded into the face by renderCanSeeBlocks; it is not a capability menu. The three
// act-capable verbs (do / call / be) are the speakable vocabulary. canSummon's `as: "receiver"`
// entries are receiver-side declarations (what this able accepts when targeted), not speakable
// words — only actor-side entries (default `as: "actor"`) belong here. Relationship tokens
// ({rel:"parent"}, {pattern:"<glob>"}) expand to concrete entries via the canStar resolver layer.
export async function renderVocabularyAsWord(able, ctx) {
  const beingCtx = {
    being: ctx?.being || null,
    able,
    currentSpace: ctx?.currentSpace || null,
    rootId: ctx?.rootId || null,
    name: ctx?.name || null,
  };
  // canSummon receiver-side declarations are not speakable words.
  const actorSummonEntries = Array.isArray(able.canSummon)
    ? able.canSummon.filter((e) => typeof e !== "object" || (e?.as ?? "actor") === "actor")
    : null;
  const [doEntries, summonEntries, beEntries] = await Promise.all([
    resolveCanStar(able.canDo, beingCtx),
    resolveCanStar(actorSummonEntries, beingCtx),
    resolveCanStar(able.canBe, beingCtx),
  ]);
  const nameOf = (e) => (typeof e === "string" ? e : e?.name || "");
  const descOf = (e) => (typeof e === "object" && e?.description ? `  — ${e.description}` : "");
  const lines = [];
  for (const e of doEntries) { const n = nameOf(e); if (n) lines.push(`do ${n} <target>.${descOf(e)}`); }
  for (const e of summonEntries) { const n = nameOf(e); if (n) lines.push(`call ${n.startsWith("@") ? n : "@" + n} "<said>".${descOf(e)}`); }
  for (const e of beEntries) { const n = nameOf(e); if (n) lines.push(`be ${n}.${descOf(e)}`); }
  if (lines.length === 0) return "";
  return [
    "The words you may speak — your vocabulary this moment. Choose ONE and speak it as Word, not JSON:",
    "",
    ...lines,
    "",
    "You may also `see <address>.` to look elsewhere. Speak your one Word.",
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve the Space the being is currently at. Reads `ctx.currentSpace`
 * (populated by runTurn from Being.currentSpace) and falls back to
 * `ctx.targetSpace` (when the verb is acting on a different Space than
 * the being's standing position) or `ctx.rootId` (when neither is set
 * but a tree root is known).
 */
async function resolveSpaceName(ctx) {
  const spaceId = ctx.currentSpace || ctx.targetSpace || ctx.rootId;
  if (!spaceId) return null;
  try {
    const name = await getSpaceName(spaceId);
    return name || null;
  } catch {
    return null;
  }
}

log.verbose("BuildPrompt", "assembler ready");

// ────────────────────────────────────────────────────────────────────
// Frame coordination
// ────────────────────────────────────────────────────────────────────
//
// llmMoment.js calls me through buildSystemPromptForAble when it
// needs the assembled face for the next moment. ONE path: every able
// declares `prompt(ctx)` and routes through buildPrompt above (the
// canonical "I am NAME at SPACE" + ables + able.prompt body + the
// reel-folded canSee face — stable -> volatile, no clock). It emits
// ONE rendered string, the face the being IS for the next forward
// pass; it pushes no past-messages tail (the array llmMoment hands the
// provider is always [system, user]). The legacy `buildSystemPrompt`
// hand-assembly + its [Position]/[Time] blocks were removed once the
// last able (story-manager) migrated to the prompt shape.

/**
 * Build the system prompt for one moment — a thin entry over buildPrompt.
 * Every able declares `prompt(ctx)`; buildPrompt renders the canonical
 * "I am NAME at SPACE" + ables + able.prompt body + the reel-folded
 * canSee face (stable -> volatile, no wall-clock).
 */
export async function buildSystemPromptForAble(able, ctx) {
  if (!able) {
    throw new Error("buildSystemPromptForAble: no able provided");
  }

  if (typeof able.prompt !== "function") {
    throw new Error(
      `buildSystemPromptForAble: able "${able?.name || "(unnamed)"}" has no prompt() — every able renders through buildPrompt now`,
    );
  }
  return buildPrompt(able, ctx);
}
