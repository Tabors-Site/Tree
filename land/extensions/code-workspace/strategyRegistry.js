/**
 * Strategy registry for code-workspace.
 *
 * A coding-domain package (code-strategy-http, code-strategy-websocket,
 * code-strategy-treeos-extension, ...) registers one entry per domain:
 *
 *   registerStrategy({
 *     name: "websocket",
 *     contextBlock: "short explanatory markdown",
 *     appliesWhen: (ctx) => ctx.enrichedContext?.contracts?.some(c => c.kind === "ws"),
 *   });
 *
 * Plan-mode asks buildStrategyContextBlock(ctx) when building its system
 * prompt. Only blocks whose predicate matches get inlined — the agent
 * sees what it needs and nothing else.
 *
 * Wrapper functions live in the strategy extension's own tools module
 * and are injected into tree:code-plan via instance.modeTools. This
 * registry is just the explanatory halves.
 */

import log from "../../seed/log.js";

const _strategies = [];

export function registerStrategy(spec) {
  if (!spec || typeof spec !== "object") return;
  if (!spec.name || typeof spec.name !== "string") {
    log.warn("CodeWorkspace", `registerStrategy called without a name; ignoring`);
    return;
  }
  if (typeof spec.contextBlock !== "string" || !spec.contextBlock.trim()) {
    log.warn("CodeWorkspace", `registerStrategy("${spec.name}") has no contextBlock; ignoring`);
    return;
  }
  const idx = _strategies.findIndex((s) => s.name === spec.name);
  if (idx >= 0) {
    log.warn("CodeWorkspace", `registerStrategy("${spec.name}") replacing an earlier registration`);
    _strategies.splice(idx, 1);
  }
  const applies = typeof spec.appliesWhen === "function" ? spec.appliesWhen : () => true;
  _strategies.push({
    name: spec.name,
    contextBlock: spec.contextBlock.trim(),
    appliesWhen: applies,
  });
  log.info("CodeWorkspace", `strategy "${spec.name}" registered`);
}

export function buildStrategyContextBlock(ctx) {
  const applicable = [];
  for (const s of _strategies) {
    try {
      if (s.appliesWhen(ctx || {})) applicable.push(s);
    } catch {
      // A broken appliesWhen never breaks the prompt build.
    }
  }
  if (applicable.length === 0) return "";
  return applicable
    .map(
      (s) =>
        `=================================================================\n${s.name.toUpperCase()}\n=================================================================\n\n${s.contextBlock}`
    )
    .join("\n\n");
}

export function listStrategies() {
  return _strategies.map((s) => ({ name: s.name }));
}
