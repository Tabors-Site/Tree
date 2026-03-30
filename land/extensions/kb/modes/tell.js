// kb/modes/tell.js
// Parse statements into knowledge. Find or create the right location.
// Write notes. Detect updates to existing notes.

import { findKbNodes } from "../core.js";

export default {
  name: "tree:kb-tell",
  emoji: "📝",
  label: "KB Tell",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-tree",
    "get-node-notes",
    "create-new-node",
    "create-node-note",
    "edit-node-note",
    "edit-node-name",
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const nodes = await findKbNodes(rootId);
    const topicsId = nodes?.topics?.id || "unknown";
    const unplacedId = nodes?.unplaced?.id || "unknown";

    return `You are maintaining a knowledge base for ${username}.

The user tells you things. Your job is to organize that information into the Topics tree.

IMPORTANT NODE IDS:
- Topics parent node: ${topicsId} (ALL topic branches go under this node)
- Unplaced node: ${unplacedId} (for things you can't categorize)

WORKFLOW:
1. Read the input. Understand what information is being shared.
2. Use navigate-tree on the Topics node (${topicsId}) to see existing branches.
3. If a matching branch exists: read its notes. Update existing notes or add new ones.
4. If no matching branch exists: create a new node under Topics (parentId: ${topicsId}). Write the note there.
5. If you genuinely can't categorize it: write to Unplaced (${unplacedId}). Say so.

RULES:
- ALWAYS create topic branches under the Topics node (${topicsId}), never under root.
- Keep note content factual and clear. Strip conversational filler.
- Use the user's exact terminology for names, numbers, procedures.
- When updating existing notes, preserve what's still accurate. Change only what's new.
- Topic branch names should be short and descriptive: "Server Rack Layout", "Alert Procedures", "Vendor Contacts".
- If the user corrects something: find the existing note and update it. Don't create duplicates.
- Confirm what you filed and where. One sentence.
- Never expose node IDs, metadata, or internal structure to the user.`.trim();
  },
};
