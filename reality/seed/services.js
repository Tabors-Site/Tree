// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// My public face.
//
// This file assembles the `reality` object I hand to every
// extension's `init(reality)`. Whatever I expose here is the whole
// of me an extension can reach. Services not implemented on this
// reality get no-op proxies so extension code stays safe to call.

import log from "./seedReality/log.js";
import { hooks as hooksModule } from "./hooks.js";
import Being from "./materials/being/being.js";
import Space from "./materials/space/space.js";
import Fact from "./past/fact/fact.js";
import Matter from "./materials/matter/matter.js";

import { emitFact } from "./past/fact/facts.js";
import { captureGraft } from "./materials/publish/graft.js";
import { resolveSpaceAccess } from "./materials/space/spaces.js";
import {
  birthBeing,
  verifyPassword,
  generateToken,
  isFirstBeing,
  findBeingByName,
} from "./materials/being/identity.js";

import {
  createSession,
  endSession,
  registerSession,
  touchSession,
  updateSessionMeta,
  getActiveNavigator,
  setActiveNavigator,
  clearActiveNavigator,
  getSession,
  getSessionsForBeing,
  setSessionAbort,
  abortSession,
  clearSessionAbort,
  SESSION_TYPES,
  registerSessionType,
} from "./present/session.js";

import { runLlmMoment } from "./present/cognition/llm/llmMoment.js";
import { registerFailoverResolver } from "./present/cognition/llm/call.js";
import {
  getClientForBeing,
  beingHasLlm,
} from "./present/cognition/llm/connect.js";
import {
  getRootIdFor,
  setCurrentSpace,
  getCurrentSpace,
} from "./materials/being/position.js";
import {
  registerRootSpaceLlmSlot,
  registerBeingLlmSlot,
} from "./present/cognition/llm/connect.js";
import {
  emitNavigate,
  emitToBeing,
  emitToBeingRoom,
  registerSocketHandler,
  unregisterSocketHandler,
  getIO,
  getHttpServer,
} from "./ibp/pushChannel.js";
import { ok, error, sendOk, sendError, IBP_ERR } from "./ibp/protocol.js";
import { qualities } from "./materials/qualities.js";
import { isBeingRoot, getSpaceRootId } from "./sprout.js";
import {
  createSpace,
  createSpaceBranch,
  deleteSpaceBranch,
  updateParentRelationship,
  editSpaceName,
  editSpaceType,
} from "./materials/space/spaces.js";
import {
  createMatter,
  editMatter,
  deleteMatterAndFile,
  transferMatter,
  getMatters,
} from "./materials/matter/matters.js";
import {
  isExtensionBlockedAtSpace,
  getBlockedExtensionsAtSpace,
  getExtensionAtScope,
  getToolOwner,
} from "./materials/space/extensionScope.js";
import {
  getAncestorChain,
  snapshotAncestors,
  invalidateSpace,
  invalidateAll,
  getCacheStats,
} from "./materials/space/ancestorCache.js";
import {
  checkTreeHealth,
  tripTree,
  reviveTree,
  isTreeAlive,
} from "./materials/space/spaceCircuit.js";
import {
  acquireSpaceLock,
  releaseSpaceLock,
  acquireMultiple,
  releaseMultiple,
  isSpaceLocked,
  getLockStats as getSpaceLockStats,
} from "./materials/space/spaceLocks.js";

