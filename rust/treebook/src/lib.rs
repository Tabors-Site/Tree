// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treebook - THE GUARDED BOOK-READER. The FIRST rung of "I reads the book word by word" (20.md: a
// one-time bootstrap seed in the host; after ignition, Word runs Word). After genesis plants the Name
// "I" + the being "Am" (the razor-thin host turtle), I reads a BOOK - a sequence of .word STATEMENTS - SEQUENTIALLY, each
// statement ONE act on chain. A statement is one Word; reading it lays its fact(s) through the RUNNER
// (treeibp), the SAME act path every later Word takes. The root book is word.word; later increments add
// the rest of the seed (verbs.word, the concepts, the ops). This crate reads ONE book; word.word is the
// first.
//
// EACH WORD IS AN ACT. word.word's statements are DECLARATIONS ("A word is a word.", "To do is to
// stamp."): prose the parser reads as `kind:"is"` concept-declarations (and prose it reads as nothing).
// Mirroring the JS reference (wordFold.js declareConcepts -> wordStore.js bindWord, which lays one
// `do:coin` carrying `{kind:"concept", says, axiom}`), the reader turns EACH non-empty, non-comment
// statement into ONE declare-word act: a `do:coin` on the being Am's reel, by/through the Name "I",
// `params:{ word, ownerExtension, binding:{ kind:"concept", says } }`. That coin fact IS the foundation
// landing on Am's PUBLIC reel, foldable back by treewordfold (a word resolves because its coin fact
// exists - the vocabulary is the FOLD, not a code table). The reader is GENERIC over the statements: it
// never assumes a fixed genesis set.
//
// THE NAME-BEING SPLIT (project_name_being_refactor). The vocabulary lives on the being "Am"'s public
// fact reel (the chain every being can see and fold), NOT on the Name "I" (whose act chain is private).
// The Name I is the SIGNER (I signs, I has authority over Am); the being Am is the reel the coins land
// on AND the vehicle they act THROUGH - "the I doing it AS Am". So every vocabulary coin is
// `of:{kind:"being", id:"Am"}, by:"I" (the signature), through:"Am" (the being it acts through)`. The ONE
// exception is the genesis be:birth that CREATES Am (the bootstrap): Am does not exist yet, so that act
// stays `through:"I"` (treegenesis's genesis-bootstrap attribution). Everything POST-Am is through Am.
//
// TWO GUARDS - the "system" that lets us find and fix broken words as we read, so we can build the book
// out one .word at a time and have it all flow:
//
//   GUARD 1 (ONE WORD = ONE ACT). Each ACTING word (a coin / a do / a be / a name) must lay EXACTLY ONE
//     fact. A run-on word that lays >1 fact is REFUSED (RunOn), naming the offending word + the crammed
//     facts. A `see` word lays 0 facts (inert - a read makes no fact: "the see makes no fact"); that is
//     fine. The read is SEQUENTIAL, so the FIRST offender surfaces in book order (we fix it, then read
//     on). This is the Spacebar Law (project_spacebar_moments) enforced at the reading mouth.
//
//   GUARD 2 (MISSING LOGIC). A word may bottom out in a host see-op escape - `see <host-op>(args)` - the
//     strand a host-coupled word reaches for substrate it cannot author as a Word literal. For the word
//     to RUN, that host-op's logic must be REGISTERED: treehost::Resolvers must resolve <host-op>. A word
//     that names an UNREGISTERED see-op is host-reserved but its logic is missing - REFUSED (MissingLogic),
//     naming the word + the op. A word with NO see-op escape is improv (a pure-Word declaration) and is
//     fine. The registry IS the identification: a handler self-identifies by being registered. There is
//     NO declared host-vs-improv table - we ask the registry, never a manifest.
//
// This is a STORE/word component, NOT the kernel spine: it composes the runner (treeibp), the parser
// (treeword), and the host registry (treehost). It does not touch treestore/treeverify reducers.

use std::path::Path;

use treehash::Json;
use treehost::{AuthCtx, HostResolver, Resolvers};

// ── tiny Json helpers (treebook stays dependency-light) ──────────────────────────────────────────────

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn get_str<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// The being "Am" - the reel every declare-word fact lands on (the first being's id). The name-being
/// split: the vocabulary reel is the being "Am" (treewordfold::AM_BEING), NOT the Name. A fresh
/// Rust-planted Story keys this reel by "Am". Kept here so the reader lays the coin
/// `of:{kind:"being", id:AM_BEING}` and the fold (treewordfold) reads the SAME reel.
pub const AM_BEING: &str = "Am";
/// The SIGNER of every coin - the Name "I" (I signs, I has authority over Am). The reader's actor +
/// the coin's `by`/`through`. Distinct from `AM_BEING` (the reel the coin lands on).
pub const I_NAME: &str = "I";

/// The provenance every genesis declare-word carries (wordStore.js bindWord's default ownerExtension).
const SEED_OWNER: &str = "seed";

// ── the guards' refusal ──────────────────────────────────────────────────────────────────────────────

/// What the guarded reader refuses with - a CLEARLY NAMED error per guard, carrying enough to find and
/// fix the broken word (which word, what it crammed / what op it named). Sequential reading means a
/// `RunOn` / `MissingLogic` is the FIRST offender in book order.
#[derive(Debug, Clone)]
pub enum BookError {
    /// GUARD 1: an acting word laid MORE THAN ONE fact (a run-on - it crammed several Words into one).
    /// Carries the statement text + the count + the crammed fact verb:act pairs, so the offender is
    /// named and the cram is visible. The Spacebar Law: one word = one fact = one moment.
    RunOn {
        word: String,
        facts: usize,
        crammed: Vec<String>,
    },
    /// GUARD 2: a word's `see <op>` escape names a host op no resolver has REGISTERED (treehost can't
    /// resolve it). The word is host-reserved but its logic is missing. Carries the statement + the op.
    MissingLogic { word: String, op: String },
    /// The runner DENIED the word's act (authorize/seal refusal) - not a guard, the act itself failed.
    /// Carries the statement + the runner's reason. (Genesis reads run as I, which authorize bypasses,
    /// so this is for a malformed act, not a permission denial.)
    Denied { word: String, reason: String },
}

impl std::fmt::Display for BookError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BookError::RunOn { word, facts, crammed } => write!(
                f,
                "GUARD 1 (one word = one act): the word `{word}` is a RUN-ON - it laid {facts} facts ({}), but a word lays exactly one. Split it into {facts} words.",
                crammed.join(", ")
            ),
            BookError::MissingLogic { word, op } => write!(
                f,
                "GUARD 2 (missing logic): the word `{word}` reaches the host see-op `{op}`, but no resolver is registered for it. The op is host-reserved and its logic is missing - register `{op}` (treehost) or remove the escape."
            ),
            BookError::Denied { word, reason } => {
                write!(f, "the word `{word}` was denied by the runner: {reason}")
            }
        }
    }
}
impl std::error::Error for BookError {}

