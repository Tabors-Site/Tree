// branch-bar.js — branch + time navigation for the 3D portal.
//
// Three pieces of UI:
//
//   1. Top-left "Branches" button. Always visible. Click opens the
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

  // Timeline playback state. speed is a tier index from the
  // PLAYBACK_SPEEDS list. 0 = paused; >0 = forward playback (1x, 2x,
  // 4x, 8x); <0 = reverse (-1x, -2x, -4x, -8x). The playback timer
  // ticks at PLAYBACK_TICK_MS and advances the cursor by
  // speed * PLAYBACK_TICK_MS in timeline-time. Auto-stops: forward
  // hits present → snap live; reverse hits genesis → pause at firstTs.
  playbackSpeed: 0,
  playbackTimer: null,
  // The cursor's current timeline-time during playback. Tracked
  // independently of atTimestamp so we can advance smoothly between
  // marks even when atTimestamp lags behind (the rewind round-trip
  // is async; playback continues optimistically).
  cursorMs: null,
  // Resume speed for ▶ after a paused state. Set when ⏸ is pressed
  // during active playback; consumed (and zeroed) by the next ▶.
  resumeSpeed: 0,
  // Playback mode: "human" advances cursorMs by wall-clock seconds *
  // speed factor (every gap between marks plays through in real time).
  // "reality" steps mark-to-mark — the empty time between marks is
  // collapsed, so each tick of speed advances one act on the reel.
  // Useful when the being acts sparsely and a +1x human playback would
  // be mostly waiting.
  playbackMode: "human",
  // Accumulator for reality mode. Each tick adds factor * marksPerTick
  // to the accumulator; when |accumulator| ≥ 1 the cursor steps that
  // many marks and the integer portion is subtracted out. Lets speeds
  // below 1 mark/tick advance smoothly (1x = 1 mark/sec at 250ms tick).
  markAccumulator: 0,
};

// Tick cadence for the playback loop. Short enough that 8x feels
// smooth, long enough that the rewind round-trip can keep up. Each
// tick advances cursorMs by speedFactor * PLAYBACK_TICK_MS.
const PLAYBACK_TICK_MS = 250;
// Speed factor labels keyed off the signed tier. Index by `speed`:
// negative for reverse, positive for forward, 0 for paused.
const PLAYBACK_SPEEDS = {
  "-4": -8,
  "-3": -4,
  "-2": -2,
  "-1": -1,
  "0":   0,
  "1":   1,
  "2":   2,
  "3":   4,
  "4":   8,
};
const MIN_SPEED_TIER = -4;
const MAX_SPEED_TIER = 4;
function _speedFactor(tier) { return PLAYBACK_SPEEDS[String(tier)] ?? 0; }
function _speedLabel(tier) {
  const f = _speedFactor(tier);
  if (f === 0) return "paused";
  const sign = f < 0 ? "◀ " : "▶ ";
  return `${sign}${Math.abs(f)}x`;
}

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
    // The portal swaps its PortalClient on sign-in / register / sign-out
    // (a new authenticated or anonymous socket). The bar captured the
    // boot-time client; without this, after a first registration it
    // keeps querying the dead pre-auth socket and the branch tree comes
    // back empty until a full page reload. Call this whenever the live
    // client changes so the bar's SEEs ride the current socket.
    setClient: (client, reality) => {
      _state.client = client;
      if (reality) _state.reality = reality;
    },
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
  b.textContent = "Branches";
  // Z-index 200 sits above the flat-panel overlay (z=100), so the
  // button + its popups stay reachable from text mode too. Without
  // this the user can't open the timeline when the flat-panel is up.
  b.style.cssText = [
    "position: fixed",
    "top: 56px",
    "left: 12px",
    "z-index: 200",
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
    "z-index: 200",
    "padding: 14px 16px",
    "pointer-events: auto",
  ].join(";");
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <span style="color:#8fbf9f;">branch tree</span>
      <button type="button" class="bp-close" style="background:transparent;color:#6b7d72;border:none;font-size:18px;cursor:pointer;padding:0 4px;">×</button>
    </div>
    <div class="bp-tree" style="font-size:12px;line-height:1.7;"></div>
    <div class="bp-actions" style="margin-top:12px;padding-top:10px;border-top:1px solid #2c3a32;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <button type="button" class="bp-new" title="Create a new branch — fork a parent branch at a fact seq or a moment in time, scoped to the whole reality or just a subtree" style="background:#13201b;color:#8fbf9f;border:1px solid #3d7a52;border-radius:3px;padding:4px 10px;font-family:inherit;font-size:11px;cursor:pointer;">
        ✚ New
      </button>
      <button type="button" class="bp-merge" title="Merge two branches" style="background:#13201b;color:#8fbf9f;border:1px solid #3d7a52;border-radius:3px;padding:4px 10px;font-family:inherit;font-size:11px;cursor:pointer;">
        ⇄ Merge
      </button>
      <button type="button" class="bp-copy" title="Copy this place as a portable clone (facts only — its shape, no history). Downloads a .clone.json you can Graft elsewhere." style="background:#13201b;color:#8fbf9f;border:1px solid #3d7a52;border-radius:3px;padding:4px 10px;font-family:inherit;font-size:11px;cursor:pointer;">
        ⬇ Copy
      </button>
      <button type="button" class="bp-graft" title="Graft a .clone.json under the current place — replays its facts as fresh local spaces/beings/matter" style="background:#13201b;color:#8fbf9f;border:1px solid #3d7a52;border-radius:3px;padding:4px 10px;font-family:inherit;font-size:11px;cursor:pointer;">
        ⬆ Graft
      </button>
      <input type="file" class="bp-graft-file" accept=".json,application/json" style="display:none;">
      <span style="color:#6b7d72;font-size:10px;margin-left:auto;">click a branch to open its timeline · esc to close</span>
    </div>
  `;
  document.body.appendChild(el);
  _state.panelEl = el;
  el.querySelector(".bp-close").addEventListener("click", _closePanel);
  el.querySelector(".bp-new").addEventListener("click", (ev) => {
    ev.stopPropagation();
    _openNewBranchDialog();
  });
  el.querySelector(".bp-merge").addEventListener("click", (ev) => {
    ev.stopPropagation();
    _openMergeDialog();
  });
  el.querySelector(".bp-copy").addEventListener("click", (ev) => {
    ev.stopPropagation();
    _downloadClone().catch((err) => {
      _showBranchEvent(`copy failed: ${err?.message || err}`);
    });
  });
  el.querySelector(".bp-graft").addEventListener("click", (ev) => {
    ev.stopPropagation();
    el.querySelector(".bp-graft-file").click();
  });
  el.querySelector(".bp-graft-file").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (file) {
      _graftFromFile(file).catch((err) => {
        _showBranchEvent(`graft failed: ${err?.message || err}`);
      });
    }
    // Reset so the same filename can be re-picked.
    ev.target.value = "";
  });

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
    if (Array.isArray(branch.mergeSources) && branch.mergeSources.length === 2) {
      const [a, b] = branch.mergeSources;
      parts.push(`↶ merged from #${a} + #${b}`);
      // Lazy-load conflict counts. We don't block the tree render on
      // this; the SEE fires after first paint and patches the row
      // when it returns. Cached per session so reopening the tree is
      // cheap.
      _decorateRowWithConflictCount(row, branch.path);
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
    // "see branch" — full info for this branch (seq / branchPoint,
    // pointers aimed here, scope, lineage, children, who/when).
    {
      const info = document.createElement("button");
      info.type = "button";
      info.textContent = "ⓘ info";
      info.title = "see full branch info (branch-point seqs, pointers, scope, lineage)";
      info.style.cssText = [
        "background: #13201b",
        "color: #8fbf9f",
        "border: 1px solid #3d7a52",
        "border-radius: 3px",
        "padding: 2px 8px",
        "margin-left: 6px",
        "font-family: inherit",
        "font-size: 10px",
        "cursor: pointer",
      ].join(";");
      info.addEventListener("click", (ev) => {
        ev.stopPropagation();
        _openBranchInfoDialog(branch.path);
      });
      row.appendChild(info);
    }
    container.appendChild(row);
    const kids = childrenOf.get(branch.path) || [];
    for (const k of kids) render(k, indent + 1);
  }
  for (const root of tree.roots) {
    render(root, 0);
  }
}

// In-flight toggle lock. While a pause/unpause DO is on the wire,
// _update's auto-refresh would otherwise re-fetch the catalog and
// repaint the panel with the SERVER's current (still-pre-toggle)
// state — undoing the optimistic flip mid-flight and making the
// button bounce back. The lock tells _update "don't touch the panel
// until the DO completes," and the DO's own success-path refresh
// lands the authoritative state.
let _toggleInFlight = 0;
function _isToggleInFlight() { return _toggleInFlight > 0; }

