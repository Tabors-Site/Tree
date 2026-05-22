// TreeOS governing . see-resolvers shared across governing roles.
//
// Roles declare their preloaded prompt blocks by name in `role.see`.
// This module registers the functions that resolve those names to
// content at prompt-build time. Centralized here so each role file
// references resolvers by name without each one re-registering the
// same shared resolvers (which would conflict in the registry).
//
// Called once from extensions/governing/index.js#init().

import { registerSeeResolver } from "../../seed/factory/voices/llm/seeResolvers.js";
import { renderRulerSnapshot } from "./state/rulerSnapshot.js";
import { renderExecutionStack } from "./state/executionStack.js";

export function registerGoverningSeeResolvers() {
  // Ruler's domain snapshot. The single richest block: active plan
  // summary, contracts in force, execution status, lineage.
  registerSeeResolver("ruler-snapshot", async (ctx) => {
    const scopeId = ctx.currentSpace || ctx.targetSpace || ctx.rootId;
    if (!scopeId) return null;
    try { return await renderRulerSnapshot(scopeId); }
    catch { return null; }
  }, "governing");

  // Foreman's execution stack: pending/running/done counts, recent
  // transitions, stuck branches. Surfaced when a Foreman wakes for
  // judgment or dispatch.
  registerSeeResolver("execution-stack", async (ctx) => {
    const scopeId = ctx.currentSpace || ctx.targetSpace || ctx.rootId;
    if (!scopeId) return null;
    try { return await renderExecutionStack(scopeId); }
    catch { return null; }
  }, "governing");

  // Ancestor governance blocks. Populated by governing's enrichContext
  // hook into ctx.enrichedContext; resolvers surface the named pieces.
  // Sub-Rulers, Planners, Contractors, Foremen all reference these so
  // their decisions build on parent context rather than reinventing it.
  registerSeeResolver("ancestor-contracts", (ctx) => {
    return ctx?.enrichedContext?.governingContracts || null;
  }, "governing");

  registerSeeResolver("ancestor-plan", (ctx) => {
    return ctx?.enrichedContext?.governingParentPlan || null;
  }, "governing");

  registerSeeResolver("ruler-lineage", (ctx) => {
    return ctx?.enrichedContext?.governingLineage || null;
  }, "governing");

  // Active workspace at this scope. Tells the Planner what shape the
  // worker can realize (book-workspace → notes; code-workspace →
  // files) so the plan matches what downstream workers can produce.
  registerSeeResolver("active-workspace", (ctx) => {
    return ctx?.enrichedContext?.governingActiveWorkspace || null;
  }, "governing");
}