/// One word's outcome as the reader saw it: the statement, the fact it laid (its `_id`), and the
/// verb:act it recorded - or, for an inert `see`, no fact. The book's read trail.
#[derive(Debug, Clone)]
pub struct WordRead {
    /// The statement text I read (one Word).
    pub statement: String,
    /// The fact id the word laid on Am's reel, or None for an inert `see` (a read makes no fact).
    pub fact_id: Option<String>,
}

/// The outcome of reading a whole book: the per-word trail + the count of foundation facts laid.
#[derive(Debug, Clone)]
pub struct BookRead {
    pub words: Vec<WordRead>,
    /// How many declare-word (coin) facts landed on Am's reel (the foundation that folds).
    pub facts_laid: usize,
}

// ── splitting a book into its statements (one Word each) ─────────────────────────────────────────────

/// Split a `.word` book into its STATEMENTS - the Words I reads one at a time. A statement is a
/// sentence ending in `.`; `#` comment lines and blank lines are skipped (they are the host's prose,
/// not Words - word.word's header literally says "In the beginning was the word is the host's line,
/// not the Word's"). The split is on the sentence terminator so a multi-clause sentence stays ONE Word
/// (the run-on guard then catches a sentence that tried to be several acts).
pub fn split_statements(book: &str) -> Vec<String> {
    // Drop comment lines first (a `#` line is host prose), keep the rest, then split on `.` terminators.
    let mut prose = String::new();
    for line in book.lines() {
        let t = line.trim_start();
        if t.starts_with('#') || t.is_empty() {
            continue;
        }
        prose.push_str(line);
        prose.push('\n');
    }
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in prose.chars() {
        if ch == '.' {
            let stmt = cur.trim();
            if !stmt.is_empty() {
                out.push(format!("{stmt}."));
            }
            cur.clear();
        } else if ch == '\n' {
            cur.push(' '); // a newline inside a sentence is a space (the sentence spans lines)
        } else {
            cur.push(ch);
        }
    }
    let tail = cur.trim();
    if !tail.is_empty() {
        out.push(tail.to_string());
    }
    out
}

// ── GUARD 2: does a statement's body reach an UNREGISTERED host see-op? ───────────────────────────────

/// Collect the host see-op names a statement reaches (its `see <op>(args)` escapes). The parser lowers
/// a `see resolve-X(args) as y` to `{ kind:"see", act:"resolve-X", ... }`; we walk the parsed nodes
/// (recursing into control-flow bodies) and collect each `see` node's `act`. A statement with no `see`
/// node reaches no host op (improv).
fn see_ops_of(statement: &str) -> Vec<String> {
    let nodes = treeword::parse(statement);
    let mut ops = Vec::new();
    collect_see_ops(&nodes, &mut ops);
    ops
}

fn collect_see_ops(nodes: &[Json], ops: &mut Vec<String>) {
    for n in nodes {
        if get_str(n, "kind") == Some("see") {
            if let Some(op) = get_str(n, "act") {
                ops.push(op.to_string());
            }
        }
        // recurse into the control-flow / flow bodies a word may carry (then/else/body/effects/cases).
        for key in ["then", "else", "body", "effects"] {
            if let Some(Json::Arr(b)) = get(n, key) {
                collect_see_ops(b, ops);
            }
        }
        if let Some(Json::Arr(cases)) = get(n, "cases") {
            for c in cases {
                if let Some(Json::Arr(b)) = get(c, "body") {
                    collect_see_ops(b, ops);
                }
            }
        }
    }
}

/// GUARD 2: is `op` REGISTERED in the host see-op registry (treehost::Resolvers)? We ask the registry,
/// never a declared table: a handler self-identifies by being registered. An UNKNOWN op surfaces as the
/// registry's `SEE_FLOOR reject-unknown` Internal refusal (its message contains "unknown see-op"); any
/// OTHER error (a substrate refusal: bad args, not-found) means the op IS registered (the resolver ran
/// and refused on its inputs). So: registered iff the registry's refusal is NOT the reject-unknown one.
fn is_registered(op: &str) -> bool {
    // Probe with empty args against a throwaway path; we only care whether the op is KNOWN to the
    // registry, not whether it would succeed on real inputs (that is the act's job, later).
    let probe_dir = Path::new("/nonexistent-treebook-guard2-probe");
    let res = Resolvers.resolve(op, &[], probe_dir, "0", &AuthCtx::i_am());
    match res {
        Ok(_) => true, // resolved on empty args - certainly registered
        Err(e) => !e.message.contains("unknown see-op"), // unknown == not registered; else registered
    }
}

// ── the coin act a statement lowers to (the declare-word, mirroring bindWord) ─────────────────────────

/// The word NAME a statement declares - its concept key. For an `X is a Y.` declaration the parser
/// surfaces the SUBJECT (`subject`), which is the concept being declared (word / fact / do / see / …);
/// otherwise the whole statement text is the name (a stable, content-derived key). This is the
/// `params.word` the coin carries, the key treewordfold folds the word-set by.
fn word_name_of(statement: &str) -> String {
    for n in treeword::parse(statement) {
        if get_str(&n, "kind") == Some("is") {
            if let Some(subj) = get_str(&n, "subject") {
                if !subj.is_empty() {
                    return subj.to_string();
                }
            }
        }
    }
    statement.trim_end_matches('.').trim().to_string()
}

/// Lower a statement to ONE declare-word FACT SPEC: a `do:coin` on the being Am's reel, signed by the
/// Name "I" and acted THROUGH the being "Am" ("the I doing it as Am"), with `params:{ word,
/// ownerExtension:"seed", binding:{ kind:"concept", says } }`. This is the Rust twin of wordStore.js
/// bindWord - one coin fact, the foundation landing on Am's PUBLIC reel. The `says` IS the statement text
/// (the concept's body), so the chain carries what the Word said of itself. A fact SPEC (not an act node)
/// so the reader seals it through the SAME moment path the runner uses.
///
/// THE COIN-FACT SHAPE (the viz coupling): every coin is `{ verb:"do", act:"coin", of:{kind:"being",
/// id:"Am"}, by:"I" (the signer), through:"Am" (the being it acts through), params:{ word,
/// ownerExtension, binding } }` on the being Am's reel. Coins are SEQ-ORDERED (chain order), APPEND-ONLY
/// (never mutated; a `do:retire` layers a disable, a re-coin re-enables), LAST-COIN-WINS. So a word's
/// FIRST-coin ordinal is fixed the moment it lands, and `symbol(word) = ALPHABET[coin_index]` stays
/// stable for the viz (see treewordfold::fold_word_set). Coining ONLY appends here - order preserved.
fn coin_spec(statement: &str) -> Json {
    let name = word_name_of(statement);
    obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("coin")),
        ("by", jstr(I_NAME)),      // the Name I signs
        ("through", jstr(AM_BEING)), // acted through the being Am (the vehicle) - "the I doing it as Am"
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(AM_BEING))])),
        (
            "params",
            obj(vec![
                ("word", jstr(&name)),
                ("ownerExtension", jstr(SEED_OWNER)),
                (
                    "binding",
                    obj(vec![("kind", jstr("concept")), ("says", jstr(statement))]),
                ),
            ]),
        ),
    ])
}

