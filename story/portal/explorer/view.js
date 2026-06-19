// TreeOS Portal — the explorer view.
//
// A file-manager you already know how to use. The address bar IS the
// IBP address; the right stance is "the open folder." Inside it you see
// exactly what's here: spaces (the folders), beings (a new kind of
// inhabitant), and matter (the files — one layer up from real files,
// wrapping bytes, links, models, doorways into one thing). Clicking a
// space walks into it, which actually MOVES you (every view follows,
// because navigation is shared). Clicking a being or a matter is, for
// now, a "coming soon" — interaction still happens through the console
// and text views.
//
// Matter shows a type-true preview: an image renders, a model gets a
// solid, a doorway gets the portal mark, a web link embeds the site,
// text shows its first lines, everything else gets a file icon.

import "../styles/explorer-view.css";
import { showContextMenu, closeContextMenu } from "../shared/context-menu.js";

const ICONS = {
  folder: `<svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  being:  `<svg viewBox="0 0 24 24" class="stroke"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.2-5.6 7-5.6s7 2 7 5.6"/></svg>`,
  file:   `<svg viewBox="0 0 24 24" class="stroke"><path d="M6 2.5h8l4 4V21.5H6z"/><path d="M14 2.5v4h4"/></svg>`,
  image:  `<svg viewBox="0 0 24 24" class="stroke"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="10" r="1.8"/><path d="M21 16l-5-4.5L5 20"/></svg>`,
  model:  `<svg viewBox="0 0 24 24" class="stroke"><path d="M12 2.5l8.5 4.8v9.4L12 21.5 3.5 16.7V7.3z"/><path d="M12 2.5v19M3.5 7.3l8.5 4.8 8.5-4.8"/></svg>`,
  portal: `<svg viewBox="0 0 24 24" class="stroke"><ellipse cx="12" cy="12" rx="5.5" ry="9"/><ellipse cx="12" cy="12" rx="2" ry="4.5"/></svg>`,
  web:    `<svg viewBox="0 0 24 24" class="stroke"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 2.7 3 15.3 0 18M12 3c-3 2.7-3 15.3 0 18"/></svg>`,
  video:  `<svg viewBox="0 0 24 24" class="stroke"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>`,
};

