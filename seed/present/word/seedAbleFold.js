// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// seedAbleFold.js — fold a seed able from its .word USING THE WORD ENGINE. An able's .word is a
// grant-set written in the engine's OWN able-noun grammar:
//   An <able> is an able.
//   An <able> can <see|do|call|be|recall> <op/word/pattern>.   (… as receiver, for a summon grant)
//   An <able> reaches <pattern>.
//   An <able> needs <llm|human|scripted> cognition.
//   An <able> never wakes.
// parse() (parser.js) reads every one of those lines; this module just collects the nodes parse()
// emits into the able spec. There is NO bespoke able parser — the able vocabulary is the same
// grammar as every other word. (An able GRANT reads "can be a <role>" — the article carries the
// able, see project_able_is_can_be; the can-set below is that role's own powers.)
//
// PURE: parse() + a node fold; no side effect, no registry. registry.js depends on this.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "./parser.js";

const ABLES_DIR = fileURLToPath(new URL("../../store/words/ables/", import.meta.url));

// foldAbleNoun(name, text) → the able spec, collected from the nodes parse(text) emits. The same
// shape the registry expects: { name, description, can, reach, requiredCognition, replyTo,
// respondMode, triggerOn }.
export function foldAbleNoun(name, text) {
  let nodes;
  try { nodes = parse(text); } catch { nodes = []; }
  const can = [];
  const reach = [];
  let requiredCognition = null;
  let triggerOn = ["message"];
  for (const n of nodes) {
    if (n.kind === "can") {
      let word = n.of || "";
      let as = null;
      const m = word.match(/^(.+?)\s+as\s+(receiver|actor)$/i); // a summon grant: "call mate as receiver"
      if (m) { word = m[1].trim(); as = m[2].toLowerCase(); }
      const entry = { verb: n.verb, word };
      if (as) entry.as = as;
      can.push(entry);
    } else if (n.kind === "reach") {
      reach.push(n.to);
    } else if (n.kind === "cognition") {
      requiredCognition = n.mode;
    } else if (n.kind === "wakes") {
      triggerOn = n.when; // [] = never wakes
    }
    // { kind:"is", isA:"able" } is the declaration; the able's name is the filename.
  }
  return {
    name,
    description: _headerOf(text, name),
    can,
    reach: reach.length ? reach : null,
    requiredCognition,
    replyTo: null,
    respondMode: "async",
    triggerOn,
  };
}

// The first `#` line is the able's description (parse() drops comments, so read it here).
function _headerOf(text, name) {
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      const h = line
        .replace(/^#\s*/, "")
        .replace(new RegExp(`^${name}\\.word\\s*[—-]\\s*`, "i"), "");
      if (h) return h;
    } else if (line) break;
  }
  return `The ${name} able.`;
}

// foldWordAble(name) → fold store/words/ables/<name>.word, or null if no such word. Same name +
// signature as the retired ableWordFold export, so getAble/registry need no change.
export function foldWordAble(name) {
  if (!name) return null;
  const file = path.join(ABLES_DIR, `${String(name)}.word`);
  if (!existsSync(file)) return null;
  try {
    return foldAbleNoun(String(name), readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// listAbleWordNames() → every able-word name in the store (the seed able vocabulary).
export function listAbleWordNames() {
  try {
    return readdirSync(ABLES_DIR)
      .filter((f) => f.endsWith(".word"))
      .map((f) => f.replace(/\.word$/, ""));
  } catch {
    return [];
  }
}