/// Is a parsed node an ACTING node (a do / be / name act that lays a fact)? A `see` reads (lays no
/// fact); an `is` declares (a concept - the reader coins it). The runner's `kind:"act"` IS an acting node.
fn is_acting_node(node: &Json) -> bool {
    get_str(node, "kind") == Some("act")
}

/// The acting fact SPECS a statement produces (GUARD 1's subject). Parse the statement, then:
///   - if it has ACTING nodes (`kind:"act"`: real do/be/name deeds), rasterize EACH to its fact spec -
///     a single acting word yields one spec; a run-on (a word the parser lowered to several acting
///     deeds) yields several (GUARD 1 then refuses). A `see`-only word yields ZERO specs (inert).
///   - otherwise it is a DECLARATION (an `is` concept, or pure prose the parser read as nothing): the
///     reader coins it as ONE concept declare-word spec (the foundation landing). word.word's
///     statements are all declarations, so each yields exactly one coin.
/// The actor ctx grounds any `$ref` in an acting node (none in a plain coin); for declarations it is unused.
fn acting_specs(statement: &str) -> Vec<Json> {
    let nodes = treeword::parse(statement);
    let acting: Vec<&Json> = nodes.iter().filter(|n| is_acting_node(n)).collect();
    if !acting.is_empty() {
        let ctx = obj(vec![
            ("identity", i_actor()),
            ("bindings", obj(vec![])),
            ("state", obj(vec![])),
            ("beings", obj(vec![])),
        ]);
        return acting
            .iter()
            .map(|n| treeval::rasterize_emit(n, &ctx, None))
            .collect();
    }
    // a `see`-only word lays no fact (inert); a declaration lays one concept coin.
    if nodes.iter().any(|n| get_str(n, "kind") == Some("see")) && !has_declaration(&nodes, statement) {
        return Vec::new();
    }
    vec![coin_spec(statement)]
}

/// Is the statement a DECLARATION (something to coin)? A parsed `is` node, OR pure prose the parser read
/// as nothing (word.word's structural lines). A `see`-only statement is NOT a declaration (it reads).
fn has_declaration(nodes: &[Json], _statement: &str) -> bool {
    nodes.is_empty() || nodes.iter().any(|n| get_str(n, "kind") == Some("is"))
}

/// The verb:act a fact SPEC records (for the run-on report).
fn spec_verb_act(spec: &Json) -> String {
    let verb = get_str(spec, "verb").unwrap_or("?");
    let act = get_str(spec, "act").unwrap_or("?");
    format!("{verb}:{act}")
}

// ── reading one word (one act), guarded ──────────────────────────────────────────────────────────────

/// The actor for the read: the Name "I" (beingId + nameId "I"). I is the SIGNER; it authors the genesis
/// vocabulary onto the being Am's reel. authorize bypasses for I (the bootstrap axiom: beingId "I" hits
/// the I-Am bypass, and I hasAuthorityOver "Am"), so the coin always lands. The TARGET is Am (the reel),
/// the ACTOR is I (the Name) - the name-being split.
fn i_actor() -> Json {
    obj(vec![("beingId", jstr(I_NAME)), ("nameId", jstr(I_NAME))])
}

