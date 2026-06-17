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
//   structure    A X is a space.            A X is a role for a Y.
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

// ── single-line forms (top level: declarations + one-line flows) ──────────────
const RULES = [
  // structure / kinds (rule 8). A name is a SINGLE TOKEN (letters/digits/hyphen/
  // dot/underscore, no spaces) — matches the substrate's BEING/SPACE/SEED name
  // regexes. So `music-room`, not `music room`; the grammar rejects spaces.
  [/^A ([\w.-]+) is a space\.$/i, (m) => ({ kind: "is", subject: m[1], isA: "space" })],
  [/^A ([\w.-]+) is a role for a ([\w.-]+)\.$/i, (m) => ({ kind: "is", subject: m[1], isA: "role", scope: m[2] })],

  // capability grant / prohibition (rules 8, 14) — declarations the evaluator
  // treats as LAW (the parser captures them; the engine's role/capability model
  // enforces them, incl. prohibition precedence). "A member can back a proposal."
  [/^A (\w+) can (\w+)(?: (?:a |an |the )?(.+?))?\.$/i,
    (m) => ({ kind: "can", role: m[1], verb: verb(m[2]), of: m[3] || null })],
  [/^A (\w+) cannot (\w+)(?: (?:a |an |the )?(.+?))?\.$/i,
    (m) => ({ kind: "cannot", subject: m[1], verb: verb(m[2]), of: m[3] || null })],
  // "No member can back it." (a flat prohibition — rule 14)
  [/^No (\w+) can (\w+)(?: (?:a |an |the |it ?)?(.+?))?\.$/i,
    (m) => ({ kind: "cannot", subject: m[1], verb: verb(m[2]), of: m[3] || "it" })],

  // possession + structure relations (rule 2) + role inheritance. Declarations
  // the engine reads as law (state, not acts). "A commons contains proposals
  // and a roster." / "A steward extends member." / "I own the music room."
  [/^A ([\w.-]+) contains (.+)\.$/i, (m) => ({ kind: "contains", subject: m[1].toLowerCase(), items: splitItems(m[2]) })],
  [/^A ([\w.-]+) extends ([\w.-]+)\.$/i, (m) => ({ kind: "extends", role: m[1].toLowerCase(), parent: m[2].toLowerCase() })],
  [/^(I|[A-Z][\w.-]*) owns? (?:the |a |an )?([\w.-]+)\.$/, (m) => ({ kind: "owns", subject: m[1], of: m[2] })],

  // single-effect wheel phase / rider (state-watch) — rules 6, 12
  [/^When it is (\w+), the (\w+) (\w+), and it becomes (\w+)\.$/i,
    (m, c) => stateFlow(c.stateVar, m[1], stateAct(m[2], verb(m[3]), null, { [c.stateVar]: m[4] }, c))],
  [/^When it is (\w+), the (\w+) (\w+) the (\w+)\.$/i,
    (m, c) => stateFlow(c.stateVar, m[1], stateAct(m[2], verb(m[3]), m[4], null, c))],

  // derived-event flow (harmony)
  [/^When a (\w+) happens, the (\w+) (\w+) the (\w+)\.$/i,
    (m, c) => eventFlow(m[1], eventAct(m[2], verb(m[3]), m[4], c))],
  [/^When a (\w+) happens, the (\w+) (\w+)\.$/i,
    (m, c) => eventFlow(m[1], eventAct(m[2], verb(m[3]), null, c))],

  // property / attribute declarations on a kind (the #4 gap; forward structure
  // the engine reads as law). "A space has an owner, a being." / "may have".
  [/^A (\w+) (has|may have) (.+?)(?:, (.+))?\.$/i,
    (m) => ({ kind: "has", subject: m[1].toLowerCase(), optional: /may/i.test(m[2]), property: stripArticle(m[3]), gloss: m[4] ? m[4].trim() : null })],
  // a matter type's content / ops / classification claims (the registry vocabulary).
  // A kind stays lowercase with its article ("A model") or is named by a reference
  // ("It", the last-declared kind); NEVER bare-capitalized like a Name (rules 5, 10).
  // No bare-subject form, so the grammar itself enforces the rule.
  [/^A (\w+) (accepts|carries|claims) (.+)\.$/i,
    (m) => ({ kind: m[2].toLowerCase(), subject: m[1].toLowerCase(), items: splitItems(m[3]) })],
  [/^[Ii]t (accepts|carries|claims) (.+)\.$/i,
    (m, c) => ({ kind: m[1].toLowerCase(), subject: c.lastSubject || null, items: splitItems(m[2]) })],

  // generic kind declaration — LAST so the specific `is a space` / `is a role
  // for a Y` rules win their shapes first. "A generic is a matter type."
  [/^A ([\w.-]+) is a (.+?)\.$/i, (m) => ({ kind: "is", subject: m[1].toLowerCase(), isA: m[2] })],

  // I_AM's genesis acts (the LIFE register — acts performed in sequence, not law
  // or a watch; rule 9, "I" is the Name). Rendered forward from the root, this is
  // the creation story. Rule 19 disambiguates "I make X": a Capital X is a being
  // (birth it); a lowercase X is a space (create it).
  [/^I am that I am\.$/i, () => ({ kind: "act", verb: "name", op: "i-am", by: "I" })],
  [/^I make ([A-Z][\w.-]*)(?:, (.+?))?\.$/,
    (m) => ({ kind: "act", verb: "be", op: "birth", by: "I", of: { kind: "being", id: m[1] }, params: { role: m[1].toLowerCase(), ...(m[2] ? { description: m[2] } : {}) } })],
  [/^I make (?:the )?([a-z][\w.-]*)(?:, (.+?))?\.$/,
    (m) => ({ kind: "act", verb: "do", op: "create-space", by: "I", of: { kind: "space", id: m[1] }, ...(m[2] ? { params: { gloss: m[2] } } : {}) })],
  [/^I stand in (?:the )?([\w.-]+)\.$/i,
    (m) => ({ kind: "act", verb: "do", op: "move", by: "I", of: { kind: "space", id: m[1] } })],

  // a transfer with a RECEIVER (rule 17): the `to` is the being it hands to.
  // "I give the drum to Claude." (Claude is a being — Capital, rule 19.) The
  // receiver is a property on the DO act, not a fourth noun. NOTE: the evaluator
  // does not yet carry `to` into the emitted fact (a 1-line engine follow-up);
  // the parse is complete.
  [/^I give the ([\w.-]+) to ([A-Z][\w.-]*)\.$/,
    (m, c) => ({ kind: "act", verb: "do", op: "give", by: "I", of: objRef(m[1], c), to: m[2] })],
];

