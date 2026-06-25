// A minimal Word parser (Phase 3 skeleton): constrained-English prose -> IR.
//
// Template-matching over the sentence forms the slices use, the larval form of
// the recursive-descent grammar 2.md calls for. Proves the round-trip (write
// real `.word`, parse to the clause-grained IR of 5.md, run it) so we can stop
// hand-building IR. Grow it by adding templates, then replace with a real
// grammar. Surface order is presentation; it emits the same IR the hand-built
// slices do.
//
// Forms covered:
//   structure    A X is a space.            A X is a able for a Y.
//   start        The X begins at Y.                          (names the state dimension + first value)
//   single flow  When it is X, the R Vs, and it becomes Y.   (wheel phase — rule 12)
//                When it is X, the R Vs the O.               (rider — rule 6)
//                When a E happens, the R Vs (the O).         (derived-event watch — harmony)
//   derivation   When the R Vs the O, that is a E.           (this act counts as event E)
//   MULTI-EFFECT FLOW (the leverage form, blocks 7/8 slices): a `:`-terminated
//   header followed by an indented body of effect lines that fire together —
//     When Cherub births a being, with a name and a password:
//       make a home space.
//       form the being under a new Name.
//       ...
//   The header is a trigger (a summon-fired act, or a state); the body lines are
//   the effects (acts). The engine already loops a flow's effects; this is the
//   parser learning to GROUP the header with its indented body.

// ── THE host: FLOOR — a NAMED CLOSED SET, not "any fn()" ──────────────────────
//
// The host: escape is the one place a .word reaches into JS. The doctrine kills the host: false-
// category everywhere else (reads = see-verbs, writes = set-verbs); the genuine floor is the CRYPTO
// + SESSION/TRANSPORT strand that cannot serialize as a fact. This is the exact set the .word corpus
// uses today (grep `host:\s*\w+\(` over story/**.word): the cherub-connect flow (the connect-time
// being/name candidate walk + father/displacement session logic, which the transport layer owns) and
// the key/credential crypto (token minting, password verification). An UNKNOWN host: fn is rejected
// (see the EFFECT_RULES host: rule) so the door stays shut. Add a name here ONLY for a genuine new
// crypto/transport floor primitive, deliberately, in the open.
const HOST_FLOOR = new Set([
  // crypto (minting / verification — cannot be a fact)
  "generateToken",
  "generateInheritToken",
  "verifyPassword",
  // session / transport (the connect-time being/name walk the transport layer owns)
  "searchByName",
  "findBeingCandidatesByName",
  "extractTargetName",
  "fatherMatch",
  "selectCandidate",
  "displaceInhabitor",
  "driverTrueNameForFather",
  "driverTrueNameForbeing",
]);

// ── THE SEE FLOOR — the twin of HOST_FLOOR, for the see-op door ───────────────
//
// A see-op (`see <op>(args) as v`, or the inline predicate form `<op>(args)` in a cond) reaches a
// host-backed READ/COMPUTE through the able's see-op registry (ctx.env.host). The verb IS the nature:
// a see lays NO fact — it is a perception (a substrate read) or a pure compute (an output sensed from
// inputs). That inertness is the whole contract, so the door must be as CLOSED as HOST_FLOOR's: not
// "any op()" but the EXACT set the .word corpus dispatches via the see path today (the IR walk over
// story/**.word: node.act for the block form, cond.seeCall for the inline predicate). An UNKNOWN
// see-op is REJECTED (the twin of the host: guard) so a noun-read cannot be invented unannounced.
//
// THE BOUNDARY (why these and not the action-sees): the kept names READ/COMPUTE and stamp NO fact —
// validations (validate-render-block, valid-*), resolves/computes (resolve-source, resolve-birth-spec,
// owner-of, find-being-parent, story-root), crypto/credential reads (load-key, read-credential,
// mint-credential, paper-form), pointer/connection reads, and the inline presence predicates
// (missing/exists/lives-on/grabbable …). The ACTION-sees — the ops that run for their EFFECT and lay
// a fact (write-model, clear-model: 17.md's see=inert correction) — are NOT here: they were re-typed
// `do <op>(args)` (the do-op escape rule), so they leave the see path entirely and never reach this
// set. Add a name here ONLY for a genuine new perception/compute, deliberately, in the open; an op
// that changes the world is a `do`, not a `see`.
const SEE_FLOOR = new Set([
  // validations / shape + name checks (pure compute, no fact)
  "validate-render-block",
  "valid-canonical",
  "valid-pointer-name",
  "valid-address",
  "valid-key",
  "valid-namespace",
  // resolves / lookups (a substrate read or a derive from inputs)
  "resolve-source",
  "resolve-birth-space",
  "resolve-birth-spec",
  "delegate-spec",
  "findByName",
  "resolve-connection",
  "resolve-connection-removal",
  "resolve-connection-update",
  "resolve-containing-space",
  "resolve-model-block",
  "resolve-name-id",
  "resolve-rename-spec",
  "resolve-set-being-spec",
  "resolve-set-being-flow-spec",
  "resolve-set-space-spec",
  "resolve-set-matter-spec",
  "resolve-end-matter-spec",
  "resolve-end-space-spec",
  "resolve-inheritation",
  "resolve-slot-assignment",
  "resolve-llm-config",
  "resolve-share-book-spec",
  "resolve-target-being",
  "owner-of",
  "space-id-of",
  "find-being-parent",
  "find-pointers-space-id",
  "read-pointers",
  "story-root",
  "asked-policy",
  "parse-signal-value",
  "resolve-config-set",
  "resolve-config-delete",
  "resolve-purge",
  "valid-able-name",
  "valid-able-cognition",
  "able-registered",
  "able-deletable",
  "able-blocks-delete",
  "author-able",
  "remove-able",
  // able / authority reads (the grant gates' perceptions, NOT the grant itself)
  "able-spec-for-grant",
  "able-request",
  "grant-internal",
  "grant-stamp",
  "may-set-model",
  // pointer / signal / connection writes the corpus still speaks as see-ops (host-backed)
  "set-pointer-map",
  "delete-pointer-map",
  "signal-fact",
  // federation send-side floor reads (federationManagerHost.js, the word-SOLE ops): a host READ +
  // COMPUTE that captures a template/graft bundle, computes its hash, mints the negotiationId, reads
  // the incoming offer/request record, and BUILDS the { field, value } write list. Lays NO fact (the
  // ops' .word fans the writes out as do:set-being deeds), so it is see-shaped, like resolve-llm-config.
  "resolve-federation-spec",
  // the cross-story membrane out: a call to a peer story, carried by crossStoryDispatch (verb:call).
  // Irreducible transport (federation reaches another story), so it lives behind a sanctioned floor.
  "dispatch-federation-intent",
  // crypto / credential reads (minting / key reads — cannot be a fact, see-shaped)
  "load-key",
  "read-credential",
  "mint-credential",
  "reel-head-of",
  "paper-form",
  // inline PRESENCE / domain predicates (the `If <op>(args)` cond form — a live check, no bind, no fact)
  "able-exists",
  "already-holds",
  "being-lives-on",
  "destination-missing",
  "destination-paused",
  "has-address",
  "has-heaven-authority",
  "is-grabbable",
  "is-reserved-pointer",
  "may-remove-owner",
  "may-set-owner",
  "name-banished",
  "name-exists",
]);

// ── THE METACIRCULAR HOOK: the grammar reads (some of) its rules from the Word ──
//
// "The verse and the parser are the same thing" (Tabor): a grammar rule is a Word, not host
// machinery. parse() stays SYNC (5+ sync call sites, zero `await parse`); the fold's read path is
// sync too (getWordSync = a Map read; resolveHostHandler = a Map.get), so consulting it here is safe.
//
// THE FLOOR BOUNDARY (9.md §2 two-face — so no one mistakes the proof for more than it is): the
// rule's STRUCTURE (kind, the emitted node-shape) is LIFTED data, read from the fold below; the
// regex-MATCHER is a host AXIOM behind a ref, registered by grammarFold.declareGrammarRulesToFold
// and resolved here. "Declared in Word for self-description, run by the kernel for behavior." Only
// the top-level RULES table consults the fold (apply scopes it); EFFECT_RULES is never consulted.
// FOLD-FIRST, fall-through: an EMPTY fold (pre-boot, or the many parser tests that import parse()
// without booting genesis) falls straight through to the hardcoded RULES = identical old behavior.
import { getWordSync, resolveHostHandler } from "./wordStore.js";

const GRAMMAR_RULE_WORDS = ["owns-rule", "i-am-rule"]; // the lifted set — explicit, tiny

// foldRules — read each lifted rule-word from the live projection. Skip unless it is a kind:"rule"
// word with a parse.ref whose host matcher resolves. Returns [word, matcherFn] pairs (empty pre-boot).
function foldRules() {
  const out = [];
  for (const name of GRAMMAR_RULE_WORDS) {
    const w = getWordSync(name);
    if (!w || w.kind !== "rule" || !w.parse?.ref) continue;
    const matcher = resolveHostHandler(w.parse.ref);
    if (typeof matcher === "function") out.push([w, matcher]);
  }
  return out;
}

// buildFromFoldRule — turn a fold rule's match into its node: deep-clone w.node, substituting any
// string value "$N" with the capture m[N]. i-am has no captures (a literal clone); owns substitutes
// m[1]/m[2]. One builder, both rules — the substitution path is what i-am alone could not prove.
function buildFromFoldRule(w, m) {
  const sub = (v) => {
    if (typeof v === "string") {
      const cap = v.match(/^\$(\d+)$/);
      return cap ? m[Number(cap[1])] : v;
    }
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) o[k] = sub(v[k]);
      return o;
    }
    return v;
  };
  return sub(w.node);
}