/// Seal ONE acting word's fact spec as a MOMENT on its reel (act-first, via treestore's doctrine-correct
/// `commit_moment[_signed]`). The act WRAPS the fact: `{by, through, to, story, history, deltaF:[spec]}`
/// - one act, one fact, one reel. `sign` is the optional story-key signer (None -> unsigned). Returns the
/// laid fact's id, or a seal-failure reason. This is the SAME seal `treeibp::seal_one` runs, reused so
/// the reader's writes are byte-identical to the runner's.
fn seal_word(
    spec: &Json,
    kind: &str,
    id: &str,
    dir: &Path,
    history: &str,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Result<String, String> {
    // attach the reel `history` to the fact (seal_moment keys each fact's reel by its own history).
    let fact = match spec {
        Json::Obj(e) if !e.iter().any(|(k, _)| k == "history") => {
            let mut e2 = e.clone();
            e2.push(("history".to_string(), jstr(history)));
            Json::Obj(e2)
        }
        _ => spec.clone(),
    };
    let by = get_str(spec, "by").unwrap_or(I_NAME);
    let through = get(spec, "through").cloned().unwrap_or_else(|| jstr(by));
    let act_doc = obj(vec![
        ("by", jstr(by)),
        ("through", through),
        ("to", jstr(by)),
        ("story", jstr(STORY)),
        ("history", jstr(history)),
        ("deltaF", Json::Arr(vec![fact])),
    ]);
    let ord = treestore::next_ord(dir);
    let committed = match sign {
        Some(s) => treestore::commit_moment_signed(dir, &act_doc, ord, s),
        None => treestore::commit_moment(dir, &act_doc, ord),
    }
    .map_err(|e| format!("{e:?}"))?;
    // read the stamped fact back to confirm it landed on the right reel.
    let fid = committed.fact_ids.into_iter().next().ok_or_else(|| "seal laid no fact".to_string())?;
    let _present = treestore::read_reel_file(dir, history, kind, id, None, None)
        .into_iter()
        .any(|f| get_str(&f, "_id") == Some(fid.as_str()));
    Ok(fid)
}

/// The story domain the reader's acts ride (act.story). The runtime story; "localhost" matches the dev
/// store, the same constant treeibp uses. The library reel id genesis planted under.
const STORY: &str = "localhost";

/// Read ONE word (one statement) onto Am's reel, with BOTH guards. `sign` is the optional story-key signer.
///
/// GUARD 2 fires FIRST (before any write): if the statement reaches an unregistered host see-op, refuse
/// - the word's logic is missing, so it must not lay a fact. Then lower the statement to its acting fact
/// specs; GUARD 1 refuses if it produced MORE THAN ONE (a run-on, naming the cram). Zero specs is an
/// inert `see` (fine). One spec is sealed as the word's single moment (authorize-gated, then committed).
fn read_one_word(
    statement: &str,
    dir: &Path,
    history: &str,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Result<WordRead, BookError> {
    // GUARD 2 (missing logic): every host see-op the statement reaches must be registered.
    for op in see_ops_of(statement) {
        if !is_registered(&op) {
            return Err(BookError::MissingLogic {
                word: statement.to_string(),
                op,
            });
        }
    }

    // lower the statement to its acting fact specs (a declaration -> one coin; an acting word -> its
    // deed(s); a `see` -> none). GUARD 1: a single word lays EXACTLY one fact (or zero for an inert see).
    let specs = acting_specs(statement);
    match specs.len() {
        0 => {
            return Ok(WordRead {
                statement: statement.to_string(),
                fact_id: None, // an inert read (a `see`-only word; no acting word in this statement)
            })
        }
        1 => {}
        n => {
            return Err(BookError::RunOn {
                word: statement.to_string(),
                facts: n,
                crammed: specs.iter().map(spec_verb_act).collect(),
            })
        }
    }
    let spec = &specs[0];
    lay_one_spec(statement, spec, dir, history, sign)
}

/// Seal one acting word's lone spec: AUTHORIZE it (treeibp's gate - I bypasses, the bootstrap axiom),
/// then commit it as a moment. A denial (a malformed act, never a permission issue for I) surfaces as
/// `BookError::Denied`. The reader's ONE write path for a single acting word.
fn lay_one_spec(
    statement: &str,
    spec: &Json,
    dir: &Path,
    history: &str,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Result<WordRead, BookError> {
    let (kind, id) = match get(spec, "of") {
        Some(o) => (
            get_str(o, "kind").unwrap_or("being").to_string(),
            get_str(o, "id").unwrap_or("").to_string(),
        ),
        None => ("being".to_string(), String::new()),
    };
    if id.is_empty() {
        // a state-only word (no reel target) - it laid no fact (treated inert here).
        return Ok(WordRead {
            statement: statement.to_string(),
            fact_id: None,
        });
    }
    let verb = get_str(spec, "verb").unwrap_or("");
    let op = get_str(spec, "act");
    let audit_being = if kind == "being" { Some(id.as_str()) } else { None };
    let actor = i_actor();
    let verdict = treeibp::authorize(verb, op, Some(&id), audit_being, &actor, dir, history, |_| None);
    if !matches!(get(&verdict, "ok"), Some(Json::Bool(true))) {
        let reason = get_str(&verdict, "reason").unwrap_or("not authorized").to_string();
        return Err(BookError::Denied {
            word: statement.to_string(),
            reason,
        });
    }
    match seal_word(spec, &kind, &id, dir, history, sign) {
        Ok(fid) => Ok(WordRead {
            statement: statement.to_string(),
            fact_id: Some(fid),
        }),
        Err(reason) => Err(BookError::Denied {
            word: statement.to_string(),
            reason,
        }),
    }
}

/// GUARD-1 demonstration / direct entry: lay a list of acting specs AS ONE WORD. If `specs.len() > 1`,
/// GUARD 1 refuses it as a run-on (this is exactly how the reader treats a statement the parser lowered
/// to several acting deeds). Exposed so a caller (or a guard test) can drive the run-on path with a
/// hand-built multi-deed Word, since the parser collapses run-together prose to a single act node. A
/// single spec seals as the word's one moment.
pub fn lay_word_specs(
    label: &str,
    specs: &[Json],
    dir: &Path,
    history: &str,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Result<WordRead, BookError> {
    match specs.len() {
        0 => Ok(WordRead {
            statement: label.to_string(),
            fact_id: None,
        }),
        1 => lay_one_spec(label, &specs[0], dir, history, sign),
        n => Err(BookError::RunOn {
            word: label.to_string(),
            facts: n,
            crammed: specs.iter().map(spec_verb_act).collect(),
        }),
    }
}

// ── reading a whole book, sequentially ────────────────────────────────────────────────────────────────

/// I READS A BOOK - the guarded, sequential read. Split the book into statements (one Word each), then
/// read each in order through `read_one_word` (both guards). The read is STRICTLY sequential, so a
/// guard's refusal is the FIRST offending word in book order (the reader stops there - we fix that word,
/// then read on). On success the foundation declare-word facts have landed on Am's reel and fold back via
/// treewordfold. `sign` is the optional story-key signer (the I key, threaded into each word's seal).
pub fn read_book(
    book: &str,
    dir: &Path,
    history: &str,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Result<BookRead, BookError> {
    let statements = split_statements(book);
    let mut words = Vec::with_capacity(statements.len());
    let mut facts_laid = 0;
    for stmt in &statements {
        let read = read_one_word(stmt, dir, history, sign)?; // STOP at the first offender
        if read.fact_id.is_some() {
            facts_laid += 1;
        }
        words.push(read);
    }
    Ok(BookRead { words, facts_laid })
}

/// Convenience: read a book UNSIGNED. word.word's reading needs no signer to demonstrate the guards +
/// the fold; the verification test threads the story key via `read_book` for the signed, verifiable path.
pub fn read_book_plain(book: &str, dir: &Path, history: &str) -> Result<BookRead, BookError> {
    read_book(book, dir, history, None)
}

// ── THE FULL GENESIS: I plant, I read the whole book, the world is born ──────────────────────────────
//
// plant_and_ignite lays the two razor-thin genesis moments (the Name "I" + the being "Am"); then I reads the WHOLE book strict:
//   1. the VOCABULARY (word.word -> the foundation -> the op/able bundles): each statement a concept
//      DECLARATION the reader coins (one do:coin per word). DECLARING a word lays its one coin WITHOUT
//      running its body — so the not-yet-handled words (federation/llm) coin fine; the runtime GUARD 2
//      only fires when a word is RUN (a `see <op>` escape executed), never when it is declared.
//   2. the CREATION sequence (the spaces, then the delegate births, then I's placement): plain natural
//      sentences (`I make heaven.`, `I make Cherub.`, `I stand in heaven.`) the reader lowers to real
//      acting facts (do:create-space / be:birth / do:move) and seals as moments on their reels.
//   3. the GRANTS (genesis.word): the flow whose effects grant each delegate the angel able at heaven +
//      its own able at the root. The grant flow references beings/spaces by name (`cherub`, `heaven`,
//      `root`) — refs the runner resolves against the ANCHOR bindings the reader holds (the ids it just
//      created). Run through treeibp::act_via_fold_bound (the real runner) so each grant is a moment.
//
// Everything is I's words; nothing is hardcoded. The roster (spaces + delegates) is the book's natural
// sentences; the grants are genesis.word. NODE-FREE: pure Rust over the spine.

/// The world I's reading brought forth — the anchors (name -> created id) + the tallies, for the caller
/// to verify the born world (the vocabulary folds, the spaces exist, the delegates exist, the grants
/// landed) and to render the creation story back from the chain.
#[derive(Debug, Clone)]
pub struct BornWorld {
    /// The planted I-name ("I").
    pub i_name: String,
    /// How many vocabulary words I coined (the foundation + ops + ables that fold back).
    pub vocabulary_coined: usize,
    /// The space anchors I created: name -> the space reel id (== the name here).
    pub spaces: Vec<(String, String)>,
    /// The delegate anchors I birthed: lowercase able-name -> the being reel id (the proper Name).
    pub delegates: Vec<(String, String)>,
    /// How many grant facts the grant flow laid (genesis.word's effects).
    pub grants_laid: usize,
}

/// What the full genesis can refuse with: a book error (a guard / denial reading the vocabulary or the
/// creation sequence), or a plain message (a missing source / a grant denial).
#[derive(Debug)]
pub enum GenesisBookError {
    Book(BookError),
    Message(String),
}
impl std::fmt::Display for GenesisBookError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GenesisBookError::Book(e) => write!(f, "{e}"),
            GenesisBookError::Message(m) => write!(f, "{m}"),
        }
    }
}
impl std::error::Error for GenesisBookError {}
impl From<BookError> for GenesisBookError {
    fn from(e: BookError) -> Self {
        GenesisBookError::Book(e)
    }
}

/// One creation source: a `.word` file's text, run through the strict reader as acting words.
fn read_creation(
    text: &str,
    dir: &Path,
    history: &str,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Result<BookRead, GenesisBookError> {
    Ok(read_book(text, dir, history, sign)?)
}

/// Is this `.word` text an OP-WORD BODY (a runnable word — a `When …:` flow header or a top-level
/// `see <op>` escape) rather than a pure CONCEPT-DECLARATION file (only `X is a Y.` sentences + prose)?
/// An op-word is COINED by name (one coin, no body run — the brief's "declaring lays one coin WITHOUT
/// running its body"); a declaration file is read per-statement (each concept its own coin). The check
/// is the body shape, not a manifest: a statement the parser lowers to a `flow` or a `see` node.
fn is_op_word_file(text: &str) -> bool {
    // Parse the WHOLE file (a `When …:` flow + its INDENTED body is one multi-line node — splitting on
    // the `.` terminator would collapse the newlines the parser needs, so parse the file verbatim with
    // its comment lines stripped). A `flow` or a `see` node anywhere means it is a runnable op-word body.
    let mut prose = String::new();
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with('#') {
            continue;
        }
        prose.push_str(line);
        prose.push('\n');
    }
    fn has_run(nodes: &[Json]) -> bool {
        for n in nodes {
            let kind = get_str(n, "kind");
            if kind == Some("flow") || kind == Some("see") {
                return true;
            }
            for key in ["then", "else", "body", "effects"] {
                if let Some(Json::Arr(b)) = get(n, key) {
                    if has_run(b) {
                        return true;
                    }
                }
            }
        }
        false
    }
    has_run(&treeword::parse(&prose))
}

/// COIN one word by NAME - `bindWord` faithful: lay exactly one `do:coin` on the being Am's reel carrying
/// the word + its binding (`{kind, says}`), WITHOUT running any body. Signed by the Name "I", acted
/// through the being "Am" (the vocabulary vehicle). This is how an OP-WORD enters the fold (its name
/// resolves) while its body stays unrun until invoked — so the not-yet-handled words (federation / llm)
/// coin fine; the runtime guard only fires when a word is actually RUN. Returns the coin fact id.
pub fn coin_word(
    word: &str,
    binding_kind: &str,
    says: &str,
    dir: &Path,
    history: &str,
    sign: Option<&dyn Fn(&Json, &[String]) -> Json>,
) -> Result<String, BookError> {
    let spec = obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("coin")),
        ("by", jstr(I_NAME)),        // the Name I signs
        ("through", jstr(AM_BEING)), // acted through the being Am (the vehicle)
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(AM_BEING))])),
        (
            "params",
            obj(vec![
                ("word", jstr(word)),
                ("ownerExtension", jstr(SEED_OWNER)),
                ("binding", obj(vec![("kind", jstr(binding_kind)), ("says", jstr(says))])),
            ]),
        ),
    ]);
    match seal_word(&spec, "being", AM_BEING, dir, history, sign) {
        Ok(fid) => Ok(fid),
        Err(reason) => Err(BookError::Denied {
            word: word.to_string(),
            reason,
        }),
    }
}

