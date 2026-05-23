// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// reality-manager tools.
//
// The old reality-manager shipped 13 bespoke tools (place-status,
// place-config-read, place-config-set, place-users, place-peers,
// place-system-nodes, place-ext-list, place-ext-install, place-ext-disable,
// place-ext-enable, place-ext-search, ext-scope-read, ext-scope-set). In
// the new architecture every place-level concern is reachable through
// substrate primitives — SEE on meta-positions, DO on registered ops.
// So reality-manager ships just two generic tools and the LLM enumerates
// the actual surface live:
//
//   reality-see   →  SEE on any position on this reality. Reads the .config,
//                 .extensions, .peers, .operations, .roles, .tools, …
//                 place seed spaces to enumerate current state.
//
//   reality-do    →  Invoke a registered DO operation at the space root.
//                 `set-config` / `delete-config` / `install-extension` /
//                 `uninstall-extension` / `enable-extension` /
//                 `disable-extension` — discoverable via
//                 SEE on .operations.
//
// Authorization is the stance gate on each verb call (the DO verb runs
// authorize() before the op handler). Non-root operators trying to
// install an extension or write config get FORBIDDEN.

import { z } from "zod";
import { seeVerb, doVerb } from "../../ibp/verbs.js";
import { getRealityDomain } from "../../ibp/address.js";
import { getSpaceRootId } from "../../sprout.js";

export const realityManagerTools = [
  {
    name: "reality-see",
    description:
      "Read substrate at any position on this reality. Returns a Position Descriptor. " +
      "Use it to enumerate reality-level state: " +
      "SEE <reality>/.config for runtime config keys; " +
      "SEE <reality>/.extensions for installed extensions; " +
      "SEE <reality>/.operations to discover what reality-do can invoke; " +
      "SEE <reality>/.peers / .tools / .roles for the live registries; " +
      "SEE <reality>/.identity for this reality's DID and public key.",
    verb: "see",
    schema: {
      address: z.string().describe(
        "Position address to read. Examples: " +
        "'.config', '.extensions', 'treeos.ai/.operations', 'treeos.ai/<spaceId>'. " +
        "Relative addresses (starting with '.') resolve against this reality's root.",
      ),
      beingId: z.string().describe("Injected by server. Ignore."),
      name:    z.string().optional().describe("Injected by server. Ignore."),
    },
    async handler({ address, beingId, name }) {
      const resolved = address.startsWith(".") ? `${getRealityDomain()}/${address}` : address;
      try {
        const descriptor = await seeVerb(resolved, {
          identity: beingId ? { beingId, name } : null,
        });
        return { content: [{ type: "text", text: JSON.stringify(descriptor, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error: ${err.message}` }] };
      }
    },
  },

  {
    name: "reality-do",
    description:
      "Invoke a registered DO operation at the space root. " +
      "Use reality-see on <reality>/.operations first to discover what's available " +
      "and what args each operation expects. Typical place-level ops: " +
      "set-config, delete-config, install-extension, uninstall-extension, " +
      "enable-extension, disable-extension. " +
      "Authorization runs at the substrate layer — non-root operators are " +
      "rejected with FORBIDDEN, so it's safe to attempt and surface the error.",
    verb: "do",
    schema: {
      action: z.string().describe(
        "Operation name as registered. E.g. 'set-config', 'install-extension'.",
      ),
      args: z.record(z.any()).optional().describe(
        "Operation-specific args. set-config wants { key, value }; " +
        "install-extension wants { name, files, ... }; etc. " +
        "Read .operations + the op's factAction for the exact shape.",
      ),
      beingId: z.string().describe("Injected by server. Ignore."),
      name:    z.string().optional().describe("Injected by server. Ignore."),
    },
    async handler({ action, args, beingId, name }) {
      const spaceRootId = getSpaceRootId();
      if (!spaceRootId) {
        return { content: [{ type: "text", text: "Error: space root not initialized." }] };
      }
      const target = { _id: spaceRootId, spaceId: spaceRootId, chain: [] };
      try {
        const result = await doVerb(target, action, args || {}, {
          identity: beingId ? { beingId, name } : null,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, action, result }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok:      false,
              action,
              code:    err.code || "ERROR",
              message: err.message || "reality-do failed",
            }, null, 2),
          }],
        };
      }
    },
  },
];
