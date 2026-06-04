// branch-bar.js — branch + time navigation for the 3D portal.
//
// Three pieces of UI:
//
//   1. Top-left "🌿 branches" button. Always visible. Click opens the
//      branch tree panel.
//
//   2. Branch tree panel. Centered overlay. Shows every branch (main +
//      children) as a tree, with fork points at their anchors. Click a
//      branch to enter its timeline; close to dismiss without
//      switching.
//
//   3. Timeline strip. Bottom-pinned. Opens when a branch is selected
//      from the tree panel. Wall-clock axis from place genesis to
//      "now" — every dot is one of YOUR moments. Click to rewind;
//      "branch here" forks at the selected instant; the strip's [×]
//      closes and returns to live present.
//
// Doctrine: past is observer-only. The portal's _ghostGuard blocks
// every DO/SUMMON/BE while desc.isHistorical is true; the camera
// still moves locally.

let _state = {
  client:        null,
  reality:       null,
  buttonEl:      null,
  panelEl:       null,
  timelineEl:    null,
  panelOpen:     false,
  // Branch the timeline strip is bound to (may differ from the user's
  // active address-branch — they could pull up main's timeline while
  // standing in #1).
  timelineBranch: null,
  graph:         null,    // { current, lineage, children } for active branch
  graphAll:      null,    // full tree { byPath: Map, roots: [] }
  marks:         [],      // [{ ts, seq, label }] for active timeline
  firstTs:       null,
  nowTs:         null,
  atTimestamp:   null,    // null = present
};

export function mountBranchBar({ client, reality }) {
  _state.client = client;
  _state.reality = reality;
  _state.buttonEl = _createBranchButton();
  document.body.appendChild(_state.buttonEl);
  // Click outside the panel closes it. Bound once.
  document.addEventListener("click", (ev) => {
    if (!_state.panelOpen) return;
    if (_state.panelEl?.contains(ev.target)) return;
    if (_state.buttonEl?.contains(ev.target)) return;
    _closePanel();
  });
  // Esc closes whichever overlay is open (panel first, then timeline).
  window.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (_state.panelOpen) { _closePanel(); return; }
    if (_state.timelineEl) { _closeTimeline(); }
  });
  return {
    update: (desc) => _update(desc),
  };
}

// ─────────────────────────────────────────────────────────────────────
// TOP-LEFT BUTTON
// ─────────────────────────────────────────────────────────────────────

function _createBranchButton() {
  const b = document.createElement("button");
  b.id = "branch-tree-button";
  b.type = "button";
  b.title = "branches & timeline";
  b.textContent = "🌿";
  b.style.cssText = [
    "position: fixed",
    "top: 56px",
    "left: 12px",
    "z-index: 12",
    "pointer-events: auto",
    "background: rgba(10, 13, 12, 0.85)",
    "color: #c8d3cb",
    "border: 1px solid #2c3a32",
    "border-radius: 6px",
    "padding: 6px 10px",
    "font-family: ui-monospace, monospace",
    "font-size: 14px",
    "cursor: pointer",
    "transition: border-color 80ms, color 80ms",
  ].join(";");
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (_state.panelOpen) _closePanel();
    else _openPanel();
  });
  b.addEventListener("mouseenter", () => {
    b.style.borderColor = "#8fbf9f";
    b.style.color = "#8fbf9f";
  });
  b.addEventListener("mouseleave", () => {
    b.style.borderColor = "#2c3a32";
    b.style.color = "#c8d3cb";
  });
  return b;
}

// ─────────────────────────────────────────────────────────────────────
// BRANCH TREE PANEL (centered modal-style)
// ─────────────────────────────────────────────────────────────────────

