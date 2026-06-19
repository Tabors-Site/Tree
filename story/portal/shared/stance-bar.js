// TreeOS Portal . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The stance bar — THE one address bar, shared by the 3D portal and
// the flat (text) portal. One DOM node, re-parented between hosts,
// so the two views can never disagree:
//
//   [ story#aBranch/@being ] :: [ story#vBranch/path@being ]
//        the actor stance          the receiving stance
//
// The LEFT stance ALWAYS shows the being you are using (the one your
// acts ride through) — `@arrival` when you are bodiless at the floor,
// `@<yourBeing>` when driving one. Never a placeholder.
//
// Both sides are editable and both auto-update:
//   - LEFT (who you are, where your acts land): edit the @being to
//     SWITCH to another being your name owns, and/or the #branch to
//     switch timeline, then Enter. A being you don't own / that isn't
//     on that branch comes back as a name error ("that name doesn't
//     have @<being> on #<branch>"); other garbled edits restore on blur.
//   - RIGHT (what you are looking at): a normal address input; Enter
//     navigates. Same id (#address-input) the portals always used,
//     so existing styling and the flat portal's "/" focus shortcut
//     keep working untouched.
//
// Branches render EXPLICIT on both sides (#0 included) — pointers
// (#main etc.) are reassignable, explicit paths can't drift; pointer
// aliases ride the tooltips. When the two stances sit on different
// branches the bar turns amber: the cross-branch acting state, always
// visible, never a surprise.

let _bar = null; // { el, left, sep, right }
let _cbs = { onNavigate: null, onSwitchHistory: null };
let _ctx = {
  story: "",
  username: null,
  signedIn: false,
  actorHistory: "0",
  // Where the being IS (its position path — follows every live
  // navigate's set-being:position). The left stance renders from
  // this, so left and right match unless the view diverges.
  actorPath: "/",
  viewHistory: "0",
  path: "/",
  being: null,
  pointers: {},
};

function _historyAliases(path) {
  const aliases = Object.keys(_ctx.pointers || {})
    .filter((n) => _ctx.pointers[n] === path)
    .sort();
  return aliases.length ? ` (${aliases.join(",")})` : "";
}

function _actorValue() {
  // The being you're USING. Bodiless at the floor → @arrival; driving a
  // being → its name. Never a placeholder — the left stance always names
  // the presence your acts ride through.
  const name = _ctx.username || "arrival";
  const p = _ctx.actorPath || "/";
  return `${_ctx.story || ""}#${_ctx.actorHistory}${p === "/" ? "/" : p}@${name}`;
}

function _viewValue() {
  const p = _ctx.path || "/";
  const being = _ctx.being ? `@${_ctx.being}` : "";
  return `${_ctx.story || ""}#${_ctx.viewHistory}${p === "/" ? "/" : p}${being}`;
}

function _paint() {
  if (!_bar) return;
  const { left, sep, right } = _bar;
  if (document.activeElement !== left) left.value = _actorValue();
  if (document.activeElement !== right) right.value = _viewValue();
  const crossed = _ctx.actorHistory !== _ctx.viewHistory;
  const accent = crossed ? "#8a6d2f" : "";
  const text = crossed ? "#e2c574" : "";
  left.style.borderColor = accent;
  left.style.color = text;
  right.style.borderColor = accent;
  right.style.color = text;
  sep.style.color = crossed ? "#e2c574" : "";
  left.title =
    `you are @${_ctx.username || "arrival"} — acts land on #${_ctx.actorHistory}${_historyAliases(_ctx.actorHistory)}\n` +
    `edit @being to drive another being you own, and/or #branch to switch timeline, then Enter`;
  right.title = `the receiving stance — what you're looking at` +
    `${_historyAliases(_ctx.viewHistory) ? `\nbranch${_historyAliases(_ctx.viewHistory)}` : ""}`;
  sep.title = crossed
    ? `cross-branch: your being is seated on #${_ctx.actorHistory} while viewing #${_ctx.viewHistory} — acts from here land cross-branch`
    : "your being and the view are on the same branch";
}

