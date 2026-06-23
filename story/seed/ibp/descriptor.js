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
// version, registered ables, and graftable clones. It lives here
// because both descriptor and discovery are wire payloads my SEE
// verb returns, and they share types and version constants.

import log from "../seedStory/log.js";
import { getStoryDomain } from "./address.js";
import { getStoryConfigValue, getStoryUrl } from "../storyConfig.js";
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
import { getAble, listAbles } from "../present/ables/registry.js";
import { listTemplates } from "../store/book/templateRegistry.js";
import { serializeTypeCatalog } from "../materials/matter/classify.js";
import { listFoldedOps } from "../present/word/wordStore.js";
import { listBeOpNames, getBeOp } from "./beOps.js";
import {
  findOpenForBeing,
  findLastSealedForBeing,
} from "../present/stamper/2-fold/reelChains.js";
import { fold } from "../present/stamper/2-fold/foldEngine.js";
import {
  foldAt,
  NoSuchHistoricalState,
} from "../present/stamper/2-fold/foldAt.js";
import { loadProjection } from "../materials/projections.js";
import { redactSecrets } from "../materials/redact.js";
import { BE_OPS } from "./beOps.js";
import Act from "../past/act/act.js";
import Projection from "../materials/history/projection.js";
import { isNameBanished } from "../materials/name/closure.js";

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
async function foldRead(type, id, until = null, history) {
  if (!id) return null;
  try {
    if (until) {
      // SEAM: foldAt's opts key is `history` (foldAt.js resolveUntil
      // reads opts.history); the value is the history slot.
      const { state } = await foldAt(type, String(id), until, {
        history,
      });
      return state;
    }
    // SEAM: fold's opts key is `history` (foldEngine.js reads
    // opts.history); the value is the history slot.
    const { state } = await fold(type, String(id), { history });
    return state;
  } catch (err) {
    if (err instanceof NoSuchHistoricalState) return null;
    return null;
  }
}

// Wire-shape versions. Bump when the descriptor / discovery shape
// changes in a way clients must opt into.
export const DESCRIPTOR_VERSION = "1.0";
export const IBP_PROTOCOL_VERSION = "1.0";
// ── Place discovery payload ──
// Returned by `ibp:see <story>/.discovery` once a socket is open. The
// pre-identity surface every client reads to learn what I speak:
// protocol version, descriptor versions supported, WS URL, able
// names registered, verb set, graftable clones.

// My BE-only beings — addressable through BE but not in the SUMMON
// able registry, so they need an explicit listing for the discovery
// payload.
const SYSTEM_BE_BEINGS = ["cherub", "llm-assigner"];