async function _openPanel() {
  _state.panelOpen = true;
  if (_state.panelEl) _state.panelEl.remove();
  const el = document.createElement("div");
  el.id = "branch-tree-panel";
  el.style.cssText = [
    "position: fixed",
    "top: 100px",
    "left: 50%",
    "transform: translateX(-50%)",
    "width: min(640px, 90vw)",
    "max-height: 70vh",
    "overflow: auto",
    "background: rgba(10, 13, 12, 0.95)",
    "backdrop-filter: blur(4px)",
    "border: 1px solid #2c3a32",
    "border-radius: 8px",
    "color: #c8d3cb",
    "font-family: ui-monospace, monospace",
    "font-size: 12px",
    "z-index: 12",
    "padding: 14px 16px",
    "pointer-events: auto",
  ].join(";");
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="color:#8fbf9f;">branch tree</span>
      <button type="button" class="bp-close" style="background:transparent;color:#6b7d72;border:none;font-size:18px;cursor:pointer;padding:0 4px;">×</button>
    </div>
    <div class="bp-tree" style="font-size:12px;line-height:1.7;"></div>
    <div style="margin-top:12px;color:#6b7d72;font-size:10px;">click a branch to open its timeline · esc to close</div>
  `;
  document.body.appendChild(el);
  _state.panelEl = el;
  el.querySelector(".bp-close").addEventListener("click", _closePanel);

  // Fetch every branch in one pass.
  const tree = await _loadBranchTree();
  _state.graphAll = tree;
  _renderTree(el.querySelector(".bp-tree"), tree);
}

function _closePanel() {
  _state.panelOpen = false;
  if (_state.panelEl) {
    _state.panelEl.remove();
    _state.panelEl = null;
  }
}

// Fetch the full branch tree by SEEing `.branches/0` (which gives main +
// its immediate children) then recursively fetching each child branch.
// Caps depth at 6 levels to avoid pathological deep trees.
async function _loadBranchTree() {
  const byPath = new Map();
  const roots = [];
  const seen = new Set();
  async function visit(path, depth) {
    if (depth > 6 || seen.has(path)) return;
    seen.add(path);
    try {
      const catalog = await _state.client.see(
        `${_state.reality}/.branches/${path}`,
      );
      const g = catalog?.branches;
      if (!g) return;
      if (g.current) byPath.set(g.current.path, g.current);
      for (const ch of (g.children || [])) {
        byPath.set(ch.path, ch);
      }
      if (path === "0") {
        roots.push(g.current || { path: "0", label: "main" });
      }
      for (const ch of (g.children || [])) {
        await visit(ch.path, depth + 1);
      }
    } catch (err) {
      // ignore subtree fetch failures; the partial tree still renders
    }
  }
  await visit("0", 0);
  return { byPath, roots };
}

function _renderTree(container, tree) {
  container.innerHTML = "";
  if (!tree || tree.byPath.size === 0) {
    container.textContent = "no branches available";
    return;
  }
  // Children map: parent path → child branches list.
  const childrenOf = new Map();
  for (const b of tree.byPath.values()) {
    const parentKey = b.parent || "0";
    if (b.path === "0") continue;
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
    childrenOf.get(parentKey).push(b);
  }
  function render(branch, indent) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;padding-left:" + (indent * 16) + "px;";
    const chip = _branchChip(branch);
    row.appendChild(chip);
    const meta = document.createElement("span");
    meta.style.cssText = "color:#6b7d72;font-size:10px;";
    const parts = [];
    if (branch.label && branch.label !== `main` && branch.label !== `#${branch.path}`) {
      parts.push(branch.label);
    }
    if (branch.createdAt) parts.push(_shortStamp(branch.createdAt));
    if (branch.anchor) {
      const anchorEntries = Object.entries(branch.anchor || {}).slice(0, 1);
      if (anchorEntries.length) {
        const [, seq] = anchorEntries[0];
        parts.push(`anchor seq=${seq}`);
      }
    }
    if (branch.paused) parts.push("PAUSED");
    meta.textContent = parts.length ? "  " + parts.join(" · ") : "";
    if (branch.paused) meta.style.color = "#e8b762";
    row.appendChild(meta);
    // Pause/unpause control. Every branch including main is
    // pauseable — the wire-layer gate exempts unpause-branch and
    // create-branch, so a fully-frozen reality can always be revived
    // by clicking unpause here or by forking off a paused branch.
    {
      const action = document.createElement("button");
      action.type = "button";
      action.textContent = branch.paused ? "▶ unpause" : "❚❚ pause";
      action.style.cssText = [
        "background: " + (branch.paused ? "#13201b" : "#2a1f0a"),
        "color: "      + (branch.paused ? "#8fbf9f" : "#e8b762"),
        "border: 1px solid " + (branch.paused ? "#3d7a52" : "#6b5320"),
        "border-radius: 3px",
        "padding: 2px 8px",
        "margin-left: auto",
        "font-family: inherit",
        "font-size: 10px",
        "cursor: pointer",
      ].join(";");
      action.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        await _togglePauseBranch(branch);
      });
      row.appendChild(action);
    }
    container.appendChild(row);
    const kids = childrenOf.get(branch.path) || [];
    for (const k of kids) render(k, indent + 1);
  }
  for (const root of tree.roots) {
    render(root, 0);
  }
}