async function _togglePauseBranch(branch) {
  const op = branch.paused ? "unpause-branch" : "pause-branch";
  // Optimistic local flip so the button changes the instant the user
  // clicks — no waiting for the DO + tree refetch round-trip. The
  // server-confirmed state replaces it on the subsequent refetch; if
  // the DO fails the catch path restores and surfaces the error.
  const prevPaused = !!branch.paused;
  branch.paused = !prevPaused;
  _toggleInFlight++;
  if (_state.panelEl) {
    const treeContainer = _state.panelEl.querySelector(".bp-tree");
    if (treeContainer) _renderTree(treeContainer, _state.graphAll);
  }
  // If the user just paused (or unpaused) the branch they themselves
  // are currently on, flip the grayscale chrome immediately so the
  // visual cue matches the new reality without waiting for navigate.
  const myBranch = window.__state?.descriptor?.address?.branch || "0";
  if (branch.path === myBranch) {
    window.dispatchEvent(new CustomEvent("branchbar:paused-self", {
      detail: { paused: branch.paused },
    }));
  }

  // Use a RELATIVE address (`/@branch-manager`) so the wire inherits
  // socket.currentBranch automatically — whichever branch the server
  // actually thinks the user is on, the DO targets that same branch
  // and the cross-branch gate stays happy. The earlier approach of
  // reading window.__state.descriptor.address.branch raced the
  // descriptor update: after creating a branch the socket flipped to
  // #1 but the local descriptor was still mid-refresh, so the DO went
  // out with `localhost/@branch-manager` (typed-reality means main),
  // caller=#1 vs target=#0, CROSS_BRANCH_FORBIDDEN. Relative dodges
  // the whole question.
  try {
    await _state.client.do(
      `/@branch-manager`,
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
  } finally {
    _toggleInFlight = Math.max(0, _toggleInFlight - 1);
  }
}

// ── Per-merged-branch conflict count cache ────────────────────────
// Per-session cache so reopening the tree doesn't refire every SEE.
// Invalidated when the user opens the conflict panel + makes any
// resolution (the panel's refresh path nukes the cached entry).
const _conflictCountCache = new Map(); // path → { open, resolved, totalConflicts }

async function _decorateRowWithConflictCount(row, mergedPath) {
  // Append a placeholder badge first so the row's layout is stable.
  const badge = document.createElement("button");
  badge.type = "button";
  badge.style.cssText = [
    "background: transparent",
    "color: #6b7d72",
    "border: 1px solid #2c3a32",
    "border-radius: 3px",
    "padding: 1px 6px",
    "font-family: inherit",
    "font-size: 10px",
    "cursor: pointer",
    "margin-left: 4px",
  ].join(";");
  badge.textContent = "↶ …";
  badge.title = "view merge conflicts";
  badge.addEventListener("click", (ev) => {
    ev.stopPropagation();
    _openConflictPanel(mergedPath);
  });
  row.appendChild(badge);

  // Fetch + apply.
  const apply = (counts) => {
    if (!badge.isConnected) return;
    if (!counts) {
      badge.textContent = "↶ conflicts";
      badge.style.color = "#6b7d72";
      badge.style.borderColor = "#2c3a32";
      return;
    }
    const open = counts.open ?? 0;
    const resolved = counts.resolved ?? 0;
    if (open > 0) {
      badge.textContent = `⚠ ${open} open`;
      badge.style.color = "#e8b762";
      badge.style.borderColor = "#6b5320";
      badge.title = `${open} open conflict${open === 1 ? "" : "s"}, ${resolved} resolved`;
    } else if (resolved > 0) {
      badge.textContent = `✓ ${resolved} resolved`;
      badge.style.color = "#8fbf9f";
      badge.style.borderColor = "#3d7a52";
      badge.title = `${resolved} resolved conflict${resolved === 1 ? "" : "s"}`;
    } else {
      badge.textContent = "↶ clean merge";
      badge.style.color = "#6b7d72";
      badge.style.borderColor = "#2c3a32";
      badge.title = "no two-sided conflicts";
    }
  };
  if (_conflictCountCache.has(mergedPath)) {
    apply(_conflictCountCache.get(mergedPath));
    return;
  }
  try {
    const catalog = await _state.client.see(
      `${_state.reality}/.branches/${mergedPath}/conflicts`,
    );
    const totals = catalog?.conflicts?.totals || {};
    const counts = {
      open: totals.conflictsOpen ?? 0,
      resolved: totals.conflictsResolved ?? 0,
      totalConflicts: totals.conflicts ?? 0,
    };
    _conflictCountCache.set(mergedPath, counts);
    apply(counts);
  } catch {
    apply(null);
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
    "z-index: 200",
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
      <div class="bt-cursor" style="position:absolute;width:14px;height:14px;border-radius:50%;background:#ffffff;border:2px solid #5cc8ff;top:50%;transform:translate(-50%,-50%);right:10px;display:none;box-shadow:0 0 8px rgba(92,200,255,0.8);z-index:2;"></div>
      <span class="bt-label-left" style="position:absolute;left:10px;top:-14px;font-size:9px;color:#6b7d72;">genesis</span>
      <span class="bt-label-right" style="position:absolute;right:10px;top:-14px;font-size:9px;color:#6b7d72;">now</span>
    </div>
    <div class="bt-actions" style="display:flex;gap:8px;align-items:center;justify-content:space-between;">
      <span class="bt-status" style="color:#6b7d72;">live</span>
      <span class="bt-playback" style="display:flex;gap:4px;align-items:center;">
        <button class="bt-rew" type="button" title="rewind (each click doubles reverse speed)" style="background:#131a17;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:3px 8px;font-family:inherit;font-size:12px;cursor:pointer;">⏪</button>
        <button class="bt-playpause" type="button" title="play / pause" style="background:#131a17;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:3px 8px;font-family:inherit;font-size:12px;cursor:pointer;">▶</button>
        <button class="bt-ff" type="button" title="fast-forward (each click doubles forward speed)" style="background:#131a17;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:3px 8px;font-family:inherit;font-size:12px;cursor:pointer;">⏩</button>
        <span class="bt-speed" style="color:#8fbf9f;font-size:11px;min-width:48px;text-align:center;">paused</span>
        <button class="bt-mode" type="button" title="time mode . 'human' = wall-clock seconds; 'reality' = mark-to-mark (each act counts as one step; gaps between acts collapse)" style="background:#131a17;color:#8fbf9f;border:1px solid #2c3a32;border-radius:3px;padding:3px 8px;font-family:inherit;font-size:11px;cursor:pointer;min-width:96px;">time: human</button>
      </span>
      <span class="bt-buttons" style="display:flex;gap:6px;">
        <button class="bt-now" type="button" style="display:none;background:#131a17;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:3px 10px;font-family:inherit;font-size:11px;cursor:pointer;">return to now</button>
        <button class="bt-branch" type="button" style="display:none;background:#2a1f0a;color:#e8b762;border:1px solid #6b5320;border-radius:3px;padding:3px 10px;font-family:inherit;font-size:11px;cursor:pointer;">branch here</button>
      </span>
    </div>
    <div class="bt-detail" style="display:none;color:#c8d3cb;font-size:11px;line-height:1.4;padding:6px 8px;background:#0e1411;border:1px solid #2c3a32;border-radius:3px;font-family:ui-monospace,monospace;"></div>
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
    // Clicking the strip is an explicit scrub — kill any active
    // playback so the user's click position sticks until they press
    // play again.
    _stopPlayback();
    // Mode-aware: in reality mode the strip is a discrete act-index
    // ruler — snap the click to the nearest act. In human mode it's
    // a continuous wall-clock ruler.
    if (_state.playbackMode === "reality") {
      const total = _state.marks.length;
      if (total === 0) return;
      // frac near the right edge → return to live; else pick the
      // nearest mark by index.
      if (frac >= 0.995) {
        _state.cursorMs = null;
        _returnToNow();
        return;
      }
      const idx = total === 1 ? 0 : Math.round(frac * (total - 1));
      const mark = _state.marks[Math.max(0, Math.min(total - 1, idx))];
      _state.cursorMs = new Date(mark.ts).getTime();
      _rewindTo(mark.ts);
      return;
    }
    const start = new Date(_state.firstTs).getTime();
    const end = new Date(_state.nowTs).getTime();
    const t = new Date(start + frac * (end - start));
    _state.cursorMs = t.getTime();
    if (frac >= 0.995) {
      _state.cursorMs = null;
      _returnToNow();
      return;
    }
    _rewindTo(t.toISOString());
  });

  // Playback controls. Rewind / fast-forward each click bumps the
  // signed speed tier by 1; pause/play toggles between 0 and the
  // last non-zero tier (default 1x forward). The tick loop reads
  // _state.playbackSpeed and advances cursorMs accordingly.
  el.querySelector(".bt-rew").addEventListener("click", () => _bumpSpeed(-1));
  el.querySelector(".bt-ff").addEventListener("click",  () => _bumpSpeed(+1));
  el.querySelector(".bt-playpause").addEventListener("click", _togglePlayPause);
  el.querySelector(".bt-mode").addEventListener("click", _toggleMode);
  _renderSpeedDisplay();
  _renderModeDisplay();

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
  const currentBranch = window.__state?.descriptor?.address?.branch || "0";
  if (currentBranch !== branchPath) {
    const bq = branchPath === "0" ? "" : `#${branchPath}`;
    location.hash = `#${_state.reality}${bq}/`;
  }
  if (window.__state?.descriptor) {
    _update(window.__state.descriptor);
  }
}

