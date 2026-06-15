// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// canSeeResolver.js . resolve a role's canSee list into the structured
// blocks the inner face carries this moment.
//
// canSee is the unified declaration of a being's perception this
// moment. Each entry is either:
//
//   . an IBP address string . preloaded by calling seeVerb on that
//                              address; the position descriptor
//                              becomes a face block.
//   . a registered see name . preloaded by calling the named
//                              seeResolver function; the structured
//                              return becomes a face block.
//
// Either shape produces a structured block of the form
//   { key, source: "address"|"see", label, payload }
// where payload is the raw structured return (object or string). Per-
// soul reformatting (LLM prompt prose, scripted-role data dispatch,
// human portal panels) happens at the presentation layer, not here.
//
// Address classification. Anything starting with ".", "/", or "<"
// is an address; everything else is a see name. The leading "." is
// heaven shorthand (`.config` becomes `<reality>/./config`); "./" is the
// explicit child form (`./config` becomes `<reality>/./config`); "<" is
// a fully-qualified address (`<reality>/...`); "/" is a tree path
// from the reality root.
//
// Failures are logged and dropped from the face. A missing see
// resolver or a failing address fetch never blocks the moment . the
// being just does not see that block.
//
// Lives in beats/2-fold/ (not under cognition/llm/) because canSee
// resolution is part of the fold beat per philosophy/names/innerFace.md.
// All three souls share the same resolved blocks; only the formatting
// differs.
//
// weave capture. resolveCanSee returns { blocks, weave } where
// weave is the array of reels the resolver actually read during
// resolution. Each address resolve and named-see handler contributes
// its reel reads; the foldPlace gate merges this with its own
// occupant-fold weave via buildInnerFace.

import log from "../../../seedReality/log.js";
import { getSeeOperation } from "../../../ibp/seeOps.js";
import { seeVerb } from "../../../ibp/verbs/see.js";
import { getRealityDomain } from "../../../ibp/address.js";
import { emptyWeave, addReel } from "./weave.js";

/**
 * Resolve canSee entries into structured face blocks and the weave
 * the resolver touched.
 *
 * @param {Array<string>} entries . role.canSee values
 * @param {object} ctx             . moment ctx (carries being, position, branch, ...)
 * @returns {Promise<{ blocks: Array<{key:string, source:string, label:string, payload:any}>, weave: Array }>}
 */
export async function resolveCanSee(entries, ctx) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { blocks: [], weave: emptyWeave() };
  }
  const weave = emptyWeave();
  const results = await Promise.all(
    entries.map((entry) => resolveOne(entry, ctx, weave)),
  );
  const blocks = results.filter(Boolean);
  return { blocks, weave };
}

async function resolveOne(entry, ctx, weave) {
  if (typeof entry !== "string" || entry.length === 0) {
    return null;
  }
  if (isAddressShape(entry)) {
    return resolveAddress(entry, ctx, weave);
  }
  return resolveNamedSee(entry, ctx, weave);
}

function isAddressShape(s) {
  return s.startsWith(".") || s.startsWith("/") || s.startsWith("<");
}

async function resolveAddress(entry, ctx, weave) {
  const beingId = ctx?.being?._id ? String(ctx.being._id) : null;
  const branch = typeof ctx?.branch === "string" && ctx.branch.length ? ctx.branch : "0";
  const address = expandAddress(entry);
  try {
    const descriptor = await seeVerb(address, {
      identity: beingId
        ? { beingId, name: ctx?.being?.name || null }
        : null,
    });
    if (descriptor == null) return null;
    // Capture the reels this address landed on. The descriptor's
    // address block tells us the resolved spaceId and (if any) the
    // qualifier being; both are reads the fold made on the caller's
    // behalf and must be in the weave so a fact on either reel
    // wakes a subscriber.
    recordDescriptorReels(descriptor, branch, weave);
    const label = labelForAddress(entry);
    return {
      key:     entry,
      source:  "address",
      label,
      payload: descriptor,
    };
  } catch (err) {
    log.warn(
      "CanSeeResolver",
      `address "${entry}" SEE failed: ${err.code || err.message}`,
    );
    return null;
  }
}

// Pull the reels a position descriptor admitted into its view. Walks
// the descriptor's structural fields: address.spaceId (the leaf space),
// address.being (the stance qualifier), beings[] (occupants the
// descriptor surfaced), matters[] (matter at the position the
// descriptor surfaced). Each is a reel a fact could land on that
// would change what this block shows. Best-effort: a malformed
// descriptor just drops out.
function recordDescriptorReels(descriptor, branch, weave) {
  if (!descriptor || typeof descriptor !== "object") return;
  const addr = descriptor.address;
  if (addr && typeof addr === "object") {
    if (addr.spaceId) {
      addReel(weave, { reelKind: "space", reelId: String(addr.spaceId), branch });
    }
    if (addr.being && typeof addr.being === "object" && addr.being.id) {
      addReel(weave, { reelKind: "being", reelId: String(addr.being.id), branch });
    }
  }
  if (Array.isArray(descriptor.beings)) {
    for (const b of descriptor.beings) {
      const id = b?.beingId || b?._id || b?.id;
      if (id) addReel(weave, { reelKind: "being", reelId: String(id), branch });
    }
  }
  if (Array.isArray(descriptor.matters)) {
    for (const m of descriptor.matters) {
      const id = m?.matterId || m?._id || m?.id;
      if (id) addReel(weave, { reelKind: "matter", reelId: String(id), branch });
    }
  }
}

