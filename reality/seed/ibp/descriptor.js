// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Place description. What I say back to a SEE.
//
// A place is a space being used. The place root used by anyone who
// addresses my front door, a being's home used by the being who
// lives there, any other space used by whoever is standing in it —
// all of these are places. SEE asks "what does this place look
// like from where I stand?"; I answer here.
//
// One builder, one shape: buildPlaceDescriptor. The resolver hands
// me a resolved stance; I read what the place actually is from the
// stance flags (isSpaceRoot, isHomeRoot, otherwise a regular space)
// and fill out the same descriptor shape for every flavor. Internal
// helpers below select what children to list and what beings live
// here, but the wire shape stays uniform.
//
// I emit substrate facts only. The place's own `qualities` ride on
// the descriptor; the qualities of every child Space, every Matter
// at this place, and every Being living here ride on their own
// entries. Extensions surface what they write — they call
// `qualities.{space,being,matter}.setQuality(target, "<extName>",
// data)` to put it there, and their client reads
// `descriptor.qualities.<extName>` (or `child.qualities.<extName>`,
// `matter.qualities.<extName>`, `being.qualities.<extName>`) and
// renders. The seed hosts; it does not compose.
//
// I also produce the place's discovery payload (buildDiscovery) — the
// bootstrap-time wire shape that names protocol version, descriptor
// version, registered roles, and plantable seeds. It lives here
// because both descriptor and discovery are wire payloads my SEE
// verb returns, and they share types and version constants.

import { getRealityDomain } from "./address.js";
import { getRealityConfigValue, getRealityUrl } from "../realityConfig.js";
import Being from "../materials/being/being.js";
import Fact from "../past/fact/fact.js";
import { getSpaceRootId } from "../sprout.js";
import { listSeeds } from "../materials/seeds.js";
import { listMattersAt } from "../materials/matter/matters.js";
import { SEED_SPACE } from "../materials/space/seedSpaces.js";
import { listLiveThreads } from "../materials/space/threads.js";
import {
  resolveSpaceAccess,
  listSpaceChildren,
} from "../materials/space/spaces.js";
import { getInboxSummary } from "../present/intake/inbox.js";
import { getRole, listRoles } from "../present/roles/registry.js";
import { listOperations } from "./operations.js";
import { listBeOpNames, getBeOp } from "./beOps.js";
import { findOpenForBeing, findLastSealedForBeing } from "../present/beats/2-fold/reelChains.js";
import { fold } from "../present/beats/2-fold/foldEngine.js";
import { BE_OPS } from "./beOps.js";

// Fold an aggregate before reading its qualities. Per FOLD.md: the
// projection IS the cache, and fold() catches it up to the reel head
// before returning. Hot path is zero replay (one cache read when
// foldedSeq is current). Slice H seam — the moment descriptor reads
// flow through fold, any direct-write bypass becomes a visible
// inconsistency (the next fold round overwrites it from the fact
// chain). Per MOMENT.md: facts are truth; the row is the fold-so-far.
//
// Returns null when the aggregate doesn't exist; descriptor callers
// guard with `?.qualities` so missing data degrades to {} cleanly.
async function foldRead(type, id) {
  if (!id) return null;
  try {
    const { state } = await fold(type, String(id));
    return state;
  } catch {
    return null;
  }
}

// Wire-shape versions. Bump when the descriptor / discovery shape
// changes in a way clients must opt into.
export const DESCRIPTOR_VERSION   = "1.0";
export const IBP_PROTOCOL_VERSION = "1.0";
// ── Place discovery payload ──
// Returned by `ibp:see <reality>/.discovery` once a socket is open. The
// pre-identity surface every client reads to learn what I speak:
// protocol version, descriptor versions supported, WS URL, role
// names registered, verb set, plantable seeds.

// My BE-only beings — addressable through BE but not in the SUMMON
// role registry, so they need an explicit listing for the discovery
// payload.
const SYSTEM_BE_BEINGS = ["cherub", "llm-assigner"];

export function buildDiscovery() {
  const realityUrl = getRealityUrl();
  const wsUrl = realityUrl.replace(/^http/, "ws");

  // Merge two sources: the live role registry (SUMMON-honoring roles
  // registered by the seed + extensions) and the canonical system
  // beings (BE-only). Dedupe + sort.
  const roles = Array.from(
    new Set([...listRoles(), ...SYSTEM_BE_BEINGS]),
  ).sort();

  return {
    name: getRealityConfigValue("REALITY_NAME") || "Unnamed Place",
    reality: getRealityDomain(),
    protocolVersion: IBP_PROTOCOL_VERSION,
    descriptorVersionSupported: [DESCRIPTOR_VERSION],
    ws: wsUrl,
    auth: { method: "bearer" },
    roles,
    // Plantable scaffolds an operator can plant via DO `plant-seed`.
    seeds: listSeeds(),
    supportedVerbs: ["see", "do", "summon", "be"],
    capabilities: [],
  };
}