function _closeTimeline() {
  // Kill any active playback before tearing down so the tick loop
  // doesn't keep firing into a detached UI.
  _stopPlayback();
  _state.cursorMs = null;
  _state.resumeSpeed = 0;
  if (_state.timelineEl) {
    _state.timelineEl.remove();
    _state.timelineEl = null;
  }
  _state.timelineBranch = null;
  _state.marks = [];
  _state.firstTs = null;
  _state.nowTs = null;
  _state.atTimestamp = null;
  _state.selectedMarkTs = null;
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
    // Skip the chrome flip while a toggle is in flight — same race
    // as the panel: the catalog still reads the pre-toggle row and
    // would flip the grayscale chrome back, defeating the optimistic
    // visual the toggle just set.
    if (!_isToggleInFlight()) {
      const myPaused = !!r?.branches?.current?.paused;
      window.dispatchEvent(new CustomEvent("branchbar:paused-self", {
        detail: { paused: myPaused },
      }));
    }
    // If the branch tree panel is open, refetch the full tree and
    // repaint it so newly-created branches and freshly-flipped pause
    // states appear without the user having to close + reopen the
    // panel or reload the page. The catalog SEE above only fetches
    // the current branch's lineage; the panel needs every branch in
    // the place.
    //
    // SKIP while a toggle DO is in flight — _togglePauseBranch already
    // optimistically flipped the row, and a live-event refetch here
    // would read the SERVER's still-pre-toggle row, snap the panel
    // back, and confuse the user. The toggle's own success-path
    // refresh lands authoritative state when the DO completes.
    if (_state.panelEl && !_isToggleInFlight()) {
      try {
        const tree = await _loadBranchTree();
        _state.graphAll = tree;
        const container = _state.panelEl.querySelector(".bp-tree");
        if (container) _renderTree(container, tree);
      } catch { /* defensive — panel keeps its last paint */ }
    }
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

// Empty-strip default window: 5 minutes. Used ONLY when the being
// has zero marks yet. Once they have any act, the strip stretches
// back exactly to their earliest mark and no further — the time axis
// covers the being's actual lifespan, not a synthetic padded window.
// Doctrine (Tabor 2026-06-04): the strip is a faithful reading of
// what this being has done; padding empty axis on either side lies
// about how long they've been around.
const _EMPTY_WINDOW_MS = 5 * 60 * 1000;

function _computeFirstTs(marks) {
  if (marks.length > 0 && marks[0]?.ts) {
    // firstTs = the earliest mark exactly. The time axis spans the
    // being's session and grows leftward only as they accumulate
    // older acts.
    return marks[0].ts;
  }
  // No marks yet — show a tight empty 5-minute window so the strip
  // has visible chrome to render against.
  return new Date(Date.now() - _EMPTY_WINDOW_MS).toISOString();
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
    _renderDetail(null);
    return;
  }

  // If the previously-selected mark is no longer in the marks set
  // (replaced by a refetch, or scrolled off-window in a future
  // implementation), drop the selection so the detail row doesn't
  // describe a mark that's no longer rendered.
  if (_state.selectedMarkTs) {
    const stillExists = _state.marks.some((m) => m.ts === _state.selectedMarkTs);
    if (!stillExists) {
      _state.selectedMarkTs = null;
      _renderDetail(null);
    }
  }

  // Two layout modes for the strip:
  //   - "human": dots positioned by wall-clock fraction in [firstTs, nowTs]
  //   - "reality": dots positioned by act-index, evenly spaced. Each
  //     mark gets 1/N of the strip regardless of when it happened, so
  //     a quiet hour reads the same as a busy second — "reality time"
  //     is being-time, where each act is exactly one tick.
  const realityMode = _state.playbackMode === "reality";
  const total = _state.marks.length;
  if (realityMode) {
    labelL.textContent = total > 0 ? `act 1` : "no acts yet";
    labelR.textContent = total > 0 ? `act ${total}` : "";
  } else {
    labelL.textContent = _shortStamp(_state.firstTs);
    labelR.textContent = "now";
  }

  const start = new Date(_state.firstTs).getTime();
  const end = new Date(_state.nowTs).getTime();
  const span = Math.max(1, end - start);

  // Compute frac per mark — wall-clock for human, index for reality.
  const fracOf = (m, i) => {
    if (realityMode) {
      return total === 1 ? 0.5 : i / (total - 1);
    }
    const t = new Date(m.ts).getTime();
    return Math.max(0, Math.min(1, (t - start) / span));
  };

  for (let i = 0; i < _state.marks.length; i++) {
    const m = _state.marks[i];
    const frac = fracOf(m, i);
    const isSelected = _state.selectedMarkTs === m.ts;
    const dot = document.createElement("div");
    dot.style.cssText = [
      "position: absolute",
      `left: ${(frac * 100).toFixed(2)}%`,
      "top: 50%",
      `width: ${isSelected ? 10 : 6}px`,
      `height: ${isSelected ? 10 : 6}px`,
      `background: ${isSelected ? "#e8b762" : "#6b7d72"}`,
      "transform: translate(-50%,-50%)",
      "border-radius: 50%",
      "cursor: pointer",
      "pointer-events: auto",
    ].join(";");
    dot.title = `${m.label || "fact"} · seq ${m.seq ?? "?"} · ${m.ts}`;
    dot.addEventListener("click", (ev) => {
      ev.stopPropagation();
      _selectMark(m);
    });
    marksEl.appendChild(dot);
  }

  const branchLabel = _state.timelineBranch === "0"
    ? "main"
    : `#${_state.timelineBranch}`;
  if (_state.atTimestamp) {
    const t = new Date(_state.atTimestamp).getTime();
    let cursorFrac;
    if (realityMode) {
      // Position cursor at the mark we're "on" — i.e., the most-recent
      // mark at or before _state.atTimestamp. Uses the same act-index
      // spacing the dots use so the cursor lines up exactly.
      const activeMark = _findMarkAtCursor(t);
      const idx = activeMark ? _state.marks.indexOf(activeMark) : -1;
      cursorFrac = idx >= 0
        ? (total === 1 ? 0.5 : idx / (total - 1))
        : 0;
    } else {
      cursorFrac = Math.max(0, Math.min(1, (t - start) / span));
    }
    cursor.style.display = "block";
    cursor.style.left = `${(cursorFrac * 100).toFixed(2)}%`;
    cursor.style.right = "auto";
    // Status label is mode-aware: "human" shows the ISO wall-clock
    // timestamp the rewind landed at; "reality" shows the seq of the
    // act we're "on" so each step reads as 1 reality-tick.
    if (_state.playbackMode === "reality") {
      const m = _findMarkAtCursor(t);
      const seq = m?.seq ?? "?";
      const total = _state.marks.length;
      const idx = m ? _state.marks.findIndex((x) => x.ts === m.ts) + 1 : 0;
      status.textContent = `seq ${seq} · act ${idx}/${total} on ${branchLabel}`;
    } else {
      status.textContent = `rewound to ${_humanStamp(_state.atTimestamp)} on ${branchLabel}`;
    }
    status.style.color = "#e8b762";
    nowBtn.style.display = "inline-block";
    branchBtn.style.display = "inline-block";
  } else {
    cursor.style.display = "none";
    if (_state.playbackMode === "reality") {
      status.textContent = `live · ${_state.marks.length} acts on ${branchLabel}`;
    } else {
      status.textContent = `live on ${branchLabel}`;
    }
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
  // Auto-select the act currently "active" at this position so the
  // detail row shows the same sentence the user would see if they
  // had clicked the mark directly. Used by both the free-form strip
  // click and the playback tick — same surface area means scrubbing
  // and playing through marks both surface their prose continuously.
  // Convention: the "active" mark is the most-recent one at-or-before
  // the cursor (the world reflects every act up to and including it).
  const cursorMs = new Date(atTimestamp).getTime();
  const activeMark = _findMarkAtCursor(cursorMs);
  const nextSelectedTs = activeMark?.ts || null;
  if (nextSelectedTs !== _state.selectedMarkTs) {
    _state.selectedMarkTs = nextSelectedTs;
    _renderDetail(activeMark);
    // Re-render the strip so the selected dot's styling updates.
    // _renderTimeline is the strip-only repaint; we don't want to
    // call _update here (that re-SEEs the catalog every tick).
    _renderTimeline();
  }
  window.dispatchEvent(new CustomEvent("branchbar:rewind", {
    detail: { atTimestamp },
  }));
}

// Find the most-recent mark whose timestamp is ≤ cursorMs. Returns
// null when no marks exist or all marks are after the cursor (the
// user is rewinding past the first act). Marks are kept sorted by
// timestamp ascending in _state.marks, so a single forward pass is
// O(n) but tight; for the n=O(thousands) case the list is short
// enough that this stays well under one tick.
function _findMarkAtCursor(cursorMs) {
  const marks = _state.marks;
  if (!Array.isArray(marks) || marks.length === 0) return null;
  let last = null;
  for (const m of marks) {
    const ts = m?.ts ? new Date(m.ts).getTime() : NaN;
    if (Number.isNaN(ts)) continue;
    if (ts <= cursorMs) last = m;
    else break;
  }
  return last;
}

function _returnToNow(opts = {}) {
  // Return-to-now is a full stop. Kill any active playback, clear the
  // cursor, and reset the resume speed so the next ▶ click starts
  // fresh at present instead of resuming the prior rewind / scrub.
  // Without this reset, clicking ⏮ during a rewind left playback
  // running and the next rewind would resume from the stale cursor
  // instead of from the new present.
  _stopPlayback();
  _state.cursorMs = null;
  _state.resumeSpeed = 0;
  _state.markAccumulator = 0;
  _state.selectedMarkTs = null;
  _renderDetail(null);
  // preserveCamera flag distinguishes "play caught up to now" from
  // "user explicitly clicked return-to-now." Main reads it on the
  // rendering side and skips the camera reset when preserving, so a
  // fast-forward that crosses into live doesn't yank the user's view.
  window.dispatchEvent(new CustomEvent("branchbar:now", {
    detail: { preserveCamera: opts.preserveCamera === true },
  }));
}

// ─────────────────────────────────────────────────────────────────────
// PLAYBACK CONTROLS — speed-tiered scrub through the timeline.
//
// The tier model: PLAYBACK_SPEEDS maps tier indices (-4..+4) to time-
// warp factors (-8x..+8x with 0 = paused). Each ⏪ click bumps tier
// down by 1; each ⏩ click bumps up by 1. ⏸/▶ toggles between 0 and
// the last non-zero tier (defaults to +1 if no prior).
//
// The driver: a setInterval at PLAYBACK_TICK_MS reads the current
// signed speed factor, advances _state.cursorMs by speed * tick, and
// dispatches a rewind event with the new timestamp. The render path
// already preserves camera on rewinds, so frame-to-frame stepping
// stays in the user's vantage.
//
// Boundary behaviour:
//   forward reaches nowTs → snap live with preserveCamera (just play
//     normally at present)
//   reverse reaches firstTs → pause at firstTs (we're as far back as
//     the being's act-chain goes)
// ─────────────────────────────────────────────────────────────────────

function _bumpSpeed(delta) {
  // Find current tier from the signed factor; bump and clamp.
  const currentFactor = _state.playbackSpeed === 0 && _state.cursorMs == null
    ? 0
    : _state.playbackSpeed;
  // Re-derive tier from stored speed (speeds are stored as tier values
  // directly, so just clamp).
  let nextTier = Math.max(MIN_SPEED_TIER, Math.min(MAX_SPEED_TIER, currentFactor + delta));
  _setSpeed(nextTier);
}

function _togglePlayPause() {
  if (_state.playbackSpeed !== 0) {
    // Currently playing — pause but remember the tier so play resumes there.
    _state.resumeSpeed = _state.playbackSpeed;
    _setSpeed(0);
    return;
  }
  // Currently paused — resume at the prior tier, or +1 (forward 1x) if none.
  _setSpeed(_state.resumeSpeed || 1);
}

function _setSpeed(tier) {
  _state.playbackSpeed = tier;
  _renderSpeedDisplay();
  if (tier === 0) {
    _stopPlayback();
    return;
  }
  // Seed cursorMs if we don't have one yet. Honour current rewind
  // position; if we're live, start playback FROM nowTs (so forward
  // playback at live is a no-op until a rewind has happened — but
  // reverse from live immediately works).
  if (_state.cursorMs == null) {
    if (_state.atTimestamp) {
      _state.cursorMs = new Date(_state.atTimestamp).getTime();
    } else if (_state.nowTs) {
      _state.cursorMs = new Date(_state.nowTs).getTime();
    } else {
      _state.cursorMs = Date.now();
    }
  }
  _startPlayback();
}

function _startPlayback() {
  if (_state.playbackTimer) return;
  _state.playbackTimer = setInterval(_playbackTick, PLAYBACK_TICK_MS);
  if (typeof _state.playbackTimer.unref === "function") _state.playbackTimer.unref();
}

function _stopPlayback() {
  if (_state.playbackTimer) {
    clearInterval(_state.playbackTimer);
    _state.playbackTimer = null;
  }
  if (_state.playbackSpeed !== 0) {
    _state.playbackSpeed = 0;
    _renderSpeedDisplay();
  }
}

function _playbackTick() {
  const factor = _speedFactor(_state.playbackSpeed);
  if (factor === 0 || _state.cursorMs == null) {
    _stopPlayback();
    return;
  }
  if (_state.playbackMode === "reality") {
    _playbackTickReality(factor);
    return;
  }
  // Human-time mode: advance cursor in timeline-time by factor * tick.
  // Positive factor = forward (cursor advances toward nowTs); negative
  // = reverse (cursor recedes toward firstTs).
  const nextMs = _state.cursorMs + factor * PLAYBACK_TICK_MS;

  // Forward stop: cursor reached or passed present. Snap to live
  // with preserveCamera so the user's vantage carries through the
  // historical→live transition cleanly.
  const nowMs = _state.nowTs ? new Date(_state.nowTs).getTime() : null;
  if (factor > 0 && nowMs != null && nextMs >= nowMs) {
    _stopPlayback();
    _state.cursorMs = null;
    _returnToNow({ preserveCamera: true });
    return;
  }

  // Reverse stop: cursor reached or passed the earliest mark. Pause
  // at firstTs and hold there so the user can scrub forward again
  // from the beginning.
  const firstMs = _state.firstTs ? new Date(_state.firstTs).getTime() : null;
  if (factor < 0 && firstMs != null && nextMs <= firstMs) {
    _state.cursorMs = firstMs;
    _rewindTo(new Date(firstMs).toISOString());
    _stopPlayback();
    return;
  }

  _state.cursorMs = nextMs;
  _rewindTo(new Date(nextMs).toISOString());
}

// Reality-time tick. Steps mark-to-mark — the empty wall-clock time
// between acts collapses. Rate scales with the same speed tier: 1x =
// 1 mark per second; 2x = 2 marks/sec; 8x = 8 marks/sec. Implemented
// with an accumulator so fractional rates (1x with 250ms tick = 0.25
// marks/tick) advance smoothly without stutter.
function _playbackTickReality(factor) {
  const TICKS_PER_SEC = 1000 / PLAYBACK_TICK_MS;          // 4 at 250ms
  const MARKS_PER_TICK_AT_1X = 1 / TICKS_PER_SEC;          // 0.25
  _state.markAccumulator = (_state.markAccumulator || 0) + factor * MARKS_PER_TICK_AT_1X;

  // Step out integer marks; keep the fractional remainder for next tick.
  let steps = 0;
  if (_state.markAccumulator >= 1) {
    steps = Math.floor(_state.markAccumulator);
  } else if (_state.markAccumulator <= -1) {
    steps = Math.ceil(_state.markAccumulator);
  } else {
    return;  // sub-mark progress; wait for more ticks
  }
  _state.markAccumulator -= steps;

  const marks = _state.marks || [];
  if (marks.length === 0) {
    _stopPlayback();
    return;
  }

  // Locate the current cursor's mark index (highest mark ≤ cursorMs).
  const cursorTs = _state.cursorMs;
  let curIdx = -1;
  for (let i = 0; i < marks.length; i++) {
    const t = marks[i]?.ts ? new Date(marks[i].ts).getTime() : NaN;
    if (Number.isNaN(t)) continue;
    if (t <= cursorTs) curIdx = i;
    else break;
  }

  const targetIdx = curIdx + steps;

  // Forward past the last mark → snap live, same shape as the human-
  // mode forward-stop branch.
  if (targetIdx >= marks.length) {
    _stopPlayback();
    _state.cursorMs = null;
    _state.markAccumulator = 0;
    _returnToNow({ preserveCamera: true });
    return;
  }

  // Reverse before the first mark → pause at firstTs.
  if (targetIdx < 0) {
    const firstMark = marks[0];
    if (firstMark?.ts) {
      _state.cursorMs = new Date(firstMark.ts).getTime();
      _rewindTo(firstMark.ts);
    }
    _state.markAccumulator = 0;
    _stopPlayback();
    return;
  }

  const target = marks[targetIdx];
  if (!target?.ts) return;
  _state.cursorMs = new Date(target.ts).getTime();
  _rewindTo(target.ts);
}

function _toggleMode() {
  _state.playbackMode = _state.playbackMode === "human" ? "reality" : "human";
  // Reset the accumulator so a mode flip mid-playback doesn't carry
  // stale fractional progress across modes.
  _state.markAccumulator = 0;
  _renderModeDisplay();
  // Also repaint the strip so status text reflects the new mode
  // (human shows ISO timestamp; reality shows seq + act count).
  _renderTimeline();
}

function _renderModeDisplay() {
  if (!_state.timelineEl) return;
  const modeEl = _state.timelineEl.querySelector(".bt-mode");
  if (modeEl) modeEl.textContent = `time: ${_state.playbackMode}`;
}

function _renderSpeedDisplay() {
  if (!_state.timelineEl) return;
  const speedEl = _state.timelineEl.querySelector(".bt-speed");
  if (speedEl) speedEl.textContent = _speedLabel(_state.playbackSpeed);
  const playEl = _state.timelineEl.querySelector(".bt-playpause");
  if (playEl) playEl.textContent = _state.playbackSpeed === 0 ? "▶" : "⏸";
}

// Click on a specific mark dot. Rewind the world to that moment;
// _rewindTo handles the detail-row update and the selected-dot
// styling automatically since the cursor lands exactly at the mark.
function _selectMark(mark) {
  if (!mark?.ts) return;
  // Explicit mark click is a hard scrub: kill active playback and
  // pin the cursor here.
  _stopPlayback();
  _state.cursorMs = new Date(mark.ts).getTime();
  _rewindTo(mark.ts);
}

// Populate (or clear) the detail row below the action buttons. The
// row stays hidden until a mark is selected so the strip stays slim
// on the unselected path.
function _renderDetail(mark) {
  if (!_state.timelineEl) return;
  const detail = _state.timelineEl.querySelector(".bt-detail");
  if (!detail) return;
  if (!mark) {
    detail.style.display = "none";
    detail.textContent = "";
    return;
  }
  const label = mark.label || "fact";
  const ts = _humanStamp(mark.ts);
  const seq = mark.seq != null ? ` · seq ${mark.seq}` : "";
  detail.textContent = `${label} · ${ts}${seq}`;
  detail.style.display = "block";
}

async function _branchHere() {
  if (!_state.atTimestamp) return;
  const parent = _state.timelineBranch || "0";
  try {
    // Relative `/@branch-manager` lets the wire inherit socket.currentBranch
    // automatically — no descriptor-state guessing, no race with
    // mid-flight branch switches. The cross-branch gate sees
    // caller=target by construction.
    _showBranchEvent(`creating branch from #${parent}…`);
    const result = await _state.client.do(
      `/@branch-manager`,
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

// ─────────────────────────────────────────────────────────────────────
// BRANCH INFO ("see branch")
// ─────────────────────────────────────────────────────────────────────
//
// SEEs `<reality>/.branches/<path>` — the synthetic branch surface,
// readable by any logged-in being — and renders the organized JSON it
// returns: branch-point seqs, pointers aimed here, scope, lineage,
// children, paused/deleted detail, who/when. A "raw" toggle dumps the
// full payload for anyone who wants every field.

let _branchInfoDialogEl = null;

async function _openBranchInfoDialog(branchPath) {
  if (_branchInfoDialogEl) _closeBranchInfoDialog();
  let graph = null;
  let err = null;
  try {
    const desc = await _state.client.see(`${_state.reality}/.branches/${branchPath}`);
    graph = desc?.branches || null;
  } catch (e) {
    err = e?.message || String(e);
  }

  const el = document.createElement("div");
  el.id = "branch-info-dialog";
  el.style.cssText = [
    "position: fixed",
    "top: 50%", "left: 50%",
    "transform: translate(-50%, -50%)",
    "width: min(560px, 92vw)",
    "max-height: 82vh",
    "overflow: auto",
    "background: rgba(10, 13, 12, 0.97)",
    "backdrop-filter: blur(6px)",
    "border: 1px solid #3d7a52",
    "border-radius: 8px",
    "color: #c8d3cb",
    "font-family: ui-monospace, monospace",
    "font-size: 12px",
    "z-index: 220",
    "padding: 16px 18px",
    "pointer-events: auto",
    "box-shadow: 0 10px 40px rgba(0,0,0,0.55)",
  ].join(";");

  const cur = graph?.current || null;
  const pointers = graph?.pointers || {};
  const aimedHere = Object.keys(pointers)
    .filter((name) => pointers[name] === branchPath)
    .sort();
  const lineage = Array.isArray(graph?.lineage) ? graph.lineage : [];
  const children = Array.isArray(graph?.children) ? graph.children : [];

  const rows = [];
  const kv = (k, v) => rows.push(
    `<div style="display:grid;grid-template-columns:130px 1fr;gap:8px;padding:3px 0;">
       <span style="color:#9ab2a3;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">${_escape(k)}</span>
       <span style="color:#c8d3cb;word-break:break-word;">${v}</span>
     </div>`,
  );

  if (err || !cur) {
    rows.push(`<div style="color:#d97a7a;">${_escape(err || `branch "${branchPath}" not found`)}</div>`);
  } else {
    kv("path", `#${_escape(cur.path)}`);
    if (cur.label) kv("label", _escape(cur.label));
    kv("live", cur.isLive ? "yes" : "no");
    kv("parent", cur.parent ? `#${_escape(cur.parent)}` : "main (root)");
    kv("lineage", lineage.map((p) => `#${_escape(p)}`).join(" → ") || "—");
    kv("children", children.length ? children.map((c) => `#${_escape(c.path)}`).join(", ") : "—");
    kv("pointers here", aimedHere.length ? aimedHere.map(_escape).join(", ") : "—");
    const anchor = cur.anchor && typeof cur.anchor === "object" ? cur.anchor : {};
    const anchorKeys = Object.keys(anchor);
    kv(
      "branch-point",
      anchorKeys.length
        ? anchorKeys.map((k) => `${_escape(k)} @ seq ${anchor[k]}`).join("<br>")
        : "(forked at genesis / no reels)",
    );
    kv("scope", cur.scope?.path ? `subtree ${_escape(cur.scope.path)}` : "whole reality");
    kv("created", `${cur.createdAt ? _shortStamp(cur.createdAt) : "?"}${cur.createdBy ? ` by ${_escape(String(cur.createdBy).slice(0, 8))}` : ""}`);
    if (cur.mergeSources?.length) kv("merged from", cur.mergeSources.map((s) => `#${_escape(s)}`).join(" + "));
    if (cur.paused) kv("paused", `yes${cur.pausedAt ? ` (${_shortStamp(cur.pausedAt)})` : ""}`);
    if (cur.deleted) kv("deleted", `yes${cur.deletedAt ? ` (${_shortStamp(cur.deletedAt)})` : ""}`);
    if (cur.archivedBecause) kv("archived", _escape(cur.archivedBecause));
  }

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="color:#8fbf9f;font-size:13px;">branch #${_escape(branchPath)} · info</span>
      <button type="button" class="bi-close" style="background:transparent;color:#6b7d72;border:none;font-size:18px;cursor:pointer;padding:0 4px;">×</button>
    </div>
    <div class="bi-body">${rows.join("")}</div>
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid #2c3a32;">
      <button type="button" class="bi-raw" style="background:#13201b;color:#8fbf9f;border:1px solid #3d7a52;border-radius:3px;padding:4px 10px;font-family:inherit;font-size:11px;cursor:pointer;">show raw JSON</button>
      <pre class="bi-json" style="display:none;margin-top:8px;background:#0a0d0c;border:1px solid #2c3a32;border-radius:3px;padding:8px;max-height:40vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:11px;color:#9ab0a3;"></pre>
    </div>
  `;
  document.body.appendChild(el);
  _branchInfoDialogEl = el;

  el.querySelector(".bi-close").addEventListener("click", _closeBranchInfoDialog);
  const rawBtn = el.querySelector(".bi-raw");
  const rawPre = el.querySelector(".bi-json");
  rawBtn.addEventListener("click", () => {
    if (rawPre.style.display === "none") {
      rawPre.textContent = JSON.stringify(graph, null, 2);
      rawPre.style.display = "block";
      rawBtn.textContent = "hide raw JSON";
    } else {
      rawPre.style.display = "none";
      rawBtn.textContent = "show raw JSON";
    }
  });

  function escClose(ev) {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      _closeBranchInfoDialog();
      window.removeEventListener("keydown", escClose, true);
    }
  }
  window.addEventListener("keydown", escClose, true);
}

function _closeBranchInfoDialog() {
  if (_branchInfoDialogEl) {
    _branchInfoDialogEl.remove();
    _branchInfoDialogEl = null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// NEW-BRANCH DIALOG
// ─────────────────────────────────────────────────────────────────────
//
// One modal over the tree panel. Maps directly to the create-branch op:
//   parent  — which branch to fork (defaults to the one you're on)
//   anchor  — a fact seq (substrate-native) OR a moment in time (human
//             helper); exactly one is required
//   scope   — omit for a whole-reality branch, or a subtree path for a
//             scoped branch (defaults to the position you're standing at;
//             "/" collapses to whole-reality)
// The branch-manager being carries the doctrine; this is a thin form.

let _newBranchDialogEl = null;

function _openNewBranchDialog() {
  if (_newBranchDialogEl) return;
  if (!_state.graphAll) {
    _showBranchEvent("tree not loaded yet", { error: true });
    return;
  }
  const branches = Array.from(_state.graphAll.byPath.values())
    .filter((b) => !b.deleted)
    .sort((a, b) => a.path.localeCompare(b.path));

  const curBranch = window.__state?.descriptor?.address?.branch || "0";
  const curPath = window.__state?.descriptor?.address?.pathByNames || "/";
  const atRoot = curPath === "/" || curPath === "";

  const opt = (b) => {
    const label = b.path === "0" ? "main (#0)" : `#${b.path}${b.label ? ` — ${_escape(b.label)}` : ""}`;
    const sel = b.path === curBranch ? " selected" : "";
    return `<option value="${b.path}"${sel}>${label}</option>`;
  };

  // datetime-local wants local "YYYY-MM-DDTHH:mm"; prefill with now.
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const localNow = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const el = document.createElement("div");
  el.id = "new-branch-dialog";
  el.style.cssText = [
    "position: fixed",
    "top: 50%", "left: 50%",
    "transform: translate(-50%, -50%)",
    "width: min(520px, 92vw)",
    "max-height: 80vh",
    "overflow: auto",
    "background: rgba(10, 13, 12, 0.97)",
    "backdrop-filter: blur(6px)",
    "border: 1px solid #3d7a52",
    "border-radius: 8px",
    "color: #c8d3cb",
    "font-family: ui-monospace, monospace",
    "font-size: 12px",
    "z-index: 220",
    "padding: 16px 18px",
    "pointer-events: auto",
    "box-shadow: 0 10px 40px rgba(0,0,0,0.55)",
  ].join(";");
  const labelCss = "color:#9ab2a3;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;";
  const inputCss = "background:#0a0d0c;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:5px 7px;font-family:inherit;font-size:12px;";
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="color:#8fbf9f;font-size:13px;">new branch</span>
      <button type="button" class="nb-close" style="background:transparent;color:#6b7d72;border:none;font-size:18px;cursor:pointer;padding:0 4px;">×</button>
    </div>
    <form class="nb-form" style="display:grid;gap:12px;">
      <label style="display:grid;gap:4px;">
        <span style="${labelCss}">parent branch (fork from)</span>
        <select name="parent" style="${inputCss}">${branches.map(opt).join("")}</select>
      </label>

      <fieldset style="border:1px solid #2c3a32;border-radius:4px;padding:8px 10px;display:grid;gap:8px;">
        <legend style="${labelCss}padding:0 4px;">branch point</legend>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="anchorType" value="time" checked /> at a moment in time
        </label>
        <input name="atTimestamp" type="datetime-local" value="${localNow}" style="${inputCss}" />
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="anchorType" value="seq" /> at a fact seq (advanced)
        </label>
        <input name="atSeq" type="number" min="0" placeholder="e.g. 42" style="${inputCss}" />
      </fieldset>

      <fieldset style="border:1px solid #2c3a32;border-radius:4px;padding:8px 10px;display:grid;gap:8px;">
        <legend style="${labelCss}padding:0 4px;">scope</legend>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="scopeType" value="whole" ${atRoot ? "checked" : ""} /> the whole reality
        </label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="scopeType" value="subtree" ${atRoot ? "" : "checked"} /> just this subtree
        </label>
        <input name="scopePath" type="text" value="${_escape(atRoot ? "" : curPath)}" placeholder="/path (writes outside refuse; reads inherit from parent)" style="${inputCss}" />
      </fieldset>

      <label style="display:grid;gap:4px;">
        <span style="${labelCss}">pointer (optional)</span>
        <input name="pointer" type="text" placeholder="e.g. feature-x" style="${inputCss}" />
        <span style="color:#6b7d72;font-size:10px;">a movable name that addresses this branch. if it's already taken you'll be asked whether to move it here.</span>
      </label>

      <div class="nb-error" style="display:none;color:#d97a7a;font-size:11px;padding:4px 6px;background:rgba(217,122,122,0.08);border:1px solid #5c2323;border-radius:3px;"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
        <button type="submit" class="nb-submit" style="background:#1a3424;color:#c8d3cb;border:1px solid #3d7a52;border-radius:3px;padding:6px 12px;font-family:inherit;font-size:12px;cursor:pointer;flex:1;">✚ create branch</button>
        <button type="button" class="nb-cancel" style="background:transparent;color:#6b7d72;border:1px solid #2c3a32;border-radius:3px;padding:6px 12px;font-family:inherit;font-size:12px;cursor:pointer;">cancel</button>
      </div>
    </form>
  `;
  document.body.appendChild(el);
  _newBranchDialogEl = el;

  const close = () => _closeNewBranchDialog();
  el.querySelector(".nb-close").addEventListener("click", close);
  el.querySelector(".nb-cancel").addEventListener("click", close);

  const form = el.querySelector(".nb-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const errEl = el.querySelector(".nb-error");
    const fail = (msg) => { errEl.textContent = msg; errEl.style.display = "block"; };
    errEl.style.display = "none";
    errEl.textContent = "";

    const fd = new FormData(form);
    const args = { parent: String(fd.get("parent") || "0").trim() || "0" };

    if (String(fd.get("anchorType")) === "seq") {
      const raw = String(fd.get("atSeq") || "").trim();
      if (raw === "") return fail("enter a fact seq, or anchor by time");
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) return fail("fact seq must be a non-negative integer");
      args.atSeq = n;
    } else {
      const raw = String(fd.get("atTimestamp") || "").trim();
      if (!raw) return fail("pick a moment in time, or anchor by seq");
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return fail("invalid time");
      args.atTimestamp = d.toISOString();
    }

    if (String(fd.get("scopeType")) === "subtree") {
      let p = String(fd.get("scopePath") || "").trim();
      if (p && p !== "/") {
        if (!p.startsWith("/")) p = "/" + p;
        args.scope = p;
      }
      // empty or "/" → whole reality (omit scope)
    }

    const pointer = String(fd.get("pointer") || "").trim().toLowerCase();
    if (pointer) args.pointer = pointer;

    const submitBtn = el.querySelector(".nb-submit");
    const prev = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "creating…";
    try {
      let result;
      try {
        result = await _state.client.do("/@branch-manager", "create-branch", args);
      } catch (err) {
        // Pointer already taken — ask whether to move it here, leaving the
        // old branch on its canonical path without the pointer.
        const conflict = err?.code === "RESOURCE_CONFLICT" || /already on branch|reassignPointer/i.test(err?.message || "");
        if (conflict && pointer) {
          const heldBy = err?.data?.heldBy || err?.heldBy || null;
          const where = heldBy ? ` (currently on #${heldBy})` : "";
          const move = window.confirm(
            `The pointer "${pointer}" is already taken${where}.\n\n` +
            `Move it to this new branch? The old branch keeps its canonical path` +
            `${heldBy ? ` (#${heldBy})` : ""} but loses the "${pointer}" pointer.`,
          );
          if (!move) throw new Error(`cancelled — "${pointer}" left where it was`);
          result = await _state.client.do(
            "/@branch-manager",
            "create-branch",
            { ...args, reassignPointer: true },
          );
        } else {
          throw err;
        }
      }
      const r = result?.result || result;
      if (!r?.path) throw new Error(r?.error?.message || "create-branch returned no path");
      _closeNewBranchDialog();
      _closePanel();
      const scopeNote = args.scope ? ` (subtree ${args.scope})` : "";
      const ptrNote = (r.pointerAttached || (pointer && !r.pointerWarning)) ? ` · pointer "${pointer}"` : "";
      _showBranchEvent(`✨ branched! now on #${r.path}${scopeNote}${ptrNote}`, { sticky: 2500 });
      location.hash = `#${_state.reality}#${r.path}/`;
    } catch (err) {
      console.warn("[branch-bar] create-branch failed:", err);
      fail(err?.message || String(err));
      submitBtn.disabled = false;
      submitBtn.textContent = prev;
    }
  });

  function escClose(ev) {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
      window.removeEventListener("keydown", escClose, true);
    }
  }
  window.addEventListener("keydown", escClose, true);
}

