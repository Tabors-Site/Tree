// TreeOS IBP — bridge being factory.
//
// Most beings shown in Position Descriptors (ruler, worker, archivist,
// land-manager, citizen, etc.) are modes in the legacy conversation
// loop. Until each one migrates to a first-class IBP being, the
// bridge lets SUMMON route to them by invoking `runChat()` with the
// corresponding modeKey and returning the answer inline.
//
// The bridge is a stopgap — per-being implementations will replace
// these one-by-one. The shape is sync respond-mode so the 3D client can
// render the reply as a speech bubble without polling an outbox.

import { runChat } from "../../seed/llm/conversation.js";

export function makeBridgeEmbodiment({ name, modeKey, zone, permissions = ["see", "do", "summon"] }) {
  return Object.freeze({
    name,
    // Bridge beings carry the legacy mode-key path; permissions are
    // permissive by default since each bridged mode's old tool set
    // could include any verb. Specific roles override this with their
    // declared permissions.
    permissions,
    // Async: the underlying runChat() can take many minutes. SUMMON ACKs
    // immediately; the protocol layer pushes the response to the sender
    // when summoning completes.
    respondMode: "async",
    triggerOn: ["message"],
    async summon(message, ctx) {
      if (!ctx.identity?.beingId) {
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
        beingId:  ctx.identity.beingId,   // legacy alias for beingIn
        beingIn:  ctx.identity.beingId,   // the human (or being) asking
        beingOut: ctx.toBeing?._id || null, // the AI being responding
        username: ctx.identity.username,
        message:  String(message.content || ""),
        mode:     modeKey,
        rootId,
        nodeId,
      });
      return {
        content: result?.answer || "(no response)",
        intent: "chat",
        // runChat returns the Chat record's id. Surface it so the inbox
        // entry can reference the conversation history this message was
        // processed into (markInboxConsumed stores it on the entry).
        summonId: result?.summonId || null,
      };
    },
  });
}
