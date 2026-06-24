// The BOOK / STORY — facts woven into the story they tell, genesis → the live edge.
//
// FOUR STORY VIEWS (Tabor) — one panel you could live in (read, watch, act):
//   world    — the whole history and all its activity. The WORLD's story.
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
const actorName = (f) => f.by ?? null; // the actor Name (rule 9)
const beingOf = (f) => f.through ?? null; // the being the act ran through (rule 9)
const objOf = (f) => f.of ?? null; // the object acted on { kind, id }
const opOf = (f) => f.act ?? f.verb; // the operation (act); the verb names the family
const recv = (f) => f.to ?? null; // the receiver (rule 17)

// ── the four story views ────────────────────────────────────────────────────────────
export async function assembleStory(
  scope = "world",
  {
    history = "0",
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
  const q = { history: String(history) };
  if (since) q.date = { $gt: since instanceof Date ? since : new Date(since) };

  // The views are ONE coordinate system, not four parallels: WHO (being → lineage → world, the
  // same author-axis at three widths) × WHEN (a moment's cross-section) × WHERE (a space's whole
  // history). Each is the same scoped fold — only the filter on which facts it reads changes.
  if (scope === "being" && being) {
    // WHO, one: the being's own thread from its start — the being it ran through, or a Name that is it
    q.$or = [{ through: String(being) }, { by: String(being) }];
  } else if (scope === "lineage" && being) {
    // WHO, widened along the birth tree: the being + its descendants, to an optional stopping depth
    const ids = await descendantsOf(String(being), depth, String(history));
    q.through = { $in: ids };
  } else if (scope === "moment" && moment) {
    // WHEN: one moment's cross-section — the facts that act laid (its landings on every reel it touched)
    q.actId = String(moment);
  } else if ((scope === "place" || scope === "space") && space) {
    // WHERE: a space's whole story. Not just facts that acted ON the space (of.id === space),
    // but the facts of everything LOCATED IN it — child spaces (Space.parent), matter present
    // (Matter.spaceId), and beings present (Being.position) — each one's chain. So the place
    // reads as the location's full history: the room and everything that lived in it.
    const [{ default: Matter }, { default: Being }, { default: Space }] =
      await Promise.all([
        import("../../materials/matter/matter.js"),
        import("../../materials/being/being.js"),
        import("../../materials/space/space.js"),
      ]);
    const S = String(space);
    const [matterIn, beingsIn, childSpaces] = await Promise.all([
      Matter.find({ spaceId: S }).select("_id").lean(),
      Being.find({ position: S }).select("_id").lean(),
      Space.find({ parent: S }).select("_id").lean(),
    ]);
    const beingIds = beingsIn.map((b) => String(b._id));
    const ofIds = [
      S,
      ...childSpaces.map((s) => String(s._id)),
      ...matterIn.map((m) => String(m._id)),
      ...beingIds,
    ];
    // facts ON any of those (the object side) OR acts BY a being present here (the through side)
    q.$or = [{ "of.id": { $in: ofIds } }, { through: { $in: beingIds } }];
  }
  // scope "world" → WHO, all authors: the whole history (no extra filter)

  // ORDER is the truth, never the clock (623/12, 20.md). A single chain (being/lineage/space/moment)
  // leads with seq (its chain order); only "world" spans concurrent reels with no single seq, so date
  // PRESENTS the concurrent facts (time as content, not truth-order) — mirrors read-trail.js.
  const sort = scope === "world" ? { date: 1, seq: 1 } : { seq: 1, date: 1 };
  let cursor = Fact.find(q).sort(sort).lean();
  if (limit) cursor = cursor.limit(limit);
  const facts = await cursor;
  const names = await resolveNames(facts, String(history));
  // first-person ("I …") for the FOCAL being's own lines; third-person (saw) otherwise. An
  // explicit nameId (INCLUDING null) overrides: recall passes its own being for a `recalled` view
  // (first person) and null for a `saw` view (third person); the book defaults to the being it scopes.
  const focal =
    nameId !== undefined
      ? nameId
      : scope === "being" || scope === "lineage"
        ? being
        : null;
  return weave(facts, focal, names);
}

// the world story is the default book; keep the name the read/write halves already call
export async function assembleBook(history = "0", opts = {}) {
  return assembleStory("world", { history, ...opts });
}

// walk the birth tree from a being down to its descendants, bounded by `depth` (null = all)
async function descendantsOf(beingId, depth, _history) {
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

// A SELF-call is a being summoning ITSELF — the wake-call intake lays to kick off a moment
// (intake.js: through === of.id). It's the moment's plumbing, not a deed, so the story skips it
// (otherwise every move trails a phantom "I called <self>"). Real calls to OTHER beings stay.
function isSelfCall(f) {
  const op = opOf(f);
  if (op !== "call" && op !== "summon") return false;
  const o = objOf(f);
  return !!(o && o.id != null && String(beingOf(f)) === String(o.id));
}

// ── weave: group facts into acts, render each as one past-tense Word sentence ─────────
function weave(facts, focalBeing, names) {
  const acts = [];
  const byAct = new Map();
  for (const f of facts) {
    if (isSelfCall(f)) continue; // the wake-call kickoff — not a story event
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
async function resolveNames(facts, history) {
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
  const names = new Map([["i-am", "I"]]);
  for (const [id, kind] of want) {
    try {
      const slot = await loadOrFold(kind, id, history);
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
    case "grant-able":
      return `${pastOf("grant")}${target?.id ? ` ${displayName(target.id, names)}` : ""} the ${p.able || "?"} able`;
    case "revoke-able":
      return `${pastOf("take")} the ${p.able || "?"} able${target?.id ? ` from ${displayName(target.id, names)}` : ""}`;
    case "coin": {
      // The unified word shape: params.word + binding. A concept word carries its declaration in
      // binding.says; show it, so the story reads the seed.
      const word = p.word || "?";
      const says =
        p.binding && typeof p.binding.says === "string"
          ? p.binding.says.replace(/\s*\n\s*/g, " ").trim()
          : null;
      return says
        ? `${pastOf("speak")} the word ${word}: ${says}`
        : `${pastOf("speak")} the word ${word}`;
    }
    case "retire":
      return `${pastOf("silence")} the word ${p.word || "?"}`;
    case "set-space":
    case "set-being":
    case "set-matter": {
      // show the VALUE, not just the field: "set the coord to (7, 2)", "set the owner to bob"
      const val = glossSetValue(p.value, names);
      return `${pastOf("set")} ${fieldGloss(p.field)}${val ? ` to ${val}` : ""}`;
    }
    case "move":
      return `${pastOf("move")} to ${targetName(target, names) || "the space"}`;
    case "give":
      return `${pastOf("give")} ${targetName(target, names) || "it"}${recv(f) ? ` to ${displayName(recv(f), names)}` : ""}`;
    case "birth":
    case "form-being":
      return `${pastOf("give")} birth to ${targetName(target, names) || p.name || "a being"}`;
    case "declare":
      return `${pastOf("declare")} ${p.name || targetName(target, names) || displayName(beingOf(f), names)}`.trimEnd();
    case "call": {
      // Rendered in the Word (book only — NOT a change to the call fact). The reach verb shows
      // only when it carries weight: a REPLY shows "replied to Y"; an intent-only reach shows
      // "called Y to <intent>". A plain message IMPLIES the call — just "said '…' to Y" (Tabor).
      // Any other deed in the same act (a birth, etc.) joins on via the weave's "and".
      // The receiver is the call's `to`, but a call carries the being on `of` (the right
      // stance), so `to` is usually null — fall to of.id rather than displayName(null), which
      // returns the truthy "someone" and would short-circuit the resolution.
      const who = displayName(recv(f) ?? target?.id, names);
      // Content may be a string (saying) OR an object payload (with). Only a STRING is "said";
      // an object renders by intent, never as "[object Object]".
      const raw = p.content ?? p.message ?? p.saying ?? p.said;
      const fromObj =
        raw && typeof raw === "object"
          ? (raw.content ?? raw.message ?? raw.text ?? raw.saying)
          : null;
      const said =
        typeof raw === "string"
          ? raw
          : typeof fromObj === "string"
            ? fromObj
            : null;
      const hasSaid = typeof said === "string" && said !== "";
      const intent =
        p.intent &&
        !["message", "talk", "say", "reply", "call", "summon"].includes(
          p.intent,
        )
          ? String(p.intent).replace(/-/g, " ")
          : null; // an intent LABEL, not a deed — no past-tensing
      if (f.inReplyTo || p.inReplyTo)
        return hasSaid
          ? `${pastOf("reply")} to ${who}, and ${pastOf("say")} "${said}"`
          : `${pastOf("reply")} to ${who}`;
      if (hasSaid) return `${pastOf("say")} "${said}" to ${who}`; // message → the call is implied
      return intent
        ? `${pastOf("call")} ${who} to ${intent}`
        : `${pastOf("call")} ${who}`; // intent-only → "called"
    }
    case "verdict": {
      // the recorded memory of a recall — "saw the world that it was good (because …)". The
      // mode renders by chain (recalled=own, saw=world); the reason is the why, kept for next time.
      const what = typeof p.that === "string" ? p.that : JSON.stringify(p.that);
      return `${p.mode || "saw"}${p.of ? ` ${p.of}` : ""} that ${what}${p.because ? ` (because ${p.because})` : ""}`;
    }
    case "if":
      // the branch-record of a control-flow if (P4): which way the fold went. The condition was a
      // see (no fact); this do marks the chosen way, and the taken consequent chains on it.
      return `${pastOf("take")} the ${p.taken || "?"} branch`;
    case "i-am":
      return `${pastOf("speak")} its own name`;
    default:
      return `${humanize(op)}${target ? ` ${targetName(target, names)}` : ""}`;
  }
}

function fieldGloss(field) {
  if (!field) return "a quality";
  const f = String(field).replace(/^qualities\./, "");
  if (f.startsWith("ables.")) return `the ${f.slice(6)} able`;
  if (f.startsWith("world.")) return `the ${f.split(".").pop()} signal`;
  if (f === "pointers") return "the pointers";
  if (f === "owner") return "the owner";
  return `the ${f.replace(/\./g, " ")}`;
}

// Render a set-value in the Word, secret-safe: a coord as "(x, y[, z])", an id as the name it
// resolves to, a string/number plainly. Complex/unknown objects are skipped (return null) rather
// than dumped — never leak a blob or a secret-bearing value into the story.
function glossSetValue(value, names) {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") return names.get(value) || `"${value}"`;
  if (typeof value === "object") {
    if (Number.isFinite(value.x) && Number.isFinite(value.y))
      return `(${value.x}, ${value.y}${Number.isFinite(value.z) ? `, ${value.z}` : ""})`;
    if (value.id) return displayName(value.id, names); // an owner/position ref → the name
    return null; // a blob — don't dump it
  }
  return null;
}

function displayActor(a, names) {
  if (a.byName === "i-am") return "I";
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
  return out === "i-am" ? "I" : out;
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