function _closeNewBranchDialog() {
  if (_newBranchDialogEl) {
    _newBranchDialogEl.remove();
    _newBranchDialogEl = null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// MERGE DIALOG
// ─────────────────────────────────────────────────────────────────────
//
// One modal overlay over the branch tree panel. Two source pickers,
// the three afterAction choices, an optional comma-separated list of
// named pointers to re-point at the merged branch, and a checkbox to
// also summon the @merge-mediator role at the result for the LLM
// walkthrough. All resolved in one `merge-branches` substrate call.
//
// The dialog is a thin wrapper; substrate carries the doctrine. Every
// decision the user makes lands as a fact on the merged branch's reel
// (either the merge fact itself or the mediator's reconciliation
// stamps), so live SEE on the conflict catalog stays the source of
// truth for both UI re-renders and the next mediator pickup point.

// ────────────────────────────────────────────────────────────────
// Copy (clone) + graft
// ────────────────────────────────────────────────────────────────
//
// `Copy`: calls reality.see("clone-subtree", { args: { spaceId, name } })
// — the chain rebuild is a pure read — and downloads the returned bundle
// as a .clone.json file. The subtree is rooted at the user's current
// position; the seed's cloneSubtree primitive walks descendants + their
// beings + matter, capturing facts only (the shape, no history) — per
// done/Chain-Rebuild.md, a clone is a cutting.
//
// `Graft`: file-picker → reads JSON → calls do(currentPath,
// "graft-clone", {bundle}). The bundle's content lands as fresh spaces /
// beings / matter under the user's current position. Refs inside the
// bundle remap to bare-string ids in the target's namespace (the
// substrate everywhere stores bare; the bundle is the only place Refs
// live).

function _currentAddressPath() {
  return window.__state?.descriptor?.address?.pathByNames || null;
}

async function _downloadClone() {
  const addr = _currentAddressPath();
  if (!addr) {
    throw new Error("no current address to copy from");
  }
  const spaceId = window.__state?.descriptor?.address?.spaceId
    || window.__state?.descriptor?.position?.spaceId
    || null;
  if (!spaceId) {
    throw new Error("no spaceId on current descriptor to clone from");
  }
  const placeName = window.__state?.descriptor?.address?.spaceName || "place";
  _showBranchEvent(`copying ${placeName}…`);
  const result = await _state.client.see("clone-subtree", {
    args: { spaceId, name: placeName },
  });
  const bundle = result?.bundle;
  if (!bundle) {
    throw new Error("copy returned no bundle");
  }
  // Pretty-print + JSON download.
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const stamp = bundle.meta?.createdAt?.replace(/[:.]/g, "-").slice(0, 19) || "snapshot";
  const a = document.createElement("a");
  a.href = url;
  a.download = `${placeName}-${stamp}.clone.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const counts = `${bundle.content?.spaces?.length || 0} spaces, ${bundle.content?.beings?.length || 0} beings, ${bundle.content?.matter?.length || 0} matter`;
  _showBranchEvent(`✓ copied ${placeName} (${counts})`);
}

async function _graftFromFile(file) {
  const addr = _currentAddressPath();
  if (!addr) {
    throw new Error("no current address to graft into");
  }
  const text = await file.text();
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch (err) {
    throw new Error(`bundle file is not valid JSON: ${err.message}`);
  }
  const srcName = bundle?.meta?.sourceScopeName || "bundle";
  _showBranchEvent(`grafting ${srcName} under ${addr}…`);
  const result = await _state.client.do(addr, "graft-clone", { bundle });
  const counts = `${result?.counts?.spaces || 0} spaces, ${result?.counts?.beings || 0} beings, ${result?.counts?.matter || 0} matter`;
  _showBranchEvent(`✓ grafted ${srcName} (${counts})`);
  // Refetch the tree so any newly created branches surface (clones
  // don't make branches, but operators may follow up with a branch).
  await _loadBranchTree();
  if (_state.panelEl) {
    const treeContainer = _state.panelEl.querySelector(".bp-tree");
    if (treeContainer) _renderTree(treeContainer, _state.graphAll);
  }
}

let _mergeDialogEl = null;

function _openMergeDialog() {
  if (_mergeDialogEl) return;
  if (!_state.graphAll) {
    _showBranchEvent("tree not loaded yet", { error: true });
    return;
  }
  const branches = Array.from(_state.graphAll.byPath.values())
    .filter(b => !b.deleted)
    .sort((a, b) => a.path.localeCompare(b.path));

  const opt = (b, selected) => {
    const label = b.path === "0" ? "main (#0)" : `#${b.path}${b.label ? ` — ${_escape(b.label)}` : ""}`;
    const sel = selected ? " selected" : "";
    return `<option value="${b.path}"${sel}>${label}</option>`;
  };

  const el = document.createElement("div");
  el.id = "merge-dialog";
  el.style.cssText = [
    "position: fixed",
    "top: 50%", "left: 50%",
    "transform: translate(-50%, -50%)",
    "width: min(520px, 92vw)",
    "max-height: 80vh",
    "overflow: auto",
    "background: rgba(10, 13, 12, 0.97)",
    "backdrop-filter: blur(6px)",
    "border: 1px solid #3d7a52",
    "border-radius: 8px",
    "color: #c8d3cb",
    "font-family: ui-monospace, monospace",
    "font-size: 12px",
    "z-index: 220",
    "padding: 16px 18px",
    "pointer-events: auto",
    "box-shadow: 0 10px 40px rgba(0,0,0,0.55)",
  ].join(";");
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="color:#8fbf9f;font-size:13px;">merge two branches</span>
      <button type="button" class="md-close" style="background:transparent;color:#6b7d72;border:none;font-size:18px;cursor:pointer;padding:0 4px;">×</button>
    </div>
    <form class="md-form" style="display:grid;gap:12px;">
      <label style="display:grid;gap:4px;">
        <span style="color:#9ab2a3;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">source A</span>
        <select name="sourceA" style="background:#0a0d0c;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:5px 7px;font-family:inherit;font-size:12px;">
          ${branches.map((b, i) => opt(b, i === 0)).join("")}
        </select>
      </label>
      <label style="display:grid;gap:4px;">
        <span style="color:#9ab2a3;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">source B</span>
        <select name="sourceB" style="background:#0a0d0c;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:5px 7px;font-family:inherit;font-size:12px;">
          ${branches.map((b, i) => opt(b, i === 1)).join("")}
        </select>
      </label>
      <label style="display:grid;gap:4px;">
        <span style="color:#9ab2a3;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">label for the merged branch (optional)</span>
        <input name="label" type="text" placeholder="e.g. release-candidate" style="background:#0a0d0c;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:5px 7px;font-family:inherit;font-size:12px;" />
      </label>
      <fieldset style="border:1px solid #2c3a32;border-radius:4px;padding:8px 10px;display:grid;gap:6px;">
        <legend style="color:#9ab2a3;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;padding:0 4px;">after the merge</legend>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="afterAction" value="keep" checked /> keep the source branches as they are
        </label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="afterAction" value="pause" /> pause both sources (they stop ticking; can resume)
        </label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="afterAction" value="delete" /> delete both sources (soft delete; can undelete)
        </label>
      </fieldset>
      <fieldset style="border:1px solid #2c3a32;border-radius:4px;padding:8px 10px;display:grid;gap:6px;">
        <legend style="color:#9ab2a3;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;padding:0 4px;">the merged branch</legend>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="pauseResult" value="false" checked /> keep it live (continue running while you resolve)
        </label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;">
          <input type="radio" name="pauseResult" value="true" /> pause until conflicts resolved (no drift, no ticks)
        </label>
      </fieldset>
      <label style="display:grid;gap:4px;">
        <span style="color:#9ab2a3;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">re-point named pointers at the merged branch</span>
        <input name="repointPointers" type="text" placeholder="e.g. main,prod (comma-separated; blank to skip)" style="background:#0a0d0c;color:#c8d3cb;border:1px solid #2c3a32;border-radius:3px;padding:5px 7px;font-family:inherit;font-size:12px;" />
        <span style="color:#6b7d72;font-size:10px;">canonical paths stay forever; pointers move so default addresses follow main wherever it goes</span>
      </label>
      <label style="display:flex;gap:6px;align-items:center;cursor:pointer;padding:6px 8px;background:#0e1a14;border:1px solid #2c3a32;border-radius:4px;">
        <input type="checkbox" name="summonMediator" checked />
        <div style="display:grid;gap:2px;">
          <span style="color:#c8d3cb;">summon @merge-mediator after the merge</span>
          <span style="color:#6b7d72;font-size:10px;">LLM walks you through conflicts; each decision lands as a fact and the catalog updates live</span>
        </div>
      </label>
      <div class="md-error" style="display:none;color:#d97a7a;font-size:11px;padding:4px 6px;background:rgba(217,122,122,0.08);border:1px solid #5c2323;border-radius:3px;"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
        <button type="submit" class="md-submit" style="background:#1a3424;color:#c8d3cb;border:1px solid #3d7a52;border-radius:3px;padding:6px 12px;font-family:inherit;font-size:12px;cursor:pointer;flex:1;">
          ⇄ merge now
        </button>
        <button type="button" class="md-cancel" style="background:transparent;color:#6b7d72;border:1px solid #2c3a32;border-radius:3px;padding:6px 12px;font-family:inherit;font-size:12px;cursor:pointer;">
          cancel
        </button>
      </div>
    </form>
  `;
  document.body.appendChild(el);
  _mergeDialogEl = el;

  const close = () => _closeMergeDialog();
  el.querySelector(".md-close").addEventListener("click", close);
  el.querySelector(".md-cancel").addEventListener("click", close);

  const form = el.querySelector(".md-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const errEl = el.querySelector(".md-error");
    errEl.style.display = "none";
    errEl.textContent = "";
    const fd = new FormData(form);
    const sourceA = String(fd.get("sourceA") || "").trim();
    const sourceB = String(fd.get("sourceB") || "").trim();
    if (!sourceA || !sourceB) {
      errEl.textContent = "pick both sources";
      errEl.style.display = "block";
      return;
    }
    if (sourceA === sourceB) {
      errEl.textContent = "sources must differ";
      errEl.style.display = "block";
      return;
    }
    const submitBtn = el.querySelector(".md-submit");
    const prevSubmitText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "merging…";
    try {
      const args = {
        sourceA,
        sourceB,
        label: String(fd.get("label") || "").trim() || undefined,
        afterAction: String(fd.get("afterAction") || "keep"),
        pauseResult: String(fd.get("pauseResult") || "false"),
      };
      const repointPointers = String(fd.get("repointPointers") || "").trim();
      if (repointPointers) args.repointPointers = repointPointers;

      const result = await _state.client.do(
        "/@branch-manager",
        "merge-branches",
        args,
      );
      const r = result?.result || result;
      if (!r?.path) {
        throw new Error(r?.error?.message || "merge returned no path");
      }

      const summonMediator = fd.get("summonMediator") === "on";
      _closeMergeDialog();
      _closePanel();
      _showBranchEvent(
        `⇄ merged #${sourceA} + #${sourceB} → #${r.path}${summonMediator ? " · summoning mediator…" : ""}`,
        { sticky: 3500 },
      );

      // Navigate to the merged branch so the conflict catalog (and
      // any in-flight mediator messages) surface in the active view.
      location.hash = `#${_state.reality}#${r.path}/`;

      if (summonMediator) {
        // Fire-and-forget. The mediator's first response arrives via
        // the SUMMON push channel; the conflict catalog SEE on the
        // merged branch reflects each reconciliation fact as it lands.
        try {
          await _state.client.summon(
            `/@merge-mediator`,
            {
              from: "user",
              content: `Walk me through the conflicts on #${r.path}. The conflict catalog is at /.branches/${r.path}/conflicts.`,
            },
          );
        } catch (err) {
          console.warn("[branch-bar] mediator summon failed:", err?.message || err);
          _showBranchEvent(`mediator summon failed: ${err?.message || err}`, { error: true });
        }
      }
    } catch (err) {
      console.warn("[branch-bar] merge-branches failed:", err);
      errEl.textContent = err?.message || String(err);
      errEl.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = prevSubmitText;
    }
  });

  // Esc closes the dialog (without closing the underlying tree panel).
  function escClose(ev) {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      close();
      window.removeEventListener("keydown", escClose, true);
    }
  }
  window.addEventListener("keydown", escClose, true);
}

