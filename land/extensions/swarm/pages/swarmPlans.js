/**
 * /api/v1/root/:rootId/swarm-plans page.
 *
 * Read only view of the project's current plan + archived plans ring.
 * Reads from the unified metadata.plan namespace via the plan
 * extension. Filters to branch kind steps for the legacy "swarm
 * plans" framing (this page is about decomposition, not local
 * checklist steps).
 */

import Node from "../../../seed/models/node.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBranchRow(b) {
  const status = esc(b.status || "?");
  const path = b.path ? `<span class="sb-meta">· ${esc(b.path)}</span>` : "";
  const files = Array.isArray(b.files) && b.files.length
    ? `<span class="sb-meta">· ${esc(b.files.slice(0, 4).join(", "))}${b.files.length > 4 ? ` +${b.files.length - 4}` : ""}</span>`
    : "";
  const spec = b.spec ? `<div class="sb-spec">${esc(b.spec.slice(0, 300))}${b.spec.length > 300 ? "…" : ""}</div>` : "";
  const err = b.error ? `<div class="sb-err">⚠ ${esc(b.error.slice(0, 200))}</div>` : "";
  const nodeId = b.childNodeId || b.nodeId;
  const name = b.title || b.name || "?";
  const nameHtml = nodeId
    ? `<a class="sb-name sb-name-link" href="/api/v1/node/${esc(nodeId)}?html">${esc(name)}</a>`
    : `<span class="sb-name">${esc(name)}</span>`;
  return `
    <div class="sb-row sb-status-${status}">
      <div class="sb-head">
        ${nameHtml}
        <span class="sb-status">${status}</span>
        ${path}
        ${files}
      </div>
      ${spec}
      ${err}
    </div>`;
}