async function _togglePauseBranch(branch) {
  const op = branch.paused ? "unpause-branch" : "pause-branch";
  // Optimistic local flip so the button changes the instant the user
  // clicks — no waiting for the DO + tree refetch round-trip. The
  // server-confirmed state replaces it on the subsequent refetch; if
  // the DO fails the catch path restores and surfaces the error.
  const prevPaused = !!branch.paused;
  branch.paused = !prevPaused;
  if (_state.panelEl) {
    const treeContainer = _state.panelEl.querySelector(".bp-tree");
    if (treeContainer) _renderTree(treeContainer, _state.graphAll);
  }
  // If the user just paused (or unpaused) the branch they themselves
  // are currently on, flip the grayscale chrome immediately so the
  // visual cue matches the new reality without waiting for navigate.
  const myBranch = window.state?.descriptor?.address?.branch || "0";
  if (branch.path === myBranch) {
    window.dispatchEvent(new CustomEvent("branchbar:paused-self", {
      detail: { paused: branch.paused },
    }));
  }

  // Route through the caller's own current branch so the DO stays
  // single-branch (cross-branch gate refuses otherwise). The
  // branch-manager being folds via lineage so it's reachable from any
  // branch's slot.
  const callerBq = myBranch === "0" ? "" : `#${myBranch}`;
  try {
    await _state.client.do(
      `${_state.reality}${callerBq}/@branch-manager`,
      op,
      { branch: branch.path },
    );
    // Refetch the tree so the row's persisted state replaces our
    // optimistic flip (no-op when they match).
    await _loadBranchTree();
    if (_state.panelEl) {
      const treeContainer = _state.panelEl.querySelector(".bp-tree");
      if (treeContainer) _renderTree(treeContainer, _state.graphAll);
    }
    _showBranchEvent(
      branch.paused
        ? `❚❚ paused #${branch.path === "0" ? "main" : branch.path}`
        : `▶ unpaused #${branch.path === "0" ? "main" : branch.path}`,
    );
  } catch (err) {
    // Revert the optimistic flip and surface the error.
    branch.paused = prevPaused;
    if (_state.panelEl) {
      const treeContainer = _state.panelEl.querySelector(".bp-tree");
      if (treeContainer) _renderTree(treeContainer, _state.graphAll);
    }
    if (branch.path === myBranch) {
      window.dispatchEvent(new CustomEvent("branchbar:paused-self", {
        detail: { paused: prevPaused },
      }));
    }
    console.warn(`[branch-bar] ${op} failed:`, err?.message || err);
    _showBranchEvent(`${op} failed: ${err?.message || err}`, { error: true });
  }
}

function _branchChip(branch) {
  const isMain = branch.path === "0";
  const label = isMain ? "main" : `#${branch.path}`;
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = [
    "background: " + (isMain ? "#13201b" : "#2a1f0a"),
    "color: "      + (isMain ? "#8fbf9f" : "#e8b762"),
    "border: 1px solid " + (isMain ? "#3d7a52" : "#6b5320"),
    "border-radius: 12px",
    "padding: 2px 12px",
    "font-family: inherit",
    "font-size: 11px",
    "cursor: pointer",
  ].join(";");
  b.title = "open this branch's timeline";
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    _closePanel();
    _openTimeline(branch.path);
  });
  return b;
}

// ─────────────────────────────────────────────────────────────────────
// TIMELINE STRIP (bottom-pinned, branch-specific)
// ─────────────────────────────────────────────────────────────────────

