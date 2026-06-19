// The BOOK / STORY — facts woven into the story they tell, genesis → the live edge.
//
// FOUR STORY VIEWS (Tabor) — one panel you could live in (read, watch, act):
//   world    — the whole branch and all its activity. The WORLD's story.
//   place    — only the parts of the fold that made one moment. The MOMENT's story.
//   being    — every act/fact from a being's start, its own thread. The BEING's story.
//   lineage  — a being and all its children (choose a stopping point). The FAMILY's story.
// (3d / text / directory are MOMENT/PLACE views; the old flat "history" view is retired —
// these four replace it.)
//
// STRUCTURE: an ACT is the head, its FACTS the landings (a fact = (act, reel); group by actId,
// dedup identical deeds, single-landing collapses). RENDER: past-tense WORD, never JSON/verb:op;
// deeds of one act joined with "and"; ids resolved to proper names. ORDER: time (seq is
// per-reel; the timeline scrubs by date; `since` is the chunk window). Secret-safe gloss.
//
// CLAUSE NAMES: facts carry the Word's clause properties — `by` (actor Name), `through` (the
// being the act ran through), `of` (the object), `act` (the operation), `to` (the receiver —
// always a being; its owning Names respond). The accessors below read exactly those.

import { pastOf } from "../word/verbTense.js";

// ── fact-field accessors (the Word's clause names) ──────────────────────────────────
const actorName = (f) => f.by ?? null;     // the actor Name (rule 9)
const beingOf   = (f) => f.through ?? null; // the being the act ran through (rule 9)
const objOf     = (f) => f.of ?? null;      // the object acted on { kind, id }
const opOf      = (f) => f.act ?? f.verb;   // the operation (act); the verb names the family
const recv      = (f) => f.to ?? null;      // the receiver (rule 17)

// ── the four story views ────────────────────────────────────────────────────────────
export async function assembleStory(
  scope = "world",
  {
    branch = "0",
    being = null,
    moment = null,
    space = null,
    depth = null,
    nameId = undefined,
    limit = 0,
    since = null,
  } = {},
) {
  const { default: Fact } = await import("../../past/fact/fact.js");
  const q = { branch: String(branch) };
  if (since) q.date = { $gt: since instanceof Date ? since : new Date(since) };

  // The views are ONE coordinate system, not four parallels: WHO (being → lineage → world, the
  // same author-axis at three widths) × WHEN (a moment's cross-section) × WHERE (a space's whole
  // history). Each is the same scoped fold — only the filter on which facts it reads changes.
  if (scope === "being" && being) {
    // WHO, one: the being's own thread from its start — the being it ran through, or a Name that is it
    q.$or = [{ through: String(being) }, { by: String(being) }];
  } else if (scope === "lineage" && being) {
    // WHO, widened along the birth tree: the being + its descendants, to an optional stopping depth
    const ids = await descendantsOf(String(being), depth, String(branch));
    q.through = { $in: ids };
  } else if (scope === "moment" && moment) {
    // WHEN: one moment's cross-section — the facts that act laid (its landings on every reel it touched)
    q.actId = String(moment);
  } else if ((scope === "place" || scope === "space") && space) {
    // WHERE: a space's whole history — everything that ever happened to/in that location, across all time
    q["of.id"] = String(space);
  }
  // scope "world" → WHO, all authors: the whole branch (no extra filter)

  let cursor = Fact.find(q).sort({ date: 1, seq: 1 }).lean();
  if (limit) cursor = cursor.limit(limit);
  const facts = await cursor;
  const names = await resolveNames(facts, String(branch));
  // first-person ("I …") for the FOCAL being's own lines; third-person (saw) otherwise. An
  // explicit nameId (INCLUDING null) overrides: recall passes its own being for a `recalled` view
  // (first person) and null for a `saw` view (third person); the book defaults to the being it scopes.
  const focal =
    nameId !== undefined ? nameId : (scope === "being" || scope === "lineage" ? being : null);
  return weave(facts, focal, names);
}

