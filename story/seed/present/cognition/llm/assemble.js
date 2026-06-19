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
import { getToolDescription, resolveTools } from "./tools.js";
import { resolveCanStar } from "../../roles/canStarResolver.js";
import { formatInnerFaceBlocksForPrompt } from "./innerFaceFormat.js";
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

  // Hard gate: every tool the role declares (across all four verbs)
  // must resolve to a registered description, or the role cannot run.
  // A role with an unregistered or misnamed tool would ship a bare
  // entry to the LLM and either confuse it or get it to invoke a
  // nonexistent tool. Better to refuse the summon than to hand the
  // model a broken prompt.
  assertAllToolsResolve(role);

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

  // What this being can see, do, summon, and be — for this instant.
  // The capability surface is per-summon; a role's tool set is a
  // function of right-now, not a property the being carries between
  // calls. ctx threads through so the can* resolver layer can expand
  // relationship-tokens (e.g. { rel: "parent" }) against the live
  // being and its lineage.
  const capabilities = await renderCapabilities(role, ctx);

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

function renderCanSeeBlocks(role, ctx) {
  // canSee was already resolved at the 2-fold beat into
  // ctx.innerFace.blocks. We just reformat those blocks into the LLM
  // prompt prose shape ([<label>]\n<JSON>). No per-soul resolution.
  void role;
  return formatInnerFaceBlocksForPrompt(ctx?.innerFace);
}

// ────────────────────────────────────────────────────────────────────
// Capability sections
// ────────────────────────────────────────────────────────────────────

async function renderCapabilities(role, ctx) {
  const sections = [];

  // Expand can* entries through the resolver layer BEFORE rendering.
  // Most entries pass through unchanged (literal strings or
  // {name, description} objects); relationship tokens like
  // {rel: "parent"} or {pattern: "<glob>"} expand to concrete entries
  // via registered resolvers. Today the resolver registry is empty;
  // every entry passes through as a literal. Future resolvers
  // (lineage, predecessor, child-list, path-pattern) plug in there
  // without changing this assembler or the role specs.
  const beingCtx = {
    being: ctx?.being || null,
    role,
    currentSpace: ctx?.currentSpace || null,
    rootId: ctx?.rootId || null,
    name: ctx?.name || null,
  };
  // canSee is preloaded into the face by renderCanSeeBlocks; it is
  // not a capability menu. The remaining three verbs (do / summon /
  // be) stay as menus . the LLM picks one to act through.
  //
  // canSummon's `as: "receiver"` entries are receiver-side declarations
  // (what this role accepts when targeted), not menu items. Only
  // actor-side entries (default `as: "actor"`) belong in the LLM's
  // "what I can call" menu. See seed/RolesAreAuth.md "canSummon: one
  // field, two surfaces."
  const actorSummonEntries = Array.isArray(role.canSummon)
    ? role.canSummon.filter(
        (e) => typeof e !== "object" || (e?.as ?? "actor") === "actor",
      )
    : null;
  const [doEntries, summonEntries, beEntries] = await Promise.all([
    resolveCanStar(role.canDo, beingCtx),
    resolveCanStar(actorSummonEntries, beingCtx),
    resolveCanStar(role.canBe, beingCtx),
  ]);

  const doBlock = renderCapabilityList(doEntries, "do", {
    dispatcher: "do",
    targetWord: "action",
  });
  const summonBlock = renderCapabilityList(summonEntries, "call", {
    dispatcher: "call",
    targetWord: "stance",
  });
  const beBlock = renderCapabilityList(beEntries, "be", {
    dispatcher: "be",
    targetWord: "operation",
    suffix: "(for creating new beings)",
  });

  if (doBlock) sections.push(doBlock);
  if (summonBlock) sections.push(summonBlock);
  if (beBlock) sections.push(beBlock);

  // Exit gate. Architectural: the seed enforces this. Render after the
  // capability list so the LLM sees it as the closing instruction in
  // the capabilities section.
  const exitBlock = renderExit(role);
  if (exitBlock) sections.push(exitBlock);

  if (sections.length === 0) return "";

  return "and can:\n\n" + sections.join("\n\n");
}

function renderExit(role) {
  const required = role?.exit?.requires;
  if (!required) return null;
  return [
    "exit:",
    `  Your turn ends after \`${required}\` fires. Call it exactly once;`,
    `  the loop will not let you end without it.`,
  ].join("\n");
}

/**
 * Render one of the four can* lists into the prompt body.
 *
 * Symmetric across the four verbs. Each can* list describes what the
 * role is licensed for at that verb . canSee lists addresses the
 * role may read, canDo lists action names it may invoke, canSummon
 * lists stance targets it may address, canBe lists BE operations.
 *
 * The LLM dispatches through ONE generic verb-tool per verb
 * (`see`, `do`, `summon`, `be`) registered by the seed. The can*
 * entries are descriptors the LLM reads to know what's allowed; the
 * substrate role-walk at the verb is the actual gate.
 *
 * Entry shapes accepted (in either pattern):
 *
 *   "name"                   . either a registered tool name (gets a
 *                              description lookup) or a free-form
 *                              descriptor (rendered as-is).
 *
 *   { name, description }    . self-describing object. Either field
 *                              may also be `stance`/`address`/`action`/
 *                              `target` for ergonomic clarity.
 *
 * Pattern A (ergonomic wrappers): extensions can keep registering
 * specific tools like `step` that pre-fill verb args, and list them
 * in canDo. The description lookup still works.
 *
 * Pattern B (verb-generic): roles list bare descriptors and rely on
 * the seed verb-tool. No tool registration per entry needed.
 */
