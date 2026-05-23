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
// PRESENTISM. Read this before changing how the frame is built.
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
// Continuity across moments is solved by two thin threads, not by
// memory in the being. The Being row keeps identity (moment #5 is
// "the same being" as moment #1 because both load the same row,
// not because they share substance). CARRY_MESSAGES in runTurn.js
// keeps a short tail of recent moments so each new now isn't born
// amnesiac. Between those two, the architecture has its presentist
// answer to continuity: momentary beings, durable key, short
// carried tail. Not infinite memory. Not state across moments. A
// reborn being, but not from zero.
//
// ─────────────────────────────────────────────────────────────────
//
// The system prompt is standing identity for this instant, not the
// current message. runTurn threads the current SUMMON envelope.content
// into the chat history as a user-role message; this assembler does
// NOT include the message body. Mixing the two confuses the LLM
// about what to react to (the user message) versus what to read as
// the live data of being-now (the system prompt). Keeping them
// separated is the architectural lock.
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
// Roles that still write their own `buildSystemPrompt` continue
// working through the legacy path in runTurn until they migrate.
//
// "at <space.name>" names the Space the being is currently inhabiting
// (read from Being.currentSpace, falling back through ctx fields for
// the transition period). Not "scope" — a Ruler's space happens to
// be its governance scope, but for Planner / Contractor / Worker /
// Coder the space is just where they stand. The space's name is what
// the LLM needs to know its frame of reference for this turn.

import log from "../../../seedReality/log.js";
import { getToolDescription, resolveTools, getExtensionToolsForRole } from "./tools.js";
import { resolveSeeList, registerSeeResolver } from "./seeResolvers.js";
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
  // calls.
  const capabilities = renderCapabilities(role);

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

function renderCapabilities(role) {
  const sections = [];

  const seeBlock = renderToolList(role.canSee, "see");
  const doBlock = renderToolList(role.canDo, "do");
  const summonBlock = renderToolList(role.canSummon, "summon");
  const beBlock = renderToolList(role.canBe, "be", "(for creating new beings)");

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

function renderToolList(names, label, suffix = null) {
  if (!Array.isArray(names) || names.length === 0) return null;
  const header = suffix ? `${label}: ${suffix}` : `${label}:`;
  // Descriptions are guaranteed non-null by assertAllToolsResolve at
  // the buildPrompt entry; this helper does not need a fallback path.
  const lines = names.map((name) => `  - ${name}: ${getToolDescription(name)}`);
  return [header, ...lines].join("\n");
}

/**
 * Reject the summon if any declared tool has no registered description.
 * Walks the four verb buckets (canSee / canDo / canSummon / canBe) and
 * throws with the full list of unresolved names. Stops the LLM call
 * before it ships a broken prompt.
 */
function assertAllToolsResolve(role) {
  const declared = [
    ...(role.canSee || []),
    ...(role.canDo || []),
    ...(role.canSummon || []),
    ...(role.canBe || []),
  ];
  const missing = declared.filter((name) => !getToolDescription(name));
  if (missing.length === 0) return;
  log.error(
    "Prompt",
    `Role "${role.name}" cannot be summoned: ${missing.length} declared tool(s) ` +
      `have no registered description (${missing.join(", ")}).`,
  );
  throw new Error(
    `Role "${role.name}" cannot be summoned: ${missing.length} declared tool(s) ` +
      `have no registered description (${missing.join(", ")}). The tools either ` +
      `failed to register or the role's canSee/canDo/canSummon/canBe names a ` +
      `tool that does not exist.`,
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
// stamper.js calls me through buildSystemPromptForRole when it
// needs the assembled face for the next moment. The two paths below
// reflect the old/new split in role specs: new-shape roles declare
// `prompt(ctx)` and route through buildPrompt above (the canonical
// "I am NAME at SPACE" shape); legacy-shape roles hand-assemble
// through `buildSystemPrompt(ctx)` and I prepend a position block
// + append a time block around their body. Both paths emit one
// rendered string — the face the being IS for the next forward
// pass.

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
 * Resolve the OpenAI-compatible tools array for a role at this
 * moment.
 *   1. role.toolNames (base)
 *   2. extension-injected tools (via getExtensionToolsForRole)
 *   3. tree-specific overlays (qualities.tools.allowed / blocked)
 *   4. permission filter (drop tools whose verb isn't in role.permissions)
 */
export function resolveToolsForRole(
  role,
  treeToolConfig = null,
  rolePermissions = null,
) {
  if (!role) return [];

  let toolNames = Array.isArray(role.toolNames) ? [...role.toolNames] : [];

  const extTools = getExtensionToolsForRole(role.name);
  if (extTools.length > 0) {
    toolNames = [...new Set([...toolNames, ...extTools])];
  }

  if (treeToolConfig) {
    if (Array.isArray(treeToolConfig.allowed)) {
      toolNames = [...new Set([...toolNames, ...treeToolConfig.allowed])];
    }
    if (Array.isArray(treeToolConfig.blocked)) {
      const blockedSet = new Set(treeToolConfig.blocked);
      toolNames = toolNames.filter((t) => !blockedSet.has(t));
    }
  }

  // Permissions are role identity ([[project_role_permissions_not_envelope]]);
  // envelopes never widen them.
  const permsForFilter = Array.isArray(rolePermissions)
    ? rolePermissions
    : Array.isArray(role.permissions)
      ? role.permissions
      : null;
  return resolveTools(toolNames, permsForFilter);
}