// ── Beings list at a space ──
// A position's beings are the beings whose HOME is this position.
// Source: qualities.beings.<name> on the space. Extensions place
// their beings by writing that namespace; I surface what's there.

function readNsFrom(qualities, name) {
  if (!qualities) return null;
  if (qualities instanceof Map) return qualities.get(name) || null;
  return qualities[name] || null;
}

function beingsAtSpace(space, { writeAllowed, authorizedHere }) {
  const beings = [];
  const beingHomes = readNsFrom(space?.qualities, "beings");
  // Stance-permission profiles share the qualities.beings namespace;
  // skip them so only entries naming a being surface here.
  const STANCE_NAMES = new Set(["arrival", "owner", "member"]);
  if (beingHomes) {
    const names = beingHomes instanceof Map
      ? Array.from(beingHomes.keys())
      : Object.keys(beingHomes);
    for (const name of names) {
      if (STANCE_NAMES.has(name)) continue;
      const home = beingHomes instanceof Map ? beingHomes.get(name) : beingHomes[name];
      const invocableBy = home?.invocableBy || "owner";
      beings.push({
        being: name,
        invocableBy,
        available: invocableBy === "anyone" ? authorizedHere : writeAllowed,
        // Internal-only, stripped before the wire — enrichBeings uses
        // it to attach the being's currently-active Act.
        _beingId: home?.beingId || null,
      });
    }
  }

  return beings;
}

// Beings whose Being.position points at this space — transient
// occupants. Two humans walking in a shared room get surfaced this
// way without writing into qualities.beings on every step. Merged
// with the qualities.beings-registered list; entries already present
// by beingId are skipped so a being doesn't appear twice.
async function occupantsByPosition(spaceId, existing) {
  if (!spaceId) return [];
  const Being = (await import("../materials/being/being.js")).default;
  const seen = new Set();
  for (const e of existing) {
    if (e._beingId) seen.add(String(e._beingId));
  }
  const rows = await Being
    .find({ position: spaceId })
    .select("_id name")
    .lean();
  const out = [];
  for (const row of rows) {
    const id = String(row._id);
    if (seen.has(id)) continue;
    out.push({
      being: row.name || id,
      invocableBy: "owner",
      available: false,
      _beingId: id,
    });
  }
  return out;
}

// ── Activity derivation ──
// For each being at a position, build an `activity` object from
// their currently-active Act. The latest Fact keyed by actId
// names what the being is doing right now; when no Act is active
// the being is idle and activity is null.

const ACTIVITY_CONTENT_CAP = 240;

function summarizeArgs(args) {
  if (args == null) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n) + "..." : s;
}

// Convert a Act into an activity object the descriptor surfaces
// for the being whose Act it is. Null when no Act is given.
// opts.sealed = true means the Act is closed and we surface its
// endMessage as "what they last said" so the speech bubble can
// persist between moments.
async function summonToActivity(summon, opts = {}) {
  if (!summon) return null;

  if (opts.sealed) {
    const raw = summon.endMessage;
    const text =
      raw && typeof raw === "object"
        ? typeof raw.content === "string" ? raw.content : ""
        : typeof raw === "string" ? raw : "";
    if (!text) return null;
    return {
      kind: "said",
      content: truncate(text, ACTIVITY_CONTENT_CAP),
      chainstepId: String(summon._id),
      target: null,
      ts: raw?.time || summon.stampedAt || new Date(),
    };
  }

  let lastFact = null;
  try {
    lastFact = await Fact.findOne({ actId: summon._id })
      .sort({ date: -1 })
      .select("action params date")
      .lean();
  } catch {
    // The descriptor never blocks on a Fact lookup.
  }
  const target = await inferActivityTarget(summon);

  if (lastFact) {
    // Outbound summon . the being just SUMMONed someone else. Surface
    // the recipient + message body so the portal renders
    // `→@<recipient> <content>` above this being's avatar. Multiplayer-
    // visible: every viewer sees what this being said to whom because
    // the source is the substrate's fact, not a per-tab UI side-channel.
    if (lastFact.action === "summon") {
      const recipientBeingId = lastFact.params?.recipient
        ? String(lastFact.params.recipient)
        : null;
      const recipientName = recipientBeingId
        ? await _lookupBeingName(recipientBeingId)
        : null;
      return {
        kind: "summoning",
        content: truncate(lastFact.params?.content || "", ACTIVITY_CONTENT_CAP),
        target: recipientBeingId
          ? {
              kind: "being",
              beingId: recipientBeingId,
              name: recipientName,
              role: lastFact.params?.activeRole || null,
            }
          : null,
        chainstepId: String(summon._id),
        ts: lastFact.date,
      };
    }

    // Other tool calls (do / see / non-summon be) . compact pill that
    // names the action. The portal renders these with a transient style.
    return {
      kind: "acting",
      content: truncate(
        `${lastFact.action}(${summarizeArgs(lastFact.params)})`,
        ACTIVITY_CONTENT_CAP,
      ),
      chainstepId: String(summon._id),
      target,
      ts: lastFact.date,
    };
  }

  return {
    kind: "summoned",
    content: truncate(summon.startMessage?.content || "", ACTIVITY_CONTENT_CAP),
    chainstepId: String(summon._id),
    target,
    ts: summon.stampedAt || new Date(),
  };
}

