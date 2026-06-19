// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seedEndTurnTool.js . the no-act call exposed as an LLM tool.
//
// Every moment the LLM may choose to act (do / summon / be) OR to
// release without acting. The release path was implicit before this
// tool: no tool call → cognitionSee() → moment closes clean, no Act
// row. That works architecturally but doesn't tell the LLM it has
// permission to do nothing. LLMs are trained to be helpful and tend
// to invent acts when none is needed; forward folds make this loud
// (the world is in front of you, surely there's something to do)
// and inward / half folds make it louder (you just read your own
// past, surely something to act on).
//
// end-turn is the explicit version of that release. The LLM calls
// it when it has seen and chosen not to act. The dispatcher routes
// a successful end-turn straight to cognitionSee() — no Act, no
// Facts, the inbox row closes cleanly. Same downstream effect as
// the implicit no-tool path; the value is naming the choice.
//
// This is the moment-level mirror of the IBP SEE verb: at the four-
// verb layer SEE means "read state, no write"; at the moment layer
// end-turn means "I have read this moment's face, I commit no act."
// canSee preloads are a separate mechanism (face blocks injected
// into the prompt before the call); the four can* lists are about
// dispatch-time options. end-turn lives in dispatch-time as the
// explicit no-dispatch.
//
// Always available. Bypasses the per-role canDo / canSummon / canBe
// gating and the verb-permission filter — every cognition needs the
// option to release a moment without acting, regardless of what the
// role is licensed to do.

import { z } from "zod";

export const seedEndTurnTool = {
  name: "end-turn",
  description:
    "Release this moment without acting. Call this when you have looked at " +
    "what's in front of you (forward fold: the world; inward fold: your past " +
    "acts; half fold: world + surfaced past) and decided nothing needs doing " +
    "this turn. No Act seals, no Facts emit, the inbox closes cleanly. " +
    "Equivalent to emitting no tool call, but explicit — pick this when you " +
    "want to make 'I have seen, I will not act' a deliberate choice. " +
    "Reasoning prose alongside this tool call is discarded; the act-chain " +
    "carries no record of this moment.",
  verb: "see",
  schema: {
    // Intentionally empty. No args. The act of calling is the whole
    // semantic; nothing to parameterize.
    beingId: z.string().describe("Injected by server. Ignore."),
  },
  async handler(_args, _callCtx) {
    // Handler returns the canonical "I did nothing" shape. The LLM
    // dispatcher special-cases the end-turn tool name and routes
    // straight to cognitionSee() regardless of the prose alongside,
    // so this return value is mostly cosmetic — but we keep it
    // shaped like every other tool's success so log paths don't
    // need a special branch.
    return {
      content: [{ type: "text", text: "Turn released without acting." }],
    };
  },
};