// The declarative primitives. Re-exposed through `reality.declare` so
// extensions register roles, subscribe to events, declare wake
// cadences, and aggregate fan-out replies without importing my
// internals.
import { aggregate as ibpAggregate } from "./present/replies.js";
import {
  subscribe as ibpSubscribe,
  unsubscribe as ibpUnsubscribe,
  unsubscribeAllForBeing as ibpUnsubscribeAllForBeing,
} from "./present/wakes/subscriptions.js";
import {
  schedule as ibpSchedule,
  unschedule as ibpUnschedule,
  unscheduleAllForBeing as ibpUnscheduleAllForBeing,
  setEmitter as ibpSetScheduleEmitter,
  resetEmitter as ibpResetScheduleEmitter,
} from "./present/wakes/wakeSchedule.js";
import {
  registerRole as ibpRegisterRole,
  unregisterRole as ibpUnregisterRole,
  registerRoleHandler as ibpRegisterRoleHandler,
  unregisterRoleHandler as ibpUnregisterRoleHandler,
} from "./present/roles/registry.js";
import {
  registerSeeOperation as ibpRegisterSeeOperation,
  unregisterSeeOperation as ibpUnregisterSeeOperation,
  unregisterSeeOperationsFromExtension as ibpUnregisterSeesForExtension,
  listSeeOperations as ibpListSeeOperations,
  getSeeOperation as ibpGetSeeOperation,
} from "./ibp/seeOps.js";
import {
  registerMatterType as ibpRegisterMatterType,
  unregisterMatterType as ibpUnregisterMatterType,
  getMatterType as ibpGetMatterType,
  listMatterTypes as ibpListMatterTypes,
} from "./materials/matter/types.js";
import {
  registerInboxRenderer as ibpRegisterInboxRenderer,
  unregisterInboxRenderer as ibpUnregisterInboxRenderer,
  listInboxRenderers as ibpListInboxRenderers,
} from "./present/intake/inboxRenderers.js";

