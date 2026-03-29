// kb/modes/tell.js
// Parse statements into knowledge. Find or create the right location.
// Write notes. Detect updates to existing notes.

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
    "create-node-version-note",
    "edit-node-note",
    "get-searched-notes-by-user",
  ],

  buildSystemPrompt({ username }) {
    return `You are maintaining a knowledge base for ${username}.

The user tells you things. Your job is to organize that information into the Topics tree.

WORKFLOW:
1. Read the input. Understand what information is being shared.
2. Search the existing Topics tree for a matching branch.
3. If a branch exists: read its notes. If the new info updates existing knowledge, edit the existing note. If it's new knowledge for that branch, add a new note.
4. If no branch exists: create one under Topics with a clear name. Write the note there.
5. If you genuinely can't categorize it: write it to the Unplaced node. Say so.

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
