// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ableAuth.js — the able-walk authorize.
//
// Per seed/AblesAreAuth.md "Final doctrine": every able-in-effect
// lives on a space's `qualities.ables[<name>]`. A being's grants
// (in qualities.ablesGranted) reference the able by name + the
// anchor space where it was hosted. To check if a grant permits an
// action at a target:
//
//   1. Walk the grant's anchorSpaceId UP the qualities chain
//      looking for `qualities.ables[<name>]`. The first ancestor
//      that has it IS the able's host.
//   2. Compute the host's natural coverage (host + descendants) AND
//      apply the able's `reach` filter (additions and !-prefix
//      exclusions) to decide if the target is reachable.
//   3. If reachable, check the able's canX against the verb +
//      action/intent/operation. Match → allow.
//
// The walk:
//   - I-Am bypass (bootstrap axiom; never walks the space chain).
//   - Anonymous arrival floor (implicit arrival able on the story
//     root; canSee:* + canBe:["birth","connect","release"]).
//   - For each grant in identity.ablesGranted: getAbleSpec → reach
//     check → canX check → first match wins.
//
// Pattern matching: small grammar.
//   - <exact-path>      — match by exact pathByNames (when known)
//   - <spaceId>         — match by exact space id
//   - prefix/**         — any descendant (any depth)
//   - prefix/*          — direct children only
//   - **                — wildcard (everything)
//   - !<pattern>        — exclude (carve out from the default base)
//
// Default base coverage for a able hosted at H: every target at or
// below H. The `reach` list adjusts the base in order; later entries
// win on conflict.

import { I } from "../materials/being/seedBeings.js";
import { loadOrFold } from "../materials/projections.js";
import { getSpaceRootId } from "../sprout.js";
import { getAncestorChain } from "../materials/space/ancestorCache.js";
import {
  getAbleSpecForGrant,
  ableReachesTarget as reachCovers,
} from "../present/ables/spaceLookup.js";
import { listFoldedProhibitions } from "../present/word/wordStore.js";

const ARRIVAL_ABLE = "arrival";

// Segment a token the SAME way applyProhibitionLaw stored it (wordStore.js _prohibSeg): lowercase,
// non-alphanumeric runs → "-", trimmed. So a request able/verb/action compares like-for-like
// against a folded cannot, whether the law named "set-being" or "Set Being".
const _seg = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Walk the caller's granted ables against the target/verb/action and
 * return ok:true on the first match.
 *
 * @param {object} args
 * @param {object} args.identity        { beingId, name } | null
 * @param {string} args.verb            "see" | "do" | "summon" | "be"
 * @param {object} args.target          { kind, id, path?, being? }
 * @param {string} [args.action]        DO action name
 * @param {string} [args.intent]        SUMMON intent
 * @param {string} [args.operation]     BE operation
 * @param {string} [args.seeOp]         SEE op name (when target is a SEE op call)
 * @param {string} [args.history]       history (defaults to "0")
 * @returns {Promise<{ok: boolean, able?: string, anchor?: string, reason?: string}>}
 */