// Best-effort name lookup for a being id. Used by summonToActivity to
// pre-resolve the recipient name so the portal can render `→@<name>`
// without a second roundtrip. Returns null on miss (the portal falls
// back to role / beingId prefix).
async function _lookupBeingName(beingId) {
  try {
    const Being = (await import("../materials/being/being.js")).default;
    const row = await Being.findById(beingId).select("name").lean();
    return row?.name || null;
  } catch {
    return null;
  }
}

// Infer what a Act is acting on. The Act schema doesn't carry an
// explicit target field, but the reply linkage tells us: when inReplyTo
// is set, the Act was spawned by another being. Treat the parent's
// activeRole/position as the target so sub-beings animate walking toward
// their spawner.
async function inferActivityTarget(summon) {
  if (!summon?.inReplyTo) return null;
  let parent;
  try {
    const Act = (await import("../past/act/act.js")).default;
    parent = await Act.findById(summon.inReplyTo)
      .select("activeRole beingOut")
      .lean();
  } catch {
    return null;
  }
  if (!parent || !parent.activeRole || !parent.beingOut) return null;
  // Without aiContext/treeContext we no longer have a (spaceId, role)
  // tuple to hand the renderer. Surface the parent being + role so the
  // 3D portal can map "which mesh is this being" via its descriptor entry.
  return {
    kind: "being",
    beingId: String(parent.beingOut),
    role: parent.activeRole,
  };
}

/**
 * Build the place descriptor for a resolved stance. A place is a
 * space being used; the resolver tells me which space (and from
 * what angle — the place's front door, a being's home, a regular
 * position) and I build the same descriptor shape for every flavor.
 *
 * @param {object} resolved — output of resolver.resolveStance()
 * @param {object} [opts]
 * @param {object} [opts.identity] — { beingId, name } of the asker
 * @returns {object} Place descriptor
 */
export async function buildPlaceDescriptor(resolved, opts = {}) {
  if (resolved.isSpaceRoot) return placeAtSpaceRoot(resolved, opts);
  return placeAtSpace(resolved, opts);
}