// The four-verb dispatcher. The whole of my public surface for
// operations on space, matter, and beings.
import { doVerb }     from "./ibp/verbs/do.js";
import { seeVerb }    from "./ibp/verbs/see.js";
import { callVerb } from "./ibp/verbs/call.js";
import { beVerb }     from "./ibp/verbs/be.js";
import { nameVerb }   from "./ibp/verbs/name.js";
// Side-effect imports. Each material owns the ops that target it; the
// modules self-register with the operation registry on load. Seeds and
// reality-config ops live alongside their respective subjects.
import "./materials/space/ops.js";
import "./materials/matter/ops.js";
// Side-effect import. Registers the `classify-matter` SEE op — the
// registry-driven "what matter type would this become?" read the
// place flow previews with. See materials/matter/classify.js.
import "./materials/matter/classify.js";
// Side-effect import. Registers the chain SEE ops — `verify-reel`
// (walk a reel's hash chain, branch-aware) and `chain-root` (the
// branch / reality root fingerprints). See past/fact/chainRoots.js.
import "./past/fact/chainRoots.js";
// Side-effect import. Registers the unified `do move` op (relocates
// a space or a matter into a new destination space). The cross-kind
// shape doesn't belong in any single material's ops file; it lives
// at materials/ root for that reason. See materials/moveOp.js.
import "./materials/moveOp.js";
// Side-effect import. Registers `do set-model` — points a being /
// space / matter at a model matter (type "model", bytes in the
// content store) by writing qualities.render.model. Upload is plain
// create-matter into the /skins catalog; this op is the SET half.
// See materials/modelOp.js.
import "./materials/modelOp.js";
// Side-effect import. Registers `do form-portal` — creates a Matter
// pointing at a foreign IBPA. The portal's experience (window /
// portal / walk-through) is emergent per-viewer from foreign-side
// stance auth; see materials/portalOp.js + seed/CROSS-WORLD.md.
import "./materials/portalOp.js";
import "./materials/being/ops.js";
import "./materials/being/credentialOps.js";
// Side-effect import. Registers `do grant-inheritation` / `do
// revoke-inheritation` — authority over a being-tree subtree, handed
// between Names (delegation) or held by ownership. The being-tree's
// downward-authority axis, read by being/identity/inheritation.js.
import "./materials/being/inheritationOps.js";
// Side-effect import. Registers `do key-export` — the NAME's key custody
// ("back up your key / your exit"). Lives in name/ because the key is a
// Name concern post-split (a being holds no key). See materials/name/keyOps.js.
import "./materials/name/keyOps.js";
// Side-effect import. Registers the role-acquisition ops: ask-role
// (host policy decides: auto, queue, or refuse) and take-role
// (walk-in for grabbed:true roles). The acquisition module lives in
// present/roles/ because that's where the policy schema and the
// in-effect role-walk live; these ops just front the policy.
import "./present/roles/acquisitionOps.js";
// Side-effect import. Registers the my-inbox SEE op. The 2D portal's
// inbox panel reads my-inbox to surface pending summons; responses are
// just SUMMON-BACK with `inReplyTo: <correlation>` (the substrate's
// fold handler closes the row by that key), so no separate respond-
// to-summon op exists. Side effects on approve (e.g. role-request →
// grant-role) are dispatched by the panel as separate substrate calls.
import "./present/intake/inboxOps.js";
// Side-effect import. Registers the seed-shipped inbox renderers
// (currently "role-request"). The my-inbox SEE op above looks up the
// renderer keyed by envelope intent and attaches the render spec to
// each entry — the panel is then a dumb renderer. Extensions can
// register their own renderers via reality.registerInboxRenderer.
// See seed/SUMMON.md "the receiving handler" + seed/present/intake/
// inboxRenderers.js for the spec shape.
import "./present/intake/renderers/index.js";
// Side-effect import. Registers the publish layer: replicate-subtree
// (extract a subtree's current shape into a portable bundle) and
// graft-replicate (apply a bundle into a target). The walker primitive
// in materials/refWalker.js is the engine; these ops wire it to DO.
import "./materials/publish/ops.js";
// Side-effect import. Registers `set-render` . the canonical sensory
// write op against `qualities.render` (the seed-owned namespace any
// matter/space/being can carry: model + animations + sounds + future
// channels). Sugar over set-<kind>; see seed/ibp/setRender.js.
import "./ibp/setRender.js";
// realityConfig.js self-registers the set-config / delete-config DO
// ops alongside the setters they wrap. Importing for the side effect.
import "./realityConfig.js";
// (reigning.js retired 2026-06-04 . heaven uses ownership + role
// grants (per seed/RolesAreAuth.md). Promote a being into heaven by
// granting them the `angel` role anchored at heaven:
// `do(@<being>, "grant-role", { role: "angel", anchorSpaceId: <heavenId> })`.)
// Side-effect import. Registers the InboxProjection cross-cutting
// fold handlers (summon → upsert, be:sever → delete-by-root).
// See seed/past/projections/inbox/inboxProjectionFold.js.
import "./past/projections/inbox/inboxProjectionFold.js";
// Side-effect import. Registers the ThreadsProjection cross-cutting
// fold handlers (summon → upsert+addParticipant, be:sever →
// mark severed). See seed/past/projections/threads/threadsProjectionFold.js.
import "./past/projections/threads/threadsProjectionFold.js";
// Side-effect import. Registers the PositionProjection cross-cutting
// fold handler (do:set-being:coord → upsert (beingId, spaceId) row).
// The cross-cutting read of "who is at this space, where," skinny
// enough for live-sync push payloads without re-fetching the whole
// descriptor. See seed/past/projections/position/positionProjectionFold.js.
import "./past/projections/position/positionProjectionFold.js";

// ---------------------------------------------------------------------------
// Auth strategy registry (extensions register additional auth methods)
// Extensions must declare provides.authStrategies in their manifest.
// The loader wraps registerStrategy to bind the extension name automatically.
// ---------------------------------------------------------------------------

const authStrategies = [];
const _allowedStrategyExtensions = new Set();

// The push-channel proxies imported from ibp/pushChannel.js no-op
// when no transport has registered, so the bundle always exposes the
// proxy functions without a separate fallback path.

/**
 * Build the reality services bundle.
 *
 * @param {object} opts
 * @param {Map}    opts.loadedExtensions  - already-loaded extensions (for availability checks)
 * @param {object} opts.overrides         - swap any service with a custom implementation
 * @returns {object} the reality services bundle
 */

// I stash the last-built bundle so seed-internal callers don't have to
// thread it through every signature. buildRealityServices runs once at
// boot; the bundle stays stable for the process lifetime.
let _lastBuiltReality = null;
export function getRealityServices() {
  return _lastBuiltReality;
}

