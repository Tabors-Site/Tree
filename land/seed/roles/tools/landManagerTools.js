// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// land-manager tools.
//
// The old land-manager shipped 13 bespoke tools (land-status,
// land-config-read, land-config-set, land-users, land-peers,
// land-system-nodes, land-ext-list, land-ext-install, land-ext-disable,
// land-ext-enable, land-ext-search, ext-scope-read, ext-scope-set). In
// the new architecture every land-level concern is reachable through
// substrate primitives — SEE on meta-positions, DO on registered ops.
// So land-manager ships just two generic tools and the LLM enumerates
// the actual surface live:
//
//   land-see   →  SEE on any position on this land. Reads the .config,
//                 .extensions, .peers, .operations, .roles, .tools, …
//                 system nodes to enumerate current state.
//
//   land-do    →  Invoke a registered DO operation at the land root.
//                 `set-config` / `delete-config` / `install-extension` /
//                 `uninstall-extension` / `enable-extension` /
//                 `disable-extension` — discoverable via
//                 SEE on .operations.
//
// Authorization is the stance gate on each verb call (the DO verb runs
// authorize() before the op handler). Non-root operators trying to
// install an extension or write config get FORBIDDEN.

import { z } from "zod";
import { seeVerb, doVerb } from "../../core/verbs.js";
import { getLandDomain } from "../../addressing/address.js";
import { getLandRootId } from "../../landRoot.js";

export const landManagerTools = [
  {
    name: "land-see",
    description:
      "Read substrate at any position on this land. Returns a Position Descriptor. " +
      "Use it to enumerate land-level state: " +
      "SEE <land>/.config for runtime config keys; " +
      "SEE <land>/.extensions for installed extensions; " +
      "SEE <land>/.operations to discover what land-do can invoke; " +
      "SEE <land>/.peers / .tools / .roles for the live registries; " +
      "SEE <land>/.identity for this land's DID and public key.",
    annotations: { readOnlyHint: true },
    verb: "see",
    schema: {
      address: z.string().describe(
        "Position address to read. Examples: " +
        "'.config', '.extensions', 'treeos.ai/.operations', 'treeos.ai/<nodeId>'. " +
        "Relative addresses (starting with '.') resolve against this land's root.",
      ),
      beingId: z.string().describe("Injected by server. Ignore."),
      name:    z.string().optional().describe("Injected by server. Ignore."),
    },
    async handler({ address, beingId, name }) {
      const resolved = address.startsWith(".") ? `${getLandDomain()}/${address}` : address;
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
    name: "land-do",
    description:
      "Invoke a registered DO operation at the land root. " +
      "Use land-see on <land>/.operations first to discover what's available " +
      "and what args each operation expects. Typical land-level ops: " +
      "set-config, delete-config, install-extension, uninstall-extension, " +
      "enable-extension, disable-extension. " +
      "Authorization runs at the substrate layer — non-root operators are " +
      "rejected with FORBIDDEN, so it's safe to attempt and surface the error.",
    annotations: { destructiveHint: true },
    verb: "do",
    schema: {
      action: z.string().describe(
        "Operation name as registered. E.g. 'set-config', 'install-extension'.",
      ),
      args: z.record(z.any()).optional().describe(
        "Operation-specific args. set-config wants { key, value }; " +
        "install-extension wants { name, files, ... }; etc. " +
        "Read .operations + the op's didAction for the exact shape.",
      ),
      beingId: z.string().describe("Injected by server. Ignore."),
      name:    z.string().optional().describe("Injected by server. Ignore."),
    },
    async handler({ action, args, beingId, name }) {
      const landRootId = getLandRootId();
      if (!landRootId) {
        return { content: [{ type: "text", text: "Error: land root not initialized." }] };
      }
      const target = { _id: landRootId, nodeId: landRootId, chain: [] };
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
              message: err.message || "land-do failed",
            }, null, 2),
          }],
        };
      }
    },
  },
];