async function placeAtSpaceRoot(resolved, { identity } = {}) {
  const realityDomain = getRealityDomain();
  const spaceRootId = getSpaceRootId();
  const isRegistered = (beingName) => !!getRole(beingName);

  const spaceRoot = await foldRead("space", spaceRootId);
  let children = spaceRootId ? await childrenOf(spaceRootId, "/") : [];

  // The childrenOf walk filters out seed spaces (so .config/.tools
  // etc. don't pollute the place-root listing). Heaven IS a seed
  // space but is meant to be visible at the place root as the door
  // into the I-Am's room . inject it explicitly. Reigning gating
  // happens at SEE-time when a being tries to walk through; here we
  // just surface the door.
  if (spaceRootId) {
    const Space = (await import("../materials/space/space.js")).default;
    const heaven = await Space.findOne({ seedSpace: SEED_SPACE.HEAVEN })
      .select("_id name type qualities coord")
      .lean();
    if (heaven) {
      const folded = (await foldRead("space", heaven._id)) || heaven;
      children = [
        {
          name: folded.name || heaven.name,
          spaceId: heaven._id,
          type: folded.type ?? heaven.type ?? null,
          coord: folded.coord ?? heaven.coord ?? null,
          seedSpace: SEED_SPACE.HEAVEN,
          path: `/${heaven.name}`,
          qualities: serializeQualities(folded.qualities || heaven.qualities),
        },
        ...children,
      ];
    }
  }

  const matters = spaceRootId ? await listMattersAt(spaceRootId) : [];

  // My place-root beings — ensureSeedDelegates plants them; this list
  // makes them addressable from the place descriptor without walking
  // qualities.beings. `available` reflects whether the role's
  // backing extension is currently registered.
  //
  // The raw list runs through enrichBeings so each entry picks up the
  // role's `actions[]` surface (from canBe + BE_OPS) plus identity,
  // permissions, inbox, activity, qualities, etc. Without this the
  // 3D portal sees the bare {being, invocableBy, available} triple
  // and renders cherub with "no actions" because the actions array
  // is undefined.
  // Seed-delegate labels at the place root: the role + invocability
  // surface every fresh visitor sees on first SEE. The roster (name,
  // role, cognition, invocableBy) lives in SEED_DELEGATES . single
  // source of truth. We resolve each delegate's REAL Being row id by
  // name so occupantsByPosition's dedupe (keyed on _beingId)
  // recognizes them and doesn't surface the same being twice. Each
  // entry carries the role-specific invocableBy + availability; if
  // the delegate's row hasn't planted yet (early boot, or a
  // misconfigured place), the entry surfaces anyway with _beingId:
  // null so the label and action surface still render . it just
  // can't carry coord/inbox/activity until the row catches up.
  const { SEED_DELEGATES } = await import("../materials/being/seedDelegates.js");
  const delegateNames = SEED_DELEGATES.map((d) => d.name);
  const delegateRows = await Being.find({ name: { $in: delegateNames } })
    .select("_id name")
    .lean();
  const delegateIdByName = new Map(
    delegateRows.map((r) => [r.name, String(r._id)]),
  );
  const seedDelegateEntries = SEED_DELEGATES.map((d) => ({
    being:       d.name,
    invocableBy: d.invocableBy || "authenticated",
    available:   isRegistered(d.name),
    _beingId:    delegateIdByName.get(d.name) || null,
  }));
  // Merge in transient occupants . any being whose position points at
  // the space root and isn't already a seed delegate above. Mirrors
  // the placeAtSpace path so the reality root surfaces humans /
  // scripted / LLM beings standing there, not just seed delegates.
  const transientRoot = spaceRootId
    ? await occupantsByPosition(spaceRootId, seedDelegateEntries)
    : [];
  const spaceRootBeings = await enrichBeings(
    spaceRootId,
    [...seedDelegateEntries, ...transientRoot],
    { identity },
  );

  return {
    address: {
      place: realityDomain,
      path: "/",
      being: resolved.being || null,
      spaceId: spaceRootId || null,
      beingId: null,
      chain: [],
      pathByNames: "/",
      pathByIds: "/",
      leafName: null,
      leafId: null,
    },
    isSpaceRoot: true,
    isHomeRoot: false,
    // Surface the space root's `size` on the wire, same as placeAtSpace
    // does for non-root positions. Without this the 3D portal's sized-
    // land render branch never fires at the reality root . it falls
    // back to the infinite outdoor scene even though the root now
    // carries a default size at creation time.
    size: spaceRoot?.size || null,
    beings: spaceRootBeings,
    children,
    matters,
    qualities: serializeQualities(spaceRoot?.qualities),
    place: {
      name: getRealityConfigValue("REALITY_NAME") || "Unnamed Place",
    },
    identity: await identityBlock(identity, { authorizedHere: true, writeAllowed: false }),
    _meta: meta(),
  };
}

