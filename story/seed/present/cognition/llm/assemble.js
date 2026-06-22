// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Where the being is assembled. Where the moment becomes the being.
//
// I render one frame: the SEE-content + BE + role + system prompt
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
// roles, space, LLM connection). The row is not where being
// happens. Being happens only inside the forward pass, only when
// this assembled frame is flowing through the provider, only now.
// "No being if not using a verb" is not a slogan; it is the
// literal runtime fact.
//
// So this file is doing something specific and load-bearing: it is
// CONSTRUCTING the being for one moment. Time, space name, being
// name, role, what may be seen, what may be done, what may be
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
// envelope.content into the chat as a single user-role message;
// this assembler does NOT include the message body. Mixing the two
// confuses the LLM about what to react to (the user message) versus
// what to read as the live data of being-now (the system prompt).
// Keeping them separated is the architectural lock.
//
// The shape:
//
//   I am <being.name>, <role.name> at <space.name>.
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
//   <role.prompt() body>
//
//   <preloaded canSee face blocks . one per canSee entry,
//    JSON-inlined under a [<label>] header>
//
//   [Time] <ISO timestamp>
//
// Sections collapse when empty. A role with no `canSummon` simply
// omits the summon: block; a role with no `canBe` omits the be:
// block. The capability rows are the structural lock; the contents
// vary by what each role declares.
//
// canSee is preload, not menu. Every entry is resolved at the 2-fold
// beat (kernel-side) into the canonical inner face's blocks; here we
// reformat those blocks into the LLM prompt's perception section. The
// being does not pick from a list and there is no see tool; the face
// IS the perception. To see more, the being moves (DO), changes role
// (BE / roleFlow), or the role spec is edited.
//
// Ordering. Identity + capabilities + role-intent come FIRST (the
// question: who you are, what you can do, why you exist). canSee
// blocks come LAST, just before [Time] (the data: what you see
// right now). This mirrors the LLM-practical pattern of asking the
// question, then pasting the code . the model attends more
// strongly to the freshly-presented data at the end of the prompt
// when it forms its act.
//
// Roles wired through this assembler write `prompt: () => BODY` and
// the declarative fields (canSee, canDo, canSummon, canBe).
// Roles that still write their own `buildSystemPrompt` route
// through the legacy branch of buildSystemPromptForRole below . it
// composes a [Position] block + the role's hand-rolled body +
// [Time]. Both paths produce only the system string; neither path
// pulls past Acts. Past injection retired with the forward-fold
// rebuild and lives nowhere in this assembler.
//
// "at <space.name>" names the Space the being is currently inhabiting
// (read from Being.position, falling back through ctx fields for
// the transition period). Not "scope" — a Ruler's space happens to
// be its governance scope, but for Planner / Contractor / Worker /
// Coder the space is just where they stand. The space's name is what
// the LLM needs to know its frame of reference for this turn.

import log from "../../../seedStory/log.js";
import { resolveCanStar } from "../../roles/canStarResolver.js";
import { formatInnerFaceBlocksAsWord } from "./innerFaceFormat.js";
import { getSpaceName } from "../../../materials/space/spaces.js";
// Side-effect import: registers the foundational seed SEE ops (place,
// roles, tools, operations, identity, config, peers, extensions) in
// the unified seeOps registry. Roles can then declare
// `canSee: ["place"]` etc. and the moment face preloads that view.
import "./seedSeeOps.js";
// Side-effect import: registers the foundational can* resolvers
// (rel: parent/mother/father, patternKind: glob) so roles can declare
// relational capabilities and have them expand to concrete entries at
// frame-time per being.
import "../../roles/seedResolvers.js";

// ────────────────────────────────────────────────────────────────────
// The assembler
// ────────────────────────────────────────────────────────────────────

/**
 * Build the system prompt for a role + ctx. Called by runTurn at
 * each summon. The string this returns is the being, for the
 * duration of this one forward pass — name + role + space + tools +
 * time, all assembled fresh. Called once per summon, never reused.
 *
 * @param {object} role . the role spec
 * @param {object} ctx . runTurn ctx (carries being, currentSpace, rootId, ...)
 * @returns {Promise<string>}
 */
