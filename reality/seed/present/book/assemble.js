// The BOOK — a branch's story, woven from its facts (the threads), genesis → the live edge.
//
// STRUCTURE (Tabor): an ACT is the head; its FACTS are the landings — one per reel it WROTE
// (SEE never stamps, so reads don't appear; only writes land). A fact = (act, reel): the act
// seen from a target it changed. We GROUP by actId to show the act-view, while storage stays
// per-reel/denormalized so each reel's incremental fold stays LOCAL (the optimization is a
// view, not a storage change). A single-landing act COLLAPSES to one line: the fact is just
// the act. No special rule — it falls out of the grouping.
//
// TENSE (Tabor): the act is the live head (present, as you TYPE it — see type.js); its facts
// are the sealed landings (PAST, everywhere it landed). The book is the record, so it reads in
// PAST TENSE, in the Word — never JSON, never verb:op. The present tense lives only at the
// live edge where you type; once pressed, every line is past.
//
// NAMES (Tabor): ids resolve to PROPER NAMES — the book reads "Cherub made the space identity",
// not "966aafcb made 50b6d98b". Resolved from the reel slots (state.name), the live half of
// 7.md's proper-name bridge. i-am reads as I_AM.
//
// PER-NAME view (the face): `opts.nameId` renders the reader's own thread in first person
// ("I made…", recall) and the world's in third ("Cherub made…", saw).
//
// ORDER: `seq` is PER-REEL (a new reel starts at 1), so the GLOBAL story order — what the
// timeline scrubs — is the seal time (date). `since` is the scrub point (a Date): the chunk
// after it. Secret-safe: the gloss never prints password/credential/key/token/mnemonic values.

import { pastOf } from "../word/verbTense.js";

export async function assembleBook(branch = "0", { nameId = null, limit = 0, since = null } = {}) {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const q = { branch: String(branch) };
  if (since) q.date = { $gt: since instanceof Date ? since : new Date(since) };
  let cursor = Fact.find(q).sort({ date: 1, seq: 1 }).lean();
  if (limit) cursor = cursor.limit(limit);
  const facts = await cursor;

  const names = await resolveNames(facts, String(branch)); // id → proper name (Cherub, identity…)

  const acts = [];
  const byAct = new Map();
  for (const f of facts) {
    const key = f.actId ? `act:${f.actId}` : `solo:${f._id}`;
    let act = byAct.get(key);
    if (!act) {
      act = {
        actId: f.actId || null,
        byName: f.nameId || null, byBeing: f.beingId || null,
        mine: nameId ? String(f.nameId) === String(nameId) : null,
        seq: f.seq, date: f.date, landings: [],
      };
      byAct.set(key, act);
      acts.push(act);
    }
    act.landings.push({ seq: f.seq, did: pastPhrase(f, names) }); // the past-tense deed on this reel
  }

  return acts.map((a) => {
    const subject = a.mine ? "I" : displayActor(a, names);
    return {
      actId: a.actId, seq: a.seq, date: a.date, by: a.byName || a.byBeing, mine: a.mine,
      subject,
      landings: a.landings,                                  // [{seq, did}] — the past-tense deeds
      // all of an act's deeds in ONE past-tense sentence, joined by "and" (the waw-consecutive,
      // Genesis's "And he did X and Y"): "I_AM gave birth to Cherub and granted it the role".
      // DEDUP identical deeds: a fact = (act, reel), so the SAME deed landing on several reels
      // (create-space on the child and its parent) is one deed seen twice — shown once.
      line: `${subject} ${joinDeeds([...new Set(a.landings.map((l) => l.did))])}.`,
    };
  });
}

// ── id → proper name, resolved once per book from the reel slots ─────────────────────
async function resolveNames(facts, branch) {
  const { loadOrFold } = await import("../../materials/projections.js");
  const want = new Map(); // id → kind, the ids the book references
  for (const f of facts) {
    if (f.beingId && f.beingId !== "i-am") want.set(String(f.beingId), "being");
    if (f.to) want.set(String(f.to), "being");
    if (f.target?.id) want.set(String(f.target.id), f.target.kind === "stance" ? "space" : (f.target.kind || "being"));
  }
  const names = new Map([["i-am", "I_AM"]]);
  for (const [id, kind] of want) {
    try {
      const slot = await loadOrFold(kind, id, branch);
      if (slot?.state?.name) names.set(id, slot.state.name);
    } catch { /* unresolved ids fall back to the short form */ }
  }
  return names;
}