export function createView() {
  let ctx = null;
  let root = null;
  let els = null;
  let previewsOn = true;
  let viewMode = "grid"; // "grid" | "list"
  let selectedKey = null;
  const teardowns = [];
  // Per-render teardowns for live model thumbnails — cleared and
  // rebuilt each render so off-screen canvases release their slot.
  const modelTeardowns = [];

  // ── Mount ───────────────────────────────────────────────────────

  function mount(rootEl, portalCtx) {
    ctx = portalCtx;
    root = rootEl;
    const wrap = document.createElement("div");
    wrap.id = "explorer-view";
    wrap.innerHTML = `
      <div id="ex-bar">
        <button id="ex-up" class="ex-tool" title="up one space">↑</button>
        <div id="ex-crumbs" class="ex-crumbs"></div>
        <div class="ex-bar-spacer"></div>
        <button id="ex-viewmode" class="ex-tool" title="grid / list"></button>
        <button id="ex-previews" class="ex-tool" title="toggle previews">👁 previews</button>
      </div>
      <div id="ex-grid"></div>
      <div id="ex-status"></div>`;
    root.appendChild(wrap);
    els = {
      bar:      wrap.querySelector("#ex-bar"),
      up:       wrap.querySelector("#ex-up"),
      crumbs:   wrap.querySelector("#ex-crumbs"),
      viewmode: wrap.querySelector("#ex-viewmode"),
      previews: wrap.querySelector("#ex-previews"),
      grid:     wrap.querySelector("#ex-grid"),
      status:   wrap.querySelector("#ex-status"),
    };

    els.up.addEventListener("click", goUp);
    els.viewmode.addEventListener("click", () => {
      viewMode = viewMode === "grid" ? "list" : "grid";
      render();
    });
    els.previews.addEventListener("click", () => {
      previewsOn = !previewsOn;
      els.previews.classList.toggle("on", previewsOn);
      render();
    });
    els.previews.classList.toggle("on", previewsOn);

    // Right-click on the grid background: New Space / New Matter /
    // Birth Being / Properties (of the current space).
    els.grid.addEventListener("contextmenu", (e) => {
      // Tile/row right-clicks handle themselves; only fire here on
      // background. ex-blank and direct grid hits qualify.
      if (e.target.closest(".ex-tile, .ex-row-item")) return;
      e.preventDefault();
      openBackgroundMenu(e.clientX, e.clientY);
    });

    render();
  }

  function onDescriptor() {
    // The explorer always mirrors the portal's current position — the
    // descriptor IS the open folder. Selection is contextual to a
    // position, so a real move clears it.
    selectedKey = null;
    render();
  }

  function destroy() {
    closeProperties();
    closeContextMenu();
    for (const fn of modelTeardowns.splice(0)) { try { fn(); } catch {} }
    for (const fn of teardowns.splice(0)) { try { fn(); } catch {} }
    els = null;
    if (root) root.innerHTML = "";
    root = null;
  }

  // ── Address ─────────────────────────────────────────────────────

  function currentPath() {
    return ctx.state.get("descriptor")?.address?.pathByNames || "/";
  }

  function addressFor(path) {
    const m = ctx.state.get();
    const story = m.discovery?.story || "";
    const branch = m.descriptor?.address?.history || "0";
    const bq = branch === "0" ? "" : `#${branch}`;
    return `${story}${bq}${path === "/" ? "/" : path}`;
  }

  function navigateTo(path) {
    ctx.navigation.navigate(addressFor(path)).catch((err) => {
      setStatus(`could not open: ${err?.code || ""} ${err?.message || err}`, "err");
    });
  }

  function goUp() {
    const path = currentPath();
    if (path === "/") return;
    const parent = path.replace(/\/[^/]+\/?$/, "") || "/";
    navigateTo(parent);
  }

  // ── Render ──────────────────────────────────────────────────────

  function render() {
    if (!els) return;
    const desc = ctx.state.get("descriptor");
    renderCrumbs(desc);
    renderGrid(desc);
    renderStatus(desc);
  }

  function renderCrumbs(desc) {
    const story = ctx.state.get("discovery")?.story || "story";
    const branch = desc?.address?.history || "0";
    const path = desc?.address?.pathByNames || "/";
    els.up.disabled = path === "/";

    const crumbs = [];
    crumbs.push(crumbButton(story, "/"));
    if (branch !== "0") {
      const chip = document.createElement("span");
      chip.className = "ex-branch";
      chip.textContent = `#${branch}`;
      crumbs.push(chip);
    }
    const segs = path.split("/").filter(Boolean);
    let acc = "";
    for (const seg of segs) {
      acc += `/${seg}`;
      crumbs.push(sep());
      crumbs.push(crumbButton(seg, acc));
    }
    els.crumbs.innerHTML = "";
    for (const c of crumbs) els.crumbs.appendChild(c);
  }

  function crumbButton(label, path) {
    const b = document.createElement("button");
    b.className = "ex-crumb";
    b.textContent = label;
    if (path === currentPath()) b.classList.add("here");
    b.addEventListener("click", () => navigateTo(path));
    return b;
  }

  function sep() {
    const s = document.createElement("span");
    s.className = "ex-crumb-sep";
    s.textContent = "›";
    return s;
  }

  function renderGrid(desc) {
    for (const fn of modelTeardowns.splice(0)) { try { fn(); } catch {} }
    els.viewmode.textContent = viewMode === "grid" ? "☰ list" : "▦ grid";
    els.grid.classList.toggle("list", viewMode === "list");
    els.grid.innerHTML = "";
    if (!desc) {
      els.grid.innerHTML = `<div class="ex-blank">opening…</div>`;
      return;
    }
    const spaces  = desc.children || [];
    const beings  = desc.beings || [];
    const matters = desc.matters || [];
    if (!spaces.length && !beings.length && !matters.length) {
      els.grid.innerHTML = `<div class="ex-blank">this space is empty</div>`;
      return;
    }
    // Folders first, then inhabitants, then files — the order people expect.
    const list = viewMode === "list";
    for (const s of spaces)  els.grid.appendChild(list ? spaceRow(s)  : spaceTile(s));
    for (const b of beings)  els.grid.appendChild(list ? beingRow(b)  : beingTile(b));
    for (const mt of matters) els.grid.appendChild(list ? matterRow(mt) : matterTile(mt));
  }

  // ── Identity + actions (shared by grid tiles and list rows) ─────

  function spaceKey(s)  { return `space:${s.spaceId || s.path || s.name}`; }
  function beingName(b) { return b.being || b.name || "?"; }
  function beingKey(b)  { return `being:${b.beingId || beingName(b)}`; }
  function matterName(mt) { return mt.name || (mt.matterId ? String(mt.matterId).slice(0, 8) : "matter"); }
  function matterKey(mt)  { return `matter:${mt.matterId || matterName(mt)}`; }

  function openSpace(s) {
    navigateTo(s.path || `${currentPath() === "/" ? "" : currentPath()}/${s.name}`);
  }
  function pickBeing(b) {
    select(beingKey(b));
    // Selection refines the IBPA: the right stance gains @<being>,
    // shared by every view — summons dispatch against that stance.
    ctx.navigation.selectBeing(b.beingId || beingName(b), beingName(b));
    setStatus(`@${beingName(b)} is in the IBPA — summon from the console (summon @${beingName(b)} …) or chat in the text view.`);
  }
  function pickMatter(mt) {
    select(matterKey(mt));
    const url = openUrlFor(mt);
    setStatus(`${matterName(mt)} (${mt.type || "generic"}) — opening matter is coming soon. For now, use the console (see/do) or the text view.${url ? " — or open it ↗" : ""}`,
      null, url);
  }
  function roleOf(b) { return Array.isArray(b.roles) ? b.roles[0] : b.role; }

  // ── Grid tiles ──────────────────────────────────────────────────

  function tile(key, kindClass, glyphHtml, label, sub) {
    const el = document.createElement("button");
    el.className = `ex-tile ${kindClass}` + (key === selectedKey ? " selected" : "");
    el.innerHTML =
      `<div class="ex-thumb">${glyphHtml}</div>` +
      `<div class="ex-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>` +
      (sub ? `<div class="ex-sub">${escapeHtml(sub)}</div>` : "");
    return el;
  }

  function spaceTile(s) {
    const el = tile(spaceKey(s), "space", ICONS.folder, s.name || "space", "space");
    el.addEventListener("click", () => openSpace(s));
    wireContextMenu(el, () => buildSpaceMenu(s));
    return el;
  }

  function beingTile(b) {
    const el = tile(beingKey(b), "being", ICONS.being, `@${beingName(b)}`, roleOf(b) || "being");
    el.addEventListener("click", () => pickBeing(b));
    wireContextMenu(el, () => buildBeingMenu(b));
    return el;
  }

  function matterTile(mt) {
    const el = tile(matterKey(mt), "matter", matterThumb(mt), matterName(mt), mt.type || "generic");
    el.addEventListener("click", () => pickMatter(mt));
    wireContextMenu(el, () => buildMatterMenu(mt));
    maybeMountModel(el, mt);
    return el;
  }

  // A model matter gets a real, rotating GLB thumbnail (lazy: pulls
  // Three.js only when one actually appears). The cube icon stays the
  // fallback if WebGL or the load fails.
  function maybeMountModel(tileEl, mt) {
    if (!previewsOn || matterKind(mt) !== "model") return;
    const url = mt.model?.url || mt.contentUrl;
    if (!url) return;
    const thumb = tileEl.querySelector(".ex-thumb");
    if (!thumb) return;
    thumb.innerHTML = `<canvas class="ex-model" width="118" height="82"></canvas>`;
    const canvas = thumb.querySelector("canvas");
    import("./modelThumb.js")
      .then(({ mountModelThumb }) => {
        if (!canvas.isConnected) return;
        return mountModelThumb(canvas, url).then((teardown) => {
          if (canvas.isConnected) modelTeardowns.push(teardown);
          else teardown();
        });
      })
      .catch(() => { thumb.innerHTML = ICONS.model; });
  }

  // ── List rows ───────────────────────────────────────────────────

  function row(key, kindClass, iconHtml, name, meta) {
    const el = document.createElement("button");
    el.className = `ex-row-item ${kindClass}` + (key === selectedKey ? " selected" : "");
    el.innerHTML =
      `<span class="ex-row-icon">${iconHtml}</span>` +
      `<span class="ex-row-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
      `<span class="ex-row-meta">${escapeHtml(meta || "")}</span>`;
    return el;
  }

  function spaceRow(s) {
    const el = row(spaceKey(s), "space", ICONS.folder, s.name || "space", "space");
    el.addEventListener("click", () => openSpace(s));
    wireContextMenu(el, () => buildSpaceMenu(s));
    return el;
  }

  function beingRow(b) {
    const el = row(beingKey(b), "being", ICONS.being, `@${beingName(b)}`, roleOf(b) || "being");
    el.addEventListener("click", () => pickBeing(b));
    wireContextMenu(el, () => buildBeingMenu(b));
    return el;
  }

  function matterRow(mt) {
    const kind = matterKind(mt);
    const url = mt.contentUrl || mt.external?.url;
    const icon = (previewsOn && kind === "image" && url)
      ? `<img class="ex-row-img" loading="lazy" src="${escapeAttr(url)}" alt="">`
      : (ICONS[iconKey(kind)] || ICONS.file);
    const el = row(matterKey(mt), "matter", icon, matterName(mt), `${mt.type || "generic"}${sizeLabel(mt)}`);
    el.addEventListener("click", () => pickMatter(mt));
    wireContextMenu(el, () => buildMatterMenu(mt));
    return el;
  }

  function sizeLabel(mt) {
    const b = mt.totalBytes || 0;
    if (!b) return "";
    const kb = b / 1024;
    if (kb < 1) return ` · ${b} B`;
    if (kb < 1024) return ` · ${kb.toFixed(0)} KB`;
    return ` · ${(kb / 1024).toFixed(1)} MB`;
  }

  // The type-true preview. Rich when previews are on; a clean icon when
  // off (or when the preview can't render).
  function matterThumb(mt) {
    const kind = matterKind(mt);
    if (!previewsOn) return ICONS[iconKey(kind)] || ICONS.file;
    const url = mt.contentUrl || mt.external?.url || null;
    switch (kind) {
      case "image":
        return url ? `<img class="ex-img" loading="lazy" src="${escapeAttr(url)}" alt="">` : ICONS.image;
      case "video": {
        const vid = mt.external?.videoId;
        if (vid) return `<iframe class="ex-embed" loading="lazy" src="https://www.youtube.com/embed/${escapeAttr(vid)}" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
        return url ? embedFrame(url) : ICONS.video;
      }
      case "web":
        return url ? embedFrame(url) : ICONS.web;
      case "portal":
        return `<div class="ex-portal">${ICONS.portal}<span>${escapeHtml(shortTarget(mt))}</span></div>`;
      case "model":
        return ICONS.model;
      case "text":
        return mt.preview
          ? `<pre class="ex-text">${escapeHtml(String(mt.preview).slice(0, 320))}</pre>`
          : ICONS.file;
      default:
        return ICONS.file;
    }
  }

  function embedFrame(url) {
    return `<iframe class="ex-embed" loading="lazy" src="${escapeAttr(url)}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>`;
  }

  // ── Classification ──────────────────────────────────────────────

  function matterKind(mt) {
    const type = (mt.type || "generic").toLowerCase();
    const mime = (mt.mimeType || "").toLowerCase();
    const mode = mt.render?.mode;
    const icon = mt.render?.icon;
    if (type === "ibpa" || mode === "portal" || icon === "portal" || mt.external?.target) return "portal";
    if (type === "model" || mode === "model" || mime.includes("gltf") || /\.glb$/i.test(mt.name || "")) return "model";
    if (mime.startsWith("image/")) return "image";
    if (mt.external?.contentType === "video/youtube" || mt.external?.videoId || mime.startsWith("video/")) return "video";
    if (type === "http" || (mt.external && typeof mt.external.url === "string")) return "web";
    if (mt.preview || mime.startsWith("text/") || mime.includes("json") || mime.includes("javascript")) return "text";
    return "file";
  }

  function iconKey(kind) {
    if (kind === "web") return "web";
    if (kind === "portal") return "portal";
    if (kind === "model") return "model";
    if (kind === "image") return "image";
    if (kind === "video") return "video";
    if (kind === "text") return "file";
    return "file";
  }

  function shortTarget(mt) {
    const t = mt.external?.target || "";
    return String(t).replace(/^[a-z0-9.-]+/i, "").slice(0, 22) || "doorway";
  }

  function openUrlFor(mt) {
    if (mt.external?.url) return mt.external.url;
    if (mt.contentUrl) return mt.contentUrl;
    return null;
  }


  // ── Right-click menus + Properties dialog ───────────────────────
  //
  // The explorer mimics Windows Explorer: right-click on the background
  // to create new things, right-click on a tile/row for its actions.
  // Every menu pick routes through ctx.client.do / .be — the same path
  // every other view uses. The menu and the chat tools are two surfaces
  // over one set of operations.

  function wireContextMenu(el, buildItems) {
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Highlight what was right-clicked while the menu is up.
      document.querySelectorAll(".ex-tile.ctx-target, .ex-row-item.ctx-target")
        .forEach((n) => n.classList.remove("ctx-target"));
      el.classList.add("ctx-target");
      const items = buildItems();
      showContextMenu({ x: e.clientX, y: e.clientY, items });
    });
  }

  // Right-click on grid background. "New X" group + Properties on the
  // current open space.
  function openBackgroundMenu(x, y) {
    const desc = ctx.state.get("descriptor");
    const path = currentPath();
    const address = addressFor(path);
    const items = [
      { label: "New space",  onPick: () => promptNewSpace(address) },
      { label: "New matter", onPick: () => promptNewMatter(address) },
      { label: "Birth being (you become parent)", onPick: () => promptBirthBeing(address) },
      { separator: true },
      { label: "Refresh", onPick: () => ctx.navigation.navigate(address).catch(() => {}) },
      { separator: true },
      {
        label: "Properties",
        onPick: () => openProperties({
          kind: "space",
          title: path === "/" ? "/" : path.split("/").filter(Boolean).pop(),
          subtitle: address,
          data: desc,
        }),
      },
    ];
    showContextMenu({ x, y, items });
  }

  // Space tile / row menu.
  function buildSpaceMenu(s) {
    const childPath = s.path || `${currentPath() === "/" ? "" : currentPath()}/${s.name}`;
    const childAddr = addressFor(childPath);
    return [
      { label: "Open",       onPick: () => openSpace(s) },
      { separator: true },
      { label: "Rename",     onPick: () => promptRenameSpace(childAddr, s.name) },
      { label: "Delete",     hint: "!", onPick: () => confirmDeleteSpace(childAddr, s.name) },
      { separator: true },
      {
        label: "Properties",
        onPick: () => openProperties({
          kind: "space",
          title: s.name || "space",
          subtitle: childAddr,
          data: s,
        }),
      },
    ];
  }

  // Being tile / row menu.
  function buildBeingMenu(b) {
    const story = ctx.state.get("discovery")?.story || "";
    const branch = ctx.state.get("descriptor")?.address?.history || "0";
    const bq = branch === "0" ? "" : `#${branch}`;
    const stance = `${story}${bq}/@${beingName(b)}`;
    return [
      { label: "Select",     onPick: () => pickBeing(b) },
      { label: "Open stance", onPick: () => ctx.navigation.navigate(stance).catch(() => {}) },
      { separator: true },
      {
        label: "Properties",
        onPick: () => openProperties({
          kind: "being",
          title: `@${beingName(b)}`,
          subtitle: stance,
          data: b,
        }),
      },
    ];
  }

  // Matter tile / row menu.
  function buildMatterMenu(mt) {
    const baseAddr = addressFor(currentPath());
    const url = openUrlFor(mt);
    const items = [];
    if (url) items.push({ label: "Open ↗", onPick: () => window.open(url, "_blank", "noopener") });
    items.push({ label: "Rename", onPick: () => promptRenameMatter(baseAddr, mt) });
    items.push({ label: "Delete", hint: "!", onPick: () => confirmDeleteMatter(baseAddr, mt) });
    items.push({ separator: true });
    items.push({
      label: "Properties",
      onPick: () => openProperties({
        kind: "matter",
        title: matterName(mt),
        subtitle: mt.type || "generic",
        data: mt,
      }),
    });
    return items;
  }

  // ── DO/BE invokers (route through ctx.client) ───────────────────

  async function runDo(address, op, args, label) {
    try {
      setStatus(`${label || op}…`);
      await ctx.client.do(address, op, args);
      setStatus(`${label || op} ok`);
      ctx.navigation.navigate(addressFor(currentPath())).catch(() => {});
    } catch (err) {
      setStatus(`${label || op} failed: ${err?.code || ""} ${err?.message || err}`, "err");
    }
  }

  async function runBe(op, address, payload, label) {
    try {
      setStatus(`${label || `be:${op}`}…`);
      await ctx.client.be(op, address, payload);
      setStatus(`${label || `be:${op}`} ok`);
      ctx.navigation.navigate(addressFor(currentPath())).catch(() => {});
    } catch (err) {
      setStatus(`${label || `be:${op}`} failed: ${err?.code || ""} ${err?.message || err}`, "err");
    }
  }

  function promptNewSpace(address) {
    const name = window.prompt("New space name:", "");
    if (!name) return;
    runDo(address, "create-space", { name }, `create space "${name}"`);
  }

  function promptNewMatter(address) {
    const name = window.prompt("New matter name:", "");
    if (!name) return;
    const type = window.prompt("Matter type (generic / file / model / http / ibpa / source):", "generic");
    if (!type) return;
    runDo(address, "create-matter", { name, type }, `create matter "${name}"`);
  }

  function promptBirthBeing(address) {
    const name = window.prompt("New being name:", "");
    if (!name) return;
    runBe("birth", address, { name }, `birth @${name}`);
  }

  function promptRenameSpace(address, currentName) {
    const next = window.prompt("Rename space to:", currentName || "");
    if (!next || next === currentName) return;
    runDo(address, "set-name", { name: next }, `rename to "${next}"`);
  }

  function confirmDeleteSpace(address, name) {
    const ok = window.confirm(`Delete space "${name || address}"? This stamps an end-space fact; it can be reversed but the space stops appearing in listings.`);
    if (!ok) return;
    runDo(address, "end-space", {}, `delete "${name}"`);
  }

  function promptRenameMatter(baseAddr, mt) {
    const next = window.prompt("Rename matter to:", mt.name || "");
    if (!next || next === mt.name) return;
    runDo(baseAddr, "set-matter-name", { matterId: mt.matterId, name: next }, `rename matter`);
  }

  function confirmDeleteMatter(baseAddr, mt) {
    const ok = window.confirm(`Delete matter "${mt.name || mt.matterId}"?`);
    if (!ok) return;
    runDo(baseAddr, "delete-matter", { matterId: mt.matterId }, `delete matter`);
  }

  // ── Properties dialog ───────────────────────────────────────────

  function openProperties({ kind, title, subtitle, data }) {
    closeContextMenu();
    closeProperties(); // ensure single instance
    const backdrop = document.createElement("div");
    backdrop.className = "ex-props-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeProperties();
    });

    const dialog = document.createElement("div");
    dialog.className = "ex-props";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", `${kind} properties`);

    const head = document.createElement("div");
    head.className = "ex-props-head";
    const t = document.createElement("div");
    t.className = "ex-props-title";
    t.textContent = `${kind}: ${title || ""}`;
    head.appendChild(t);
    const close = document.createElement("button");
    close.className = "ex-props-close";
    close.textContent = "×";
    close.title = "close (Esc)";
    close.addEventListener("click", closeProperties);
    head.appendChild(close);
    dialog.appendChild(head);

    if (subtitle) {
      const s = document.createElement("div");
      s.className = "ex-props-val";
      s.style.marginBottom = "10px";
      s.textContent = subtitle;
      dialog.appendChild(s);
    }

    // Quick-look key/value pairs surfaced from the descriptor /
    // matter / being / space entry. Falls back to a raw JSON pane.
    const kv = document.createElement("div");
    kv.className = "ex-props-kv";
    const pairs = quickLookPairs(kind, data);
    for (const [k, v] of pairs) {
      const keyEl = document.createElement("div");
      keyEl.className = "ex-props-key";
      keyEl.textContent = k;
      const valEl = document.createElement("div");
      valEl.className = "ex-props-val";
      valEl.textContent = (v === undefined || v === null) ? "(none)" : String(v);
      kv.appendChild(keyEl); kv.appendChild(valEl);
    }
    dialog.appendChild(kv);

    // Qualities namespaces: every extension that owns one renders a
    // section. Bare primitive answers _that_; qualities answer
    // _what sort_.
    const qual = pickQualities(data);
    if (qual && Object.keys(qual).length) {
      const head2 = document.createElement("div");
      head2.className = "ex-props-section";
      head2.textContent = "qualities";
      dialog.appendChild(head2);
      for (const ns of Object.keys(qual)) {
        const nsHead = document.createElement("div");
        nsHead.className = "ex-props-section";
        nsHead.style.marginTop = "8px";
        nsHead.textContent = ns;
        dialog.appendChild(nsHead);
        const pre = document.createElement("pre");
        pre.className = "ex-props-json";
        pre.textContent = formatJson(qual[ns]);
        dialog.appendChild(pre);
      }
    }

    // Raw collapsible at the bottom — the full row a SEE returned.
    const rawHead = document.createElement("div");
    rawHead.className = "ex-props-section";
    rawHead.textContent = "raw";
    dialog.appendChild(rawHead);
    const raw = document.createElement("pre");
    raw.className = "ex-props-json";
    raw.textContent = formatJson(data);
    dialog.appendChild(raw);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    propsBackdrop = backdrop;

    const escHandler = (e) => { if (e.key === "Escape") closeProperties(); };
    document.addEventListener("keydown", escHandler);
    backdrop._escHandler = escHandler;
  }

  let propsBackdrop = null;
  function closeProperties() {
    if (!propsBackdrop) return;
    if (propsBackdrop._escHandler) document.removeEventListener("keydown", propsBackdrop._escHandler);
    if (propsBackdrop.parentNode) propsBackdrop.parentNode.removeChild(propsBackdrop);
    propsBackdrop = null;
  }

  function quickLookPairs(kind, data) {
    if (!data || typeof data !== "object") return [];
    if (kind === "space") {
      const desc = data.address ? data : null; // a descriptor
      const sp = desc ? null : data;
      return desc ? [
        ["path",     desc.address?.pathByNames],
        ["branch",   desc.address?.history],
        ["spaceId",  desc.spaceId],
        ["spaces",   (desc.children || []).length],
        ["beings",   (desc.beings || []).length],
        ["matters",  (desc.matters || []).length],
      ] : [
        ["name",     sp.name],
        ["spaceId",  sp.spaceId],
        ["type",     sp.type],
      ];
    }
    if (kind === "being") {
      return [
        ["name",        beingName(data)],
        ["beingId",     data.beingId],
        ["role",        roleOf(data)],
        ["cognition",   data.cognition || data.cognitionMode],
        ["mode",        data.respondMode],
        ["available",   data.available === false ? "busy" : "available"],
        ["inbox",       data.inbox?.unconsumed ?? null],
      ];
    }
    if (kind === "matter") {
      return [
        ["name",        data.name],
        ["type",        data.type],
        ["matterId",    data.matterId],
        ["mimeType",    data.mimeType],
        ["bytes",       data.totalBytes],
        ["preview",     data.preview ? String(data.preview).slice(0, 80) + (data.preview.length > 80 ? "…" : "") : null],
        ["url",         openUrlFor(data)],
      ];
    }
    return [];
  }

  function pickQualities(data) {
    if (!data || typeof data !== "object") return null;
    if (data.qualities && typeof data.qualities === "object") return data.qualities;
    return null;
  }

  function formatJson(v) {
    try { return JSON.stringify(v, null, 2); }
    catch { return String(v); }
  }

  // ── Selection + status ──────────────────────────────────────────

  function select(key) {
    selectedKey = key;
    render();
  }

  function setStatus(text, tone, url) {
    if (!els) return;
    els.status.innerHTML = "";
    const span = document.createElement("span");
    span.className = "ex-status-msg" + (tone === "err" ? " err" : "");
    span.textContent = text;
    els.status.appendChild(span);
    if (url) {
      const a = document.createElement("a");
      a.className = "ex-status-open";
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "open ↗";
      els.status.appendChild(a);
    }
  }

  function renderStatus(desc) {
    if (selectedKey) return; // keep a coming-soon message visible until the next move
    const c = (desc?.children || []).length;
    const b = (desc?.beings || []).length;
    const m = (desc?.matters || []).length;
    els.status.innerHTML = `<span class="ex-counts">${c} space${c === 1 ? "" : "s"} · ${b} being${b === 1 ? "" : "s"} · ${m} matter</span>`;
  }

  // ── helpers ─────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function escapeAttr(s) { return escapeHtml(s); }

  return { mount, onDescriptor, onSelection: () => {}, destroy };
}