export async function buildDiscovery() {
  const storyUrl = getStoryUrl();
  const wsUrl = storyUrl.replace(/^http/, "ws");

  // The chain fingerprint: one hash summarizing the whole substrate's
  // chain state (TTL-memoized in chainRoots.js — discovery is fetched
  // on every portal connect). Two realities compare state in a single
  // round-trip; on mismatch, walk chain-root → reel heads → facts to
  // the exact divergence.
  let chainBlock = { storyRoot: null, storyId: null, sig: null };
  try {
    const { signedStoryRoot } = await import("../past/fact/chainRoots.js");
    chainBlock = await signedStoryRoot();
  } catch {
    /* additive — discovery never blocks on the fingerprint */
  }

  // Merge two sources: the live able registry (SUMMON-honoring ables
  // registered by the seed + extensions) and the canonical system
  // beings (BE-only). Dedupe + sort.
  const ables = Array.from(
    new Set([...listAbles(), ...SYSTEM_BE_BEINGS]),
  ).sort();

  return {
    name: getStoryConfigValue("STORY_NAME") || "Unnamed Place",
    story: getStoryDomain(),
    protocolVersion: IBP_PROTOCOL_VERSION,
    descriptorVersionSupported: [DESCRIPTOR_VERSION],
    ws: wsUrl,
    auth: { method: "bearer" },
    ables,
    // Graftable clone bundles registered by extensions. Surfaced in the
    // discovery payload (unauthenticated) so the portal's hotbar can
    // populate before the operator signs in. The list-clones DO op
    // returns the same data for callers who want a live refresh.
    templates: listTemplates(),
    // The matter-type catalog (registry defs + their claims).
    // Composers classify LOCALLY against this ("will become: web")
    // with zero round-trips; the classify-matter SEE op gives the
    // same answer authoritatively for non-discovery callers.
    matterTypes: serializeTypeCatalog(),
    // Upload policy caps so composers refuse oversized / disallowed
    // files before POSTing bytes. The HTTP carrier re-enforces.
    upload: {
      enabled: getStoryConfigValue("uploadEnabled") !== false,
      maxUploadBytes:
        Number(getStoryConfigValue("maxUploadBytes")) || 104857600,
      allowedMimeTypes: getStoryConfigValue("allowedMimeTypes") || null,
    },
    // The chain fingerprint, SIGNED by the story (= I_AM) key. A peer
    // given storyId (which IS the story public key), storyRoot,
    // and sig verifies the whole chain's provenance self-certifyingly.
    chain: chainBlock,
    supportedVerbs: ["see", "do", "call", "be"],
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
    const names =
      beingHomes instanceof Map
        ? Array.from(beingHomes.keys())
        : Object.keys(beingHomes);
    for (const name of names) {
      if (STANCE_NAMES.has(name)) continue;
      const home =
        beingHomes instanceof Map ? beingHomes.get(name) : beingHomes[name];
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
async function occupantsByPosition(spaceId, existing, history) {
  if (!spaceId) return [];
  const seen = new Set();
  for (const e of existing) {
    if (e._beingId) seen.add(String(e._beingId));
  }
  // History-aware position lookup. findByPosition handles shadow +
  // tombstone semantics for non-main; main short-circuits to its
  // own path. We only get back {type, id, position, foldedSeq};
  // resolve names via a batched projection load.
  const { findByPosition, loadProjections } =
    await import("../materials/projections.js");
  const refs = (await findByPosition(spaceId, history)).filter(
    (r) => r.type === "being",
  );
  const ids = refs.map((r) => r.id);
  const slots = await loadProjections("being", ids, history);
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
async function callToActivity(summon, opts = {}) {
  const { getDefaultHistory } =
    await import("../materials/history/historyRegistry.js");
  const history = opts.history || (await getDefaultHistory());
  if (!summon) return null;

  if (opts.sealed) {
    const raw = summon.endMessage;
    const text =
      raw && typeof raw === "object"
        ? typeof raw.content === "string"
          ? raw.content
          : ""
        : typeof raw === "string"
          ? raw
          : "";
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
      .select("act params date")
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
    if (lastFact.act === "call") {
      const recipientBeingId = lastFact.params?.recipient
        ? String(lastFact.params.recipient)
        : null;
      const recipientName = recipientBeingId
        ? await _lookupBeingName(recipientBeingId, history)
        : null;
      return {
        kind: "summoning",
        content: truncate(lastFact.params?.content || "", ACTIVITY_CONTENT_CAP),
        target: recipientBeingId
          ? {
              kind: "being",
              beingId: recipientBeingId,
              name: recipientName,
              able: lastFact.params?.activeAble || null,
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
        `${lastFact.act}(${summarizeArgs(lastFact.params)})`,
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

// Best-effort name lookup for a being id. Used by callToActivity to
// pre-resolve the recipient name so the portal can render `→@<name>`
// without a second roundtrip. Returns null on miss (the portal falls
// back to able / beingId prefix).
async function _lookupBeingName(beingId, history) {
  try {
    // loadOrFold (not loadProjection): the recipient being may live
    // inherited from a parent history. Without the lineage walk the
    // bubble would show "→@<id-prefix>" instead of "→@<name>" for any
    // inherited being addressed from a history . degraded UX, not a
    // hard break, but the fix is one swap.
    const { loadOrFold } = await import("../materials/projections.js");
    const slot = await loadOrFold("being", String(beingId), history);
    return slot?.state?.name || null;
  } catch {
    return null;
  }
}

// Infer what a Act is acting on. The Act schema doesn't carry an
// explicit target field, but the reply linkage tells us: when inReplyTo
// is set, the Act was spawned by another being. Treat the parent's
// activeAble/position as the target so sub-beings animate walking toward
// their spawner.
async function inferActivityTarget(summon) {
  if (!summon?.inReplyTo) return null;
  let parent;
  try {
    const Act = (await import("../past/act/act.js")).default;
    parent = await Act.findById(summon.inReplyTo)
      .select("activeAble to")
      .lean();
  } catch {
    return null;
  }
  if (!parent || !parent.activeAble || !parent.to) return null;
  // Without aiContext/treeContext we no longer have a (spaceId, able)
  // tuple to hand the renderer. Surface the parent being + able so the
  // 3D portal can map "which mesh is this being" via its descriptor entry.
  return {
    kind: "being",
    beingId: String(parent.to),
    able: parent.activeAble,
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
// Cap the being list so a prolific Name stays bounded on the wire; the
// exact total rides alongside as `beingCount`.
const NAME_BEING_CAP = 200;

/**
 * Build a Name's BIOGRAPHIC descriptor ("who is this name") — distinct from
 * the place descriptor's "what is here" (geographic). This is what the Name
 * Form (the pre-world pre-panel) shows for a name: its real-name + public key,
 * lineage toward I_AM, soul, banished state, the beings it acts through, and
 * its activity counts. Caller resolves the token to a nameId first
 * (resolveNameId); pass the resolved nameId here.
 *
 * SECRET DISCIPLINE: the Name's encrypted private key (`privateKeyEnc`) sits
 * at the TOP of the folded name state. This builder FIELD-PICKS every value it
 * returns and NEVER spreads `state` — the field-pick is the load-bearing guard
 * that keeps the key (and any future secret leaf) off the wire. Only
 * public/biographic data crosses.
 *
 * @param {string} nameId — an already-resolved Name id (the ed25519 pubkey, or "i-am")
 * @returns {Promise<object|null>} the Name descriptor, or null when no such Name
 */
export async function buildNameDescriptor(nameId) {
  if (!nameId) return null;

  // Names live on main ("0") and never fork — the name reel is story-wide,
  // above the history timeline (materials/name/name.js, closure.js). Read the
  // name on "0" via loadProjection (the cached fold of the name reel), NOT
  // fold(): fold() returns a truthy empty {} for an id that has no facts, so a
  // bogus pubkey would mint an empty descriptor instead of a clean 404.
  // loadProjection returns null when no name slot exists — the honest "no such
  // name". Every name fact (declare/banish) writes this slot, so it is current.
  const slot = await loadProjection("name", String(nameId), "0");
  if (!slot || !slot.state) return null;
  const state = slot.state;

  const banished = await isNameBanished(String(nameId));

  // The beings this Name acts through (the presences expressing its trueName).
  // Read from the projections cache (the live store), FIELD-PICKING only the
  // safe state subfields — never `state.password` / never the whole `state`
  // (it carries password + the qualities map). Capped list + exact count. The
  // `state.trueName` filter is an unindexed scan, bounded + fine for a Name
  // Form read; main-scoped (names + their beings live on "0").
  const rows = await Projection.find({
    history: "0",
    type: "being",
    "state.trueName": String(nameId),
    tombstoned: { $ne: true },
  })
    .select("id state.name state.defaultAble state.homeSpace state.homeHistory")
    .sort({ id: 1 })
    .limit(NAME_BEING_CAP)
    .lean();
  const beings = rows.map((r) => ({
    beingId: String(r.id),
    name: r.state?.name || null,
    defaultAble: r.state?.defaultAble || null,
    homeSpace: r.state?.homeSpace ? String(r.state.homeSpace) : null,
    homeHistory: r.state?.homeHistory || null,
  }));
  const beingCount = await Projection.countDocuments({
    history: "0",
    type: "being",
    "state.trueName": String(nameId),
    tombstoned: { $ne: true },
  });
  // The Name's whole biography of acts, across every being it acts through
  // (act.nameId is index-backed). factCount is deliberately omitted — Fact has
  // no nameId index and i-am is a full-collection-scan pathology.
  const actCount = await Act.countDocuments({ by: String(nameId) });

  // FIELD-PICK — never `{ ...state }`. privateKeyEnc never appears here.
  // `identity` is the key SCHEME only (alg / encoding / version), no key bytes.
  return {
    isName: true,
    nameId: String(nameId),
    name: state.name ?? null,
    parentNameId: state.parentNameId ?? null,
    soulType: state.soulType ?? null,
    identity: state.identity ?? null,
    isBanished: banished,
    closedAt: state.closedAt ?? null,
    createdAt: state.createdAt ?? null,
    updatedAt: state.updatedAt ?? null,
    beings,
    beingCount,
    actCount,
    descriptorVersion: DESCRIPTOR_VERSION,
  };
}

/**
 * The NAME's being-tree ON ONE HISTORY — the hierarchy view + grant surface.
 *
 * History-scoped on purpose: you stand on a history (the IBPA left stance), and
 * this shows the beings your Name owns on THAT history's timeline, nested by
 * parentBeingId, each tagged with the live inheritation points granted there.
 * Switch history to see (and grant on) another timeline — a grant lands on the
 * history you're standing on, so the tree you see is exactly the access you give.
 *
 * "Beings on this history" = your beings whose fold lives anywhere on the
 * history's reel-lineage (a being born on main is inherited by every sub-history;
 * a being born on a sub-history shows only there). De-duped to the row closest
 * to the history. Beings whose parent your Name does NOT own (e.g. parented
 * under @cherub) surface as roots, tagged with the parent's name for context.
 *
 * Leak-safe like buildNameDescriptor: field-picks only safe state, never the
 * key or password.
 */
export async function buildNameTree(nameId, history) {
  if (!nameId) return null;
  const nameSlot = await loadProjection("name", String(nameId), "0");
  if (!nameSlot || !nameSlot.state) return null;

  // Resolve the history (never literal "0"): the caller's current history, or
  // the operator default if none was threaded.
  let br = history ? String(history) : null;
  if (!br) {
    const { getDefaultHistory } =
      await import("../materials/history/historyRegistry.js");
    br = await getDefaultHistory();
  }
  const { resolveHistoryLineage } =
    await import("../materials/history/histories.js");
  const { livePointsAt } =
    await import("../materials/being/identity/inheritation.js");
  const lineage = await resolveHistoryLineage(br);
  const rank = new Map(lineage.map((b, i) => [b, i]));

  // The Name's beings whose fold-cache row lives anywhere on this history's
  // lineage. Bounded scan, capped — same shape as buildNameDescriptor.
  const rows = await Projection.find({
    history: { $in: lineage },
    type: "being",
    "state.trueName": String(nameId),
    tombstoned: { $ne: true },
  })
    .select(
      "id history state.name state.trueName state.parentBeingId state.homeHistory state.defaultAble",
    )
    .limit(NAME_BEING_CAP)
    .lean();

  // De-dupe by beingId, keeping the row on the history CLOSEST to `br` (the
  // deepest lineage rank — the most current fold for where you stand).
  const byId = new Map();
  for (const r of rows) {
    const id = String(r.id);
    const prev = byId.get(id);
    if (!prev || (rank.get(r.history) ?? -1) > (rank.get(prev.history) ?? -1))
      byId.set(id, r);
  }

  // Build a node per being, with its history-scoped live inheritation points.
  const nodes = new Map();
  for (const r of byId.values()) {
    const id = String(r.id);
    const points = await livePointsAt(id, br);
    nodes.set(id, {
      beingId: id,
      name: r.state?.name || null,
      trueName: r.state?.trueName || null,
      parentBeingId: r.state?.parentBeingId
        ? String(r.state.parentBeingId)
        : null,
      homeHistory: r.state?.homeHistory || null,
      defaultAble: r.state?.defaultAble || null,
      points: [...points],
      children: [],
    });
  }

  // Nest: a being whose parent your Name also owns becomes that parent's child;
  // otherwise it's a root. Resolve each root's foreign parent name for context.
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parentBeingId ? nodes.get(node.parentBeingId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const root of roots) {
    if (!root.parentBeingId) {
      root.parentName = null;
      continue;
    }
    const p = await loadProjection("being", root.parentBeingId, br);
    root.parentName = p?.state?.name || null;
  }

  return {
    isNameTree: true,
    nameId: String(nameId),
    name: nameSlot.state.name ?? null,
    history: br,
    roots,
    beingCount: nodes.size,
    descriptorVersion: DESCRIPTOR_VERSION,
  };
}

/**
 * The being a NAME last be:connected and has NOT since be:released — its OPEN
 * session, to AUTO-RESUME on the name's next connect (Tabor: "look at the name's
 * act chain for the last be:connect with no be:release; if none, go to the
 * being menu / arrival"). Reads the name's be:connect / be:release facts in
 * time order; a being whose LATEST be-action is "connect" is still open, and
 * the most-recently-connected such being wins. Returns { beingId, beingName,
 * homeHistory } or null.
 */
export async function lastOpenBeingForName(nameId, history = "0") {
  if (!nameId || String(nameId) === "i-am") return null;
  const { default: Fact } = await import("../past/fact/fact.js");
  // The name's own be:connect / be:release facts, oldest-first. nameId is the
  // signer (the name acting); target is the being connected/released.
  const facts = await Fact.find({
    by: String(nameId),
    verb: "be",
    act: { $in: ["connect", "release"] },
  })
    .sort({ date: 1 })
    .select("act of date")
    .lean();

  const latest = new Map(); // beingId -> { act, date } (its most recent be-action)
  for (const f of facts) {
    const bid = f.of?.id ? String(f.of.id) : null;
    if (!bid) continue;
    latest.set(bid, { act: f.act, date: f.date });
  }
  let best = null;
  for (const [bid, la] of latest) {
    if (la.act === "connect" && (!best || la.date > best.date))
      best = { beingId: bid, date: la.date };
  }
  if (!best) return null;

  // Resolve the open being's name + home history so the portal can drive it.
  // Skip a tombstoned/closed being (you can't resume a dead being).
  const slot = await loadProjection("being", best.beingId, history);
  if (!slot?.state || slot.tombstoned) return null;
  return {
    beingId: best.beingId,
    beingName: slot.state.name || null,
    homeHistory: slot.state.homeHistory || "0",
  };
}

export async function buildPlaceDescriptor(resolved, opts = {}) {
  // History flows from the resolved stance (Pass 4 substrate). Threaded
  // through every descriptor helper alongside `until` so each fold lands
  // on the right history's projection slot. resolveHistoryPointers
  // upstream canonicalizes resolved.history for both #explicit and
  // #main-implicit addresses. The defensive fallback resolves the
  // operator's `#main` pointer through the registry — never literal "0".
  const { getDefaultHistory } =
    await import("../materials/history/historyRegistry.js");
  const historyOpts = {
    ...opts,
    history: resolved.history || opts.history || (await getDefaultHistory()),
  };
  if (resolved.isSpaceRoot) return placeAtSpaceRoot(resolved, historyOpts);
  return placeAtSpace(resolved, historyOpts);
}

async function placeAtSpaceRoot(
  resolved,
  { identity, until = null, history } = {},
) {
  const storyDomain = getStoryDomain();
  const spaceRootId = getSpaceRootId();
  const isRegistered = (beingName) => !!getAble(beingName);

  const spaceRoot = await foldRead("space", spaceRootId, until, history);
  let children = spaceRootId
    ? await childrenOf(spaceRootId, "/", { until, history })
    : [];

  // The childrenOf walk filters out heaven spaces (so .config/.tools
  // etc. don't pollute the place-root listing). Heaven IS a seed
  // space but is meant to be visible at the place root as the door
  // into the I-Am's room . inject it explicitly. Reigning gating
  // happens at SEE-time when a being tries to walk through; here we
  // just surface the door.
  if (spaceRootId) {
    const { findByHeavenSpace } = await import("../materials/projections.js");
    const _hSlot = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, history);
    const heaven = _hSlot ? { _id: _hSlot.id, ...(_hSlot.state || {}) } : null;
    if (heaven) {
      const folded =
        (await foldRead("space", heaven._id, until, history)) || heaven;
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

  const matters = spaceRootId
    ? await listMattersAt(spaceRootId, { until, history })
    : [];

  // My place-root beings — ensureSeedDelegates plants them; this list
  // makes them addressable from the place descriptor without walking
  // qualities.beings. `available` reflects whether the able's
  // backing extension is currently registered.
  //
  // The raw list runs through enrichBeings so each entry picks up the
  // able's `actions[]` surface (from canBe + BE_OPS) plus identity,
  // permissions, inbox, activity, qualities, etc. Without this the
  // 3D portal sees the bare {being, invocableBy, available} triple
  // and renders cherub with "no actions" because the actions array
  // is undefined.
  // Seed-delegate labels at the place root: the able + invocability
  // surface every fresh visitor sees on first SEE. The roster (name,
  // able, cognition, invocableBy) lives in SEED_DELEGATES . single
  // source of truth. We resolve each delegate's REAL Being row id by
  // name so occupantsByPosition's dedupe (keyed on _beingId)
  // recognizes them and doesn't surface the same being twice. Each
  // entry carries the able-specific invocableBy + availability; if
  // the delegate's row hasn't planted yet (early boot, or a
  // misconfigured place), the entry surfaces anyway with _beingId:
  // null so the label and action surface still render . it just
  // can't carry coord/inbox/activity until the row catches up.
  const { SEED_DELEGATES } =
    await import("../materials/being/seedDelegates.js");
  const { findByName } = await import("../materials/projections.js");
  // Delegates homed in their own heaven rooms (the host tier) do NOT
  // surface at the story root — their position is truthful and the
  // occupants query finds them in their rooms. Only root-homed
  // delegates ride the hardcoded roster.
  const rootDelegates = SEED_DELEGATES.filter((d) => !d.homeHeavenSpace);
  const delegateSlots = (
    await Promise.all(
      rootDelegates.map((d) => findByName("being", d.name, history)),
    )
  ).filter(Boolean);
  const delegateIdByName = new Map(
    delegateSlots.map((s) => [s.state?.name, String(s.id)]),
  );
  const seedDelegateEntries = rootDelegates.map((d) => ({
    being: d.name,
    invocableBy: d.invocableBy || "authenticated",
    available: isRegistered(d.name),
    _beingId: delegateIdByName.get(d.name) || null,
  }));
  // Merge in transient occupants . any being whose position points at
  // the space root and isn't already a seed delegate above. Mirrors
  // the placeAtSpace path so the story root surfaces humans /
  // scripted / LLM beings standing there, not just seed delegates.
  const transientRoot = spaceRootId
    ? await occupantsByPosition(spaceRootId, seedDelegateEntries, history)
    : [];
  const spaceRootBeings = await enrichBeings(
    spaceRootId,
    [...seedDelegateEntries, ...transientRoot],
    { identity, until, history },
  );

  return {
    address: {
      place: storyDomain,
      path: "/",
      being: resolved.being || null,
      spaceId: spaceRootId || null,
      pathByNames: "/",
      // History this descriptor was folded for. The portal's history
      // chip reads this to decide whether to surface the `#<history>`
      // qualifier in the address bar. `history` was already resolved
      // upstream through the `#main` pointer registry; the fallback
      // reads `resolved.history` (post-resolveHistoryPointers).
      history: resolved.history || history,
    },
    isSpaceRoot: true,
    isHomeRoot: false,
    // Surface the space root's `size` on the wire, same as placeAtSpace
    // does for non-root positions. Without this the 3D portal's sized-
    // land render history never fires at the story root . it falls
    // back to the infinite outdoor scene even though the root now
    // carries a default size at creation time.
    size: spaceRoot?.size || null,
    beings: spaceRootBeings,
    children,
    matters,
    qualities: serializeQualities(spaceRoot?.qualities),
    place: {
      name: getStoryConfigValue("STORY_NAME") || "Unnamed Place",
    },
    identity: await identityBlock(identity, { until, history }),
    ...(until ? { isHistorical: true, asOf: serializeAsOf(until) } : {}),
  };
}

async function placeAtSpace(
  resolved,
  { identity, payload, until = null, history } = {},
) {
  const storyDomain = getStoryDomain();
  if (!resolved.leafSpace)
    throw new Error("Resolved space missing leafSpace reference");

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
  const folded = await foldRead(
    "space",
    resolved.leafSpace._id,
    until,
    history,
  );
  const space = folded
    ? { _id: resolved.leafSpace._id, ...folded }
    : resolved.leafSpace;

  const pathByNames = "/" + resolved.chain.map((c) => c.name).join("/");

  // .threads has no persisted children; the live forest is projected
  // on demand from Act records keyed by rootCorrelation. The SEE
  // payload's filter fields (being, able, position, stance, priority)
  // push down to the projection's $match so the listing scales.
  // Each entry is shaped like a normal child so clients render it
  // through the same path as any other space listing.
  //
  // Historical caveat: .threads is a live projection (no chain of its
  // own); a past view of /./threads still surfaces the CURRENT live
  // forest. The doctrine: threads-at-time would require historical
  // inbox + Act reconstruction, which is its own future slice.
  const children =
    space.heavenSpace === HEAVEN_SPACE.THREADS
      ? await synthesizeThreadChildren(space._id, pathByNames, payload)
      : space.heavenSpace === HEAVEN_SPACE.FACTORY_PRESENT
        ? await synthesizeStamperChildren(pathByNames, payload)
        : space.heavenSpace === HEAVEN_SPACE.FACTORY_PAST
          ? await synthesizeReelChildren(payload)
          : await childrenOf(space._id, pathByNames, {
              until,
              history,
              // Heaven-region parents (host, factory) list their own
              // heaven-marked children; ordinary listings keep
              // filtering them out.
              includeHeavenChildren: !!space.heavenSpace,
            });
  const matters = await mattersAt(space._id, {
    until,
    history,
    // The containing space's render block — carries per-type model
    // defaults (qualities.render.matterModels.<type>) that matter
    // entries fall back to when they carry no override of their own.
    spaceRender: serializeQualities(space.qualities)?.render || null,
  });
  const lineage = buildLineage(resolved);
  // (siblings retired 2026-06-11: a full childrenOf sweep of the
  // parent ran on every SEE and nothing ever read the result.)

  // Access for the asker. Used for descriptor enrichment only —
  // able-walk gating runs in authorize() upstream and downstream,
  // not here. `writeAllowed` is the conservative "this caller clearly
  // owns this place" signal (post-AblesAreAuth there's no single
  // boolean for "can write anything"; specific writes pass through
  // authorize per-action). UIs that want a per-action signal should
  // ask "can I do X here?" rather than read this flag.
  // Defensive: leave both false on any error so a broken read never
  // silently grants writes.
  let writeAllowed = false;
  let authorizedHere = false;
  if (identity?.beingId) {
    try {
      const access = await resolveSpaceAccess(
        space._id,
        identity.beingId,
        history,
      );
      writeAllowed = !!(access?.ok && access?.isOwner === true);
      authorizedHere = !!access?.ok;
    } catch {
      /* defensive */
    }
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
  const positionedHere = await occupantsByPosition(space._id, [], history);
  // Cross-index for the residents enrichment.
  const positionedIds = new Set(
    positionedHere
      .map((e) => e._beingId)
      .filter(Boolean)
      .map(String),
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
    const reg = registered.find(
      (r) => r._beingId && String(r._beingId) === String(occ._beingId),
    );
    return reg
      ? { ...occ, invocableBy: reg.invocableBy, available: reg.available }
      : occ;
  });
  const beings = await enrichBeings(space._id, renderEntries, {
    identity,
    until,
    history,
  });
  const residents = await enrichBeings(space._id, residentsRaw, {
    identity,
    until,
    history,
  });

  // Being-tree lineage. When the stance carries a beingId (a stance
  // address like <story>/<path>@<name>), surface the immediate
  // children of that being — beings whose parentBeingId points at it.
  // The portal renders this as the "lineage" panel: who did you
  // birth, who can you inhabit. One Mongo query, lean, capped.
  const beingLineage = resolved.beingId
    ? await listBeingChildren(resolved.beingId, { until, history })
    : null;

  return {
    address: {
      place: storyDomain,
      path: pathByNames,
      being: resolved.being || null,
      spaceId: space._id,
      pathByNames,
      // History this descriptor was folded for. `history` was resolved
      // upstream through the `#main` pointer registry; resolved.history
      // is the post-canonicalization value from resolveHistoryPointers.
      history: resolved.history || history,
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
    size: space.size || null,
    qualities: serializeQualities(space.qualities),
    // The structural owner at this position (null when unowned at this
    // node and the ancestor walk inherits). Operator surfaces like the
    // portal's Ables panel use this to label "this is the owner."
    owner: space.owner ? String(space.owner) : null,
    identity: await identityBlock(identity, { until, history }),
    ...(until ? { isHistorical: true, asOf: serializeAsOf(until) } : {}),
  };
}

// Surface the historical anchor on the wire. Carries both atSeq and
// atTimestamp when both were given (atSeq wins for resolution but
// surface both for client display); foldedSeq is null at the top
// level because each reel resolves its own per-reel seq.
function serializeAsOf(until) {
  if (!until) return null;
  return {
    atSeq: until.atSeq ?? null,
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
  const { until = null, history } = opts;
  let rows = await listSpaceChildren(parentId, opts);
  let folded = await Promise.all(
    rows.map((s) => foldRead("space", s._id, until, history)),
  );
  // Historical SEE: null fold = the child space didn't exist yet at
  // `until` — exclude it rather than render its live state (same rule
  // as mattersAt).
  if (until) {
    const keep = rows.map((_, i) => !!folded[i]);
    rows = rows.filter((_, i) => keep[i]);
    folded = folded.filter((_, i) => keep[i]);
  }
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
      model: qualities?.render?.model || null,
      scale: qualities?.render?.scale ?? null,
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
// envelope's payload on WS). Recognized filter fields — being, able,
// position, stance, priority, limit — push down to the projection's
// $match, so filtering scales on busy systems.
async function synthesizeThreadChildren(parentId, parentPath, payload) {
  const filters =
    payload && typeof payload === "object"
      ? {
          limit: payload.limit != null ? Number(payload.limit) : undefined,
          being: payload.being || null,
          able: payload.able || null,
          position: payload.position || null,
          stance: payload.stance || null,
          priority: payload.priority || null,
        }
      : {};
  const live = await listLiveThreads(filters);
  return live.map((t) => ({
    name: t.id,
    spaceId: `thread:${t.id}`,
    type: "thread",
    synthetic: true,
    path: parentPath === "/" ? `/${t.id}` : `${parentPath}/${t.id}`,
    thread: { id: t.id, lastAct: t.lastAct },
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
    name: s.name,
    spaceId: `stamper:${s.beingId}`,
    type: "stamper",
    synthetic: true,
    coord: null,
    model: null,
    path:
      parentPath === "/"
        ? `/${encodeURIComponent(s.name)}`
        : `${parentPath}/${encodeURIComponent(s.name)}`,
    stamper: {
      beingId: s.beingId,
      lastAct: s.lastAct,
      actCount: s.actCount,
      histories: s.histories,
    },
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
    name: `${r.kind}:${r.id.slice(0, 8)}`,
    spaceId: `reel:${r.history}:${r.kind}:${r.id}`,
    type: "reel",
    synthetic: true,
    path: `/.reel/${r.kind}/${r.id}`,
    reel: {
      kind: r.kind,
      id: r.id,
      history: r.history,
      headSeq: r.headSeq,
      headHash8: r.headHash8,
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
async function mattersAt(
  spaceId,
  { until = null, history, spaceRender = null } = {},
) {
  if (!spaceId) return [];
  let rows = await listMattersAt(spaceId, { history });
  let folded = await Promise.all(
    rows.map((m) => foldRead("matter", m.matterId, until, history)),
  );
  // Historical SEE: a null fold means this matter had NO facts at or
  // before `until` — it did not exist yet at that moment. Falling back
  // to the live row would haunt the rewound scene with future matter,
  // so it drops instead. (The converse gap — matter ENDED since the
  // rewind point is absent from the live list and can't reappear —
  // needs historical row discovery from facts; documented, unbuilt.)
  if (until) {
    const keep = rows.map((_, i) => !!folded[i]);
    rows = rows.filter((_, i) => keep[i]);
    folded = folded.filter((_, i) => keep[i]);
  }
  const { getMatterType } = await import("../materials/matter/types.js");
  const { getWordSync } = await import("../present/word/wordStore.js");

  // The matter's actions menu: the registered type advertises its DO
  // ops; each resolves through the operation registry for label +
  // args so the portal renders forms generically (mirrors the
  // being-actions block built from canBe).
  const buildMatterActions = (typeName) => {
    const typeDef = getMatterType(typeName || "generic");
    if (!typeDef || !typeDef.ops?.length) return [];
    const actions = [];
    for (const opName of typeDef.ops) {
      const op = getWordSync(opName);
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
    const isCas = !!(
      content &&
      typeof content === "object" &&
      content.kind === "cas"
    );
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
        : isLegacyText
          ? content.slice(0, 400)
          : null,
      previewBytes: isCas
        ? content.preview
          ? Buffer.byteLength(content.preview, "utf8")
          : 0
        : isLegacyText
          ? Buffer.byteLength(content, "utf8")
          : 0,
      totalBytes: isCas
        ? (content.size ?? 0)
        : isLegacyText
          ? Buffer.byteLength(content, "utf8")
          : 0,
      mimeType: isCas
        ? content.mimeType || null
        : content && typeof content === "object"
          ? content.contentType || null
          : null,
      // The transport hint for fetching the bytes. The HASH is the
      // protocol-level identity; the URL is today's byte carrier.
      // http matter points straight at its external URL — the
      // portal embeds/links it (render.mode says which).
      contentUrl: isCas
        ? !content.purged
          ? `/api/v1/content/${content.hash}`
          : null
        : content &&
            typeof content === "object" &&
            typeof content.url === "string"
          ? content.url
          : null,
      // External reference shapes (web / cross-story) are small
      // structured pointers, not bytes — surface them whole so the
      // portal gets videoId / title / matterRef without a second
      // round-trip. CAS bytes never ride the descriptor.
      external:
        !isCas && content && typeof content === "object" ? content : null,
      purged: isCas ? content.purged === true : false,
      render: typeDef?.render || null,
      // This matter's 3D body, resolution order: the per-matter
      // override (set-model by the author) wins; then the containing
      // space's per-type default (set-model {forMatterType} on the
      // space — "all notes here look like this"); then, for matter
      // whose CONTENT IS a model (type render mode "model" — the
      // /skins catalog rows), the matter displays AS its own glb; then
      // the type's extension default (render.model on the type def).
      model:
        qualities?.render?.model ||
        spaceRender?.matterModels?.[type] ||
        (typeDef?.render?.mode === "model" && isCas && !content.purged
          ? {
              matterId: m.matterId,
              hash: content.hash,
              url: `/api/v1/content/${content.hash}`,
              name: f.name ?? m.name ?? content.name ?? null,
            }
          : null) ||
        typeDef?.render?.model ||
        null,
      actions: buildMatterActions(type),
      byBeingId: f.beingId ?? m.beingId,
      qualities,
    };
  });
}

// Being-tree children of a being. Used by the descriptor's
// `beingLineage` field on stance addresses (<story>/<path>@<name>).
// Each entry carries enough for the portal to render an "inhabit"
// affordance: name, beingId, cognition, defaultAble. Cap at 200 to
// stay bounded for prolific parents; deeper inspection happens via
// dedicated SEE on each child stance.
async function listBeingChildren(
  parentBeingId,
  { until = null, history } = {},
) {
  if (!parentBeingId) return [];
  const { beingCognition } =
    await import("../materials/being/identity/lookups.js");
  const rows = await Being.find({ parentBeingId: String(parentBeingId) })
    .select("_id name defaultAble homeSpace qualities createdAt")
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  // Live path: project from the rows as-is.
  if (!until) {
    return rows.map((b) => ({
      beingId: String(b._id),
      name: b.name || null,
      defaultAble: b.defaultAble || null,
      cognition: beingCognition(b),
      homeSpace: b.homeSpace ? String(b.homeSpace) : null,
      createdAt: b.createdAt || null,
    }));
  }

  // Historical path: fold each child to `until`. Children born AFTER
  // the queried point have no facts at or before it; foldRead returns
  // null and we filter those out — they "weren't here yet."
  const folded = await Promise.all(
    rows.map((b) => foldRead("being", String(b._id), until, history)),
  );
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const f = folded[i];
    if (!f) continue;
    out.push({
      beingId: String(rows[i]._id),
      name: f.name || rows[i].name || null,
      defaultAble: f.defaultAble || rows[i].defaultAble || null,
      cognition: beingCognition(f),
      homeSpace: f.homeSpace ? String(f.homeSpace) : null,
      createdAt: rows[i].createdAt || null,
    });
  }
  return out;
}

// Top-down breadcrumb chain: place root + each named segment up to but
// not including the leaf.
function buildLineage(resolved) {
  const storyDomain = getStoryDomain();
  const lineage = [{ path: "/", name: storyDomain, spaceId: null }];
  let prefix = "";
  for (let i = 0; i < resolved.chain.length - 1; i++) {
    const seg = resolved.chain[i];
    prefix += "/" + seg.name;
    lineage.push({ path: prefix, name: seg.name, spaceId: seg.id });
  }
  return lineage;
}

// Build the `actions[]` block for one being. Reads the able's `canBe`
// license, cross-references the seed's static BE_OPS table, and
// returns `[{verb, action, label, description, args, bootstrap}, ...]`
// . the wire shape the portal's actionRenderer consumes to render a
// generic menu + form for each action.
//
// For cherub specifically, the identity-state filter trims the list:
// authenticated callers don't see birth/connect; unauthenticated
// callers don't see release. Portal stays state-blind.
//
// canDo / canSee / canCall are not surfaced as actions today . they
// describe what an LLM-driven able is licensed to dispatch via the
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
    const opName =
      typeof entry === "string" ? entry : entry?.action || entry?.name || null;
    if (!opName) continue;
    const op = BE_OPS[opName];
    if (!op) continue;
    // Cherub is the identity gate — its action surface depends on who's
    // at the gate. Anonymous (arrival) sees register + login; signed-in
    // users see logout. Other beings' canBe lists pass through unfiltered.
    if (beingName === "cherub") {
      const isAcquireOp = opName === "birth" || opName === "connect";
      const isHeldOp = opName === "release";
      if (isAcquireOp && !isAnonymous) continue;
      if (isHeldOp && isAnonymous) continue;
    }
    // Reshape per-being. Cherub's BE_OPS labels are arrival-flow-
    // centric ("Register", "Log in"); for other beings the same op
    // means something else (a parent birthing a child, a session-
    // already-authenticated user releasing). Adjust label + args so
    // the portal renders meaningful copy.
    let label = op.label || opName;
    let description = op.description || "";
    let args = op.args || {};
    if (beingName !== "cherub" && opName === "birth") {
      label = "Mint child";
      description =
        "Birth a new being from yourself. The child's parent is you.";
      // Populate the able dropdown from the live registry so the
      // operator sees every able currently available (seed, extension,
      // and operator-authored "live" entries). Non-human cognition
      // requires a able — surfacing the list inline removes the
      // typo-prone free-text input.
      const ableNames = listAbles().slice().sort();
      args = {
        name: { type: "text", label: "Child name", required: true },
        cognition: {
          type: "select",
          label: "Cognition",
          enum: ["llm", "scripted", "human"],
          required: false,
          default: "llm",
        },
        able: {
          type: "select",
          label: "Default able (fallback when no flow clause matches)",
          enum: ableNames,
          required: true,
          default: ableNames.includes("human") ? "human" : ableNames[0] || "",
        },
        // Optional birth-time flow. Operators paste a JSON array
        // of clauses; be.js parses and the spec lands at
        // qualities.flow on the new being. Empty = use defaultAble
        // unconditionally (no flow program).
        flow: {
          type: "multiline",
          label: "Initial able flow (JSON array of clauses, optional)",
          required: false,
          description:
            '[{ "when": {...}, "able": "foo" }, { "stack": true, "when": {...}, "able": "bar" }]',
        },
      };
    }
    out.push({
      verb: "be",
      action: opName,
      label,
      description,
      args,
      bootstrap: op.bootstrap === true,
    });
  }
  return out;
}

// Attach the registered able's wire fields, the per-being inbox, the
// active Act's activity, and the being's own qualities to each
// entry produced by beingsAtSpace.
async function enrichBeings(spaceId, entries, opts = {}) {
  // Defensive fallback: callers from buildPlaceDescriptor pass
  // the resolved history. When called directly without one, resolve
  // the operator's `#main` pointer rather than literal "0".
  const { getDefaultHistory } =
    await import("../materials/history/historyRegistry.js");
  const history = opts.history || (await getDefaultHistory());
  const identity = opts.identity || null;
  const until = opts.until || null;
  // The inbox + open/sealed-Act helpers are live-only projections
  // today. For historical SEE we surface empty inbox / null activity
  // rather than misleading current-state data — a past view shouldn't
  // claim "this being is currently talking to X" when the asker is
  // looking at a snapshot of last week. Inbox-at-time is a future
  // slice; flagging here so the limitation surfaces honestly.
  const inboxByBeing = until ? {} : await getInboxSummary(spaceId, { history });

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
    beingIds.map((id) => foldRead("being", id, until, history)),
  );
  // Historical SEE: a being whose reel had no facts at or before
  // `until` did not exist yet at that moment — drop its entry rather
  // than render a future being into the rewound room. (Same rule as
  // mattersAt/childrenOf. Entries without a _beingId — registered
  // names that never resolved — keep their live behavior.)
  if (until) {
    const existedAt = new Set(
      beingIds.filter((id, i) => !!foldedBeings[i]).map(String),
    );
    entries = entries.filter(
      (e) => !e._beingId || existedAt.has(String(e._beingId)),
    );
  }
  // Pair folded states with their being ids by index (foldRead may
  // return a state without _id when historical). We track ids
  // explicitly so historical fold results map back to the right row.
  const idsAndFolded = beingIds.map((id, i) => ({
    id,
    folded: foldedBeings[i],
  }));
  const qualitiesByBeing = new Map(
    idsAndFolded
      .filter(({ folded }) => folded)
      .map(({ id, folded }) => [
        String(id),
        serializeQualities(folded.qualities),
      ]),
  );
  const coordByBeing = new Map(
    idsAndFolded
      .filter(({ folded }) => folded)
      .map(({ id, folded }) => [String(id), folded.coord || null]),
  );

  const activities = await Promise.all(
    entries.map(async (e) => {
      if (!e._beingId) return null;
      if (until) return null; // historical: see comment on inboxByBeing
      const open = await findOpenForBeing(e._beingId);
      if (open) return callToActivity(open, { history });
      // No Act in flight. Fall back to what this being last SAID so
      // the speech bubble persists between moments. Without this the
      // bubble vanishes the instant a moment seals.
      const sealed = await findLastSealedForBeing(e._beingId);
      return callToActivity(sealed, { sealed: true, history });
    }),
  );

  return entries.map((entry, i) => {
    const def = getAble(entry.being);
    const inboxKey = entry._beingId ? String(entry._beingId) : null;
    const inb = (inboxKey && inboxByBeing[inboxKey]) || {
      total: 0,
      unconsumed: 0,
      recent: [],
      activeFrom: null,
      pendingFrom: [],
      queueDepth: 0,
    };
    const { _beingId, ...wireEntry } = entry;
    return {
      ...wireEntry,
      // Surface the being's id on the wire. Clients (explorers, link
      // builders) need it to address `.reel/being/<id>` / `.acts/<id>`.
      beingId: inboxKey,
      permissions: def ? def.permissions : null,
      respondMode: def ? def.respondMode : null,
      triggerOn: def ? def.triggerOn : null,
      // canCall entries — both sides of the summon edge. Entries
      // discriminate via `as: "actor"|"receiver"` (default "actor").
      // UI discovery filters `as:"receiver"` to render per-being
      // accept options (e.g. birther's "mate" button); auth filters
      // `as:"actor"` on the caller's able. See seed/AblesAreAuth.md
      // + protocols/ibp/FEDERATION.md.
      canCall: def?.canCall || null,
      // Per-being action surface. The portal renders this generically
      // as a menu + arg-schema form; one entry per BE op the able is
      // licensed for, filtered by identity state (cherub-only today).
      actions: buildActions(entry.being, def, identity),
      // Delegate-as-catalog: a delegate publishes the registry-shaped
      // data it mediates as part of its own descriptor entry. Askers
      // who can SEE the delegate (which is liberal — beings list at the
      // place root) get the catalog through this surface without ever
      // reading the heaven-gated mirror spaces directly. able-manager
      // publishes ables/tools/operations/be-ops; future delegates that
      // gate other registries follow the same shape.
      catalogs: buildCatalogs(entry.being),
      inbox: inb,
      activity: activities[i],
      busy: inb.activeFrom !== null,
      talkingTo: inb.activeFrom,
      queueDepth: inb.queueDepth,
      pendingFrom: inb.pendingFrom,
      coord: (inboxKey && coordByBeing.get(inboxKey)) || null,
      // The being's 3D body — a model matter block written by
      // set-model ({ matterId, hash, url, name }; bytes load from
      // /api/v1/content/<hash>). Null = portal default for the able.
      model:
        (inboxKey && qualitiesByBeing.get(inboxKey)?.render?.model) || null,
      qualities: (inboxKey && qualitiesByBeing.get(inboxKey)) || {},
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
  if (beingName === "able-manager") return buildAbleManagerCatalogs();
  return null;
}

function buildAbleManagerCatalogs() {
  return {
    ables: catalogAbles(),
    addresses: catalogAddresses(),
    operations: catalogOperations(),
    beOps: catalogBeOps(),
  };
}

function catalogAbles() {
  return listAbles()
    .slice()
    .sort()
    .map((name) => {
      const r = getAble(name);
      return {
        name,
        origin: r?.origin || null,
        requiredCognition: r?.requiredCognition || null,
        permissions: Array.isArray(r?.permissions) ? r.permissions : [],
      };
    });
}

// canSee on a able names IBP addresses (paths the LLM may read via the
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
  "./ables",
  "./operations",
  "./source",
  "./threads",
];
function catalogAddresses() {
  return SUGGESTED_ADDRESSES.map((path) => ({ name: path }));
}

function catalogOperations() {
  return listFoldedOps()
    .map((op) => ({
      name: op.name,
      targets: op.targets,
      factAction: op.factAction,
      ownerExtension: op.ownerExtension,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function catalogBeOps() {
  return listBeOpNames()
    .sort()
    .map((name) => {
      const op = getBeOp(name);
      return {
        name,
        label: op?.label || null,
        description: op?.description || null,
      };
    });
}

// ── Wire-shape helpers ──

async function identityBlock(identity, { until = null, history } = {}) {
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
  let position = null;
  let coord = null;
  let homeSpace = null;
  // Stale = the JWT names a being that no longer exists in the
  // substrate (operator dropped the DB, ended the being, etc.). The
  // portal reads this flag to drop the cached session and reconnect
  // anonymously, so the user doesn't sit logged in as a ghost and
  // hit BEING_NOT_FOUND on every action.
  let stale = false;
  // Secondary-unlock latch (signingSession.js): true/false for humans,
  // null for everyone else (scripted/LLM beings are never gated). The
  // portal paints the lock indicator from this.
  let signingUnlocked = null;
  if (identity.beingId) {
    try {
      if (until) {
        const folded = await foldRead(
          "being",
          identity.beingId,
          until,
          history,
        );
        if (folded) {
          position = folded.position ? String(folded.position) : null;
          homeSpace = folded.homeSpace ? String(folded.homeSpace) : null;
          const coordQ = folded.qualities?.coord;
          coord = coordQ || folded.coord || null;
        }
      } else {
        // loadOrFold (not loadProjection): a freshly-registered being
        // (cherub.birth that JUST sealed) may not have its projection
        // slot materialized yet, AND on any non-main history the slot
        // doesn't exist until the lineage walk cold-folds it. Bare
        // loadProjection returns null in both cases . the portal then
        // sees identity.position = null, can't compute a landing
        // address, and falls back to `<story>/@<name>` which the
        // resolver lands at the place root. The user's being IS at
        // their home with its bigger grid; the portal renders the
        // place root with its smaller grid; the being-mesh spawns
        // outside the visible area. loadOrFold walks the lineage so
        // the slot resolves the same way it does once steady-state
        // catches up.
        const { loadOrFold } = await import("../materials/projections.js");
        const slot = await loadOrFold("being", identity.beingId, history);
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
        position = slot?.position
          ? String(slot.position)
          : slot?.state?.position || null;
        homeSpace = slot?.state?.homeSpace || null;
        const quals = slot?.state?.qualities;
        const coordQ = quals instanceof Map ? quals.get("coord") : quals?.coord;
        coord = coordQ || slot?.state?.coord || null;
        // Cognition lives at qualities.cognition.defaultKind.
        const cog =
          quals instanceof Map ? quals.get("cognition") : quals?.cognition;
        if (cog?.defaultKind === "human") {
          const { isSigningUnlocked } =
            await import("../materials/name/signingSession.js");
          // The signing session is keyed by NAMEID (the Name's key is what
          // signs), not beingId — a being's _id is a content hash post-split.
          // Read the viewer's name; absent name => not unlocked.
          signingUnlocked = identity.nameId
            ? isSigningUnlocked(String(identity.nameId))
            : false;
        }
        // Visibility for the "freshly-registered being lands off-grid"
        // class of bugs. When the slot resolved but position is null,
        // something upstream (the be:birth reducer, the post-seal
        // fold, the lineage walk on a non-main history) failed to
        // populate it. Without this warn the portal silently falls
        // back to homeSpace and the user never gets a signal that
        // anything went wrong — the deeper bug stays hidden.
        if (slot && !position) {
          log.warn(
            "Descriptor",
            `identity.position resolved null for being=${String(identity.beingId).slice(0, 8)} ` +
              `on history ${history} (slot=${slot?.state ? "present" : "missing"}, ` +
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
    name: identity.name,
    position,
    // homeSpace exposed so the portal can fall back to "/<homeSpace>"
    // when position is null (freshly-registered being whose slot
    // hasn't materialized yet, slow cold-fold, etc.). Without this
    // the portal's only fallback was `<story>/@<name>` which
    // resolves to the story root — and the being's home-grid coord
    // then renders far outside the much larger root grid.
    homeSpace,
    coord,
    stale,
    signingUnlocked,
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