// ── single-line forms (top level: declarations + one-line flows) ──────────────
const RULES = [
  // structure / kinds (rule 8). A name is a SINGLE TOKEN (letters/digits/hyphen/
  // dot/underscore, no spaces) — matches the substrate's BEING/SPACE/SEED name
  // regexes. So `music-room`, not `music room`; the grammar rejects spaces.
  [
    /^A ([\w.-]+) is a space\.$/i,
    (m) => ({ kind: "is", subject: m[1], isA: "space" }),
  ],
  [
    /^A ([\w.-]+) is a able for a ([\w.-]+)\.$/i,
    (m) => ({ kind: "is", subject: m[1], isA: "able", scope: m[2] }),
  ],

  // capability grant / prohibition (rules 8, 14) — declarations the evaluator
  // treats as LAW (the parser captures them; the engine's able/capability model
  // enforces them, incl. prohibition precedence). "A member can back a proposal."
  [
    /^A (\w+) can (\w+)(?: (?:a |an |the )?(.+?))?\.$/i,
    (m) => ({ kind: "can", able: m[1], verb: verb(m[2]), of: m[3] || null }),
  ],
  [
    /^A (\w+) cannot (\w+)(?: (?:a |an |the )?(.+?))?\.$/i,
    (m) => ({
      kind: "cannot",
      subject: m[1],
      verb: verb(m[2]),
      of: m[3] || null,
    }),
  ],
  // "No member can back it." (a flat prohibition — rule 14)
  [
    /^No (\w+) can (\w+)(?: (?:a |an |the |it ?)?(.+?))?\.$/i,
    (m) => ({
      kind: "cannot",
      subject: m[1],
      verb: verb(m[2]),
      of: m[3] || "it",
    }),
  ],

  // possession + structure relations (rule 2) + able inheritance. Declarations
  // the engine reads as law (state, not acts). "A commons contains proposals
  // and a roster." / "A steward extends member." / "I own the music room."
  [
    /^A ([\w.-]+) contains (.+)\.$/i,
    (m) => ({
      kind: "contains",
      subject: m[1].toLowerCase(),
      items: splitItems(m[2]),
    }),
  ],
  [
    /^A ([\w.-]+) extends ([\w.-]+)\.$/i,
    (m) => ({
      kind: "extends",
      able: m[1].toLowerCase(),
      parent: m[2].toLowerCase(),
    }),
  ],
  [
    /^(I|[A-Z][\w.-]*) owns? (?:the |a |an )?([\w.-]+)\.$/,
    (m) => ({ kind: "owns", subject: m[1], of: m[2] }),
  ],

  // single-effect wheel phase / rider (state-watch) — rules 6, 12
  [
    /^When it is (\w+), the (\w+) (\w+), and it becomes (\w+)\.$/i,
    (m, c) =>
      stateFlow(
        c.stateVar,
        m[1],
        stateAct(m[2], verb(m[3]), null, { [c.stateVar]: m[4] }, c),
      ),
  ],
  [
    /^When it is (\w+), the (\w+) (\w+) the (\w+)\.$/i,
    (m, c) =>
      stateFlow(c.stateVar, m[1], stateAct(m[2], verb(m[3]), m[4], null, c)),
  ],

  // derived-event flow (harmony)
  [
    /^When a (\w+) happens, the (\w+) (\w+) the (\w+)\.$/i,
    (m, c) => eventFlow(m[1], eventAct(m[2], verb(m[3]), m[4], c)),
  ],
  [
    /^When a (\w+) happens, the (\w+) (\w+)\.$/i,
    (m, c) => eventFlow(m[1], eventAct(m[2], verb(m[3]), null, c)),
  ],

  // property / attribute declarations on a kind (the #4 gap; forward structure
  // the engine reads as law). "A space has an owner, a being." / "may have".
  [
    /^A (\w+) (has|may have) (.+?)(?:, (.+))?\.$/i,
    (m) => ({
      kind: "has",
      subject: m[1].toLowerCase(),
      optional: /may/i.test(m[2]),
      property: stripArticle(m[3]),
      gloss: m[4] ? m[4].trim() : null,
    }),
  ],
  // a matter type's content / ops / classification claims (the registry vocabulary).
  // A kind stays lowercase with its article ("A model") or is named by a reference
  // ("It", the last-declared kind); NEVER bare-capitalized like a Name (rules 5, 10).
  // No bare-subject form, so the grammar itself enforces the rule.
  [
    /^A (\w+) (accepts|carries|claims) (.+)\.$/i,
    (m) => ({
      kind: m[2].toLowerCase(),
      subject: m[1].toLowerCase(),
      items: splitItems(m[3]),
    }),
  ],
  [
    /^[Ii]t (accepts|carries|claims) (.+)\.$/i,
    (m, c) => ({
      kind: m[1].toLowerCase(),
      subject: c.lastSubject || null,
      items: splitItems(m[2]),
    }),
  ],

  // generic kind declaration — LAST so the specific `is a space` / `is a able
  // for a Y` rules win their shapes first. "A generic is a matter type."
  [
    /^A ([\w.-]+) is a (.+?)\.$/i,
    (m) => ({ kind: "is", subject: m[1].toLowerCase(), isA: m[2] }),
  ],

  // I's genesis acts (the LIFE register — acts performed in sequence, not law
  // or a watch; rule 9, "I" is the Name). Rendered forward from the root, this is
  // the creation story. Rule 19 disambiguates "I make X": a Capital X is a being
  // (birth it); a lowercase X is a space (create it).
  [
    // the genesis line is now the QUESTION, not the loop: existence, the quoted recall ("what?"),
    // existence answered — `I am "what?" I am.` (matches iam.word). The `I` is the sign, by: "I".
    /^I am "what\?" I am\.$/i,
    () => ({ kind: "act", verb: "name", act: "i-am", by: "I" }),
  ],
  [
    /^I make ([A-Z][\w.-]*)(?:, (.+?))?\.$/,
    (m) => ({
      kind: "act",
      verb: "be",
      act: "birth",
      by: "I",
      of: { kind: "being", id: m[1] },
      params: {
        able: m[1].toLowerCase(),
        ...(m[2] ? { description: m[2] } : {}),
      },
    }),
  ],
  [
    /^I make (?:the )?([a-z][\w.-]*)(?:, (.+?))?\.$/,
    (m) => ({
      kind: "act",
      verb: "do",
      act: "create-space",
      by: "I",
      of: { kind: "space", id: m[1] },
      ...(m[2] ? { params: { gloss: m[2] } } : {}),
    }),
  ],
  [
    /^I stand in (?:the )?([\w.-]+)\.$/i,
    (m) => ({
      kind: "act",
      verb: "do",
      act: "move",
      by: "I",
      of: { kind: "space", id: m[1] },
    }),
  ],

  // a transfer with a RECEIVER (rule 17): the `to` is the being it hands to.
  // "I give the drum to Claude." (Claude is a being — Capital, rule 19.) The
  // receiver is a property on the DO act, not a fourth noun. NOTE: the evaluator
  // does not yet carry `to` into the emitted fact (a 1-line engine follow-up);
  // the parse is complete.
  [
    /^I give the ([\w.-]+) to ([A-Z][\w.-]*)\.$/,
    (m, c) => ({
      kind: "act",
      verb: "do",
      act: "give",
      by: "I",
      of: objRef(m[1], c),
      to: m[2],
    }),
  ],
];