// Heaven shorthand. Bare "." . heaven itself. ".X" with no slash .
// heaven child X. "./X" . heaven child X. Other leading-"." shapes
// pass through to seeVerb's address grammar.
function expandAddress(entry) {
  if (entry === ".") return `${getRealityDomain()}/.`;
  if (entry.startsWith("./")) return `${getRealityDomain()}/${entry}`;
  if (entry.startsWith(".") && entry[1] !== ".") {
    return `${getRealityDomain()}/./${entry.slice(1)}`;
  }
  return entry;
}

function labelForAddress(entry) {
  if (entry === ".") return "place";
  if (entry.startsWith("./")) return entry.slice(2);
  if (entry.startsWith(".") && entry[1] !== ".") return entry.slice(1);
  return entry;
}

async function resolveNamedSee(name, ctx, weave) {
  const op = getSeeOperation(name);
  if (!op) {
    log.warn("CanSeeResolver", `unknown see "${name}"; skipping`);
    return null;
  }
  try {
    const beingId = ctx?.being?._id ? String(ctx.being._id) : null;
    const branch = typeof ctx?.branch === "string" && ctx.branch.length ? ctx.branch : "0";
    const identity = beingId
      ? { beingId, name: ctx?.being?.name || null }
      : null;
    const out = await op.handler({ identity, args: {}, ctx, branch });
    if (out == null) return null;
    // Handlers may return either bare payload OR a structured
    // `{ payload, reels }` envelope. The envelope lets see-op authors
    // declare reels they read that aren't structurally visible on the
    // payload itself (a status counter, a registry hit, etc.). When
    // the payload IS a descriptor (has address / beings / matters),
    // the descriptor's own structural reels are picked up
    // automatically below by recordDescriptorReels, so most handlers
    // don't need the envelope at all.
    let payload = out;
    let reels = null;
    if (typeof out === "object" && !Array.isArray(out) && Object.prototype.hasOwnProperty.call(out, "payload")) {
      payload = out.payload;
      if (Array.isArray(out.reels)) reels = out.reels;
    }
    if (Array.isArray(reels)) {
      for (const reel of reels) {
        if (!reel || typeof reel !== "object") continue;
        addReel(weave, {
          reelKind: reel.reelKind || reel.kind,
          reelId:   reel.reelId   || reel.id,
          branch:   typeof reel.branch === "string" && reel.branch.length ? reel.branch : branch,
        });
      }
    }
    // Descriptor-shaped payload: pick up its structural reels
    // automatically. This is the load-bearing path for `place`,
    // `arrival-view`, and any other named-see op that returns a
    // position descriptor.
    if (payload && typeof payload === "object" && (payload.address || Array.isArray(payload.beings) || Array.isArray(payload.matters))) {
      recordDescriptorReels(payload, branch, weave);
    }
    if (payload == null) return null;
    if (typeof payload === "string") {
      if (payload.length === 0) return null;
      return {
        key:     name,
        source:  "see",
        label:   labelForSeeName(name),
        payload,
      };
    }
    if (typeof payload !== "object") return null;
    return {
      key:     name,
      source:  "see",
      label:   labelForSeeName(name),
      payload,
    };
  } catch (err) {
    log.warn("CanSeeResolver", `see "${name}" failed: ${err.message}`);
    return null;
  }
}

function labelForSeeName(name) {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
}

/**
 * Test whether a role's canSee declaration would admit a given reel
 * target. Used by foldPlace to gate occupant folds BEFORE folding so
 * the weave stays the residue of canSee (we never read reels we are
 * going to drop). The predicate matches the same shape the resolver
 * matches:
 *
 *   . address entries admit a reel when its (kind, id, branch) matches
 *     the address's resolved spaceId / being qualifier.
 *   . named-see entries admit reels declared by the op's handler at
 *     resolution time; pre-fold we cannot resolve names cheaply, so a
 *     non-empty named-see entry conservatively admits everything (the
 *     gate is the resolver's reel-list when it runs).
 *   . empty canSee admits nothing (caller still folds self + role
 *     reel for the empty-canSee invariant; that's a buildInnerFace
 *     concern, not a gate concern).
 *
 * Permissive on uncertainty: when in doubt, ADMIT. The fold is the
 * source of truth; over-folding wastes work but never makes the face
 * lie. Under-folding (false-deny) would hide reality from a role that
 * declared it could see.
 *
 * @param {Array<string>} roleCanSee . role.canSee declaration
 * @param {{ type?: string, kind?: string, id: string|number, name?: string }} target
 * @returns {boolean}
 */
export function canSeeAdmitsReel(roleCanSee, target) {
  if (!target) return false;
  const kind = target.kind || target.type || null;
  const id   = target.id != null ? String(target.id) : null;
  if (!kind || !id) return false;
  if (!Array.isArray(roleCanSee) || roleCanSee.length === 0) return false;
  for (const entry of roleCanSee) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (!isAddressShape(entry)) {
      // Named see. Conservative admit. The resolver will record the
      // actual reels at run time; the gate stays open here so we do
      // not under-fold.
      return true;
    }
    // Address-shape entry. A bare "." (heaven place) admits the
    // current place's reels; richer matching would require resolving
    // the address here, which is expensive. Permissive: admit any
    // address-shape entry. If a role declares an address it cannot
    // see (a deny upstream), the SEE call's authorize layer will
    // refuse and the resolver drops the block.
    return true;
  }
  return false;
}
