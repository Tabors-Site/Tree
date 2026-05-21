import {
  startTreeDreamJob,
  stopTreeDreamJob,
  runTreeDreamJob,
  setMetadata as setDreamMetadata,
} from "./treeDream.js";
import router from "./routes.js";

import cleanupAnalyze from "./modes/cleanupAnalyze.js";
import cleanupExpandScan from "./modes/cleanupExpandScan.js";
import drainCluster from "./modes/drainCluster.js";
import drainScout from "./modes/drainScout.js";
import drainPlan from "./modes/drainPlan.js";
import dreamSummary from "./modes/dreamSummary.js";
import dreamThought from "./modes/dreamThought.js";

export async function init(core) {
  setDreamMetadata(core.metadata);

  // Register dream/cleanup/drain modes + LLM slot mappings
  core.modes.registerMode("tree:cleanup-analyze", cleanupAnalyze, "dreams");
  core.modes.registerMode("tree:cleanup-expand-scan", cleanupExpandScan, "dreams");
  core.modes.registerMode("tree:drain-cluster", drainCluster, "dreams");
  core.modes.registerMode("tree:drain-scout", drainScout, "dreams");
  core.modes.registerMode("tree:drain-plan", drainPlan, "dreams");
  core.modes.registerMode("tree:dream-summary", dreamSummary, "dreams");
  core.modes.registerMode("tree:dream-thought", dreamThought, "dreams");
  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:cleanup-analyze", "cleanup");
    core.llm.registerModeAssignment("tree:cleanup-expand-scan", "cleanup");
    core.llm.registerModeAssignment("tree:drain-cluster", "drain");
    core.llm.registerModeAssignment("tree:drain-scout", "drain");
    core.llm.registerModeAssignment("tree:drain-plan", "drain");
    core.llm.registerModeAssignment("tree:dream-summary", "notification");
    core.llm.registerModeAssignment("tree:dream-thought", "notification");
    core.llm.registerRootLlmSlot?.("cleanup");
    core.llm.registerRootLlmSlot?.("drain");
    core.llm.registerRootLlmSlot?.("notification");
  }

  // Register tree overview slots
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("tree-dream", "dreams", ({ rootMeta, nodeId, token }) => {
      const dreamTime = rootMeta?.metadata?.dreams?.dreamTime || rootMeta?.metadata?.get?.("dreams")?.dreamTime || "";
      const lastDream = rootMeta?.metadata?.dreams?.lastDreamAt || rootMeta?.metadata?.get?.("dreams")?.lastDreamAt || null;
      return `<div class="content-card">
  <div class="section-header"><h2>Tree Dream</h2></div>
  <p style="color:rgba(255,255,255,0.7);font-size:0.85rem;margin:0 0 12px">
    Schedule a daily maintenance cycle: cleanup, process deferred items, and update tree understanding.
  </p>
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <input type="time" id="dreamTimeInput" value="${dreamTime}"
      style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);
             background:rgba(255,255,255,0.06);color:#fff;font-size:0.95rem" />
    <button onclick="saveDreamTime()" style="padding:8px 14px;border-radius:8px;
      border:1px solid rgba(72,187,120,0.4);background:rgba(72,187,120,0.15);
      color:rgba(72,187,120,0.9);font-weight:600;cursor:pointer">Save</button>
    <button onclick="clearDreamTime()" style="padding:8px 14px;border-radius:8px;
      border:1px solid rgba(255,107,107,0.4);background:rgba(255,107,107,0.1);
      color:rgba(255,107,107,0.8);cursor:pointer">Disable</button>
    <span id="dreamTimeStatus" style="display:none;font-size:0.85rem"></span>
  </div>
  ${lastDream ? `<p style="color:rgba(255,255,255,0.6);font-size:0.8rem;margin:8px 0 0">Last dream: ${new Date(lastDream).toLocaleString()}</p>` : ""}
</div>`;
    }, { priority: 20 });

    base?.exports?.registerSlot?.("tree-holdings", "dreams", ({ deferredItems, deferredHtml }) => {
      return `<div class="content-card">
  <div class="section-header">
    <h2>Short-Term Holdings ${(deferredItems?.length || 0) > 0 ? `<span style="font-size:0.7em;color:#ffb347;">(${deferredItems.length})</span>` : ""}</h2>
  </div>
  ${deferredHtml || '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.5);font-size:14px;">No short-term items</div>'}
</div>`;
    }, { priority: 10 });
  } catch {}

  return {
    router,
    jobs: [
      {
        name: "tree-dream",
        start: () => {
          startTreeDreamJob({ intervalMs: 30 * 60 * 1000 });
          runTreeDreamJob();
        },
        stop: () => stopTreeDreamJob(),
      },
    ],
  };
}
