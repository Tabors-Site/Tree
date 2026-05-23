// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// place-manager tools.
//
// The old place-manager shipped 13 bespoke tools (place-status,
// place-config-read, place-config-set, place-users, place-peers,
// place-system-nodes, place-ext-list, place-ext-install, place-ext-disable,
// place-ext-enable, place-ext-search, ext-scope-read, ext-scope-set). In
// the new architecture every place-level concern is reachable through
// substrate primitives — SEE on meta-positions, DO on registered ops.
// So place-manager ships just two generic tools and the LLM enumerates
// the actual surface live:
//
//   place-see   →  SEE on any position on this place. Reads the .config,
//                 .extensions, .peers, .operations, .roles, .tools, …
//                 place seed spaces to enumerate current state.
//
//   place-do    →  Invoke a registered DO operation at the place root.
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
import { getPlaceDomain } from "../../ibp/address.js";
import { getPlaceRootId } from "../../placeRoot.js";

export const placeManagerTools = [
  {
    name: "place-see",
    description:
      "Read substrate at any position on this place. Returns a Position Descriptor. " +
      "Use it to enumerate place-level state: " +
      "SEE <place>/.config for runtime config keys; " +
      "SEE <place>/.extensions for installed extensions; " +
      "SEE <place>/.operations to discover what place-do can invoke; " +
      "SEE <place>/.peers / .tools / .roles for the live registries; " +
      "SEE <place>/.identity for this place's DID and public key.",
    verb: "see",
    schema: {
      address: z.string().describe(
        "Position address to read. Examples: " +
        "'.config', '.extensions', 'treeos.ai/.operations', 'treeos.ai/<spaceId>'. " +
        "Relative addresses (starting with '.') resolve against this place's root.",
      ),
      beingId: z.string().describe("Injected by server. Ignore."),
      name:    z.string().optional().describe("Injected by server. Ignore."),
    },
    async handler({ address, beingId, name }) {
      const resolved = address.startsWith(".") ? `${getPlaceDomain()}/${address}` : address;
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
    name: "place-do",
    description:
      "Invoke a registered DO operation at the place root. " +
      "Use place-see on <place>/.operations first to discover what's available " +
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
      const placeRootId = getPlaceRootId();
      if (!placeRootId) {
        return { content: [{ type: "text", text: "Error: place root not initialized." }] };
      }
      const target = { _id: placeRootId, spaceId: placeRootId, chain: [] };
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
              message: err.message || "place-do failed",
            }, null, 2),
          }],
        };
      }
    },
  },
];
