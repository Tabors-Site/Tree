// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seedDoTool.js . the DO verb exposed as an LLM tool.
//
// Run a registered operation against a target. Parallel structure to
// seedSummonTool and seedBeTool: ONE generic do tool the seed ships;
// the role's `canDo` list declares which action names the role is
// licensed to invoke and tool exposure is derived from canDo being
// non-empty. Substrate role-walk at the verb gates whether the
// actor is actually allowed.
//
// Targets and actions. DO is `do(target, action, args)` at the verb
// layer. The LLM specifies action (the operation name); target
// defaults to the actor's current position (or to a stance the
// action expects) when not provided. Operations register their
// expected target kind, so the verb's auto-Fact lands on the right
// reel.
//
// Verbs-as-language doctrine. Per-action ergonomic tool wrappers
// retired . actions live in the DO operation registry and the LLM
// dispatches them via this one tool. An op that wants a cleaner
// schema does it at the op-handler level, not by adding a separate
// LLM tool.
//
// Address shorthand. A leading "." names a heaven child
// ('.config' → '<reality>/./config').

import { z } from "zod";
import { doVerb } from "../../../ibp/verbs/do.js";
import { getRealityDomain } from "../../../ibp/address.js";
import { getSpaceRootId } from "../../../sprout.js";

export const seedDoTool = {
  name: "do",
  description:
    "Invoke a registered DO operation against a target. The action is the " +
    "operation name as registered (use see on <reality>/./operations to " +
    "discover available actions and their expected args). Target defaults " +
    "to the reality root when not specified; pass an explicit target for " +
    "ops that act on a different position, being, or matter. Authorization " +
    "runs at the substrate layer; unlicensed actors refuse with FORBIDDEN.",
  verb: "do",
  schema: {
    action: z.string().describe(
      "Operation name. Examples: 'set-config', 'create-space', 'install-extension'. " +
        "Extension ops are namespaced (e.g. 'food:log-meal').",
    ),
    target: z.string().optional().describe(
      "Address of the position / being / matter the operation acts on. " +
        "Leading '.' resolves against the reality root. Defaults to the " +
        "reality root for ops that operate at the root.",
    ),
    args: z.record(z.string(), z.any()).optional().describe(
      "Operation-specific args. See <reality>/./operations for each op's expected shape.",
    ),
    beingId: z.string().describe("Injected by server. Ignore."),
    name: z.string().optional().describe("Injected by server. Ignore."),
  },
  async handler({ action, target, args, beingId, name }, callCtx) {
    if (typeof action !== "string" || action.length === 0) {
      return {
        content: [{ type: "text", text: "Error: do requires a non-empty `action` string." }],
      };
    }

    const resolvedTarget = await resolveTarget(target, callCtx);
    if (!resolvedTarget) {
      return {
        content: [{
          type: "text",
          text: "Error: could not resolve a target. Pass `target` explicitly or check that the reality root is initialized.",
        }],
      };
    }

    try {
      const result = await doVerb(resolvedTarget, action, args || {}, {
        identity: beingId ? { beingId, name: name || null } : null,
        // Pass the FULL moment ctx, not a { actId } slice. doVerb's
        // emitFact reads ctx.deltaF to push its Fact onto the moment's
        // ΔF; a truncated copy makes emitFact fall back to a sealFacts
        // singleton, self-sealing the Fact outside the moment and
        // leaving the outer Act's deltaF empty (orphan, refused by
        // sealAct). callCtx.summonCtx already carries deltaF.
        summonCtx: callCtx?.summonCtx || null,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ok: true, action, target: describeTarget(resolvedTarget), result }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              action,
              target: describeTarget(resolvedTarget),
              code: err.code || "ERROR",
              message: err.message || "do failed",
            },
            null,
            2,
          ),
        }],
      };
    }
  },
};

/**
 * Resolve the target arg into the typed target shape doVerb expects:
 *   - explicit string address (with '.' shorthand) -> pass through
 *   - explicit {kind, id} typed target -> pass through
 *   - missing -> default to the reality root as a space target
 */
async function resolveTarget(target, callCtx) {
  if (target && typeof target === "object" && target.kind && target.id) {
    return { kind: target.kind, id: String(target.id) };
  }
  if (typeof target === "string" && target.length > 0) {
    // Leading "." shorthand routes through heaven. ".config" becomes
    // "<reality>/./config"; "." alone is heaven itself.
    if (target === ".") {
      return `${getRealityDomain()}/.`;
    }
    if (target.startsWith(".") && !target.startsWith("./")) {
      return `${getRealityDomain()}/./${target.slice(1)}`;
    }
    return target;
  }
  const spaceRootId = getSpaceRootId();
  if (spaceRootId) {
    return { kind: "space", id: String(spaceRootId) };
  }
  return null;
}

function describeTarget(target) {
  if (typeof target === "string") return target;
  if (target && typeof target === "object") {
    return `${target.kind}:${String(target.id).slice(0, 8)}`;
  }
  return "(unknown)";
}