// ── effect (body) forms: the imperative acts inside a multi-effect flow ───────
// Each emits one act node. `c.subject` is the flow's actor (the header's Being),
// the default `by` when an effect names no actor of its own.
const EFFECT_RULES = [
  // explicit-actor acts (also usable as a single-effect body): the sun forms
  [
    /^the (\w+) (\w+), and it becomes (\w+)\.$/i,
    (m, c) => stateAct(m[1], verb(m[2]), null, { [c.stateVar]: m[3] }, c),
  ],
  [
    /^the (\w+) (\w+) the (\w+)\.$/i,
    (m, c) => stateAct(m[1], verb(m[2]), m[3], null, c),
  ],

  // The cherub birth acts. THE IMPLICIT-ACTOR RULE: an unqualified act inside a
  // flow is by the Name ("I", resolved to the acting Name) THROUGH the flow's
  // being (here Cherub, the mother). So all five are I acting through Cherub.
  // The new being is the NEW NAME's own (its trueName), not I's; Cherub is the
  // mother, Arrival (the new Name's being at the floor) is the father. This is
  // what _registerHumanWithFreshHome assumed silently, now in the open.
  // "make a home space." -> do:create-space under the place root (the parent),
  // binding the CREATED space's id as `home` (create-space mints its own child id
  // and returns { spaceId }; the home's parent is the target).
  [
    /^make a (\w+) space\.$/i,
    (m, c) => ({
      kind: "act",
      verb: "do",
      act: "create-space",
      by: "I",
      through: c.being,
      bind: m[1].toLowerCase(),
      of: { kind: "space", ref: "placeRoot" },
      params: { name: "$name", type: "home-territory" },
    }),
  ],
  // "form the being as the new Name's own." -> be:form-being -> birthBeing.
  // The being expresses the new (arriving) Name: trueName = the new Name.
  [
    /^form the being as the new Name's own\.$/i,
    (m, c) => ({
      kind: "act",
      verb: "be",
      act: "form-being",
      by: "I",
      through: c.being,
      bind: "child",
      params: {
        name: "$name",
        password: "$password",
        cognition: "human",
        defaultAble: "human",
        parentBeingId: c.being,
        homeId: "$home",
        trueName: "$ownerName",
      },
    }),
  ],
  // GENERIC FORM-BEING (self-stamped — NOT through a mother): "form a being with { <spec> }." /
  // "form a being with $spec." -> be:form-being. The being SELF-STAMPS its be:birth (through = the
  // new being, set inside birthBeing); the node's `through:"self"` is a TRUTHFUL marker, inert at the
  // fact (evalAct's form-being branch ignores `through`). DISTINCT from the cherub literal above
  // (article `a` + the required `with`, no "as the new Name's own" tail — the two regexes cannot both
  // match). The seed-delegate births in genesis.word speak this: the I makes its delegates directly,
  // parented to the I. Cherub's mate-flow + birther's child-flow WRAP this primitive.
  // (PARSER SELF-HOSTING LANE — additive EFFECT_RULE, invisible to the metacircular foldRules; meant
  // to SUBSUME the cherub literal once that flow moves to call:mate. Flag for the grammar-fold owner.)
  [
    /^form a being with (\{.*\}|\$[\w.-]+)(?:\s+as\s+([\w-]+))?\.$/i,
    (m) => ({
      kind: "act",
      verb: "be",
      act: "form-being",
      by: "I",
      through: "self",
      bind: m[2] || "child",
      params: m[1].startsWith("{")
        ? parseObjectLiteral(m[1])
        : { ref: refKey(m[1].slice(1)) },
    }),
  ],
  // "make the being the home's owner." -> do:set-space owner = the new being
  [
    /^make the being the (\w+)'s owner\.$/i,
    (m, c) =>
      beingAct(
        c,
        "do",
        "set-space",
        { kind: "space", ref: m[1].toLowerCase() },
        { field: "owner", value: "$child" },
      ),
  ],
  // "grant the being the human able." -> do:grant-able
  [
    /^grant the being the (\w+) able\.$/i,
    (m, c) =>
      beingAct(
        c,
        "do",
        "grant-able",
        { kind: "being", ref: "child" },
        { able: m[1], anchorSpaceId: "$placeRoot" },
      ),
  ],
  // "record the being's lineage." -> do:set-being qualities.lineage (mother Cherub, father Arrival)
  [
    /^record the being's lineage\.$/i,
    (m, c) =>
      beingAct(
        c,
        "do",
        "set-being",
        { kind: "being", ref: "child" },
        {
          field: "qualities.lineage",
          value: { mother: c.being, father: "Arrival" },
        },
      ),
  ],

  // §7 host escape: "host: searchByName(name) as candidates." -> an act that calls a
  // host builtin and binds its result (the session/transport strand stays host; this is
  // how the .word reaches it). evalAct runs act.host via callHost + binds act.bind.
  //
  // CLOSED SET (the door the wart used to reach into JS, now shut): the floor is NOT "any host: fn()".
  // The doctrine kills the host: false-category everywhere else (reads are see-verbs, writes are
  // set-verbs); the only genuine floor escapes are the CRYPTO + SESSION/TRANSPORT strand that cannot
  // be a fact — key/token minting, password verification, and the connect-time being/name candidate
  // walk that the session layer owns. So this rule is restricted to the NAMED set actually used in
  // the corpus (the cherub-connect flow + key/credential ops). An UNKNOWN host: fn is REJECTED with a
  // clear error (the twin of guardForward), shutting the door — a new floor escape must be added here
  // deliberately, in the open, never slipped through. (Grep of the .word corpus pins the set; if a
  // genuine new crypto/transport floor fn lands, add its name here with a one-word note on why.)
  [
    /^host:\s*(\w+)\(([^)]*)\)\s*(?:as\s+(\w+))?\.?$/i,
    (m) => {
      if (!HOST_FLOOR.has(m[1])) {
        throw new Error(
          `word parser: host: "${m[1]}" is not a recognized FLOOR escape. ` +
            `The host: door is a CLOSED SET — only crypto / session-transport primitives that cannot be a fact ` +
            `(${[...HOST_FLOOR].join(", ")}). A read is a see-verb, a write is a set-verb; a new floor escape must be ` +
            `added to HOST_FLOOR deliberately. (philosophy/word/9.md: the host shrinks to an irreducible bottom turtle.)`,
        );
      }
      return {
        kind: "act",
        verb: "do",
        act: m[1],
        host: m[1],
        params: { args: argList(m[2], "$") },
        ...(m[3] ? { bind: m[3] } : {}),
      };
    },
  ],

  // ── §5 mark + §7 control-flow terminators (inline body effects) ──────────────
  // a reflexive state-mark (§5): "the being is found." -> a flow-local flag a sibling
  // `if (no being was found)` reads (inferFlag canonicalizes both to one name).
  [
    /^the ([\w.-]+) (?:is|are|was|were) (\w+)\.$/i,
    (m) => ({
      kind: "mark",
      flag: inferFlag(`${m[1]} ${m[2]}`) || camelKey(`${m[1]} ${m[2]}`),
    }),
  ],
  // break (§3): halts the nearest foreach. "Cherub stops the search." / "stop."
  [/\bstops? the search\.$/i, () => ({ kind: "break" })],
  [/^stop\.$/i, () => ({ kind: "break" })],
  // refuse (§7): error halt, lays no fact. "Cherub refuses the connection with "X."" / "refuse with "X.""
  // optional `as <code>` carries the IBP error code (kebab → SCREAMING_SNAKE, e.g.
  // `as invalid-input` → INVALID_INPUT) so the cut maps the WordRefusal to the exact
  // IbpError the JS threw (default FORBIDDEN when absent). evalRefuse carries node.code.
  // `^(?!If\b)`: don't match a refuse buried in an inline `If <cond>, refuse …` — that
  // line is the inline-if's (below), which carries the condition; the bare consequence
  // `refuse with "…"` (no leading If) still matches here and inside parseInlineThen.
  [
    /^(?!If\b).*?\brefuses?\b.*?\bwith\s+"([^"]+)"(?:\s+as\s+([\w-]+))?\.?$/i,
    (m) => ({
      kind: "refuse",
      message: m[1],
      ...(m[2] ? { code: m[2].toUpperCase().replace(/-/g, "_") } : {}),
    }),
  ],
  // return (§7): success terminator. "Return the address, beingId, name, and seatHistory."
  // An item "key: value" is an extra kv (literal or flag ref): "Return token, owned: true."
  [
    /^Return (.+)\.$/i,
    (m) => {
      const values = [],
        extra = {};
      for (const it of splitItems(m[1])) {
        const kv = it.match(/^([\w][\w.-]*)\s*:\s*(.+)$/);
        if (kv) {
          const r = oper(kv[2]);
          extra[camelKey(kv[1])] =
            r.ref !== undefined ? { ref: r.ref } : r.value;
        } else values.push(camelKey(it));
      }
      return {
        kind: "return",
        values,
        ...(Object.keys(extra).length ? { extra } : {}),
      };
    },
  ],
  // inline if (§2): "If <cond>, X, and Y." -> { if, then:[X,Y] }. The HINGE between the
  // conditional frame and the consequence reads as a comma, `then`, or `→`/`->` — the same
  // separating work the colon does for the block form (`If <cond>:` + indent). A comma
  // immediately followed by `and`/`or` is a CONDITION connective ("If owner is X, and owner
  // is Y, refuse …"), NOT the hinge; an explicit `then`/`→` is always an unambiguous hinge.
  // The loose matcher just catches an `If …` effect line; splitInlineIf finds the hinge at
  // paren/brace/bracket/quote depth 0, so a comma INSIDE a see-op's args (`op(a, b)`) or a
  // `with { … }` object never mis-reads as the hinge (the as-removal: inline see-op conds).
  [
    /^If\s+(.+)\.$/i,
    (m, c) => {
      const split = splitInlineIf(m[1]);
      if (!split) return null; // no hinge: a malformed inline If (cannot-parse, fail loud)
      return {
        kind: "if",
        cond: parseCond(split.cond, c),
        then: parseInlineThen(split.then, c),
      };
    },
  ],
  // ── SEE: the READ verb (substrate query, NO fact). evalSee consumes `kind:"see"`.
  // The wall: reads are VERBS, not host: escapes (only crypto/computation stays host).
  // PREDICATE (being-tree): "see whether the caller is an ancestor of the candidate as asAncestor."
  [
    /^see whether (.+?) is an ancestor of (.+?) as (\w+)\.$/i,
    (m) => ({
      kind: "see",
      of: { ref: refKey(m[2]) },
      descendsFrom: { ref: refKey(m[1]) },
      bind: m[3],
    }),
  ],
  // or stated as descent: "see whether the child descends from the ancestor as isDesc."
  [
    /^see whether (.+?) descends from (.+?) as (\w+)\.$/i,
    (m) => ({
      kind: "see",
      of: { ref: refKey(m[1]) },
      descendsFrom: { ref: refKey(m[2]) },
      bind: m[3],
    }),
  ],
  // PREDICATE (authority walk): "see whether the caller has credential authority over
  // the target as authorized." → evalSee resolves `hasAuthorityOver` (the being-tree
  // authority fold), exactly as `descendsFrom` resolves via isAncestorOf. The `credential`
  // flag picks the being→being re-mint walk (hasCredentialAuthority); without it, the
  // name→being walk (hasAuthorityOver). Contract per the engine's evalSee.
  [
    /^see whether (.+?) has( credential)? authority over (.+?) as (\w+)\.$/i,
    (m) => ({
      kind: "see",
      of: { ref: refKey(m[1]) },
      hasAuthorityOver: { ref: refKey(m[3]) },
      ...(m[2] ? { credential: true } : {}),
      bind: m[4],
    }),
  ],
  // READ a quality fresh from the projection: "see the candidate's trueName as owner."
  [
    /^see the (.+?)'s (\w+) as (\w+)\.$/i,
    (m) => ({
      kind: "see",
      of: { ref: refKey(m[1]) },
      read: m[2],
      fresh: true,
      bind: m[3],
    }),
  ],
  // QUERY beings by name: "see the beings named $name as found." (plural → list; singular → one)
  [
    /^see the (\w+) named (.+?) as (\w+)\.$/i,
    (m) => ({
      kind: "see",
      of: m[1].replace(/s$/i, ""),
      where: { name: m[2].trim().replace(/^"|"$/g, "") },
      ...(/s$/i.test(m[1]) ? {} : { one: true }),
      bind: m[3],
    }),
  ],
  // SEE-OP call (the host:→see dissolution): "see mint-credential as credential" /
  // "see resolve-source(subject, to) as fromSpace". A registered see-op run as a VERB:
  // perception (a substrate READ) or a pure COMPUTE (perceiving an output from inputs) —
  // either way it lays NO fact, the verb IS the nature (no `do`, no tag). The op IS the
  // backing (crypto, a lookup, a walk). args optional + $-ref'd. The negative lookahead
  // keeps `see the …` (READ/QUERY) and `see whether …` (PREDICATE) on their own rules.
  [
    /^see\s+(?!the\b|whether\b)([\w-]+)(?:\(([^)]*)\))?\s+as\s+(\w+)\.?$/i,
    (m) => {
      // SEE_FLOOR guard (the twin of the host: floor): the see-op door is a CLOSED SET, not "any
      // op()". An UNKNOWN see-op is REJECTED so a noun-read cannot be invented unannounced; a new
      // perception/compute must be added to SEE_FLOOR deliberately. An op that changes the world is
      // a `do`, not a `see` (the action-see correction) — it never belongs in this set.
      if (!SEE_FLOOR.has(m[1])) {
        throw new Error(
          `word parser: see-op "${m[1]}" is not a recognized SEE FLOOR perception. ` +
            `The see-op door is a CLOSED SET — only host-backed READS / pure COMPUTES that lay NO fact ` +
            `(${[...SEE_FLOOR].join(", ")}). An op that changes the world is a \`do\`, not a \`see\`; a new ` +
            `perception/compute must be added to SEE_FLOOR deliberately. (philosophy/word/17.md: see is inert.)`,
        );
      }
      return {
        kind: "see",
        act: m[1],
        args: m[2] !== undefined ? argList(m[2], "$") : [],
        bind: m[3],
      };
    },
  ],

  // ── WRITE: the substrate write verb (THE WALL's write side) → do:set-<kind>.
  // TARGETED write (a BOUND entity, not the flow's being) + a literal or $-ref field (for
  // dynamic paths). "set the space historiesSpace's qualities.pointers to $next." /
  // "set the space root's $signalField to $value." The kind word picks set-being/space/matter.
  [
    /^set the (being|space|matter) ([\w-]+)'s (\$?[\w.]+) to (.+?)\.$/i,
    (m, c) => writeAct(c, m[1], m[3], m[4], undefined, m[2]),
  ],
  [
    /^replace the (being|space|matter) ([\w-]+)'s (\$?[\w.]+) with (.+?)\.$/i,
    (m, c) => writeAct(c, m[1], m[3], m[4], false, m[2]),
  ],
  // "set the being's password to $credential.hash." (the being; merge = op default, true)
  [
    /^set the (\w+)'s ([\w.]+) to (.+?)\.$/i,
    (m, c) => writeAct(c, m[1], m[2], m[3]),
  ],
  // "replace the being's qualities.auth with $fresh." (force a full replace, merge:false)
  [
    /^replace the (\w+)'s ([\w.]+) with (.+?)\.$/i,
    (m, c) => writeAct(c, m[1], m[2], m[3], false),
  ],
  // "merge $patch into the being's qualities.auth." (force merge:true)
  [
    /^merge (.+?) into the (\w+)'s ([\w.]+)\.$/i,
    (m, c) => writeAct(c, m[2], m[3], m[1], true),
  ],

  // ── CALL: reach another being (the fifth verb's SPATIAL face), Gen 2:16's two hinges.
  // evalCall resolves `of` (a {ref}, via getPath) to its stance, the caller to the `from`,
  // dispatches the summon machinery, and lays the reach as a fact through the stamper,
  // attributed to the caller. Surface verb `call`; the backing stays `summon` until the
  // rename. IR keys are the hinge words: `of` (target), `saying` (talk content, intent
  // defaults "message"), `to` (kebab intent, matched against canCall) + `with` (payload).
  //   talk (the quotative hinge): "call the owner, saying $request as queued."
  [
    /^call\s+(.+?),\s*saying\s+(.+?)(?:\s+as\s+(\w+))?\.?$/i,
    (m) => ({
      kind: "call",
      of: { ref: refKey(m[1]) },
      saying: valueExpr(m[2]),
      ...(m[3] ? { bind: m[3] } : {}),
    }),
  ],
  //   summon-to-act: "call the owner to able-request, with $found as queued." (with? optional)
  [
    /^call\s+(.+?)\s+to\s+([\w-]+)(?:,\s*with\s+(.+?))?(?:\s+as\s+(\w+))?\.?$/i,
    (m) => ({
      kind: "call",
      of: { ref: refKey(m[1]) },
      to: m[2].toLowerCase(),
      ...(m[3] !== undefined ? { with: valueExpr(m[3]) } : {}),
      ...(m[4] ? { bind: m[4] } : {}),
    }),
  ],

  // ── DO-OP ESCAPE (the action-see correction, 17.md): "do <escape>(args) [as <bind>]." The
  // twin of the see-op call (`see <op>(args) as v`) — SAME backing fn (ctx.env.host[escape]),
  // SAME {args} convention, SAME callHost dispatch — but typed `verb:"do"`, because the escape
  // runs for its EFFECT (it ENRICHES the op's params in place, the set-<kind> {field,value,merge}
  // shape the dispatcher's auto-fact reads), and a see must be inert (a noun-read lays nothing).
  // `write-model` is the canonical case: it mutates the closed-over params, so it is a `do`
  // wearing `see`; this surface types it right. It lays NO SEPARATE fact (the enrichment rides
  // the parent op's one auto-fact, exactly as the see form did) — evalAct runs act.host via
  // callHost and binds act.bind, no doVerb dispatch. The paren-args `(…)` is the discriminator
  // that splits this escape from the `on/with` doVerb dispatch rule below.
  [
    /^do\s+(?!the\b|a\b|an\b)([\w-]+)\(([^)]*)\)(?:\s+as\s+(\w+))?\.?$/i,
    (m) => ({
      kind: "act",
      verb: "do",
      act: m[1],
      host: m[1],
      params: { args: argList(m[2], "$") },
      ...(m[3] ? { bind: m[3] } : {}),
    }),
  ],

  // ── DO-OP call (the engine's answer 4): "do <op> [on <target>] [with <k>: <v>, …] [as
  // <bind>]." A registered op run as a verb through doVerb (it authorizes + stamps the fact
  // from ctx.params). `on <target>` names the acted-on entity (`the <kind> <ref>` or a bound
  // ref); `with` carries named params; `as` binds the result. For mutations the set/replace
  // write form cannot shape (a rich create-spec, a cross-being reach the op owns). The
  // lookahead keeps the generic `do the <obj>` SVO on its own rule below.
  [
    /^do\s+(?!the\b|a\b|an\b)([\w-]+)\s*(.*?)\.?$/i,
    (m, c) => doOpAct(m[1], (m[2] || "").trim(), c),
  ],

  // ── CALL via quote (623/12.md): `[address] "quoted word"`. The quotes ARE the do; the ADDRESS is
  // the only modifier — absent/self ⇒ FOLD your own chain (recall = CALL-to-self); a named other ⇒
  // AWAIT across the boundary. CALL is the ONE verb; the mode falls out of the target, never declared.
  // `saying` is the FULL quote (the message / the recall query); `lens` is the peeled interrogative
  // (the self-fold facet). Below every keyword rule (set/see/`call X,`/do…), ABOVE the SVO catch-all,
  // so only a bare `[address] "quote"` reaches it. evalCall routes self↔other off `of`.
  [
    /^(?:(.+?)\s+)?"([^"]*)"(?:\s+as\s+(\w+))?\.?$/i,
    (m) => {
      const saying = m[2];
      const { lens } = parseLens(saying);
      // A QUOTED WORD (623/12): the quote-marks are words too. evalQuotedWord lays the open-quote,
      // one `said` stamp per word (the spacebar splits them), and the close-quote . each its own
      // one-word moment on the caller's reel. The close sends (call) or folds your own chain
      // (recall). `saying` stays for the lens/recall query; `words` are the said-words to stamp.
      const words = String(saying).trim().split(/\s+/).filter(Boolean);
      return {
        kind: "quotedWord",
        of: parseAddress(m[1]),
        saying,
        words,
        ...(lens ? { lens } : {}),
        ...(m[3] ? { bind: m[3] } : {}),
      };
    },
  ],

  // generic acts (LAST, the catch-all): "<Subject> <verbs> the <obj>." (SVO) and
  // "<verb> the <obj>." (imperative, the flow's actor). Specific rules above win first.
  [
    /^([A-Z][\w.-]*) (\w+) (?:the|a|an) ([\w.-]+)\.$/,
    (m, c) => ({
      kind: "act",
      verb: "do",
      act: verb(m[2]),
      of: objRef(m[3], c),
      by: "I",
      through: m[1],
    }),
  ],
  [
    /^(\w+) (?:the|a|an) ([\w.-]+)\.$/i,
    (m, c) => ({
      kind: "act",
      verb: "do",
      act: verb(m[1]),
      of: objRef(m[2], c),
      by: "I",
      ...(c.being ? { through: c.being } : {}),
    }),
  ],
];

