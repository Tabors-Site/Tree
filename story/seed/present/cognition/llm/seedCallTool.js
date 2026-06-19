// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seedCallTool.js . the CALL verb exposed as an LLM tool.
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
// to its toolNames. The summon verb's role-walk gates who
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
import { callVerb } from "../../../ibp/verbs/call.js";
import { getStoryDomain } from "../../../ibp/address.js";

export const seedCallTool = {
  name: "call",
  description:
    "Carry a message to a being's inbox so it wakes and processes it. Three " +
    "common shapes: " +
    "(1) REPLY — bare `summon({content: \"...\"})` defaults target to the asker " +
    "and threads off the wake correlation. " +
    "(2) ADDRESS another being — set `target` to their stance to ask them " +
    "something or hand off work. " +
    "(3) SELF — set `target` to your own stance to change your NEXT moment's " +
    "frame. This is how you turn: set `orientation: \"inward\"` to fold your " +
    "own act-chain alone next moment (pure reflection on what you've done), " +
    "`\"half\"` to fold the world plus past acts surfaced by causal " +
    "adjacency, or `\"forward\"` to keep acting in the world after one more " +
    "wake. Self-summon is for changing direction or what you see, not for " +
    "looping pointlessly — if you have nothing new to do or you've already " +
    "replied, call end-turn instead. " +
    "Authorization runs at the substrate layer; an unauthorized target " +
    "refuses with FORBIDDEN.",
  verb: "call",
  schema: {
    content: z
      .string()
      .describe("The message body. The text you want the target to read."),
    target: z
      .string()
      .optional()
      .describe(
        "Stance address of the receiver, e.g. '<story>/<spaceId>@<beingName>' " +
          "or '@beingName'. Defaults to whoever summoned this moment.",
      ),
    inReplyTo: z
      .string()
      .optional()
      .describe(
        "Correlation of a prior summon this reply threads off of. Defaults to " +
          "the correlation of the summon that opened this moment.",
      ),
    intent: z
      .string()
      .optional()
      .describe(
        "Optional kebab-case label naming your stated purpose for this summon " +
          "(e.g. 'role-request', 'offer-template', 'mate'). The receiver's role " +
          "uses it to route into the right handler arm; the auth gate uses it " +
          "to match canSummon entries that restrict by intent. You cannot " +
          "compel the receiver's response — intent is a stated purpose, not a " +
          "contract.",
      ),
    orientation: z
      .enum(["forward", "half", "inward"])
      .optional()
      .describe(
        "Only meaningful on self-summons (target = your own stance) — this is " +
          "how you choose what your next moment folds: 'forward' (default) the " +
          "world around you; 'inward' your act-chain alone (the world drops out, " +
          "pure reflection); 'half' the world plus past acts surfaced by causal " +
          "adjacency to entities currently in front of you. Pick the framing " +
          "you actually need for the next step — don't self-summon just to loop. " +
          "Cross-being summons must be 'forward'; the seed rejects 'half' or " +
          "'inward' against another being.",
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

    const wakeFrom = callCtx?.moment?.wakeFrom || null;
    const wakeCorrelation = callCtx?.moment?.wakeCorrelation || null;
    const wakeSpaceId = callCtx?.moment?.spaceId || null;

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
    // Stated purpose. Optional; when present rides the envelope (not
    // content). callVerb plumbs it to the auth gate and persists it
    // on the summon Fact + InboxProjection row. See seed/SUMMON.md.
    if (typeof args?.intent === "string" && args.intent.length > 0) {
      message.intent = args.intent;
    }
    // Orientation rides on the envelope. callVerb validates that
    // non-forward orientations are self-only (rejects half/inward on
    // cross-being summons). A being calling summon(target=self,
    // orientation="inward") wakes its next moment in pure reflection.
    if (typeof args?.orientation === "string") {
      message.orientation = args.orientation;
    }

    try {
      const result = await callVerb(
        targetStance,
        message,
        {
          identity: { beingId, name: name || null },
          // Pass the FULL moment ctx, not a { actId } slice. callVerb's
          // emitFact reads ctx.deltaF to push the call Fact onto the
          // moment's ΔF; a truncated copy self-seals it outside the
          // moment and orphans the outer Act. callCtx.moment carries
          // deltaF.
          moment: callCtx?.moment || null,
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
 * Build the qualified stance for the actor: <story>/<spaceId>@<name>.
 * Reads the wake's spaceId from callCtx.moment (filled by llmMoment).
 * Falls back to the story root if no specific space is known.
 */
function buildFromStance({ beingId, name, callCtx }) {
  if (!name) return null;
  const domain = getStoryDomain();
  if (!domain) return null;
  const spaceId = callCtx?.moment?.spaceId || null;
  if (!spaceId) return `${domain}@${name}`;
  return `${domain}/${spaceId}@${name}`;
}
