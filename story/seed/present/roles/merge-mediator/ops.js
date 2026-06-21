// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// merge-mediator ops.
//
// V1: empty. The mediator stamps reconciliation facts via existing
// state-setting DO ops (set-being, set-matter, set-space, wake-
// scheduled, etc.) with a `params._merge` block for forensic audit.
// No new fact action vocabulary . the chain stays honest about what
// happened.
//
// If future work introduces merge-specific orchestration helpers
// (e.g., a single "merge:take-A" op that copies side A's last fact
// to the merged branch with the right metadata), they live here
// alongside genesis-loaded role.

import log from "../../../seedStory/log.js";

export function registerMergeMediatorOps() {
  // No ops to register today. The entry-point shape exists so
  // genesis.js can import + call this uniformly with role-manager,
  // llm-assigner, and history-manager.
  log.verbose("merge-mediator", "no DO ops registered (mediator uses normal state-setting ops with params._merge)");
}