// the world story is the default book; keep the name the read/write halves already call
export async function assembleBook(branch = "0", opts = {}) {
  return assembleStory("world", { branch, ...opts });
}

// walk the birth tree from a being down to its descendants, bounded by `depth` (null = all)
async function descendantsOf(beingId, depth, _branch) {
  const { default: Being } = await import("../../materials/being/being.js");
  const ids = [String(beingId)];
  let frontier = [String(beingId)];
  let remaining = depth == null ? Infinity : Number(depth);
  while (frontier.length && remaining-- > 0) {
    const kids = await Being.find({ parentBeingId: { $in: frontier } })
      .select("_id")
      .lean();
    const next = kids
      .map((k) => String(k._id))
      .filter((id) => !ids.includes(id));
    if (!next.length) break;
    ids.push(...next);
    frontier = next;
  }
  return ids;
}

// ── weave: group facts into acts, render each as one past-tense Word sentence ─────────
function weave(facts, focalBeing, names) {
  const acts = [];
  const byAct = new Map();
  for (const f of facts) {
    const key = f.actId ? `act:${f.actId}` : `solo:${f._id}`;
    let act = byAct.get(key);
    if (!act) {
      const isMine =
        focalBeing != null &&
        (String(actorName(f)) === String(focalBeing) ||
          String(beingOf(f)) === String(focalBeing));
      act = {
        actId: f.actId || null,
        byName: actorName(f),
        byBeing: beingOf(f),
        mine: focalBeing != null ? isMine : null,
        seq: f.seq,
        date: f.date,
        landings: [],
      };
      byAct.set(key, act);
      acts.push(act);
    }
    act.landings.push({ seq: f.seq, did: pastPhrase(f, names) }); // the past-tense deed on this reel
  }
  return acts.map((a) => {
    const subject = a.mine ? "I" : displayActor(a, names);
    return {
      actId: a.actId,
      seq: a.seq,
      date: a.date,
      by: a.byName || a.byBeing,
      mine: a.mine,
      subject,
      landings: a.landings,
      line: `${subject} ${joinDeeds([...new Set(a.landings.map((l) => l.did))])}.`,
    };
  });
}

// ── id → proper name, resolved once per story from the reel slots ────────────────────
async function resolveNames(facts, branch) {
  const { loadOrFold } = await import("../../materials/projections.js");
  const want = new Map();
  for (const f of facts) {
    const v = beingOf(f);
    if (v && v !== "i-am") want.set(String(v), "being");
    const r = recv(f);
    if (r) want.set(String(r), "being");
    const o = objOf(f);
    if (o && o.id)
      want.set(String(o.id), o.kind === "stance" ? "space" : o.kind || "being");
  }
  const names = new Map([["i-am", "I_AM"]]);
  for (const [id, kind] of want) {
    try {
      const slot = await loadOrFold(kind, id, branch);
      if (slot?.state?.name) names.set(id, slot.state.name);
    } catch {
      /* unresolved ids fall back to the short form */
    }
  }
  return names;
}