async function placeAtSpace(resolved, { identity, payload } = {}) {
  const realityDomain = getRealityDomain();
  if (!resolved.leafSpace) throw new Error("Resolved space missing leafSpace reference");

  // Fold the leaf before reading its qualities (Slice H seam).
  // Resolver's leafSpace is a snapshot; fold catches the projection up
  // to its reel head so any bypass write (legacy qualities.js direct
  // path) gets overwritten on the next round, and the descriptor's
  // exposed qualities are the fact-chain's truth.
  const folded = await foldRead("space", resolved.leafSpace._id);
  const space = folded || resolved.leafSpace;

  const pathByNames = "/" + resolved.chain.map((c) => c.name).join("/");
  const pathByIds   = "/" + resolved.chain.map((c) => c.id).join("/");
  const parentPath  = pathByNames.replace(/\/[^/]+$/, "") || "/";

  // .threads has no persisted children; the live forest is projected
  // on demand from Act records keyed by rootCorrelation. The SEE
  // payload's filter fields (being, role, position, stance, priority)
  // push down to the projection's $match so the listing scales.
  // Each entry is shaped like a normal child so clients render it
  // through the same path as any other space listing.
  const children = space.seedSpace === SEED_SPACE.THREADS
    ? await synthesizeThreadChildren(space._id, pathByNames, payload)
    : await childrenOf(space._id, pathByNames);
  const matters  = await mattersAt(space._id);
  const lineage  = buildLineage(resolved);
  const siblings = space.parent
    ? await childrenOf(space.parent, parentPath, { exclude: space._id })
    : [];

  // Access for the asker. Defensive: leave both false on any error so
  // a broken read never silently grants writes.
  let writeAllowed   = false;
  let authorizedHere = false;
  if (identity?.beingId) {
    try {
      const access  = await resolveSpaceAccess(space._id, identity.beingId);
      writeAllowed   = !!(access?.ok && access?.write === true);
      authorizedHere = !!access?.ok;
    } catch { /* defensive */ }
  }

  // ── Beings list = position truth, not home registration. ─────────
  // qualities.beings (the home-registration namespace) lists beings
  // whose HOME is this space. occupants is beings whose CURRENT
  // position equals this space. When a being walks away, the home
  // registration stays but the position changes — rendering off the
  // home list would leave a ghost mesh at the home space.
  //
  // We use position as the rendering truth. The home-registration
  // entries are still surfaced as `residents` so the descriptor
  // carries "who lives here" separately from "who is here right now"
  // — extension UIs that want to render addressable @qualifiers can
  // use residents; the 3D / flat scene renders beings.
  const registered = beingsAtSpace(space, { writeAllowed, authorizedHere });
  const positionedHere = await occupantsByPosition(space._id, []);
  // Cross-index for the residents enrichment.
  const positionedIds = new Set(
    positionedHere.map((e) => e._beingId).filter(Boolean).map(String),
  );
  // Residents = registered entries that are NOT currently at this space.
  // (Registered entries who ARE here naturally appear in positionedHere
  // because their position field === this space; the dedup keeps a
  // single entry in the beings list below.)
  const residentsRaw = registered.filter(
    (e) => !e._beingId || !positionedIds.has(String(e._beingId)),
  );
  // The combined "beings to render" list: positioned occupants, PLUS
  // registered entries that share the same beingId as a position
  // occupant (this gives us back the rich qualities.beings invocableBy
  // metadata when the being is also here). Position-only entries
  // remain visible.
  const renderEntries = positionedHere.map((occ) => {
    const reg = registered.find((r) => r._beingId && String(r._beingId) === String(occ._beingId));
    return reg ? { ...occ, invocableBy: reg.invocableBy, available: reg.available } : occ;
  });
  const beings    = await enrichBeings(space._id, renderEntries, { identity });
  const residents = await enrichBeings(space._id, residentsRaw,   { identity });

  // Being-tree lineage. When the stance carries a beingId (a stance
  // address like <reality>/<path>@<name>), surface the immediate
  // children of that being — beings whose parentBeingId points at it.
  // The portal renders this as the "lineage" panel: who did you
  // birth, who can you inhabit. One Mongo query, lean, capped.
  const beingLineage = resolved.beingId
    ? await listBeingChildren(resolved.beingId)
    : null;

  return {
    address: {
      place: realityDomain,
      path: pathByNames,
      being: resolved.being || null,
      spaceId: space._id,
      beingId: resolved.beingId || null,
      chain: resolved.chain,
      pathByNames,
      pathByIds,
      leafName: resolved.leafName,
      leafId: resolved.leafId,
    },
    isSpaceRoot: false,
    isHomeRoot: false,
    // The seed-space marker on the wire so the portal can render
    // the room differently per kind . heaven shows as a white-room
    // door-room, threads renders as a stack, etc. Null on user
    // spaces (the common case).
    seedSpace: space.seedSpace || null,
    beings,
    residents,
    children,
    matters,
    lineage,
    beingLineage,
    siblings,
    size: space.size || null,
    qualities: serializeQualities(space.qualities),
    identity: await identityBlock(identity, { authorizedHere, writeAllowed }),
    _meta: meta(writeAllowed ? [] : ["read-only"]),
  };
}

// ── Shared builders ──

// Children of a space, shaped as descriptor entries. Each child's
// own qualities ride along so a client SEE-ing the parent can render
// extension-contributed fields on every child without re-SEE-ing
// each. Slice H completion (2026-05-23): each child folds before its
// qualities surface — the leaf-vs-occupant asymmetry the earlier
// pass left open is gone. Hot path: foldRead = one cache read per
// child when foldedSeq is current (eager-fold-on-write keeps it
// current). Cold path: occupant-by-occupant catch-up. Cost is K
// folds per SEE where K is the visible-children count; the
// in-flight fold-engine append lock + reducer keep each well-
// bounded.
async function childrenOf(parentId, parentPath, opts = {}) {
  const rows = await listSpaceChildren(parentId, opts);
  const folded = await Promise.all(rows.map((s) => foldRead("space", s._id)));
  return rows.map((s, i) => {
    const f = folded[i] || s;
    return {
      name: f.name || s.name,
      spaceId: s._id,
      type: f.type ?? s.type ?? null,
      coord: f.coord ?? s.coord ?? null,
      path: parentPath === "/" ? `/${s.name}` : `${parentPath}/${s.name}`,
      qualities: serializeQualities(f.qualities ?? s.qualities),
    };
  });
}