function _closeMergeDialog() {
  if (_mergeDialogEl) {
    _mergeDialogEl.remove();
    _mergeDialogEl = null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// CONFLICT CATALOG PANEL
// ─────────────────────────────────────────────────────────────────────
//
// Opens via the "↶ N open" link on a merged-branch row in the tree.
// SEEs `<reality>/.branches/<mergedPath>/conflicts` and renders the
// per-reel decision log. Every action on the panel either stamps a
// reconciliation fact (via DO) or summons the mediator (via SUMMON);
// both land in the same chain and the panel's re-render reflects
// whichever showed up.
//
// Refresh strategy: re-fetch the catalog after every action. Live
// push-based updates are a follow-up; the catalog SEE is cheap.

let _conflictPanelEl = null;
let _conflictPanelBranch = null;

async function _openConflictPanel(mergedPath) {
  _conflictPanelBranch = mergedPath;
  if (_conflictPanelEl) _conflictPanelEl.remove();

  const el = document.createElement("div");
  el.id = "conflict-panel";
  el.style.cssText = [
    "position: fixed",
    "top: 50%", "left: 50%",
    "transform: translate(-50%, -50%)",
    "width: min(720px, 94vw)",
    "max-height: 84vh",
    "overflow: hidden",
    "background: rgba(10, 13, 12, 0.97)",
    "backdrop-filter: blur(6px)",
    "border: 1px solid #3d7a52",
    "border-radius: 8px",
    "color: #c8d3cb",
    "font-family: ui-monospace, monospace",
    "font-size: 12px",
    "z-index: 220",
    "padding: 0",
    "pointer-events: auto",
    "display: flex",
    "flex-direction: column",
    "box-shadow: 0 10px 40px rgba(0,0,0,0.55)",
  ].join(";");
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px 10px;border-bottom:1px solid #2c3a32;">
      <div>
        <div style="color:#8fbf9f;font-size:13px;">resolve merge conflicts</div>
        <div class="cp-subtitle" style="color:#6b7d72;font-size:10px;margin-top:2px;">loading…</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button type="button" class="cp-mediator" style="background:#13201b;color:#8fbf9f;border:1px solid #3d7a52;border-radius:3px;padding:5px 10px;font-family:inherit;font-size:11px;cursor:pointer;">
          ✨ summon @merge-mediator
        </button>
        <button type="button" class="cp-refresh" style="background:transparent;color:#6b7d72;border:1px solid #2c3a32;border-radius:3px;padding:5px 10px;font-family:inherit;font-size:11px;cursor:pointer;">
          ↻ refresh
        </button>
        <button type="button" class="cp-close" style="background:transparent;color:#6b7d72;border:none;font-size:18px;cursor:pointer;padding:0 4px;">×</button>
      </div>
    </div>
    <div class="cp-body" style="overflow:auto;padding:14px 18px;flex:1;">
      <div class="cp-loading" style="color:#6b7d72;padding:24px;text-align:center;">loading catalog…</div>
    </div>
  `;
  document.body.appendChild(el);
  _conflictPanelEl = el;

  el.querySelector(".cp-close").addEventListener("click", _closeConflictPanel);
  el.querySelector(".cp-refresh").addEventListener("click", () => _refreshConflictPanel());
  el.querySelector(".cp-mediator").addEventListener("click", () => _summonMediatorForBranch(mergedPath));

  function escClose(ev) {
    if (ev.key === "Escape" && _conflictPanelEl) {
      ev.stopPropagation();
      _closeConflictPanel();
      window.removeEventListener("keydown", escClose, true);
    }
  }
  window.addEventListener("keydown", escClose, true);

  await _refreshConflictPanel();
}

function _closeConflictPanel() {
  if (_conflictPanelEl) {
    _conflictPanelEl.remove();
    _conflictPanelEl = null;
    _conflictPanelBranch = null;
  }
}

async function _refreshConflictPanel() {
  if (!_conflictPanelEl || !_conflictPanelBranch) return;
  // Invalidate cached counts for this branch so the tree-row badge
  // re-fetches when the panel closes or the tree re-renders.
  _conflictCountCache.delete(_conflictPanelBranch);
  const body = _conflictPanelEl.querySelector(".cp-body");
  const subtitle = _conflictPanelEl.querySelector(".cp-subtitle");
  body.innerHTML = `<div style="color:#6b7d72;padding:24px;text-align:center;">loading catalog…</div>`;
  let catalog;
  try {
    catalog = await _state.client.see(
      `${_state.reality}/.branches/${_conflictPanelBranch}/conflicts`,
    );
  } catch (err) {
    body.innerHTML = `<div style="color:#d97a7a;padding:16px;">failed to load catalog: ${_escape(err?.message || String(err))}</div>`;
    return;
  }
  const c = catalog?.conflicts || catalog;
  if (c?.notFound) {
    body.innerHTML = `<div style="color:#6b7d72;padding:16px;">branch #${_conflictPanelBranch} not found</div>`;
    return;
  }
  if (c?.notAMerge) {
    body.innerHTML = `<div style="color:#6b7d72;padding:16px;">#${_conflictPanelBranch} is not a merge result (no mergeSources)</div>`;
    return;
  }

  const sourceA = c?.sourceA;
  const sourceB = c?.sourceB;
  const totals = c?.totals || {};
  subtitle.textContent =
    `#${_conflictPanelBranch} merged from #${sourceA} + #${sourceB} · ` +
    `${totals.conflictsOpen || 0} open, ${totals.conflictsResolved || 0} resolved, ${totals.cleanA + totals.cleanB || 0} clean`;

  const items = Array.isArray(c?.conflicts) ? c.conflicts : [];
  if (items.length === 0) {
    body.innerHTML = `<div style="color:#8fbf9f;padding:16px;">no divergent reels . nothing to resolve.</div>`;
    return;
  }

  const groups = {
    open:     items.filter(it => it.side === "conflict" && it.status === "open"),
    resolved: items.filter(it => it.side === "conflict" && it.status === "resolved"),
    cleanA:   items.filter(it => it.side === "clean-A"),
    cleanB:   items.filter(it => it.side === "clean-B"),
  };

  body.innerHTML = "";
  if (groups.open.length === 0 && groups.resolved.length === 0) {
    const note = document.createElement("div");
    note.style.cssText = "color:#8fbf9f;padding:8px 0 12px;";
    note.textContent = "no two-sided conflicts. the merged branch inherits everything cleanly through reel-lineage.";
    body.appendChild(note);
  }
  if (groups.open.length > 0) {
    body.appendChild(_groupHeader(`open conflicts (${groups.open.length})`, "#e8b762"));
    for (const it of groups.open) body.appendChild(_renderConflictRow(it, sourceA, sourceB, "open"));
  }
  if (groups.resolved.length > 0) {
    body.appendChild(_groupHeader(`resolved (${groups.resolved.length})`, "#8fbf9f"));
    for (const it of groups.resolved) body.appendChild(_renderConflictRow(it, sourceA, sourceB, "resolved"));
  }
  if (groups.cleanA.length + groups.cleanB.length > 0) {
    body.appendChild(_groupHeader(`clean (${groups.cleanA.length + groups.cleanB.length}) — auto-inherits from one side`, "#6b7d72"));
    const cleanSummary = document.createElement("div");
    cleanSummary.style.cssText = "padding:4px 0 12px;color:#6b7d72;font-size:10px;";
    cleanSummary.textContent = `${groups.cleanA.length} from #${sourceA}, ${groups.cleanB.length} from #${sourceB}`;
    body.appendChild(cleanSummary);
  }
}

function _groupHeader(text, color) {
  const h = document.createElement("div");
  h.style.cssText = `color:${color};text-transform:uppercase;letter-spacing:0.6px;font-size:10px;margin:12px 0 6px;border-top:1px solid #2c3a32;padding-top:8px;`;
  h.textContent = text;
  return h;
}

function _renderConflictRow(item, sourceA, sourceB, kind) {
  const row = document.createElement("div");
  row.style.cssText = "border:1px solid #2c3a32;border-radius:4px;padding:8px 10px;margin-bottom:6px;display:grid;gap:6px;";
  if (kind === "resolved") row.style.background = "rgba(45, 76, 55, 0.12)";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;gap:8px;";
  const reel = document.createElement("code");
  reel.style.cssText = "color:#c8d3cb;font-size:11px;";
  reel.textContent = item.reelKey;
  head.appendChild(reel);
  const status = document.createElement("span");
  status.style.cssText = `font-size:10px;color:${kind === "open" ? "#e8b762" : "#8fbf9f"};`;
  status.textContent = kind === "open" ? "open" : "resolved";
  head.appendChild(status);
  row.appendChild(head);

  if (kind === "open") {
    const sides = document.createElement("div");
    sides.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10px;";
    sides.appendChild(_sidePreview(`#${sourceA}`, item.lastFactA));
    sides.appendChild(_sidePreview(`#${sourceB}`, item.lastFactB));
    row.appendChild(sides);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;margin-top:4px;";
    actions.appendChild(_actionButton("✨ delegate to mediator", () =>
      _summonMediatorForConflict(item, sourceA, sourceB)));
    row.appendChild(actions);
  } else {
    const res = item.resolution || {};
    const r = document.createElement("div");
    r.style.cssText = "font-size:10px;color:#9ab2a3;";
    const strategy = res.strategy ? `strategy: ${res.strategy}` : "manual override";
    const src = res.sourceBranch ? ` · from #${res.sourceBranch}` : "";
    const when = res.date ? ` · ${_shortStamp(res.date)}` : "";
    r.textContent = `${strategy}${src}${when}`;
    row.appendChild(r);
    if (res.value) {
      const v = document.createElement("pre");
      v.style.cssText = "margin:0;padding:4px 6px;background:rgba(0,0,0,0.25);border-radius:3px;color:#c8d3cb;font-size:10px;white-space:pre-wrap;word-break:break-word;max-height:80px;overflow:auto;";
      v.textContent = JSON.stringify(res.value, null, 2);
      row.appendChild(v);
    }
  }
  return row;
}

function _sidePreview(label, fact) {
  const card = document.createElement("div");
  card.style.cssText = "border:1px solid #1f2a23;border-radius:3px;padding:5px 7px;background:rgba(0,0,0,0.18);";
  const top = document.createElement("div");
  top.style.cssText = "color:#9ab2a3;margin-bottom:3px;";
  top.textContent = label;
  card.appendChild(top);
  if (!fact) {
    const empty = document.createElement("div");
    empty.style.cssText = "color:#6b7d72;font-style:italic;";
    empty.textContent = "(no divergent writes)";
    card.appendChild(empty);
    return card;
  }
  const action = document.createElement("div");
  action.style.cssText = "color:#c8d3cb;";
  action.textContent = fact.action || "(action)";
  card.appendChild(action);
  if (fact.params) {
    const params = document.createElement("pre");
    params.style.cssText = "margin:2px 0 0;padding:0;color:#9ab2a3;font-size:10px;white-space:pre-wrap;word-break:break-word;max-height:70px;overflow:auto;";
    params.textContent = JSON.stringify(fact.params, null, 2);
    card.appendChild(params);
  }
  return card;
}

function _actionButton(label, onclick) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.style.cssText = "background:#13201b;color:#8fbf9f;border:1px solid #3d7a52;border-radius:3px;padding:4px 8px;font-family:inherit;font-size:10px;cursor:pointer;";
  b.addEventListener("click", onclick);
  return b;
}

