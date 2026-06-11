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
// version, registered roles, and graftable clones. It lives here
// because both descriptor and discovery are wire payloads my SEE
// verb returns, and they share types and version constants.

import log from "../seedReality/log.js";
import { getRealityDomain } from "./address.js";
import { getRealityConfigValue, getRealityUrl } from "../realityConfig.js";
import Being from "../materials/being/being.js";
import Fact from "../past/fact/fact.js";
import { getSpaceRootId } from "../sprout.js";
import { listMattersAt } from "../materials/matter/matters.js";
import { HEAVEN_SPACE } from "../materials/space/heavenSpaces.js";
import { listLiveThreads } from "../materials/space/threads.js";
import {
  resolveSpaceAccess,
  listSpaceChildren,
} from "../materials/space/spaces.js";
import { getInboxSummary } from "../present/intake/inbox.js";
import { getRole, listRoles } from "../present/roles/registry.js";
import { listClones } from "../materials/publish/cloneRegistry.js";
import { serializeTypeCatalog } from "../materials/matter/classify.js";
import { listOperations } from "./operations.js";
import { listBeOpNames, getBeOp } from "./beOps.js";
import { findOpenForBeing, findLastSealedForBeing } from "../present/beats/2-fold/reelChains.js";
import { fold } from "../present/beats/2-fold/foldEngine.js";
import { foldAt, NoSuchHistoricalState } from "../present/beats/2-fold/foldAt.js";
import { loadProjection } from "../materials/projections.js";
import { redactSecrets } from "../materials/redact.js";
import { BE_OPS } from "./beOps.js";

