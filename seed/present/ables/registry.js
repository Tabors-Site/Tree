// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The able registry — the templates of what a being CAN BE.
//
// A **able** is the template the being's frame is built around
// when a moment is assembled. The being IS the rendered frame;
// the able is the recipe for that frame. The able's prompt body,
// see list, and capabilities together describe a kind-of-being —
// a Planner, a Ruler, a Worker, a place manager. When a summon
// arrives, the activeAble names which kind the moment will be a
// moment of. The able file declares what the able uniquely IS;
// I fill in everything derivable.
//
// ── COGNITION DOCTRINE (closed set, BEING level — not able level) ──
//
// Cognition is what a being IS (human-driven, LLM-driven, scripted),
// not what a able IS. The same able applies regardless of who or what
// is driving the being. A factory-worker able on an LLM-driven being
// is the LLM doing factory work; the SAME able on the same being
// while a human inhabits it is the human doing factory work. The
// able doesn't change; the cognition does.
//
// Cognition lives on the being at `qualities.cognition.defaultKind`,
// one of:
//
//   "llm"      Wake → runLlmMoment with the active able's prompt + tools.
//   "human"    Wake → don't auto-process. The human reads the inbox in
//              their portal and emits the act from their own transport.
//   "scripted" Wake → call the active able's `summon(message, ctx)` if
//              present; else SEE (no act).
//
// Inhabit overrides defaultKind: when `qualities.inhabit` is present
// on the being, effective cognition for that moment is "human" — the
// inhabiting operator drives, regardless of defaultKind. Release the
// inhabit and effective cognition reverts to defaultKind.
//
// The closed-set discipline matches BE_OPS: additions to the cognition
// vocabulary are substrate changes (scheduler / momentum / stamper
// all branch on effective cognition), not extension hooks. "hybrid" /
// "chain" / "conditional" patterns belong at the flow layer, not
// inside cognition.
//
// ── ABLES ───────────────────────────────────────────────────────────
//
// What the able file writes:
//   name             - kebab-case identifier
//   see              - preloaded resolver names (resolved into prompt at build)
//   canSee           - SEE tool names the LLM may call
//   canDo            - DO tool names the LLM may call
//   canCall        - SUMMON tool names (beings the able may wake)
//   canBe            - BE tool names (being shapes the able may create)
//   prompt           - () => prompt body (used when effective cognition = "llm")
//   summon           - custom dispatch (used when effective cognition = "scripted")
//   requiredCognition - optional flow guard: this clause only
//                       applies when effective cognition matches.
//                       One of "llm" | "human" | "scripted". Omitted
//                       = applies to any cognition.
//   replyTo          - optional: "asker" | "chain-initial" reply mode
//
// What seed derives at registration:
//   permissions      - union of verbs implied by canSee / canDo / canCall / canBe
//   respondMode      - "async" by default
//   triggerOn        - ["message"] by default
//   summon           - auto-wrapped with defaultCall when able has no
//                      custom summon (LLM path is the default)
//   buildSystemPrompt - auto-assembled via seed/present/buildPrompt when not provided
//
import log from "../../seedStory/log.js";

// The able registry. Seed-shipped ables (auth, llm-assigner,
// place-manager) register through registerAble during genesis;
// extensions add theirs the same way.
const REGISTRY = new Map();

// Able-handler registry (RESOURCES.md: registerAbleHandler).
//
// A able resource ships pure data: name, canSee/Do/Summon/Be, prompt,
// defaultOrientation. A code resource OPTIONALLY registers a
// code-cognition handler for that able by name. When summon dispatches
// to a able, the able registry consults HANDLERS first; if a handler
// is registered, the able runs through that handler (scripted cognition).
// If no handler is registered, the able runs through the substrate's
// default LLM cognition.
//
// Today's scripted ables carry their `summon` function inline on the
// able spec; that path keeps working. The handler registry is the
// future-shape seam: a able resource published as kind:"able" cannot
// carry an inline `summon` (it's pure data), so a paired code resource
// registers the handler at boot through this API.
const HANDLERS = new Map();

const VALID_PERMISSIONS = new Set(["see", "do", "call", "be"]);
const VALID_REPLY_MODES = new Set(["asker", "chain-initial"]);

