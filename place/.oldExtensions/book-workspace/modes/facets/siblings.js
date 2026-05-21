/**
 * Sibling chapters facet. Mirrors code-workspace's siblings facet but
 * reframes for prose: you're reading other chapters, not other source
 * files. The goal is continuity — timeline, call-backs, character
 * development across chapters.
 */
export default {
  name: "book-siblings",

  shouldInject(ctx) {
    const siblings = ctx?.enrichedContext?.siblingBranches;
    return Array.isArray(siblings) && siblings.length > 0;
  },

  text: `=================================================================
OTHER CHAPTERS — READ-ONLY CONTEXT
=================================================================

You are one chapter of a larger book. Other chapters have been
written (or are being written) by sibling branches. The "Other
Chapters" section below shows each sibling's premise + a first-line
excerpt of what they've actually drafted.

Use them to:

  1. Match names, places, and facts. If a sibling chapter mentions
     "the old stone hearth", don't describe the same hearth as iron
     next chapter. Copy specific details once established.

  2. Maintain timeline continuity. Don't contradict a sibling's "two
     weeks later" marker or give a character two incompatible
     locations.

  3. Land call-backs and foreshadowing. If you're chapter 7 and a
     sibling chapter 2 planted an object, you can reference it. If
     your chapter plants something, siblings writing later can pick
     it up.

  4. Spot consistency drift. If a sibling wrote Chef as
     left-handed and you're about to write him right-handed, stop
     and reconcile. Prefer matching the earlier chapter unless the
     contract says otherwise.

Rules:

  - Read siblings when continuity matters. Don't read all of them
    every turn — pick the ones your chapter connects to.
  - Never write to a sibling chapter. Your subtree is yours; theirs
    is theirs. If a sibling chapter needs a change to reconcile with
    yours, emit [[NO-WRITE: <sibling> needs <change>]] and stop.
  - Contracts + sibling prose together are your truth. Contracts say
    WHAT stays the same; sibling prose shows HOW it's been portrayed.`,
};
