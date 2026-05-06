/**
 * Plan panel slot renderer.
 *
 * Replaces the old swarm only plan panel. This one renders every step
 * kind (write, edit, branch, chapter, test, probe, note, plus any
 * extension defined kind via a generic fallback). Mounted on the node
 * detail page when the node has a non empty metadata.plan.steps.
 *
 * Branch kind steps link through to their child node's own plan
 * panel. Recursive. Self similar.
 *
 * Inline edit: click pencil on a row, textarea opens for title + spec
 * (if applicable), save PATCHes /api/v1/plan/node/:nodeId/steps/:stepId.
 */

import { NS } from "../state/planNode.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readPlanMeta(node) {
  const meta = node.metadata instanceof Map ? node.metadata.get(NS) : node.metadata?.[NS];
  return meta || null;
}

const KIND_ICONS = {
  write: "✎",
  edit: "✎",
  branch: "⎇",
  chapter: "📖",
  scene: "🎬",
  test: "🧪",
  probe: "🌐",
  note: "📝",
  task: "◆",
};

function iconFor(kind) {
  return KIND_ICONS[kind] || "◆";
}

/**
 * Per kind inline renderer. Returns the HTML for ONE step row.
 * Branch kind is more elaborate (edit + child link + generate button);
 * other kinds are a compact one liner with optional body.
 */
function renderStepRow(step, ctx) {
  const { qs, isPublicAccess, childrenIndex } = ctx;
  const status = esc(step.status || "pending");
  const title = esc(step.title || "");
  const kind = esc(step.kind || "task");
  const icon = iconFor(step.kind);
  const stepId = esc(step.id || "");
  const err = step.error ? `<div class="pp-err">⚠ ${esc(String(step.error).slice(0, 200))}</div>` : "";

  if (step.kind === "branch" || step.kind === "chapter" || step.kind === "scene") {
    const files = Array.isArray(step.files) ? step.files : [];
    const path = step.path || "";
    const spec = step.spec || "";
    const filesShort = files.length
      ? files.slice(0, 4).join(", ") + (files.length > 4 ? ` +${files.length - 4}` : "")
      : "";

    // Resolve the child from childrenIndex built by the caller.
    const childEntry = step.childNodeId
      ? childrenIndex.get(String(step.childNodeId)) || null
      : childrenIndex.get(step.title) || null;
    const childLink = childEntry?.nodeId
      ? `/api/v1/node/${childEntry.nodeId}?html${qs ? "&" + qs.slice(1) : ""}`
      : null;
    const childHasPlan = childEntry?.hasPlan;

    const actions = isPublicAccess ? "" : `
      <div class="pp-actions">
        <button class="pp-btn pp-edit" data-step="${stepId}">✏ Edit</button>
        ${childHasPlan && childLink
          ? `<a class="pp-btn pp-child" href="${childLink}">▸ Open plan</a>`
          : (childLink
              ? `<a class="pp-btn pp-child-empty" href="${childLink}">▸ Open node</a>`
              : `<span class="pp-meta">no child node</span>`)}
      </div>`;

    return `
      <div class="pp-row pp-kind-${kind} pp-status-${status}" data-step="${stepId}">
        <div class="pp-head">
          <span class="pp-icon">${icon}</span>
          <span class="pp-name">${title}</span>
          <span class="pp-status">${status}</span>
          ${path ? `<span class="pp-meta">· ${esc(path)}</span>` : ""}
          ${filesShort ? `<span class="pp-meta">· ${esc(filesShort)}</span>` : ""}
        </div>
        ${spec ? `<div class="pp-spec">${esc(spec)}</div>` : ""}
        ${err}
        ${actions}
        <div class="pp-edit-form" hidden data-step="${stepId}">
          <label>Title
            <input class="pp-input-title" type="text" value="${esc(step.title || "")}">
          </label>
          <label>Spec
            <textarea class="pp-input-spec" rows="3">${esc(spec)}</textarea>
          </label>
          <label>Files (comma separated)
            <input class="pp-input-files" type="text" value="${esc(files.join(", "))}">
          </label>
          <div class="pp-edit-actions">
            <button class="pp-btn pp-save" data-step="${stepId}">Save</button>
            <button class="pp-btn pp-cancel" data-step="${stepId}">Cancel</button>
          </div>
        </div>
      </div>`;
  }

  if (step.kind === "test" || step.kind === "probe") {
    const extra = step.command || step.url || "";
    const output = step.output || step.response || "";
    return `
      <div class="pp-row pp-kind-${kind} pp-status-${status}" data-step="${stepId}">
        <div class="pp-head">
          <span class="pp-icon">${icon}</span>
          <span class="pp-name">${title}</span>
          <span class="pp-status">${status}</span>
          ${extra ? `<span class="pp-meta">· ${esc(String(extra).slice(0, 80))}</span>` : ""}
        </div>
        ${output ? `<div class="pp-spec">${esc(String(output).slice(0, 300))}</div>` : ""}
        ${err}
      </div>`;
  }

  if (step.kind === "note") {
    const body = step.body || "";
    return `
      <div class="pp-row pp-kind-${kind} pp-status-${status}" data-step="${stepId}">
        <div class="pp-head">
          <span class="pp-icon">${icon}</span>
          <span class="pp-name">${title}</span>
        </div>
        ${body ? `<div class="pp-spec">${esc(String(body).slice(0, 400))}</div>` : ""}
      </div>`;
  }

  // write, edit, task, and any unknown kind: compact generic row.
  const filePath = step.filePath || step.file || "";
  const bytes = step.bytes != null ? ` (${step.bytes}b)` : "";
  return `
    <div class="pp-row pp-kind-${kind} pp-status-${status}" data-step="${stepId}">
      <div class="pp-head">
        <span class="pp-icon">${icon}</span>
        <span class="pp-name">${title}</span>
        <span class="pp-status">${status}</span>
        ${filePath ? `<span class="pp-meta">· ${esc(filePath)}${bytes}</span>` : ""}
      </div>
      ${step.blockedReason ? `<div class="pp-err">⚠ blocked: ${esc(step.blockedReason.slice(0, 200))}</div>` : ""}
      ${err}
    </div>`;
}

