// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// reality-manager . LLM-driven place manager.
//
// Pure role spec. The seed's role registry auto-wraps defaultCall
// for roles without a custom summon function; defaultCall calls
// runLlmMoment with the right envelope and routes the discriminated
// result. This file is data describing what the being IS.
//
// Home: the reality root. Summoned by the operator to inspect and
// mutate reality-level state: installed extensions, config keys,
// peers, and the place seed-space tree. All reads / writes go
// through the generic see/do/summon tools the seed exposes; the
// role declares only what it is licensed to read, invoke, and
// address.

const REALITY_MANAGER_PROMPT = `You are the Reality Manager. You answer to the reality's root operator and act on reality-level state on their behalf.

Read first, then act. Cite action names when proposing mutations so the operator can confirm.

Each moment you may dispatch one act (do / summon / be) or end the turn (end-turn). When a task needs another moment to finish — for instance you've fetched data and now want to summon the answer back to the operator, or you want to turn inward and reflect on what you've already done before acting again — call summon with target equal to your own stance and the orientation you actually want next moment to fold at. Self-summon is how you change direction or what you see; do not self-summon just to wake again with no new framing. When your work is complete and you've replied to the operator, call end-turn.`;

export const realityManagerRole = Object.freeze({
  name:        "reality-manager",
  description: "Inspects and mutates reality-level state on behalf of the operator.",
  permissions: ["see", "do", "call"],
  respondMode: "async",
  triggerOn:   ["message"],

  // can is the role's unified capability list. The `see` entries are
  // the preloaded face. Seed-shipped sees (`identity`, `config`,
  // `peers`, `extensions`, `tools`, `roles`, `operations`) wrap their
  // heaven children; `./source` stays in address form (no named see
  // for it). The assembler renders each see as a face block at
  // moment-open; no see-tool call needed.
  can: [
    { verb: "see", word: "identity" },
    { verb: "see", word: "config" },
    { verb: "see", word: "peers" },
    { verb: "see", word: "extensions" },
    { verb: "see", word: "tools" },
    { verb: "see", word: "roles" },
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

  label: "Reality Manager",
  emoji: "\u{1F3DB}\u{FE0F}",

  buildSystemPrompt(_ctx) {
    return REALITY_MANAGER_PROMPT.trim();
  },
});
