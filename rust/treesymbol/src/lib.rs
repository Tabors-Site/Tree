// treesymbol — the DERIVED Word<->symbol codec (philosophy/wordRain/rain.md). Every WORD maps to exactly
// ONE single-token SYMBOL, derived from the vocabulary's ORDER — the chain's coin-order — never a hand-
// authored map. The symbol IS the canonical token an LLM speaks (one token per act); each language is a
// PROJECTION function, so no per-word translation is ever stored (your steer: "just make a function that
// does it"). Content words (names/ids) are already identifiers — they pass through as MARKS, not symbols.
//
// The alphabet is the contiguous CJK block (U+4E00..), so symbol<->index is O(1) arithmetic and the
// glyphs are distinct + dense (the Matrix rain). One-token-ness for a given LLM tokenizer is a dev-time
// check (`verify_single_token`); the ASSIGNMENT is tokenizer-independent (pure coin-order).
//
// DERIVE, NEVER MAP:
//   symbol(word)   = ALPHABET[ index_of(word in vocabulary) ]
//   word_of(sym)   = vocabulary[ index_of(sym in ALPHABET) ]
//   project(word)  = the Word's own form for `en`; a translate() fn for other langs
// The vocabulary = GRAMMAR (fixed syntax) ++ CONCEPT (genesis) ++ coined words (in coin-seq), deduped.

use std::collections::HashSet;
use std::sync::LazyLock;

/// The glyph alphabet: a curated set of distinct single glyphs the egui monospace font renders (Greek,
/// Cyrillic, Latin-Extended, box-drawing, geometric, arrows, math) — the Matrix-rain look without a CJK
/// font dependency, and each glyph a single token for common LLM tokenizers. Vocabulary index i -> the
/// i-th glyph. The well-covered ranges come first so the base vocabulary always renders. (A bundled CJK
/// font for the denser look is a later refinement; the DERIVATION is alphabet-independent.)
static ALPHABET: LazyLock<Vec<char>> = LazyLock::new(|| {
    const RANGES: &[(u32, u32)] = &[
        (0x0391, 0x03A9), // Greek uppercase Α-Ω
        (0x03B1, 0x03C9), // Greek lowercase α-ω
        (0x0400, 0x045F), // Cyrillic
        (0x0100, 0x017F), // Latin Extended-A
        (0x2500, 0x257F), // box drawing
        (0x25A0, 0x25FF), // geometric shapes
        (0x2190, 0x21FF), // arrows
        (0x2200, 0x22FF), // math operators
    ];
    let mut v = Vec::new();
    for &(a, b) in RANGES {
        for c in a..=b {
            if let Some(ch) = char::from_u32(c) {
                v.push(ch);
            }
        }
    }
    v
});

/// The i-th alphabet glyph (for callers that derive a fallback glyph, e.g. the rain of a raw fact).
pub fn glyph(i: usize) -> Option<char> {
    ALPHABET.get(i).copied()
}
/// The alphabet size (the ceiling on the vocabulary before it needs more glyphs).
pub fn alphabet_len() -> usize {
    ALPHABET.len()
}

/// The fixed grammar function words — the irreducible syntax (driftCheck.js GRAMMAR), ordered.
pub const GRAMMAR: &[&str] = &[
    "a", "an", "the", "is", "are", "was", "were", "be", "am", "been", "of", "and", "or", "but", "not", "no", "to",
    "from", "with", "by", "on", "in", "at", "into", "for", "it", "its", "that", "this", "these", "those", "who",
    "whom", "what", "which", "where", "when", "how", "why", "any", "all", "none", "each", "every", "both", "either",
    "neither", "may", "can", "cannot", "must", "has", "have", "had", "as", "than", "so", "then", "only", "also",
    "just", "here", "there", "now", "them", "their", "they", "itself", "oneself", "themselves", "more", "less",
    "most", "least", "up", "down", "out", "before", "after", "over", "under", "between", "within", "across",
    "through", "beside", "beyond", "above", "below", "save", "until", "again", "never", "always", "ever", "yet",
    "still", "if", "while", "whether", "else", "otherwise", "per", "about", "against", "toward", "upon", "off",
    "one", "two", "single", "many", "first", "last", "own", "new", "other", "another", "same", "such", "some",
];

/// The genesis concept words (conceptWords.js CONCEPT_WORDS).
pub const CONCEPT: &[&str] = &[
    "word", "iam", "base", "in", "out", "chain", "history", "story", "fold", "see", "do", "name", "being", "space",
    "matter", "weave", "be", "call", "can", "recall", "able", "flow",
];