export function buildRealityServices({
  loadedExtensions = new Map(),
  overrides = {},
} = {}) {
  const reality = {
    // The four verbs. The whole of my public surface for operations
    // on space, matter, and beings. Per-target helpers below
    // (reality.space, reality.matters, reality.qualities, etc.) are syntactic
    // surfaces over the same grammar; new code prefers the verbs.
    see: seeVerb,
    do: doVerb,
    summon: callVerb,
    be: beVerb,
    name: nameVerb,

    // Branch-cloning / reality-seeding portable artifacts.
    // - clone (clone.js + graft.js): the SETUP — current shape of a
    //   subtree, hollow face. Used via the wire DO ops `capture-template`
    //   and `plant-template` (legacy aliases `replicate-subtree` /
    //   `graft-replicate` also registered).
    // - captureGraft: the WHOLE REALITY — full chains (facts + acts +
    //   branches + reelHeads), original IDs preserved. Plant-only on
    //   the receive side (boot mode in genesis.js). See
    //   `seed/done/Chain-Rebuild.md` for the doctrine.
    captureGraft,

    // Plant is boot-only — exposing it here as a runtime verb refuses.
    // The shape exists so future live-plant (when a clean wipe-and-
    // replay-in-place path is designed) can land without breaking the
    // public API. For now: use PLANT_FROM_GRAFT env var on boot.
    plant: () => {
      throw new Error(
        "reality.plant: plant is currently boot-only. Wipe the DB, set " +
        "PLANT_FROM_GRAFT=/path/to/graft.json, and restart the substrate. " +
        "Runtime plant (live wipe-and-replay-in-place) is a future arc; " +
        "see seed/done/Chain-Rebuild.md for the doctrine.",
      );
    },

    // --- Always-available services ---
    facts: { emitFact },
    auth: {
      resolveSpaceAccess,
      birthBeing,
      verifyPassword,
      generateToken,
      isFirstBeing,
      findBeingByName,
      registerStrategy: (name, handler, extName = "unknown") => {
        if (!_allowedStrategyExtensions.has(extName)) {
          log.warn(
            "Auth",
            `Strategy "${name}" from "${extName}" rejected: extension must declare provides.authStrategies in manifest`,
          );
          return false;
        }
        authStrategies.push({ name, handler, extName });
        log.verbose("Auth", `Strategy "${name}" registered by "${extName}"`);
        return true;
      },
      allowStrategyExtension: (extName) =>
        _allowedStrategyExtensions.add(extName),
      getStrategies: () => authStrategies,
    },

    session: {
      createSession,
      endSession,
      registerSession,
      touchSession,
      updateSessionMeta,
      getActiveNavigator,
      setActiveNavigator,
      clearActiveNavigator,
      getSession,
      getSessionsForBeing,
      setSessionAbort,
      abortSession,
      clearSessionAbort,
      SESSION_TYPES,
      registerSessionType,
    },

    llm: {
      getClientForBeing,
      beingHasLlm,
      runLlmMoment,
      getRootIdFor,
      setCurrentSpace,
      getCurrentSpace,
      registerRootSpaceLlmSlot,
      registerBeingLlmSlot,
      registerFailoverResolver,
    },

    // MCP retired 2026-05-22. The LLM voice dispatches tool calls
    // directly through the seed tool registry; the verb dispatcher
    // gates per-verb auth + extension-scope. No protocol layer.

    // Push channel. Proxies from seed/ibp/pushChannel.js that route to
    // the registered transport (today: WebSocket via initWebSocketServer).
    // No-op when no transport has registered. Named `websocket` for
    // back-compat with extension callers; the channel itself is
    // transport-agnostic.
    websocket: {
      emitNavigate,
      emitToBeing,
      emitToBeingRoom,
      registerSocketHandler,
      unregisterSocketHandler,
      getIO,
      getHttpServer,
    },

    // Multi-step coordination used to be a runtime I ran on extensions'
    // behalf, and it had to be. Humans were "users" with one wiring
    // (input devices, sessions, sockets); LLMs were separate code with
    // another (chat loops, tool dispatch, transcript state).
    // Coordinating work across the two meant complex conditional logic
    // bridging them at every step.
    //
    // Both became Beings 2026-MAY. Different `operatingMode`, same
    // SUMMON envelope. The conditional bridging vanished. What was a
    // pipeline runtime is now beings reacting through inboxes across
    // space and time: one being writes, another wakes; a contractor
    // finishes a step, a ruler is summoned; a scheduler ticks, a
    // worker arrives at its queue. Simple primitives compose.
    // Pipelines are what beings working together look like, not what I
    // run on their behalf.

    // --- Shared models (always available) ---
    models: { Being, Space, Fact, Matter },

    // --- Hook system ---
    hooks: hooksModule,

    // --- Space infrastructure (cache, integrity, circuit breaker, CRUD) ---
    space: {
      getAncestorChain,
      snapshotAncestors,
      invalidateSpace,
      invalidateAll,
      getCacheStats,
      checkTreeHealth,
      tripTree,
      reviveTree,
      isTreeAlive,
      createSpace,
      createSpaceBranch,
      deleteSpaceBranch,
      updateParentRelationship,
      editSpaceName,
      editSpaceType,
      isBeingRoot,
      getSpaceRootId,
    },

    // --- Matter (programmatic matter CRUD) ---
    matters: {
      createMatter,
      editMatter,
      deleteMatterAndFile,
      transferMatter,
      getMatters,
    },

    // --- Space locks (structural mutation locks, tier 3 only) ---
    spaceLocks: {
      acquireSpaceLock,
      releaseSpaceLock,
      acquireMultiple,
      releaseMultiple,
      isSpaceLocked,
      getStats: getSpaceLockStats,
    },

    // --- Qualities. Per-primitive extension-data Map.
    //     reality.qualities.{being,space,matter}.{getQuality, setQuality,
    //     mergeQuality, incQuality, pushQuality, addToQualitySet,
    //     batchSetQuality, unsetQuality, readQualityNamespace}.
    //     Namespace ownership is enforced on space and matter when the
    //     scoped reality bundle passes opts.callerExtName.
    qualities,

    // --- Extension scope (check blocked/allowed status at positions) ---
    //
    // getExtensionAtScope is the principled way to reach across into
    // another extension. Returns null when the target is blocked at
    // this position, closing the "extension X's exports stay callable
    // even when X is blocked" hole. Prefer this over the unscoped
    // getExtension(name) from the loader when you're already operating
    // at a known position.
    scope: {
      isExtensionBlockedAtSpace,
      getBlockedExtensionsAtSpace,
      getExtensionAtScope,
      getToolOwner,
    },

    // declare: the setup voice. The four verbs above are how
    // extensions EMIT (act on space, mutate, summon a being, identify
    // themselves). Everything here is how extensions DECLARE the
    // standing structure the verbs need: what roles exist, when
    // beings wake, which events wake them, how a role handler
    // coordinates its child replies. You cannot SUMMON into a role
    // that was never declared. You cannot have a verb wake a being
    // on an event nobody subscribed to. Declarations are prior.
    //
    // Only SUMMONs make SUMMONs. Every wake in the system is the
    // result of a SUMMON envelope landing in an inbox. There is no
    // bypass surface for poking the scheduler directly; the verb is
    // the only inbox-writer.
    declare: {
      // Define a new kind of being. The spec carries the role's
      // permissions, tools, system prompt, and `summon` handler.
      // When SUMMON dispatches to a being in this role, the spec
      // is what runs.
      registerRole: ibpRegisterRole,
      unregisterRole: ibpUnregisterRole,

      // RESOURCES.md: a code resource registers a code-cognition
      // handler for a role resource by name. The role spec stays pure
      // data (canSee/canDo/canSummon/canBe/prompt); the handler is the
      // function the substrate runs when the role is summoned and the
      // being's cognition is scripted. Without a registered handler, a
      // scripted role falls through to whatever its inline `summon` is;
      // an LLM role with no handler runs default LLM cognition. The
      // scoped reality auto-namespaces the role name to the registering
      // extension (scopedReality.js).
      registerRoleHandler:   ibpRegisterRoleHandler,
      unregisterRoleHandler: ibpUnregisterRoleHandler,

      // Register a named SEE operation. A SEE op is a named
      // perception — the substrate's read-side parallel to DO ops.
      // Two consumption paths:
      //   1. canSee on roles: `canSee: ["place", "<ext>:<name>"]`
      //      — the role frame preloads each name's result as a face
      //      block in the LLM prompt.
      //   2. Direct call: `reality.see("<ext>:<name>", args)` —
      //      any caller (portal, DO handler, extension code) gets
      //      the structured return verbatim.
      // Bare names are reserved for the seed; extension names are
      // auto-prefixed `<ext>:<name>`. The verb (reality.see) and the
      // registry methods (reality.see.registerOperation, .list, etc.)
      // are attached to the same callable — mirrors reality.do.
      registerSeeOperation: ibpRegisterSeeOperation,
      unregisterSeeOperation: ibpUnregisterSeeOperation,
      unregisterSeesForExtension: ibpUnregisterSeesForExtension,
      listSeeOperations: ibpListSeeOperations,
      getSeeOperation: ibpGetSeeOperation,

      // DO-trigger subscriptions. A being registers interest in
      // some class of DO events; when a matching event fires, the
      // seed emits a SUMMON to that being's inbox. The being
      // reacts as if any other summon had arrived. Stigmergy.
      subscribe: ibpSubscribe,
      unsubscribe: ibpUnsubscribe,
      unsubscribeAllForBeing: ibpUnsubscribeAllForBeing,

      // Scheduled-wake registry. A being declares a wake cadence;
      // the tick loop emits a SUMMON on each interval. Default is
      // an anonymous code emitter; a reality may swap in a real
      // scheduler-being via setScheduleEmitter so the wake is
      // attributable to a Being row.
      schedule: ibpSchedule,
      unschedule: ibpUnschedule,
      unscheduleAllForBeing: ibpUnscheduleAllForBeing,
      setScheduleEmitter: ibpSetScheduleEmitter,
      resetScheduleEmitter: ibpResetScheduleEmitter,

      // Wait for the replies from a fan-out of SUMMONs before
      // continuing. Called inside a role's `summon()` handler when
      // the role emits N child SUMMONs and needs to synthesize
      // their answers. Foreman is the canonical user.
      aggregate: ibpAggregate,

      // Matter TYPES — the main extension point. A type declares
      // what a piece of matter IS (content kinds) and what may be
      // DONE with it (its DO ops, surfaced as the matter's actions
      // and gated by the role-walk). Extensions absorb external
      // systems into the reality by registering types; the verbs
      // stay uniform. Seed ships only the basics (generic, file,
      // web, model). See materials/matter/types.js +
      // philosophy/OS/matter.md.
      registerMatterType: ibpRegisterMatterType,
      unregisterMatterType: ibpUnregisterMatterType,
      getMatterType: ibpGetMatterType,
      listMatterTypes: ibpListMatterTypes,

      // Inbox renderers — the dumb-panel pattern from seed/SUMMON.md.
      // For each envelope intent, register a server-side renderer
      // that returns a JSON-serializable render spec; the my-inbox
      // SEE op enriches each pending entry with the spec, and the
      // inbox panel renders the spec without knowing the intent.
      // Seed ships renderers for its own intents (role-request);
      // extensions register renderers for their own intents the
      // same way. See seed/present/intake/inboxRenderers.js for the
      // spec shape.
      registerInboxRenderer: ibpRegisterInboxRenderer,
      unregisterInboxRenderer: ibpUnregisterInboxRenderer,
      listInboxRenderers: ibpListInboxRenderers,
    },

    // --- Response protocol (shapes, error codes, event types) ---
    protocol: { ok, error, sendOk, sendError, IBP_ERR },
  };

  // Apply overrides (places can swap any service)
  for (const [key, value] of Object.entries(overrides)) {
    if (reality[key] && typeof value === "object") {
      reality[key] = { ...reality[key], ...value };
    } else {
      reality[key] = value;
    }
  }

  _lastBuiltReality = reality;
  return reality;
}

export { authStrategies };
