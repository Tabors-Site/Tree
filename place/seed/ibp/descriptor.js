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
// stance flags (isPlaceRoot, isHomeRoot, otherwise a regular space)
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
// renders. The kernel hosts; it does not compose.
//
// I also produce the place's discovery payload (buildDiscovery) — the
// bootstrap-time wire shape that names protocol version, descriptor
// version, registered roles, and plantable seeds. It lives here
// because both descriptor and discovery are wire payloads my SEE
// verb returns, and they share types and version constants.

import { getPlaceDomain } from "./address.js";
import { getPlaceConfigValue, getPlaceUrl } from "../placeConfig.js";
import Space from "../models/space.js";
import Being from "../models/being.js";
import Did from "../models/did.js";
import { getPlaceRootId } from "../placeRoot.js";
import { listSeeds } from "../place/seeds.js";
import { listMattersAt } from "../place/matter/matters.js";
import { SEED_SPACE } from "../place/space/seedSpaces.js";
import { listLiveThreads } from "../place/space/threads.js";
import {
  resolveSpaceAccess,
  listSpaceChildren,
  listBeingSpaces,
} from "../place/space/spaceFetch.js";
import { getInboxSummary } from "../factory/inbox.js";
import { getRole, listRoles } from "../factory/roles/registry.js";
import { getActiveSummonForBeing } from "../factory/stamped.js";

// Wire-shape versions. Bump when the descriptor / discovery shape
// changes in a way clients must opt into.
export const DESCRIPTOR_VERSION   = "1.0";
export const IBP_PROTOCOL_VERSION = "1.0";
// ── Place discovery payload ──
// Returned by `ibp:see <place>/.discovery` once a socket is open. The
// pre-identity surface every client reads to learn what I speak:
// protocol version, descriptor versions supported, WS URL, role
// names registered, verb set, plantable seeds.

// My BE-only beings — addressable through BE but not in the SUMMON
// role registry, so they need an explicit listing for the discovery
// payload.
const SYSTEM_BE_BEINGS = ["cherub", "llm-assigner"];

export function buildDiscovery() {
  const placeUrl = getPlaceUrl();
  const wsUrl = placeUrl.replace(/^http/, "ws");

  // Merge two sources: the live role registry (SUMMON-honoring roles
  // registered by the kernel + extensions) and the canonical system
  // beings (BE-only). Dedupe + sort.
  const roles = Array.from(
    new Set([...listRoles(), ...SYSTEM_BE_BEINGS]),
  ).sort();

  return {
    name: getPlaceConfigValue("PLACE_NAME") || "Unnamed Place",
    place: getPlaceDomain(),
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
  if (!beingHomes) return beings;
  // Stance-permission profiles share the qualities.beings namespace;
  // skip them so only entries naming a being surface here.
  const STANCE_NAMES = new Set(["arrival", "owner", "member"]);
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
      // it to attach the being's currently-active Summon.
      _beingId: home?.beingId || null,
    });
  }

  return beings;
}

// ── Activity derivation ──
// For each being at a position, build an `activity` object from
// their currently-active Summon. The latest Did keyed by summonId
// names what the being is doing right now; when no Summon is active
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

// Convert a Summon into an activity object the descriptor surfaces
// for the being whose Summon it is. Null when no Summon is given.
async function summonToActivity(summon) {
  if (!summon) return null;
  let lastDid = null;
  try {
    lastDid = await Did.findOne({ summonId: summon._id })
      .sort({ date: -1 })
      .select("action params date")
      .lean();
  } catch {
    // The descriptor never blocks on a Did lookup.
  }
  const target = await inferActivityTarget(summon);

  if (lastDid) {
    return {
      kind: "acting",
      content: truncate(
        `${lastDid.action}(${summarizeArgs(lastDid.params)})`,
        ACTIVITY_CONTENT_CAP,
      ),
      chainstepId: String(summon._id),
      target,
      ts: lastDid.date,
    };
  }

  return {
    kind: "summoned",
    content: truncate(summon.startMessage?.content || "", ACTIVITY_CONTENT_CAP),
    chainstepId: String(summon._id),
    target,
    ts: summon.summonedAt || new Date(),
  };
}