function renderPlanBlock(title, plan, meta) {
  if (!plan) {
    return `<section class="sp-section"><h2>${esc(title)}</h2><p class="sp-empty">No plan recorded.</p></section>`;
  }
  // Accept both new shape (steps[] with kind=branch) and snapshots from
  // archive that may use either shape.
  const steps = Array.isArray(plan.steps) ? plan.steps.filter(s => s.kind === "branch") : [];
  const branches = steps.length > 0 ? steps : (Array.isArray(plan.branches) ? plan.branches : []);
  const version = plan.version != null ? `v${plan.version}` : "";
  const created = plan.createdAt ? new Date(plan.createdAt).toLocaleString() : "";
  const counts = branches.reduce((acc, b) => {
    const s = b?.status || "unknown";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const countBar = Object.entries(counts)
    .map(([s, n]) => `<span class="sp-count sp-count-${esc(s)}">${n} ${esc(s)}</span>`)
    .join(" ");
  const extra = meta ? `<span class="sp-meta">${esc(meta)}</span>` : "";
  return `
    <section class="sp-section">
      <h2>${esc(title)} <span class="sp-version">${esc(version)}</span> ${extra}</h2>
      <div class="sp-meta">${created}</div>
      <div class="sp-counts">${countBar || "<span class=\"sp-count sp-count-empty\">no branches</span>"}</div>
      <div class="sp-branches">${branches.map(renderBranchRow).join("")}</div>
    </section>`;
}

export async function renderSwarmPlansPage({ rootId }) {
  const node = await Node.findById(rootId).select("metadata name").lean();
  if (!node) return `<h1>Not found</h1><p>No project at ${esc(rootId)}.</p>`;
  const planMeta = node.metadata instanceof Map
    ? node.metadata.get("plan")
    : node.metadata?.plan;
  const current = planMeta || null;
  const archived = Array.isArray(planMeta?.archivedPlans) ? planMeta.archivedPlans : [];

  const css = `
    body { background: #0c0f14; color: #e8ecf1; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; margin: 0; padding: 24px; line-height: 1.55; }
    h1 { font-size: 22px; margin: 0 0 6px 0; }
    h2 { font-size: 15px; margin: 0 0 8px 0; color: rgba(200,220,255,0.9); }
    h1 .subtle { color: rgba(255,255,255,0.5); font-weight: 400; font-size: 14px; margin-left: 8px; }
    .sp-section { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 16px 20px; margin: 16px 0; }
    .sp-section.archived { opacity: 0.85; }
    .sp-version { font-size: 11px; color: rgba(200,220,255,0.7); font-weight: 500; }
    .sp-meta { font-size: 11px; color: rgba(255,255,255,0.45); margin-bottom: 8px; }
    .sp-counts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
    .sp-count { background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; letter-spacing: 0.3px; }
    .sp-count-done { background: rgba(125,220,155,0.18); color: rgba(155,235,180,0.95); }
    .sp-count-running { background: rgba(255,200,120,0.2); color: rgba(255,220,160,0.95); }
    .sp-count-failed { background: rgba(240,130,130,0.2); color: rgba(255,160,160,0.95); }
    .sp-count-paused { background: rgba(200,180,120,0.2); }
    .sp-count-pending, .sp-count-pending-approval, .sp-count-pending-nested-approval { background: rgba(140,180,240,0.2); color: rgba(180,210,255,0.95); }
    .sp-count-archived, .sp-count-empty { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.4); }
    .sp-branches { display: flex; flex-direction: column; gap: 4px; }
    .sb-row { background: rgba(0,0,0,0.18); border-radius: 6px; padding: 6px 10px; border-left: 3px solid rgba(255,255,255,0.1); }
    .sb-row.sb-status-done { border-left-color: rgba(125,220,155,0.7); }
    .sb-row.sb-status-running { border-left-color: rgba(255,200,120,0.7); }
    .sb-row.sb-status-failed { border-left-color: rgba(240,130,130,0.7); }
    .sb-row.sb-status-paused { border-left-color: rgba(200,180,120,0.7); }
    .sb-head { display: flex; align-items: baseline; gap: 10px; font-size: 12px; font-family: 'SF Mono', 'Fira Code', monospace; }
    .sb-name { font-weight: 600; color: rgba(200,220,255,0.95); }
    .sb-name-link { text-decoration: none; }
    .sb-name-link:hover { text-decoration: underline; color: rgba(220,240,255,1); }
    .sb-status { font-size: 10px; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 0.5px; }
    .sb-meta { color: rgba(255,255,255,0.45); font-size: 11px; }
    .sb-spec { font-size: 11px; color: rgba(255,255,255,0.7); margin-top: 4px; line-height: 1.55; }
    .sb-err { font-size: 11px; color: rgba(240,130,130,0.85); margin-top: 4px; }
    details summary { cursor: pointer; user-select: none; padding: 4px 0; color: rgba(255,255,255,0.7); }
    details[open] summary { margin-bottom: 8px; }
    .sp-empty { color: rgba(255,255,255,0.45); font-style: italic; }
  `;

  const currentBlock = renderPlanBlock("Current plan", current);
  const archiveBlocks = archived.length > 0
    ? `<h2 style="margin-top:24px">Archived plans (${archived.length})</h2>` +
      archived
        .slice()
        .reverse()
        .map((a) => `
          <details class="sp-section archived">
            <summary>${esc(a.reason || "archived")} · ${a.archivedAt ? new Date(a.archivedAt).toLocaleString() : ""} · ${Array.isArray(a.snapshot?.steps) ? a.snapshot.steps.filter(s => s.kind === "branch").length : 0} branches</summary>
            ${renderPlanBlock("Snapshot", a.snapshot, esc(a.reason || ""))}
          </details>`)
        .join("")
    : "";

  return `
<!doctype html>
<html><head><meta charset="utf-8"><title>Swarm plans · ${esc(node.name || rootId)}</title>
<style>${css}</style>
</head>
<body>
  <h1>Swarm plans <span class="subtle">${esc(node.name || "")}</span></h1>
  ${currentBlock}
  ${archiveBlocks}
</body></html>`;
}
