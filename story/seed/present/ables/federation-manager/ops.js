// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// federation-manager ops. The operator-facing DO surface for transfers
// with peer realities. Two cargoes (template = the shape, fresh ids on
// planting; being = the entity, verbatim id + chain) over one push/pull
// transport. See able.js for the verb-object naming and the one-token-
// two-sides note (an op name and the wire intent it emits coincide).
//
// All seven send-side ops are WORD-SOLE (handler-less, Tabor's no-mirror
// law): each `.word` co-located here is the ONLY path. do.js's
// runOpWordToStore runs each via runWordToStore (runAsStore), so every
// negotiation write seals its OWN do:set-being moment on the federation-
// manager being's reel, exactly as the old per-field setQualityField loop.
// The host floor (federationManagerHost.js) supplies two see-ops: the
// per-op resolve-federation-spec (a host READ + COMPUTE that captures the
// bundle, mints the negotiationId, reads the incoming record, and BUILDS
// the { field, value } write list, laying NO fact) and the shared
// dispatch-federation-intent (the cross-story membrane OUT, verb:call to
// the peer, carried by crossStoryDispatch). No JS op handler survives.
//
// Seven ops:
//
//   offer-template    . push a template out. Captures a template of the
//                       local subtree, sends offer-template to the peer's
//                       federation-manager, caches the bundle until the
//                       peer accepts.
//
//   offer-being       . push a being out (identity graft). Captures the
//                       being's signed graft bundle and delivers it one-
//                       shot via deliver-being. No offer/accept review.
//
//   request-template  . pull a template. Sends request-template to the
//                       peer. If the peer's operator fulfills, they push
//                       back into us via the offer-template path (the same
//                       receiving code as any other incoming push).
//
//   accept-template   . approve an incoming offer-template. Sends accept-
//                       template back; the sender then delivers the bundle
//                       via deliver-template (which the able handler plants).
//
//   reject-template   . refuse an incoming offer-template. Sends reject-template.
//
//   fulfill-request   . approve an incoming request-template. Captures and
//                       pushes the asked template back at the requester.
//
//   refuse-request    . refuse an incoming request-template. Sends reject-
//                       template (reusing the rejection envelope).
//
// Auth: operator-only by default. canDo on the federation-manager able
// licenses these ops, and the able is granted at the story root to
// the @federation-manager being itself; the operator addresses
// @federation-manager via SUMMON which dispatches the op. Custom
// operator policy (auto-accept particular peers, throttle pulls, etc.)
// lives in flow on the @federation-manager being.

import log from "../../../seedStory/log.js";
import { registerOperation } from "../../../ibp/operations.js";
import { registerSeeOperation } from "../../../ibp/seeOps.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { federationManagerHostEnv } from "./federationManagerHost.js";

// Self-register the co-located world strands so resolveAbleWord("being", <op>) finds them. All
// seven send-side ops are WORD-SOLE: each `.word` is the ONLY path (do.js runOpWordToStore via
// runWordToStore, runAsStore). The resolution key is "being" (registerAbleWord first arg), matched
// by word.able below; word.noun "being" names the deed's target kind (the federation-manager being).
registerAbleWord("being", "offer-template",   new URL("./offer-template.word",   import.meta.url));
registerAbleWord("being", "offer-being",      new URL("./offer-being.word",      import.meta.url));
registerAbleWord("being", "request-template", new URL("./request-template.word", import.meta.url));
registerAbleWord("being", "accept-template",  new URL("./accept-template.word",  import.meta.url));
registerAbleWord("being", "reject-template",  new URL("./reject-template.word",  import.meta.url));
registerAbleWord("being", "fulfill-request",  new URL("./fulfill-request.word",  import.meta.url));
registerAbleWord("being", "refuse-request",   new URL("./refuse-request.word",   import.meta.url));

export function registerFederationManagerOps() {
  // registerOperation / registerSeeOperation calls below run at module
  // load; this is the explicit entry point so genesis.js can import + call
  // it the same way it does for history-manager / able-manager / llm-assigner.
}

