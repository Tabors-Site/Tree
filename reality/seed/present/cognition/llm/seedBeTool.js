// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seedBeTool.js . the BE verb exposed as an LLM tool.
//
// Identity-bind operations. The fourth and final verb-tool;
// completes the symmetric surface (see / do / summon / be). Most BE
// operations are identity-acquisition (register / claim / release)
// handled by scripted seed roles (cherub, llm-assigner) out of band
// of LLM cognition. The two LLM-relevant cases:
//
//   1. `switch` . a being changes its active role mid-presence
//   2. extension-registered honored BE operations (e.g. domain-specific
//      identity rites). Same registration pattern as DO ops.
//
// Parallel structure to the other three:
//   ONE generic tool. The role's `canBe` list is the body of what
//   it's licensed to perform; tool exposure is derived from canBe
//   being non-empty. Substrate role-walk at the verb is the
//   actual gate.

import { z } from "zod";
import { beVerb } from "../../../ibp/verbs/be.js";

export const seedBeTool = {
  name: "be",
  description:
    "Perform a BE (identity-bind) operation. Operations: " +
    "'switch' to change the calling being's active role, plus any " +
    "extension-registered honored BE ops. register/claim/release are " +
    "identity-acquisition flows handled by scripted roles out of band; " +
    "an LLM being normally only calls 'switch'. Authorization runs at the " +
    "substrate layer.",
  verb: "be",
  schema: {
    operation: z.string().describe(
      "BE operation name. Common: 'switch'. Extensions may register more.",
    ),
    payload: z.record(z.any()).optional().describe(
      "Operation-specific payload. switch expects { newRole }.",
    ),
    address: z.string().optional().describe(
      "Address the operation acts on. Defaults to the calling being's own " +
        "stance. Most BE ops are self-targeted.",
    ),
    beingId: z.string().describe("Injected by server. Ignore."),
    name: z.string().optional().describe("Injected by server. Ignore."),
  },
  async handler({ operation, payload, address, beingId, name }, callCtx) {
    if (typeof operation !== "string" || operation.length === 0) {
      return {
        content: [{ type: "text", text: "Error: be requires a non-empty `operation` string." }],
      };
    }
    try {
      const result = await beVerb(operation, payload || {}, {
        address: address || null,
        identity: beingId ? { beingId, name: name || null } : null,
        // Pass the FULL moment ctx, not a { actId } slice. beVerb's
        // emitFact reads ctx.deltaF to push its Fact onto the moment's
        // ΔF; a truncated copy self-seals it outside the moment and
        // orphans the outer Act. callCtx.summonCtx carries deltaF.
        summonCtx: callCtx?.summonCtx || null,
      });
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ok: true, operation, result }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            { ok: false, operation, code: err.code || "ERROR", message: err.message || "be failed" },
            null,
            2,
          ),
        }],
      };
    }
  },
};
