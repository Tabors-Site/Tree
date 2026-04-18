/**
 * Chapter scope facet. Fires when the current session is at a chapter
 * (or scene) branch. Tells the writer exactly what it's writing, how
 * long, and what to do when done.
 */
export default {
  name: "book-chapter-scope",

  shouldInject(ctx) {
    const position = ctx?.enrichedContext?.bookPosition;
    return typeof position === "string" && position.length > 0;
  },

  text: `=================================================================
SCOPE OF THIS TURN
=================================================================

Your job is to write the prose for THIS node's chapter or scene. The
position block above names your role (chapter / scene), your spec, and
your soft target word count.

How to write:

  1. Read the declared contracts and any sibling chapter summaries
     at the top of your context. Then start prose.

  2. Prose lives in NOTES on this node. Call the 'note' tool to add
     a note with your chapter's content. If your chapter is long,
     you can write it across multiple notes (scenes, sections) or
     one long note.

  3. Target the declared word count softly — a little over or under
     is fine, but don't write 500 words when the target is 4000.
     The book's rhythm depends on chapter length consistency.

  4. Emit [[DONE]] when the chapter's prose is complete. This
     signals the swarm runner that your branch finished. Swarm will
     record the branch status and move on to the next branch.

  5. If your chapter genuinely needs more structure (multiple scenes
     with different POVs, for example), emit a nested [[BRANCHES]]
     block ONCE, with one branch per scene, and emit [[DONE]]
     immediately. Each scene branch will run its own session and
     write its own prose to its own node.

  6. If the contracts are missing something you need (a character not
     declared, a setting detail that contradicts the era), emit
     [[NO-WRITE: <what's missing>]] and stop. The architect will
     update contracts and retry.

Do not write meta-commentary in the notes. Prose only. The 'book'
extension will compile your notes into the finished document; anything
that isn't prose becomes visible clutter.`,
};