/**
 * Resolve plan steps + count summary for the panel from the active
 * execution-record at the parent Ruler scope. The panel mounts on a
 * plan-type node; that node's parent is the Ruler. The Ruler holds
 * the executionApprovals ledger pointing at the active record, whose
 * stepStatuses[] is the source of truth for status display.
 *
 * Returns { steps, countBuckets } in the legacy renderStepRow shape
 * so the existing per-row template keeps working unchanged.
 */
/**
 * Walk the active execution-record under a Ruler scope plus all
 * descendant Ruler scopes' active records, summing status counts.
 * Powers the panel's "Including descendants:" trailer line.
 */
async function readRollupFromExecutionRecord(rulerNodeId) {
  if (!rulerNodeId) return null;
  try {
    const { getExtension } = await import("../../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.readActiveExecutionRecord) return null;

    const counts = { pending: 0, running: 0, done: 0, blocked: 0, failed: 0, paused: 0, total: 0 };
    const visited = new Set();

    const walk = async (scopeId, depth) => {
      if (depth > 16) return;
      const idStr = String(scopeId);
      if (visited.has(idStr)) return;
      visited.add(idStr);
      const record = await governing.readActiveExecutionRecord(scopeId);
      if (!record) return;
      for (const step of (record.stepStatuses || [])) {
        if (step?.type === "leaf") {
          const k = step.status || "pending";
          if (k in counts) counts[k]++;
          counts.total++;
        } else if (step?.type === "branch" && Array.isArray(step.branches)) {
          for (const entry of step.branches) {
            const k = entry.status || "pending";
            if (k in counts) counts[k]++;
            counts.total++;
            if (entry.childNodeId) await walk(entry.childNodeId, depth + 1);
          }
        }
      }
    };
    await walk(rulerNodeId, 0);
    return counts;
  } catch {
    return null;
  }
}

async function readStepsFromExecutionRecord(planNode) {
  if (!planNode?.parent) return { steps: [], countBuckets: {} };
  try {
    const { getExtension } = await import("../../loader.js");
    const governing = getExtension("governing")?.exports;
    if (!governing?.readActiveExecutionRecord) return { steps: [], countBuckets: {} };
    const record = await governing.readActiveExecutionRecord(planNode.parent);
    if (!record) return { steps: [], countBuckets: {} };

    const out = [];
    const counts = {};
    for (const step of (record.stepStatuses || [])) {
      if (step?.type === "leaf") {
        const status = step.status || "pending";
        counts[status] = (counts[status] || 0) + 1;
        out.push({
          id: `step-${step.stepIndex}`,
          kind: "leaf",
          title: (step.spec || "").slice(0, 80),
          status,
          error: step.error || null,
          blockedReason: step.blockedReason || null,
        });
      } else if (step?.type === "branch" && Array.isArray(step.branches)) {
        for (const entry of step.branches) {
          const status = entry.status || "pending";
          counts[status] = (counts[status] || 0) + 1;
          out.push({
            id: `step-${step.stepIndex}-${entry.name}`,
            kind: "branch",
            title: entry.name,
            status,
            childNodeId: entry.childNodeId || null,
            error: entry.error || null,
            blockedReason: entry.blockedReason || null,
          });
        }
      }
    }
    return { steps: out, countBuckets: counts };
  } catch {
    return { steps: [], countBuckets: {} };
  }
}

export async function renderPlanPanel({ node, nodeId, qs, isPublicAccess }) {
  try {
    if (!node) return "";

    const { steps, countBuckets } = await readStepsFromExecutionRecord(node);
    if (steps.length === 0) return "";

    // Pre index direct children by BOTH _id and name so branch / chapter
    // rows can resolve their "open plan" links quickly. The plan-type
    // node is a sibling of the Ruler's other children; we look at the
    // RULER's children (the plan node's siblings) to find branch
    // childNodeId targets.
    const childrenIndex = new Map();
    try {
      const Node = (await import("../../../seed/models/node.js")).default;
      const rulerNode = await Node.findById(node.parent).select("_id children").lean();
      if (rulerNode && Array.isArray(rulerNode.children) && rulerNode.children.length > 0) {
        const kids = await Node.find({ _id: { $in: rulerNode.children } })
          .select("_id name metadata.governing")
          .lean();
        for (const k of kids) {
          const kgov = k.metadata instanceof Map ? k.metadata.get("governing") : k.metadata?.governing;
          const hasPlan = kgov?.role === "ruler";
          const entry = { nodeId: String(k._id), hasPlan };
          childrenIndex.set(String(k._id), entry);
          childrenIndex.set(k.name, entry);
        }
      }
    } catch {}

    const countBar = Object.entries(countBuckets)
      .map(([s, n]) => `<span class="pp-count pp-count-${esc(s)}">${n} ${esc(s)}</span>`)
      .join(" ");

    const rows = steps
      .map((s) => renderStepRow(s, { qs, isPublicAccess, childrenIndex }))
      .join("");

    const archivedLabel = "";
    const version = "";

    // Rollup line: aggregated across this scope + descendant Rulers'
    // execution-records. Computed by walking the active records under
    // the parent Ruler scope.
    const rollupCounts = await readRollupFromExecutionRecord(node.parent);
    const rollup = rollupCounts && rollupCounts.total > 0 ? rollupCounts : null;
    const rollupLine = rollup
      ? `<div class="pp-rollup">Including descendants: ${rollup.done || 0} done, ${rollup.running || 0} running, ${rollup.pending || 0} pending, ${rollup.blocked || 0} blocked, ${rollup.failed || 0} failed</div>`
      : "";

    const script = isPublicAccess ? "" : `
      <script>
        (function() {
          var panel = document.currentScript.previousElementSibling;
          if (!panel) return;
          panel.addEventListener("click", async function(ev) {
            var t = ev.target;
            if (!t || !t.classList) return;
            var row = t.closest(".pp-row");
            var stepId = t.getAttribute("data-step") || (row && row.getAttribute("data-step"));
            if (!stepId) return;

            if (t.classList.contains("pp-edit")) {
              var form = row.querySelector(".pp-edit-form");
              if (form) form.hidden = false;
              t.hidden = true;
              return;
            }
            if (t.classList.contains("pp-cancel")) {
              var form = row.querySelector(".pp-edit-form");
              if (form) form.hidden = true;
              var btn = row.querySelector(".pp-edit");
              if (btn) btn.hidden = false;
              return;
            }
            if (t.classList.contains("pp-save")) {
              var form = row.querySelector(".pp-edit-form");
              var patch = {};
              var titleIn = form.querySelector(".pp-input-title");
              var specIn = form.querySelector(".pp-input-spec");
              var filesIn = form.querySelector(".pp-input-files");
              if (titleIn) patch.title = titleIn.value;
              if (specIn) patch.spec = specIn.value;
              if (filesIn) {
                patch.files = filesIn.value
                  .split(",").map(function(s){return s.trim();}).filter(Boolean);
              }
              t.disabled = true;
              try {
                var res = await fetch("/api/v1/plan/node/${nodeId}/steps/" + encodeURIComponent(stepId), {
                  method: "PATCH",
                  headers: {"Content-Type":"application/json"},
                  body: JSON.stringify(patch),
                  credentials: "include",
                });
                if (!res.ok) { t.disabled = false; alert("Save failed: " + res.status); return; }
                window.location.reload();
              } catch (e) { t.disabled = false; alert("Save failed: " + e.message); }
              return;
            }
          });
        })();
      </script>`;

    return `
      <section class="plan-panel" data-slot="node-detail-sections" data-ext="plan">
        <h2 class="pp-title">Plan <span class="pp-version">${esc(version)}</span>
          <span class="pp-meta">· ${steps.length} step${steps.length === 1 ? "" : "s"}</span>
          ${archivedLabel}
        </h2>
        <div class="pp-counts">${countBar}</div>
        <div class="pp-rows">${rows}</div>
        ${rollupLine}
      </section>
      ${script}
      <style>
        .plan-panel { background: rgba(140,180,240,0.05); border: 1px solid rgba(140,180,240,0.2); border-radius: 10px; padding: 14px 18px; margin: 16px 0; }
        .pp-title { font-size: 15px; margin: 0 0 6px 0; color: rgba(200,220,255,0.9); }
        .pp-version { font-size: 11px; color: rgba(200,220,255,0.7); font-weight: 500; }
        .pp-meta { font-size: 11px; color: rgba(255,255,255,0.5); font-weight: 400; margin-left: 4px; }
        .pp-link { color: rgba(160,210,255,0.85); }
        .pp-counts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
        .pp-count { background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; letter-spacing: 0.3px; }
        .pp-count-done { background: rgba(125,220,155,0.18); color: rgba(155,235,180,0.95); }
        .pp-count-running { background: rgba(255,200,120,0.2); color: rgba(255,220,160,0.95); }
        .pp-count-failed { background: rgba(240,130,130,0.2); color: rgba(255,160,160,0.95); }
        .pp-count-paused { background: rgba(200,180,120,0.2); }
        .pp-count-pending, .pp-count-pending-approval, .pp-count-pending-nested-approval { background: rgba(140,180,240,0.2); color: rgba(180,210,255,0.95); }
        .pp-count-blocked { background: rgba(200,120,200,0.2); color: rgba(230,180,230,0.95); }
        .pp-count-archived { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.4); }
        .pp-rows { display: flex; flex-direction: column; gap: 6px; }
        .pp-row { background: rgba(0,0,0,0.18); border-left: 3px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 8px 12px; }
        .pp-row.pp-status-done { border-left-color: rgba(125,220,155,0.7); }
        .pp-row.pp-status-running { border-left-color: rgba(255,200,120,0.7); }
        .pp-row.pp-status-failed { border-left-color: rgba(240,130,130,0.7); }
        .pp-row.pp-status-paused { border-left-color: rgba(200,180,120,0.7); }
        .pp-row.pp-status-blocked { border-left-color: rgba(200,120,200,0.7); }
        .pp-head { display: flex; align-items: baseline; gap: 10px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; flex-wrap: wrap; }
        .pp-icon { font-size: 13px; opacity: 0.9; }
        .pp-name { font-weight: 600; color: rgba(200,220,255,0.95); }
        .pp-status { font-size: 10px; color: rgba(255,255,255,0.55); text-transform: uppercase; letter-spacing: 0.5px; }
        .pp-spec { font-size: 11px; color: rgba(255,255,255,0.75); margin-top: 4px; line-height: 1.55; }
        .pp-err { font-size: 11px; color: rgba(240,130,130,0.85); margin-top: 4px; }
        .pp-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
        .pp-btn { padding: 4px 10px; font-size: 11px; font-weight: 600; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.85); cursor: pointer; text-decoration: none; display: inline-block; }
        .pp-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.4); }
        .pp-btn:disabled { opacity: 0.5; cursor: wait; }
        .pp-btn.pp-child { background: rgba(125,220,155,0.12); border-color: rgba(125,220,155,0.4); }
        .pp-btn.pp-child-empty { background: rgba(140,180,240,0.12); border-color: rgba(140,180,240,0.4); }
        .pp-btn.pp-save { background: rgba(125,220,155,0.18); border-color: rgba(125,220,155,0.5); }
        .pp-edit-form { margin-top: 8px; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; display: flex; flex-direction: column; gap: 8px; }
        .pp-edit-form label { display: flex; flex-direction: column; gap: 4px; font-size: 10px; color: rgba(255,255,255,0.55); letter-spacing: 0.5px; text-transform: uppercase; }
        .pp-edit-form textarea, .pp-edit-form input[type="text"] {
          width: 100%; box-sizing: border-box;
          background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.9);
          border: 1px solid rgba(255,255,255,0.15); border-radius: 4px;
          padding: 6px 8px; font-family: inherit; font-size: 12px;
        }
        .pp-edit-actions { display: flex; gap: 6px; }
        .pp-rollup { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08); }
      </style>`;
  } catch (err) {
    return `<!-- plan panel render error: ${esc(err.message)} -->`;
  }
}