// ── effect (body) forms: the imperative acts inside a multi-effect flow ───────
// Each emits one act node. `c.subject` is the flow's actor (the header's Being),
// the default `by` when an effect names no actor of its own.
const EFFECT_RULES = [
  // explicit-actor acts (also usable as a single-effect body): the sun forms
  [/^the (\w+) (\w+), and it becomes (\w+)\.$/i,
    (m, c) => stateAct(m[1], verb(m[2]), null, { [c.stateVar]: m[3] }, c)],
  [/^the (\w+) (\w+) the (\w+)\.$/i,
    (m, c) => stateAct(m[1], verb(m[2]), m[3], null, c)],

  // The cherub birth acts. THE IMPLICIT-ACTOR RULE: an unqualified act inside a
  // flow is by the Name ("I", resolved to the acting Name) THROUGH the flow's
  // vessel (here Cherub, the mother). So all five are I_AM acting through Cherub.
  // The new being is the NEW NAME's own (its trueName), not I_AM's; Cherub is the
  // mother, Arrival (the new Name's vessel at the floor) is the father. This is
  // what _registerHumanWithFreshHome assumed silently, now in the open.
  // "make a home space." -> do:create-space under the place root (the parent),
  // binding the CREATED space's id as `home` (create-space mints its own child id
  // and returns { spaceId }; the home's parent is the target).
  [/^make a (\w+) space\.$/i,
    (m, c) => ({ kind: "act", verb: "do", op: "create-space", by: "I", through: c.vessel, bind: m[1].toLowerCase(),
      of: { kind: "space", ref: "placeRoot" }, params: { name: "$name", type: "home-territory" } })],
  // "form the being as the new Name's own." -> be:form-being -> birthBeing.
  // The being expresses the new (arriving) Name: trueName = the new Name.
  [/^form the being as the new Name's own\.$/i,
    (m, c) => ({ kind: "act", verb: "be", op: "form-being", by: "I", through: c.vessel, bind: "child",
      params: { name: "$name", password: "$password", cognition: "human", defaultRole: "human", parentBeingId: c.vessel, homeId: "$home", trueName: "$ownerName" } })],
  // "make the being the home's owner." -> do:set-space owner = the new being
  [/^make the being the (\w+)'s owner\.$/i,
    (m, c) => vesselAct(c, "do", "set-space", { kind: "space", ref: m[1].toLowerCase() }, { field: "owner", value: "$child" })],
  // "grant the being the human role." -> do:grant-role
  [/^grant the being the (\w+) role\.$/i,
    (m, c) => vesselAct(c, "do", "grant-role", { kind: "being", ref: "child" }, { role: m[1], anchorSpaceId: "$placeRoot" })],
  // "record the being's lineage." -> do:set-being qualities.lineage (mother Cherub, father Arrival)
  [/^record the being's lineage\.$/i,
    (m, c) => vesselAct(c, "do", "set-being", { kind: "being", ref: "child" }, { field: "qualities.lineage", value: { mother: c.vessel, father: "Arrival" } })],
];