// ── fact → past-tense Word (the inverse of the parser, in the past) ─────────────────
// Renders the PREDICATE only (the subject is the act's head). The book never shows
// `do:create-space` — it shows "made the space notebook".

function pastPhrase(f, names) {
  const op = f.action || f.verb || "did";
  const p = f.params || {};
  // every past comes from the verb's DECLARED past (verbTense / verbs.word), never a literal —
  // "make → made", "give → gave", "speak → spoke", "grant → granted" by the rule
  switch (op) {
    case "create-space":  return `${pastOf("make")} the space ${p.name || targetName(f.target, names)}`;
    case "create-matter": return `${pastOf("make")} ${targetName(f.target, names) || p.name || "something"}`;
    case "grant-role":    return `${pastOf("grant")}${f.target?.id ? ` ${displayName(f.target.id, names)}` : ""} the ${p.role || "?"} role`;
    case "revoke-role":   return `${pastOf("take")} the ${p.role || "?"} role${f.target?.id ? ` from ${displayName(f.target.id, names)}` : ""}`;
    case "declare-word":  return `${pastOf("speak")} the word ${p.role ? p.role + ":" : ""}${p.op || "?"}`;
    case "disable-word":  return `${pastOf("silence")} the word ${p.op || "?"}`;
    case "set-space":
    case "set-being":
    case "set-matter":    return `${pastOf("set")} ${fieldGloss(p.field)}`;
    case "move":          return `${pastOf("move")} to ${targetName(f.target, names) || "the space"}`;
    case "give":          return `${pastOf("give")} ${targetName(f.target, names) || "it"}${f.to ? ` to ${displayName(f.to, names)}` : ""}`;
    case "birth":
    case "form-being":    return `${pastOf("give")} birth to ${targetName(f.target, names) || p.name || "a being"}`;
    case "declare":       return `${pastOf("declare")} ${p.name || targetName(f.target, names) || displayName(f.beingId, names)}`.trimEnd();
    case "summon":        return `${pastOf("call")} ${targetName(f.target, names) || displayName(f.to, names) || "someone"}`;
    case "i-am":          return `${pastOf("speak")} its own name`;
    default:              return `${humanize(op)}${f.target ? ` ${targetName(f.target, names)}` : ""}`;
  }
}

function fieldGloss(field) {
  if (!field) return "a quality";
  const f = String(field).replace(/^qualities\./, "");
  if (f.startsWith("roles."))   return `the ${f.slice(6)} role`;
  if (f.startsWith("world."))   return `the ${f.split(".").pop()} signal`;
  if (f === "pointers")          return "the pointers";
  if (f === "owner")             return "the owner";
  return `the ${f.replace(/\./g, " ")}`;
}

function displayActor(a, names) {
  if (a.byName === "i-am") return "I_AM";
  return names.get(String(a.byBeing)) || names.get(String(a.byName)) || displayName(a.byBeing || a.byName, names);
}

function targetName(t, names) {
  if (!t) return "";
  return displayName(t.id ?? t, names);
}

function displayName(id, names) {
  if (id == null) return "someone";
  const s = String(id);
  const out = (names && names.has(s)) ? names.get(s) : (s.length > 14 ? s.slice(0, 8) : s);
  return out === "i-am" ? "I_AM" : out;                 // i-am reads as I_AM, resolved or raw
}

// join an act's deeds into one sentence: "A", "A and B", "A, B, and C"
function joinDeeds(deeds) {
  const d = deeds.filter(Boolean);
  if (d.length <= 1) return d[0] || "did nothing";
  if (d.length === 2) return `${d[0]} and ${d[1]}`;
  return `${d.slice(0, -1).join(", ")}, and ${d[d.length - 1]}`;
}

// the fallback: any op the book hasn't given a hand-tuned phrase to still reads PAST tense —
// past-tense the leading verb via the declared past (verbTense), keep the rest as the object.
function humanize(op) {
  const words = String(op).split("-");
  words[0] = pastOf(words[0]);
  return words.join(" ");
}
