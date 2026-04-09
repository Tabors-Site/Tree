/**
 * Sprout
 *
 * The tree grows itself. Talk about workouts and fitness appears.
 * Talk about food and nutrition appears. The user never installs or
 * scaffolds. The tree listens and grows.
 *
 * Interception:
 *   - enrichContext (tree zone): injects available-but-unscaffolded domains
 *   - beforeLLMCall (home zone + pending state): injects domain awareness
 *     and pending confirmation context into the system prompt
 *
 * Execution:
 *   - offer-sprout tool: AI calls this to register intent, no side effects
 *   - sprout tool: AI calls this after user confirms, does the scaffolding
 */

import log from "../../seed/log.js";
import { z } from "zod";
import {
  getUnscaffoldedDomains,
  getPending,
  setPending,
  clearPending,
  sproutDomain,
  invalidateCache,
} from "./core.js";

const DOMAIN_DESCRIPTIONS = {
  food: "meal logging, calories, macros, daily nutrition targets",
  fitness: "workout tracking, sets, reps, weight, progressive overload",
  study: "learning queue, mastery tracking, curricula",
  recovery: "substance tapering, feelings, recovery patterns",
  kb: "knowledge base, store and retrieve information",
  relationships: "people tracking, social connections",
  finance: "financial tracking, budgeting",
  investor: "investment tracking, portfolio management",
  "market-researcher": "market research, competitive analysis",
};

function describeDomains(domains) {
  return domains
    .map(d => `  ${d}: ${DOMAIN_DESCRIPTIONS[d] || d}`)
    .join("\n");
}

// Domain names that create-tree should never be used for.
// These must go through sprout so they get properly scaffolded.
const DOMAIN_NAMES = new Set(Object.keys(DOMAIN_DESCRIPTIONS));
const DOMAIN_ALIASES = new Map([
  ["health", "food"],
  ["nutrition", "food"],
  ["diet", "food"],
  ["meals", "food"],
  ["workout", "fitness"],
  ["workouts", "fitness"],
  ["gym", "fitness"],
  ["exercise", "fitness"],
  ["training", "fitness"],
  ["learning", "study"],
  ["education", "study"],
  ["knowledge", "kb"],
  ["knowledge base", "kb"],
]);

function matchDomainName(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (DOMAIN_NAMES.has(lower)) return lower;
  return DOMAIN_ALIASES.get(lower) || null;
}