// Infer what a Summon is acting on. The Summon schema doesn't carry an
// explicit target field, but the reply linkage tells us: when inReplyTo
// is set, the Summon was spawned by another being. Treat the parent's
// activeRole/position as the target so sub-beings animate walking toward
// their spawner.
async function inferActivityTarget(summon) {
  if (!summon?.inReplyTo) return null;
  let parent;
  try {
    const Summon = (await import("../models/summon.js")).default;
    parent = await Summon.findById(summon.inReplyTo)
      .select("activeRole beingOut")
      .lean();
  } catch {
    return null;
  }
  if (!parent || !parent.activeRole || !parent.beingOut) return null;
  // Without aiContext/treeContext we no longer have a (spaceId, modeKey)
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
  if (resolved.isPlaceRoot) return placeAtPlaceRoot(resolved, opts);
  if (resolved.isHomeRoot) return placeAtBeingHome(resolved, opts);
  return placeAtSpace(resolved, opts);
}

async function placeAtPlaceRoot(resolved, { identity } = {}) {
  const placeDomain = getPlaceDomain();
  const placeRootId = getPlaceRootId();
  const isRegistered = (beingName) => !!getRole(beingName);

  const placeRoot = placeRootId
    ? await Space.findById(placeRootId).select("qualities").lean()
    : null;
  const children = placeRootId ? await childrenOf(placeRootId, "/") : [];
  const matters = placeRootId ? await listMattersAt(placeRootId) : [];

  // My place-root beings — ensurePlaceBeings plants them; this list
  // makes them addressable from the place descriptor without walking
  // qualities.beings. `available` reflects whether the role's
  // backing extension is currently registered.
  const placeRootBeings = [
    { being: "cherub",         invocableBy: "anyone",        available: isRegistered("cherub") },
    { being: "llm-assigner", invocableBy: "authenticated", available: isRegistered("llm-assigner") },
    { being: "place-manager", invocableBy: "owner",         available: isRegistered("place-manager") },
  ];

  return {
    address: {
      place: placeDomain,
      path: "/",
      being: resolved.being || null,
      spaceId: placeRootId || null,
      beingId: null,
      chain: [],
      pathByNames: "/",
      pathByIds: "/",
      leafName: null,
      leafId: null,
    },
    isPlaceRoot: true,
    isHomeRoot: false,
    beings: placeRootBeings,
    children,
    matters,
    qualities: serializeQualities(placeRoot?.qualities),
    place: {
      name: getPlaceConfigValue("PLACE_NAME") || "Unnamed Place",
    },
    identity: identityBlock(identity, { authorizedHere: true, writeAllowed: false }),
    _meta: meta(),
  };
}

async function placeAtBeingHome(resolved, { identity } = {}) {
  const placeDomain = getPlaceDomain();
  const homePath = `/~${resolved.name}`;
  const beingSpaces = await listBeingSpaces(resolved.beingId);
  // Each space the being owns becomes a child entry at place scope
  // (`/<name>`). The home view is a listing surface; entering a
  // space takes you to that space's own address.
  const children = beingSpaces.map((s) => ({
    name: s.name,
    spaceId: s._id,
    type: s.type || null,
    path: `/${s.name}`,
  }));
  const isOwner = !!(identity && String(identity.beingId) === String(resolved.beingId));
  return {
    address: {
      place: placeDomain,
      path: homePath,
      being: resolved.being || null,
      spaceId: null,
      beingId: resolved.beingId,
      chain: resolved.chain,
      pathByNames: homePath,
      pathByIds: `/~${resolved.beingId}`,
      leafName: resolved.leafName,
      leafId: resolved.leafId,
    },
    isPlaceRoot: false,
    isHomeRoot: true,
    // The owning being is the only resident here by default.
    // Extensions can place others by writing qualities.beings on the
    // being's home Space; placeAtSpace surfaces them via beingsAtSpace.
    beings: [{ being: resolved.name, invocableBy: "owner", available: isOwner }],
    children,
    matters: [],
    // Home view is being-anchored, not space-anchored, so no
    // qualities surface here. To see a being's home space's
    // qualities, SEE that space directly.
    qualities: {},
    identity: identityBlock(identity, { authorizedHere: isOwner, writeAllowed: isOwner }),
    _meta: meta(isOwner ? [] : ["read-only"]),
  };
}

