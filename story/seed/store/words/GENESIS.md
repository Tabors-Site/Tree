# The Genesis Book

The foundational `.word` vocabulary the boot reads, in descent order, before anything else. Read
from `word.word` outward, every word is grounded only on the words before it, and the whole stacks
as a fact-chain on I_AM's reel — so that `render(genesis → head)` reads back as the creation story.
The book is never stored; it IS the read.

## The one law

The only act is the **do** — the stamp. Every stamp lays one **fact**. A fact is a **see** (inert
content, a noun: read, it does nothing) or a **do** (an act-word, a verb: read, it does). Every
moment is a word. `word.word` says it in six lines.

## The six clock-free kernel axioms

An **axiom** is a word made of the host (the bottom turtle); a **theorem** is a word made of words.
The kernel is six axioms, and nothing else bottoms out in the host:

| floor | axiom | is | host today (the porting layer) |
|---|---|---|---|
| pure | `hash` | content → address (the WHAT) | sha256 over canonical JSON (`past/fact/hash.js`) |
| pure | `sign` | unforgeable keyed attribution (the WHO, the "I") | Ed25519 (`storyIdentity.js`) |
| store | `stamp` (do) | hash + sign + persist | `Fact.create` → Mongo |
| store | `read` (see) | fetch by address | `Fact.findOne` |
| membrane | `in` | a word the I_AM did not make crosses in (a message, the clock, the lot) | `socket.on` / `req.body` |
| membrane | `out` | a word crosses out and holds for a word back (this is a call) | `ack` / `emit` / `fetch` |

`hash` and `sign` are woven into `base.word` and `iam.word`; `stamp` and `read` are named in
`word.word` as `do` and `see`; `in` and `out` are their own words. The axiom is the **property**,
host-blind — the library (sha256, Ed25519, Mongo, socket.io) is the porting layer, and a Phase-2
silicon rebuild re-satisfies six contracts, not these libs.

## Time is not here

Time is **not** an axiom and **not** order. Order is the chain itself — the on-links, the reel
position, the fold — and the **wordstamp** (hash + sign + on-link) carries identity, authorship,
and sequence natively. A timestamp is content: a witness the world hands you through `in`, a field
on a fact like owner or color, which the system never consults to know what came after what. Time
lives as a `now` able (a theorem on `in`), never in the kernel. *The timestamps became the
wordstamps.*

## The load order (descent)

`conceptWords.js` holds the one list — both the declarer (`wordFold.js`) and the checker
(`axioms.js`) read it, so there is no mirror to drift:

```
word · iam · base · in · out · chain · history · story · fold ·
see · do · name · being · space · matter · weave · be · call · can · recall · able · flow
```

- **Roots** — `word` (the self-grounding root), `iam` (the sayer, which is the `sign`), `base`
  (one / order / head / content / hash).
- **Membrane** — `in` (the sense), `out` (the wire).
- **Chain & fold** — `chain` (an order of acts or facts; the head is now, all before it is past),
  `history` (where chains branch), `story` (all histories), `fold` (a chain read into the present —
  present is the head, not a clock). `weave` (a being's view of the chains it sees in one moment)
  is declared last of this group — after the nouns, since it reads being/matter/space.
- **Verbs** — `see` (read the fold, makes no fact), `do` (stamp; the fact is a see or a do; `be` is
  a do on a being, `name` is a do on a name), `be` (the typed do on a being:
  birth/connect/release/switch/death/truename), `call` (an `out` plus await — the target decides: a
  word to another awaits and calls, a word to oneself reads and recalls), `recall` (a see of the
  past).
- **Nouns** — `name` (the identity, the signer; grounds `sign`), `being` (a presence a Name acts
  through), `space` (a place), `matter` (a thing of a type), `story`.
- **Composites** — `can` (grants a word to a being), `able` (a composite word, a can of words —
  words stack), `flow` (a conditional word, the Word's colon).

## How it checks itself

`axioms.js` reads each word's `#` header — "bottoms out in the host" marks an axiom, "Descends
from …" names its grounding — and asserts the descent closes: every concept is in the fold, every
descent term is a declared word, every host pointer resolves. A clean run is "kernel == word.word."
The implementation ops (create-matter, portal, credential, cherub, llm-connection, …) are theorems
composed on this floor, in the `.word` subdirs.

Verified: `verify-descent` (14 axioms / 8 theorems, all 22 folded, 0 issues) · `verify-word-fold` ·
`verify-genesis-read` (the live act-chain reads back, genesis → head, as the creation story).
