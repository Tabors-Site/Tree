// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// scopedStory.js — the per-extension permission boundary.
//
// Extensions don't get the full `story` services bundle. They get a
// SCOPED view: only the services they declared in `manifest.needs` or
// `manifest.optional`, plus a few seed-mandatory surfaces (hooks,
// qualities, beingMetadata, matterMetadata).
//
// The scoped bundle also auto-namespaces a handful of register-style
// methods so extensions can't impersonate each other or the seed:
//
//   - `story.do.registerOperation("name", spec)` → records
//     "<ext>:name" with ownerExtension=<ext>.
//   - `story.websocket.emitToBeing(beingId, "evt", data)` → emits
//     "<ext>:evt".
//   - `story.auth.registerStrategy(name, handler)` → records the
//     strategy under the extension's name; only extensions that
//     declared `provides.authStrategies` may register at all.
//
// Fully-qualified names (with a colon) are accepted only when the
// prefix matches the calling extension's own name; mismatches
// throw to make namespace-impersonation a structural impossibility.
// Reserved event names ("ibp", "registered", "navigate") refuse.
//
// The whole scoped object is shallow-frozen so extensions can't
// replace `story.hooks` or `story.llm`; they CAN add new top-level
// properties (`story.energy = {...}`), which is how an extension
// publishes its own service surface for other extensions to declare.

/**
 * Build the scoped story bundle for one extension.
 *
 * @param {object} manifest           the extension's manifest
 * @param {object} fullStory        the full story services bundle
 * @param {Set<string>} availableServices  seed-known service keys
 *   (computed once at boot from buildStoryServices output;
 *   used to distinguish seed-provided from extension-registered
 *   services in the scoping logic)
 * @returns {object}  the scoped, frozen bundle
 */