// ── headers (the trigger line of a multi-effect flow, ends with ":") ──────────
function parseHeader(line, c) {
  let m;
  // "When Cherub births a being, with a name and a password:" -> summon-birth flow
  if (
    (m = line.match(
      /^When (\w+) births a being(?: for a new Name)?(?:, with (.+))?:$/i,
    ))
  ) {
    c.being = m[1]; // the being the actor acts THROUGH (Cherub, the mother being)
    return {
      kind: "flow",
      when: { summon: { to: m[1], intent: "birth", of: { kind: "being" } } },
      binds: parseBinds(m[2]),
    };
  }
  // "When it is dawn:" -> a state-watch with a multi-effect body
  if ((m = line.match(/^When it is (\w+):$/i))) {
    c.being = null;
    return { kind: "flow", when: { state: { [c.stateVar]: m[1] } }, binds: [] };
  }
  // §0 op-trigger with a `with` bind clause: "When Cherub connects with a name and a password:"
  // The trigger's payload params bind into flow scope (downstream conds read them).
  if ((m = line.match(/^When (.+?) with (.+):$/i))) {
    c.being = null;
    return {
      kind: "flow",
      when: { op: { clause: m[1].trim() } },
      binds: parseBinds(m[2]),
    };
  }
  // §0 generic event trigger: "When a guest enters:" (a bare act-as-event, no `happens`)
  if ((m = line.match(/^When (.+):$/i))) {
    c.being = null;
    return { kind: "flow", when: { event: m[1].trim() }, binds: [] };
  }
  return null;
}