// ── fact → past-tense Word (the predicate; the subject is the act's head) ─────────────
function pastPhrase(f, names) {
  const op = opOf(f);
  const p = f.params || {};
  const target = objOf(f);
  switch (op) {
    case "create-space":
      return `${pastOf("make")} the space ${p.name || targetName(target, names)}`;
    case "create-matter":
      return `${pastOf("make")} ${targetName(target, names) || p.name || "something"}`;
    case "grant-role":
      return `${pastOf("grant")}${target?.id ? ` ${displayName(target.id, names)}` : ""} the ${p.role || "?"} role`;
    case "revoke-role":
      return `${pastOf("take")} the ${p.role || "?"} role${target?.id ? ` from ${displayName(target.id, names)}` : ""}`;
    case "declare-word":
      return `${pastOf("speak")} the word ${p.role ? p.role + ":" : ""}${p.op || "?"}`;
    case "disable-word":
      return `${pastOf("silence")} the word ${p.op || "?"}`;
    case "set-space":
    case "set-being":
    case "set-matter":
      return `${pastOf("set")} ${fieldGloss(p.field)}`;
    case "move":
      return `${pastOf("move")} to ${targetName(target, names) || "the space"}`;
    case "give":
      return `${pastOf("give")} ${targetName(target, names) || "it"}${recv(f) ? ` to ${displayName(recv(f), names)}` : ""}`;
    case "birth":
    case "form-being":
      return `${pastOf("give")} birth to ${targetName(target, names) || p.name || "a being"}`;
    case "declare":
      return `${pastOf("declare")} ${p.name || targetName(target, names) || displayName(beingOf(f), names)}`.trimEnd();
    case "summon":
    case "call": {
      // Rendered in the Word (book only — NOT a change to the call fact). The reach verb shows
      // only when it carries weight: a REPLY shows "replied to Y"; an intent-only reach shows
      // "called Y to <intent>". A plain message IMPLIES the call — just "said '…' to Y" (Tabor).
      // Any other deed in the same act (a birth, etc.) joins on via the weave's "and".
      const who = displayName(recv(f), names) || targetName(target, names) || "someone";
      const said = p.content ?? p.message ?? p.saying ?? p.said;
      const hasSaid = said != null && said !== "";
      const intent = p.intent && !["message", "talk", "say", "reply", "call", "summon"].includes(p.intent) ? String(p.intent).replace(/-/g, " ") : null; // an intent LABEL, not a deed — no past-tensing
      if (f.inReplyTo || p.inReplyTo)
        return hasSaid ? `${pastOf("reply")} to ${who}, and ${pastOf("say")} "${said}"` : `${pastOf("reply")} to ${who}`;
      if (hasSaid) return `${pastOf("say")} "${said}" to ${who}`;                 // message → the call is implied
      return intent ? `${pastOf("call")} ${who} to ${intent}` : `${pastOf("call")} ${who}`; // intent-only → "called"
    }
    case "verdict": {
      // the recorded memory of a recall — "saw the world that it was good (because …)". The
      // mode renders by chain (recalled=own, saw=world); the reason is the why, kept for next time.
      const what = typeof p.that === "string" ? p.that : JSON.stringify(p.that);
      return `${p.mode || "saw"}${p.of ? ` ${p.of}` : ""} that ${what}${p.because ? ` (because ${p.because})` : ""}`;
    }
    case "i-am":
      return `${pastOf("speak")} its own name`;
    default:
      return `${humanize(op)}${target ? ` ${targetName(target, names)}` : ""}`;
  }
}

function fieldGloss(field) {
  if (!field) return "a quality";
  const f = String(field).replace(/^qualities\./, "");
  if (f.startsWith("roles.")) return `the ${f.slice(6)} role`;
  if (f.startsWith("world.")) return `the ${f.split(".").pop()} signal`;
  if (f === "pointers") return "the pointers";
  if (f === "owner") return "the owner";
  return `the ${f.replace(/\./g, " ")}`;
}

function displayActor(a, names) {
  if (a.byName === "i-am") return "I_AM";
  return (
    names.get(String(a.byBeing)) ||
    names.get(String(a.byName)) ||
    displayName(a.byBeing || a.byName, names)
  );
}

function targetName(t, names) {
  if (!t) return "";
  return displayName(t.id ?? t, names);
}

function displayName(id, names) {
  if (id == null) return "someone";
  const s = String(id);
  const out =
    names && names.has(s) ? names.get(s) : s.length > 14 ? s.slice(0, 8) : s;
  return out === "i-am" ? "I_AM" : out;
}

// join an act's deeds into one sentence: "A", "A and B", "A, B, and C"
function joinDeeds(deeds) {
  const d = deeds.filter(Boolean);
  if (d.length <= 1) return d[0] || "did nothing";
  if (d.length === 2) return `${d[0]} and ${d[1]}`;
  return `${d.slice(0, -1).join(", ")}, and ${d[d.length - 1]}`;
}

// the fallback: any op without a hand-tuned phrase still reads PAST tense via the declared past
function humanize(op) {
  const words = String(op).split("-");
  words[0] = pastOf(words[0]);
  return words.join(" ");
}
