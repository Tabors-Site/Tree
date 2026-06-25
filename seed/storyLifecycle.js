// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// storyLifecycle.js — the close-story DISPATCH GATE.
//
// close-story (storyConfig.js) lays a 5D NAME-ACT on the LIBRARY reel (verb:"name",
// act:"close-story"). That fact IS the "story closed" signal — story-wide, out of history.
// This gate reads it and REFUSES every world-changing act (do / be / name) once the story is
// closed. SEE stays open: reading (or exporting) a closed story is fine; only NEW acts stop.
//
// Doctrine (project_close_story_vs_history): close-story halts EVERY future act across ALL the
// story's reels (being, matter, fact) — it is NOT close-history (which ends one branch). A story
// never reopens — a one-way latch.
//
// BOOT-SAFE by construction: the latch starts OPEN and the fact is read LAZILY on the first act,
// catching any failure as OPEN — so genesis (which dispatches create-space / set-being via doVerb
// while building a FRESH story, where no close-story fact exists yet) always passes. close-story
// flips the latch in-process via markStoryClosed (immediacy); a server restarted on a closed story
// reads the fact on its first act and latches closed.

let _closed = false;
let _checked = false;

// Flip the latch the instant close-story lays its fact (this process), without a re-read.
export function markStoryClosed() {
  _closed = true;
  _checked = true;
}

// True once a close-story name-act exists on the library reel. Reads the fact ONCE (then caches);
// any read failure assumes OPEN — never wedge a healthy or still-building story.
export async function isStoryClosed() {
  if (_checked) return _closed;
  _checked = true;
  try {
    const { getStoryDomain } = await import("./ibp/address.js");
    const { getFactsOnReelWhere } = await import("./past/fact/facts.js");
    // close-story lays a 5D name-act on the library reel, out of any
    // history (config/library writes land on "0"). Read that reel via the
    // curated getFactsOnReelWhere (the file-native peer of Fact.findOne)
    // and latch closed if any close-story name-act exists.
    const hits = getFactsOnReelWhere(
      "0",
      "library",
      getStoryDomain(),
      (f) => f.verb === "name" && f.act === "close-story",
    );
    _closed = hits.length > 0;
  } catch {
    _closed = false;
  }
  return _closed;
}

// The gate. Throws FORBIDDEN when the story is closed. Called at the top of doVerb/beVerb/nameVerb.
export async function assertStoryOpen() {
  if (await isStoryClosed()) {
    const { IbpError, IBP_ERR } = await import("./ibp/protocol.js");
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "This story is closed; no further acts are accepted (close-story is a one-way, story-wide stop).",
    );
  }
}

// TEST-ONLY: reset the in-process latch (so a verifier can exercise the fact-read path that a
// fresh server restart would take). Not used by the running system.
export function _resetStoryClosedLatchForTest() {
  _closed = false;
  _checked = false;
}