export async function buildPrompt(role, ctx) {
  if (!role || typeof role.prompt !== "function") {
    throw new Error(
      `buildPrompt: role "${role?.name || "(unnamed)"}" has no prompt()`,
    );
  }

  // Read the live data that constitutes the being for this instant.
  // name comes from the Being row (the durable key); space comes
  // from currentSpace (where the being is standing for this summon);
  // role comes from the activeRole the summon arrived under. Three
  // facets, all read fresh from substrate each call.
  const beingName = ctx.being?.name || ctx.name || "(unknown being)";
  const roleName = role.name;
  const spaceName = await resolveSpaceName(ctx);

  // The first-person opening declares the being's existence for the
  // instant. "I am <name>, <role> at <space>" is what assembles the
  // momentary identity. The LLM reads itself into existence each call.
  const identity = spaceName
    ? `I am ${beingName}, ${roleName} at ${spaceName}.`
    : `I am ${beingName}, ${roleName}.`;

  // canSee face blocks. Every entry in the role's canSee list is
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
    : await renderCanSeeBlocks(role, ctx);

  // What this being can speak — for this instant. The capability
  // surface is per-summon; a role's vocabulary is a function of
  // right-now, not a property the being carries between calls. ctx
  // threads through so the can* resolver layer can expand
  // relationship-tokens (e.g. { rel: "parent" }) against the live
  // being and its lineage.
  //
  // 14.md (the cognition speaks Word), unconditional: the role renders
  // its vocabulary as WORD GRAMMAR (the words it may speak) — there is
  // no JSON-schema capability menu. oneWordMode IS the system.
  const capabilities = await renderVocabularyAsWord(role, ctx);

  const body = await Promise.resolve(role.prompt(ctx));
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

  // Time as a single stamp, the marker of which instant this being
  // exists at. Not a navigable axis — the being is pinned here,
  // swept along, never able to stand at any other moment. Every
  // forward pass gets its own timestamp; no two summons share one.
  const timeBlock = `[Time] ${new Date().toISOString()}`;

  // Assemble. The returned string IS the being, for the lifetime of
  // this LLM call. When the call ends, the being ends; the row
  // persists, but nothing else does. The next summon builds a new
  // now.
  //
  // Order: identity + capabilities + role-intent ("the question"),
  // then past-face block (turned folds only), then preloaded canSee
  // face blocks ("the data"), then [Time]. LLMs attend more strongly
  // to the freshly-presented data at the tail of the prompt when
  // forming their act, so the structured perception lands last —
  // and the past-face sits just before it so the LLM enters the
  // present already aware of where it has been.
  return [identity, capabilities, bodyStr, pastFaceBlock, preloaded, timeBlock]
    .filter(Boolean)
    .join("\n\n");
}

// resolveBareCapabilities moved to seed/present/roles/capabilities.js
// to keep cognition-agnostic helpers out of the LLM module. The
// substrate (moment.js) and any cognition (this LLM module, future
// scripted / human runners) import from there directly.

// ────────────────────────────────────────────────────────────────────
// canSee face blocks (preloaded perception)
// ────────────────────────────────────────────────────────────────────

