// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seedSeeTool.js . the SEE verb exposed as an LLM tool.
//
// Reads at any position. Parallel structure to seedSummonTool: ONE
// generic see tool the seed ships; tool exposure is derived from
// the role's `canSee` list being non-empty, and the list itself
// declares which addresses the role is licensed to read. Substrate
// stance-auth at the verb is the actual gate.
//
// An LLM being that needs to read substrate (positions, qualities,
// state) gets this tool automatically by populating `canSee` on its
// role spec . tool exposure is derived from which can* lists are
// non-empty, no toolNames field. It calls `see({address: "..."})`
// and receives the Position Descriptor.
//
// Address shorthand. A leading "." names a heaven child .
// ".config" → "<reality>/./config". Absolute addresses pass through
// unchanged. This matches the reality-see ergonomics so the LLM does
// not need to know the reality DID for common cases.

import { z } from "zod";
import { seeVerb } from "../../../ibp/verbs/see.js";
import { getRealityDomain } from "../../../ibp/address.js";

export const seedSeeTool = {
  name: "see",
  description:
    "Read substrate at a position. Returns the Position Descriptor for that " +
    "address (its qualities, children, matter, occupants, etc.). " +
    "Address shorthand: a leading '.' names a heaven child " +
    "('.config' resolves to '<reality>/./config'). Authorization runs at " +
    "the substrate layer; positions the role is not licensed to see " +
    "refuse with FORBIDDEN.",
  verb: "see",
  schema: {
    address: z.string().describe(
      "Position address to read. Examples: '.config', '.extensions', " +
        "'<reality>/./operations', '<reality>/<spaceId>', '<reality>/<spaceId>@<being>'. " +
        "Leading '.' names a heaven child.",
    ),
    beingId: z.string().describe("Injected by server. Ignore."),
    name: z.string().optional().describe("Injected by server. Ignore."),
  },
  async handler({ address, beingId, name }) {
    if (typeof address !== "string" || address.length === 0) {
      return {
        content: [{ type: "text", text: "Error: see requires a non-empty `address` string." }],
      };
    }
    // Leading "." shorthand routes through heaven. ".config" becomes
    // "<reality>/./config"; ".x/y" becomes "<reality>/./x/y". Bare "."
    // is heaven itself.
    let resolved = address;
    if (address === ".") {
      resolved = `${getRealityDomain()}/.`;
    } else if (address.startsWith(".") && !address.startsWith("./")) {
      resolved = `${getRealityDomain()}/./${address.slice(1)}`;
    }
    try {
      const descriptor = await seeVerb(resolved, {
        identity: beingId ? { beingId, name: name || null } : null,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(descriptor, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            { ok: false, address: resolved, code: err.code || "ERROR", message: err.message || "see failed" },
            null,
            2,
          ),
        }],
      };
    }
  },
};