// Synthetic children for `.threads`. Live rootCorrelation chains
// surface as entries shaped like normal child spaces but with a
// `synthetic: true` flag and a `thread` block carrying the lastAct
// timestamp; full descriptor is one SEE deeper at .threads/<id>.
// Pure projection — no persistence.
//
// `payload` is the SEE request's payload (query params on HTTP, the
// envelope's payload on WS). Recognized filter fields — being, role,
// position, stance, priority, limit — push down to the projection's
// $match, so filtering scales on busy systems.
async function synthesizeThreadChildren(parentId, parentPath, payload) {
  const filters = payload && typeof payload === "object"
    ? {
        limit:    payload.limit    != null ? Number(payload.limit) : undefined,
        being:    payload.being    || null,
        role:     payload.role     || null,
        position: payload.position || null,
        stance:   payload.stance   || null,
        priority: payload.priority || null,
      }
    : {};
  const live = await listLiveThreads(filters);
  return live.map((t) => ({
    name:      t.id,
    spaceId:   `thread:${t.id}`,
    type:      "thread",
    synthetic: true,
    path:      parentPath === "/" ? `/${t.id}` : `${parentPath}/${t.id}`,
    thread:    { id: t.id, lastAct: t.lastAct },
    qualities: {},
  }));
}

// Matter at a space, shaped as descriptor entries. Each matter's
// own qualities ride along so extensions characterizing matter
// (review status, energy attribution, etc.) surface without an
// extra round-trip. Slice H completion (2026-05-23): each matter
// folds before its qualities surface, same shape as the children
// loop above.
async function mattersAt(spaceId) {
  if (!spaceId) return [];
  const rows = await listMattersAt(spaceId);
  const folded = await Promise.all(rows.map((m) => foldRead("matter", m.matterId)));
  return rows.map((m, i) => {
    const f = folded[i] || {};
    const content = f.content ?? m.content;
    const isText = typeof content === "string";
    return {
      matterId: m.matterId,
      name: f.name ?? m.name,
      origin: f.origin ?? m.origin,
      coord: f.coord ?? m.coord ?? null,
      preview: isText ? content.slice(0, 400) : null,
      previewBytes: isText ? Buffer.byteLength(content, "utf8") : 0,
      totalBytes: isText ? Buffer.byteLength(content, "utf8") : 0,
      byBeingId: f.beingId ?? m.beingId,
      qualities: serializeQualities(f.qualities ?? m.qualities ?? {}),
    };
  });
}

// Being-tree children of a being. Used by the descriptor's
// `beingLineage` field on stance addresses (<reality>/<path>@<name>).
// Each entry carries enough for the portal to render an "inhabit"
// affordance: name, beingId, cognition, defaultRole. Cap at 200 to
// stay bounded for prolific parents; deeper inspection happens via
// dedicated SEE on each child stance.
async function listBeingChildren(parentBeingId) {
  if (!parentBeingId) return [];
  const { beingCognition } = await import("../materials/being/identity/lookups.js");
  const rows = await Being
    .find({ parentBeingId: String(parentBeingId) })
    .select("_id name defaultRole homeSpace qualities createdAt")
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();
  return rows.map((b) => ({
    beingId:     String(b._id),
    name:        b.name || null,
    defaultRole: b.defaultRole || null,
    cognition:   beingCognition(b),
    homeSpace:   b.homeSpace ? String(b.homeSpace) : null,
    createdAt:   b.createdAt || null,
  }));
}

// Top-down breadcrumb chain: place root + each named segment up to but
// not including the leaf.
function buildLineage(resolved) {
  const realityDomain = getRealityDomain();
  const lineage = [{ path: "/", name: realityDomain, spaceId: null }];
  let prefix = "";
  for (let i = 0; i < resolved.chain.length - 1; i++) {
    const seg = resolved.chain[i];
    prefix += "/" + seg.name;
    lineage.push({ path: prefix, name: seg.name, spaceId: seg.id });
  }
  return lineage;
}