// Closed-set cognition vocabulary. Cognition lives on the being
// (qualities.cognition.defaultKind), not on the able; the able's
// `requiredCognition` (optional) is a flow guard, not a declaration.
// Adding a value here requires a substrate change (scheduler, momentum,
// stamper all branch on it). See the header comment block for the
// doctrine.
export const VALID_COGNITION = Object.freeze(
  new Set(["llm", "human", "scripted"]),
);

export function getAble(name) {
  if (!name) return null;
  return REGISTRY.get(name) || null;
}

export function listAbles() {
  return Array.from(REGISTRY.keys());
}

/**
 * Register a code-cognition handler for a able by name. When a code
 * resource (e.g. store/code/) wants to drive the cognition for a able
 * defined as a standalone resource (e.g. store/ables/registrar/), it
 * calls this at init. The handler runs in place of the default LLM
 * cognition when the able is summoned.
 *
 * The able spec does not need to exist at handler-registration time;
 * the loader's topological order means ables install before code, but
 * the handler will look up the able at dispatch time regardless.
 *
 * @param {string} ableName
 * @param {Function} handler  async (message, ctx) => CognitionResult
 * @param {string} [ownerExtension]
 */
export function registerAbleHandler(
  ableName,
  handler,
  ownerExtension = "code-resource",
) {
  if (!ableName || typeof ableName !== "string") {
    throw new Error("registerAbleHandler requires a non-empty able name");
  }
  if (typeof handler !== "function") {
    throw new Error(
      `registerAbleHandler("${ableName}") requires a handler function`,
    );
  }
  const prior = HANDLERS.get(ableName);
  if (prior && prior.ownerExtension !== ownerExtension) {
    log.warn(
      "Ables",
      `registerAbleHandler("${ableName}"): owner changed from "${prior.ownerExtension}" to "${ownerExtension}". Last writer wins.`,
    );
  }
  HANDLERS.set(ableName, { handler, ownerExtension });
}

export function getAbleHandler(ableName) {
  const entry = HANDLERS.get(ableName);
  return entry ? entry.handler : null;
}

export function unregisterAbleHandler(ableName) {
  HANDLERS.delete(ableName);
}

/**
 * Register a able. The able file declares what the able IS (name,
 * capabilities, prompt body); seed defaults the rest and wraps the
 * default summon dispatcher when not provided.
 *
 * @param {string} name
 * @param {object} def
 * @param {string} [extName] - owning extension; defaults to "able-registry"
 */
