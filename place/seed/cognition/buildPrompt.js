// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Prompt assembler.
//
// One canonical shape for every role's system prompt. Roles declare
// what they uniquely are; seed assembles the surrounding structure.
//
// The system prompt is standing identity, not the current message.
// runChat threads the current SUMMON envelope.content into the chat
// history as a user-role message; this assembler does NOT include the
// message body. Mixing the two confuses the LLM about what to react
// to (the user message) versus what to read as durable context (the
// system prompt). Keeping them separated is the architectural lock.
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
// working through the legacy path in runChat until they migrate.
//
// "at <space.name>" names the Space the being is currently inhabiting
// (read from Being.currentSpace, falling back through ctx fields for
// the transition period). Not "scope" — a Ruler's space happens to
// be its governance scope, but for Planner / Contractor / Worker /
// Coder the space is just where they stand. The space's name is what
// the LLM needs to know its frame of reference for this turn.

import log from "../system/log.js";
import { getToolDescription } from "../cognition/tools.js";
import { resolveSeeList, registerSeeResolver } from "./seeResolvers.js";
import { getSpaceName } from "../place/space/spaceFetch.js";

// ────────────────────────────────────────────────────────────────────
// The assembler
// ────────────────────────────────────────────────────────────────────

/**
 * Build the system prompt for a role + ctx. Called by runChat when a
 * role declares a `prompt` function (the new shape).
 *
 * @param {object} role . the role spec
 * @param {object} ctx . runChat ctx (carries being, currentSpace, rootId, ...)
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

  const beingName = ctx.being?.name || ctx.name || "(unknown being)";
  const roleName = role.name;
  const spaceName = await resolveSpaceName(ctx);

  const identity = spaceName
    ? `I am ${beingName}, ${roleName} at ${spaceName}.`
    : `I am ${beingName}, ${roleName}.`;

  const preloaded = await renderPreloadedSee(role, ctx);

  const capabilities = renderCapabilities(role);

  const body = await Promise.resolve(role.prompt(ctx));
  const bodyStr = typeof body === "string" ? body.trim() : "";

  const timeBlock = `[Time] ${new Date().toISOString()}`;

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
 * (populated by runChat from Being.currentSpace) and falls back to
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
