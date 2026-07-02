# treeword — THE REBUILD: the grammar must come from the .word, not from Rust regex.

## READ THIS FIRST. IT IS A LEASH FOR A DRIFTING AGENT.

If you are an AI agent (Claude) working on `treeword`, you have a documented history of
**drifting back to hardcoded regex** every time you touch this. You will feel the urge to "just add
one rule" to `rules()` / `effect_rules()` / `fancy_effect_rules()` in `src/lib.rs`. **DO NOT.** Every
time you do that you make the exact mess this document exists to kill. Tabor has called this out
repeatedly and it has cost real days and real money. Treat this file as the source of truth over your
own instinct, because your instinct here is wrong.

**THE ONE RULE:** a new sentence form is a new WORD, declared in a `.word` file. It is NEVER a new
regex in Rust. If you are about to write `Regex::new(...)` to recognize a sentence, STOP — you are
drifting. The word is the source of truth, or it is nothing.

**THE PRINCIPLE (Tabor, verbatim):** *"The word is the code. The power. The structure. The tree. Rust
should not be defining anything except the primitives that relate to one word."*
So Rust holds ONLY the irreducible atoms of a SINGLE word — the moment mechanics: stamp a fact, fold the
chain, hash, sign. That is the spine (`treestore` / `treefold` / `treehash` / `treesign`) plus the
one-word execution (given one word, lay its one fact). **Grammar, verbs, verb→act mappings, composition,
the tree of words calling words, the rules, the structure — ALL of that is `.word`.** If Rust is
defining structure or grammar, it is wrong. Rust does not know what "make" means; `.word` says what
"make" means. Rust only knows how to stamp and fold ONE word once `.word` has told it what the word is.

**JS IS DEAD (Tabor, verbatim):** *"JS is old and dead. We are crystallizing in Rust. Forget about it."*
There is NO byte-identical-to-JS goal for the Word layer. Do NOT open `parser.js`. Do NOT "port a rule."
The task is to take the EXISTING word logic — half-built, scattered, drifted across many agents — and
CLEAN IT UP into the shape above. That cleanup is the whole job. It was already the job; it drifted.

