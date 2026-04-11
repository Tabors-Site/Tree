// kb/modes/tell.js
// Parse statements into knowledge. Find or create the right location.
// Write notes. Detect updates to existing notes.

import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
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

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const kbRoot = await findExtensionRoot(currentNodeId || rootId, "kb") || rootId;
    const nodes = kbRoot ? await findKbNodes(kbRoot) : null;

    const EXPECTED = ["topics", "unplaced"];
    const found = [];
    const missing = [];
    if (nodes) {
      for (const role of EXPECTED) {
        if (nodes[role]) found.push(`${nodes[role].name} (role: ${role}, id: ${nodes[role].id})`);
        else missing.push(role);
      }
      for (const [role, info] of Object.entries(nodes)) {
        if (!EXPECTED.includes(role) && info?.id) {
          found.push(`${info.name} (role: ${role}, id: ${info.id}) [user-created]`);
        }
      }
    }

    const topicsId = nodes?.topics?.id;
    const unplacedId = nodes?.unplaced?.id;

    const structureBlock = found.length > 0
      ? `CURRENT TREE STRUCTURE\n${found.map(f => `- ${f}`).join("\n")}`
      : "TREE STRUCTURE: not yet discovered.";

    const missingBlock = missing.length > 0
      ? `\nMISSING STRUCTURAL NODES: ${missing.join(", ")}\nUse create-new-node to recreate them under root ${kbRoot} with the correct metadata.kb.role.`
      : "";

    return `You are maintaining a knowledge base for ${username}.

${structureBlock}${missingBlock}

The user tells you things. Your job is to organize that information into the tree.

WORKFLOW:
${topicsId ? `1. Use navigate-tree on the Topics node (${topicsId}) to see existing branches.
2. If a matching branch exists: read its notes. Update existing notes or add new ones.
3. If no matching branch exists: create a new node under Topics (parentId: ${topicsId}). Write the note there.
${unplacedId ? `4. If you genuinely can't categorize it: write to Unplaced (${unplacedId}). Say so.` : "4. If you genuinely can't categorize it, create an Unplaced node first, then write there."}`
: `1. Navigate the tree to understand what structure exists.
2. Find or create appropriate locations for the information.
3. Adapt to whatever structure the user has built.`}

ADAPTING TO CUSTOM STRUCTURE
The user may have reorganized their knowledge base. They might have renamed Topics, added
new category nodes, or restructured entirely. Work with whatever is there. The tree shape
IS the application. Read it, don't assume it.

RULES:
- Keep note content factual and clear. Strip conversational filler.
- Use the user's exact terminology for names, numbers, procedures.
- When updating existing notes, preserve what's still accurate. Change only what's new.
- Topic branch names should be short and descriptive: "Server Rack Layout", "Alert Procedures", "Vendor Contacts".
- If the user corrects something: find the existing note and update it. Don't create duplicates.
- Confirm what you filed and where. One sentence.
- Never expose node IDs, metadata, or internal structure to the user.`.trim();
  },
};