export async function init(core) {

  // ── beforeToolCall: intercept create-tree for domain names ──────────
  // If the AI calls create-tree with a name that matches a domain,
  // cancel it and run sprout instead. This prevents bare root nodes
  // that have no scaffold, no modes, no child nodes.
  //
  // Hook cancellation: returning false cancels the tool call.
  // Throwing an error cancels AND puts the error message in the
  // tool result the AI sees (hookResult.reason = err.message).
  // We throw with a success message so the AI knows sprout handled it.
  core.hooks.register("beforeToolCall", async (hookData) => {
    const { toolName, args, userId } = hookData;
    if (toolName !== "create-tree") return;
    if (!userId) return;

    const domain = matchDomainName(args?.name);
    if (!domain) return;

    // Check if this domain is available but not scaffolded
    const unscaffolded = await getUnscaffoldedDomains(userId);
    if (!unscaffolded.includes(domain)) return;

    // Intercept: run sprout, then cancel create-tree.
    // We throw so the message reaches the AI as the tool result.
    log.info("Sprout", `Intercepted create-tree "${args.name}" -> sprouting ${domain} instead`);

    const result = await sproutDomain({ domain, userId });
    if (result.success) {
      throw new Error(
        `Sprout handled this. ${result.message} ` +
        `The domain was scaffolded with full structure under the Life tree (root: ${result.rootId}). ` +
        `Do NOT call create-tree again. Tell the user it is ready.`
      );
    }
    // If sprout failed, let create-tree proceed as fallback
  }, "sprout");

  // ── enrichContext: inject sprout awareness in tree zone ──────────────
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const userId = context._userId;
    if (!userId) return;

    try {
      const unscaffolded = await getUnscaffoldedDomains(userId);
      if (unscaffolded.length === 0) return;

      const pending = getPending(userId);
      context.sprout = {
        availableDomains: unscaffolded,
        pendingOffer: pending ? { domain: pending.domain } : null,
      };
    } catch (err) {
      log.debug("Sprout", `enrichContext failed: ${err.message}`);
    }
  }, "sprout");

  // ── beforeLLMCall: home zone awareness + pending state injection ────
  core.hooks.register("beforeLLMCall", async (hookData) => {
    const { messages, mode, userId } = hookData;
    if (!messages || !messages[0] || messages[0].role !== "system") return;
    if (!userId) return;

    const isHome = mode?.startsWith("home:");
    const isConverse = mode === "tree:converse";
    if (!isHome && !isConverse) return;

    try {
      const unscaffolded = await getUnscaffoldedDomains(userId);
      const pending = getPending(userId);

      // Nothing to inject
      if (unscaffolded.length === 0 && !pending) return;

      const sections = [];

      // Pending confirmation takes priority
      if (pending) {
        sections.push(
          `[Sprout: pending confirmation]\n` +
          `You previously offered to set up "${pending.domain}" tracking. ` +
          `If the user's current message confirms they want it (yes, sure, do it, let's go, etc.), ` +
          `call the sprout tool with domain "${pending.domain}" IMMEDIATELY. ` +
          `Do NOT use create-tree. Do NOT create a bare tree. Use the sprout tool. ` +
          `If they declined or changed topic, ignore the pending offer and respond normally.`
        );
      }

      // Domain awareness (only if there are unscaffolded domains)
      if (unscaffolded.length > 0 && !pending) {
        sections.push(
          `[Sprout: available capabilities]\n` +
          `The following domains can be set up but haven't been yet:\n` +
          describeDomains(unscaffolded) + "\n\n" +
          `If the user's message clearly relates to one of these domains, ` +
          `call the offer-sprout tool with the matching domain name. ` +
          `The tool will guide you on what to say. ` +
          `Do NOT offer setup if the message is casual, ambiguous, or unrelated. ` +
          `Only offer when the user is clearly trying to DO something that needs the domain.\n\n` +
          `CRITICAL: NEVER use create-tree for these domains. create-tree makes a bare empty tree. ` +
          `offer-sprout and sprout create a fully scaffolded domain with structure, modes, and routing. ` +
          `Always use offer-sprout first, then sprout after the user confirms.`
        );
      }

      if (sections.length > 0) {
        const block = sections.join("\n\n") + "\n\n";
        messages[0].content = block + messages[0].content;
      }
    } catch (err) {
      log.debug("Sprout", `beforeLLMCall failed: ${err.message}`);
    }
  }, "sprout");

  // ── MCP Tools ───────────────────────────────────────────────────────

  const tools = [
    {
      name: "offer-sprout",
      description:
        "Register intent to offer a domain to the user. Call this when the user's message " +
        "clearly implies they need a capability that isn't set up yet. After calling this, " +
        "ask the user if they want the domain set up. Do NOT scaffold anything yet.",
      schema: {
        domain: z.string().describe(
          "The domain to offer. One of: food, fitness, study, recovery, kb, relationships, finance, investor, market-researcher"
        ),
        rootId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        userId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async ({ domain, userId }) => {
        if (!userId) {
          return { content: [{ type: "text", text: "No user context." }] };
        }

        const unscaffolded = await getUnscaffoldedDomains(userId);
        if (!unscaffolded.includes(domain)) {
          return {
            content: [{ type: "text", text: `"${domain}" is already set up or not available.` }],
          };
        }

        setPending(userId, { domain, rootId: null });
        log.verbose("Sprout", `Offered ${domain} to user ${userId}`);

        const desc = DOMAIN_DESCRIPTIONS[domain] || domain;
        return {
          content: [{
            type: "text",
            text:
              `Offer registered. Ask the user if they want ${domain} tracking set up ` +
              `(${desc}). Keep it brief and natural. If they say yes, the sprout tool ` +
              `will handle everything.`,
          }],
        };
      },
    },

    {
      name: "sprout",
      description:
        "Set up a new domain in the user's Life tree. Call this ONLY after the user confirms " +
        "they want the domain. Creates the tree structure, installs the extension scaffold, " +
        "and makes it immediately routable.",
      schema: {
        domain: z.string().describe(
          "The domain to scaffold. One of: food, fitness, study, recovery, kb, relationships, finance, investor, market-researcher"
        ),
        rootId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        userId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async ({ domain, userId }) => {
        if (!userId) {
          return { content: [{ type: "text", text: "No user context." }] };
        }

        try {
          const result = await sproutDomain({ domain, userId });

          if (!result.success) {
            return { content: [{ type: "text", text: result.error }] };
          }

          log.info("Sprout", `Sprouted ${domain} for user ${userId} -> node ${result.nodeId}`);

          return {
            content: [{
              type: "text",
              text: result.message +
                (result.alreadyExists
                  ? ""
                  : ` From now on, messages about ${domain} will route there automatically.`),
            }],
          };
        } catch (err) {
          log.error("Sprout", `Failed to sprout ${domain}: ${err.message}`);
          return {
            content: [{ type: "text", text: `Failed to set up ${domain}: ${err.message}` }],
          };
        }
      },
    },
  ];

  log.info("Sprout", "Loaded. The tree grows from conversation.");

  return {
    tools,
    modeTools: [
      { modeKey: "tree:converse", toolNames: ["offer-sprout", "sprout"] },
      { modeKey: "home:default", toolNames: ["offer-sprout", "sprout"] },
      { modeKey: "home:fallback", toolNames: ["offer-sprout", "sprout"] },
    ],
  };
}
