# Word Rain
**Every Word as one token, fact-chains as chains of tokens, and the projection raining down like [rain.png](rain.png).**

> This note is the source vision for the Word translation layer and the Rain viewer. The original words are kept **verbatim below the separator**. A Rust translation layer (a new `treesymbol` crate) plus a fourth Portal view (the Rain) are being built on top of this note in a separate lane, so what follows is a summary of the idea and where the build sits, not a rewrite of it.

---

## Summary

The core move is that **every Word collapses to one token, a single root symbol**. That symbol is the canonical form of the Word, the same underneath every language, and it is exactly one LLM token. So a being with LLM cognition speaks Word one token at a time, and **one emitted token is one act** in the system. A fact-chain therefore becomes a chain of tokens, genesis to now.

From that fall two kinds of chain. The **fact chain** is immutable: it only appends, never rewrites, genesis to head. The **projection** is the living face: each moment it gains a new word at the head and reshuffles the words before it, re-rendering the identity's present. The fact chain is what is true; the projection is what is currently being read.

**Rain** is the viewer for the projection. Each active moment (a being loaded through a Name) is a column of one-token symbols falling downward, the head appending on each new act while the prior words renew. As a **Name** you see the rain of your own beings; as **I** you see the whole story's activity at once. Click a column and a side panel opens: the projection in your language, plus a way into the 3D or Story view for that being.

Language is a **projection of the same symbol, not a separate word**. English, Chinese, and any other language all render the one underlying symbol, and what you type in your language is translated back to the Word. So a story can carry translations without ever changing the token beneath.

### The four needs (from the note, distilled)

1. **Word to root symbol.** Every real Word maps to one token, drawn from everything a keyboard or computer can output. The symbol is both the Word's root meaning and the Word itself.
2. **Per-language layers.** Swappable, choosable translation layers in the story, and typed language is translated back into Word.
3. **The Rain viewer in Portal.** A new view showing all of your beings' projection chains raining down and updating live.
4. **Click a chain.** A side panel: the projection in your language, and a way to enter 3D / Story for that being.

## Status (being built in the Rust lane, do not duplicate)

The load-bearing principle of the build is **derive, never author a map**. No person and no seed maintains a translation table. The vocabulary is already ordered by the chain (the fixed grammar words, then each coined concept in `do:coin` seq order), so `symbol(word) = ALPHABET[coin_index(word)]`: the Nth coined Word gets the Nth single-token symbol. The chain **is** the map, stable and deterministic on every node, nothing hand-authored. English is the Word's own canonical form; other languages come from a `project(word, lang)` function (an injected translate seam), still never a per-word table.

The work is phased: `treesymbol` core (the derived symbol bijection, the alphabet, the projection, the per-moment legend for the LLM), then the Story render (facts to past-tense Word, projected into the active language), then the Rain view, then the one-symbol LLM membrane (the model emits one token, decoded back to a Word and sealed as an act), then the automatic per-language seam. It reads the vocabulary and the projection only; it must not fork or touch the Word runtime (the `treeword` lane), whose one coupling point is the coin-fact shape.

---

# ⬇ ORIGINAL — verbatim, unedited

All words behind scene get converted into a one token shape. That way llms can always output one word at a time. One token (an act for the llm) is also one act in the system for the being who has llm powered cognition.

So all word behind scene becomes one token, and used variety of token shapes (whatever is possible).

So ultimately fact chains are tokens, chains of one token at a time.

And if anything, stories can have translations so English does same word meaning and Chinese and same token (word) underneath.

So you have 2 types of “chains”.
The full fact chain from genesis, that doesn’t change but only appends.

And then you have the projection, which constantly gets a new word, and then reshuffles the words before to form new face for the identity’s next moment.

The factory could almost be represented like several chains of “words” or tokens that rain downwards as each new fact is laid, and then reshuffled with each new head if viewing the projection or what the actual names are seeing inside of active moments.

So you would see a projection chain per active moment (a being "loaded" through a Name) and its head would add on anew, while simealtaeouslly changing the words before to renew the projection.

that would be the main viewer to start, and as a name you would see as your beings, or as the I you would see Story wide activity.

needs:

1. all real WORD gets translated back to a root symbol, one TOKEN, based on everything a keyboard/computer can output. This symbol is the root meaning for that WORD and the actual WORD
2. there are translation layers per language, maps in story that are swappable/chooseable and the language typed is translated back into WORD
3. a new viewer in Portal to see all of your Beings projection chains, raining down and updating
4. click on a chain to show pop up side panel that allows you to see projection in your language, click to enter into 3d/story mode, etc