/// The ordered canonical vocabulary: GRAMMAR ++ CONCEPT ++ coined words (in coin-seq order), deduped so
/// each Word keeps a STABLE index (new coins only ever append — a prior Word's symbol never changes).
pub fn vocabulary(coined: &[String]) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let base = GRAMMAR.iter().chain(CONCEPT.iter()).map(|s| s.to_string());
    for w in base.chain(coined.iter().cloned()) {
        if seen.insert(w.clone()) {
            v.push(w);
        }
    }
    v
}

/// WORD -> its one-token SYMBOL (None if the word isn't in the vocabulary — a content mark passes through).
pub fn symbol(word: &str, vocab: &[String]) -> Option<char> {
    let i = vocab.iter().position(|w| w == word)?;
    ALPHABET.get(i).copied()
}

/// SYMBOL -> the canonical WORD (None if it isn't an alphabet glyph — a content mark).
pub fn word_of(sym: char, vocab: &[String]) -> Option<String> {
    let i = ALPHABET.iter().position(|&c| c == sym)?;
    vocab.get(i).cloned()
}

/// Project a canonical WORD into a language. `en` is the Word's own form (the stems ARE English roots);
/// other languages go through the injected `translate` fn (no stored per-word map). Falls back to the
/// canonical word if the translate fn has nothing.
pub fn project(word: &str, lang: &str, translate: &dyn Fn(&str, &str) -> Option<String>) -> String {
    if lang == "en" {
        return word.to_string();
    }
    translate(word, lang).unwrap_or_else(|| word.to_string())
}

/// Encode a chain of WORDS into its SYMBOL chain (content words pass through as marks). This is what a
/// projection chain rains as.
pub fn encode_chain(words: &[String], vocab: &[String]) -> Vec<String> {
    words
        .iter()
        .map(|w| symbol(w, vocab).map(|c| c.to_string()).unwrap_or_else(|| w.clone()))
        .collect()
}

/// Project a SYMBOL chain back into a language (the reverse — for the side-panel / story render).
pub fn project_chain(symbols: &[String], vocab: &[String], lang: &str, translate: &dyn Fn(&str, &str) -> Option<String>) -> Vec<String> {
    symbols
        .iter()
        .map(|s| match s.chars().next().and_then(|c| word_of(c, vocab)) {
            Some(w) => project(&w, lang, translate),
            None => s.clone(), // a content mark, pass through
        })
        .collect()
}

/// The per-moment LEGEND for an LLM: `symbol -> meaning` over the whole vocabulary, so the model knows
/// every symbol without any stored map (Set-of-Marks). Derived, deterministic.
pub fn legend(vocab: &[String]) -> Vec<(char, String)> {
    vocab.iter().enumerate().filter_map(|(i, w)| ALPHABET.get(i).map(|&c| (c, w.clone()))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none_translate(_: &str, _: &str) -> Option<String> {
        None
    }

    #[test]
    fn symbol_word_round_trips_over_the_whole_vocabulary() {
        let vocab = vocabulary(&[]);
        for w in &vocab {
            let s = symbol(w, &vocab).expect("every vocab word has a symbol");
            assert_eq!(word_of(s, &vocab).as_deref(), Some(w.as_str()), "round-trip {w}");
        }
        // distinct symbols
        let mut syms: Vec<char> = vocab.iter().map(|w| symbol(w, &vocab).unwrap()).collect();
        let n = syms.len();
        syms.sort();
        syms.dedup();
        assert_eq!(syms.len(), n, "symbols are distinct");
    }

    #[test]
    fn coins_append_without_disturbing_prior_symbols() {
        let before = vocabulary(&[]);
        let am_before = symbol("am", &before).unwrap();
        let after = vocabulary(&["forge".into(), "banish".into()]);
        let am_after = symbol("am", &after).unwrap();
        assert_eq!(am_before, am_after, "a coin must not move a prior word's symbol");
        assert!(symbol("forge", &after).is_some(), "the new coin got a symbol");
        assert!(symbol("forge", &before).is_none(), "it had none before");
    }

    #[test]
    fn chain_encodes_and_projects_back_english() {
        let vocab = vocabulary(&[]);
        // a statement's words; "tabor" is a content mark (not in the vocabulary)
        let words: Vec<String> = ["am", "the", "name", "tabor"].iter().map(|s| s.to_string()).collect();
        let syms = encode_chain(&words, &vocab);
        // known words became single glyphs; the content mark stayed itself
        assert_eq!(syms[3], "tabor");
        assert!(syms[0].chars().count() == 1 && syms[0] != "am");
        let back = project_chain(&syms, &vocab, "en", &none_translate);
        assert_eq!(back, words, "en projection restores the statement");
    }

    #[test]
    fn content_marks_pass_through() {
        let vocab = vocabulary(&[]);
        assert!(symbol("z6Mk-some-name-id", &vocab).is_none());
        let syms = encode_chain(&["z6Mk-id".to_string()], &vocab);
        assert_eq!(syms, vec!["z6Mk-id".to_string()]);
    }
}