const DERIVE = /^When the (\w+) (\w+) the (\w+), that is a (\w+)\.$/i;
const START = /^The (\w+) begins at (\w+)\.$/i;

// FORWARD-LANGUAGE GUARD (the law/life boundary). Reasoning words — because /
// therefore / thus / hence / in order that — are the INWARD register: a
// conclusion MEANS, it does not act. The Word's forward register declares acts
// and flows (a flow DOES on a match). Reasoning over the chain (the inward fold)
// is a later layer, not built (3.md: "the law is the inner fold of the life").
// Trip loudly so it can never drift in as a flow.
const REASONING = /\b(because|therefore|thus|hence)\b|\bin order that\b/i;
function guardForward(line) {
  if (REASONING.test(line)) {
    throw new Error(
      `word parser: "${line}" is INWARD / reasoning language (because / therefore / thus). ` +
        `The forward register declares acts and flows; reasoning over the chain is the inward fold, not built. ` +
        `A flow DOES on a match; a conclusion MEANS. See 3.md ("the law is the inner fold of the life").`,
    );
  }
}

// RULE 19 (capitalization is a one-way signal): the only intentional capitals
// are beings and the Name-refs I / I. A kind / op / property is lowercase,
// written with its article ("A model") or named by a reference ("It"). A
// bare-capitalized kind reads as a being, so trip it loudly.
const RULE19_KIND =
  /^(?!It |I |I |The |A |An )([A-Z][a-z]\w*) (accepts|carries|claims|has|may have|can|cannot)\b/;
function guardCapitals(line) {
  const m = line.match(RULE19_KIND);
  if (m) {
    throw new Error(
      `word parser: "${m[1]}" is bare-capitalized (rule 19: a mid-sentence capital is a BEING or a Name-ref). ` +
        `A kind is lowercase — write "A ${m[1].toLowerCase()} ..." or reference it with "It ...".`,
    );
  }
}

export function parse(source) {
  const raw = source.split(/\r?\n/);
  const trimmed = raw.map((s) => s.trim());

  // first pass: event derivations, the start dimension + value, declared spaces
  const events = {};
  const spaces = new Set();
  let stateVar = "sky",
    start = null;
  for (const line of trimmed) {
    if (!line || line.startsWith("#")) continue; // blank / comment
    let m;
    if ((m = line.match(DERIVE))) {
      events[verb(m[2])] = m[4];
      continue;
    }
    if ((m = line.match(START))) {
      stateVar = m[1].toLowerCase();
      start = { [stateVar]: m[2] };
      continue;
    }
    if ((m = line.match(/^A (.+?) is a space\.$/i)))
      spaces.add(m[1].toLowerCase());
  }
  const c = { events, spaces, stateVar, lastSubject: null };

  // second pass: walk RAW lines so indentation groups a header with its body
  const nodes = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].trim();
    if (!line || line.startsWith("#") || DERIVE.test(line) || START.test(line))
      continue;
    guardForward(line); // forward register only; reasoning words trip the guard
    guardCapitals(line); // rule 19: a bare-capitalized kind reads as a being

    // a multi-effect flow header? (ends with ":")
    if (line.endsWith(":")) {
      const header = parseHeader(line, c);
      if (!header)
        throw new Error(`word parser: cannot parse flow header:\n  ${line}`);
      const headerIndent = indentOf(raw[i]);
      const { nodes: effects, nextI } = collectBody(raw, i, headerIndent, c); // §0/§2/§3 nesting
      i = nextI;
      nodes.push({ ...header, effects });
      continue;
    }

    // a single-line node (declaration or one-line flow)
    const node = apply(line, c, RULES);
    if (!node) throw new Error(`word parser: cannot parse line:\n  ${line}`);
    if (node.kind === "is") c.lastSubject = node.subject; // the referent "It" resolves to
    nodes.push(node);
  }
  if (start) nodes.start = start; // the round-trip reads ir.start for the initial state
  return nodes;
}

function parseEffect(line, c) {
  return apply(line, c, EFFECT_RULES);
}

function apply(line, c, rules) {
  // FOLD-FIRST, scoped to the top-level table: a lifted rule-word wins when present (the metacircular
  // loop). An empty fold (pre-boot / un-booted parser tests) yields no pairs → falls straight through
  // to the hardcoded RULES below = identical old behavior. EFFECT_RULES never reaches here.
  if (rules === RULES) {
    for (const [w, matcher] of foldRules()) {
      const mm = matcher(line);
      if (mm) return buildFromFoldRule(w, mm);
    }
  }
  for (const [re, build] of rules) {
    const m = line.match(re);
    if (m) return build(m, c);
  }
  return null;
}

// ── §0/§2/§3 recursive body: an indented body may NEST blocks (if/foreach) ──────
// Collects every line deeper than parentIndent into a node list (a flow's effects,
// or an if's then/else, or a foreach's body). A `:`-opener (If/For each/Otherwise)
// recurses for its own deeper sub-body; everything else is an inline effect. Blank
// and comment lines are skipped, never end a body (a dedent does). Returns the nodes
// + the index consumed so the caller resumes after the block.
function collectBody(raw, startI, parentIndent, c) {
  const out = [];
  let i = startI;
  while (i + 1 < raw.length) {
    const r = raw[i + 1];
    const line = r.trim();
    if (!line || line.startsWith("#")) {
      i++;
      continue;
    } // skip blanks/comments within a body
    if (indentOf(r) <= parentIndent) break; // a dedent ends this body
    i++;
    guardForward(line); // no reasoning inside a body either
    if (line.endsWith(":")) {
      const opener = parseBlockOpener(line, c);
      if (!opener)
        throw new Error(`word parser: cannot parse block:\n  ${line}`);
      if (opener.type === "match") {
        // §9: the body holds cases, not effects
        const mc = collectCases(raw, i, indentOf(r), c);
        i = mc.nextI;
        out.push({ kind: "match", on: opener.on, cases: mc.cases });
      } else {
        const sub = collectBody(raw, i, indentOf(r), c);
        i = sub.nextI;
        if (opener.type === "else") {
          const prev = out[out.length - 1];
          if (!prev || prev.kind !== "if")
            throw new Error(
              `word parser: "Otherwise:" with no preceding "If:":\n  ${line}`,
            );
          prev.else = sub.nodes;
        } else if (opener.type === "if") {
          out.push({ kind: "if", cond: opener.cond, then: sub.nodes });
        } else if (opener.type === "while") {
          // the conditional loop (P4): re-read the see each pass; the body grows the chain.
          out.push({ kind: "while", cond: opener.cond, body: sub.nodes });
        } else {
          // foreach
          out.push({
            kind: "foreach",
            bind: opener.bind,
            in: opener.in,
            ...(opener.ordered ? { ordered: true } : {}),
            body: sub.nodes,
          });
        }
      }
    } else {
      const eff = parseEffect(line, c);
      if (!eff) throw new Error(`word parser: cannot parse effect:\n  ${line}`);
      out.push(eff);
    }
  }
  return { nodes: out, nextI: i };
}

// §9 match cases: a Match body holds `For <label>:` cases + an `Otherwise:` default,
// each opening its own indented effect body. evalMatch dispatches String(getPath(on))
// === label, else the default — a value-driven type switch kept a flat surface.
function collectCases(raw, startI, parentIndent, c) {
  const cases = [];
  let i = startI;
  while (i + 1 < raw.length) {
    const r = raw[i + 1];
    const line = r.trim();
    if (!line || line.startsWith("#")) {
      i++;
      continue;
    }
    if (indentOf(r) <= parentIndent) break;
    i++;
    let m;
    if ((m = line.match(/^For (?!each\b)(.+?):$/i))) {
      // a labeled case
      const sub = collectBody(raw, i, indentOf(r), c);
      i = sub.nextI;
      cases.push({ label: matchLabel(m[1]), body: sub.nodes });
    } else if (/^Otherwise:$/i.test(line)) {
      // the default case
      const sub = collectBody(raw, i, indentOf(r), c);
      i = sub.nextI;
      cases.push({ body: sub.nodes });
    } else {
      throw new Error(
        `word parser: a Match body expects "For <label>:" or "Otherwise:", got:\n  ${line}`,
      );
    }
  }
  return { cases, nextI: i };
}
function matchLabel(s) {
  return s
    .trim()
    .replace(/^(a|an|the)\s+/i, "")
    .toLowerCase();
} // the value a case dispatches on

// a `:`-terminated block opener inside a body (vs parseHeader, the top-level flow head)
function parseBlockOpener(line, c) {
  let m;
  if ((m = line.match(/^If (.+):$/i)))
    return { type: "if", cond: parseCond(m[1], c) }; // §2 block
  if (/^Otherwise:$/i.test(line)) return { type: "else" }; // §2 else
  if ((m = line.match(/^While (.+):$/i)))
    return { type: "while", cond: parseCond(m[1], c) }; // P4: the conditional loop
  if ((m = line.match(/^For each (\w+) in (.+?)(\s+in order)?:$/i)))
    // §3 foreach
    return {
      type: "foreach",
      bind: m[1],
      in: parseSource(m[2], c),
      ordered: !!m[3],
    };
  if ((m = line.match(/^Match (.+):$/i)))
    return { type: "match", on: refKey(m[1]) }; // §9 value dispatch
  return null;
}

// §3 foreach source: `<ref>` | `<ref> whose <cond>` (filter) | `the <a> up to the <b>` (walk)
function parseSource(text, c) {
  let m;
  if ((m = text.match(/^(.+?) whose (.+)$/i)))
    return { ref: refKey(m[1]), filter: parseCond(m[2], c) };
  if ((m = text.match(/^the (.+?) up (?:the )?(.+?) to the (.+)$/i)))
    return { walk: { from: refKey(m[2]), to: refKey(m[3]), direction: "up" } };
  return { ref: refKey(text) };
}