export function buildScopedStory(manifest, fullStory, availableServices) {
  const allowed = new Set();

  // Collect all declared services (required + optional)
  for (const svc of manifest.needs?.services || []) allowed.add(svc);
  for (const svc of manifest.optional?.services || []) allowed.add(svc);

  // Collect declared models
  const allowedModels = new Set(manifest.needs?.models || []);
  for (const m of manifest.optional?.models || []) allowedModels.add(m);

  // Build scoped object
  const scoped = {};

  // Services: inject declared seed services
  for (const key of availableServices) {
    if (allowed.has(key) && fullStory[key]) {
      scoped[key] = fullStory[key];
    }
  }

  // Also inject declared services that were dynamically registered by other
  // extensions (e.g. energy registers story.energy during its init). The seed
  // doesn't name these. Extensions discover them by declaration.
  for (const svc of allowed) {
    if (!availableServices.has(svc) && fullStory[svc]) {
      scoped[svc] = fullStory[svc];
    }
  }

  // Models: only inject declared ones (plus any registered by other extensions)
  scoped.models = {};
  for (const name of allowedModels) {
    if (fullStory.models[name]) {
      scoped.models[name] = fullStory.models[name];
    }
  }

  // Hooks: always available (place infrastructure, not a declared service)
  if (fullStory.hooks) {
    scoped.hooks = fullStory.hooks;
  }

  // Metadata: always available (every extension reads/writes metadata)
  if (fullStory.qualities) {
    scoped.qualities = fullStory.qualities;
  }

  // Being metadata: always available (extensions store per-being state)
  if (fullStory.beingMetadata) {
    scoped.beingMetadata = fullStory.beingMetadata;
  }

  // Matter metadata: always available (extensions tag matter in their namespace)
  if (fullStory.matterMetadata) {
    scoped.matterMetadata = fullStory.matterMetadata;
  }

  // Auth strategy binding: wrap registerStrategy to auto-inject extension name.
  // Extensions must declare provides.authStrategies in manifest to register.
  if (scoped.auth?.registerStrategy) {
    const extName = manifest.name;
    if (manifest.provides?.authStrategies) {
      scoped.auth.allowStrategyExtension(extName);
    }
    const origRegister = scoped.auth.registerStrategy;
    scoped.auth = {
      ...scoped.auth,
      registerStrategy: (name, handler) => origRegister(name, handler, extName),
    };
  }

  // DO verb binding: auto-namespace operation registrations. Extensions
  // write the local name; the registry records "<ext>:<name>" with
  // ownerExtension=<ext>. Fully-qualified names with a prefix that
  // doesn't match this extension throw to prevent impersonation. The
  // verb function itself (`story.do(...)`) is passed through; only the
  // registerOperation method gets scoped.
  if (
    typeof scoped.do === "function" &&
    typeof scoped.do.registerOperation === "function"
  ) {
    const extName = manifest.name;
    const origDo = scoped.do;
    const origRegister = scoped.do.registerOperation;
    const scopedDo = (...args) => origDo(...args);
    scopedDo.registerOperation = (name, spec) => {
      if (typeof name !== "string" || name.length === 0) {
        return origRegister(name, spec); // let the registry surface the error
      }
      let fullName;
      if (name.includes(":")) {
        const prefix = name.split(":")[0];
        if (prefix !== extName) {
          throw new Error(
            `registerOperation("${name}"): extension "${extName}" cannot register under prefix "${prefix}". ` +
              `Use the bare name ("${name.split(":").slice(1).join(":")}") — namespacing is automatic.`,
          );
        }
        fullName = name;
      } else {
        fullName = `${extName}:${name}`;
      }
      return origRegister(fullName, {
        ...(spec || {}),
        ownerExtension: extName,
      });
    };
    // Forward the rest of the registry surface unchanged.
    scopedDo.unregisterOperation = origDo.unregisterOperation;
    scopedDo.unregisterOperationsFromExtension =
      origDo.unregisterOperationsFromExtension;
    scopedDo.getOperation = origDo.getOperation;
    scopedDo.listOperations = origDo.listOperations;
    scoped.do = scopedDo;
  }

  // Declare bindings: inject the extension name into registerAble so the
  // registered able's `origin` reflects the registering extension rather
  // than the default "able-registry" → "seed" tag. Without this wrap
  // every extension able appears as a seed able in the able-manager
  // catalog and the operator can't tell where it came from.
  if (scoped.declare?.registerAble) {
    const extName = manifest.name;
    const origDeclare = scoped.declare;

    // Auto-prefix bare action/able/op names in a able's can* lists
    // with the registering extension's namespace. Inside an extension,
    // canDo: [{ action: "step" }] becomes [{ action: "<ext>:step" }]
    // before the able-registry sees it. Already-prefixed entries
    // (any string containing `:`) pass through untouched so an
    // extension can still reference another extension's actions or
    // bare seed actions explicitly.
    //
    // canSee has its own bare-name suffix-match at resolve time and
    // doesn't need rewriting here.
    const prefixOwn = (entry) => {
      if (typeof entry === "string") {
        return entry.includes(":") ? entry : `${extName}:${entry}`;
      }
      if (entry && typeof entry === "object" && typeof entry.action === "string") {
        return entry.action.includes(":")
          ? entry
          : { ...entry, action: `${extName}:${entry.action}` };
      }
      return entry;
    };
    const rewriteAbleDef = (def) => {
      if (!def || typeof def !== "object") return def;
      const out = { ...def };
      // able.name field: same auto-prefix rule. So a able file can
      // write { name: "drummer", ... } and the registered spec carries
      // name: "<ext>:drummer". Already-prefixed names pass through.
      if (typeof def.name === "string" && !def.name.includes(":")) {
        out.name = `${extName}:${def.name}`;
      }
      if (Array.isArray(def.canDo))     out.canDo     = def.canDo.map(prefixOwn);
      if (Array.isArray(def.canCall)) out.canCall = def.canCall.map(prefixOwn);
      if (Array.isArray(def.canBe))     out.canBe     = def.canBe.map(prefixOwn);
      return out;
    };

    // Same rule for the `name` first-argument: bare names auto-prefix.
    const prefixAbleName = (name) => {
      if (typeof name !== "string") return name;
      return name.includes(":") ? name : `${extName}:${name}`;
    };

    scoped.declare = {
      ...origDeclare,
      registerAble: (name, def) => origDeclare.registerAble(prefixAbleName(name), rewriteAbleDef(def), extName),
      // SEE operations auto-namespace under the registering extension —
      // same shape as registerAble's wrap. An extension calling
      //   story.declare.registerSeeOperation("neighbors", {handler})
      // is rewritten to register under "<ext>:neighbors" with
      // ownerExtension set, so ables can refer to it as either
      // "<ext>:neighbors" or the bare suffix "neighbors".
      registerSeeOperation: origDeclare.registerSeeOperation
        ? (name, spec) => origDeclare.registerSeeOperation(
            name.includes(":") ? name : `${extName}:${name}`,
            { ...spec, ownerExtension: extName },
          )
        : undefined,
      // RESOURCES.md: a code resource registers code-cognition handlers
      // for able resources by name. Same auto-namespace rule as
      // registerAble — bare able names pick up the extension prefix
      // so an extension calling
      //   story.declare.registerAbleHandler("registrar", handlerFn)
      // registers the handler under "<ext>:registrar", matching where
      // the able's spec was registered. Cross-extension references
      // (already-prefixed names) pass through.
      registerAbleHandler: origDeclare.registerAbleHandler
        ? (name, handler) => origDeclare.registerAbleHandler(prefixAbleName(name), handler, extName)
        : undefined,
    };
  }

  // Push-channel event binding: auto-namespace event names. Extensions
  // write the local event name; the seed prefixes their extension
  // name on the way to the wire. Reserved events (the seed's own
  // "ibp", and transport-private "registered"/"navigate") refuse
  // entirely — extensions can never emit them through this surface.
  if (scoped.websocket) {
    const extName = manifest.name;
    const RESERVED = new Set(["ibp", "registered", "navigate"]);
    const namespaceEvent = (event) => {
      if (typeof event !== "string" || !event) {
        throw new Error(`emitToBeing: event name must be a non-empty string`);
      }
      if (RESERVED.has(event)) {
        throw new Error(`emitToBeing: "${event}" is reserved by the seed`);
      }
      if (event.includes(":")) {
        const prefix = event.split(":")[0];
        if (prefix !== extName) {
          throw new Error(
            `emitToBeing("${event}"): extension "${extName}" cannot emit under prefix "${prefix}". ` +
              `Use the bare name ("${event.split(":").slice(1).join(":")}") — namespacing is automatic.`,
          );
        }
        return event;
      }
      return `${extName}:${event}`;
    };
    const wsRaw = scoped.websocket;
    scoped.websocket = {
      ...wsRaw,
      emitToBeing: (beingId, event, data) =>
        wsRaw.emitToBeing(beingId, namespaceEvent(event), data),
      emitToBeingRoom: (beingId, event, data) =>
        wsRaw.emitToBeingRoom(beingId, namespaceEvent(event), data),
    };
  }

  // Qualities binding retired 2026-05-23 alongside the qualities.js
  // write API. The setQuality / mergeQuality / etc. methods on
  // `story.qualities.{being,space,matter}` are tombstones — they throw
  // with a migration message pointing at
  // `story.do(target, "set-<kind>", { field: "qualities.<ns>" })`. Reads
  // (getQuality, readQualityNamespace) stay. Namespace ownership is
  // now enforced in the seed `do.set-<kind>` handler against the verb's
  // calling identity. No need to wrap here; scoped.qualities passes
  // through unchanged.

  // Freeze existing seed services so extensions can't replace story.hooks,
  // story.llm, etc. But allow adding new properties (story.energy = {...})
  // which is the pattern for extension-provided services.
  for (const key of Object.keys(scoped)) {
    if (
      scoped[key] &&
      typeof scoped[key] === "object" &&
      !Array.isArray(scoped[key])
    ) {
      Object.freeze(scoped[key]);
    }
  }
  return scoped;
}