// Build the `actions[]` block for one being. Reads the role's `canBe`
// license, cross-references the seed's static BE_OPS table, and
// returns `[{verb, action, label, description, args, bootstrap}, ...]`
// . the wire shape the portal's actionRenderer consumes to render a
// generic menu + form for each action.
//
// For cherub specifically, the identity-state filter trims the list:
// authenticated callers don't see birth/use; unauthenticated callers
// don't see release/switch. Portal stays state-blind.
//
// canDo / canSee / canSummon are not surfaced as actions today . they
// describe what an LLM-driven role is licensed to dispatch via the
// four seed verb-tools, which is a separate concern from the
// portal's "click a being and invoke an action" UI. When a real case
// surfaces, the same `actions[]` field generalizes.
function buildActions(beingName, def, identity) {
  if (!def?.canBe || !Array.isArray(def.canBe) || def.canBe.length === 0) {
    return [];
  }
  const isAuthenticated = !!identity?.beingId;
  const out = [];
  for (const entry of def.canBe) {
    const opName = typeof entry === "string"
      ? entry
      : (entry?.action || entry?.name || null);
    if (!opName) continue;
    const op = BE_OPS[opName];
    if (!op) continue;
    // Identity-state filter (cherub): hide birth/connect when already
    // bound; hide release when not bound. Other beings' canBe lists
    // pass through unfiltered.
    if (beingName === "cherub") {
      const isAcquireOp = opName === "birth" || opName === "connect";
      const isHeldOp    = opName === "release";
      if (isAcquireOp && isAuthenticated) continue;
      if (isHeldOp && !isAuthenticated)   continue;
    }
    // Reshape per-being. Cherub's BE_OPS labels are arrival-flow-
    // centric ("Register", "Log in"); for other beings the same op
    // means something else (a parent birthing a child, a session-
    // already-authenticated user releasing). Adjust label + args so
    // the portal renders meaningful copy.
    let label       = op.label || opName;
    let description = op.description || "";
    let args        = op.args || {};
    if (beingName !== "cherub" && opName === "birth") {
      label = "Mint child";
      description = "Birth a new being from yourself. The child's parent is you.";
      // Populate the role dropdown from the live registry so the
      // operator sees every role currently available (seed, extension,
      // and operator-authored "live" entries). Non-human cognition
      // requires a role — surfacing the list inline removes the
      // typo-prone free-text input.
      const roleNames = listRoles().slice().sort();
      args = {
        name:      { type: "text", label: "Child name", required: true },
        cognition: {
          type:    "select",
          label:   "Cognition",
          enum:    ["llm", "scripted", "human"],
          required: false,
          default: "llm",
        },
        role: {
          type:    "select",
          label:   "Default role (fallback when no roleFlow clause matches)",
          enum:    roleNames,
          required: true,
          default: roleNames.includes("human") ? "human" : (roleNames[0] || ""),
        },
        // Optional birth-time roleFlow. Operators paste a JSON array
        // of clauses; be.js parses and the spec lands at
        // qualities.roleFlow on the new being. Empty = use defaultRole
        // unconditionally (no flow program).
        roleFlow: {
          type:        "multiline",
          label:       "Initial role flow (JSON array of clauses, optional)",
          required:    false,
          description: "[{ \"when\": {...}, \"role\": \"foo\" }, { \"stack\": true, \"when\": {...}, \"role\": \"bar\" }]",
        },
      };
    }
    out.push({
      verb:        "be",
      action:      opName,
      label,
      description,
      args,
      bootstrap:   op.bootstrap === true,
    });
  }
  return out;
}