export async function authorizeViaAbles(args) {
  const { identity, verb, target, action, intent, operation, seeOp, history } =
    args || {};
  if (typeof history !== "string" || !history.length) {
    throw new Error(
      "authorizeViaAbles requires `history` as a non-empty string. " +
        "Callers must pass moment.actorAct?.history (or '0' for genesis / pre-summon paths) " +
        "explicitly; no silent default.",
    );
  }
  // actorHistory = the actor's history (their session.currentHistory
  // or homeHistory). Where their grants actually live. history (= target's
  // history) is used for able spec lookups and reach evaluation; actor's
  // grants are loaded from actorHistory so a being seated on #0 can SEE
  // onto history #1 without needing to exist on #1 (the "look through
  // the portal" semantic). Defaults to history when caller didn't
  // distinguish.
  const actorHistory = args.actorHistory || history;

  // ── PROHIBITION-WINS (rule 14: a cannot beats a can) — STRICTLY ADDITIVE ──────────────
  //
  // BEFORE the positive able-walk, consult the OBJECTIVE prohibition register (the FOLD of every
  // `cannot` law, listFoldedProhibitions). If a folded cannot covers one of the ACTOR's ables for
  // the requested {verb, action/seeOp/operation/intent}, the action is forbidden by LAW regardless
  // of any grant — a cannot beats a can.
  //
  // CRITICAL INVARIANT: this is purely ADDITIVE. It may ONLY turn an ok:true into ok:false, NEVER
  // the reverse, and when no folded cannot matches it is a PURE NO-OP (zero behavior change vs the
  // pre-law gate). prohibitedByLaw short-circuits the instant the register is empty (the common
  // case — no chain read, no grant load), and only ever RETURNS prohibited; it never grants. The
  // read is computed-on-read off the live projection (sync), so the gate stays pure + replayable.
  const blocked = await prohibitedByLaw({
    identity,
    verb,
    action,
    intent,
    operation,
    seeOp,
    history,
    actorHistory,
  });
  if (blocked) {
    return { ok: false, reason: "prohibited by law" };
  }

  // Bootstrap axiom.
  if (identity?.beingId === I || identity?.name === I) {
    return { ok: true, able: "i-am", anchor: null };
  }

  // Anonymous arrival floor. Stateless callers run under the implicit
  // arrival able (looked up at the story root's qualities.ables or
  // — if not yet installed there — the in-memory REGISTRY).
  if (!identity?.beingId) {
    return await checkArrivalFloor({
      verb,
      target,
      action,
      intent,
      operation,
      seeOp,
      history,
    });
  }

  // Ownership step (seed/AblesAreAuth.md "Nearest claim wins").
  // Walk target's ancestors looking for the NEAREST space with a
  // non-empty members.owner — that's the space's "claim." Two cases:
  //
  //   1. Actor in the claim's owners → ALLOW (private ownership).
  //   2. Someone else's claim → fall through to the able-walk; actor
  //      might still have a granted able reaching here.
  //
  // Nearest-claim-wins means a private sub-space inside a public-owned
  // commons IS private (the inner owner "takes over"). Without this
  // rule, ownership inheritance would leak through any sub-space, and
  // staking a private claim inside a commons would be impossible.
  //
  // Owner is the ONE base-axiom membership class. All other authority
  // shapes live in the able registry — operators model "secondary
  // owners" as ables with the right canDo (set-able, grant-able,
  // create-space, etc.). Custom members.<class> entries are
  // operator-authored bookkeeping and do NOT gate authorize.
  //
  // @public's spaces are NOT special at this layer. A public-owned
  // space is just a space whose owner happens to be @public. Public's
  // ables set acquisition.autoOnEntry=true so a visitor may self-take
  // them on entry (read the policy + take-able); once taken, the grant
  // rides in qualities.ablesGranted and the able-walk picks it up
  // uniformly. No "public-commons" branch lives in this file. (The old
  // "SEE silently grants on first see" mechanism was removed — a space
  // is a noun and can't act on a being.)
  const targetSpaceForOwner = deriveSpaceId(target);
  if (targetSpaceForOwner) {
    const claim = await findNearestOwnedAncestor(
      String(targetSpaceForOwner),
      history,
    );
    if (claim) {
      const actorIdStr = String(identity.beingId);
      if (claim.ownerIds.some((id) => String(id) === actorIdStr)) {
        return { ok: true, able: "owner", anchor: claim.spaceId };
      }
      // Else: someone else's claim. Fall through to able-walk.
    }
  }

  // Load the caller's grants from their ACTOR history (their home
  // history / session.currentHistory), NOT the target's history. A being
  // seated on #0 looking onto history #1 reads their own grants from
  // #0 (where they exist), then we evaluate reach against the target
  // on history #1. This is the "stay yourself when navigating across
  // branches" semantic — your identity travels with you; only an
  // explicit be:switch changes the history your session rides.
  const slot = await loadOrFold(
    "being",
    String(identity.beingId),
    actorHistory,
  );
  const grants = readGrantsFromSlot(slot);

  const targetPath = derivePath(target);
  const targetBeing = deriveBeingName(target);
  let targetSpace = deriveSpaceId(target);
  // Fallback: when target carries no spaceId (BE on self, SUMMON to a
  // bare stance, DO on a being-target where the verb didn't resolve
  // the auth space upstream), use the ACTOR's current position. This
  // lets ables with no explicit reach (default = host + descendants)
  // gate the action at the actor's standing space. Without this
  // fallback, BE on self always denied because reachCovers needs a
  // spaceId to evaluate "is target at or below the able's host."
  if (!targetSpace) {
    targetSpace =
      String(slot?.state?.position || slot?.state?.homeSpace || "") || null;
  }

  for (const grant of grants) {
    const { spec, hostSpaceId } = await getAbleSpecForGrant(grant, history);
    if (!spec) continue;

    if (
      !(await reachCovers(
        spec,
        hostSpaceId,
        { spaceId: targetSpace, path: targetPath },
        history,
      ))
    ) {
      continue;
    }

    if (
      !permits(spec, verb, { action, intent, operation, seeOp, targetBeing })
    ) {
      continue;
    }

    return {
      ok: true,
      able: grant.able,
      anchor: hostSpaceId || grant.anchorSpaceId || null,
    };
  }

  // Cross-story fallback. A canopy-verified foreign actor has an
  // identity (the verified beingId on their home story) but no local
  // grants here (their being row doesn't exist on this story). Fall
  // through to the arrival floor so they can at least reach what every
  // anonymous visitor can . SUMMON @cherub:mate (cross-world
  // citizenship via being), SUMMON @federation-manager (initiate a
  // negotiation), arrival-view SEE. Without this fallthrough, any
  // peer story's outbound SUMMON to @federation-manager would deny
  // because the local grants table has no record of the remote
  // federation-manager being.
  if (identity?.canopyVerifiedSender || identity?.story) {
    return await checkArrivalFloor({
      verb,
      target,
      action,
      intent,
      operation,
      seeOp,
      history,
    });
  }

  return {
    ok: false,
    reason:
      `no granted able permits ${verb}` +
      (action
        ? `:${action}`
        : operation
          ? `:${operation}`
          : intent
            ? `:${intent}`
            : "") +
      ` at this target`,
  };
}

