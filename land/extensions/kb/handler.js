/**
 * KB Handler
 *
 * Only does data work and permission checks.
 * Returns { answer } for permission denials.
 * Returns null for everything else (AI handles it).
 */

import { createNote } from "../../seed/tree/notes.js";
import {
  findKbNodes,
  routeKbIntent,
  isMaintainer,
} from "./core.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const kbRoot = targetNodeId || rootId;

  // Permission check: non-maintainers can only ask, not tell or review
  const intent = routeKbIntent(message);
  if (intent === "tell") {
    const maintainer = await isMaintainer(kbRoot, userId);
    if (!maintainer) {
      return { answer: "Only maintainers can add knowledge. You can ask questions." };
    }

    // Write to log node (data work)
    const nodes = await findKbNodes(kbRoot);
    if (nodes?.log) {
      try { await createNote({ nodeId: nodes.log.id, content: message, contentType: "text", userId }); } catch {}
    }
  }

  // Let the AI handle everything else
  return null;
}