// Attach the registered role's wire fields, the per-being inbox, the
// active Act's activity, and the being's own qualities to each
// entry produced by beingsAtSpace.
async function enrichBeings(spaceId, entries, opts = {}) {
  const identity = opts.identity || null;
  const inboxByBeing = await getInboxSummary(spaceId);

  // Slice H: fold each being before reading qualities. Per FOLD.md
  // foldPlace mounts the face for the moment; here the descriptor is
  // doing the same weave at SEE time. Hot path is one cache read per
  // being (foldedSeq current → zero replay).
  const beingIds = entries.map((e) => e._beingId).filter(Boolean);
  const foldedBeings = await Promise.all(beingIds.map((id) => foldRead("being", id)));
  const qualitiesByBeing = new Map(
    foldedBeings
      .filter(Boolean)
      .map((b) => [String(b._id), serializeQualities(b.qualities)]),
  );
  const coordByBeing = new Map(
    foldedBeings
      .filter(Boolean)
      .map((b) => [String(b._id), b.coord || null]),
  );

  const activities = await Promise.all(entries.map(async (e) => {
    if (!e._beingId) return null;
    const open = await findOpenForBeing(e._beingId);
    if (open) return summonToActivity(open);
    // No Act in flight. Fall back to what this being last SAID so
    // the speech bubble persists between moments. Without this the
    // bubble vanishes the instant a moment seals.
    const sealed = await findLastSealedForBeing(e._beingId);
    return summonToActivity(sealed, { sealed: true });
  }));

  return entries.map((entry, i) => {
    const def = getRole(entry.being);
    const inboxKey = entry._beingId ? String(entry._beingId) : null;
    const inb = (inboxKey && inboxByBeing[inboxKey]) || {
      total: 0, unconsumed: 0, recent: [],
      activeFrom: null, pendingFrom: [], queueDepth: 0,
    };
    const { _beingId, ...wireEntry } = entry;
    return {
      ...wireEntry,
      // Surface the being's id on the wire. Clients (explorers, link
      // builders) need it to address `.reel/being/<id>` / `.acts/<id>`.
      beingId:     inboxKey,
      permissions: def ? def.permissions : null,
      respondMode: def ? def.respondMode : null,
      triggerOn:   def ? def.triggerOn   : null,
      // Per-being action surface. The portal renders this generically
      // as a menu + arg-schema form; one entry per BE op the role is
      // licensed for, filtered by identity state (cherub-only today).
      actions:     buildActions(entry.being, def, identity),
      // Delegate-as-catalog: a delegate publishes the registry-shaped
      // data it mediates as part of its own descriptor entry. Askers
      // who can SEE the delegate (which is liberal — beings list at the
      // place root) get the catalog through this surface without ever
      // reading the heaven-gated mirror spaces directly. role-manager
      // publishes roles/tools/operations/be-ops; future delegates that
      // gate other registries follow the same shape.
      catalogs:    buildCatalogs(entry.being),
      inbox: inb,
      activity: activities[i],
      busy:        inb.activeFrom !== null,
      talkingTo:   inb.activeFrom,
      queueDepth:  inb.queueDepth,
      pendingFrom: inb.pendingFrom,
      coord:       (inboxKey && coordByBeing.get(inboxKey)) || null,
      qualities:   (inboxKey && qualitiesByBeing.get(inboxKey)) || {},
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Catalog builders. The descriptor is rendered server-side where the
// in-memory registries are directly readable; folding their contents
// into the publishing delegate's entry hands askers the data they need
// to operate the delegate, without giving them a heaven SEE.
//
// Each catalog is a lightweight projection: names + the surface info
// a UI needs to render pickers / forms. Internal-implementation detail
// (handler refs, prompt closures) is stripped. Stable wire shape — if
// a delegate's catalog grows, the asker's renderer ignores fields it
// doesn't know.
// ─────────────────────────────────────────────────────────────────────

function buildCatalogs(beingName) {
  if (beingName === "role-manager") return buildRoleManagerCatalogs();
  return null;
}

function buildRoleManagerCatalogs() {
  return {
    roles:      catalogRoles(),
    addresses:  catalogAddresses(),
    operations: catalogOperations(),
    beOps:      catalogBeOps(),
  };
}

function catalogRoles() {
  return listRoles().slice().sort().map((name) => {
    const r = getRole(name);
    return {
      name,
      origin:            r?.origin || null,
      requiredCognition: r?.requiredCognition || null,
      permissions:       Array.isArray(r?.permissions) ? r.permissions : [],
    };
  });
}

// canSee on a role names IBP addresses (paths the LLM may read via the
// generic `see` tool), NOT tool names. The runtime tool registry only
// holds the four seed verb-tools (see/do/summon/be) — those are the
// LLM's tool palette, not what canSee admits. We surface a curated
// catalog of commonly-useful addresses: the Tier-3 seed-space paths
// and the home-shorthand. Operators add anything else free-form in
// the picker.
const SUGGESTED_ADDRESSES = [
  "~",
  "./identity",
  "./config",
  "./peers",
  "./extensions",
  "./tools",
  "./roles",
  "./operations",
  "./source",
  "./threads",
];
function catalogAddresses() {
  return SUGGESTED_ADDRESSES.map((path) => ({ name: path }));
}

function catalogOperations() {
  return listOperations()
    .map((op) => ({
      name:           op.name,
      targets:        op.targets,
      factAction:     op.factAction,
      ownerExtension: op.ownerExtension,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function catalogBeOps() {
  return listBeOpNames().sort().map((name) => {
    const op = getBeOp(name);
    return {
      name,
      label:       op?.label || null,
      description: op?.description || null,
    };
  });
}

// ── Wire-shape helpers ──

async function identityBlock(identity, { authorizedHere, writeAllowed }) {
  if (!identity) return null;
  // Position + coord are server-side state on the Being row. Surface
  // them on every authenticated SEE so the portal can resume the
  // camera at the being's last spot (instead of teleporting to /
  // on every login / reconnect). `coord` may be null on never-moved
  // beings — the client falls back to a default spawn.
  let position = null;
  let coord    = null;
  if (identity.beingId) {
    try {
      const row = await Being.findById(identity.beingId)
        .select("position qualities")
        .lean();
      position = row?.position ? String(row.position) : null;
      const quals = row?.qualities;
      const coordQ = quals instanceof Map ? quals.get("coord") : quals?.coord;
      coord = coordQ || row?.coord || null;
    } catch { /* defensive */ }
  }
  return {
    beingId: identity.beingId,
    name:    identity.name,
    position,
    coord,
    authorizedHere,
    writeAllowed,
  };
}

function meta(renderHints = []) {
  return {
    descriptorVersion: DESCRIPTOR_VERSION,
    serverVersion:     process.env.REALITY_VERSION || "treeos-reality",
    generatedAt:       new Date().toISOString(),
    renderHints,
  };
}

// Serialize a Mongoose qualities Map (or already-plain object) into
// the wire shape. Returns {} when absent so the field is always
// present on the descriptor, which keeps client code consistent —
// `descriptor.qualities.<extName>` is safe to read either way.
function serializeQualities(quals) {
  if (!quals) return {};
  if (quals instanceof Map) return Object.fromEntries(quals);
  return { ...quals };
}