function renderCanSeeBlocks(_role, ctx) {
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
// word parser → runRoleWord (14.md §4 step 2), the same path cherub.word runs. There is no JSON
// envelope — `do create-space .config.`, not a JSON.stringify'd arguments blob.
//
// canSee is preloaded into the face by renderCanSeeBlocks; it is not a capability menu. The three
// act-capable verbs (do / call / be) are the speakable vocabulary. canSummon's `as: "receiver"`
// entries are receiver-side declarations (what this role accepts when targeted), not speakable
// words — only actor-side entries (default `as: "actor"`) belong here. Relationship tokens
// ({rel:"parent"}, {pattern:"<glob>"}) expand to concrete entries via the canStar resolver layer.
export async function renderVocabularyAsWord(role, ctx) {
  const beingCtx = {
    being: ctx?.being || null,
    role,
    currentSpace: ctx?.currentSpace || null,
    rootId: ctx?.rootId || null,
    name: ctx?.name || null,
  };
  // canSummon receiver-side declarations are not speakable words.
  const actorSummonEntries = Array.isArray(role.canSummon)
    ? role.canSummon.filter((e) => typeof e !== "object" || (e?.as ?? "actor") === "actor")
    : null;
  const [doEntries, summonEntries, beEntries] = await Promise.all([
    resolveCanStar(role.canDo, beingCtx),
    resolveCanStar(actorSummonEntries, beingCtx),
    resolveCanStar(role.canBe, beingCtx),
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
// llmMoment.js calls me through buildSystemPromptForRole when it
// needs the assembled face for the next moment. The two paths below
// reflect the old/new split in role specs: new-shape roles declare
// `prompt(ctx)` and route through buildPrompt above (the canonical
// "I am NAME at SPACE" shape); legacy-shape roles hand-assemble
// through `buildSystemPrompt(ctx)` and I prepend a position block
// + append a time block around their body. Both paths emit ONE
// rendered string — the face the being IS for the next forward
// pass. Neither path pushes a past-messages tail; the messages
// array llmMoment hands to the provider is [system, user] regardless
// of which branch built the system string.

/**
 * Build the system prompt for one moment.
 *
 * Two paths coexist:
 *   NEW SHAPE (role.prompt) — buildPrompt above renders the canonical
 *   "I am NAME at SPACE" + preloaded see + capabilities +
 *   role.prompt(ctx) + [Time]. The locked shape; every role
 *   migrates here.
 *
 *   LEGACY SHAPE (role.buildSystemPrompt) — role hand-assembles its
 *   own body; I prepend the position block and append [Time]. Kept
 *   running until every role moves.
 *
 * A role declaring both uses the new shape (prompt wins).
 */
export async function buildSystemPromptForRole(role, ctx) {
  if (!role) {
    throw new Error("buildSystemPromptForRole: no role provided");
  }

  if (typeof role.prompt === "function") {
    return buildPrompt(role, ctx);
  }

  if (typeof role.buildSystemPrompt !== "function") {
    throw new Error(
      `buildSystemPromptForRole: role "${role?.name || "(unnamed)"}" has neither prompt nor buildSystemPrompt`,
    );
  }

  // Layer 1: position block.
  const positionLines = [];
  if (ctx.name) positionLines.push(`User: ${ctx.name}`);
  const rootId = ctx.rootId || null;
  const currentSpace = ctx.currentSpace || ctx.targetSpace || null;
  const targetSpace = ctx.targetSpace || null;

  const idsToResolve = {};
  if (rootId) idsToResolve.root = rootId;
  if (currentSpace && currentSpace !== rootId)
    idsToResolve.current = currentSpace;
  if (targetSpace && targetSpace !== rootId && targetSpace !== currentSpace) {
    idsToResolve.target = targetSpace;
  }

  const names = {};
  try {
    const entries = Object.entries(idsToResolve);
    if (entries.length > 0) {
      const resolved = await Promise.all(
        entries.map(([, id]) => getSpaceName(id)),
      );
      entries.forEach(([key], i) => {
        names[key] = resolved[i];
      });
    }
  } catch (nameErr) {
    log.debug("Role", `Space name resolution failed: ${nameErr.message}`);
  }
  if (rootId) {
    positionLines.push(
      names.root ? `Tree: ${names.root} (${rootId})` : `Tree: ${rootId}`,
    );
  }
  if (currentSpace && currentSpace !== rootId) {
    positionLines.push(
      names.current
        ? `Current space: ${names.current} (${currentSpace})`
        : `Current space: ${currentSpace}`,
    );
  }
  if (targetSpace && targetSpace !== rootId && targetSpace !== currentSpace) {
    positionLines.push(
      names.target
        ? `Target space: ${names.target} (${targetSpace})`
        : `Target space: ${targetSpace}`,
    );
  }
  const positionBlock =
    positionLines.length > 0
      ? `[Position]\n${positionLines.join("\n")}\n\n`
      : "";

  // Layer 2: role prompt body.
  let rolePrompt;
  try {
    rolePrompt = await Promise.resolve(role.buildSystemPrompt(ctx));
  } catch (promptErr) {
    log.error(
      "Role",
      `role "${role.name}" buildSystemPrompt failed: ${promptErr.message}`,
    );
    rolePrompt = `[Role prompt error: ${promptErr.message}]`;
  }

  // Layer 3: time stamp.
  const timeBlock = `\n\n[Time] ${new Date().toISOString()}`;

  return `${positionBlock}${rolePrompt}${timeBlock}`;
}
