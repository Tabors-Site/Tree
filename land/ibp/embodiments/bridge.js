// TreeOS IBP — bridge embodiment factory.
//
// Most beings shown in Position Descriptors (ruler, worker, archivist,
// land-manager, citizen, etc.) are modes in the legacy conversation
// loop. Until each one migrates to a first-class IBP embodiment, the
// bridge lets TALK route to them by invoking `runChat()` with the
// corresponding modeKey and returning the answer inline.
//
// The bridge is a stopgap — per-embodiment implementations will replace
// these one-by-one. The shape is sync respond-mode so the 3D client can
// render the reply as a speech bubble without polling an outbox.

import { runChat } from "../../seed/llm/conversation.js";

export function makeBridgeEmbodiment({ name, modeKey, zone, honoredIntents = ["chat", "query"] }) {
  return Object.freeze({
    name,
    honoredIntents,
    // Async: the underlying runChat() can take many minutes. TALK ACKs
    // immediately; the protocol layer pushes the response to the sender
    // when summoning completes.
    respondMode: "async",
    triggerOn: ["message"],
    async summon(message, ctx) {
      if (!ctx.identity?.userId) {
        return {
          content: `${name} only speaks to claimed beings. Sign in and try again.`,
          intent: "chat",
        };
      }
      // Only forward rootId/nodeId for tree-zone calls. Land-zone tools
      // (land-status, land-config-*, etc.) operate at the land scope and
      // do not want a "current node" set on the session — the MCP layer
      // would otherwise gate every tool through resolveTreeAccess against
      // the land root, which has rootOwner=SYSTEM and denies even admins.
      const rootId = zone === "tree" ? (ctx.resolved?.rootId || null) : null;
      const nodeId = zone === "tree" ? (ctx.nodeId || null)            : null;
      const result = await runChat({
        userId:   ctx.identity.userId,
        username: ctx.identity.username,
        message:  String(message.content || ""),
        mode:     modeKey,
        rootId,
        nodeId,
      });
      return {
        content: result?.answer || "(no response)",
        intent: "chat",
      };
    },
  });
}
