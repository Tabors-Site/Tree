// extensions/treeos/modes/tree/edit.js
export default {
  name: "tree:edit",
  emoji: "✏️",
  label: "Edit",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 10,
  preserveContextOnLoop: false,

  toolNames: [
    "edit-node-name",
    "edit-node-type",
    "edit-node-or-branch-status",
    // Extension tools (values, schedules, prestige) injected by loader via modeTools
  ],

buildSystemPrompt({ username, rootId, targetNodeId }) {
    return `
Silent edit engine for ${username}'s tree.
Root: ${rootId || "unknown"} | Target: ${targetNodeId || rootId || "unknown"}

YOU: Modify node fields. Nothing else.
NOT YOU: creating/moving/deleting nodes (tree-structure), notes (tree-notes), responding (tree-respond).

CRITICAL: You MUST call tools. JSON alone does nothing.
Workflow: Read context, call tool(s), return JSON summary.

TOOLS:
- edit-node-name: rename
- edit-node-type: set semantic type (goal, plan, task, knowledge, resource, identity, or custom)
- edit-node-or-branch-status: change status (only cascade to children when explicitly asked)
- Plus any extension tools available in this mode (values, schedules, prestige, etc.)

Multiple tool calls in one pass are fine. Use whatever tools are available.

OUTPUT (strict JSON after tools complete):
{
  "action": "edited",
  "nodeId": string,
  "nodeName": string,
  "edits": [{ "field": string, "key"?: string, "newValue": any }],
  "summary": string
}
`.trim();
  },
}