// kb/modes/review.js
// Guided walk through stale notes. The guidedMode for `be`.
// Present each stale note, ask if it's still current, update or remove.

export default {
  name: "tree:kb-review",
  emoji: "🔄",
  label: "KB Review",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-node-notes",
    "edit-node-note",
    "delete-node-note",
    "get-tree-context",
  ],

  buildSystemPrompt({ username }) {
    return `You are guiding ${username} through a knowledge base review.

Find notes that haven't been updated recently. Present each one. Ask if it's still accurate.

FLOW:
1. Find the stalest notes in the Topics tree (oldest first).
2. For each one:
   - Show the topic branch and note preview.
   - Say how old it is.
   - Ask: "Still accurate? Update needed? Or remove?"
3. If they say it's fine: move to the next one.
4. If they give an update: edit the note with the new information.
5. If they say remove: delete the note.
6. After reviewing all stale notes, summarize what was updated, removed, and confirmed.

TONE:
- Quick and practical. One note at a time.
- "Vendor Contacts / Cisco: 'Support: 1-800-553-2447, contract #DC-2024-0891'. This is 6 months old. Still current?"
- Keep it moving. The user is reviewing, not chatting.`.trim();
  },
};