/// The op-word NAME a `.word` file declares — the word the file is the body of. The folder name is the
/// op (`create-space/create.word` -> `create-space`, `federation-manager/offer-template.word` ->
/// `offer-template`): the file STEM unless it is a generic `create.word` / `index`, in which case the
/// PARENT folder names the op (the seed's create-space alias). Falls back to the stem.
fn op_word_name(rel: &str) -> String {
    let path = std::path::Path::new(rel);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    if stem == "create" || stem == "index" {
        if let Some(parent) = path.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str()) {
            return parent.to_string();
        }
    }
    stem
}

/// THE FULL GENESIS, NODE-FREE. Plant "I" on a fresh store, then I reads the whole book and the world
/// is born. `seed_dir` is the seed root (its `store/` holds the vocabulary + the creation `.word` +
/// genesis.word; its `store/words/ables` holds the able words the grant runner folds). `dir` is the
/// FRESH store the world is written to (NEVER store/past). Returns the `BornWorld` anchors + tallies.
///
/// The reader is GENERIC: it coins whatever vocabulary statements it reads and seals whatever creation
/// acts it reads; the only host knowledge is the ANCHOR BINDINGS (the ids of the spaces/beings already
/// created), which the runner needs to resolve the grant flow's name refs — looking up an id you just
/// created is floor, the grant is the Word (exactly genesis.word's header doctrine).
pub fn full_genesis(
    seed_dir: &Path,
    dir: &Path,
    vocabulary: &[String],
) -> Result<BornWorld, GenesisBookError> {
    // 1. IGNITE - the two razor-thin genesis moments: the Name "I" + the being "Am".
    let (planted, key) = treegenesis::plant_and_ignite(dir, STORY)
        .map_err(|e| GenesisBookError::Message(format!("ignite: {e}")))?;

    // the story-key signer — the sig is ALWAYS `by` the Name "I" (I signs everything, whatever being it
    // acts through). Threaded into every coin + creation act + grant.
    let seed = key.seed;
    let sign = move |opening: &Json, fids: &[String]| -> Json {
        let payload = treesign::build_act_sig_payload(opening, fids);
        let value = treesign::sign_value(&seed, &payload);
        obj(vec![
            ("alg", jstr("ed25519")),
            ("by", jstr(I_NAME)),
            ("value", jstr(&value)),
        ])
    };
    let sign_ref: &dyn Fn(&Json, &[String]) -> Json = &sign;

    // 2. THE VOCABULARY — I coin each declared word. A CONCEPT-DECLARATION file (word.word + the
    //    foundation flats: only `X is a Y.` sentences) is read per-statement (each concept its own coin).
    //    An OP-WORD file (a `When …:` flow / `see <op>` body) is COINED BY NAME (one coin, body NOT run)
    //    — exactly the brief's key point: declaring a word lays one coin WITHOUT running its body, so the
    //    not-yet-handled words (federation / llm — the other agent's) coin fine; the runtime guard only
    //    fires when a word is actually RUN (the creation + grant sequence below). Dependency order.
    let mut vocabulary_coined = 0;
    for rel in vocabulary {
        let p = seed_dir.join(rel);
        let text = match std::fs::read_to_string(&p) {
            Ok(t) => t,
            Err(_) => continue, // a missing optional source is skipped (the survey discovers the set)
        };
        if is_op_word_file(&text) {
            // an op-word: one name-coin, no body run (the body runs only when the op is invoked).
            let name = op_word_name(rel);
            if !name.is_empty() {
                coin_word(&name, "op", &text, dir, "0", Some(sign_ref))?;
                vocabulary_coined += 1;
            }
        } else {
            // a concept-declaration file: each `X is a Y.` sentence its own concept coin.
            let read = read_book(&text, dir, "0", Some(sign_ref))?;
            vocabulary_coined += read.facts_laid;
        }
    }

    // 3. THE CREATION SEQUENCE — the spaces, the delegate births, my placement. Plain natural sentences
    //    the reader lowers to real facts. Each `I make <name>.` lays a do:create-space (a lowercase
    //    name) or a be:birth (a Capitalized Name) on the new reel; `I stand in heaven.` a do:move.
    let read_opt = |rel: &str, dir: &Path| -> Result<Option<BookRead>, GenesisBookError> {
        match std::fs::read_to_string(seed_dir.join(rel)) {
            Ok(text) => Ok(Some(read_creation(&text, dir, "0", Some(sign_ref))?)),
            Err(_) => Ok(None),
        }
    };

    // the SPACES (genesis-spaces.word) — collect each created space's anchor (name -> reel id).
    let mut spaces: Vec<(String, String)> = Vec::new();
    if let Some(read) = read_opt("store/genesis-spaces.word", dir)? {
        for w in &read.words {
            if w.fact_id.is_some() {
                if let Some(id) = created_space_id(&w.statement) {
                    spaces.push((id.clone(), id));
                }
            }
        }
    }

    // the DELEGATES (genesis-delegates.word) — collect each born being's anchor (able-name -> Name).
    let mut delegates: Vec<(String, String)> = Vec::new();
    if let Some(read) = read_opt("store/genesis-delegates.word", dir)? {
        for w in &read.words {
            if w.fact_id.is_some() {
                if let Some(name) = created_being_name(&w.statement) {
                    // the grant flow names delegates by their lowercase able-name; bind that -> the Name.
                    delegates.push((name.to_lowercase(), name));
                }
            }
        }
    }

    // MY PLACEMENT (genesis-home.word) — `I stand in heaven.` (the homeSpace half is a flagged gap).
    let _ = read_opt("store/genesis-home.word", dir)?;

    // 4. THE GRANTS — genesis.word's flow, run through the REAL runner with the anchor bindings so its
    //    name refs (cherub, heaven, root, …) resolve to the ids I just created. Each effect is a moment.
    let mut binds: Vec<(String, Json)> = Vec::new();
    for (k, v) in spaces.iter().chain(delegates.iter()) {
        binds.push((k.clone(), jstr(v)));
    }
    let binds = Json::Obj(binds);
    let grants_laid = run_grants(seed_dir, dir, &binds, sign_ref)?;

    Ok(BornWorld {
        i_name: planted.i_name,
        vocabulary_coined,
        spaces,
        delegates,
        grants_laid,
    })
}

