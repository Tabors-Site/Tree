// TreeOS Portal . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The stance bar — THE one address bar, shared by the 3D portal and
// the flat (text) portal. One DOM node, re-parented between hosts,
// so the two views can never disagree:
//
//   [ reality#aBranch/@you ] :: [ reality#vBranch/path@being ]
//        the actor stance          the receiving stance
//
// Both sides are editable and both auto-update:
//   - LEFT (who you are, where your acts land): the only actionable
//     edit is the #branch segment — typing a different branch and
//     pressing Enter performs the BE switch (your being seats on the
//     destination, the address follows). You cannot type yourself
//     into being someone else; other edits restore on blur.
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
let _cbs = { onNavigate: null, onSwitchBranch: null };
let _ctx = {
  reality: "",
  username: null,
  signedIn: false,
  actorBranch: "0",
  viewBranch: "0",
  path: "/",
  being: null,
  pointers: {},
};

function _branchAliases(path) {
  const aliases = Object.keys(_ctx.pointers || {})
    .filter((n) => _ctx.pointers[n] === path)
    .sort();
  return aliases.length ? ` (${aliases.join(",")})` : "";
}

function _actorValue() {
  const name = _ctx.signedIn ? (_ctx.username || "you") : "arrival";
  return `${_ctx.reality || ""}#${_ctx.actorBranch}/@${name}`;
}

function _viewValue() {
  const p = _ctx.path || "/";
  const being = _ctx.being ? `@${_ctx.being}` : "";
  return `${_ctx.reality || ""}#${_ctx.viewBranch}${p === "/" ? "/" : p}${being}`;
}

function _paint() {
  if (!_bar) return;
  const { left, sep, right } = _bar;
  if (document.activeElement !== left) left.value = _actorValue();
  if (document.activeElement !== right) right.value = _viewValue();
  const crossed = _ctx.actorBranch !== _ctx.viewBranch;
  const accent = crossed ? "#8a6d2f" : "";
  const text = crossed ? "#e2c574" : "";
  left.style.borderColor = accent;
  left.style.color = text;
  right.style.borderColor = accent;
  right.style.color = text;
  sep.style.color = crossed ? "#e2c574" : "";
  left.title =
    `your stance — acts land on #${_ctx.actorBranch}${_branchAliases(_ctx.actorBranch)}\n` +
    `edit the #branch and press Enter to BE-switch; everything else is who you are`;
  right.title = `the receiving stance — what you're looking at` +
    `${_branchAliases(_ctx.viewBranch) ? `\nbranch${_branchAliases(_ctx.viewBranch)}` : ""}`;
  sep.title = crossed
    ? `cross-branch: your being is seated on #${_ctx.actorBranch} while viewing #${_ctx.viewBranch} — acts from here land cross-branch`
    : "your being and the view are on the same branch";
}

// Pull the #branch segment out of an actor-stance string the user
// edited: "reality#1a/@name" → "1a". Null when absent/garbled.
function _parseBranchEdit(raw) {
  const m = String(raw).match(/#([0-9][0-9a-z]*)(?=\/|$)/i);
  return m ? m[1] : null;
}

/**
 * Create the bar once. Callbacks:
 *   onNavigate(raw)       — right-side Enter (a normal address)
 *   onSwitchBranch(path)  — left-side Enter with a changed #branch
 */
export function initStanceBar({ onNavigate, onSwitchBranch } = {}) {
  _cbs = { onNavigate, onSwitchBranch };
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
  right.placeholder = "reality#branch/path@being";
  right.autocomplete = "off";
  right.spellcheck = false;
  right.style.cssText = "flex:1 1 auto; min-width:160px;";

  left.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { left.blur(); _paint(); return; }
    if (e.key !== "Enter") return;
    const target = _parseBranchEdit(left.value.trim());
    left.blur();
    if (target && target !== _ctx.actorBranch && _cbs.onSwitchBranch) {
      _cbs.onSwitchBranch(target);
    } else {
      _paint(); // restore — the left side is identity, not navigation
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