export function registerAble(name, def, extName = "able-registry") {
  if (!name || typeof name !== "string") {
    throw new Error("registerAble requires a non-empty name");
  }
  if (!def || typeof def !== "object") {
    throw new Error(`registerAble("${name}") requires a definition object`);
  }

  // Validate replyTo when present.
  if (
    def.replyTo !== undefined &&
    def.replyTo !== null &&
    !VALID_REPLY_MODES.has(def.replyTo)
  ) {
    throw new Error(
      `registerAble("${name}") invalid replyTo "${def.replyTo}"; ` +
        `must be one of ${[...VALID_REPLY_MODES].join("|")}`,
    );
  }

  // requiredCognition is an optional flow guard. When set, this
  // able only applies when the being's effective cognition matches
  // (e.g. a "human-conversationalist" able makes sense only when a
  // human is inhabiting). The flow evaluator (Step 2) honors it;
  // unguarded clauses below in the flow then have a chance to apply.
  // Omitted = the able applies to any cognition.
  if (
    def.requiredCognition !== undefined &&
    def.requiredCognition !== null &&
    !VALID_COGNITION.has(def.requiredCognition)
  ) {
    throw new Error(
      `registerAble("${name}") invalid requiredCognition "${def.requiredCognition}"; ` +
        `must be one of ${[...VALID_COGNITION].join("|")} or omitted.`,
    );
  }

  // Unify capabilities: `can` is the canonical granted-word-set; canSee/canDo/canCall/canBe
  // are its group-by-verb VIEWS. A able declares EITHER `can` (the collapsed form) OR the four;
  // the registry keeps both consistent. The verb permissions fall out of `can`. Authors never
  // write permissions[] directly — the registry computes it.
  const unified = unifyCan(def, name);
  const derived = deriveFromCan(unified.can);
  // Allow explicit override only if the able has a code-cognition
  // shape that wants permissions seed cannot derive (e.g., a able
  // with no canX fields that still needs SUMMON permission to emit).
  // Most ables never set this.
  const permissions =
    Array.isArray(def.permissions) && def.permissions.length > 0
      ? validatePermissions(name, def.permissions)
      : derived;

  // Default dispatch contract. Ables needing sync override; ables with
  // non-message triggers (scheduled, hook-fired) override.
  const respondMode = def.respondMode || "async";
  const triggerOn =
    Array.isArray(def.triggerOn) && def.triggerOn.length > 0
      ? def.triggerOn
      : ["message"];

  // Build the final able spec. summon and buildSystemPrompt are wired
  // lazily because they depend on seed/present modules; importing
  // them at module top would create a load-order cycle with runTurn.
  // The lazy refs resolve at first call.
  // Origin tag: who introduced this able. "seed" for the seed-shipped
  // ones, "<extName>" for extension-provided, "live" for operator-
  // authored (set-able DO op). syncAblesToSubstrate writes this into
  // qualities.able.origin so the boot live-able loader can pick out
  // live entries from the .ables mirror without confusing them with
  // seed/extension auto-synced ones.
  const origin = extName === "able-registry" ? "seed" : extName;

  // Reach validation (seed/AblesAreAuth.md "Final doctrine"). The
  // optional `reach` field is a path-filter list that adjusts the
  // able's default coverage (host + descendants). Bash-style with
  // `!` prefix for exclusions:
  //
  //   reach: [
  //     "/docs/coding/**",     // ADD this subtree (outside host)
  //     "!/coders/legacy/**",  // REMOVE this subtree from default
  //   ]
  //
  // Patterns: exact paths, spaceIds, prefix/**, prefix/*, **, ! prefix.
  // Empty / absent → host + descendants (the default base).
  //
  // The `scope: "global" | "anchored"` field is RETIRED — every able
  // just has a host (the space where it's installed via set-able).
  let reach = null;
  if (def.reach !== undefined && def.reach !== null) {
    if (!Array.isArray(def.reach)) {
      throw new Error(
        `registerAble("${name}") invalid reach: must be an array of strings.`,
      );
    }
    for (const r of def.reach) {
      if (typeof r !== "string" || !r.length) {
        throw new Error(
          `registerAble("${name}") invalid reach entry: ${JSON.stringify(r)}. ` +
            `Each entry must be a non-empty string (exact path, spaceId, prefix/**, ` +
            `or '!' prefix for exclusion).`,
        );
      }
    }
    reach = def.reach.length > 0 ? Object.freeze([...def.reach]) : null;
  }

  const spec = {
    name,
    ...def,
    can: unified.can, // the canonical granted-word-set
    canSee: unified.canSee, // group-by-verb VIEWS over `can`, for the rest of the system
    canDo: unified.canDo,
    canCall: unified.canCall,
    canBe: unified.canBe,
    permissions,
    respondMode,
    triggerOn,
    requiredCognition: def.requiredCognition || null,
    reach,
    origin,
  };
  // Drop any legacy `scope` field — retired with the host-on-space model.
  delete spec.scope;

  // Auto-wrap with defaultCall when the able brings no custom summon.
  // The custom summon is the SCRIPTED dispatch path; defaultCall is
  // the LLM dispatch path. Momentum picks which to invoke at moment-
  // assign time based on the being's effective cognition (inhabit ?
  // "human" : qualities.cognition.defaultKind), regardless of which
  // path the able provides.
  if (typeof spec.call !== "function") {
    spec.call = makeLazyDefaultCall(spec);
  }

  REGISTRY.set(name, Object.freeze(spec));
  log.verbose(
    "Ables",
    `Registered able "${name}" (${extName}) ` +
      `[verbs: ${permissions.join("/")}${spec.requiredCognition ? `, requires: ${spec.requiredCognition}` : ""}]`,
  );
}

/**
 * Remove a previously-registered able. Returns true when something was removed.
 */
export function unregisterAble(name) {
  return REGISTRY.delete(name);
}

// ────────────────────────────────────────────────────────────────────
// Derivation helpers
// ────────────────────────────────────────────────────────────────────