async function _openTimeline(branchPath) {
  _closeTimeline();
  _state.timelineBranch = branchPath;
  const el = document.createElement("div");
  el.id = "branch-timeline";
  el.style.cssText = [
    "position: fixed",
    "left: 50%",
    "transform: translateX(-50%)",
    "bottom: 100px",
    "width: min(960px, 90vw)",
    "padding: 8px 14px",
    "background: rgba(10, 13, 12, 0.9)",
    "backdrop-filter: blur(2px)",
    "border: 1px solid #2c3a32",
    "border-radius: 8px",
    "color: #c8d3cb",
    "font-family: ui-monospace, monospace",
    "font-size: 11px",
    "z-index: 11",
    "pointer-events: auto",
    "display: flex",
    "flex-direction: column",
    "gap: 6px",
  ].join(";");
  el.innerHTML = `
    <div class="bt-head" style="display:flex;justify-content:space-between;align-items:center;">
      <span class="bt-label" style="color:#8fbf9f;"></span>
      <button type="button" class="bt-close" style="background:transparent;color:#6b7d72;border:none;font-size:14px;cursor:pointer;padding:0 4px;">×</button>
    </div>
    <div class="bt-strip" style="position:relative;height:22px;border-radius:11px;background:#131a17;border:1px solid #2c3a32;cursor:crosshair;">
      <div class="bt-track" style="position:absolute;left:10px;right:10px;top:50%;height:2px;background:#2c3a32;transform:translateY(-50%);"></div>
      <div class="bt-marks" style="position:absolute;left:10px;right:10px;top:0;bottom:0;"></div>
      <div class="bt-cursor" style="position:absolute;width:12px;height:12px;border-radius:50%;background:#e8b762;top:50%;transform:translate(-50%,-50%);right:10px;display:none;box-shadow:0 0 6px rgba(232,183,98,0.6);"></div>
      <span class="bt-label-left" style="position:absolute;left:10px;top:-14px;font-size:9px;color:#6b7d72;">genesis</span>
      <span class="bt-label-right" style="position:absolute;right:10px;top:-14px;font-size:9px;color:#6b7d72;">now</span>
    </div>
    <div class="bt-actions" style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
      <span class="bt-status" style="color:#6b7d72;">live</span>
      <span class="bt-buttons" style="display:flex;gap:6px;">
        <button class="bt-now" type="button" style="display:none;background:#131a17;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:3px 10px;font-family:inherit;font-size:11px;cursor:pointer;">return to now</button>
        <button class="bt-branch" type="button" style="display:none;background:#2a1f0a;color:#e8b762;border:1px solid #6b5320;border-radius:3px;padding:3px 10px;font-family:inherit;font-size:11px;cursor:pointer;">branch here</button>
      </span>
    </div>
  `;
  document.body.appendChild(el);
  _state.timelineEl = el;
  const branchLabel = branchPath === "0" ? "main" : `#${branchPath}`;
  el.querySelector(".bt-label").textContent = `timeline · ${branchLabel}`;
  el.querySelector(".bt-close").addEventListener("click", () => {
    _closeTimeline();
    _returnToNow();
  });
  el.querySelector(".bt-now").addEventListener("click", _returnToNow);
  el.querySelector(".bt-branch").addEventListener("click", _branchHere);
  el.querySelector(".bt-strip").addEventListener("click", (ev) => {
    if (!_state.firstTs || !_state.nowTs) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left - 10) / (rect.width - 20)));
    const start = new Date(_state.firstTs).getTime();
    const end = new Date(_state.nowTs).getTime();
    const t = new Date(start + frac * (end - start));
    if (frac >= 0.995) {
      _returnToNow();
      return;
    }
    _rewindTo(t.toISOString());
  });

  // The doctrine: clicking a branch in the panel switches to that
  // branch's live present AND opens its timeline. Branch-switching is
  // a location.hash mutation; main.js's hashchange handler picks it
  // up, fires navigate, and the resulting _update call refreshes
  // this strip with marks for the new branch.
  //
  // We also kick a direct _update so the strip is populated immediately
  // without waiting for the navigate's after-call. Same-branch opens
  // need it (no navigate fires); different-branch opens benefit from it
  // (the marks fetch runs concurrent with navigate instead of after).
  const currentBranch = window.state?.descriptor?.address?.branch || "0";
  if (currentBranch !== branchPath) {
    const bq = branchPath === "0" ? "" : `#${branchPath}`;
    location.hash = `#${_state.reality}${bq}/`;
  }
  if (window.state?.descriptor) {
    _update(window.state.descriptor);
  }
}

