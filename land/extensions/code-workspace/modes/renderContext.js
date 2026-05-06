import { fileHeadline } from "../fileSurface.js";

/**
 * Shared renderer for the enrichedContext block that both plan.js and
 * log.js inject into their system prompts.
 *
 * Without this, facets reference "your context" but the actual data
 * (nodePlan, localView, blockingSyntaxError, etc.) lives only on the
 * ctx object for shouldInject checks — it never reaches the prompt
 * text. This helper serializes the populated keys as a labeled block.
 *
 * Order matters: blocking errors first (they stop work entirely),
 * then plan state, then position, then ambient signals. The AI reads
 * top-down so the most actionable block lands first.
 */
export default function renderEnrichedContextBlock(enriched) {
  if (!enriched || typeof enriched !== "object") return "";
  const sections = [];

  if (enriched.blockingSyntaxError) {
    const b = enriched.blockingSyntaxError;
    sections.push(
      `🔴 BLOCKING SYNTAX ERROR\n` +
      `File: ${b.file}\n` +
      `Line: ${b.line}\n` +
      `Message: ${b.message}\n` +
      `Writes to any OTHER file will be rejected until this one parses.`,
    );
  }

  // Governing trio context — sub-Ruler lineage, parent Ruler's
  // approved plan, and the union of ancestor-Ruler contracts. Lands
  // near the top because these constrain every decision the AI makes
  // at this scope: which work belongs here, what vocabulary to reuse,
  // which sibling sub-Rulers own which directories.
  if (enriched.governingLineage) sections.push(enriched.governingLineage);
  if (enriched.governingParentPlan) sections.push(enriched.governingParentPlan);
  if (enriched.governingContracts) sections.push(enriched.governingContracts);

  // Declared contracts — scoped to this branch (filtered upstream
  // by readScopedContracts; this renderer just lays them out by
  // namespace). Lands near the TOP so the wire protocol is the
  // first thing the AI reads after any blocking errors.
  if (Array.isArray(enriched.declaredContracts) && enriched.declaredContracts.length > 0) {
    const branch = enriched.declaredContractsBranchName;
    const heading = branch
      ? `## Declared Contracts (scoped to "${branch}")`
      : `## Declared Contracts`;
    const lines = [heading];
    // Group by namespace. The parser writes both `c.namespace` (the
    // canonical taxonomy field) and `c.kind` (mirror of namespace under
    // the Pass 1 invariant); we prefer namespace and fall back to kind
    // so contracts written by either path render the same way.
    const byNamespace = new Map();
    for (const c of enriched.declaredContracts) {
      const ns = c.namespace || c.kind || "contract";
      if (!byNamespace.has(ns)) byNamespace.set(ns, []);
      byNamespace.get(ns).push(c);
    }
    for (const [ns, items] of byNamespace) {
      lines.push("");
      lines.push(`${ns}:`);
      for (const c of items) {
        const valueText = renderContractValue(c);
        const scopeTag = renderScope(c.scope);
        lines.push(`  - ${c.name}${valueText}${scopeTag}`);
      }
    }
    sections.push(lines.join("\n"));
  }

  if (enriched.nodePlan) {
    sections.push(enriched.nodePlan);
  }

  if (enriched.swarmFreshSignals) {
    sections.push(enriched.swarmFreshSignals);
  }

  if (enriched.swarmPosition) {
    sections.push(`## Position\n${enriched.swarmPosition}`);
  }

  if (enriched.projectSystemSpec) {
    sections.push(`## Project Spec\n${enriched.projectSystemSpec}`);
  }

  if (enriched.localView) {
    sections.push(`## Local Tree View\n${enriched.localView}`);
  }

  if (enriched.swarmContracts) {
    sections.push(enriched.swarmContracts);
  }

  if (enriched.swarmAggregated) {
    sections.push(enriched.swarmAggregated);
  }

  if (enriched.swarmLateralSignals) {
    sections.push(enriched.swarmLateralSignals);
  }

  if (Array.isArray(enriched.siblingBranches) && enriched.siblingBranches.length > 0) {
    sections.push(renderSiblingBranches(enriched.siblingBranches));
  }

  if (enriched.swarmPlanTree) {
    sections.push(`## Plan Tree\n${enriched.swarmPlanTree}`);
  }

  if (sections.length === 0) return "";
  return `=================================================================
CONTEXT FOR THIS TURN
=================================================================

${sections.join("\n\n")}`;
}

/**
 * Render the sibling-branches block. Compact: one heading per sibling,
 * status + path + spec one-liner + file summaries. The AI uses
 * workspace-peek-sibling-file to fetch full content on demand.
 */
