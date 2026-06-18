// _template/code/index.js — the code piece's entry point.
//
// The loader calls init(reality) once at boot, after validating
// manifest deps, building a scoped `reality` services bundle (per the
// `needs`), and registering all the pack's role / seed / asset
// pieces. So at the moment init() runs:
//   - This pack's roles are already in the role registry.
//   - This pack's seeds are already in the template registry.
//   - reality.declare.registerRoleHandler(roleName, fn) can attach
//     code-cognition handlers to role pieces published as pure data.
//
// Logging via `log.info / verbose / debug / warn / error`. Never
// console.log. The first arg is the namespace; use the pack's name.

import log from "../../../seed/seedReality/log.js";

export async function init(reality) {
  // log.verbose("MyPack", "init starting");

  // ─────────────────────────────────────────────────────────────────
  // DO operations. Auto-prefixed to <pack>:<name>. Each handler gets
  // { target, params, identity, moment }; stamps a Fact unless
  // skipAudit:true.
  // ─────────────────────────────────────────────────────────────────
  //
  // reality.do.registerOperation("example-op", {
  //   targets: ["space"],
  //   handler: async ({ target, params, identity }) => {
  //     await reality.qualities.space.mergeQuality(target._id, "my-pack", {
  //       lastValue: params.value,
  //     });
  //     return { stored: true };
  //   },
  // });

  // ─────────────────────────────────────────────────────────────────
  // SEE operations. The read-side parallel of DO ops. Same shape; the
  // handler returns the value the caller (or a role's preloaded face)
  // receives. Auto-prefixed to <pack>:<name>.
  // ─────────────────────────────────────────────────────────────────
  //
  // reality.declare.registerSeeOperation("example-see", {
  //   description: "Returns the current state at the given position.",
  //   handler: ({ ctx, args }) => {
  //     return { position: ctx.spaceId, data: args };
  //   },
  // });

  // ─────────────────────────────────────────────────────────────────
  // Role handlers. Role PIECES (in ../roles/<name>/role.js) ship the
  // pure-data spec. If a role needs code cognition (scripted handler)
  // rather than default LLM cognition, register the handler here. The
  // role name is the bare local name; scopedReality auto-prefixes it
  // to <pack>:<name> to match how the role-kind handler registered the
  // spec.
  // ─────────────────────────────────────────────────────────────────
  //
  // import { exampleRoleHandler } from "./handlers/example-role.js";
  // reality.declare.registerRoleHandler("example-role", exampleRoleHandler);

  // ─────────────────────────────────────────────────────────────────
  // Hooks. React to substrate events. See seed/system/hooks.js for
  // the hook list + payload shapes.
  // ─────────────────────────────────────────────────────────────────
  //
  // reality.hooks.register("enrichContext", async ({ context, space, meta }) => {
  //   const data = meta["my-pack"] || {};
  //   if (Object.keys(data).length === 0) return;
  //   context.myPack = data;
  // }, "my-pack");
  //
  // reality.hooks.register("afterMatter", async ({ matter, spaceId, beingId, origin }) => {
  //   // react to any matter write at any position
  // }, "my-pack");

  // ─────────────────────────────────────────────────────────────────
  // DO-trigger subscriptions. Wake a being when matching substrate
  // writes happen. The substrate fans out matching events as
  // intent="do-trigger" SUMMONs to the subscriber's inbox.
  // ─────────────────────────────────────────────────────────────────
  //
  // reality.declare.subscribe(beingId, {
  //   event:    "afterMatter",
  //   scope:    { ancestor: someSpaceId },
  //   filter:   { origin: "web" },
  //   priority: 4,
  //   coalesceMs: 0,
  // });

  // ─────────────────────────────────────────────────────────────────
  // Scheduled wakes. Fire a SUMMON on a being's inbox at a cadence.
  // ─────────────────────────────────────────────────────────────────
  //
  // await reality.declare.schedule(beingId, {
  //   intervalMs: 60_000 * 30,
  //   content:    { event: "tick" },
  //   priority:   4,
  //   branch:     moment.branch,
  //   moment,
  // });

  // ─────────────────────────────────────────────────────────────────
  // Return — what the loader wires after init() resolves.
  // ─────────────────────────────────────────────────────────────────
  return {
    // router,                                  // Express router
    //
    // tools: [                                 // MCP tools (also exposed to LLM cognition)
    //   {
    //     name:        "my-pack:example-tool",
    //     description: "What it does.",
    //     schema:      { /* zod shape */ },
    //     verb:        "do",                   // "see" | "do" | "summon" | "be"
    //     handler:     async (args) => { /* ... */ },
    //   },
    // ],
    //
    // jobs: {
    //   start: () => { /* timers, connections, ... */ },
    //   stop:  () => { /* teardown */ },
    // },
    //
    // exports: {                               // cross-pack API; other resources reach via
    //   helperFn,                              //   reality.scope.getExtensionAtScope("my-pack", spaceId)
    // },                                       //   then ext?.exports?.helperFn(...)
  };
}