// Fold an aggregate before reading its qualities. Per FOLD.md: the
// projection IS the cache, and fold() catches it up to the reel head
// before returning. Hot path is zero replay (one cache read when
// foldedSeq is current). Slice H seam — the moment descriptor reads
// flow through fold, any direct-write bypass becomes a visible
// inconsistency (the next fold round overwrites it from the fact
// chain). Per MOMENT.md: facts are truth; the row is the fold-so-far.
//
// `until` (optional) flips this from a live read to a historical
// fold. Per the per-reel doctrine (seed/FACTORY.md§"seq is the truth"):
// each reel resolves the `until` (typically `{atTimestamp}` for
// multi-reel rewinds) to its OWN per-reel seq, then cold-walks to
// that point. No projection cache write; no cross-cutting handlers
// fire. Targets that didn't exist yet at the given point return null
// — same shape as a missing-current target so descriptor callers
// degrade gracefully ("this being wasn't here yet at 3pm yesterday"
// behaves identically to "this being has no projection row").
//
// Returns null when the aggregate doesn't exist (live) or hadn't
// existed yet (historical); descriptor callers guard with
// `?.qualities` so missing data degrades to {} cleanly.
async function foldRead(type, id, until = null, branch = "0") {
  if (!id) return null;
  try {
    if (until) {
      const { state } = await foldAt(type, String(id), until, { branch });
      return state;
    }
    const { state } = await fold(type, String(id), { branch });
    return state;
  } catch (err) {
    if (err instanceof NoSuchHistoricalState) return null;
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
// names registered, verb set, graftable clones.

// My BE-only beings — addressable through BE but not in the SUMMON
// role registry, so they need an explicit listing for the discovery
// payload.
const SYSTEM_BE_BEINGS = ["cherub", "llm-assigner"];

export async function buildDiscovery() {
  const realityUrl = getRealityUrl();
  const wsUrl = realityUrl.replace(/^http/, "ws");

  // The chain fingerprint: one hash summarizing the whole substrate's
  // chain state (TTL-memoized in chainRoots.js — discovery is fetched
  // on every portal connect). Two realities compare state in a single
  // round-trip; on mismatch, walk chain-root → reel heads → facts to
  // the exact divergence.
  let chainRealityRoot = null;
  try {
    const { realityRoot } = await import("../past/fact/chainRoots.js");
    chainRealityRoot = await realityRoot();
  } catch { /* additive — discovery never blocks on the fingerprint */ }

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
    // Graftable clone bundles registered by extensions. Surfaced in the
    // discovery payload (unauthenticated) so the portal's hotbar can
    // populate before the operator signs in. The list-clones DO op
    // returns the same data for callers who want a live refresh.
    clones: listClones(),
    // The matter-type catalog (registry defs + their claims).
    // Composers classify LOCALLY against this ("will become: web")
    // with zero round-trips; the classify-matter SEE op gives the
    // same answer authoritatively for non-discovery callers.
    matterTypes: serializeTypeCatalog(),
    // Upload policy caps so composers refuse oversized / disallowed
    // files before POSTing bytes. The HTTP carrier re-enforces.
    upload: {
      enabled: getRealityConfigValue("uploadEnabled") !== false,
      maxUploadBytes: Number(getRealityConfigValue("maxUploadBytes")) || 104857600,
      allowedMimeTypes: getRealityConfigValue("allowedMimeTypes") || null,
    },
    // The chain fingerprint (see above).
    chain: { realityRoot: chainRealityRoot },
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
// Historical caveat: this lists beings whose CURRENT position is the
// space. For a past view the honest answer is "who was at this space
// at time T," which requires walking each being's position-history
// (set-being:position facts on their reel). For Slice B v1 we accept
// this limitation: the current-occupant list rides through unchanged
// and enrichBeings folds each one's row to the past. A being who has
// since walked away won't appear; a being who walked IN after the
// past point will appear (with their pre-arrival state). Documented
// here so the next slice knows what to fix.
async function occupantsByPosition(spaceId, existing, branch = "0") {
  if (!spaceId) return [];
  const seen = new Set();
  for (const e of existing) {
    if (e._beingId) seen.add(String(e._beingId));
  }
  // Branch-aware position lookup. findByPosition handles shadow +
  // tombstone semantics for non-main; main short-circuits to its
  // own path. We only get back {type, id, position, foldedSeq};
  // resolve names via a batched projection load.
  const { findByPosition, loadProjections } = await import(
    "../materials/projections.js"
  );
  const refs = (await findByPosition(spaceId, branch))
    .filter((r) => r.type === "being");
  const ids = refs.map((r) => r.id);
  const slots = await loadProjections("being", ids, branch);
  const out = [];
  for (const ref of refs) {
    const id = String(ref.id);
    if (seen.has(id)) continue;
    const slot = slots.get(id);
    out.push({
      being: slot?.state?.name || id,
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
  const { getDefaultBranch } = await import("../materials/branch/branchRegistry.js");
  const branch = opts.branch || await getDefaultBranch();
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
        ? await _lookupBeingName(recipientBeingId, branch)
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
async function _lookupBeingName(beingId, branch = "0") {
  try {
    // loadOrFold (not loadProjection): the recipient being may live
    // inherited from a parent branch. Without the lineage walk the
    // bubble would show "→@<id-prefix>" instead of "→@<name>" for any
    // inherited being addressed from a branch . degraded UX, not a
    // hard break, but the fix is one swap.
    const { loadOrFold } = await import("../materials/projections.js");
    const slot = await loadOrFold("being", String(beingId), branch);
    return slot?.state?.name || null;
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
 * `opts.until` (optional) routes the WHOLE descriptor through
 * foldAt instead of live fold. Every internal reel (the space row,
 * each being row, each matter row, the asker's row) folds to its
 * own per-reel seq derived from the `until` anchor. The shape of
 * the returned descriptor stays the same — `beings[]`, `matters[]`,
 * `children[]` all populate — but every projection is historical.
 * Adds `isHistorical: true` + `asOf` to the descriptor's top level.
 *
 * Doctrine: there is no globally-consistent "world snapshot at time
 * T" — each reel has its own monotonic seq, and `until` is resolved
 * per-reel ("this reel's latest fact whose date <= T"). For coherent
 * multi-reel rewinds the caller passes `{atTimestamp}`; for a
 * pinpoint single-reel fold the caller passes `{atSeq}` and accepts
 * that other reels resolve their own seq independently.
 *
 * @param {object} resolved — output of resolver.resolveStance()
 * @param {object} [opts]
 * @param {object} [opts.identity] — { beingId, name } of the asker
 * @param {object} [opts.until]    — historical anchor: { atSeq?, atTimestamp? }
 * @returns {object} Place descriptor
 */
export async function buildPlaceDescriptor(resolved, opts = {}) {
  // Branch flows from the resolved stance (Pass 4 substrate). Threaded
  // through every descriptor helper alongside `until` so each fold lands
  // on the right branch's projection slot. resolveBranchPointers
  // upstream canonicalizes resolved.branch for both #explicit and
  // #main-implicit addresses. The defensive fallback resolves the
  // operator's `#main` pointer through the registry — never literal "0".
  const { getDefaultBranch } = await import("../materials/branch/branchRegistry.js");
  const branchedOpts = {
    ...opts,
    branch: resolved.branch || opts.branch || await getDefaultBranch(),
  };
  if (resolved.isSpaceRoot) return placeAtSpaceRoot(resolved, branchedOpts);
  return placeAtSpace(resolved, branchedOpts);
}

async function placeAtSpaceRoot(resolved, { identity, until = null, branch = "0" } = {}) {
  const realityDomain = getRealityDomain();
  const spaceRootId = getSpaceRootId();
  const isRegistered = (beingName) => !!getRole(beingName);

  const spaceRoot = await foldRead("space", spaceRootId, until, branch);
  let children = spaceRootId ? await childrenOf(spaceRootId, "/", { until, branch }) : [];

  // The childrenOf walk filters out heaven spaces (so .config/.tools
  // etc. don't pollute the place-root listing). Heaven IS a seed
  // space but is meant to be visible at the place root as the door
  // into the I-Am's room . inject it explicitly. Reigning gating
  // happens at SEE-time when a being tries to walk through; here we
  // just surface the door.
  if (spaceRootId) {
    const { findByHeavenSpace } = await import("../materials/projections.js");
    const _hSlot = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, branch);
    const heaven = _hSlot ? { _id: _hSlot.id, ...(_hSlot.state || {}) } : null;
    if (heaven) {
      const folded = (await foldRead("space", heaven._id, until, branch)) || heaven;
      children = [
        {
          name: folded.name || heaven.name,
          spaceId: heaven._id,
          type: folded.type ?? heaven.type ?? null,
          coord: folded.coord ?? heaven.coord ?? null,
          heavenSpace: HEAVEN_SPACE.HEAVEN,
          path: `/${heaven.name}`,
          qualities: serializeQualities(folded.qualities || heaven.qualities),
        },
        ...children,
      ];
    }
  }

  const matters = spaceRootId ? await listMattersAt(spaceRootId, { until, branch }) : [];

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
  const { findByName } = await import("../materials/projections.js");
  // Delegates homed in their own heaven rooms (the host tier) do NOT
  // surface at the reality root — their position is truthful and the
  // occupants query finds them in their rooms. Only root-homed
  // delegates ride the hardcoded roster.
  const rootDelegates = SEED_DELEGATES.filter((d) => !d.homeHeavenSpace);
  const delegateSlots = (await Promise.all(
    rootDelegates.map((d) => findByName("being", d.name, branch)),
  )).filter(Boolean);
  const delegateIdByName = new Map(
    delegateSlots.map((s) => [s.state?.name, String(s.id)]),
  );
  const seedDelegateEntries = rootDelegates.map((d) => ({
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
    ? await occupantsByPosition(spaceRootId, seedDelegateEntries, branch)
    : [];
  const spaceRootBeings = await enrichBeings(
    spaceRootId,
    [...seedDelegateEntries, ...transientRoot],
    { identity, until, branch },
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
      // Branch this descriptor was folded for. The portal's branch
      // chip reads this to decide whether to surface the `#<branch>`
      // qualifier in the address bar. `branch` was already resolved
      // upstream through the `#main` pointer registry; the fallback
      // reads `resolved.branch` (post-resolveBranchPointers).
      branch: resolved.branch || branch,
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
    identity: await identityBlock(identity, { authorizedHere: true, writeAllowed: false, until, branch }),
    ...(until ? { isHistorical: true, asOf: serializeAsOf(until) } : {}),
    _meta: meta(),
  };
}

async function placeAtSpace(resolved, { identity, payload, until = null, branch = "0" } = {}) {
  const realityDomain = getRealityDomain();
  if (!resolved.leafSpace) throw new Error("Resolved space missing leafSpace reference");

  // Fold the leaf before reading its qualities (Slice H seam).
  // Resolver's leafSpace is a snapshot; fold catches the projection up
  // to its reel head so any bypass write (legacy qualities.js direct
  // path) gets overwritten on the next round, and the descriptor's
  // exposed qualities are the fact-chain's truth.
  //
  // CRITICAL: foldRead returns the slot's `state` object — name, parent,
  // qualities, etc. — but NOT `_id` (which rides at the slot level, not
  // inside state). Without re-attaching `resolved.leafSpace._id` here,
  // every downstream `space._id` read returns undefined: the descriptor
  // surfaces `address.spaceId = undefined`, the portal's
  // set-being:position fires with the wrong value (often coerced to a
  // sibling space's id), occupant queries miss, and the user keeps
  // showing up at the wrong room every navigate.
  const folded = await foldRead("space", resolved.leafSpace._id, until, branch);
  const space = folded
    ? { _id: resolved.leafSpace._id, ...folded }
    : resolved.leafSpace;

  const pathByNames = "/" + resolved.chain.map((c) => c.name).join("/");
  const pathByIds   = "/" + resolved.chain.map((c) => c.id).join("/");
  const parentPath  = pathByNames.replace(/\/[^/]+$/, "") || "/";

  // .threads has no persisted children; the live forest is projected
  // on demand from Act records keyed by rootCorrelation. The SEE
  // payload's filter fields (being, role, position, stance, priority)
  // push down to the projection's $match so the listing scales.
  // Each entry is shaped like a normal child so clients render it
  // through the same path as any other space listing.
  //
  // Historical caveat: .threads is a live projection (no chain of its
  // own); a past view of /./threads still surfaces the CURRENT live
  // forest. The doctrine: threads-at-time would require historical
  // inbox + Act reconstruction, which is its own future slice.
  const children = space.heavenSpace === HEAVEN_SPACE.THREADS
    ? await synthesizeThreadChildren(space._id, pathByNames, payload)
    : space.heavenSpace === HEAVEN_SPACE.FACTORY_PRESENT
      ? await synthesizeStamperChildren(pathByNames, payload)
      : space.heavenSpace === HEAVEN_SPACE.FACTORY_PAST
        ? await synthesizeReelChildren(payload)
        : await childrenOf(space._id, pathByNames, {
            until, branch,
            // Heaven-region parents (host, factory) list their own
            // heaven-marked children; ordinary listings keep
            // filtering them out.
            includeHeavenChildren: !!space.heavenSpace,
          });
  const matters  = await mattersAt(space._id, {
    until, branch,
    // The containing space's render block — carries per-type model
    // defaults (qualities.render.matterModels.<type>) that matter
    // entries fall back to when they carry no override of their own.
    spaceRender: serializeQualities(space.qualities)?.render || null,
  });
  const lineage  = buildLineage(resolved);
  const siblings = space.parent
    ? await childrenOf(space.parent, parentPath, { exclude: space._id, until, branch })
    : [];

  // Access for the asker. Used for descriptor enrichment only —
  // role-walk gating runs in authorize() upstream and downstream,
  // not here. `writeAllowed` is the conservative "this caller clearly
  // owns this place" signal (post-RolesAreAuth there's no single
  // boolean for "can write anything"; specific writes pass through
  // authorize per-action). UIs that want a per-action signal should
  // ask "can I do X here?" rather than read this flag.
  // Defensive: leave both false on any error so a broken read never
  // silently grants writes.
  let writeAllowed   = false;
  let authorizedHere = false;
  if (identity?.beingId) {
    try {
      const access  = await resolveSpaceAccess(space._id, identity.beingId, branch);
      writeAllowed   = !!(access?.ok && access?.isOwner === true);
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
  const positionedHere = await occupantsByPosition(space._id, [], branch);
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
  const beings    = await enrichBeings(space._id, renderEntries, { identity, until, branch });
  const residents = await enrichBeings(space._id, residentsRaw,   { identity, until, branch });

  // Being-tree lineage. When the stance carries a beingId (a stance
  // address like <reality>/<path>@<name>), surface the immediate
  // children of that being — beings whose parentBeingId points at it.
  // The portal renders this as the "lineage" panel: who did you
  // birth, who can you inhabit. One Mongo query, lean, capped.
  const beingLineage = resolved.beingId
    ? await listBeingChildren(resolved.beingId, { until, branch })
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
      // Branch this descriptor was folded for. `branch` was resolved
      // upstream through the `#main` pointer registry; resolved.branch
      // is the post-canonicalization value from resolveBranchPointers.
      branch: resolved.branch || branch,
    },
    isSpaceRoot: false,
    isHomeRoot: false,
    // The seed-space marker on the wire so the portal can render
    // the room differently per kind . heaven shows as a white-room
    // door-room, threads renders as a stack, etc. Null on user
    // spaces (the common case).
    heavenSpace: space.heavenSpace || null,
    beings,
    residents,
    children,
    matters,
    lineage,
    beingLineage,
    siblings,
    size: space.size || null,
    qualities: serializeQualities(space.qualities),
    // The structural owner at this position (null when unowned at this
    // node and the ancestor walk inherits). Operator surfaces like the
    // portal's Roles panel use this to label "this is the owner."
    owner: space.owner ? String(space.owner) : null,
    identity: await identityBlock(identity, { authorizedHere, writeAllowed, until, branch }),
    ...(until ? { isHistorical: true, asOf: serializeAsOf(until) } : {}),
    _meta: meta(writeAllowed ? [] : ["read-only"]),
  };
}

// Surface the historical anchor on the wire. Carries both atSeq and
// atTimestamp when both were given (atSeq wins for resolution but
// surface both for client display); foldedSeq is null at the top
// level because each reel resolves its own per-reel seq.
function serializeAsOf(until) {
  if (!until) return null;
  return {
    atSeq:       until.atSeq       ?? null,
    atTimestamp: until.atTimestamp ?? null,
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
  const { until = null, branch = "0" } = opts;
  const rows = await listSpaceChildren(parentId, opts);
  const folded = await Promise.all(rows.map((s) => foldRead("space", s._id, until, branch)));
  return rows.map((s, i) => {
    const f = folded[i] || s;
    const qualities = serializeQualities(f.qualities ?? s.qualities);
    return {
      name: f.name || s.name,
      spaceId: s._id,
      type: f.type ?? s.type ?? null,
      // The child's own heavenSpace tag (null on user spaces; one of
      // HEAVEN_SPACE.* on tier-3 + region children). The 3D scene
      // dispatches doorway styling on this (heaven door, host/factory
      // room, etc.) when nested deeper than one heaven level; without
      // it those children render as default tree meshes.
      heavenSpace: f.heavenSpace ?? s.heavenSpace ?? null,
      coord: f.coord ?? s.coord ?? null,
      path: parentPath === "/" ? `/${s.name}` : `${parentPath}/${s.name}`,
      // A child space's model is its body in THIS parent's scene —
      // the pyramid you click to enter. The child carries its own
      // render block (set-model writes it); the parent's descriptor
      // reaches in here so the scene can place every doorway-body at
      // its coord without extra SEEs.
      model:    qualities?.render?.model || null,
      scale:    qualities?.render?.scale ?? null,
      rotation: qualities?.render?.rotation ?? null,
      qualities,
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

// ./factory/present children: one stamper per being with sealed
// acts, recent actors first. Synthetic (the threads pattern):
// computed from ActHead + Act rows, nothing stored. See
// seed/materials/space/factory.js.
async function synthesizeStamperChildren(parentPath, payload) {
  const { listStamperChildren } = await import("../materials/space/factory.js");
  const limit = payload?.limit != null ? Number(payload.limit) : undefined;
  const list = await listStamperChildren({ limit });
  return list.map((s) => ({
    name:      s.name,
    spaceId:   `stamper:${s.beingId}`,
    type:      "stamper",
    synthetic: true,
    coord:     null,
    model:     null,
    path:      parentPath === "/" ? `/${encodeURIComponent(s.name)}` : `${parentPath}/${encodeURIComponent(s.name)}`,
    stamper:   { beingId: s.beingId, lastAct: s.lastAct, actCount: s.actCount, branches: s.branches },
    qualities: {},
  }));
}

// ./factory/past children: recent reels, routing into the EXISTING
// reel explorer (/.reel/<kind>/<id>). Thin by design.
async function synthesizeReelChildren(payload) {
  const { listReelChildren } = await import("../materials/space/factory.js");
  const limit = payload?.limit != null ? Number(payload.limit) : undefined;
  const list = await listReelChildren({ limit });
  return list.map((r) => ({
    name:      `${r.kind}:${r.id.slice(0, 8)}`,
    spaceId:   `reel:${r.branch}:${r.kind}:${r.id}`,
    type:      "reel",
    synthetic: true,
    path:      `/.reel/${r.kind}/${r.id}`,
    reel: {
      kind: r.kind, id: r.id, branch: r.branch,
      headSeq: r.headSeq, headHash8: r.headHash8,
      lastFactAt: r.lastFactAt ? new Date(r.lastFactAt).toISOString() : null,
      ...(r.kind === "being" ? { actsPath: `/.acts/${r.id}` } : {}),
    },
    qualities: {},
  }));
}

// Matter at a space, shaped as descriptor entries. Each matter's
// own qualities ride along so extensions characterizing matter
// (review status, energy attribution, etc.) surface without an
// extra round-trip. Slice H completion (2026-05-23): each matter
// folds before its qualities surface, same shape as the children
// loop above.
async function mattersAt(spaceId, { until = null, branch = "0", spaceRender = null } = {}) {
  if (!spaceId) return [];
  const rows = await listMattersAt(spaceId, { branch });
  const folded = await Promise.all(rows.map((m) => foldRead("matter", m.matterId, until, branch)));
  const { getMatterType } = await import("../materials/matter/types.js");
  const { getOperation } = await import("./operations.js");

  // The matter's actions menu: the registered type advertises its DO
  // ops; each resolves through the operation registry for label +
  // args so the portal renders forms generically (mirrors the
  // being-actions block built from canBe).
  const buildMatterActions = (typeName) => {
    const typeDef = getMatterType(typeName || "generic");
    if (!typeDef || !typeDef.ops?.length) return [];
    const actions = [];
    for (const opName of typeDef.ops) {
      const op = getOperation(opName);
      if (!op) continue;
      actions.push({
        verb: "do",
        action: opName,
        label: opName,
        args: op.args || null,
      });
    }
    return actions;
  };

  return rows.map((m, i) => {
    const f = folded[i] || {};
    const content = f.content ?? m.content;
    const type = f.type ?? m.type ?? "generic";
    const typeDef = getMatterType(type);
    const isLegacyText = typeof content === "string";
    const isCas = !!(content && typeof content === "object" && content.kind === "cas");
    const qualities = serializeQualities(f.qualities ?? m.qualities ?? {});
    return {
      matterId: m.matterId,
      name: f.name ?? m.name,
      type,
      coord: f.coord ?? m.coord ?? null,
      // Preview rides on the content ref (computed at write time);
      // legacy inline strings still slice. Zero store reads here —
      // the descriptor stays hot-path cheap.
      preview: isCas
        ? (content.preview ?? null)
        : (isLegacyText ? content.slice(0, 400) : null),
      previewBytes: isCas
        ? (content.preview ? Buffer.byteLength(content.preview, "utf8") : 0)
        : (isLegacyText ? Buffer.byteLength(content, "utf8") : 0),
      totalBytes: isCas
        ? (content.size ?? 0)
        : (isLegacyText ? Buffer.byteLength(content, "utf8") : 0),
      mimeType: isCas
        ? (content.mimeType || null)
        : (content && typeof content === "object" ? content.contentType || null : null),
      // The transport hint for fetching the bytes. The HASH is the
      // protocol-level identity; the URL is today's byte carrier.
      // http matter points straight at its external URL — the
      // portal embeds/links it (render.mode says which).
      contentUrl: isCas
        ? (!content.purged ? `/api/v1/content/${content.hash}` : null)
        : (content && typeof content === "object" && typeof content.url === "string"
            ? content.url
            : null),
      // External reference shapes (web / cross-reality) are small
      // structured pointers, not bytes — surface them whole so the
      // portal gets videoId / title / matterRef without a second
      // round-trip. CAS bytes never ride the descriptor.
      external: !isCas && content && typeof content === "object" ? content : null,
      purged: isCas ? content.purged === true : false,
      render: typeDef?.render || null,
      // This matter's 3D body, resolution order: the per-matter
      // override (set-model by the author) wins; then the containing
      // space's per-type default (set-model {forMatterType} on the
      // space — "all notes here look like this"); then, for matter
      // whose CONTENT IS a model (type render mode "model" — the
      // /skins catalog rows), the matter displays AS its own glb; then
      // the type's extension default (render.model on the type def).
      model: qualities?.render?.model
        || spaceRender?.matterModels?.[type]
        || (typeDef?.render?.mode === "model" && isCas && !content.purged
              ? {
                  matterId: m.matterId,
                  hash:     content.hash,
                  url:      `/api/v1/content/${content.hash}`,
                  name:     f.name ?? m.name ?? content.name ?? null,
                }
              : null)
        || typeDef?.render?.model
        || null,
      actions: buildMatterActions(type),
      byBeingId: f.beingId ?? m.beingId,
      qualities,
    };
  });
}

// Being-tree children of a being. Used by the descriptor's
// `beingLineage` field on stance addresses (<reality>/<path>@<name>).
// Each entry carries enough for the portal to render an "inhabit"
// affordance: name, beingId, cognition, defaultRole. Cap at 200 to
// stay bounded for prolific parents; deeper inspection happens via
// dedicated SEE on each child stance.
async function listBeingChildren(parentBeingId, { until = null, branch = "0" } = {}) {
  if (!parentBeingId) return [];
  const { beingCognition } = await import("../materials/being/identity/lookups.js");
  const rows = await Being
    .find({ parentBeingId: String(parentBeingId) })
    .select("_id name defaultRole homeSpace qualities createdAt")
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  // Live path: project from the rows as-is.
  if (!until) {
    return rows.map((b) => ({
      beingId:     String(b._id),
      name:        b.name || null,
      defaultRole: b.defaultRole || null,
      cognition:   beingCognition(b),
      homeSpace:   b.homeSpace ? String(b.homeSpace) : null,
      createdAt:   b.createdAt || null,
    }));
  }

  // Historical path: fold each child to `until`. Children born AFTER
  // the queried point have no facts at or before it; foldRead returns
  // null and we filter those out — they "weren't here yet."
  const folded = await Promise.all(
    rows.map((b) => foldRead("being", String(b._id), until, branch)),
  );
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const f = folded[i];
    if (!f) continue;
    out.push({
      beingId:     String(rows[i]._id),
      name:        f.name || rows[i].name || null,
      defaultRole: f.defaultRole || rows[i].defaultRole || null,
      cognition:   beingCognition(f),
      homeSpace:   f.homeSpace ? String(f.homeSpace) : null,
      createdAt:   rows[i].createdAt || null,
    });
  }
  return out;
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
// authenticated callers don't see birth/connect; unauthenticated
// callers don't see release. Portal stays state-blind.
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
  // Anonymous = no identity at all, OR the wire bound this socket to
  // the shared @arrival being (the new wire doctrine binds anon
  // sockets to arrival's beingId so verb dispatch has an identity to
  // ride; the descriptor still has to treat them as "not signed in
  // yet" for UI purposes).
  const isAnonymous = !identity?.beingId || identity?.name === "arrival";
  const out = [];
  for (const entry of def.canBe) {
    const opName = typeof entry === "string"
      ? entry
      : (entry?.action || entry?.name || null);
    if (!opName) continue;
    const op = BE_OPS[opName];
    if (!op) continue;
    // Cherub is the identity gate — its action surface depends on who's
    // at the gate. Anonymous (arrival) sees register + login; signed-in
    // users see logout. Other beings' canBe lists pass through unfiltered.
    if (beingName === "cherub") {
      const isAcquireOp = opName === "birth" || opName === "connect";
      const isHeldOp    = opName === "release";
      if (isAcquireOp && !isAnonymous) continue;
      if (isHeldOp    &&  isAnonymous) continue;
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
  // Defensive fallback: callers from buildPlaceDescriptor pass
  // the resolved branch. When called directly without one, resolve
  // the operator's `#main` pointer rather than literal "0".
  const { getDefaultBranch } = await import("../materials/branch/branchRegistry.js");
  const branch = opts.branch || await getDefaultBranch();
  const identity = opts.identity || null;
  const until    = opts.until    || null;
  // The inbox + open/sealed-Act helpers are live-only projections
  // today. For historical SEE we surface empty inbox / null activity
  // rather than misleading current-state data — a past view shouldn't
  // claim "this being is currently talking to X" when the asker is
  // looking at a snapshot of last week. Inbox-at-time is a future
  // slice; flagging here so the limitation surfaces honestly.
  const inboxByBeing = until ? {} : await getInboxSummary(spaceId, { branch });

  // Slice H: fold each being before reading qualities. Per FOLD.md
  // foldPlace mounts the face for the moment; here the descriptor is
  // doing the same weave at SEE time. Hot path is one cache read per
  // being (foldedSeq current → zero replay).
  //
  // Historical path: each being row folds to its own per-reel seq
  // derived from `until` (typically a timestamp). A being whose reel
  // had no facts at or before `until` returns null and drops out of
  // qualitiesByBeing/coordByBeing — its entry renders with empty
  // qualities/coord, same shape as a live-missing projection.
  const beingIds = entries.map((e) => e._beingId).filter(Boolean);
  const foldedBeings = await Promise.all(
    beingIds.map((id) => foldRead("being", id, until, branch)),
  );
  // Pair folded states with their being ids by index (foldRead may
  // return a state without _id when historical). We track ids
  // explicitly so historical fold results map back to the right row.
  const idsAndFolded = beingIds.map((id, i) => ({ id, folded: foldedBeings[i] }));
  const qualitiesByBeing = new Map(
    idsAndFolded
      .filter(({ folded }) => folded)
      .map(({ id, folded }) => [String(id), serializeQualities(folded.qualities)]),
  );
  const coordByBeing = new Map(
    idsAndFolded
      .filter(({ folded }) => folded)
      .map(({ id, folded }) => [String(id), folded.coord || null]),
  );

  const activities = await Promise.all(entries.map(async (e) => {
    if (!e._beingId) return null;
    if (until) return null; // historical: see comment on inboxByBeing
    const open = await findOpenForBeing(e._beingId);
    if (open) return summonToActivity(open, { branch });
    // No Act in flight. Fall back to what this being last SAID so
    // the speech bubble persists between moments. Without this the
    // bubble vanishes the instant a moment seals.
    const sealed = await findLastSealedForBeing(e._beingId);
    return summonToActivity(sealed, { sealed: true, branch });
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
      // canSummon entries — both sides of the summon edge. Entries
      // discriminate via `as: "actor"|"receiver"` (default "actor").
      // UI discovery filters `as:"receiver"` to render per-being
      // accept options (e.g. birther's "mate" button); auth filters
      // `as:"actor"` on the caller's role. See seed/RolesAreAuth.md
      // + protocols/ibp/FEDERATION.md.
      canSummon: def?.canSummon || null,
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
      // The being's 3D body — a model matter block written by
      // set-model ({ matterId, hash, url, name }; bytes load from
      // /api/v1/content/<hash>). Null = portal default for the role.
      model:       (inboxKey && qualitiesByBeing.get(inboxKey)?.render?.model) || null,
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

async function identityBlock(identity, { authorizedHere, writeAllowed, until = null, branch = "0" }) {
  if (!identity) return null;
  // Position + coord are server-side state on the Being row. Surface
  // them on every authenticated SEE so the portal can resume the
  // camera at the being's last spot (instead of teleporting to /
  // on every login / reconnect). `coord` may be null on never-moved
  // beings — the client falls back to a default spawn.
  //
  // Historical SEE: fold the asker's own row to the same `until` so
  // the camera resumes at where THEY were at the past point. If the
  // asker didn't exist yet at that point, we surface null position +
  // coord (the client falls back to default spawn).
  let position  = null;
  let coord     = null;
  let homeSpace = null;
  // Stale = the JWT names a being that no longer exists in the
  // substrate (operator dropped the DB, ended the being, etc.). The
  // portal reads this flag to drop the cached session and reconnect
  // anonymously, so the user doesn't sit logged in as a ghost and
  // hit BEING_NOT_FOUND on every action.
  let stale = false;
  if (identity.beingId) {
    try {
      if (until) {
        const folded = await foldRead("being", identity.beingId, until, branch);
        if (folded) {
          position  = folded.position ? String(folded.position) : null;
          homeSpace = folded.homeSpace ? String(folded.homeSpace) : null;
          const coordQ = folded.qualities?.coord;
          coord = coordQ || folded.coord || null;
        }
      } else {
        // loadOrFold (not loadProjection): a freshly-registered being
        // (cherub.birth that JUST sealed) may not have its projection
        // slot materialized yet, AND on any non-main branch the slot
        // doesn't exist until the lineage walk cold-folds it. Bare
        // loadProjection returns null in both cases . the portal then
        // sees identity.position = null, can't compute a landing
        // address, and falls back to `<reality>/@<name>` which the
        // resolver lands at the place root. The user's being IS at
        // their home with its bigger grid; the portal renders the
        // place root with its smaller grid; the being-mesh spawns
        // outside the visible area. loadOrFold walks the lineage so
        // the slot resolves the same way it does once steady-state
        // catches up.
        const { loadOrFold } = await import("../materials/projections.js");
        const slot = await loadOrFold("being", identity.beingId, branch);
        if (!slot) {
          // JWT decoded to a beingId that has no projection slot AND
          // no facts to lazy-fold from. The being doesn't exist in
          // this substrate. Mark stale so the client drops the
          // session instead of looping into BEING_NOT_FOUND on
          // every downstream DO.
          stale = true;
        }
        // Position rides at the slot level (sparse-indexed for
        // findByPosition); qualities + other reducer state ride at
        // slot.state. Coord lives under qualities.coord typically.
        position  = slot?.position ? String(slot.position) : (slot?.state?.position || null);
        homeSpace = slot?.state?.homeSpace || null;
        const quals = slot?.state?.qualities;
        const coordQ = quals instanceof Map ? quals.get("coord") : quals?.coord;
        coord = coordQ || slot?.state?.coord || null;
        // Visibility for the "freshly-registered being lands off-grid"
        // class of bugs. When the slot resolved but position is null,
        // something upstream (the be:birth reducer, the post-seal
        // fold, the lineage walk on a non-main branch) failed to
        // populate it. Without this warn the portal silently falls
        // back to homeSpace and the user never gets a signal that
        // anything went wrong — the deeper bug stays hidden.
        if (slot && !position) {
          log.warn(
            "Descriptor",
            `identity.position resolved null for being=${String(identity.beingId).slice(0, 8)} ` +
              `on branch ${branch} (slot=${slot?.state ? "present" : "missing"}, ` +
              `homeSpace=${homeSpace ? "yes" : "no"}). Portal will fall back to homeSpace. ` +
              `Investigate post-seal fold for the be:birth reel.`,
          );
        }
      }
    } catch (err) {
      // Defensive catch — never let an identity-block failure deny
      // the SEE. But log it so we can see when the fold path is
      // failing silently (the prior empty catch swallowed everything
      // and the portal's only signal was a null position).
      log.warn(
        "Descriptor",
        `identityBlock fold failed for being=${String(identity.beingId).slice(0, 8)}: ${err.message}`,
      );
    }
  }
  return {
    beingId: identity.beingId,
    name:    identity.name,
    position,
    // homeSpace exposed so the portal can fall back to "/<homeSpace>"
    // when position is null (freshly-registered being whose slot
    // hasn't materialized yet, slow cold-fold, etc.). Without this
    // the portal's only fallback was `<reality>/@<name>` which
    // resolves to the reality root — and the being's home-grid coord
    // then renders far outside the much larger root grid.
    homeSpace,
    coord,
    authorizedHere,
    writeAllowed,
    stale,
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
  const obj = quals instanceof Map ? Object.fromEntries(quals) : { ...quals };
  // Every qualities surface (space / being / matter, on SEE and on live
  // patches) flows through here — redact secrets so api keys and
  // credentials never ride a descriptor to a client. The stored qualities
  // (read server-side for decryption) are untouched.
  return redactSecrets(obj);
}

