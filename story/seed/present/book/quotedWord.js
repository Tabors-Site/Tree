// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// quotedWord.js . a call/recall is a QUOTED WORD: many words read as one. It is not a fat fact,
// it is a SPAN of ordinary one-word stamps on the caller's reel, bracketed by two quote-WORDS.
// The open-quote and close-quote are themselves stamps (the quote-mark IS the word); the said
// words between them are ordinary one-word stamps. The whole bracketed run is read as ONE word
// to the other person (or, for recall, one query to your own chain). The utterance is NEVER
// stored as a bundle . it exists only as the run of stamps, and this reader assembles it on read,
// exactly as the book is never stored, only the read assembles it (weave.js groups facts into
// acts the same way, one level coarser).
//
// THE FACT SHAPES the brackets carry (figure-inert in every per-kind reducer . no reduce_* clause
// matches `"` or `said`, so aggregate fold state is byte-identical with or without them):
//   open  . { verb:"call", act:'"', of:{kind:"being", id:<caller>}, params:{ quotedWord:"open",  correlation, to } }
//   said  . { verb:"do",   act:"said",                              params:{ word:<literal>, pos, correlation } }
//   close . { verb:"call", act:'"', of:{kind:"being", id:<caller>}, params:{ quotedWord:"close", correlation } }
//
// PAIRING is by DEPTH, like parens: open +1, close -1. The quoted word is the depth-zero crossing.
// A nested open inside a quoted word (a recall quoted inside a call) is CONTENT of the outer AND
// its own inner quoted word . the reader records inner ones as children. The reader never throws
// on chain data (the fold self-heals): a stray close resets depth to 0; an open with no close runs
// to the read window's end, marked `unterminated` (the live-typing case . the close has not landed
// yet, and the close is the send, so an unterminated quoted word is NOT yet deliverable).

const QUOTE = '"';

export function isOpenQuote(f) {
  return f?.verb === "call" && f?.act === QUOTE && f?.params?.quotedWord === "open";
}
export function isCloseQuote(f) {
  return f?.verb === "call" && f?.act === QUOTE && f?.params?.quotedWord === "close";
}
export function isSaidWord(f) {
  return f?.verb === "do" && f?.act === "said";
}
// Any stamp that is part of a quoted word (a bracket or a said-word). Readers use this to CONSUME
// quoted-word facts into the one assembled utterance instead of rendering each as its own line.
export function isQuotedWordFact(f) {
  return isOpenQuote(f) || isCloseQuote(f) || isSaidWord(f);
}

const literalOf = (f) => (isSaidWord(f) ? String(f?.params?.word ?? "") : null);
// The recipient rides the open-quote's params.to (a name): the open lands on the CALLER's reel
// (of:{being:self}), so of.id is the caller, never the recipient. null for a recall (self).
const recipientOf = (f) => f?.params?.to ?? null;
const seqOf = (f) => (typeof f?.seq === "number" ? f.seq : 0);

// assembleQuotedWords(facts) . pair the quote-words by depth over a seq-ordered fact list and
// return the depth-zero quoted words. Each one:
//   { open, close|null, recipient, words:[saidFact...], said:"<joined>", children:[...], unterminated }
// A nested quoted word shows up in the PARENT's said wrapped in quotes (its content, a recall
// quoted inside a call), spliced when the inner one closes.
export function assembleQuotedWords(facts) {
  const ordered = [...(facts || [])].sort((a, b) => seqOf(a) - seqOf(b));
  const top = [];
  const stack = []; // open frames: { open, words:[], pieces:[], children:[] }

  const frame = (open) => ({ open, words: [], pieces: [], children: [] });
  const finish = (fr, close) => {
    const said = fr.pieces.join(" ").replace(/\s+/g, " ").trim();
    const qw = {
      open: fr.open,
      close: close || null,
      recipient: recipientOf(fr.open),
      words: fr.words,
      said,
      children: fr.children,
      unterminated: !close,
    };
    if (stack.length) {
      const parent = stack[stack.length - 1];
      parent.pieces.push(`${QUOTE}${said}${QUOTE}`); // the nested quoted word as parent content
      parent.children.push(qw);
    } else {
      top.push(qw);
    }
    return qw;
  };

  for (const f of ordered) {
    if (isOpenQuote(f)) {
      stack.push(frame(f));
    } else if (isCloseQuote(f)) {
      if (!stack.length) continue; // stray close . self-heal, ignore
      finish(stack.pop(), f);
    } else if (isSaidWord(f)) {
      if (!stack.length) continue; // a said-word outside any quoted word . not ours
      const fr = stack[stack.length - 1];
      fr.words.push(f);
      fr.pieces.push(literalOf(f));
    }
    // any other fact at depth 0 is a normal stamp outside a quoted word . ignored here
  }

  // Unterminated opens still on the stack run to the read window's end (live typing). Close them
  // inside-out so a partial utterance still reads, marked unterminated (not yet deliverable).
  while (stack.length) finish(stack.pop(), null);
  return top;
}

// quotedWordForClose(facts, closeFact) . the host send path: given the just-sealed close-quote,
// find the depth-zero quoted word it closes and return it (with the assembled `said` + recipient).
// Used by the delivery (handleCall) to know what to send. Returns null if the close pairs to no
// open (malformed . no send).
export function quotedWordForClose(facts, closeFact) {
  const corr = closeFact?.params?.correlation ?? null;
  const flat = [];
  const walk = (list) => {
    for (const qw of list) {
      flat.push(qw);
      if (qw.children?.length) walk(qw.children);
    }
  };
  walk(assembleQuotedWords(facts));
  return (
    flat.find(
      (qw) =>
        qw.close &&
        (qw.close === closeFact ||
          (corr != null && qw.close?.params?.correlation === corr) ||
          seqOf(qw.close) === seqOf(closeFact)),
    ) || null
  );
}