function _closeTimeline() {
  if (_state.timelineEl) {
    _state.timelineEl.remove();
    _state.timelineEl = null;
  }
  _state.timelineBranch = null;
  _state.marks = [];
  _state.firstTs = null;
  _state.nowTs = null;
  _state.atTimestamp = null;
  if (_stripTick) {
    clearInterval(_stripTick);
    _stripTick = null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// UPDATE — called by main.js on every navigate. Refreshes timeline
// data (when the strip is open) and tracks rewound state.
// ─────────────────────────────────────────────────────────────────────

async function _update(desc) {
  // Always cache the latest graph for the active branch — even when the
  // panel/timeline isn't open, so opening either is instant.
  const branch = desc?.address?.branch || "0";
  _maybeSurfaceBranchSwitch(branch);
  try {
    const r = await _state.client.see(`${_state.reality}/.branches/${branch}`);
    _state.graph = r?.branches || null;
    // Server-confirmed pause state of the branch the user is on. Push
    // it to the chrome layer (main.js listens for the same custom
    // event the optimistic pause-button flip uses, so both paths
    // converge).
    const myPaused = !!r?.branches?.current?.paused;
    window.dispatchEvent(new CustomEvent("branchbar:paused-self", {
      detail: { paused: myPaused },
    }));
  } catch { _state.graph = null; }

  // Track rewound state from descriptor flags.
  if (desc?.isHistorical && desc.asOf?.atTimestamp) {
    _state.atTimestamp = desc.asOf.atTimestamp;
  } else {
    _state.atTimestamp = null;
  }

  // Address-branch is the source of truth (Tabor doctrine 2026-06-04):
  // both stances always match. If an open timeline strip is bound to a
  // different branch than the address, re-bind it. Without this, the
  // strip stays labelled "main" while the IBP address shows #1, even
  // though the user is acting on #1.
  if (_state.timelineEl && _state.timelineBranch !== branch) {
    _state.timelineBranch = branch;
    _state.marks = [];
    _state.firstTs = null;
    _state.nowTs = null;
    const labelEl = _state.timelineEl.querySelector(".bt-label");
    if (labelEl) {
      const branchLabel = branch === "0" ? "main" : `#${branch}`;
      labelEl.textContent = `timeline · ${branchLabel}`;
    }
  }

  // If no timeline open, nothing more to do.
  if (!_state.timelineEl) return;

  // Load marks for the timeline's bound branch (which may not equal
  // the address's branch — usually they match but a future "open
  // sibling branch timeline from main" would split them). Always
  // qualify the SEE with the timeline's branch so the request doesn't
  // race the socket's current-branch state.
  const tlBranch = _state.timelineBranch || branch;
  const myBeingId = desc?.identity?.beingId || null;
  if (myBeingId) {
    try {
      const bq = tlBranch === "0" ? "" : `#${tlBranch}`;
      // Mark source: the signed-in being's own acts. Request the max
      // limit explicitly so a long session with many coord-tick acts
      // doesn't truncate the leftmost timestamp to "a few minutes ago"
      // when the user has actually been around much longer.
      const actsDesc = await _state.client.see(
        `${_state.reality}${bq}/.acts/${myBeingId}`,
        { limit: 10000 },
      );
      const acts = Array.isArray(actsDesc?.actChain?.acts)
        ? actsDesc.actChain.acts.slice().reverse()
        : [];
      _state.marks = acts
        .map((a) => ({
          ts:    a?.stampedAt || a?.receivedAt || null,
          seq:   a?.lastFactSeq ?? null,
          label: a?.facts?.[0]?.action
            || (a?.endMessage?.content
              ? String(a.endMessage.content).slice(0, 40)
              : (a?.activeRole || null)),
        }))
        .filter((m) => m.ts);
    } catch (err) {
      console.warn("[branch-bar] acts fetch failed:", err?.message);
      _state.marks = [];
    }
  } else {
    _state.marks = [];
  }

  // Sliding-window time axis. nowTs is always wall-clock now (so the
  // present streams in from the right edge as time passes); firstTs is
  // anchored to (now - WINDOW) OR the earliest mark, whichever is
  // later — a short session shouldn't pad with empty hours. The
  // anchor recomputes on every _update + on the 1s tick, so:
  //   - new marks land at their absolute position
  //   - older marks drift left as the window slides forward
  //   - a rewind cursor (atTimestamp) stays at its absolute moment
  //     and slides left as wall-clock advances — never re-centered
  _state.firstTs = _computeFirstTs(_state.marks);
  _state.nowTs   = new Date().toISOString();
  _ensureTick();

  _renderTimeline();
}

// Minimum visible window: 1 hour. The strip grows wider if the user
// has older marks — never narrower, so acts never "fall off the left"
// while the user is just sitting and watching. Doctrine (Tabor
// 2026-06-04): the strip is for the user's full session, not a fixed
// rolling buffer; older marks must stay visible until the user
// explicitly decides otherwise.
const _MIN_WINDOW_MS = 60 * 60 * 1000;

function _computeFirstTs(marks) {
  const wallNowMs = Date.now();
  if (marks.length > 0 && marks[0]?.ts) {
    const earliestMs = new Date(marks[0].ts).getTime();
    // firstTs = the earliest mark, but never narrower than the
    // minimum window. So a fresh session shows 1h of empty axis, then
    // the strip widens left as the user accumulates older acts.
    return new Date(Math.min(earliestMs, wallNowMs - _MIN_WINDOW_MS)).toISOString();
  }
  // No marks yet — show the empty 1-hour window.
  return new Date(wallNowMs - _MIN_WINDOW_MS).toISOString();
}

// One-second tick keeps the right edge anchored to wall-clock now
// even when no new marks arrive. Slides the window forward; the
// rewind cursor drifts left because its absolute timestamp doesn't
// move while now() does.
let _stripTick = null;
function _ensureTick() {
  if (_stripTick || !_state.timelineEl) return;
  _stripTick = setInterval(() => {
    if (!_state.timelineEl) {
      clearInterval(_stripTick);
      _stripTick = null;
      return;
    }
    _state.firstTs = _computeFirstTs(_state.marks);
    _state.nowTs   = new Date().toISOString();
    _renderTimeline();
  }, 1000);
}

function _renderTimeline() {
  if (!_state.timelineEl) return;
  const marksEl = _state.timelineEl.querySelector(".bt-marks");
  const cursor  = _state.timelineEl.querySelector(".bt-cursor");
  const labelL  = _state.timelineEl.querySelector(".bt-label-left");
  const labelR  = _state.timelineEl.querySelector(".bt-label-right");
  const status  = _state.timelineEl.querySelector(".bt-status");
  const nowBtn  = _state.timelineEl.querySelector(".bt-now");
  const branchBtn = _state.timelineEl.querySelector(".bt-branch");
  marksEl.innerHTML = "";

  if (!_state.firstTs || !_state.nowTs) {
    cursor.style.display = "none";
    labelL.textContent = "no history yet";
    labelR.textContent = "";
    status.textContent = "live";
    status.style.color = "#6b7d72";
    nowBtn.style.display = "none";
    branchBtn.style.display = "none";
    return;
  }

  labelL.textContent = _shortStamp(_state.firstTs);
  labelR.textContent = "now";

  const start = new Date(_state.firstTs).getTime();
  const end = new Date(_state.nowTs).getTime();
  const span = Math.max(1, end - start);
  for (const m of _state.marks) {
    const t = new Date(m.ts).getTime();
    const frac = Math.max(0, Math.min(1, (t - start) / span));
    const dot = document.createElement("div");
    dot.style.cssText = [
      "position: absolute",
      `left: ${(frac * 100).toFixed(2)}%`,
      "top: 50%",
      "width: 4px",
      "height: 4px",
      "background: #6b7d72",
      "transform: translate(-50%,-50%)",
      "border-radius: 50%",
    ].join(";");
    dot.title = `${m.label || "fact"} · seq ${m.seq ?? "?"} · ${m.ts}`;
    marksEl.appendChild(dot);
  }

  const branchLabel = _state.timelineBranch === "0"
    ? "main"
    : `#${_state.timelineBranch}`;
  if (_state.atTimestamp) {
    const t = new Date(_state.atTimestamp).getTime();
    const frac = Math.max(0, Math.min(1, (t - start) / span));
    cursor.style.display = "block";
    cursor.style.left = `${(frac * 100).toFixed(2)}%`;
    cursor.style.right = "auto";
    status.textContent = `rewound to ${_humanStamp(_state.atTimestamp)} on ${branchLabel}`;
    status.style.color = "#e8b762";
    nowBtn.style.display = "inline-block";
    branchBtn.style.display = "inline-block";
  } else {
    cursor.style.display = "none";
    status.textContent = `live on ${branchLabel}`;
    status.style.color = "#6b7d72";
    nowBtn.style.display = "none";
    branchBtn.style.display = "none";
  }
}

// ─────────────────────────────────────────────────────────────────────
// EVENT DISPATCH — same custom-event channel main.js wires up.
// ─────────────────────────────────────────────────────────────────────

function _rewindTo(atTimestamp) {
  if (!atTimestamp) return;
  window.dispatchEvent(new CustomEvent("branchbar:rewind", {
    detail: { atTimestamp },
  }));
}

function _returnToNow() {
  window.dispatchEvent(new CustomEvent("branchbar:now", {}));
}

async function _branchHere() {
  if (!_state.atTimestamp) return;
  const parent = _state.timelineBranch || "0";
  try {
    // Caller's socket is whatever branch they were viewing live last
    // (rewinds don't move the socket). The cross-branch gate refuses
    // DO when caller and target branches differ, so qualify the stance
    // with the caller's branch — branch-manager being itself folds via
    // lineage so it's reachable from any branch's slot.
    const callerBranch =
      window.state?.descriptor?.address?.branch || "0";
    const callerBq = callerBranch === "0" ? "" : `#${callerBranch}`;
    _showBranchEvent(`creating branch from #${parent}…`);
    const result = await _state.client.do(
      `${_state.reality}${callerBq}/@branch-manager`,
      "create-branch",
      { parent, atTimestamp: _state.atTimestamp, label: null },
    );
    const r = result?.result || result;
    if (!r?.path) {
      console.warn("[branch-bar] create-branch returned no path:", result);
      return;
    }
    _showBranchEvent(`✨ branched! now on #${r.path}`, { sticky: 2500 });
    _closeTimeline();
    location.hash = `#${_state.reality}#${r.path}/`;
  } catch (err) {
    console.warn("[branch-bar] create-branch failed:", err?.message);
    _showBranchEvent(`branch failed: ${err?.message || err}`, { error: true });
  }
}

// Transient on-screen branch-event chip. Used for branch switches and
// create-branch confirmations so the user can never miss a world flip.
// Reuses one DOM node — overlapping events stomp each other rather
// than stacking, which keeps the chrome out of the way.
let _branchChipEl = null;
let _branchChipTimer = null;
function _showBranchEvent(text, { sticky = 1500, error = false } = {}) {
  if (typeof document === "undefined") return;
  if (!_branchChipEl) {
    _branchChipEl = document.createElement("div");
    _branchChipEl.style.cssText = [
      "position: fixed",
      "top: 50%",
      "left: 50%",
      "transform: translate(-50%,-50%)",
      "z-index: 30",
      "padding: 14px 24px",
      "border-radius: 8px",
      "font-family: ui-monospace, monospace",
      "font-size: 14px",
      "font-weight: 600",
      "letter-spacing: 0.02em",
      "pointer-events: none",
      "box-shadow: 0 8px 24px rgba(0,0,0,0.6)",
      "transition: opacity 0.25s ease-out, transform 0.25s ease-out",
    ].join(";");
    document.body.appendChild(_branchChipEl);
  }
  const bg = error ? "#3a1212" : "#2a1f0a";
  const border = error ? "#a04040" : "#6b5320";
  const color = error ? "#ffb0b0" : "#e8b762";
  _branchChipEl.style.background = bg;
  _branchChipEl.style.border = `1px solid ${border}`;
  _branchChipEl.style.color = color;
  _branchChipEl.textContent = text;
  _branchChipEl.style.opacity = "1";
  _branchChipEl.style.transform = "translate(-50%,-50%) scale(1)";
  if (_branchChipTimer) clearTimeout(_branchChipTimer);
  _branchChipTimer = setTimeout(() => {
    if (_branchChipEl) _branchChipEl.style.opacity = "0";
  }, sticky);
}

// Branch-switch detection. main.js calls into update() on every
// navigate; we compare desc.address.branch against the last seen one
// and surface the change as an event chip. The user asked for "VERY
// clear" — center-screen overlay does that.
let _lastSeenBranch = null;
function _maybeSurfaceBranchSwitch(branch) {
  if (branch === _lastSeenBranch) return;
  const prev = _lastSeenBranch;
  _lastSeenBranch = branch;
  if (prev === null) return; // first observation; not a switch
  const label = branch === "0" ? "main" : `#${branch}`;
  _showBranchEvent(`→ switched to ${label}`);
}

function _shortStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function _humanStamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dMs = Date.now() - d.getTime();
  const min = Math.round(dMs / 60000);
  let rel;
  if (min < 1) rel = "just now";
  else if (min < 60) rel = `${min}m ago`;
  else if (min < 1440) rel = `${Math.round(min/60)}h ago`;
  else rel = `${Math.round(min/1440)}d ago`;
  const pad = (n) => String(n).padStart(2, "0");
  return `${rel} (${pad(d.getHours())}:${pad(d.getMinutes())})`;
}