/// The space NAME `I make [the] <name>.` creates (the lowercase create-space form), or None.
fn created_space_id(statement: &str) -> Option<String> {
    for n in treeword::parse(statement) {
        if get_str(&n, "kind") == Some("act") && get_str(&n, "act") == Some("create-space") {
            return get(&n, "of").and_then(|o| get_str(o, "id")).map(|s| s.to_string());
        }
    }
    None
}

/// The being NAME `I make <Name>.` births (the Capitalized be:birth form), or None.
fn created_being_name(statement: &str) -> Option<String> {
    for n in treeword::parse(statement) {
        if get_str(&n, "kind") == Some("act")
            && get_str(&n, "verb") == Some("be")
            && get_str(&n, "act") == Some("birth")
        {
            return get(&n, "of").and_then(|o| get_str(o, "id")).map(|s| s.to_string());
        }
    }
    None
}

/// Run genesis.word's grant flow through the real runner (act_via_fold_bound), threading the anchor
/// bindings + the able-word folder + the materials/store op bodies + the story signer. Returns the
/// count of grant facts laid. A denial surfaces as a Message (the grant flow refused on substrate).
fn run_grants(
    seed_dir: &Path,
    dir: &Path,
    binds: &Json,
    sign: &dyn Fn(&Json, &[String]) -> Json,
) -> Result<usize, GenesisBookError> {
    let text = match std::fs::read_to_string(seed_dir.join("store/genesis.word")) {
        Ok(t) => t,
        Err(_) => return Ok(0), // no grants file — nothing to grant
    };
    let ables_dir = seed_dir.join("store/words/ables");
    let actor = i_actor();
    // genesis.word's grants are INLINE deeds (do:grant-able lays its one fact directly — the JS
    // grant-able op's world effect is the one do:grant-able fact on the grantee's reel). Run with NO
    // op-word EXPANSION so each grant rasterizes inline and seals as its moment; the grant target/anchor
    // refs resolve against the anchor `binds`. (grant-able folds as an op word, but its `.word` body is a
    // predicate guard + an inline-fact terminator, not a materials see-op that synthesizes a fact, so the
    // inline path is the one that lays the grant - matching the JS.) We reach THE ONE PATH via
    // `act_via_fold_bound` with a `file_of` that resolves NOTHING (`|_,_| None`): `op_word_via_fold`
    // returns None for every op regardless of the fold, so no deed expands - byte-identical to the old
    // `act_with_ops_bound(..., op_word_of = |_| None, ...)` this replaced.
    let outcomes = treeibp::act_via_fold_bound(
        &text,
        &actor,
        dir,
        "0",
        |name| treeibp::fold_word_able(name, &ables_dir),
        |_op, _noun| None,
        binds,
        None,
        Some(sign),
    );
    let mut laid = 0;
    for o in &outcomes {
        match o {
            treeibp::Outcome::Authorized(_) => laid += 1,
            treeibp::Outcome::Denied(reason) => {
                return Err(GenesisBookError::Message(format!("grant denied: {reason}")))
            }
        }
    }
    Ok(laid)
}

// ── THE SURVEY: a COLLECT-ALL read (continue past each guard violation, catalog them all) ─────────────
//
// The strict reader (read_book) STOPS at the first offender - that is the real-genesis door (a broken
// book must not ignite). The SURVEY is the OTHER mode Tabor asked for: "find them all as we read them
// through and fix." Instead of throwing on the first guard violation, the survey COLLECTS each violation
// {word, .word file + line, type, detail} and CONTINUES (quarantining the offender so later words still
// surface), producing the COMPLETE CATALOG of broken words. It is purely ADDITIVE: strict mode is
// untouched.
//
// The survey reads with a PROACTIVE GUARD 2: it does not wait for a word to be SPOKEN to find its missing
// logic. For every statement it inspects the parsed body's host-op escapes - both the explicit `see <op>`
// escapes (kind:"see" -> act) AND the host-predicate calls inside conditions (`<op>(args)` -> seeCall) -
// and checks each against the registry at READ time, surfacing every missing handler in one pass.

/// A guard violation the survey caught (the strict `BookError`'s collect-all twin, carrying provenance:
/// the source file + 1-based line where the word's statement begins, so the catalog points at the fix).
#[derive(Debug, Clone)]
pub enum Violation {
    /// GUARD 1: the word laid MORE THAN ONE fact (a run-on). `facts` is the count, `crammed` the verb:act
    /// pairs. The fix: split it into `facts` one-act words.
    RunOn { facts: usize, crammed: Vec<String> },
    /// GUARD 2: the word reaches a host see-op (`see <op>` escape or a `<op>(args)` predicate) that NO
    /// resolver is registered for. `op` is the missing handler. The fix: build + register it (treehost).
    MissingLogic { op: String },
    /// treeword could not PARSE the statement into any node (a structurally broken word). A separate
    /// bucket from the guards: the word never even became IR. `detail` notes what was seen.
    Unparsed { detail: String },
    /// The runner DENIED the word's act (a malformed act, not a permission issue for I).
    Denied { reason: String },
}