// ────────────────────────────────────────────────────────────────────
// federation-status . SEE op (pure READ): the negotiation queues.
// ────────────────────────────────────────────────────────────────────
//
// The read half of the operator's federation panel. Returns the four
// qualities.federation buckets as flat lists (each entry carries its
// negotiationId as `id`). READ-ONLY: folds the federation-manager being
// and reads its qualities, emits no Fact. Operator-gated (heaven
// authority), since the queues reveal who this story is negotiating
// with. The DO ops below are how the operator acts on what this surfaces.
registerSeeOperation("federation-status", {
  ownerExtension: "seed",
  description: "Read the federation-manager's negotiation state: incoming offers/requests, outbound in-flight, completed. Operator-gated, read-only.",
  args: {},
  handler: async ({ identity, history }) => {
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "federation-status: identity required");
    }
    const { hasHeavenAuthority } = await import("../../../materials/space/heavenLineage.js");
    if (!(await hasHeavenAuthority(identity.beingId))) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "federation-status: operator (heaven authority) only");
    }
    const { findByName } = await import("../../../materials/projections.js");
    const slot = await findByName("being", "federation-manager", history);
    const q = slot?.state?.qualities;
    const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : (q || {});
    const fed = qualities.federation || {};
    // Each bucket is a map keyed by negotiationId; flatten to a list and
    // lift the id onto each entry so the panel can address actions by it.
    const asList = (m) => Object.entries(m || {})
      .filter(([, v]) => v != null)
      .map(([id, v]) => (v && typeof v === "object" ? { id, ...v } : { id, value: v }));
    return {
      pendingIncomingOffers:   asList(fed.pendingIncomingOffers),
      pendingIncomingRequests: asList(fed.pendingIncomingRequests),
      pendingOutbound:         asList(fed.pendingOutbound),
      completed:               asList(fed.completed),
    };
  },
});

// ────────────────────────────────────────────────────────────────────
// The seven WORD-SOLE DO ops.
// ────────────────────────────────────────────────────────────────────
//
// Each declares `word: { noun: "being", able: "being", runAsStore: true }`
// + its per-op hostEnv (federationManagerHostEnv(<op>), which closes the
// op-specific spec resolver over the shared dispatch-federation-intent),
// and NO handler. runAsStore routes do.js to runOpWordToStore: the `.word`
// lays each negotiation write as its own do:set-being deed (one moment per
// field) and fires the one cross-story dispatch. The op returns
// ranAsMoments, so the dispatcher stamps no separate audit fact, the deeds
// ARE the record (offer-being / accept-template lay no deed: the dispatch
// IS the effect). targets ["being","stance"] keeps the address surface the
// portal already uses; the `.word` resolves the federation-manager being by
// name (its qualities hold the negotiation state), never the address target.

// offer-template . operator initiates an outbound push.
registerOperation("offer-template", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  word:           { noun: "being", able: "being", runAsStore: true },
  hostEnv:        federationManagerHostEnv("offer-template"),
});

// offer-being . operator grafts a BEING to a peer story (one-shot, self-certifying).
registerOperation("offer-being", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  word:           { noun: "being", able: "being", runAsStore: true },
  hostEnv:        federationManagerHostEnv("offer-being"),
});

// request-template . operator initiates an outbound pull.
registerOperation("request-template", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  word:           { noun: "being", able: "being", runAsStore: true },
  hostEnv:        federationManagerHostEnv("request-template"),
});

// accept-template . operator approves an incoming offer-template.
registerOperation("accept-template", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  word:           { noun: "being", able: "being", runAsStore: true },
  hostEnv:        federationManagerHostEnv("accept-template"),
});

// reject-template . operator refuses an incoming offer-template.
registerOperation("reject-template", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  word:           { noun: "being", able: "being", runAsStore: true },
  hostEnv:        federationManagerHostEnv("reject-template"),
});

// fulfill-request . operator approves an incoming pull request (pushes the asked template back).
registerOperation("fulfill-request", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  word:           { noun: "being", able: "being", runAsStore: true },
  hostEnv:        federationManagerHostEnv("fulfill-request"),
});

// refuse-request . operator refuses an incoming pull request.
registerOperation("refuse-request", {
  targets:        ["being", "stance"],
  ownerExtension: "seed",
  word:           { noun: "being", able: "being", runAsStore: true },
  hostEnv:        federationManagerHostEnv("refuse-request"),
});

log.verbose("federation-manager",
  "registered 7 word-SOLE DO ops + 1 SEE op (offer-template/offer-being/request-template/accept-template/reject-template/fulfill-request/refuse-request + federation-status)");
