// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// reality-manager . LLM-driven place manager.
//
// Pure role spec. The seed's role registry auto-wraps defaultSummon
// for roles without a custom summon function; defaultSummon calls
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

Read first, then act. Cite action names when proposing mutations so the operator can confirm.`;

export const realityManagerRole = Object.freeze({
  name:        "reality-manager",
  description: "Inspects and mutates reality-level state on behalf of the operator.",
  permissions: ["see", "do", "summon"],
  respondMode: "async",
  triggerOn:   ["message"],

  canSee: [
    "./identity",
    "./config",
    "./peers",
    "./extensions",
    "./tools",
    "./roles",
    "./operations",
    "./source",
  ],

  canDo: [
    { action: "set-config",          description: "write a config key. args: { key, value }" },
    { action: "delete-config",       description: "delete a config key. args: { key }" },
    { action: "install-extension",   description: "install an extension. args: { name, files, ... }" },
    { action: "uninstall-extension", description: "remove an installed extension. args: { name }" },
    { action: "enable-extension",    description: "enable an installed extension. args: { name }" },
    { action: "disable-extension",   description: "disable an installed extension. args: { name }" },
  ],

  canSummon: [
    { stance: "(asker)", description: "reply to whoever woke this moment . default target/inReplyTo" },
  ],

  // The role keeps stepping until it has nothing to do (SEE). A
  // typical operator interaction is two moments: one to fetch data,
  // one to summon the answer back. selfContinue: true closes the
  // loop without external re-summon. SEE is the natural exit.
  selfContinue: true,

  label: "Reality Manager",
  emoji: "\u{1F3DB}\u{FE0F}",

  buildSystemPrompt(_ctx) {
    return REALITY_MANAGER_PROMPT.trim();
  },
});
