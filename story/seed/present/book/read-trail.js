// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// read-trail.js — the SELF-TARGET fold: folding your own chain into a view, through a lens.
// (philosophy/word/reading-the-trail.md · 623/8.pdf + 623/12.md "what from")
//
// THE COLLAPSE (Tabor, 623/12.md): there is no `call` verb and no `recall` verb. The QUOTES are the
// do — "utter this word". The ADDRESS (the target) is the only modifier, and it decides the kind by
// one question — is the target me, or not-me?
//   "what from?"        — no address → the target defaults to the SIGNER (you; every stamp is signed,
//                          so the bare quote inherits you for free). Self-target → you FOLD YOUR OWN
//                          chain (the read you can do). What we used to call a recall.
//   salem "what from?"  — a named other → `from` must walk a reel that is NOT yours → you cannot read
//                          it, you can only ask and AWAIT his stamp. What we called a call. The await
//                          is forced by the target being across the boundary, not a flag you set.
// The verb was the address said twice. The mode is not declared — it falls out of who the target is.
//
// THIS FILE is the SELF-TARGET path: it folds YOUR OWN chain (a SEE of the past — lays no fact). The
// other-target (await across the boundary) is not a read here; it is the call/await path.
//
// The LENS (what/where/who/when/how/why) is WHICH FACET you read off each passed fact — the
// interrogative inside the quoted word, ORTHOGONAL to the target (same lens whether self or other). A
// lens is a "view", a granted word per a being's `can`. No lens → the full word per fact (the
// narrative story, assembleStory's weave). render(genesis → head) is the LONGEST fold — the whole
// chain from its first mark, the creation story.
//
// chain / fold, NOT be / is (Tabor): the CHAIN is the trail (the past, laid, sealed); the FOLD is the
// read into the present (the view/face). Book-sharing chooses the parts: scope × span (since/until) ×
// the lens (the view).
//
// THE BRANCH IS NEVER DEFAULTED. A read is always OF a branch (the `history`); callers thread their
// own (people read different branches). There is no `getDefaultBranch` and we never pin "0" — a read
// with no branch is a bug, so requireHistory throws. (Tests may pass "0" explicitly; library code
// threads.)
//
// SCOPE: "world" is the whole story — every fact in the branch, across ALL reel-kinds
// (being · space · matter · name · library), all authors, read in chain order. The convergence
// (reality=chain, place=fold, world=agreement among folds). It is NOT a single chain: a single chain
// is one being's / space's / matter's thread (scope "being" or "space"). render(genesis → head) is
// the world read.

import { assembleStory } from "./assemble.js";

// A read is always of a branch. Never default to a pin; thread the caller's branch.
function requireHistory(history) {
  const h = history == null ? "" : String(history).trim();
  if (!h) {
    throw new Error(
      "read-trail: a branch (history) is required — thread the caller's branch; never default to a pin like \"0\"",
    );
  }
  return h;
}

// ── THE LENSES: one facet per fact (the column you pull as you walk) ───────────────────────────────
// Each fact carries every facet; the lens selects which to report (623/7). what=genesis/kind,
// where=place, who=signer, when=order, how=THE ACT, why=THE ON-LINK. how and why are DISTINCT columns:
// how is the act that did it (f.act); why is the parent fact it was laid on (f.p, the prev on the
// reel). Names resolved from the slots (resolveNamesLite).
const LENSES = {
  what:  (f, n) => `${f.of?.kind || "thing"}${f.of?.id ? ` ${n(f.of.id)}` : ""}`,            // its identity / birth
  where: (f, n) => placeOf(f, n),                                                              // the place it happened
  who:   (f, n) => n(f.through || f.by),                                                       // the signer / actor
  when:  (f)    => (f.seq != null ? `#${f.seq}` : (f.date ? new Date(f.date).toISOString() : "?")), // order down the chain
  how:   (f)    => f.act || f.verb || "?",                                                     // the act that did it (the do)
  why:   (f)    => (f.p ? `on ${shortId(f.p)}` : "(genesis)"),                                 // the on-link: the parent fact it was laid on (623/7)
};
export const LENS_NAMES = Object.keys(LENSES); // what · where · who · when · how · why

function shortId(id) { return String(id).slice(0, 8); }
function placeOf(f, n) {
  const p = f.params || {};
  if (p.to) return n(p.to);
  if (typeof p.value === "string" && f.params?.field === "position") return n(p.value);
  if (f.of?.kind === "space" && f.of?.id) return n(f.of.id);
  return "?";
}

// ── Half B: the lens views as WORDS (623/12 / all-rules-fold — no in-code registry) ────────────────
// A lens is a recall VIEW (recall.word: "a view is a granted word"). Retire the hardcoded LENSES map
// by folding each view as a word — kind:"view", carrying its column-puller by a HOST-HANDLER ref (the
// puller is JS that can't serialize as a fact, the bottom turtle — the SAME proven shape as reducers,
// declareReducersToFold). The LENSES map above stays as the SOURCE + the boot buffer; once declared,
// readTrail reads the puller from the fold first. (`can recall <view>` gating = B2, a separate step.)