// `can` is THE way a able declares capability: a granted-word-set, one entry per word the being
// may speak — [{verb, word, description?}]. The verb is intrinsic to each word (see/do/summon/be);
// canSee/canDo/canCall/canBe are its group-by-verb VIEWS, derived here so the rest of the system
// reads them unchanged. A able NEVER declares the four directly — that's the collapse. (See
// project: able-is-a-composite-word; "can X" is the one grant.)
function unifyCan(def, name) {
  if (def.canSee || def.canDo || def.canCall || def.canBe) {
    throw new Error(
      `registerAble("${name}"): canSee/canDo/canCall/canBe are retired — declare \`can\` instead, ` +
        `a list of { verb, word } (e.g. { verb: "see", word: "ables" }, { verb: "do", word: "set-able" }).`,
    );
  }
  const can = (Array.isArray(def.can) ? def.can : []).map((e) => ({
    verb: e.verb,
    word: e.word ?? e.action,
    ...(e.description ? { description: e.description } : {}),
  }));
  return { can, ...canViews(can) };
}

// The group-by-verb VIEWS over `can` (canSee/canDo/canCall/canBe). Exported because a able spec
// SYNCED to a space stores the canonical `can`; the auth derives the views here when a stored spec
// carries `can` but not the four, so the able-walk reads consistent capabilities either way.
export function canViews(can) {
  const list = Array.isArray(can) ? can : [];
  const byVerb = (v) => list.filter((e) => e.verb === v);
  return {
    canSee: byVerb("see").map((e) => e.word),
    canDo: byVerb("do").map((e) =>
      e.description
        ? { action: e.word, description: e.description }
        : { action: e.word },
    ),
    canCall: byVerb("call").map((e) => {
      const { verb, ...rest } = e;
      return Object.keys(rest).length === 1 && rest.word !== undefined
        ? rest.word
        : rest;
    }),
    canBe: byVerb("be").map((e) => e.word),
    canRecall: byVerb("recall").map((e) => e.word), // the granted recall-VIEWS — a being's consciousness-level (which folds it may pull)
  };
}

// The verb permissions fall out of `can` — the set of verbs its granted words carry.
function deriveFromCan(can) {
  const verbs = new Set();
  for (const e of can) if (e.verb) verbs.add(e.verb);
  return [...verbs];
}

// B2 (623/12, the consciousness-level gate, ARMED): may this being recall a WIDER fold (the `scope`)?
// Recalling your OWN thread ("recalled" mode) needs no grant — the caller checks that. This gates the
// "saw" folds (world / lineage / moment / place / a foreign thread): a being may pull them iff its
// able grants the recall VIEW (`can recall <scope>` — canViews(can).canRecall). I has universal
// authority on its own story. Async (loads the being + reads its default able's grants).
export async function canRecallScope(beingId, scope, history) {
  if (!beingId) return false;
  const { I } = await import("../../materials/being/seedBeings.js");
  if (String(beingId) === String(I)) return true; // universal authority
  const { loadOrFold } = await import("../../materials/projections.js");
  const slot = await loadOrFold("being", String(beingId), history);
  const ableName = slot?.state?.defaultAble;
  if (!ableName) return false;
  const able = getAble(ableName);
  if (!able) return false;
  const views = able.canRecall || canViews(able.can || []).canRecall || [];
  return Array.isArray(views) && views.includes(scope);
}

function hasEntries(field) {
  if (!field) return false;
  if (Array.isArray(field)) return field.length > 0;
  if (typeof field === "object") {
    return Object.values(field).some((v) =>
      Array.isArray(v) ? v.length > 0 : Boolean(v),
    );
  }
  return false;
}

function validatePermissions(name, list) {
  const seen = new Set();
  for (const p of list) {
    if (!VALID_PERMISSIONS.has(p)) {
      throw new Error(
        `registerAble("${name}") permissions must be a subset of ` +
          `[see, do, call, be], got "${p}"`,
      );
    }
    seen.add(p);
  }
  return [...seen];
}

// Lazy default-summon wiring. Avoids a circular import: defaultCall
// imports runTurn, runTurn imports the registry. The closure resolves
// defaultCall on first invocation.
function makeLazyDefaultCall(able) {
  let cached = null;
  return async (message, ctx) => {
    if (!cached) {
      const mod = await import("../cognition/defaultCall.js");
      cached = mod.defaultCall;
    }
    return cached({ message, ctx, able });
  };
}

/**
 * Sync the able registry into `<story>/./ables` as child Spaces. One child
 * per able; qualities mirror the able's surface. Called at boot end
 * after extensions register; idempotent.
 */