async function placeAtSpace(resolved, { identity, payload } = {}) {
  const placeDomain = getPlaceDomain();
  const space = resolved.leafSpace;
  if (!space) throw new Error("Resolved space missing leafSpace reference");

  const pathByNames = "/" + resolved.chain.map((c) => c.name).join("/");
  const pathByIds   = "/" + resolved.chain.map((c) => c.id).join("/");
  const parentPath  = pathByNames.replace(/\/[^/]+$/, "") || "/";

  // .threads has no persisted children; the live forest is projected
  // on demand from Summon records keyed by rootCorrelation. The SEE
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

  const beings = await enrichBeings(
    space._id,
    beingsAtSpace(space, { writeAllowed, authorizedHere }),
  );

  return {
    address: {
      place: placeDomain,
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
    isPlaceRoot: false,
    isHomeRoot: false,
    beings,
    children,
    matters,
    lineage,
    siblings,
    qualities: serializeQualities(space.qualities),
    identity: identityBlock(identity, { authorizedHere, writeAllowed }),
    _meta: meta(writeAllowed ? [] : ["read-only"]),
  };
}

// ── Shared builders ──

// Children of a space, shaped as descriptor entries. Each child's
// own qualities ride along so a client SEE-ing the parent can render
// extension-contributed fields on every child without re-SEE-ing each.
async function childrenOf(parentId, parentPath, opts = {}) {
  const rows = await listSpaceChildren(parentId, opts);
  return rows.map((s) => ({
    name: s.name,
    spaceId: s._id,
    type: s.type || null,
    path: parentPath === "/" ? `/${s.name}` : `${parentPath}/${s.name}`,
    qualities: serializeQualities(s.qualities),
  }));
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
// extra round-trip.
async function mattersAt(spaceId) {
  if (!spaceId) return [];
  const rows = await listMattersAt(spaceId);
  return rows.map((m) => {
    const isText = typeof m.content === "string";
    return {
      matterId: m.matterId,
      name: m.name,
      origin: m.origin,
      preview: isText ? m.content.slice(0, 400) : null,
      previewBytes: isText ? Buffer.byteLength(m.content, "utf8") : 0,
      totalBytes: isText ? Buffer.byteLength(m.content, "utf8") : 0,
      byBeingId: m.beingId,
      qualities: m.qualities || {},
    };
  });
}

// Top-down breadcrumb chain: place root + each named segment up to but
// not including the leaf.
function buildLineage(resolved) {
  const placeDomain = getPlaceDomain();
  const lineage = [{ path: "/", name: placeDomain, spaceId: null }];
  let prefix = "";
  for (let i = 0; i < resolved.chain.length - 1; i++) {
    const seg = resolved.chain[i];
    prefix += "/" + seg.name;
    lineage.push({ path: prefix, name: seg.name, spaceId: seg.id });
  }
  return lineage;
}

// Attach the registered role's wire fields, the per-being inbox, the
// active Summon's activity, and the being's own qualities to each
// entry produced by beingsAtSpace.
async function enrichBeings(spaceId, entries) {
  const inboxByBeing = await getInboxSummary(spaceId);

  const beingIds = entries.map((e) => e._beingId).filter(Boolean);
  const beingRows = beingIds.length
    ? await Being.find({ _id: { $in: beingIds } }).select("_id qualities").lean()
    : [];
  const qualitiesByBeing = new Map(
    beingRows.map((b) => [String(b._id), serializeQualities(b.qualities)]),
  );

  const activities = await Promise.all(entries.map(async (e) => {
    if (!e._beingId) return null;
    const summon = await getActiveSummonForBeing(e._beingId);
    return summonToActivity(summon);
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
      permissions: def ? def.permissions : null,
      respondMode: def ? def.respondMode : null,
      triggerOn:   def ? def.triggerOn   : null,
      inbox: inb,
      activity: activities[i],
      busy:        inb.activeFrom !== null,
      talkingTo:   inb.activeFrom,
      queueDepth:  inb.queueDepth,
      pendingFrom: inb.pendingFrom,
      qualities:   (inboxKey && qualitiesByBeing.get(inboxKey)) || {},
    };
  });
}

// ── Wire-shape helpers ──

function identityBlock(identity, { authorizedHere, writeAllowed }) {
  if (!identity) return null;
  return {
    beingId: identity.beingId,
    name:    identity.name,
    authorizedHere,
    writeAllowed,
  };
}

function meta(renderHints = []) {
  return {
    descriptorVersion: DESCRIPTOR_VERSION,
    serverVersion:     process.env.PLACE_VERSION || "treeos-place",
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
