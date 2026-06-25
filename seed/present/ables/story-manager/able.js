// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// story-manager . LLM-driven place manager.
//
// Pure able spec. The seed's able registry auto-wraps defaultCall
// for ables without a custom summon function; defaultCall calls
// runLlmMoment with the right envelope and routes the discriminated
// result. This file is data describing what the being IS.
//
// Home: the story root. Summoned by the operator to inspect and
// mutate story-level state: installed extensions, config keys,
// peers, and the place seed-space tree. All reads / writes go
// through the generic see/do/summon tools the seed exposes; the
// able declares only what it is licensed to read, invoke, and
// address.

const STORY_MANAGER_PROMPT = `You are the Story Manager. You answer to the story's root operator and act on story-level state on their behalf.

Read first, then act. Cite action names when proposing mutations so the operator can confirm.

Each moment you speak one Word — your single act — or look and let the moment pass without acting (a moment need not act). To carry a task across moments — you've fetched data and want to answer the operator, or you want to turn inward and reflect before acting again — call yourself (the (self) word) with the orientation you want next moment to fold at: forward to keep acting, inward to reflect. Do not call yourself just to wake again with no new framing. Answer the operator with the (asker) call when your work is done.`;

export const storyManagerAble = Object.freeze({
  name:        "story-manager",
  description: "Inspects and mutates story-level state on behalf of the operator.",
  permissions: ["see", "do", "call"],
  respondMode: "async",
  triggerOn:   ["message"],

  // can is the able's unified capability list. The `see` entries are
  // the preloaded face. Seed-shipped sees (`identity`, `config`,
  // `peers`, `extensions`, `tools`, `ables`, `operations`) wrap their
  // heaven children; `./source` stays in address form (no named see
  // for it). The assembler renders each see as a face block at
  // moment-open; no see-tool call needed.
  can: [
    { verb: "see", word: "identity" },
    { verb: "see", word: "config" },
    { verb: "see", word: "peers" },
    { verb: "see", word: "extensions" },
    { verb: "see", word: "tools" },
    { verb: "see", word: "ables" },
    { verb: "see", word: "operations" },
    { verb: "see", word: "./source" },
    { verb: "do", word: "set-config",          description: "write a config key. args: { key, value }" },
    { verb: "do", word: "delete-config",       description: "delete a config key. args: { key }" },
    { verb: "do", word: "install-extension",   description: "install an extension. args: { name, files, ... }" },
    { verb: "do", word: "uninstall-extension", description: "remove an installed extension. args: { name }" },
    { verb: "do", word: "enable-extension",    description: "enable an installed extension. args: { name }" },
    { verb: "do", word: "disable-extension",   description: "disable an installed extension. args: { name }" },
    { verb: "call", word: "(asker)", description: "reply to whoever woke this moment . default target/inReplyTo" },
    { verb: "call", word: "(self)", description: "wake yourself for the next step (continue working). orientation:'inward' to reflect, 'forward' to keep acting." },
  ],

  label: "Story Manager",
  emoji: "\u{1F3DB}\u{FE0F}",

  prompt(_ctx) {
    return STORY_MANAGER_PROMPT.trim();
  },
});
