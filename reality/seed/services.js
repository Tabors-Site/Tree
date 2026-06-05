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
import {
  registerSeed,
  unregisterSeed,
  getSeed,
  listSeeds,
  plantSeed,
  unplantSeed,
  listPlantedAt,
} from "./materials/seeds.js";
import Being from "./materials/being/being.js";
import Space from "./materials/space/space.js";
import Fact from "./past/fact/fact.js";
import Matter from "./materials/matter/matter.js";

import { emitFact } from "./past/fact/facts.js";
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
  resolveRootLlmForRole,
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
} from "./present/roles/registry.js";
import {
  registerSeeResolver as ibpRegisterSeeResolver,
  unregisterSeeResolver as ibpUnregisterSeeResolver,
  unregisterResolversForExtension as ibpUnregisterSeesForExtension,
} from "./present/cognition/llm/seeResolvers.js";

// The four-verb dispatcher. The whole of my public surface for
// operations on space, matter, and beings.
import { doVerb }     from "./ibp/verbs/do.js";
import { seeVerb }    from "./ibp/verbs/see.js";
import { summonVerb } from "./ibp/verbs/summon.js";
import { beVerb }     from "./ibp/verbs/be.js";
// Side-effect imports. Each material owns the ops that target it; the
// modules self-register with the operation registry on load. Seeds and
// reality-config ops live alongside their respective subjects.
import "./materials/space/ops.js";
import "./materials/matter/ops.js";
// Side-effect import. Registers the unified `do move` op (relocates
// a space or a matter into a new destination space). The cross-kind
// shape doesn't belong in any single material's ops file; it lives
// at materials/ root for that reason. See materials/moveOp.js.
import "./materials/moveOp.js";
import "./materials/being/ops.js";
import "./materials/being/credentialOps.js";
import "./materials/seeds.js";
// Side-effect import. Registers `set-render` . the canonical sensory
// write op against `qualities.render` (the seed-owned namespace any
// matter/space/being can carry: model + animations + sounds + future
// channels). Sugar over set-<kind>; see seed/ibp/setRender.js.
import "./ibp/setRender.js";
// realityConfig.js self-registers the set-config / delete-config DO
// ops alongside the setters they wrap. Importing for the side effect.
import "./realityConfig.js";
// (reigning.js retired 2026-06-04 . heaven now uses the standard
// rootOwner + contributors model via materials/space/ownership.js.
// The add-reigning / remove-reigning DO ops are gone; promote a
// being into heaven with `do(<reality>/., "add-contributor", { ... })`.)
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

// I stash the last-built bundle so seed-internal callers (e.g. the
// plant-seed DO operation handing `reality` to a seed's scaffold) don't
// have to thread it through every signature. buildRealityServices runs
// once at boot; the bundle stays stable for the process lifetime.
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
    summon: summonVerb,
    be: beVerb,

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
      resolveRootLlmForRole,
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

    // --- Extension seeds (scaffolded shapes a reality can plant) ---
    // Extensions declare seeds via init() return { seeds: [...] } or
    // manifest.provides.seeds; the loader registers them. Operators plant
    // a seed at a space to bootstrap the extension's structure (Ruler,
    // beings, sub-domain spaces, starter matter). See memory
    // `extension-seeds`.
    seeds: {
      register: registerSeed,
      unregister: unregisterSeed,
      get: getSeed,
      list: listSeeds,
      plant: plantSeed,
      unplant: unplantSeed,
      listPlantedAt,
    },

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

      // Register a named see. A see is a perception in a moment's
      // face. The fn receives the moment ctx and returns a
      // projection (any JSON shape); the assembler inlines it under
      // a [<name>] header when a role's canSee references it by
      // name. Bare names from extensions are auto-namespaced
      // `<ext>:<name>`; roles can resolve them by either form.
      // Slice this into a role's canSee like canSee: ["my-ext:my-see"].
      registerSeeResolver: ibpRegisterSeeResolver,
      unregisterSeeResolver: ibpUnregisterSeeResolver,
      unregisterSeesForExtension: ibpUnregisterSeesForExtension,

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