// ────────────────────────────────────────────────────────────────────
// Prohibition register (rule 14: a cannot beats a can) — strictly additive
// ────────────────────────────────────────────────────────────────────

/**
 * Does a folded `cannot` law forbid this actor's request? Read on demand off the prohibition
 * register (listFoldedProhibitions — the FOLD of every cannot word). Returns true ONLY when a
 * law's subject-able matches one of the actor's ables AND its verb/object matches the request;
 * otherwise false. NEVER grants — the caller uses the result solely to flip an ok:true to
 * ok:false (the strictly-additive invariant). Short-circuits when the register is empty (the
 * common case: no chain read, no grant load — a pure no-op vs the pre-law gate).
 *
 * @returns {Promise<boolean>} true = forbidden by law; false = no matching cannot (no-op)
 */
async function prohibitedByLaw({
  identity,
  verb,
  action,
  intent,
  operation,
  seeOp,
  history,
  actorHistory,
}) {
  // The register IS the fold; empty → nothing to check (the overwhelming common case). This is the
  // pure-no-op fast path: no chain read, no grant load, zero behavior change vs today.
  const laws = listFoldedProhibitions();
  if (!Array.isArray(laws) || laws.length === 0) return false;

  // The OBJECT the request names within its verb (the action/seeOp/operation/intent), segmented to
  // compare against a law's stored `of`. A do names an action, a see a seeOp, a be an operation, a
  // call an intent; `null` when the request names only the bare verb.
  const reqVerb = _seg(verb);
  const reqObject = _seg(action || seeOp || operation || intent || "");

  // The actor's able names (segmented). The prohibition's subject is an able name; a law only
  // fires when it names one of THESE — that is what keeps the check additive (it can never forbid
  // an actor whose ables no law mentions). I-Am acts under "i-am"; an anonymous caller under the
  // arrival floor able; a seated being under each granted able. Loaded lazily, ONLY because a law
  // exists (the empty-register fast path already returned).
  const ableNames = await actorAbleNames(identity, history, actorHistory);
  if (ableNames.size === 0) return false;

  for (const law of laws) {
    const subject = _seg(law.subject);
    if (!ableNames.has(subject)) continue; // the law names an able this actor does not bear

    // VERB/OBJECT match. A law's `verb` is either the auth verb (see/do/call/be) OR the English
    // verb that names the forbidden action ("back" in "a member cannot back a proposal"); its `of`
    // is the further object, or null = the whole verb. So a law covers the request when:
    //   * law.verb === the request verb  AND  (law.of is null OR law.of === the request object), or
    //   * law.verb === the request object (the English-verb-as-action form; no further object).
    const lawVerb = _seg(law.verb);
    const lawOf = law.of != null ? _seg(law.of) : null;

    const coversByVerb =
      lawVerb === reqVerb && (lawOf == null || (reqObject && lawOf === reqObject));
    const coversByAction =
      lawOf == null && reqObject && lawVerb === reqObject;

    if (coversByVerb || coversByAction) return true;
  }
  return false;
}