// ── §1 condition: the parser lifts STRUCTURE only (connectives, negation, a
// recognized test/flag skeleton); cond.js resolves MEANING. Leaves: {test}, {flag},
// or a verbatim {clause} the engine resolves via host. ──────────────────────────
function parseCond(text, c) {
  const raw = text.trim();
  let hm;
  // an explicit host predicate cond: "host: isAncestorOf(caller, candidate)" -> resolvedBy
  if ((hm = raw.match(/^host:\s*(\w+)\(([^)]*)\)$/i)))
    return { resolvedBy: hm[1], args: argList(hm[2]).map((r) => ({ ref: r })) };
  // drop parenthetical GLOSSES ("(not remote)") — a paren with whitespace before it — but KEEP
  // a see-op CALL's args (`missing(history)`, the `(` hugs its name), so an inline see-op cond
  // survives the and/or split to parseLeaf (the as-removal: `If destination-missing(history)`).
  const t = raw
    .replace(/\s+\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ors = splitTop(t, /,?\s+or\s+/i); // absorb a comma before the connective ("X, or Y")
  if (ors.length > 1) return { any: ors.map((p) => parseCond(p, c)) };
  const ands = splitTop(t, /,?\s+and\s+/i); // ("X, and Y" -> no trailing comma on X)
  if (ands.length > 1) return { all: ands.map((p) => parseCond(p, c)) };
  return parseLeaf(t, c);
}