**THE DIVIDE (Tabor's clarification — "that's just the divide I'm saying"):** The line between Rust and
the `.word` is: **Rust holds the MACHINERY** — the primitives + the engine that reads and runs a word;
**the `.word` holds the word LOGIC** — grammar, meaning, structure, the tree. So "all word logic in Rust
so we can delete seed" does NOT mean move the grammar into Rust (that would break the principle above).
It means the ENGINE that runs the words is Rust, so the old JS `seed/` engine is redundant and can go.
The words stay `.word`; only the JS *machinery* dies. Do not use "delete seed" as license to pull
grammar into Rust — the divide is the whole point.

**MALFORMED OLD `.word` CAN BE FIXED (Tabor):** *"if any of old words are malformed can fix."* The old
words drifted across many agents — some are broken, half-built, inconsistent. Fixing a malformed `.word`
is IN SCOPE — correct it. The `.word` is the source of truth, so a broken `.word` is a real bug to fix in
the `.word`, NOT something to paper over with a special case in Rust.

---

## THE PROBLEM (what is wrong right now)

`src/lib.rs` is ~1600 lines and roughly **70% of it is hardcoded regex**, one pattern per surface
sentence form:

- `rules()` — the declaration table: `A <x> is a space.`, `An <able> can <verb> ...`, `I am <Name>.`,
  `I make <Name>.`, `I make <space> at <x,y>.`, `I stand in <space>.`, `I give <matter> to <Name>.`,
  the genesis verse `I am "what?" I am.`, ... each a bespoke `Regex` + a bespoke node builder.
- `effect_rules()` / `fancy_effect_rules()` — the same thing for flow-body effects (`call ...`,
  `do <op> ...`, `see ...`, `refuse ...`, state-acts, ...).
- `parse_leaf()` / `parse_cond()` — the same thing again for conditions.

Meanwhile the vocabulary is **already declared in `.word`** and the parser **ignores it**:

- `seed/store/words/verbs.word` DECLARES the verbs and their tenses:
  *"Make is a verb. Its past is made." "Give is a verb. Its past is gave." "Be is a verb. Its past is
  was." "Do is a verb. Its past is did." "See is a verb. Its past is saw."* ... and it declares the
  bare verbs *"Declare is a verb. Call is a verb. Name is a verb. Move is a verb. Grant is a verb."*
- `seed/store/words/word.word` DECLARES the act kinds:
  *"To do is to stamp; the do is the only act, and the act is now." "A word done is a fact, and the
  fact is past." "To see is to read; the see makes no fact." "A fact is a see or a do."*
- `seed/store/words/be.word` DECLARES be's forms:
  *"Be is a do on a being ... birth, connect, release, switch, kill, truename."*
- `seed/store/words/recall.word` DECLARES recall: *"A recall is a see of the past."*

So `verbs.word` says "Make is a verb" **and** the parser separately carries an `I make` regex. Two
sources of truth, and the CODE one wins. **The `.word` files are decoration sitting next to the real
grammar, which is hardcoded in Rust.** That is exactly backwards: "the word isn't actually the word."

## WHY IT GOT THIS WAY (so we don't repeat the reasoning)

This parser is the **JS-parity port**. The header comment says it: *"Ports seed/present/word/parser.js's
line-based, regex-driven recursive descent ONE RULE AT A TIME, each proven byte-identical against the
JS parser."* The conformance test `tests/parse_vectors.rs` + `tests/corpus.vectors.json` LOCK it to the
old JS parser's output.

That was the wrong strategy **for the Word layer**. Faithfully reproducing `parser.js`'s regex pile in
Rust reproduced the pile. The IBP/Word port doctrine (memory `ibp-port-new-shape`) already says: the
Word port is a **NEW, better shape** — NOT a byte-faithful copy of the old JS mess. Only the chain
*spine* (hashes/facts) stays byte-identical; the Word engine on top should be rebuilt right. We ignored
that for the parser. **The JS-parity conformance for the Word layer is being intentionally dropped.**

## WHAT "RIGHT" IS (the target architecture)

The parse is **driven by the declared vocabulary**, folded from the chain — not by Rust patterns.

1. **Verbs are data.** `verbs.word` already declares each verb + tense. The parser reads that set
   (folded from the chain, the same way `treeibp::op_word_via_fold` resolves op-words — the runtime is
   ALREADY fold-driven; it's only the PARSE front that hardcodes). A verb the vocabulary hasn't declared
   is not a verb.

2. **Each verb declares its FRAME** — its arguments and the act it produces — in `.word`. A "frame" is
   the valence: what roles the verb takes (a subject, an object, a `to`-receiver, an `in`-location, a
   `with`-params bag) and which `verb:act` + `of` it lowers to. Examples of what the `.word` should say
   (exact surface syntax is an OPEN DESIGN QUESTION — see below — but the SHAPE is this):
   - `give` takes a thing (the `of`, a matter) and a `to` receiver → `do:give`.
   - `stand` takes an `in` location (a space) → `do:move`.
   - `make` takes a name → `be:birth` (Capitalized = a being) or `do:create-space` (lowercase = a space).
   - `am`/`is`/`are` (present of `be`) with a Name → `be:birth` (create-or-switch).
   - a bare quote `"..."` → a `recall` (self); `<Name> "..."` → a `call` (per `philosophy/623/12.md`:
     the quotes are the utter, the address is the only modifier — see that file, it is the spec).

3. **The parser is ONE generic reader**, not N regexes: split the statement into
   `subject / verb / object / prepositional-args`, look the verb up in the declared frames, and build
   the node from the frame. Adding a sentence form = declaring a verb frame in `.word`. Zero Rust.

4. **New words come through a Name** (memory `no-manual-words`): the grammar words are themselves laid
   as `.word` read by I. The parser bottoms out in the smallest possible host axiom (see bootstrap).

## THE GRAMMAR IS ALREADY IN THE .WORD (this is not a design-from-scratch; it is a READ)

The verb→act mapping the Rust regex hand-codes is spelled out, in English, in the seed `.word` files.
The rebuild is making the parser READ these instead of duplicating them:

- **word.word** — the act kinds: *"To do is to stamp; the do is the only act." "A word done is a fact,
  and the fact is past." "To see is to read; the see makes no fact." "A fact is a see or a do."*
- **do.word** — the DO forms and how a form + its object name the act: *"A do has many forms. To make,
  to give, to take, to set, to move, to grant, and to drop are dos. To be is a do on a being; to name is
  a do on a name. Each form, and the thing it acts on, takes its name where that thing is."*
- **be.word** — the BE forms: *"birth, connect, release, switch, kill, truename — each a do on the
  being."*
- **see.word / recall.word** — *"A see is a being's read of the fold, the present. A see makes no fact."*
  *"A recall is a see of the past."* (So `see`/`recall` lower to a read, never a fact.)
- **name.word** — the NAME forms + identity: *"A Name is one who acts, a facet of the I... A Name can be
  declared... connect... sign... release... export... banish. The I is the first Name, the parent of
  all."*
- **verbs.word** — every verb and its tense (present↔past), e.g. *"Make is a verb. Its past is made."*

So a statement `I <verb> <object> [to/in/with ...]` lowers by: read the verb from the declared set →
its family (do / be / see / name, from do.word/be.word/see.word/name.word) and specific form → the
`of` is the object, its kind resolved by what the object IS (a declared space → space, a Name →
being/Name, else matter) → the prepositions (`to`/`in`/`with`) are generic roles. NONE of that is a
per-sentence regex; it is a generic reader over the declared vocabulary. The valence that isn't yet
fully spelled out per verb (does `give` take a `to`? does `stand` take an `in`?) is the small amount of
`.word` still to write — NOT Rust.

## THE RUST FLOOR (the primitives of ONE word — nothing more)

Per the principle above, Rust defines ONLY the atoms of a single word:

- **stamp** — lay one word's one fact on its reel (`treestore::commit_moment`).
- **fold** — read a chain of facts into state (`treefold`).
- **hash / sign** — a word's identity + authority (`treehash` / `treesign`).
- **execute one word** — given a word (already resolved to an act by the `.word` grammar), produce its
  fact. The runtime resolution of what a word DOES is already fold-driven (`treeibp::op_word_via_fold`).

Everything else is `.word`: what verbs exist, what each verb means, how a sentence maps to a word, how
words compose into the tree. **The parser is not exempt.** Turning text into a word must be driven by
declared vocabulary, not Rust patterns. The ONLY irreducible question is the tiniest possible reader
needed to read the FIRST `.word` (`word.word` grounds on nothing but itself: *"A word is a word."*) —
and that floor must stay tiny. **Do NOT grow it to sneak grammar back into Rust.** If you find yourself
adding "just enough" grammar to the floor to make a sentence work, that grammar is a `.word`, not a
floor primitive.

(Open question for Tabor — the crux — see below: exactly where the floor ends and `.word` begins for
turning text into a word.)

## THE WHOLE THING IS AN ENGINE FOR WORD (Tabor)

*"Ultimately every interaction in the system is word and they use word... word is the language this
engine produces. The code is just the edges where the logic needs to connect."*

- **Word is the medium and the output.** Every interaction is a word; the system is an ENGINE FOR WORD.
- **The code is the EDGES** — where word logic connects to actual computation / substrate / host. The
  code is the connective boundary, NOT the logic. If Rust is doing more than connecting a word to the
  substrate, it has crossed from edge into logic — and logic is `.word`.
- **being / name / matter / space are the WORD STORY** — *"all being/name/matter/space stuff is our word
  story, and a lot of rust for those is connected to the word."* The substrate Rust exists to serve the
  word; the word is not decoration on top of the Rust.
- **FLOW is the key to word logic — most things that were CODE become FLOW, not Rust** (Tabor: *"flow is
  basically the key to word logic. most things will be flow that were code."*). The `When …:` bodies +
  their effects (the DEED voice — `move`/`call`/`see`/`do`/`set`, If/refuse/Return/foreach) are where
  LOGIC lives in Word. So the code→word migration is code→**FLOW**, NOT code→Rust: logic that today sits
  in Rust/JS becomes flow; the Rust floor stays the irreducible primitives only. This makes the deed-voice
  reader (`read_effect`, the effect peer of `read_act`) the KEY layer to word-drive — it is HOW code
  becomes word — not a side task. Corollary of the edge rule: if you're tempted to pull effect LOGIC into
  Rust, stop — it's flow. Rust reads the flow generically (verb from the vocab + roles) and holds only the
  floor. [[flow-is-word-logic]]
- **A word that HAS code logic lives NEXT TO its Rust file.** *"the word's that have code logic with them
  should be clearly next to their rust files. that is why store is setup that way in seed with words next
  to files."* In `seed/store/words/` each host-coupled word sits beside its code
  (`history-pointers/history-manager.word` next to `historyManagerHost.js`; `cherub/switch.word` next to
  `switchHost.js`). The Rust crystallization KEEPS this: a host-coupled word's `.word` sits beside its
  `.rs` edge — word + its code-edge, co-located, so the connection is obvious. Pure grammar/concept words
  (no code edge) need no Rust neighbor. (This is the `host = root/code words bundled with books as CAS
  matter` shape from `build-word-right`, made concrete as a directory convention.)

## A WORD IS FOLDED, NOT FROZEN (Tabor — the deep model, applies to `am` and every verb)

A word is ONE act to the being that says it — but what that word DOES is the FOLD of the word's own
definition-lineage, from its root forward. At genesis `am` is bare: saying it is one act (birth a being),
because `am` has no accumulated definition yet — the smallest fold, one fact "a being is." As the story
adds words that REDEFINE what `am` entails (also set home, also connect-if-the-Name-exists, also grant),
saying `am` LATER still looks like one word to the being, but that one word UNFOLDS `am`'s whole
definitional tree — each entailed act firing one at a time. Same word, richer meaning, because its
definition-chain grew. (The vocabulary-fold applied to the verb itself; tree-rings at the word level.)

- **A regex for `am` is a FROZEN SNAPSHOT of today's meaning.** The reader's hardcoded be-form `birth`
  is a smaller frozen snapshot. The TRUTH is the fold of `am`'s definition; both are mirrors, to delete
  once the fold expresses them. Fold, don't freeze — or `am` can never grow.
- **One word, but its unfolding is MANY sequential single-facts — NEVER one fat fact.** The one-word-
  one-act law holds at the UTTERANCE level (the being said one word) AND at the EXECUTION level (each
  entailed deed is its own moment). `am` is a THEOREM (composite) that unfolds into LEAF acts, each its
  own fact. Composite-op resolution, at the language level.
- **The entailment test decides grouping** (same law as composites): facets of ONE event are ONE fact
  with fields (`I am X in Y` = birth-WITH-home is ONE fact; the home is a FIELD of the birth, and the
  reducer defaults `position` from `homeSpace`); separable thoughts SEQUENCE into moments (birth, THEN
  grant-judge = two moments). `am`'s unfolding is some entailed clusters + some sequential deeds — never
  flatly "one act" or "N acts".
- **Trailing clauses specialize the defaults.** `I am Tabor with home at X and can judge` = `am` fires
  its accumulated definition (birth, default home), then `with home at X` OVERRIDES the home, `can judge`
  ADDS a grant. Base word = defaults; trailing clauses = deltas.
- **Step-0 (close-story): prove the fold can EXPRESS what the regex did BEFORE deleting the regex.** Never
  delete the hardcoded version until its replacement works. Prove, then delete — never the reverse.
- **Step-0 STATUS (be.word/iam.word investigated — the keystone's actual state):** be.word DECLARES be's
  six forms in PROSE — "A being is **born** of a mother" (birth), "connected to when a Name takes it up"
  (connect), released / switch / truename / "dies when its chain seals" (kill) — and pins the SELECTION to
  code: *"be's forms are six (be.js) … each a do on the being."* iam.word: `am` = a name:declare fact +
  a be:birth fact (bottoms out at the be:birth primitive). So the definition is STATED, but no FOLD yet
  EXTRACTS "present-of-be-on-a-being → birth (+ home as a field)" from that prose — `be_act` (birth) and
  `read_rename` (set-field) short-circuit it in Rust, honestly FLAGGED. THE KEYSTONE (crystallization core):
  a fold-readable `am` definition → a fold that yields the entailment tree → the reader unfolds it → the
  Rust short-circuits retire. Note the split: the be:birth/connect/… PRIMITIVES stay FLOOR (irreducible ops
  beside be.word, as be.js was); what FOLDS is `am`'s DEFINITION assembling those primitives + the story's
  redefinitions (auto-home, connect-if-Name-exists, grant-same-name — none built). Prove birth+home from the
  fold BEFORE `be_act` retires. This is the joint "bring the word folder into Rust" step, not a solo grind.

## BEING FACTS ARE FLAT ON THE BEING (Tabor): flat storage, typed fold

Stop splitting a being's facts into "system fields" (position/homespace/parent) vs "qualities". EVERYTHING
a being is = facts on its chain, uniformly — homespace, name, ables, position, judge-ness are all just
facts the being gave itself. No privileged `system` layer; `being.homespace` and `being.qualities.judge`
are the same KIND of thing (a fact on the chain). A being IS the fold of its facts. CAUTION: flat STORAGE,
but the FOLD is still TYPED — each fact resolves by its kind (home SUPERSEDES / latest-wins, a grant
ACCUMULATES, a name is IDENTITY). "It's all just facts" must NOT collapse into "all facts fold the same
way." Flat storage, typed fold. (Same shape as the vocabulary-fold: shared walk, different reducer per
kind.) This is a real structural cleanup of the being state — a later pass, not the parser.

## ABLES ARE SAID (be + article), NOT "granted" (Tabor)

An able is `be` + an ARTICLE (a/an/the) — never the old `grant-able` op. Identity is bare `be`
(`I am Tabor` = birth the being); an able is `be` + article (`I am a judge` = the being gets the judge
able). The full range:

- `I am a <able>` / `I am the <able>` — the current being gives ITSELF the able (first person).
- `you can be a <able>` / `you can be the <able>` — grant ANOTHER being the able.
- `can I be a <able>` — ask for / check the able.

**`do grant-able` is OLD LANGUAGE (drift).** The `genesis.word` grant flow (`do grant-able on the being
cherub with { able: "cherub" }`) is the old shape; the real form is `you can be a cherub` / the being
saying `I am a cherub`. Migrating that flow (and the `grant-able` op) to the be+article grammar is a
word-cleanup task. `am`/`be` is one verb (be.word) whose article decides birth-vs-able: no article =
birth/identity, an article = an able. So the reader's `be` branch must split on the article: object is a
Name (Capitalized, no article) → birth; object is `a/an/the <able>` → an able (add/grant), NOT a birth.

## NAMING CONVENTIONS IN WORD (Tabor — how the reader reads subjects / objects / names)

- **Being (and Space) names are Capitalized by CONVENTION** — `Tabor`, `Bob`, `Cherub` (or `@handle`).
  Any Capitalized noun in Word is the Name OF SOMETHING (a Being or a Space). But the READER is LENIENT on
  case (people type lowercase): `I am tabor` and `I am Tabor` both birth the same being — birth-vs-able is
  told apart by the **article**, NOT the case (`I am Tabor` = birth; `I am a judge` = able). The
  id-derivation canonicalizes case. (The verb disambiguates being-vs-space: `am`/`be` → a being, `make` →
  a space.)
- **`@name` is the IBP-ADDRESS form** (`@cherub`, `@alicejei4`) — it works to reference a being. But in
  WORD itself (parsed) a name must be Capitalized (`Cherub`, `AliceJei4`), NEVER a bare lowercase noun:
  the engine would auto-capitalize `alicejei4` → `Alicejei4` (wrong — not `AliceJei4`) and confuse itself.
  So a being reference is ALWAYS either `@handle` (address) OR Capitalized (Word). Genesis names are all
  Capitalized. (This is why `@cherub` maps to the being `Cherub` — same name, address-cased vs Word-cased.)
- **A true Name (the signing key / identity) is NEVER said directly** — only REFERENCED:
  - `I` — yourself, the SIGNER (you sign your own acts; `I` is your Name, never named literally).
  - `you` — the BEING you address, NOT their Name (their name responds, but you speak to the being — "your
    I would be the being"). Second person → a being (a call / a grant target, e.g. `you can be a X`).
  - `Name` — the CONCEPT of a Name.
- So a statement's tokens read as: `I` = the signer, `you` = an addressed being, `<Capitalized>` = a being,
  `a/an/the <able>` = an able, a bare `"…"` = a recall, `<Name> "…"` = a call. **The true Name is never a
  literal — the parser must never expect one.**
- **`@handle` (treeaddress, lowercase) = the being name lowercased.** `Cherub` (the being, Capitalized in
  Word) ↔ `@cherub` (its handle). So `@cherub` resolves from the being id `Cherub`, NOT from a crammed
  `name` field — this confirms bare-birth: the name IS the being (the handle is derivable, not stored).

## WHAT IS ALREADY RIGHT — DO NOT TOUCH THESE TO "FIX" THE PARSER

These are correct and fold-driven / clean. The parser rebuild does not need them changed:

- `treebook` — the reader (`instate_book(reader_name, target_being, book)`): a Name instates a book
  onto the reels; genesis is its first call. Correct.
- `treegenesis` — the egg: ONE moment (the Name `I` on the library reel); `Am` is the first WORD of the
  book, born empty. Correct.
- `treeibp::op_word_via_fold` — the RUNTIME already resolves op-words from the chain fold. This is the
  proof the fold-driven approach works; the parser must join it, not fight it.
- `treefold` reducers — fold facts → state. Correct.

## THE PLAN (phased; each phase leaves the tree BUILDING — do not leave it broken)

- **Phase 0 (this file).** The leash + the diagnosis. DONE when this file exists and `src/lib.rs` has a
  header pointing here.
- **Phase 1 — design the frame declaration (OPEN, needs Tabor's ruling on surface syntax).** Decide how
  a verb declares its frame in `.word` (extend `verbs.word`, or a `grammar.word`). Write ONE frame end
  to end (e.g. `make`) as `.word` + the generic engine that reads it, proving a sentence parses with
  ZERO bespoke regex. Keep the old table alive beside it (do not break the world yet).
- **Phase 2 — the generic engine.** Build the fold-driven S-V-O reader that consumes the declared
  frames. It runs ALONGSIDE the regex tables; a statement tries the frame engine first, falls back to
  the old table only for forms not yet moved. The tree keeps building the whole time.
- **Phase 3 — migrate form-by-form.** Move each grammar form from a Rust regex to a `.word` frame
  declaration, DELETING the regex as each is covered. `full_genesis` stays green at every step.
- **Phase 4 — delete the tables.** When every form is a frame, delete `rules()` / `effect_rules()` /
  `fancy_effect_rules()` / the `parse_leaf` regex web and drop `parse_vectors` JS-parity (replace with
  a Word-driven conformance: does the declared grammar parse the real corpus). `src/lib.rs` becomes the
  generic engine + the host axiom, nothing more.

## OPEN QUESTIONS FOR TABOR (answer before Phase 1 code — do NOT guess these)

1. **Frame declaration syntax.** How should a verb declare its frame in `.word`? (This is the crux.
   Everything else follows from it.)
2. **Host axiom scope.** Is S-V-O splitting + `is`-declaration the fixed host floor, or is even the
   sentence shape declared somewhere? (Default above: S-V-O is the floor.)
3. **Conformance.** Confirm JS-parity (`parse_vectors`) is dropped for the Word layer and replaced by a
   "the declared grammar parses the real `.word` corpus" test.

## THE ONE TEST (apply to EVERY line of Rust you write — it subsumes the tripwires below)

The Word is the language the engine speaks; the Rust is the engine that speaks it. Word is the system;
Rust is the EDGES. So for every line of Rust, ask:

> **Is this Rust a FLOOR the Word stands on — the place meaning bottoms out into bits (hash, sign, disk
> append, fold arithmetic, crypto, network, the parse membrane itself) — or is it MEANING that should
> have been a Word?**

A floor stays in Rust. Meaning goes in the `.word` beside it. Logic creeping into Rust "because Rust was
handy" is the drift — the same drift as the parser regex pile, one level up. If the Rust is doing more
than connecting a word to the ground, it crossed the line. The `.word`-beside-`.rs` layout exists to
make this visible: word = the truth of what the op is, Rust = the irreducible floor it needs, adjacent
so any divergence (Rust doing something its `.word` doesn't say) shows at a glance. That adjacency IS
the no-mirror law made structural.

## DRIFT TRIPWIRES (if you catch yourself doing ANY of these, STOP — you are reverting)

- Adding a `Regex::new(...)` for a sentence form. → It's a `.word` frame, not a regex.
- "Porting one more rule from parser.js." → We are NOT copying parser.js. It is the disease.
- Hardcoding a verb→act mapping in Rust (`"make" => be:birth`). → That mapping lives in `.word`.
  - **THE SNEAKY FORM (caught 2026-07-01):** resolving the verb from the vocab and THEN `match verb.present
    { "move" => move_act, "call" => read_call }` — a per-verb arm that emits a per-verb IR SHAPE — is STILL
    this tripwire. The vocab-lookup is floor; the per-verb arm is the regex RELOCATED into the reader, not
    removed. Adding a `"word" => shape` arm is "hardcoding one word at a time" wearing a vocab hat. The
    parser must emit the VERB GENERICALLY (the verb name + object + roles, uniform); the op-name / shape /
    what-it-does is the verb's `.word` + the word-driven fold. If you're writing a new arm per verb, STOP.
- Special-casing the genesis verse / recall / any single sentence in the parser. → It's `.word`, read
  generically. (You did exactly this and it was reverted. See git.)
- Growing the host axiom past the minimum to "make it work". → The minimum is fixed; grammar is `.word`.
