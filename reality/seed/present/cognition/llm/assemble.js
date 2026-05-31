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
//   <preloaded see content (resolved from role.see[])>
//
//   and can:
//
//   see:
//     - <canSee tool name>: <description>
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
//   [Time] <ISO timestamp>
//
// Sections collapse when empty. A role with no `canSummon` simply
// omits the summon: block; a role with no `canBe` omits the be:
// block. The capability rows are the structural lock; the contents
// vary by what each role declares.
//
// Roles wired through this assembler write `prompt: () => BODY` and
// the declarative fields (see, canSee, canDo, canSummon, canBe).
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

import log from "../../../seedReality/log.js";
import { getToolDescription, resolveTools } from "./tools.js";
import { resolveSeeList, registerSeeResolver } from "./seeResolvers.js";
import { resolveCanStar } from "./canStarResolver.js";
import { getSpaceName } from "../../../materials/space/spaces.js";

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

  // Preloaded see-content: substrate the role declared it always
  // wants to read at this moment (ancestor-plan, lineage, recent
  // history). Resolved fresh at every summon — never cached across
  // calls — because the substrate moves and the being's read of it
  // is only ever now.
  const preloaded = await renderPreloadedSee(role, ctx);

  // What this being can see, do, summon, and be — for this instant.
  // The capability surface is per-summon; a role's tool set is a
  // function of right-now, not a property the being carries between
  // calls. ctx threads through so the can* resolver layer can expand
  // relationship-tokens (e.g. { rel: "parent" }) against the live
  // being and its lineage.
  const capabilities = await renderCapabilities(role, ctx);

  const body = await Promise.resolve(role.prompt(ctx));
  const bodyStr = typeof body === "string" ? body.trim() : "";

  // Time as a single stamp, the marker of which instant this being
  // exists at. Not a navigable axis — the being is pinned here,
  // swept along, never able to stand at any other moment. Every
  // forward pass gets its own timestamp; no two summons share one.
  const timeBlock = `[Time] ${new Date().toISOString()}`;

  // Assemble. The returned string IS the being, for the lifetime of
  // this LLM call. When the call ends, the being ends; the row
  // persists, but nothing else does. The next summon builds a new
  // now.
  return [identity, preloaded, capabilities, bodyStr, timeBlock]
    .filter(Boolean)
    .join("\n\n");
}

// ────────────────────────────────────────────────────────────────────
// Preloaded see content
// ────────────────────────────────────────────────────────────────────

async function renderPreloadedSee(role, ctx) {
  if (!Array.isArray(role.see) || role.see.length === 0) return "";
  const blocks = await resolveSeeList(role.see, ctx);
  if (blocks.length === 0) return "";
  return blocks.join("\n\n");
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
  const [seeEntries, doEntries, summonEntries, beEntries] = await Promise.all([
    resolveCanStar(role.canSee, beingCtx),
    resolveCanStar(role.canDo, beingCtx),
    resolveCanStar(role.canSummon, beingCtx),
    resolveCanStar(role.canBe, beingCtx),
  ]);

  const seeBlock = renderCapabilityList(seeEntries, "see", {
    dispatcher: "see",
    targetWord: "address",
  });
  const doBlock = renderCapabilityList(doEntries, "do", {
    dispatcher: "do",
    targetWord: "action",
  });
  const summonBlock = renderCapabilityList(summonEntries, "summon", {
    dispatcher: "summon",
    targetWord: "stance",
  });
  const beBlock = renderCapabilityList(beEntries, "be", {
    dispatcher: "be",
    targetWord: "operation",
    suffix: "(for creating new beings)",
  });

  if (seeBlock) sections.push(seeBlock);
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
 * substrate stance-auth at the verb is the actual gate.
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
  const SEED_VERB_TOOLS = ["see", "do", "summon", "be"];
  const missing = SEED_VERB_TOOLS.filter((name) => !getToolDescription(name));
  if (missing.length === 0) return;
  log.error(
    "Prompt",
    `Seed verb-tools missing from the registry: ${missing.join(", ")}. ` +
      `Genesis did not register them. No LLM role can run.`,
  );
  throw new Error(
    `Seed verb-tools missing from the registry: ${missing.join(", ")}. ` +
      `genesis.js must register seedSeeTool / seedDoTool / seedSummonTool / seedBeTool ` +
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

// ────────────────────────────────────────────────────────────────────
// Default see-resolvers shipped by seed
// ────────────────────────────────────────────────────────────────────

// "this-space" renders a one-line summary of where the being is now.
// Roles that want a richer block register their own resolver under
// a different name and reference it in role.see.
registerSeeResolver(
  "this-space",
  async (ctx) => {
    const spaceId = ctx.currentSpace || ctx.targetSpace || ctx.rootId;
    if (!spaceId) return null;
    try {
      const name = await getSpaceName(spaceId);
      return name
        ? `[Space] ${name} (${String(spaceId).slice(0, 8)})`
        : `[Space] ${spaceId}`;
    } catch {
      return null;
    }
  },
  "seed",
);

log.verbose("BuildPrompt", "assembler ready; default resolvers registered");

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

  let toolNames = [];
  if (Array.isArray(role.canSee) && role.canSee.length > 0) toolNames.push("see");
  if (Array.isArray(role.canDo) && role.canDo.length > 0) toolNames.push("do");
  if (Array.isArray(role.canSummon) && role.canSummon.length > 0) toolNames.push("summon");
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
  return resolveTools(toolNames, permsForFilter);
}

