// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seedSummonTool.js . the SUMMON verb exposed as an LLM tool.
//
// Speech to a being is SUMMON. There is no "respond" or "narrate"
// verb in the model . a being that wants to speak to another being
// calls the existing SUMMON primitive, and the message carries the
// content. The reply-machinery (inReplyTo threading, the threads
// projection) hangs off the same primitive every being-to-being
// summon uses. This file just exposes SUMMON to the LLM as a named
// function call.
//
// A role that should be able to speak to other beings adds "summon"
// to its toolNames. The summon verb's stance authorization gates who
// can summon whom; this tool runs the verb with the calling being's
// identity, so anything the role isn't authorized to summon will
// refuse at the substrate layer.
//
// Auto-injection. When this tool fires inside a reply (the moment
// was opened by an incoming SUMMON), the handler defaults `target`
// to the wake's `from` stance and `inReplyTo` to the wake's
// `correlation`. The LLM can override either, but for the
// canonical reply-to-asker case it just calls
// `summon({content: "..."})` and the threading happens automatically.

import { z } from "zod";
import { summonVerb } from "../../../ibp/verbs/summon.js";
import { getRealityDomain } from "../../../ibp/address.js";

export const seedSummonTool = {
  name: "summon",
  description:
    "Speak to another being. SUMMON carries `content` to the target's inbox; " +
    "the target wakes and processes the message according to its role. " +
    "Use this to reply to whoever woke you (target and inReplyTo default to " +
    "the asker and their wake correlation, so a bare " +
    "`summon({content: \"...\"})` is a reply) or to address any other being " +
    "by stance. Authorization runs at the substrate layer; an unauthorized " +
    "target refuses with FORBIDDEN.",
  verb: "summon",
  schema: {
    content: z
      .string()
      .describe("The message body. The text you want the target to read."),
    target: z
      .string()
      .optional()
      .describe(
        "Stance address of the receiver, e.g. '<reality>/<spaceId>@<beingName>' " +
          "or '@beingName'. Defaults to whoever summoned this moment.",
      ),
    inReplyTo: z
      .string()
      .optional()
      .describe(
        "Correlation of a prior summon this reply threads off of. Defaults to " +
          "the correlation of the summon that opened this moment.",
      ),
    beingId: z.string().describe("Injected by server. Ignore."),
    name: z.string().optional().describe("Injected by server. Ignore."),
  },
  async handler(args, callCtx) {
    const { content, beingId, name } = args || {};
    if (typeof content !== "string" || content.length === 0) {
      return {
        content: [{ type: "text", text: "Error: summon requires a non-empty `content` string." }],
      };
    }

    const wakeFrom = callCtx?.summonCtx?.wakeFrom || null;
    const wakeCorrelation = callCtx?.summonCtx?.wakeCorrelation || null;
    const wakeSpaceId = callCtx?.summonCtx?.spaceId || null;

    const targetStance =
      (typeof args?.target === "string" && args.target.length > 0
        ? args.target
        : wakeFrom);
    if (!targetStance) {
      return {
        content: [{
          type: "text",
          text: "Error: no target. The summon's `target` was not provided and there is no wake source to reply to.",
        }],
      };
    }

    const fromStance = buildFromStance({ beingId, name, callCtx });
    if (!fromStance) {
      return {
        content: [{
          type: "text",
          text: "Error: could not build sender stance . missing beingId/name/position.",
        }],
      };
    }

    const inReplyTo =
      (typeof args?.inReplyTo === "string" && args.inReplyTo.length > 0
        ? args.inReplyTo
        : wakeCorrelation) || undefined;

    const message = { from: fromStance, content };
    if (inReplyTo) message.inReplyTo = inReplyTo;

    try {
      const result = await summonVerb(
        targetStance,
        message,
        {
          identity: { beingId, name: name || null },
          // Pass the FULL moment ctx, not a { actId } slice. summonVerb's
          // emitFact reads ctx.deltaF to push the be:summon Fact onto the
          // moment's ΔF; a truncated copy self-seals it outside the
          // moment and orphans the outer Act. callCtx.summonCtx carries
          // deltaF.
          summonCtx: callCtx?.summonCtx || null,
        },
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              target: targetStance,
              inReplyTo: inReplyTo || null,
              ...(result && typeof result === "object" ? result : {}),
            },
            null,
            2,
          ),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              target: targetStance,
              code: err.code || "ERROR",
              message: err.message || "summon failed",
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
 * Build the qualified stance for the actor: <reality>/<spaceId>@<name>.
 * Reads the wake's spaceId from callCtx.summonCtx (filled by llmMoment).
 * Falls back to the reality root if no specific space is known.
 */
function buildFromStance({ beingId, name, callCtx }) {
  if (!name) return null;
  const domain = getRealityDomain();
  if (!domain) return null;
  const spaceId = callCtx?.summonCtx?.spaceId || null;
  if (!spaceId) return `${domain}@${name}`;
  return `${domain}/${spaceId}@${name}`;
}