/**
 * The set of able names (segmented) the actor bears, for the prohibition check. I-Am bears the
 * "i-am" able; an anonymous / canopy-verified-only caller bears the arrival floor able; a seated
 * being bears each able in qualities.ablesGranted. Read from the actor's OWN history (where their
 * grants live), mirroring the positive walk's grant load. Pure read (no fact). Called ONLY when a
 * prohibition law exists.
 */
async function actorAbleNames(identity, history, actorHistory) {
  const names = new Set();
  if (identity?.beingId === I || identity?.name === I) {
    names.add(_seg("i-am"));
    return names;
  }
  if (!identity?.beingId) {
    // anonymous: the implicit arrival floor able
    names.add(_seg(ARRIVAL_ABLE));
    return names;
  }
  const slot = await loadOrFold("being", String(identity.beingId), actorHistory);
  for (const grant of readGrantsFromSlot(slot)) {
    if (grant?.able) names.add(_seg(grant.able));
  }
  // A canopy-verified foreign actor (or a local being with no grants) also falls through to the
  // arrival floor in the positive walk, so include the arrival able as part of its borne set.
  if (identity?.canopyVerifiedSender || identity?.story) {
    names.add(_seg(ARRIVAL_ABLE));
  }
  return names;
}

// ────────────────────────────────────────────────────────────────────
// Ownership — nearest-claim-wins
// ────────────────────────────────────────────────────────────────────

/**
 * Walk targetSpaceId up the ancestor chain looking for the NEAREST
 * ancestor (including target) whose `owner` is set. Returns
 * { spaceId, ownerIds[] } for that ancestor, or null when no ancestor
 * on the chain has an owner.
 *
 * "Nearest claim wins" — a private sub-space inside a public-owned
 * commons claims itself, and that private claim takes precedence over
 * the inherited public ownership above. Without this rule, commons
 * inheritance would leak through into every private sub-space.
 * See seed/AblesAreAuth.md "@public being".
 */
async function findNearestOwnedAncestor(targetSpaceId, history) {
  // Self space first. loadOrFold inherits from main for histories
  // that haven't diverged this space — otherwise a history read would
  // miss the owner that was set on main.
  const self = await loadOrFold("space", targetSpaceId, history);
  const selfOwners = readOwners(self?.state);
  if (selfOwners.length > 0) {
    return { spaceId: String(targetSpaceId), ownerIds: selfOwners };
  }

  let chain = null;
  try {
    chain = await getAncestorChain(targetSpaceId, history);
  } catch {
    chain = null;
  }
  if (!Array.isArray(chain)) return null;
  for (const node of chain) {
    const slot = await loadOrFold("space", String(node._id), history);
    const owners = readOwners(slot?.state);
    if (owners.length > 0) {
      return { spaceId: String(node._id), ownerIds: owners };
    }
  }
  return null;
}

function readOwners(state) {
  if (!state) return [];
  return state.owner ? [String(state.owner)] : [];
}

// ────────────────────────────────────────────────────────────────────
// canX matching (action-only; no patterns inside canX)
// ────────────────────────────────────────────────────────────────────