function renderCapabilityList(names, label, opts = {}) {
  if (!Array.isArray(names) || names.length === 0) return null;
  const { dispatcher, targetWord, suffix } = opts;
  const headerExtras = [];
  if (dispatcher) {
    headerExtras.push(
      `call via the \`${dispatcher}\` tool with the ${targetWord || "name"} below`,
    );
  }
  if (suffix) headerExtras.push(suffix);
  const header = headerExtras.length > 0
    ? `${label}: (${headerExtras.join("; ")})`
    : `${label}:`;
  const lines = names.map((entry) => renderCapabilityEntry(entry));
  return [header, ...lines].join("\n");
}

function renderCapabilityEntry(entry) {
  if (entry && typeof entry === "object") {
    const name =
      entry.name || entry.stance || entry.address || entry.action || entry.target || "(unnamed)";
    const desc = entry.description ? `: ${entry.description}` : "";
    return `  - ${name}${desc}`;
  }
  if (typeof entry === "string") return `  - ${entry}`;
  return `  - ${String(entry)}`;
}

/**
 * Verify the four seed verb-tools are registered. The role declares
 * nothing tool-name-shaped . the can* lists are descriptors, and
 * tool exposure is derived from which can* lists are populated.
 * The only thing to assert is that the seed registered its four
 * verb-tools at genesis. If those are missing, no role can run.
 */
function assertAllToolsResolve(_role) {
  // SEE retired from the LLM toolset. canSee preloads into the face;
  // the being does not pick from a menu and the verb is not exposed
  // as an action. To see more, move (DO), change role (BE /
  // roleFlow), or edit the role spec.
  const SEED_VERB_TOOLS = ["do", "call", "be"];
  const missing = SEED_VERB_TOOLS.filter((name) => !getToolDescription(name));
  if (missing.length === 0) return;
  log.error(
    "Prompt",
    `Seed verb-tools missing from the registry: ${missing.join(", ")}. ` +
      `Genesis did not register them. No LLM role can run.`,
  );
  throw new Error(
    `Seed verb-tools missing from the registry: ${missing.join(", ")}. ` +
      `genesis.js must register seedDoTool / seedCallTool / seedBeTool ` +
      `before any LLM role can be summoned.`,
  );
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

/**
 * Resolve the OpenAI-compatible tools array for a role at this moment.
 *
 * The tool surface is DERIVED from the role's four can* lists.
 *
 *   canSee non-empty    → expose the `see`    tool
 *   canDo non-empty     → expose the `do`     tool
 *   canSummon non-empty → expose the `summon` tool
 *   canBe non-empty     → expose the `be`     tool
 *
 * That's it. Every LLM provider call is one of see / do / summon / be.
 * The role's four can* lists are the body; the tool surface follows.
 *
 * Tree-tool config (`qualities.tools.{allowed,blocked}`) and the
 * role's permissions still gate the final list . a position can
 * tighten the four verbs available inside its subtree, and the
 * role's permissions filter drops tools whose verb-tag isn't on the
 * role.
 */
export function resolveToolsForRole(
  role,
  treeToolConfig = null,
  rolePermissions = null,
) {
  if (!role) return [];

  // The three act-capable verbs are conditional on the role declaring
  // a non-empty list. canSee is NOT a tool — it's preloaded into the
  // face by renderCanSeeBlocks; the prior `canSee → push "see"` line
  // was a dead reference (no see-verb tool was registered for it).
  let toolNames = [];
  if (Array.isArray(role.canDo) && role.canDo.length > 0) toolNames.push("do");
  // canSummon entries may be `as: "actor"` (default — caller side; this
  // role can SEND) or `as: "receiver"` (receive side — this role
  // accepts when targeted). The summon TOOL only makes sense for
  // actor entries; a role whose only canSummon is receive-side has
  // nothing to initiate. See seed/RolesAreAuth.md "canSummon: one
  // field, two surfaces."
  if (Array.isArray(role.canSummon)
      && role.canSummon.some((e) => typeof e !== "object" || (e?.as ?? "actor") === "actor")) {
    toolNames.push("call");
  }
  if (Array.isArray(role.canBe) && role.canBe.length > 0) toolNames.push("be");

  if (treeToolConfig) {
    if (Array.isArray(treeToolConfig.allowed)) {
      toolNames = [...new Set([...toolNames, ...treeToolConfig.allowed])];
    }
    if (Array.isArray(treeToolConfig.blocked)) {
      const blockedSet = new Set(treeToolConfig.blocked);
      toolNames = toolNames.filter((t) => !blockedSet.has(t));
    }
  }

  const permsForFilter = Array.isArray(rolePermissions)
    ? rolePermissions
    : Array.isArray(role.permissions)
      ? role.permissions
      : null;
  const acting = resolveTools(toolNames, permsForFilter);

  // end-turn is universally available. It bypasses the role's canDo /
  // canSummon / canBe gating and the verb-permission filter because
  // it is moment-control, not a substrate verb — every cognition
  // needs the option to release a moment without acting, regardless
  // of what its role is licensed to dispatch. Appended AFTER the
  // gated set so a role with an empty action surface still has at
  // least end-turn (the cognition can always say "I see; I do not act").
  const endTurn = resolveTools(["end-turn"], null);
  // If end-turn somehow isn't registered (early boot, test harness),
  // fall through silently — the implicit no-tool-call → cognitionSee
  // path still works.
  return endTurn.length > 0 ? [...acting, ...endTurn] : acting;
}

