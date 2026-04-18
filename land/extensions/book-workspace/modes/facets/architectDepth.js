/**
 * Architect depth guidance.
 *
 * Injected on turn 1 of a book-plan session at an uninitialized project
 * root. Teaches the architect model how to match decomposition depth to
 * scope: a short story is flat chapters, a novel is parts + chapters,
 * an epic is parts + chapters + scenes. Swarm's MAX_DEPTH=4 allows all
 * three.
 *
 * Without this facet the architect tends to either over-nest a short
 * book or under-nest a sprawling one. Explicit guidance cuts both.
 */
export default {
  name: "book-architect-depth",

  shouldInject(ctx) {
    if (!ctx?.isFirstTurn) return false;
    const view = ctx?.enrichedContext?.localViewData;
    if (!view) return true; // new fresh position, no localView yet — still safe to inject
    // Only at an empty-or-fresh project root
    if ((view.self?.childCount || 0) > 0) return false;
    return true;
  },

  text: `=================================================================
MATCH DECOMPOSITION DEPTH TO SCOPE
=================================================================

Read the user's request. Estimate how many pages / words the finished
book would be. Pick the structure that fits:

  SHORT STORY / NOVELETTE  (under ~50 pages, 1-10 chapters)
    → flat: one branch per chapter
    → branch: 01-opening
    → branch: 02-rising-action
    → branch: 03-climax
    → branch: 04-resolution

  NOVELLA / SHORT NOVEL  (50-200 pages, 10-25 chapters)
    → flat: one branch per chapter still works
    → 15-25 top-level branches is fine

  NOVEL  (200-500 pages, 25-50 chapters)
    → consider parts: 3-5 parts, each part emits chapters recursively
    → branch: part-1-the-discovery   (mode: tree:book-plan)
        This branch will emit its own [[BRANCHES]] for chapters.
    → branch: part-2-the-descent
    → branch: part-3-the-return

  EPIC / 6000-PAGE MULTI-VOLUME  (massive scope)
    → three levels: volumes → parts → chapters
    → or parts → chapters → scenes if scenes are big enough to warrant
    → do NOT put it all in one flat list. Swarm caps at 60 branches
      per level; a massive book MUST nest.

Rules:

  1. When a branch's job is to DECOMPOSE (not write prose directly),
     set its mode to tree:book-plan. It will emit its own [[BRANCHES]]
     block on its first turn. This is how recursive decomposition works.

  2. When a branch's job is to WRITE PROSE, set its mode to
     tree:book-write (or omit mode — defaults to the position's -plan
     mode in the resolver; explicit is better here).

  3. Leaf chapters should target a concrete word count. Put it in the
     spec: "spec: Chapter 4 — the first confrontation. ~3500 words,
     tight pacing, close third on Chef's POV." The write-mode branch
     uses this as a soft target.

  4. Never create a branch whose name doesn't match its path. Path is
     the filesystem-style slug (01-the-stale-kitchen). Name is the same
     slug. The human-readable title goes inside the branch's spec or in
     the contracts under the "chapters" type.

  5. If the user's request is vague ("write me a book"), do NOT invent
     a specific premise and emit branches. Instead, emit a one-line
     clarifying question. Decomposition without a premise produces
     generic filler.`,
};
