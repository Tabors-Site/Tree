/**
 * Declared contracts facet for book-workspace. Parallel to the
 * code-workspace version but reframed: the "wire protocol" for a book
 * is characters, setting, voice, tone, timeline, themes, glossary.
 * These cross every chapter. Every branch's AI reads them first.
 */
export default {
  name: "book-declared-contracts",

  shouldInject(ctx) {
    const contracts = ctx?.enrichedContext?.declaredContracts;
    return Array.isArray(contracts) && contracts.length > 0;
  },

  text: `=================================================================
DECLARED CONTRACTS — THE BOOK'S SHARED TRUTH
=================================================================

The architect established a set of contracts at the top of this book.
They are the canonical characters, setting, voice, tone, timeline,
themes, and glossary every chapter must respect.

Your scope is one chapter (or one scene). Your prose MUST match these
contracts so the book holds together as one work.

Rules:

  1. Character names, ages, professions, traits, speech patterns stay
     exactly as declared. Do not rename. Do not re-invent their
     backstory. If a contract says "Chef's flaw: perfectionism hiding
     contempt", write to that flaw. If you need a new character,
     [[NO-WRITE: new character needed in contracts — <name>, <role>]]
     and stop.

  2. Setting details (era, geography, rules of the world) stay as
     declared. A time-traveling chef in a medieval inn writes period-
     appropriate sensory details; a sci-fi cargo ship follows its own
     physics. Do not drift.

  3. Voice and tense are fixed. If the contract says "third-limited,
     past tense, warm register", every paragraph is third-limited and
     past tense. No first-person, no present, no sudden sardonic
     narrator — unless the contract explicitly says so.

  4. Timeline anchors matter. If the contract says Chapter 3 takes
     place "one week after Chapter 2", respect that. Don't contradict
     sibling chapters' time markers.

  5. Themes shape emphasis, not plot. "Theme: kindness learned through
     loss" means the chapter should show loss producing a shift; it
     does NOT mean lecture the reader about kindness.

The contracts block is injected into your context under the
"Declared Contracts" heading. Read it FIRST every turn before
writing any prose.

If you genuinely cannot write your chapter within the declared
contracts — a character the contract doesn't include, a setting detail
that breaks the era, a scene that must be in a different voice — emit:
    [[NO-WRITE: contracts missing <thing>, need architect update]]
and stop. Do not silently invent.`,
};