// declareViewsToFold — coin the 6 views onto the fold at genesis (called from wordFold.seedFold).
// `history="0"` is the heaven seed-vocabulary pin (deliberate, like the sibling declarers); seedFold
// passes the boot history explicitly.
export async function declareViewsToFold({ moment = null, history = "0" } = {}) {
  const { registerHostHandler, bindWord } = await import("../word/wordStore.js");
  let n = 0;
  for (const name of LENS_NAMES) {
    registerHostHandler(`view:${name}`, LENSES[name]);
    await bindWord(
      name,
      { kind: "view", recall: true, render: { ref: `view:${name}` } },
      { moment, history, skipIfUnchanged: true },
    );
    n++;
  }
  return n;
}

// resolveViewFromFold — the lens column-puller FROM the fold. Null when unbound or not a view; the
// caller falls back to the LENSES map (the boot buffer) until the fold is declared.
export async function resolveViewFromFold(name) {
  const { getWordSync, resolveHostHandler } = await import("../word/wordStore.js");
  const w = typeof getWordSync === "function" ? getWordSync(name) : null;
  if (!w || w.kind !== "view" || !w.render?.ref) return null;
  const fn = resolveHostHandler(w.render.ref);
  return typeof fn === "function" ? fn : null;
}

// ── reading the facts of a span (a lens × a window), in chain order ────────────────────────────────
// Self-contained so the lens path does not depend on assembleStory's internals; the narrative path
// (no lens) still delegates to assembleStory so its weave/pastPhrase stay the one source of glossing.
// scope "world" → no filter (every reel-kind, every author); "being"/"space" → a single chain.
async function readSpanFacts({ history, scope = "world", since = null, until = null, being = null, space = null }) {
  // The CROSS-REEL / WORLD fact read, now through the curated facts.js seam:
  // every fact on a history across ALL reel-kinds (scope "world"), or a being's
  // facts by author-OR-actor (through OR by), or a space's facts by of.id,
  // date-ranged and date-sorted. facts.getHistoryFacts unions every reel of the
  // history (fileStore.listReelKinds + listReelIds → readReel — the cross-reel
  // scan) and applies the caller's predicate + sort in JS; we build the window
  // + scope filter here and the ordering (world = date then seq; single-reel =
  // seq then date).
  const h = requireHistory(history);
  const sinceMs = since != null ? (since instanceof Date ? since.getTime() : new Date(since).getTime()) : null;
  const untilMs = until != null ? (until instanceof Date ? until.getTime() : new Date(until).getTime()) : null;
  const wantBeing = being != null ? String(being) : null;
  const wantSpace = space != null ? String(space) : null;
  const predicate = (f) => {
    // date window: since is exclusive ($gt), until inclusive ($lte)
    if (sinceMs != null || untilMs != null) {
      const t = f?.date != null ? Date.parse(f.date) : NaN;
      if (Number.isNaN(t)) return false;
      if (sinceMs != null && !(t > sinceMs)) return false;
      if (untilMs != null && !(t <= untilMs)) return false;
    }
    // scope: a being's facts (author OR actor), a space's facts (target of.id)
    if (scope === "being" && wantBeing) {
      return String(f.through ?? "") === wantBeing || String(f.by ?? "") === wantBeing;
    }
    if (scope === "space" && wantSpace) {
      return String(f.of?.id ?? "") === wantSpace;
    }
    return true; // "world" — every reel-kind, every author
  };
  // A single-reel scope (a being's act-chain, a space's reel) is ordered by the CHAIN — seq, never
  // the clock. "world" spans concurrent reels with no single seq, so date presents the concurrent
  // facts (time as content, for presentation; not as truth-order).
  const sort = scope === "world"
    ? (a, b) => {
        const ad = a?.date != null ? Date.parse(a.date) : 0;
        const bd = b?.date != null ? Date.parse(b.date) : 0;
        return ad !== bd ? ad - bd : (a?.seq ?? 0) - (b?.seq ?? 0);
      }
    : (a, b) => {
        const as = a?.seq ?? 0;
        const bs = b?.seq ?? 0;
        if (as !== bs) return as - bs;
        const ad = a?.date != null ? Date.parse(a.date) : 0;
        const bd = b?.date != null ? Date.parse(b.date) : 0;
        return ad - bd;
      };
  const { getHistoryFacts } = await import("../../past/fact/facts.js");
  return getHistoryFacts(h, { predicate, sort });
}

// id -> a readable name, resolved once per read from the live slots (being/space/matter). Falls back
// to a short id. (A lite, self-contained resolve — does not touch assemble.js's resolveNames.)
async function resolveNamesLite(facts, history) {
  const ids = new Set();
  for (const f of facts) {
    if (f.by) ids.add(String(f.by));
    if (f.through) ids.add(String(f.through));
    if (f.of?.id) ids.add(String(f.of.id));
    if (f.params?.to) ids.add(String(f.params.to));
  }
  const { loadOrFold } = await import("../../materials/projections.js");
  const names = {};
  await Promise.all([...ids].map(async (id) => {
    for (const kind of ["being", "space", "matter"]) {
      try {
        const slot = await loadOrFold(kind, id, history);
        const nm = slot?.state?.name || slot?.name;
        if (nm) { names[id] = nm; return; }
      } catch { /* try next kind */ }
    }
    names[id] = shortId(id);
  }));
  return (id) => (id == null ? "" : (names[String(id)] || shortId(id)));
}