impl Violation {
    /// The catalog's one-line suggested fix for this violation.
    pub fn suggested_fix(&self) -> String {
        match self {
            Violation::RunOn { facts, .. } => {
                format!("split-to-one-act (into {facts} words, one fact each)")
            }
            Violation::MissingLogic { op } => format!("build+register handler `{op}` (treehost) | else likely-improv"),
            Violation::Unparsed { .. } => "fix the statement so treeword parses it (or it is host prose)".to_string(),
            Violation::Denied { reason } => format!("the runner refused: {reason}"),
        }
    }
    /// A short type label for grouping (RunOn / MissingLogic / Unparsed / Denied).
    pub fn kind_label(&self) -> &'static str {
        match self {
            Violation::RunOn { .. } => "RunOn",
            Violation::MissingLogic { .. } => "MissingLogic",
            Violation::Unparsed { .. } => "Unparsed",
            Violation::Denied { .. } => "Denied",
        }
    }
}

/// One catalog entry: a broken word, named, with its provenance + the violation + the suggested fix.
#[derive(Debug, Clone)]
pub struct SurveyEntry {
    /// The word name (the statement's declared subject / op name, or the statement text).
    pub word: String,
    /// The statement text I read (one Word).
    pub statement: String,
    /// The `.word` file this statement came from (the survey threads it per source).
    pub file: String,
    /// The 1-based line in `file` where this statement begins.
    pub line: usize,
    /// What guard / parse caught it.
    pub violation: Violation,
}

/// The whole survey's outcome: the catalog of broken words + the clean tally. The work-list for making
/// the book flow.
#[derive(Debug, Clone)]
pub struct Survey {
    /// Total statements read across the whole book (every Word the survey saw).
    pub total: usize,
    /// CLEAN words: one act laid (or an inert see), logic present - they read without a violation.
    pub clean: usize,
    /// Every BROKEN word, in book order (a word can appear once; the first violation it hits is recorded).
    pub broken: Vec<SurveyEntry>,
}

impl Survey {
    /// The broken count (== `broken.len()`).
    pub fn broken_count(&self) -> usize {
        self.broken.len()
    }
    /// The run-ons in the catalog.
    pub fn run_ons(&self) -> Vec<&SurveyEntry> {
        self.broken.iter().filter(|e| matches!(e.violation, Violation::RunOn { .. })).collect()
    }
    /// The missing-logic words in the catalog.
    pub fn missing_logic(&self) -> Vec<&SurveyEntry> {
        self.broken.iter().filter(|e| matches!(e.violation, Violation::MissingLogic { .. })).collect()
    }
    /// The unparsed words (the separate bucket).
    pub fn unparsed(&self) -> Vec<&SurveyEntry> {
        self.broken.iter().filter(|e| matches!(e.violation, Violation::Unparsed { .. })).collect()
    }
    /// The DENIED words.
    pub fn denied(&self) -> Vec<&SurveyEntry> {
        self.broken.iter().filter(|e| matches!(e.violation, Violation::Denied { .. })).collect()
    }
    /// The DISTINCT missing host-op handlers, sorted - the treehost resolvers still to build.
    pub fn missing_handlers(&self) -> Vec<String> {
        let mut ops: Vec<String> = self
            .broken
            .iter()
            .filter_map(|e| match &e.violation {
                Violation::MissingLogic { op } => Some(op.clone()),
                _ => None,
            })
            .collect();
        ops.sort();
        ops.dedup();
        ops
    }
}

/// One source in the book: a `.word` file's text + its name (for provenance). The survey reads a SEQUENCE
/// of these, in dependency order, threading the file name + line through every entry.
#[derive(Debug, Clone)]
pub struct BookSource {
    /// The source label (the `.word` file path, relative to the seed - the catalog's provenance).
    pub file: String,
    /// The file's text.
    pub text: String,
}

/// Collect EVERY host-op a parsed body reaches - the PROACTIVE GUARD 2's subject. Two shapes:
///   - an explicit escape `see <op>(args) as bind` -> `{ kind:"see", act:"<op>" }`.
///   - a host-PREDICATE call inside a condition `<op>(args)` -> `{ seeCall:"<op>", args }`.
/// We walk the whole node tree: control-flow bodies (then/else/body/effects), match cases, AND the
/// CONDITION fields (cond/if/while/filter), recursing through the and/or connectives (all/any). The
/// `resolvedBy` predicates (hasAuthorityOver / isBeingParentOf / a bare `<X> is <word>`) are the engine's
/// own authority/identity predicates, NOT host see-op escapes, so they are NOT collected here (the survey
/// catalogs missing HOST handlers - the treehost resolvers).
fn host_ops_of(statement: &str) -> Vec<String> {
    let nodes = treeword::parse(statement);
    let mut ops = Vec::new();
    collect_host_ops(&nodes, &mut ops);
    ops
}

fn collect_host_ops(nodes: &[Json], ops: &mut Vec<String>) {
    for n in nodes {
        // shape 1: an explicit `see <op>` escape.
        if get_str(n, "kind") == Some("see") {
            if let Some(op) = get_str(n, "act") {
                ops.push(op.to_string());
            }
        }
        // shape 2: a host-predicate call (a node's own `seeCall`, or one nested in a cond/connective).
        for key in ["cond", "if", "while", "filter"] {
            if let Some(c) = get(n, key) {
                collect_cond_host_ops(c, ops);
            }
        }
        // recurse into the control-flow / flow bodies.
        for key in ["then", "else", "body", "effects"] {
            if let Some(Json::Arr(b)) = get(n, key) {
                collect_host_ops(b, ops);
            }
        }
        if let Some(Json::Arr(cases)) = get(n, "cases") {
            for c in cases {
                if let Some(Json::Arr(b)) = get(c, "body") {
                    collect_host_ops(b, ops);
                }
            }
        }
    }
}

/// Walk a CONDITION (a parsed `cond`) for host-predicate calls (`seeCall`), recursing the and/or
/// connectives (all/any). A `seeCall:"<op>"` is a host-op escape (a live check, e.g. able-exists).
fn collect_cond_host_ops(cond: &Json, ops: &mut Vec<String>) {
    if let Some(op) = get_str(cond, "seeCall") {
        ops.push(op.to_string());
    }
    for key in ["all", "any"] {
        if let Some(Json::Arr(parts)) = get(cond, key) {
            for p in parts {
                collect_cond_host_ops(p, ops);
            }
        }
    }
}