async function _summonMediatorForBranch(branchPath) {
  try {
    _showBranchEvent("✨ summoning @merge-mediator…");
    await _state.client.summon(
      `/@merge-mediator`,
      {
        from: "user",
        content:
          `Walk me through the conflicts on #${branchPath}. ` +
          `The catalog is at ${_state.reality}/.branches/${branchPath}/conflicts. ` +
          `Pick up at the first row marked status=open and propose a resolution.`,
      },
    );
    _showBranchEvent("✨ mediator summoned", { sticky: 2200 });
    setTimeout(() => _refreshConflictPanel(), 800);
  } catch (err) {
    console.warn("[branch-bar] mediator summon failed:", err?.message || err);
    _showBranchEvent(`mediator summon failed: ${err?.message || err}`, { error: true });
  }
}

async function _summonMediatorForConflict(item, sourceA, sourceB) {
  try {
    _showBranchEvent("✨ summoning @merge-mediator for one conflict…");
    await _state.client.summon(
      `/@merge-mediator`,
      {
        from: "user",
        content:
          `Resolve this specific conflict on #${_conflictPanelBranch}: ` +
          `reel ${item.reelKey} was touched on both #${sourceA} and #${sourceB}. ` +
          `Suggested strategy: ${item.suggestedStrategy}. ` +
          `Propose a resolution and stamp the reconciliation fact.`,
      },
    );
    setTimeout(() => _refreshConflictPanel(), 800);
  } catch (err) {
    _showBranchEvent(`mediator summon failed: ${err?.message || err}`, { error: true });
  }
}

// Small HTML-entity escape for user-provided strings rendered into the
// dialog (branch labels, etc.). Defensive against any control chars
// that might end up in option text.
function _escape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
      "z-index: 240",
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
