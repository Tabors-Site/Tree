// TreeOS Place . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// scopedReality.js — the per-extension permission boundary.
//
// Extensions don't get the full `reality` services bundle. They get a
// SCOPED view: only the services they declared in `manifest.needs` or
// `manifest.optional`, plus a few seed-mandatory surfaces (hooks,
// qualities, beingMetadata, matterMetadata).
//
// The scoped bundle also auto-namespaces a handful of register-style
// methods so extensions can't impersonate each other or the seed:
//
//   - `reality.do.registerOperation("name", spec)` → records
//     "<ext>:name" with ownerExtension=<ext>.
//   - `reality.websocket.emitToBeing(beingId, "evt", data)` → emits
//     "<ext>:evt".
//   - `reality.auth.registerStrategy(name, handler)` → records the
//     strategy under the extension's name; only extensions that
//     declared `provides.authStrategies` may register at all.
//
// Fully-qualified names (with a colon) are accepted only when the
// prefix matches the calling extension's own name; mismatches
// throw to make namespace-impersonation a structural impossibility.
// Reserved event names ("ibp", "registered", "navigate") refuse.
//
// The whole scoped object is shallow-frozen so extensions can't
// replace `reality.hooks` or `reality.llm`; they CAN add new top-level
// properties (`reality.energy = {...}`), which is how an extension
// publishes its own service surface for other extensions to declare.

/**
 * Build the scoped reality bundle for one extension.
 *
 * @param {object} manifest           the extension's manifest
 * @param {object} fullReality        the full reality services bundle
 * @param {Set<string>} availableServices  seed-known service keys
 *   (computed once at boot from buildRealityServices output;
 *   used to distinguish seed-provided from extension-registered
 *   services in the scoping logic)
 * @returns {object}  the scoped, frozen bundle
 */
export function buildScopedReality(manifest, fullReality, availableServices) {
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
    if (allowed.has(key) && fullReality[key]) {
      scoped[key] = fullReality[key];
    }
  }

  // Also inject declared services that were dynamically registered by other
  // extensions (e.g. energy registers reality.energy during its init). The seed
  // doesn't name these. Extensions discover them by declaration.
  for (const svc of allowed) {
    if (!availableServices.has(svc) && fullReality[svc]) {
      scoped[svc] = fullReality[svc];
    }
  }

  // Models: only inject declared ones (plus any registered by other extensions)
  scoped.models = {};
  for (const name of allowedModels) {
    if (fullReality.models[name]) {
      scoped.models[name] = fullReality.models[name];
    }
  }

  // Hooks: always available (place infrastructure, not a declared service)
  if (fullReality.hooks) {
    scoped.hooks = fullReality.hooks;
  }

  // Metadata: always available (every extension reads/writes metadata)
  if (fullReality.qualities) {
    scoped.qualities = fullReality.qualities;
  }

  // Being metadata: always available (extensions store per-being state)
  if (fullReality.beingMetadata) {
    scoped.beingMetadata = fullReality.beingMetadata;
  }

  // Matter metadata: always available (extensions tag matter in their namespace)
  if (fullReality.matterMetadata) {
    scoped.matterMetadata = fullReality.matterMetadata;
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
  // verb function itself (`reality.do(...)`) is passed through; only the
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

  // Declare bindings: inject the extension name into registerRole so the
  // registered role's `origin` reflects the registering extension rather
  // than the default "role-registry" → "seed" tag. Without this wrap
  // every extension role appears as a seed role in the role-manager
  // catalog and the operator can't tell where it came from.
  if (scoped.declare?.registerRole) {
    const extName = manifest.name;
    const origDeclare = scoped.declare;
    scoped.declare = {
      ...origDeclare,
      registerRole: (name, def) => origDeclare.registerRole(name, def, extName),
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
  // `reality.qualities.{being,space,matter}` are tombstones — they throw
  // with a migration message pointing at
  // `reality.do(target, "set-<kind>", { field: "qualities.<ns>" })`. Reads
  // (getQuality, readQualityNamespace) stay. Namespace ownership is
  // now enforced in the seed `do.set-<kind>` handler against the verb's
  // calling identity. No need to wrap here; scoped.qualities passes
  // through unchanged.

  // Freeze existing seed services so extensions can't replace reality.hooks,
  // reality.llm, etc. But allow adding new properties (reality.energy = {...})
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