export async function syncAblesToSubstrate() {
  const { HEAVEN_SPACE } =
    await import("../../materials/space/heavenSpaces.js");
  const { manifestItems } = await import("../manifest.js");
  const items = [];
  for (const [name, able] of REGISTRY) {
    items.push({
      name,
      qualities: new Map([
        [
          "able",
          {
            requiredCognition: able.requiredCognition || null,
            // `can` is the CANONICAL grant-set (canSee/canDo/canCall/canBe are
            // the retired, derived view). The gold must carry it or the .ables
            // mirror rots — a fold-from-gold reader (and any auth read off the
            // gold) needs the live grant-set, not just the legacy canX.
            can: Array.isArray(able.can) ? able.can : null,
            // NOTE: the verb-summary `permissions: ["see","do",...]` field
            // retired with the ables-are-auth doctrine (AblesAreAuth.md).
            // The canX entries below ARE the auth gate; a separate verb
            // summary is redundant. Consumers that need "does this able
            // permit verb X" check `able.canX?.length > 0` directly.
            // `scope` retired alongside it — every able just has a host.
            reach: Array.isArray(able.reach) ? able.reach : null,
            respondMode: able.respondMode || null,
            triggerOn: able.triggerOn || [],
            canSee: able.canSee || [],
            canDo: able.canDo || [],
            canCall: able.canCall || [],
            canBe: able.canBe || [],
            replyTo: able.replyTo || null,
            origin: able.origin || "seed",
            // Live ables carry a prompt string (seed/extension ables use
            // a prompt function we can't serialize). Surface it when
            // present so the .ables mirror is round-trip-able.
            prompt: typeof able.prompt === "string" ? able.prompt : null,
          },
        ],
      ]),
    });
  }
  return manifestItems({ heavenSpace: HEAVEN_SPACE.ABLES, items });
}

/**
 * Boot-time loader for operator-authored live ables. Walks
 * `<story>/./ables` for children whose qualities.able.origin === "live"
 * and calls registerAble on each so they live in the in-memory map
 * alongside seed and extension ables. Runs AFTER extension loading
 * and BEFORE syncAblesToSubstrate so the round-trip preserves them.
 *
 * Live ables store their prompt as a string in qualities; we wrap that
 * string into a prompt function so the registry contract holds
 * (defaultCall / buildPrompt call able.prompt()).
 *
 * @returns {Promise<{ loaded: number }>}
 */
export async function loadLiveAblesFromSubstrate() {
  const { HEAVEN_SPACE } =
    await import("../../materials/space/heavenSpaces.js");
  const { findByHeavenSpace, listByType, loadProjection } =
    await import("../../materials/projections.js");
  const parent = await findByHeavenSpace(HEAVEN_SPACE.ABLES, "0");
  if (!parent) return { loaded: 0 };
  // Space children of the .ables heaven space. No curated findByParent for
  // SPACE (that helper is being-only), so list the type and keep those whose
  // state.parent is this heaven space. listByType already excludes
  // tombstoned slots (the old `tombstoned: { $ne: true }` filter). The
  // occupant rows carry only (type, id); reload each slot's state for the
  // name + qualities the loader reads.
  const occupants = await listByType("space", "0");
  const children = [];
  for (const o of occupants) {
    const slot = await loadProjection("space", o.id, "0");
    const st = slot?.state || {};
    if (String(st.parent ?? "") !== String(parent.id)) continue;
    children.push({ name: st.name, qualities: st.qualities });
  }
  let loaded = 0;
  for (const child of children) {
    const quals = child.qualities;
    const able = quals instanceof Map ? quals.get("able") : quals?.able;
    if (!able || able.origin !== "live") continue;
    try {
      const promptStr = typeof able.prompt === "string" ? able.prompt : "";
      registerAble(
        child.name,
        {
          description: `Live able authored via @able-manager.`,
          requiredCognition: able.requiredCognition || null,
          can: Array.isArray(able.can) ? able.can : [],
          replyTo: able.replyTo || null,
          // Wrap the stored string prompt as a prompt function so the
          // able spec matches what defaultCall / buildPrompt expect.
          prompt: () => promptStr,
        },
        "live",
      );
      loaded++;
    } catch (err) {
      log.warn(
        "Ables",
        `Failed to load live able "${child.name}": ${err.message}`,
      );
    }
  }
  log.info(
    "Ables",
    `Loaded ${loaded} live able${loaded === 1 ? "" : "s"} from .ables.`,
  );
  return { loaded };
}