function parseLeaf(t, c) {
  let s = t,
    negated = false;
  if (/^no\s+/i.test(s)) {
    negated = true;
    s = s.replace(/^no\s+/i, "");
  } else if (
    /\b(is|are|was|were|does|do)\s+not\b|\bisn't\b|\bdoesn't\b/i.test(s)
  ) {
    negated = true;
    s = s.replace(/\s+not\b|n't\b/i, "");
  } else if (/\bnot\b/i.test(s)) {
    negated = true;
    s = s.replace(/\bnot\s*/i, "");
  }
  const neg = (node) => (negated ? { ...node, negated: true } : node);
  let m;
  // INLINE SEE-OP CALL as a predicate (the as-removal): `destination-missing(history)`,
  // `being-lives-on(caller, history)`. The op runs through ctx.env.host — the SAME registry
  // `see <op>(args) as v` dispatches via callHost — and the cond reads its result's truthiness.
  // A live check with NO bind, NO fact: the noun's own check IS the condition. `not <op>(args)`
  // negates via the block above. (A `(` hugging its name marks a call; a gloss has a space.)
  if ((m = s.match(/^([a-z][\w-]*)\((.*)\)$/i))) {
    // SEE_FLOOR guard (the inline twin): an inline see-op predicate dispatches through the SAME
    // ctx.env.host registry as `see <op>(args) as v`, so the SAME closed set gates it. An UNKNOWN
    // see-op predicate is REJECTED — the door stays shut on both faces of the see verb.
    if (!SEE_FLOOR.has(m[1]))
      throw new Error(
        `word parser: see-op predicate "${m[1]}" is not a recognized SEE FLOOR perception. ` +
          `The see-op door is a CLOSED SET — only host-backed READS / pure COMPUTES that lay NO fact ` +
          `(${[...SEE_FLOOR].join(", ")}). An op that changes the world is a \`do\`, not a \`see\`; a new ` +
          `perception/compute must be added to SEE_FLOOR deliberately. (philosophy/word/17.md: see is inert.)`,
      );
    return neg({
      seeCall: m[1],
      args: m[2].trim() ? argList(m[2]).map((r) => ({ ref: r })) : [],
    });
  }
  // AUTHORITY PREDICATE (the being-tree walk, the floor predicate): `<X> has authority over <Y>` /
  // `<X> has credential authority over <Y>`. The inline conditional form of the `see whether …`
  // predicate — a LIVE being-tree authority walk, resolved through ctx.env.host.hasAuthorityOver
  // (the name→being walk) or hasCredentialAuthority (the being→being credential axis), the floor
  // floorHostEnv wires under every .word runner. Lifts to resolvedBy so `If <caller> has authority
  // over <target>:` gates the branch on the real inheritation walk instead of failing closed (a bare
  // clause). `not …` already flipped `negated` above; `neg` carries it onto the predicate.
  if ((m = s.match(/^(.+?)\s+has(\s+credential)?\s+authority over\s+(.+)$/i)))
    return neg({
      resolvedBy: m[2] ? "hasCredentialAuthority" : "hasAuthorityOver",
      args: [{ ref: refKey(m[1]) }, { ref: refKey(m[3]) }],
    });
  // ONE-HOP BEING-PARENT (the floor predicate, NARROWER than authority): `<X> is the being-parent
  // of <Y>` → did X perform Y's BIRTH act (the parentBeingId on Y's be:birth fact, findBeingParent)?
  // IMMEDIATE parent only — distinct from `has authority over` / `descends from`, which walk the whole
  // ancestry. credential-attach is being-parent-ONLY, so its gate reads this native relation instead
  // of pulling the parent out to hand-compare. Resolved through ctx.env.host.isBeingParentOf
  // (floorHostEnv). MUST precede the `is`-equality rule below, which would else mis-read it.
  if ((m = s.match(/^(.+?)\s+is the being-parent of\s+(.+)$/i)))
    return neg({
      resolvedBy: "isBeingParentOf",
      args: [{ ref: refKey(m[1]) }, { ref: refKey(m[2]) }],
    });
  // DEIXIS (here/there/where): `there` sets the EXISTENTIAL context, `is/are` makes the
  // claim within it — so "there is <X>" is a PRESENCE check, "there is no <X>" its absence.
  // ≡ the bare `[no] <X>` flag, but reads as the natural conditional (the `If` is the
  // WHERE — the conditional frame; the `:` is the HERE — the consequence that follows).
  // "there is no caller" → absence of caller; "there is a candidate" → present.
  if ((m = s.match(/^there\s+(?:is|are)\s+(no\s+|an?\s+)?(.+)$/i))) {
    const absent = /^no\b/i.test((m[1] || "").trim());
    const f = inferFlag(m[2]) || refKey(m[2]);
    return absent || negated ? { negated: true, flag: f } : { flag: f };
  }
  // EXISTENCE predicates — the implicit "there is", since the conditional frame already
  // carries it (you don't write the ceremony). All fold to the SAME presence flag as the
  // bare `[no] <X>`:  "<X> exists" / "<X> is present" → present;  "<X> is missing|absent|
  // gone" → absent;  "<X> does not exist" → (the negation block above already flipped it)
  // absent. So `no caller` ≡ `there is no caller` ≡ `caller is missing` ≡ `caller does
  // not exist`. The negative-existence words (missing/absent/gone) flip presence themselves.
  if (
    (m = s.match(
      /^(.+?)\s+(?:is\s+|does\s+)?(exists?|present|missing|absent|gone)$/i,
    ))
  ) {
    const inherentlyAbsent = /^(missing|absent|gone)$/i.test(m[2]);
    const finalAbsent = negated ? !inherentlyAbsent : inherentlyAbsent;
    const f = inferFlag(m[1]) || refKey(m[1]);
    return finalAbsent ? { negated: true, flag: f } : { flag: f };
  }
  // explicit test skeletons (8.md §1): equality is the pervasive case, then compare
  if ((m = s.match(/^(.+?)\s+equals\s+(.+)$/i)))
    return neg({
      test: { op: "equals", path: refKey(m[1]), ...operand(m[2]) },
    });
  if ((m = s.match(/^(.+?)\s+is at least\s+(.+)$/i)))
    return neg({
      test: {
        op: "compare",
        as: "ge",
        path: refKey(m[1]),
        against: refLit(m[2]),
      },
    });
  if ((m = s.match(/^(.+?)\s+is at most\s+(.+)$/i)))
    return neg({
      test: {
        op: "compare",
        as: "le",
        path: refKey(m[1]),
        against: refLit(m[2]),
      },
    });
  // strict ordered compares — the live-object form: `the hero's health is less than 5` reads
  // the fold at eval time (a live sensor, not a snapshot). `less than`/`greater than` are the
  // unambiguous spellings (no `under`/`over`/`below` synonyms — those surface in prose words).
  if ((m = s.match(/^(.+?)\s+is less than\s+(.+)$/i)))
    return neg({
      test: {
        op: "compare",
        as: "lt",
        path: refKey(m[1]),
        against: refLit(m[2]),
      },
    });
  if ((m = s.match(/^(.+?)\s+is greater than\s+(.+)$/i)))
    return neg({
      test: {
        op: "compare",
        as: "gt",
        path: refKey(m[1]),
        against: refLit(m[2]),
      },
    });
  // TYPE predicates (§1) — the primitive shape checks: `<X> is a [finite] number`,
  // `<X> is a string` / `<X> is text`. The host floor's `Number.isFinite` / `typeof` named
  // as native Word predicates (cond.js resolveTest isFinite/isString), so a `.word` validates
  // a value's shape without a bespoke per-op host fn. MUST precede the kind-check rule below:
  // `number`/`string`/`text` are not aggregate KINDs (space/being/matter), so the kind rule
  // would otherwise mis-route `the coord's x is a number` to an equality on `coord.x.kind`.
  if ((m = s.match(/^(.+?)\s+(?:is|are)\s+(?:a\s+|an\s+)?(?:finite\s+)?number$/i)))
    return neg({ test: { op: "isFinite", path: refKey(m[1]) } });
  if (
    (m = s.match(/^(.+?)\s+(?:is|are)\s+(?:a\s+)?string$/i)) ||
    (m = s.match(/^(.+?)\s+(?:is|are)\s+text$/i))
  )
    return neg({ test: { op: "isString", path: refKey(m[1]) } });
  // a single bareword cond is a flow-local flag read: "signedIn", "asFather"
  if (/^[A-Za-z]\w*$/.test(s.trim())) {
    const f = s.trim();
    return negated ? { negated: true, flag: f } : { flag: f };
  }
  // a flow-local flag (a reflexive state predicate, §5): "<subj> (is|was) <participle>"
  const flag = inferFlag(s);
  if (flag) return negated ? { negated: true, flag } : { flag };
  // KIND check (§1): "the subject is a space" / "the subject's kind is a matter" -> a
  // test on the bound entity's STRUCTURAL kind. The ARTICLE ("a"/"an") distinguishes a
  // kind-check from a state predicate (`is remote`, no article). The bridge binds the
  // target as an entity {kind, id}, so `subject.kind` reads the kind off the binding (a
  // presence/kind gate the cond resolver already models — never a host compute).
  if ((m = s.match(/^(?:the )?(.+?)(?:'s kind)? (?:is|are) (?:a|an) (\w+)$/i)))
    return neg({
      test: {
        op: "equals",
        path: refKey(m[1]) + ".kind",
        value: m[2].toLowerCase(),
      },
    });
  // EQUALITY via `is` (the connection-layer upgrade so `is` reads for `equals`): a QUOTED
  // literal RHS or a REF RHS is an equality test; a bareword RHS falls through to the
  // flag/predicate below (so `the being is found` stays a flag). `the kind is "space"` /
  // `the to is the subject's id` read as equality — the quotes / ref-shape are the
  // discriminator, exactly as `equals` already disambiguates value-vs-ref.
  if ((m = s.match(/^(.+?)\s+(?:is|are)\s+(.+)$/i))) {
    const rhs = m[2].trim();
    if (/^".*"$/.test(rhs))
      return neg({
        test: { op: "equals", path: refKey(m[1]), value: rhs.slice(1, -1) },
      });
    const r = oper(rhs);
    if (r.ref !== undefined)
      return neg({
        test: { op: "equals", path: refKey(m[1]), against: { ref: r.ref } },
      });
  }
  // "<X> is <pred>" where <pred> is NOT a state-flag word: a host-resolved domain
  // predicate over X ("the candidate is remote" -> remote(candidate), the host helper
  // normalizes the field defensively). Convention: `is <word>` = predicate, `equals
  // <value>` = equality (so values never mis-route here).
  if ((m = s.match(/^(.+?)\s+(?:is|are)\s+(\w+)$/i)))
    return neg({
      resolvedBy: m[2].toLowerCase(),
      args: [{ ref: refKey(m[1]) }],
    });
  // else a verbatim leaf the engine resolves (host predicate / state read)
  return neg({ clause: t.trim() });
}

// split on a separator only at the TOP level, NEVER inside a quoted "..." span, so a
// refuse message with commas (like "expected 0, 1, 1a") survives as one piece. Mask
// quoted spans to null-delimited placeholders, split, then restore.
function splitTop(s, re) {
  const NUL = String.fromCharCode(0);
  const held = [];
  const masked = (s || "").replace(/"[^"]*"/g, (q) => {
    held.push(q);
    return NUL + (held.length - 1) + NUL;
  });
  return masked
    .split(re)
    .map((x) =>
      x
        .replace(new RegExp(NUL + "([0-9]+)" + NUL, "g"), (_, i) => held[+i])
        .trim(),
    )
    .filter(Boolean);
}
// a host-call argument list: "name, password" -> ["$name","$password"] (or bare refs)
function argList(str, prefix = "") {
  return splitTop(str || "", /,\s*/).map((a) => prefix + refKey(a));
}
// a test operand. A bareword (dj, stop, match) is a string LITERAL; a number/bool is
// a literal; only `$x`, an article phrase (`the quorum`), a possessive, or a dotted
// path is a REF (a binding read). equals/compare carry it as `value` (against literal)
// or `against:{ref}` per cond.js's resolveOperand.
function operand(v) {
  const r = oper(v);
  return r.ref !== undefined ? { against: { ref: r.ref } } : { value: r.value };
}
function refLit(v) {
  const r = oper(v);
  return r.ref !== undefined ? { ref: r.ref } : r.value;
}
// a right-side value (call content, etc.): a quoted "..." is a string literal; anything
// else is refLit (a {ref} for $/possessive/dotted, a bareword-literal otherwise).
function valueExpr(v) {
  const x = v.trim();
  return /^".*"$/.test(x) ? x.replace(/^"|"$/g, "") : refLit(x);
}
function oper(v) {
  const x = v.trim();
  if (/^".*"$/.test(x)) return { value: x.slice(1, -1) }; // a quoted literal FIRST, so "a. b." isn't mistaken for a dotted ref by the path check below
  if (x.startsWith("$")) return { ref: refKey(x.slice(1)) };
  // nested literals: a value can be an object or array whose leaves recurse through
  // refLit, so $refs and inner objects nest. resolveValue (evaluator) walks the result
  // at run time. Enables `do create-matter with { content: { target: $address } }`.
  if (x.startsWith("{") && x.endsWith("}"))
    return { value: parseObjectLiteral(x) };
  if (x.startsWith("[") && x.endsWith("]"))
    return { value: parseArrayLiteral(x) };
  if (/^true$/i.test(x)) return { value: true };
  if (/^false$/i.test(x)) return { value: false };
  if (/^null$/i.test(x)) return { value: null }; // a bare `null` is JS null (clear/unset), like true/false — so a composite can `do set-space ... value: null` to clear a field
  if (/^-?\d+(\.\d+)?$/.test(x)) return { value: Number(x) };
  if (/'s\b/.test(x)) return { ref: camelKey(x) }; // possessive: kebab props (reset-at) resolve to the stored camelCase key (resetAt)
  if (/^(the|its|his|her|their|a|an)\s+/i.test(x) || x.includes("."))
    return { ref: refKey(x) };
  return { value: x }; // a bareword -> a string literal
}
// a dotted reference: strip a leading article, keep possessive/dotted paths as a key
function refKey(s) {
  return s
    .trim()
    .replace(/[,.;:]+$/, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/'s\s+/g, ".")
    .replace(/\s+/g, "-");
}

// ── 623/12.md utterance helpers: the quotes are the do; the address is the only modifier ──────
// The leading interrogative inside a quote is the LENS (recall.word's "view"). Five name ONE fact
// column (623/7): where/who/when/how/why. `what` is the WHOLE word — the narrative (8.pdf "What
// From" renders the full chain) — so it maps to no lens. Anything else: no lens (a plain message).
const LENS_WORDS = new Set(["where", "who", "when", "how", "why"]);
function parseLens(quoteBody) {
  const x = String(quoteBody || "").trim();
  const m = x.match(
    /^(what|where|who|when|how|why)\b\s*(?:from\b)?\s*\??\s*(.*)$/i,
  );
  if (!m) return { lens: null, body: x };
  const w = m[1].toLowerCase();
  return { lens: LENS_WORDS.has(w) ? w : null, body: m[2].trim() };
}
// the address before a quote -> the TARGET. Absent ⇒ the SIGNER (self, null). "world" ⇒ the whole
// story (self-side). A name ⇒ a being {ref} (self if it resolves to you, else other ⇒ await).
function parseAddress(g1) {
  if (g1 == null) return null;
  const s = g1.trim().replace(/[,]+$/, "");
  if (!s) return null;
  if (/^(the\s+)?world$/i.test(s)) return "world";
  return { ref: refKey(s) };
}

// Split top-level commas, respecting nested {}, [] and "..." (unlike splitTop, which only
// masks quoted strings). Used for `with`/object params so a nested object's inner commas
// never split the outer list.
function splitTopCommas(s) {
  const out = [];
  let depth = 0,
    inStr = false,
    buf = "";
  for (let i = 0; i < (s || "").length; i++) {
    const ch = s[i];
    if (inStr) {
      buf += ch;
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      buf += ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
// A nested object literal "{ k: v, k2: { ... } }": each value recurses through refLit, so
// $refs ({ref}) and inner objects/arrays nest. The evaluator's resolveValue walks the
// result, resolving leaves at run time — one composable params shape, words all the way down.
function parseObjectLiteral(s) {
  const inner = s.trim().replace(/^\{/, "").replace(/\}$/, "").trim();
  const obj = {};
  if (!inner) return obj;
  for (const it of splitTopCommas(inner)) {
    const kv = it.match(/^("?[\w][\w.-]*"?)\s*:\s*(.+)$/);
    if (kv) obj[camelKey(kv[1].replace(/^"|"$/g, ""))] = refLit(kv[2].trim());
  }
  return obj;
}
// An array literal "[ a, b, $c ]": each element recurses through refLit.
function parseArrayLiteral(s) {
  const inner = s.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  return inner ? splitTopCommas(inner).map((it) => refLit(it)) : [];
}

// inferFlag (§5): a reflexive state predicate -> a DETERMINISTIC flow-local flag, so a
// mark ("the being is found") and a sibling read ("if no being was found") name the
// same flag. Strip articles + auxiliaries, camelCase the content words. Null if it
// isn't a state predicate (so parseLeaf falls through to a test/clause).
const FLAG_ART = /^(a|an|the|its|his|her|their|that|this)$/i;
const FLAG_AUX = /^(is|are|was|were|be|been|has|have|had)$/i; // NOT "being" — that's the subject noun, not the gerund aux, in our .word
const FLAG_STATE = new Set([
  "found",
  "owned",
  "born",
  "set",
  "done",
  "inhabited",
  "passed",
  "live",
  "sealed",
  "released",
  "ready",
  "verified",
  "ancestor",
  "asfather",
  "chosen",
  "named",
]);
function inferFlag(clause) {
  const words = clause.trim().replace(/[."]/g, "").split(/\s+/).filter(Boolean);
  const content = words.filter((w) => !FLAG_ART.test(w) && !FLAG_AUX.test(w));
  if (content.length < 1 || content.length > 3) return null;
  const last = content[content.length - 1].toLowerCase();
  const stateLike = /(ed|en)$/.test(last) || FLAG_STATE.has(last);
  if (!stateLike) return null;
  return content
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1),
    )
    .join(""); // preserve camelCase in the rest (asFather, not Asfather)
}

// the inline-then of "If <cond>, X, and Y." — a comma/and-joined list of effects
function parseInlineThen(rest, c) {
  const t = rest.trim();
  // A leading Return carries STRUCTURAL commas (`Return k: v, k: v`) — it is ONE effect,
  // not a comma-separated list. Parse the whole as a single effect so its kv pairs survive
  // (lets `If <cond>, Return a: 1, b: 2.` inline instead of staying a block).
  if (/^Return\b/i.test(t)) {
    const eff = parseEffect(t.replace(/\.$/, "") + ".", c);
    if (eff) return [eff];
  }
  return splitInlineEffects(t).map((part) => {
    const eff = parseEffect(part.replace(/\.$/, "") + ".", c);
    if (!eff)
      throw new Error(
        `word parser: cannot parse inline-then effect:\n  ${part}`,
      );
    return eff;
  });
}
// Find the hinge of an inline `If <cond>, <then>.` — scanning at paren/brace/bracket/quote
// depth 0 so a comma INSIDE a see-op's args (`being-lives-on(caller, history)`) or a nested
// `{ … }` never reads as the hinge. The hinge is ` then `, `→`/`->`, or a top-level comma NOT
// immediately followed by `and`/`or` (those join multi-conditions, §2). Returns { cond, then }
// at the FIRST (leftmost) hinge — preserving the old lazy-regex leftmost semantics — or null
// when no hinge exists (a malformed inline If). The depth walk mirrors splitInlineEffects /
// splitTopCommas, extended to count `()` (which neither of those does).
function splitInlineIf(inner) {
  let depth = 0,
    inStr = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inStr) {
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    const rest = inner.slice(i);
    const explicit =
      rest.match(/^\s+then\s+/i) || rest.match(/^\s*(?:→|->)\s*/);
    if (explicit)
      return {
        cond: inner.slice(0, i).trim(),
        then: rest.slice(explicit[0].length).trim(),
      };
    if (ch === "," && !/^\s*(?:and|or)\b/i.test(inner.slice(i + 1)))
      return {
        cond: inner.slice(0, i).trim(),
        then: inner.slice(i + 1).trim(),
      };
  }
  return null;
}
// Split an inline-then into effects on top-level `,` / `, and ` / ` and `, respecting nested
// (), {}, [], and "..." so a `do X with { nested }` param, an `op(a, b)` arg comma, or a
// quoted comma is never split.
function splitInlineEffects(s) {
  const parts = [];
  let depth = 0,
    inStr = false,
    buf = "",
    i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (inStr) {
      buf += ch;
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      buf += ch;
      i++;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      i++;
      continue;
    }
    if (depth === 0) {
      const m = s.slice(i).match(/^(?:,\s*and\s+|,\s*|\s+and\s+)/i);
      if (m) {
        if (buf.trim()) parts.push(buf.trim());
        buf = "";
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}
// "the being's address, beingId, ..." -> ["address","beingId",...] (return values)
function camelKey(s) {
  return refKey(s).replace(/-(\w)/g, (_, ch) => ch.toUpperCase());
}

// "a name and a password" -> ["name", "password"] (binds from a `with` clause)
function parseBinds(clause) {
  if (!clause) return [];
  return clause
    .split(/\s*,\s*|\s+and\s+/i)
    .map((s) => s.trim().replace(/^(a|an|the)\s+/i, ""))
    .filter(Boolean);
}

// ── builders ──────────────────────────────────────────────────────────────────
// an unqualified act inside a flow: by the Name ("I", resolved to the acting
// Name at run time, rule 9), THROUGH the flow's being (the being in the
// header). The implicit-actor rule — a flow's body acts inherit its actor and
// being rather than restating them; here, I through Cherub.
function beingAct(c, verbName, op, of, params) {
  const a = { kind: "act", verb: verbName, act: op, by: "I", through: c.being };
  if (of) a.of = of;
  if (params) a.params = params;
  return a;
}
// THE WALL's write side: a generic substrate WRITE → a do:set-<kind> act binding
// a field to a value. `noun` names the bound target (kind = being default, or
// space/matter when the noun is literally that); `field` is a dotted path; `value`
// is a literal or a $-ref (dotted ok). Merge follows the set-op default (true)
// unless forced. This is what collapses the host: write-escapes into verbs.
function writeAct(c, noun, field, value, merge, ref) {
  const k = noun.toLowerCase();
  const kind = k === "space" ? "space" : k === "matter" ? "matter" : "being";
  // a $-prefixed field is a COMPUTED path — a {ref} resolved at eval (dynamic writes like
  // qualities.world.<ns>.<key>); a plain token is the literal dotted path.
  const fld =
    typeof field === "string" && field.startsWith("$")
      ? { ref: refKey(field.slice(1)) }
      : field;
  // resolve the right-side value: a quoted "..." is a literal; a legacy $ref stays a raw
  // $-string (resolveValue handles it); a possessive/dotted path becomes a {ref} (one ref
  // shape, resolved by getPath in writes, returns, and conditions alike); a bareword is a
  // literal.
  const v = value.trim();
  const resolved = /^".*"$/.test(v)
    ? v.replace(/^"|"$/g, "")
    : v.startsWith("$")
      ? v
      : refLit(v);
  const params = { field: fld, value: resolved };
  if (merge !== undefined) params.merge = merge;
  // `ref` (given by the targeted-write form) names a BOUND entity; else the being/noun.
  return beingAct(
    c,
    "do",
    "set-" + kind,
    { kind, ref: ref !== undefined ? refKey(ref) : k },
    params,
  );
}
// the DO-OP call target: "the <kind> <ref>" names a kind explicitly; else a bound ref
// whose kind the evaluator resolves at run time.
function parseDoTarget(s) {
  const km = s.match(/^the\s+(being|space|matter)\s+(.+)$/i);
  if (km) return { kind: km[1].toLowerCase(), ref: refKey(km[2]) };
  return { ref: refKey(s) };
}
// "do <op> [on <target>] [with <k>: <v>, …] [as <bind>]" -> a do-act dispatched through
// doVerb. Peel `as <bind>` off the end, then `on <target>` (up to `with`) and `with
// <params>` (quote-aware comma split; each `k: v` a {ref}-or-literal value).
function doOpAct(op, rest, c) {
  const act = { kind: "act", verb: "do", act: op };
  const asM = rest.match(/\s+as\s+(\w+)$/i);
  if (asM) {
    act.bind = asM[1];
    rest = rest.slice(0, asM.index).trim();
  }
  let paramsStr = "";
  const onWith = rest.match(/^on\s+(.+?)(?:\s+with\s+(.+))?$/i);
  if (onWith) {
    act.of = parseDoTarget(onWith[1].trim());
    if (onWith[2]) paramsStr = onWith[2].trim();
  } else {
    const w = rest.match(/^with\s+(.+)$/i);
    if (w) paramsStr = w[1].trim();
  }
  if (paramsStr) {
    let params;
    // Two equivalent forms: a whole-object `with { k: v, … }` (clean for a big nested
    // spec) or bare top-level pairs `with k: v, k: v` (values may still nest objects).
    if (paramsStr.startsWith("{") && paramsStr.endsWith("}")) {
      params = parseObjectLiteral(paramsStr);
    } else {
      params = {};
      for (const it of splitTopCommas(paramsStr)) {
        const kv = it.match(/^([\w][\w.-]*)\s*:\s*(.+)$/);
        if (kv) params[camelKey(kv[1])] = refLit(kv[2].trim());
      }
    }
    if (params && Object.keys(params).length) act.params = params;
  }
  return act;
}
// state-watch flow (rules 6, 12): fires when the state dimension holds `value`.
function stateFlow(stateVar, value, effect) {
  return {
    kind: "flow",
    when: { state: { [stateVar]: value } },
    effects: [effect],
  };
}
// an act under a state-watch; `sets` folds the next state (the wheel), absent for a rider.
function stateAct(able, op, obj, sets, c) {
  const a = { kind: "act", verb: "do", act: op, by: capitalize(able) };
  if (obj) a.of = objRef(obj, c);
  if (sets) a.sets = sets;
  return a;
}
// derived-event flow (harmony): fires on the named event.
function eventFlow(event, effect) {
  return { kind: "flow", when: { on: event }, effects: [effect] };
}
function eventAct(able, op, obj, c) {
  const a = { kind: "act", verb: "do", act: op, by: capitalize(able) };
  if (obj) a.of = objRef(obj, c);
  if (c.events[op]) a.event = c.events[op]; // this verb counts as a derived event
  return a;
}
// an object's kind comes from the declarations: a declared space is a space, else matter.
function objRef(obj, c) {
  return {
    kind: c.spaces.has(obj.toLowerCase()) ? "space" : "matter",
    id: obj,
  };
}

function stripArticle(s) {
  return s.trim().replace(/^(a|an|the)\s+/i, "");
}
function splitItems(s) {
  // Split on top-level `,` / `, and ` / `, or ` / ` and ` / ` or `, respecting nested {}, []
  // and "..." — so a Return's nested-object fact params (`factParams: { a: $x, b: $y }`)
  // survive instead of being shredded at the inner comma. Brace-free input (declaration
  // lists, single-value returns) splits identically to the old regex.
  const parts = [];
  let depth = 0,
    inStr = false,
    buf = "",
    i = 0;
  const str = s || "";
  while (i < str.length) {
    const ch = str[i];
    if (inStr) {
      buf += ch;
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      buf += ch;
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      i++;
      continue;
    }
    if (depth === 0) {
      const m = str
        .slice(i)
        .match(/^(?:,\s*and\s+|,\s*or\s+|\s+and\s+|\s+or\s+|,\s*)/i);
      if (m) {
        if (buf.trim()) parts.push(buf.trim());
        buf = "";
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}
function indentOf(raw) {
  return (raw.match(/^(\s*)/)[1] || "").length;
}
function verb(v) {
  return /ss$/.test(v) ? v : v.endsWith("s") ? v.slice(0, -1) : v;
} // strikes -> strike; pass stays pass
function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
} // drummer -> Drummer (the bearer)
