// TreeOS extension entry point.
//
// The loader calls init(core) once at boot, after validating manifest
// deps and building a scoped `core` services bundle. Return whatever
// the extension provides — tools, router, jobs, exports — and the
// loader wires the rest.
//
// Logging via `log.info / verbose / debug / warn / error`. Never
// console.log. The first arg is the namespace ("MyExt") so log
// filters can target this extension.

import log from "../../seed/system/log.js";

export async function init(core) {
  // log.verbose("MyExt", "init starting");

  // ───────────────────────────────────────────────────────────────
  // METADATA — extension data lives in metadata Maps, never in
  // seed schemas. Each extension writes to its own namespace; the
  // scoped core enforces that boundary.
  // ───────────────────────────────────────────────────────────────
  //
  // Space metadata:
  //   const data = core.metadata.getExtMeta(space, "my-extension");
  //   await core.metadata.setExtMeta(spaceId, "my-extension", { key: "value" });
  //   await core.metadata.mergeExtMeta(spaceId, "my-extension", { extraKey: "value" });
  //   await core.metadata.incExtMeta(spaceId, "my-extension", "counter", 1);
  //   await core.metadata.pushExtMeta(spaceId, "my-extension", "history", item, 50);
  //   await core.metadata.batchSetExtMeta(spaceId, "my-extension", { a: 1, b: 2 });
  //   await core.metadata.unsetExtMeta(spaceId, "my-extension");
  //
  // Being metadata (per-being data; persists across role changes):
  //   const prefs = core.beingMetadata.getBeingMeta(being, "my-extension");
  //   await core.beingMetadata.setBeingMeta(beingId, "my-extension", { ... });
  //   await core.beingMetadata.incBeingMeta(beingId, "my-extension", "visits", 1);
  //
  // Matter metadata (per-piece-of-matter data):
  //   const tags = core.matterMetadata.getMatterMeta(matter, "my-extension");
  //   await core.matterMetadata.setMatterMeta(matterId, "my-extension", { ... });

  // ───────────────────────────────────────────────────────────────
  // HOOKS — react to substrate events. Always available; no needs
  // declaration required. See seed/system/hooks.js for the full
  // hook list and payload shapes.
  // ───────────────────────────────────────────────────────────────
  //
  // core.hooks.register("enrichContext", async ({ context, space, meta }) => {
  //   const data = meta["my-extension"] || {};
  //   if (Object.keys(data).length === 0) return; // guard: only enrich when relevant
  //   context.myExtension = data;
  // }, "my-extension");
  //
  // core.hooks.register("afterMatter", async ({ matter, spaceId, beingId, origin }) => {
  //   // react to any matter write at any position
  // }, "my-extension");

  // ───────────────────────────────────────────────────────────────
  // DO OPERATIONS — register custom write actions on the DO verb.
  // The loader auto-namespaces: declare "log-meal" here, callers
  // invoke `core.do(target, "my-extension:log-meal", { ... })`.
  // Every op handler receives { target, params, identity, scaffold }
  // and runs through the Did audit unless `skipAudit: true`.
  // ───────────────────────────────────────────────────────────────
  //
  // core.do.registerOperation("log-meal", {
  //   targets: ["space"],
  //   handler: async ({ target, params, identity }) => {
  //     await core.metadata.mergeExtMeta(target._id, "my-extension", {
  //       lastMeal: params.text,
  //     });
  //     return { logged: true };
  //   },
  // });

  // ───────────────────────────────────────────────────────────────
  // ROLES — register a role spec so summoned beings can run with
  // its prompt, tool surface, and permissions. Each role declares
  // canSee / canDo / canSummon / canBe arrays of tool names; the
  // role-summon gate refuses to run a role with any unresolved
  // tool, so register the tools (return them from this init() —
  // see below) before any being is summoned in this role.
  // ───────────────────────────────────────────────────────────────
  //
  // core.ibp.registerRole("my-role", {
  //   name:       "my-role",
  //   canSee:     ["my-extension:read-status"],
  //   canDo:      ["my-extension:log-meal"],
  //   canSummon:  [],
  //   canBe:      [],
  //   prompt:     (ctx) => `Help the user log meals at ${ctx.currentSpaceName}.`,
  //   respondMode: "async",                    // or "sync" | "none"
  //   triggerOn:   ["message"],                // ["schedule"] for cadence-driven roles
  // });

  // ───────────────────────────────────────────────────────────────
  // DO-TRIGGER SUBSCRIPTIONS — wake a being when matching substrate
  // writes happen. Substrate fans out matching events as
  // intent="do-trigger" SUMMONs to the subscriber's inbox. The
  // receiving role's summon handler interprets the event.
  // ───────────────────────────────────────────────────────────────
  //
  // core.ibp.subscribe(beingId, {
  //   event:    "afterMatter",
  //   scope:    { ancestor: someSpaceId },     // | { everywhere: true } | { spaceId }
  //   filter:   { origin: "web" },             // optional payload equality / any-of
  //   priority: 4,                              // BACKGROUND
  //   coalesceMs: 0,                            // batch matching events in N ms
  // });

  // ───────────────────────────────────────────────────────────────
  // SCHEDULED WAKES — fire a SUMMON on a being's inbox at a
  // cadence. The default emitter sends as `@I-am`; install
  // a scheduler-being extension to swap in an embodied emitter.
  // ───────────────────────────────────────────────────────────────
  //
  // core.ibp.schedule(beingId, {
  //   intervalMs: 60_000 * 30,                  // every 30 minutes
  //   content:    { event: "tick" },
  //   priority:   4,
  // });

  // ───────────────────────────────────────────────────────────────
  // DESCRIPTOR DERIVERS — contribute derived fields to the
  // Position Description that clients render (3D portal, web
  // dashboard). The seed has its own deriver registry; reaching
  // into other extensions from inside seed is forbidden.
  // Canonical kinds: "models", "scenes", "scene-block".
  // ───────────────────────────────────────────────────────────────
  //
  // core.descriptor.registerDeriver("models", (meta) => {
  //   const raw = meta instanceof Map ? meta.get("models") : meta?.models;
  //   return raw?.model ? { model: raw.model, scale: raw.scale ?? 1 } : null;
  // });

  // ───────────────────────────────────────────────────────────────
  // SEEDS — plantable scaffolds. Register a recipe here (or via
  // the manifest's provides.seeds path) and the operator plants
  // it with `core.do(node, "plant-seed", { name: "my-ext:my-seed" })`.
  // ───────────────────────────────────────────────────────────────
  //
  // core.seeds.register("my-seed", {
  //   description: "Sets up a tracking position with the my-extension role.",
  //   plant: async ({ target, identity }) => {
  //     await core.do(target, "create-child", { name: "tracking" }, { identity });
  //   },
  // });

  // ───────────────────────────────────────────────────────────────
  // RETURN — what the loader wires after init() resolves.
  // ───────────────────────────────────────────────────────────────
  return {
    // router,                                  // Express router (mounted at /api/v1)
    //
    // tools: [                                 // { name, description, schema, handler, verb }
    //   {
    //     name:        "my-extension:log-meal",
    //     description: "Records a meal entry at the current position.",
    //     schema:      { text: z.string() },   // zod shape; injected ctx (beingId, spaceId, ...) passes through
    //     verb:        "do",                   // "see" | "do" | "summon" | "be"
    //     handler:     async (args) => {
    //       await core.do(args.spaceId, "my-extension:log-meal", { text: args.text }, {
    //         identity: { beingId: args.beingId },
    //       });
    //       return { ok: true };
    //     },
    //   },
    // ],
    //
    // jobs: {                                  // background workers; start at boot, stop on shutdown
    //   start: () => { /* schedule timers, open connections, ... */ },
    //   stop:  () => { /* tear down */ },
    // },
    //
    // exports: {                               // cross-extension API — other extensions read via
    //   helperFn,                              //   core.scope.getExtensionAtScope("my-extension", spaceId)
    // },                                       //   then ext?.exports?.helperFn(...)
  };
}
