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

  // Declared contracts land near the TOP so the wire protocol is the
  // first thing the AI reads after any blocking errors. Without this
  // the facet's "you must implement these" text points at nothing.
  if (Array.isArray(enriched.declaredContracts) && enriched.declaredContracts.length > 0) {
    const messages = enriched.declaredContracts.filter((c) => c.kind === "message");
    const types = enriched.declaredContracts.filter((c) => c.kind === "type");
    const lines = ["## Declared Contracts (the architect's wire protocol)"];
    if (messages.length > 0) {
      lines.push("");
      lines.push("Messages:");
      for (const m of messages) {
        const fieldList = m.fields.length > 0 ? ` { ${m.fields.join(", ")} }` : " { (no payload fields) }";
        lines.push(`  - ${m.name}${fieldList}`);
      }
    }
    if (types.length > 0) {
      lines.push("");
      lines.push("Shared types:");
      for (const t of types) {
        const fieldList = t.fields.length > 0 ? ` { ${t.fields.join(", ")} }` : " { (opaque) }";
        lines.push(`  - ${t.name}${fieldList}`);
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

  if (enriched.swarmPlanTree) {
    sections.push(`## Plan Tree\n${enriched.swarmPlanTree}`);
  }

  if (sections.length === 0) return "";
  return `=================================================================
CONTEXT FOR THIS TURN
=================================================================

${sections.join("\n\n")}`;
}