// Pull the #branch segment out of an actor-stance string the user
// edited: "story#1a/@name" → "1a". Null when absent/garbled.
function _parseBranchEdit(raw) {
  const m = String(raw).match(/#([0-9][0-9a-z]*)(?=\/|$)/i);
  return m ? m[1] : null;
}

// Pull the @being segment out of an actor-stance string: the trailing
// "@<being>". Null when absent. "story#1a/@coder" → "coder".
function _parseBeingEdit(raw) {
  const m = String(raw).match(/@([^/@#\s]+)\s*$/);
  return m ? m[1] : null;
}

/**
 * Create the bar once. Callbacks:
 *   onNavigate(raw)            — right-side Enter (a normal address)
 *   onSwitchHistory(path)       — left-side Enter, only the #branch changed
 *   onSwitchBeing(being, path) — left-side Enter, the @being changed (drive
 *                                another being your name owns, on `path`)
 */
export function initStanceBar({ onNavigate, onSwitchHistory, onSwitchBeing } = {}) {
  _cbs = { onNavigate, onSwitchHistory, onSwitchBeing };
  if (_bar) return _bar.el;

  const el = document.createElement("div");
  el.id = "stance-bar";
  el.style.cssText =
    "display:flex; align-items:center; gap:6px; flex:1; min-width:0;";

  const left = document.createElement("input");
  left.id = "stance-actor";
  left.type = "text";
  left.autocomplete = "off";
  left.spellcheck = false;
  left.style.cssText =
    "flex:0 1 230px; min-width:140px; background:rgba(10,13,12,0.6); " +
    "color:#c8d3cb; border:1px solid #2c3a32; border-radius:4px; " +
    "padding:3px 8px; font:11px/1.4 ui-monospace,monospace;";

  const sep = document.createElement("span");
  sep.id = "stance-sep";
  sep.textContent = "::";
  sep.style.cssText = "opacity:0.8; font:12px ui-monospace,monospace; user-select:none;";

  const right = document.createElement("input");
  right.id = "address-input"; // historical id: styling + "/" focus key off it
  right.type = "text";
  right.placeholder = "story#branch/path@being";
  right.autocomplete = "off";
  right.spellcheck = false;
  right.style.cssText = "flex:1 1 auto; min-width:160px;";

  left.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { left.blur(); _paint(); return; }
    if (e.key !== "Enter") return;
    const raw = left.value.trim();
    const targetHistory = _parseBranchEdit(raw) || _ctx.actorHistory;
    const targetBeing = _parseBeingEdit(raw);
    const curBeing = _ctx.username || "arrival";
    left.blur();
    // A changed @being wins: drive that being (on the parsed branch). Else a
    // changed #branch alone is a BE switch (keep the being). Else restore —
    // the left side names who you are, not a free-text field.
    if (targetBeing && targetBeing !== curBeing && _cbs.onSwitchBeing) {
      _cbs.onSwitchBeing(targetBeing, targetHistory);
    } else if (targetHistory !== _ctx.actorHistory && _cbs.onSwitchHistory) {
      _cbs.onSwitchHistory(targetHistory);
    } else {
      _paint();
    }
  });
  left.addEventListener("blur", () => _paint());
  left.addEventListener("focus", () => document.exitPointerLock?.());

  right.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { right.blur(); _paint(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const raw = right.value.trim();
    right.blur();
    if (raw && _cbs.onNavigate) _cbs.onNavigate(raw);
  });
  right.addEventListener("blur", () => _paint());
  right.addEventListener("focus", () => document.exitPointerLock?.());

  el.append(left, sep, right);
  _bar = { el, left, sep, right };
  _paint();
  return el;
}

/**
 * Put the bar somewhere (it re-parents — the SAME node serves the 3D
 * top bar and the flat overlay's header, so they cannot drift).
 */
export function placeStanceBar(container) {
  if (!_bar || !container) return;
  if (_bar.el.parentElement !== container) container.appendChild(_bar.el);
}

/**
 * Merge new context and repaint. Both portals push partials —
 * navigation pushes the view side, the "branch" socket push updates
 * the actor side, the branch catalog pushes pointers — and the bar
 * stays whole because the context is one.
 */
export function updateStanceBar(partial = {}) {
  for (const k of Object.keys(partial)) {
    if (partial[k] !== undefined) _ctx[k] = partial[k];
  }
  _paint();
}

export function getStanceBarCtx() {
  return { ..._ctx };
}
