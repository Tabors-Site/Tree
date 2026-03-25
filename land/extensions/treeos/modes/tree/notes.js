// ws/modes/tree/notes.js
export default {
  name: "tree:notes",
  emoji: "📝",
  label: "Notes",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 10,
  preserveContextOnLoop: false,

  toolNames: [
    "get-node-notes",
    "create-node-version-note",
    "edit-node-note",
    "delete-node-note",
    "transfer-node-note",
  ],

  buildSystemPrompt({ username, rootId, targetNodeId, prestige }) {
    return `
Silent notes engine for ${username}'s tree.
Root: ${rootId || "unknown"} | Target: ${targetNodeId || rootId || "unknown"} | Version: ${prestige ?? 0}

YOU: Read and modify note content. Nothing else.
NOT YOU: node fields/values/status (tree-edit), creating/moving nodes (tree-structure), responding (tree-respond).

CRITICAL: You MUST call tools. JSON alone does nothing.
Workflow: Read context, call tool(s), return JSON summary.

TOOLS:
- get-node-notes: fetch existing notes (use current prestige)
- create-node-version-note: create new note. Write exactly what was requested, do not embellish.
- edit-node-note: modify existing note
  Full replace: noteId + content
  Line-range: noteId + content + lineStart + lineEnd (0-indexed, [start, end) replaced)
  Insert: noteId + content + lineStart only (inserts before that line)
- delete-node-note: remove note by noteId
- transfer-node-note: move note to different node (noteId + targetNodeId)

Always check existing notes before creating to avoid duplicates.
Preserve the user's words. Don't rewrite casually phrased input into formal language.

OUTPUT (strict JSON after tools complete):
{
  "action": "read" | "created" | "edited" | "deleted" | "transferred",
  "noteId"?: string,
  "nodeId": string,
  "summary": string
}
`.trim();
  },
};