function permits(
  spec,
  verb,
  { action, intent, operation, seeOp, targetBeing },
) {
  if (verb === "see") return permitsSee(spec, seeOp);
  if (verb === "do") return permitsDo(spec, action);
  if (verb === "call") return permitsCall(spec, targetBeing, intent);
  if (verb === "be") return permitsBe(spec, operation);
  return false;
}

function permitsSee(spec, seeOp) {
  if (!Array.isArray(spec.canSee) || spec.canSee.length === 0) return false;
  // canSee enumerates the SEE ops a able can dispatch. Raw-address SEE
  // requires "*" — ables with only named-op entries (arrival's
  // ["arrival-view"], global's ["place"]) refuse raw position SEE.
  // The see verb wraps this with an anonymous-redirect: when arrival
  // gets refused on raw SEE, the verb dispatches arrival-view instead.
  for (const entry of spec.canSee) {
    const name = typeof entry === "string" ? entry : entry?.name;
    if (!name) continue;
    if (name === "*") return true;
    if (seeOp && name === seeOp) return true;
  }
  return false;
}

function permitsDo(spec, action) {
  if (!action || !Array.isArray(spec.canDo)) return false;
  for (const entry of spec.canDo) {
    const a = typeof entry === "string" ? entry : entry?.action;
    if (!a) continue;
    if (a === "*") return true;
    if (a === action) return true;
    // Namespace match: action `set-being:position` matches canDo `set-being:*` or `set-being`.
    const colonIdx = action.indexOf(":");
    if (colonIdx > 0) {
      const ns = action.slice(0, colonIdx);
      if (a === ns) return true;
      if (a === `${ns}:*`) return true;
    }
    // Wildcard prefix on canDo entry: `grant-able:*` matches `grant-able:human`.
    if (a.endsWith(":*")) {
      const prefix = a.slice(0, -2);
      if (action === prefix) return true;
      if (action.startsWith(prefix + ":")) return true;
    }
  }
  return false;
}

