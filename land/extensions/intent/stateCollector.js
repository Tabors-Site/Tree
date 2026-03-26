// State Collector
//
// Reads every available signal source for a tree. Each source is optional.
// If the extension is installed, its data contributes to the state snapshot.
// If not, that section is empty. Intent generates from whatever is available.

import log from "../../seed/log.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import { getExtension } from "../loader.js";

/**
 * Collect the full observable state of a tree for intent generation.
 *
 * @param {string} rootId
 * @param {object} rootNode - the tree root node document
 * @param {object} models - { Node, User }
 * @returns {object} state snapshot with sections for each signal source
 */
export async function collectTreeState(rootId, rootNode, models) {
  const { Node } = models;
  const state = {
    rootId,
    rootName: rootNode.name,
    collectedAt: new Date().toISOString(),
    pulse: null,
    evolution: null,
    contradictions: null,
    codebook: null,
    gaps: null,
    userProfile: null,
    cascade: null,
    circuit: null,
    rejections: [],
  };

  // Pulse: health snapshots
  const pulseExt = getExtension("pulse");
  if (pulseExt?.exports?.getHealthSnapshot) {
    try {
      state.pulse = await pulseExt.exports.getHealthSnapshot(rootId);
    } catch (err) {
      log.debug("Intent", `Pulse data unavailable for ${rootId}: ${err.message}`);
    }
  }

  // Evolution: dormant branches, fitness metrics
  const evolutionExt = getExtension("evolution");
  if (evolutionExt?.exports?.getEvolutionState) {
    try {
      state.evolution = await evolutionExt.exports.getEvolutionState(rootId);
    } catch (err) {
      log.debug("Intent", `Evolution data unavailable for ${rootId}: ${err.message}`);
    }
  }

  // Contradiction: unresolved conflicts
  const contradictionExt = getExtension("contradiction");
  if (contradictionExt?.exports?.getUnresolved) {
    try {
      state.contradictions = await contradictionExt.exports.getUnresolved(rootId);
    } catch (err) {
      log.debug("Intent", `Contradiction data unavailable for ${rootId}: ${err.message}`);
    }
  }

  // Codebook: compression status
  const codebookExt = getExtension("codebook");
  if (codebookExt?.exports?.getCompressionStatus) {
    try {
      state.codebook = await codebookExt.exports.getCompressionStatus(rootId);
    } catch (err) {
      log.debug("Intent", `Codebook data unavailable for ${rootId}: ${err.message}`);
    }
  }

  // Gap detection: missing extensions
  const gapExt = getExtension("gap-detection");
  if (gapExt?.exports?.getGaps) {
    try {
      state.gaps = await gapExt.exports.getGaps(rootId);
    } catch (err) {
      log.debug("Intent", `Gap data unavailable for ${rootId}: ${err.message}`);
    }
  }

  // Inverse-tree: user profile, goals vs actions
  const inverseExt = getExtension("inverse-tree");
  if (inverseExt?.exports?.getProfile) {
    try {
      state.userProfile = await inverseExt.exports.getProfile(rootNode.rootOwner);
    } catch (err) {
      log.debug("Intent", `Inverse-tree data unavailable for ${rootId}: ${err.message}`);
    }
  }

  // Cascade flow: stuck nodes, flow rates
  try {
    const flowMeta = getExtMeta(rootNode, "flow");
    if (flowMeta && Object.keys(flowMeta).length > 0) {
      state.cascade = flowMeta;
    }
  } catch (err) {
    log.debug("Intent", "Cascade flow metadata read failed:", err.message);
  }

  // Circuit breaker: approaching thresholds
  try {
    const circuitMeta = getExtMeta(rootNode, "circuit");
    if (circuitMeta) {
      state.circuit = circuitMeta;
    }
  } catch (err) {
    log.debug("Intent", "Circuit breaker metadata read failed:", err.message);
  }

  // Load rejections (intents the user said "don't do that again")
  try {
    const intentMeta = getExtMeta(rootNode, "intent");
    if (intentMeta?.rejections) {
      state.rejections = intentMeta.rejections;
    }
  } catch (err) {
    log.debug("Intent", "Intent metadata read failed:", err.message);
  }

  return state;
}

/**
 * Format the collected state into a prompt-friendly string.
 * Only includes sections that have data.
 */
export function formatStateForPrompt(state) {
  const sections = [];

  if (state.pulse) {
    sections.push(`Pulse health: ${JSON.stringify(state.pulse)}`);
  }
  if (state.evolution) {
    sections.push(`Evolution: ${JSON.stringify(state.evolution)}`);
  }
  if (state.contradictions && state.contradictions.length > 0) {
    sections.push(`Unresolved contradictions (${state.contradictions.length}): ${JSON.stringify(state.contradictions.slice(0, 10))}`);
  }
  if (state.codebook) {
    sections.push(`Codebook compression status: ${JSON.stringify(state.codebook)}`);
  }
  if (state.gaps && state.gaps.length > 0) {
    sections.push(`Detected gaps (${state.gaps.length}): ${JSON.stringify(state.gaps.slice(0, 10))}`);
  }
  if (state.userProfile) {
    sections.push(`User profile: ${JSON.stringify(state.userProfile)}`);
  }
  if (state.cascade) {
    sections.push(`Cascade flow: ${JSON.stringify(state.cascade)}`);
  }
  if (state.circuit) {
    sections.push(`Circuit breaker: ${JSON.stringify(state.circuit)}`);
  }

  if (sections.length === 0) {
    return null; // Nothing to observe. No intents to generate.
  }

  let prompt = sections.join("\n- ");

  if (state.rejections.length > 0) {
    const rejectSummary = state.rejections
      .slice(-20)
      .map(r => r.pattern || r.description || r.action)
      .filter(Boolean)
      .join("; ");
    if (rejectSummary) {
      prompt += `\n\nRejected intents (do not regenerate these): ${rejectSummary}`;
    }
  }

  return prompt;
}