// ── readTrail — render(span, lens): the chosen span of the trail, read through a facet ──────────────
// No lens → the narrative book (assembleStory's weave: an array of act-lines). A lens → an ordered
// array of { seq, value } — that one facet, walked down the trail. Book-sharing passes scope + since/
// until + lens to get exactly the parts it wants. `history` (the branch) is REQUIRED.
export async function readTrail({
  history,        // the branch — required; threaded by the caller, never defaulted
  scope = "world",
  lens = null,    // null → the full word (narrative); else what/where/who/when/how/why (a facet/view)
  since = null,   // the span window's start (a Date) — narrows the recall to facts after it
  until = null,   // the span window's end (a Date)
  being = null,
  space = null,
  moment = null,
} = {}) {
  const h = requireHistory(history);
  if (!lens) {
    // the full read: the narrative story (every fact folded to its whole word, in chain order)
    const book = await assembleStory(scope, { history: h, since, being, space, moment });
    if (!until) return { kind: "story", lens: null, book };
    const end = until instanceof Date ? until : new Date(until);
    return { kind: "story", lens: null, book: book.filter((a) => a.date && new Date(a.date) <= end) };
  }
  // fold-first: the view-word's puller from the fold (Half B), else the LENSES map (the boot buffer)
  const pick = (await resolveViewFromFold(lens)) || LENSES[lens];
  if (!pick) throw new Error(`read-trail: unknown lens "${lens}" — one of ${LENS_NAMES.join(" / ")}`);
  const facts = await readSpanFacts({ history: h, scope, since, until, being, space });
  const name = await resolveNamesLite(facts, h);
  // one facet per fact, in chain order — the lens "actually filters" to the column you asked for
  return { kind: "lens", lens, facets: facts.map((f) => ({ seq: f.seq, value: pick(f, name) })) };
}

// the weave's act-lines set end to end: the narrative the full read hands back (no sentence stored)
export function bookToText(book) {
  return (Array.isArray(book) ? book : []).map((a) => a && a.line).filter(Boolean).join(" ");
}

// a lens read set end to end: the facet column, walked down the trail
export function lensToText(facets) {
  return (Array.isArray(facets) ? facets : []).map((x) => x && x.value).filter(Boolean).join(" · ");
}

// render(span, lens) as text — the shareable book for any lens (narrative when no lens)
export async function renderTrailText(opts = {}) {
  const r = await readTrail(opts);
  return r.kind === "story" ? bookToText(r.book) : lensToText(r.facets);
}

// renderGenesis — render(genesis → head): the whole history read from its first mark, on the GIVEN
// branch. The longest read; the creation story. "A chain of being, read from its own first mark, can
// only say one thing about where it came from." `history` (the branch) is required — people read
// different branches; there is no default. Returns the narrative text + the structured book.
export async function renderGenesis(history) {
  const r = await readTrail({ history: requireHistory(history), scope: "world" });
  let text = bookToText(r.book);
  // The conversion board, at the bottom of the read (Tabor: the count goes in the genesis
  // render itself). The law: two states, never three — word-SOLE = the word is the only
  // path; pure-JS = a JS handler still stands behind it (mirror or not = zero progress).
  // Loud on purpose: word-SOLE is the number that must climb, a mirror earns nothing. A
  // meta-line, set off from the Word by the dashes.
  try {
    const { tallyConversion } = await import("../../ibp/operations.js");
    const t = tallyConversion();
    text += `\n\n— ${t.wordSole} word-SOLE · ${t.pureJS} pure-JS · ${t.total} ops —`;
  } catch {
    /* the op registry isn't loaded in this read (some harnesses) — omit the board */
  }
  return { text, book: r.book };
}

// ── the target decides the mode (623/12.md), NOT a call/recall verb ─────────────────────────────────
// The quotes are the do; the address is the only modifier. Self-target (a bare quote, or `I` — the
// signer) → THIS fold (readTrail on your own chain). Other-target (a named being) → await across the
// boundary (the call/await path, not this). The parser/evaluator derive the target from the address
// (default = the signer, inherited from the stamp's signature) and the lens from the interrogative
// inside the quote, then route here for self / to await for other. readTrail lays no fact — folding the
// past is a see. The branch is the reader's own, threaded, never defaulted.
//
// LANDED (engine, 623/12): the parser parses `[address] "quote"` → ONE `call` node; evalCall routes
// off the target — self / `of`:null → foldSelf → readTrail (this file), a named other → the await path
// (callVerb, untouched). CALL is the one verb; recall = call-to-self; the mode is never declared. The
// .word ONTOLOGY (call.word/recall.word) is the verb lane's lean rebuild — the contract between lanes
// is the `call` node shape `{of, saying, lens?, bind?}` + the lens names (the five columns).