function renderSiblingBranches(siblings) {
  const lines = ["## Sibling Branches (read-only)"];
  lines.push("");
  for (const sib of siblings) {
    const icon =
      sib.status === "done" ? "✓" :
      sib.status === "failed" ? "✗" :
      sib.status === "running" ? "🟡" :
      sib.status === "paused" ? "⏸" : "⏳";
    lines.push(`### ${icon} ${sib.name}  [${sib.status}${sib.path ? `, ${sib.path}` : ""}]`);
    if (sib.spec) lines.push(`Spec: ${truncate(sib.spec, 240)}`);
    // sib.summary is now the structured childSummary object written
    // by code-workspace/summaryRefresh.js, not a string. Extract the
    // useful fields (surface line, outcome, drift signals) instead of
    // String-coercing the whole object to "[object Object]".
    const summaryLine = renderSiblingSummary(sib.summary);
    if (summaryLine) lines.push(`Summary: ${summaryLine}`);

    const files = (sib.nodes || []).filter((n) => Array.isArray(n.notes) && n.notes.length > 0);
    if (files.length > 0) {
      lines.push("");
      lines.push("Files:");
      for (const file of files.slice(0, 30)) {
        const path = file.path ? `${file.path}/${file.name}` : file.name;
        const headline = headlineFromNotes(path, file.notes);
        lines.push(`  - ${path}${headline ? ` — ${truncate(headline, 160)}` : ""}`);
      }
      if (files.length > 30) {
        lines.push(`  ... and ${files.length - 30} more (peek with workspace-peek-sibling-file)`);
      }
    } else {
      lines.push("(no files yet)");
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Render the relevant fields of a structured childSummary into one
 * line for the sibling-branches block. Falls back to the truncated
 * string when given a legacy string-summary (older nodes that haven't
 * been refreshed since Phase 1.F shipped).
 */
function renderSiblingSummary(summary) {
  if (!summary) return "";
  if (typeof summary === "string") return truncate(summary, 240);
  if (typeof summary !== "object") return "";
  const parts = [];
  if (summary.surface) parts.push(truncate(summary.surface, 200));
  if (summary.outcome && summary.outcome !== "in-progress") {
    parts.push(`outcome: ${summary.outcome}`);
  }
  if (summary.unresolvedSignals > 0) {
    parts.push(`${summary.unresolvedSignals} unresolved signal${summary.unresolvedSignals === 1 ? "" : "s"}`);
  }
  const oosCount = summary.consumption?.outOfScope?.length || 0;
  if (oosCount > 0) {
    parts.push(`${oosCount} out-of-scope identifier${oosCount === 1 ? "" : "s"}`);
  }
  return parts.join("  ·  ") || "(no surface details)";
}

function headlineFromNotes(filePath, notes) {
  for (const note of notes) {
    const content = note?.content;
    if (typeof content !== "string" || !content.trim()) continue;
    return fileHeadline(filePath, content);
  }
  return null;
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

/**
 * Render a contract's CANONICAL VALUE (not field names). The
 * builder needs the actual string/array/shape it must use, not the
 * names of the fields the parser extracted. Picks the most
 * informative field from c.values, in priority order:
 *
 *   value      → single canonical value (storage-key, dom-id)
 *   values     → enumerated set (identifier-set)
 *   detail     → event payload shape (event-name)
 *   exports    → module exports list (module-export)
 *   shape      → object shape (storage-key with shape body)
 *   args       → method signature args (method-signature)
 *
 * Falls through to a compact field-name list only when none of the
 * above are present.
 */
function renderContractValue(c) {
  const v = c?.values || {};
  // Strip the "scope" key — it's already shown as a suffix tag and
  // would otherwise pollute every contract line.
  if (v.value != null) return ` = ${formatLiteral(v.value)}`;
  if (v.values != null) return ` ∈ ${formatLiteral(v.values)}`;
  if (v.detail != null) return ` (detail: ${formatLiteral(v.detail)})`;
  if (v.exports != null) return ` → ${formatLiteral(v.exports)}`;
  if (v.shape != null) return ` :: ${formatLiteral(v.shape)}`;
  if (v.args != null) return ` (args: ${formatLiteral(v.args)})`;
  // module-export contracts: render globals + methods. Without showing
  // methods, a consumer of `window.GameEngine = class` has no idea what
  // it can call on instances and either guesses from training data or
  // reads the sibling's source — exactly what contracts exist to avoid.
  if (v.globals != null || v.methods != null) {
    const parts = [];
    if (v.globals != null) parts.push(formatLiteral(v.globals));
    if (v.methods != null) parts.push(`methods: ${formatLiteral(v.methods)}`);
    return ` → ${parts.join(", ")}`;
  }
  // Last resort: list the field names actually present (excluding
  // scope, which is rendered as the suffix tag).
  const fields = (c.fields || []).filter((f) => f !== "scope");
  return fields.length > 0 ? ` { ${fields.join(", ")} }` : "";
}

function formatLiteral(v) {
  // Parser stores values as strings (raw text from the architect's
  // emission). Strip outer quotes if present and pass through.
  const s = String(v).trim();
  return s.replace(/^['"]|['"]$/g, "");
}

/**
 * Render a contract's scope as a compact tag suffix. Helps the AI
 * see at a glance whether a contract is global, shared with other
 * specific branches, or local to it. The architecture of the prompt
 * already filters to the branch's slice — this just labels each
 * line so the builder knows the contract isn't a project-wide rule
 * unless it actually says "global".
 */
function renderScope(scope) {
  if (!scope || scope === "global") return "  [global]";
  if (typeof scope !== "object") return "";
  if (Array.isArray(scope.shared)) return `  [shared: ${scope.shared.join(", ")}]`;
  if (scope.local) return `  [local: ${scope.local}]`;
  return "";
}