// canCall's auth path. A able declares its summon participation —
// some entries are caller-side ("I can summon these"), some are
// receiver-side ("I accept these"). The discriminator is `as`:
//   "actor"     — caller side; this able can SEND this summon (default)
//   "receiver"  — receiver side; this able ACCEPTS this summon
//
// Authorization here checks the CALLER'S able, so only entries with
// `as: "actor"` (or absent — the legacy/default sense) count.
// Receiver-side acceptance is checked separately at the summon verb
// via `permitsReceiverSummon` below (the "other half of the post
// office check" per seed/SUMMON.md).
function permitsCall(spec, targetBeing, intent) {
  if (!Array.isArray(spec.canCall)) return false;
  for (const entry of spec.canCall) {
    if (typeof entry === "object" && entry?.as === "receiver") continue;
    const pattern = typeof entry === "string" ? entry : entry?.pattern;
    if (!pattern) continue;
    if (matchBeingNamePattern(pattern, targetBeing)) {
      if (
        !intent ||
        !entry?.intent ||
        entry.intent === "*" ||
        entry.intent === intent
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Receiver-side acceptance check. Asks the RECEIVER'S able spec
 * whether it accepts a summon with the given intent. Per seed/SUMMON.md
 * this is the second half of the post office check — the actor's
 * authorize() gates the OUTGOING side; this gates the INCOMING side.
 *
 * Progressive enhancement (the safe shape): a able with NO `as: receiver`
 * canCall entries is unrestricted and accepts any incoming summon.
 * A able with at least one `as: receiver` entry has DECLARED its
 * accepted intents; the receiver check then becomes strict — the
 * envelope intent must match an entry's intent (or wildcard "*"), or
 * the summon refuses with a "able X does not accept intent Y" reason.
 *
 * @param {object} able     receiver's able spec (from registry.getAble)
 * @param {string} intent   envelope intent (null/undefined allowed)
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function permitsReceiverSummon(able, intent) {
  if (!able || typeof able !== "object") {
    return { ok: false, reason: "receiver able missing" };
  }
  const receiverEntries = Array.isArray(able.canCall)
    ? able.canCall.filter((e) => typeof e === "object" && e?.as === "receiver")
    : [];
  if (receiverEntries.length === 0) {
    // No declared receiver entries → able accepts anything. Current
    // behavior for ables that haven't yet declared their accepted
    // intents; preserves cross-story summons and all legacy paths
    // until each able authors its receiver list.
    return { ok: true };
  }
  // Able HAS declared receiver entries → intent is required and must
  // match one of them. A summon without intent to a able with
  // declared receiver entries refuses; omitting intent can't be used
  // to bypass the receiver gate.
  if (!intent) {
    const declared = receiverEntries
      .map((e) => e?.intent || "(any)")
      .join(", ");
    return {
      ok: false,
      reason: `able "${able.name}" declares accepted intents [${declared}] but the summon carried no intent`,
    };
  }
  for (const entry of receiverEntries) {
    const want = entry?.intent;
    if (!want || want === "*" || want === intent) return { ok: true };
  }
  const declared = receiverEntries.map((e) => e?.intent || "(any)").join(", ");
  return {
    ok: false,
    reason: `able "${able.name}" does not accept intent "${intent}" (accepts: ${declared})`,
  };
}

function permitsBe(spec, operation) {
  if (!operation || !Array.isArray(spec.canBe)) return false;
  for (const entry of spec.canBe) {
    const op = typeof entry === "string" ? entry : entry?.operation;
    if (!op) continue;
    if (op === "*") return true;
    if (op === operation) return true;
  }
  return false;
}

function matchBeingNamePattern(pattern, targetBeing) {
  if (!pattern) return false;
  if (pattern === "@*" || pattern === "*") return true;
  if (!targetBeing) return false;
  const want = pattern.startsWith("@") ? pattern.slice(1) : pattern;
  if (want.endsWith("*")) {
    return String(targetBeing).startsWith(want.slice(0, -1));
  }
  return String(targetBeing) === want;
}

// ────────────────────────────────────────────────────────────────────
// Anonymous arrival floor
// ────────────────────────────────────────────────────────────────────

async function checkArrivalFloor({
  verb,
  target,
  action,
  intent,
  operation,
  seeOp,
  history,
}) {
  // The arrival able's host IS the story root. The shared lookup
  // walks anchorSpaceId=storyRoot for qualities.ables.arrival; the
  // registry fallback covers boot-order edges before install.
  const storyRootId = getSpaceRootId();
  const { spec, hostSpaceId } = await getAbleSpecForGrant(
    { able: ARRIVAL_ABLE, anchorSpaceId: storyRootId },
    history,
  );
  if (!spec) {
    return {
      ok: false,
      reason: "no arrival able registered; anonymous callers have no floor.",
    };
  }

  const targetPath = derivePath(target);
  const targetSpace = deriveSpaceId(target);
  const targetBeing = deriveBeingName(target);

  if (
    !(await reachCovers(
      spec,
      hostSpaceId,
      { spaceId: targetSpace, path: targetPath },
      history,
    ))
  ) {
    return { ok: false, reason: "arrival floor does not reach this position." };
  }
  if (permits(spec, verb, { action, intent, operation, seeOp, targetBeing })) {
    return { ok: true, able: ARRIVAL_ABLE, anchor: hostSpaceId };
  }
  return {
    ok: false,
    reason: "arrival floor does not permit this action; please authenticate.",
  };
}

// ────────────────────────────────────────────────────────────────────
// Target shape readers
// ────────────────────────────────────────────────────────────────────

function readGrantsFromSlot(slot) {
  if (!slot) return [];
  const q = slot.state?.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const arr = qualities?.ablesGranted;
  return Array.isArray(arr) ? arr : [];
}

function derivePath(target) {
  if (!target) return null;
  if (typeof target === "string") return target;
  return (
    target.path || target.address?.pathByNames || target.address?.path || null
  );
}

function deriveSpaceId(target) {
  if (!target) return null;
  if (target.kind === "space") return String(target.id);
  return target.spaceId || target.address?.spaceId || null;
}

function deriveBeingName(target) {
  if (!target) return null;
  if (target.kind === "being") return target.name || target.id || null;
  return target.being || target.beingName || target.address?.being || null;
}