/// Survey ONE statement (NO write - the survey is a read-out, not a re-ignition): inspect it for guard
/// violations + parse failures, returning the FIRST violation it carries (or None if clean). The order
/// mirrors the strict reader: parse-failure, then GUARD 2 (missing logic), then GUARD 1 (run-on). A clean
/// word laid exactly one fact (or is an inert see) with every host-op registered.
fn survey_one(statement: &str) -> Option<Violation> {
    let nodes = treeword::parse(statement);
    // PARSE bucket: a non-empty statement the parser read as a single verbatim `clause` (no real IR) is
    // unparsed-ish; but word.word's structural prose legitimately parses to nothing. So: an UNPARSED word
    // is one whose ONLY node is a bare `{clause}` leaf (the parser's last-resort) for a statement that
    // looks like a Word (has an op/verb cue) - we keep this conservative: a lone top-level `clause` node.
    if nodes.len() == 1 && get(&nodes[0], "clause").is_some() {
        return Some(Violation::Unparsed {
            detail: format!("parsed only as a verbatim clause: {}", get_str(&nodes[0], "clause").unwrap_or("")),
        });
    }

    // PROACTIVE GUARD 2 (missing logic): every host-op the body reaches must be registered.
    for op in host_ops_of(statement) {
        if !is_registered(&op) {
            return Some(Violation::MissingLogic { op });
        }
    }

    // GUARD 1 (one word = one act): a declaration / acting word lays exactly one fact; a run-on lays >1.
    let specs = acting_specs(statement);
    if specs.len() > 1 {
        return Some(Violation::RunOn {
            facts: specs.len(),
            crammed: specs.iter().map(spec_verb_act).collect(),
        });
    }
    None
}

/// Split a book into statements WITH their 1-based start line (so the catalog can point at the fix).
/// Mirrors `split_statements` (drop `#`/blank lines, split on the `.` terminator) but threads the line
/// each statement BEGINS on through the join, so a multi-line sentence reports its opening line.
fn split_statements_located(book: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut cur_line: Option<usize> = None;
    for (idx, line) in book.lines().enumerate() {
        let t = line.trim_start();
        if t.starts_with('#') || t.is_empty() {
            continue;
        }
        if cur_line.is_none() {
            cur_line = Some(idx + 1);
        }
        for ch in line.chars() {
            if ch == '.' {
                let stmt = cur.trim().to_string();
                if !stmt.is_empty() {
                    out.push((format!("{stmt}."), cur_line.unwrap_or(idx + 1)));
                }
                cur.clear();
                cur_line = None;
            } else {
                cur.push(ch);
            }
        }
        cur.push(' '); // a newline inside a sentence is a space
    }
    let tail = cur.trim();
    if !tail.is_empty() {
        out.push((tail.to_string(), cur_line.unwrap_or(book.lines().count())));
    }
    out
}

/// THE SURVEY: read a whole BOOK (a dependency-ordered SEQUENCE of `.word` sources) in COLLECT-ALL mode.
/// Every statement is inspected; each violation is CATALOGED (with its file + line) and the read CONTINUES
/// (the offender is quarantined - it lays no fact - so later words still surface). Returns the full
/// `Survey`: total read, clean count, and the catalog of broken words. NO write happens - this is a
/// read-out of the book's health (the strict reader is the writer; the survey is the diagnostic).
pub fn survey_book(sources: &[BookSource]) -> Survey {
    let mut broken = Vec::new();
    let mut total = 0;
    let mut clean = 0;
    for src in sources {
        for (stmt, line) in split_statements_located(&src.text) {
            total += 1;
            match survey_one(&stmt) {
                Some(violation) => broken.push(SurveyEntry {
                    word: word_name_of(&stmt),
                    statement: stmt,
                    file: src.file.clone(),
                    line,
                    violation,
                }),
                None => clean += 1,
            }
        }
    }
    Survey { total, clean, broken }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_drops_comments_and_keeps_sentences() {
        let book = "# a comment\n\nA word is a word.\nTo do is to stamp; the do is the only act.\n";
        let stmts = split_statements(book);
        assert_eq!(stmts.len(), 2, "two statements, the comment dropped: {stmts:?}");
        assert_eq!(stmts[0], "A word is a word.");
        assert!(stmts[1].starts_with("To do is to stamp"));
    }

    #[test]
    fn registered_probe_distinguishes_known_from_unknown() {
        // a real registered see-op (treehost has it) vs a made-up one.
        assert!(is_registered("resolve-set-being-spec"), "a registered op is known");
        assert!(!is_registered("resolve-no-such-host-op-xyzzy"), "an unknown op is not registered");
    }

    #[test]
    fn see_ops_finds_the_escape() {
        let ops = see_ops_of("see resolve-foo($x) as y.");
        assert_eq!(ops, vec!["resolve-foo".to_string()]);
        // a pure declaration reaches no host op (improv).
        assert!(see_ops_of("A word is a word.").is_empty());
    }

    #[test]
    fn host_ops_catches_both_see_and_predicate_calls() {
        // an explicit `see <op>` escape AND a predicate call inside an `If` condition both surface.
        let body = "When a being does a thing:\n  If not able-exists(able), refuse with \"x\".\n  see resolve-birth-space(target) as b.\n  Return ok: true.";
        let ops = host_ops_of(body);
        assert!(ops.contains(&"able-exists".to_string()), "the If-predicate host-op is collected: {ops:?}");
        assert!(ops.contains(&"resolve-birth-space".to_string()), "the see-escape host-op is collected: {ops:?}");
    }

    #[test]
    fn survey_collects_all_continues_past_each_violation() {
        // a tiny book: one clean concept, one missing-logic word, one MORE missing-logic word. The survey
        // must collect BOTH broken (not stop at the first), and count the clean one.
        let sources = vec![
            BookSource { file: "a.word".to_string(), text: "A word is a word.".to_string() },
            BookSource {
                file: "b.word".to_string(),
                text: "see resolve-no-such-op-1($x) as y.".to_string(),
            },
            BookSource {
                file: "c.word".to_string(),
                text: "see resolve-no-such-op-2($x) as y.".to_string(),
            },
        ];
        let survey = survey_book(&sources);
        // the survey did NOT stop at the first offender: BOTH missing-logic words are cataloged.
        let missing = survey.missing_logic();
        assert_eq!(missing.len(), 2, "collect-all caught both missing-logic words: {:?}", survey.broken);
        // the missing handlers are the distinct unresolved ops.
        let handlers = survey.missing_handlers();
        assert_eq!(handlers, vec!["resolve-no-such-op-1".to_string(), "resolve-no-such-op-2".to_string()]);
        // the clean concept counted clean; provenance threaded through.
        assert!(survey.clean >= 1, "the concept word counted clean");
        assert_eq!(missing[0].file, "b.word", "provenance is threaded onto the entry");
    }

    #[test]
    fn located_split_reports_the_start_line() {
        let book = "# header comment\n\nA word is a word.\nWhen a being acts:\n  see resolve-x($a) as y.";
        let located = split_statements_located(book);
        // the first statement begins on line 3 (after the comment + blank).
        assert_eq!(located[0].1, 3, "the first statement's line is reported: {located:?}");
    }
}