// ── headers (the trigger line of a multi-effect flow, ends with ":") ──────────
function parseHeader(line, c) {
  let m;
  // "When Cherub births a being, with a name and a password:" -> summon-birth flow
  if ((m = line.match(/^When (\w+) births a being(?: for a new Name)?(?:, with (.+))?:$/i))) {
    c.vessel = m[1]; // the being the actor acts THROUGH (Cherub, the mother vessel)
    return { kind: "flow", when: { summon: { to: m[1], intent: "birth", of: { kind: "being" } } }, binds: parseBinds(m[2]) };
  }
  // "When it is dawn:" -> a state-watch with a multi-effect body
  if ((m = line.match(/^When it is (\w+):$/i))) {
    c.vessel = null;
    return { kind: "flow", when: { state: { [c.stateVar]: m[1] } }, binds: [] };
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
// are beings and the Name-refs I / I_AM. A kind / op / property is lowercase,
// written with its article ("A model") or named by a reference ("It"). A
// bare-capitalized kind reads as a being, so trip it loudly.
const RULE19_KIND = /^(?!It |I |I_AM |The |A |An )([A-Z][a-z]\w*) (accepts|carries|claims|has|may have|can|cannot)\b/;
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
  let stateVar = "sky", start = null;
  for (const line of trimmed) {
    if (!line || line.startsWith("#")) continue; // blank / comment
    let m;
    if ((m = line.match(DERIVE))) { events[verb(m[2])] = m[4]; continue; }
    if ((m = line.match(START)))  { stateVar = m[1].toLowerCase(); start = { [stateVar]: m[2] }; continue; }
    if ((m = line.match(/^A (.+?) is a space\.$/i))) spaces.add(m[1].toLowerCase());
  }
  const c = { events, spaces, stateVar, lastSubject: null };

  // second pass: walk RAW lines so indentation groups a header with its body
  const nodes = [];
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i].trim();
    if (!line || line.startsWith("#") || DERIVE.test(line) || START.test(line)) continue;
    guardForward(line);  // forward register only; reasoning words trip the guard
    guardCapitals(line); // rule 19: a bare-capitalized kind reads as a being

    // a multi-effect flow header? (ends with ":")
    if (line.endsWith(":")) {
      const header = parseHeader(line, c);
      if (!header) throw new Error(`word parser: cannot parse flow header:\n  ${line}`);
      const headerIndent = indentOf(raw[i]);
      const effects = [];
      while (i + 1 < raw.length) {
        const bodyRaw = raw[i + 1];
        const bodyLine = bodyRaw.trim();
        if (!bodyLine) break;                            // a blank line ends the body
        if (indentOf(bodyRaw) <= headerIndent) break;    // a dedent ends the body
        i++;
        guardForward(bodyLine);                          // no reasoning inside a flow body either
        const eff = parseEffect(bodyLine, c);
        if (!eff) throw new Error(`word parser: cannot parse effect:\n  ${bodyLine}`);
        effects.push(eff);
      }
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

function parseEffect(line, c) { return apply(line, c, EFFECT_RULES); }

function apply(line, c, rules) {
  for (const [re, build] of rules) {
    const m = line.match(re);
    if (m) return build(m, c);
  }
  return null;
}

// "a name and a password" -> ["name", "password"] (binds from a `with` clause)
function parseBinds(clause) {
  if (!clause) return [];
  return clause.split(/\s*,\s*|\s+and\s+/i).map((s) => s.trim().replace(/^(a|an|the)\s+/i, "")).filter(Boolean);
}

// ── builders ──────────────────────────────────────────────────────────────────
// an unqualified act inside a flow: by the Name ("I", resolved to the acting
// Name at run time, rule 9), THROUGH the flow's vessel (the being in the
// header). The implicit-actor rule — a flow's body acts inherit its actor and
// vessel rather than restating them; here, I_AM through Cherub.
function vesselAct(c, verbName, op, of, params) {
  const a = { kind: "act", verb: verbName, op, by: "I", through: c.vessel };
  if (of) a.of = of;
  if (params) a.params = params;
  return a;
}
// state-watch flow (rules 6, 12): fires when the state dimension holds `value`.
function stateFlow(stateVar, value, effect) {
  return { kind: "flow", when: { state: { [stateVar]: value } }, effects: [effect] };
}
// an act under a state-watch; `sets` folds the next state (the wheel), absent for a rider.
function stateAct(role, op, obj, sets, c) {
  const a = { kind: "act", verb: "do", op, by: capitalize(role) };
  if (obj) a.of = objRef(obj, c);
  if (sets) a.sets = sets;
  return a;
}
// derived-event flow (harmony): fires on the named event.
function eventFlow(event, effect) {
  return { kind: "flow", when: { on: event }, effects: [effect] };
}
function eventAct(role, op, obj, c) {
  const a = { kind: "act", verb: "do", op, by: capitalize(role) };
  if (obj) a.of = objRef(obj, c);
  if (c.events[op]) a.event = c.events[op]; // this verb counts as a derived event
  return a;
}
// an object's kind comes from the declarations: a declared space is a space, else matter.
function objRef(obj, c) {
  return { kind: c.spaces.has(obj.toLowerCase()) ? "space" : "matter", id: obj };
}

function stripArticle(s) { return s.trim().replace(/^(a|an|the)\s+/i, ""); }
function splitItems(s) { return s.split(/,\s*and\s+|,\s*or\s+|\s+and\s+|\s+or\s+|,\s*/i).map((x) => x.trim()).filter(Boolean); }
function indentOf(raw) { return (raw.match(/^(\s*)/)[1] || "").length; }
function verb(v) { return v.endsWith("s") ? v.slice(0, -1) : v; } // strikes -> strike
function capitalize(s) { return s[0].toUpperCase() + s.slice(1); } // drummer -> Drummer (the bearer)
