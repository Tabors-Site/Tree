// TreeOS Portal — the explorer view.
//
// A tree over the kernel's primitives (PORTAL.md: "the user TRAVERSES
// the structure, drilling in and out"). Spaces expand into children;
// matter and beings hang as leaves; the inspector pane shows whatever
// is selected. Built off the same projection every other view reads —
// the conventional file-manager shape, with richer items: matter has
// a type, beings have roles, spaces can branch.
//
// Interaction: click selects (inspector), the twisty expands, double-
// click on a space navigates the whole portal there (every view
// follows, because navigation is shared).

import "../styles/explorer-view.css";

export function createView() {
  let ctx = null;
  let root = null;
  let els = null;
  let rootNode = null;
  let selectedNode = null;
  const teardowns = [];
  // path → node, so live descriptor updates can refresh in place.
  const nodesByPath = new Map();

  // ── Mount ───────────────────────────────────────────────────────

  function mount(rootEl, portalCtx) {
    ctx = portalCtx;
    root = rootEl;
    const wrap = document.createElement("div");
    wrap.id = "explorer-view";
    wrap.innerHTML = `
      <div id="explorer-tree"></div>
      <div id="explorer-inspector"><div class="exi-empty">select a space, a being, or matter to inspect it</div></div>`;
    root.appendChild(wrap);
    els = {
      tree:      wrap.querySelector("#explorer-tree"),
      inspector: wrap.querySelector("#explorer-inspector"),
    };

    const reality = ctx.state.get("discovery")?.reality || "reality";
    rootNode = makeSpaceNode({ name: reality, path: "/" });
    nodesByPath.set("/", rootNode);
    renderTree();
    expandNode(rootNode);
  }

  function onDescriptor(desc) {
    // The descriptor IS the freshest listing for its position — fold
    // it into the matching tree node so navigation and live events
    // keep the tree honest without extra fetches.
    const path = desc?.address?.pathByNames;
    if (!path) return;
    const node = nodesByPath.get(path);
    if (node) {
      applyDescriptor(node, desc);
      renderTree();
    }
  }

  function destroy() {
    for (const fn of teardowns.splice(0)) { try { fn(); } catch {} }
    nodesByPath.clear();
    rootNode = null;
    selectedNode = null;
    els = null;
    if (root) root.innerHTML = "";
    root = null;
  }

  // ── Tree model ──────────────────────────────────────────────────

  function makeSpaceNode({ name, path }) {
    return {
      kind: "space",
      name,
      path,                 // pathByNames from the reality root
      expanded: false,
      loaded: false,
      loading: false,
      descriptor: null,
      children: [],         // child nodes (spaces, beings, matter)
    };
  }

  function addressFor(path) {
    const m = ctx.state.get();
    const reality = m.discovery?.reality || "";
    const branch = m.descriptor?.address?.branch || "0";
    const bq = branch === "0" ? "" : `#${branch}`;
    return `${reality}${bq}${path === "/" ? "/" : path}`;
  }

  function applyDescriptor(node, desc) {
    node.descriptor = desc;
    node.loaded = true;
    node.loading = false;
    const spaceNodes = (desc.children || []).map((c) => {
      const existing = nodesByPath.get(c.path);
      if (existing) { existing.name = c.name; return existing; }
      const child = makeSpaceNode({ name: c.name, path: c.path });
      nodesByPath.set(c.path, child);
      return child;
    });
    const beingNodes = (desc.beings || []).map((b) => ({
      kind: "being",
      name: b.being || b.name || "?",
      entry: b,
      parent: node,
    }));
    const matterNodes = (desc.matters || []).map((mt) => ({
      kind: "matter",
      name: mt.name || (mt.matterId ? String(mt.matterId).slice(0, 8) : "?"),
      entry: mt,
      parent: node,
    }));
    node.children = [...spaceNodes, ...beingNodes, ...matterNodes];
  }

  async function expandNode(node) {
    if (node.kind !== "space") return;
    node.expanded = true;
    if (!node.loaded && !node.loading) {
      node.loading = true;
      renderTree();
      try {
        const desc = await ctx.client.see(addressFor(node.path));
        applyDescriptor(node, desc);
      } catch (err) {
        node.loading = false;
        node.loaded = true;
        node.error = `${err?.code || "error"}: ${err?.message || err}`;
      }
    }
    renderTree();
  }

  // ── Tree rendering ──────────────────────────────────────────────

  function renderTree() {
    if (!els) return;
    els.tree.innerHTML = "";
    els.tree.appendChild(renderNode(rootNode));
  }

  function renderNode(node) {
    const div = document.createElement("div");
    div.className = "ex-node";

    const row = document.createElement("div");
    row.className = "ex-row" + (node === selectedNode ? " selected" : "");

    const twist = document.createElement("span");
    twist.className = "ex-twist";
    twist.textContent = node.kind === "space" ? (node.expanded ? "▾" : "▸") : "";
    row.appendChild(twist);

    const kind = document.createElement("span");
    kind.className = `ex-kind ${node.kind}`;
    kind.textContent = node.kind;
    row.appendChild(kind);

    const name = document.createElement("span");
    name.className = "ex-name";
    name.textContent = node.kind === "being" ? `@${node.name}` : node.name;
    row.appendChild(name);

    if (node.kind === "space" && node.loaded && node.descriptor) {
      const dim = document.createElement("span");
      dim.className = "ex-dim";
      const c = (node.descriptor.children || []).length;
      const b = (node.descriptor.beings || []).length;
      const mt = (node.descriptor.matters || []).length;
      dim.textContent = ` ${c}s ${b}b ${mt}m`;
      row.appendChild(dim);
    }
    if (node.kind === "matter") {
      const dim = document.createElement("span");
      dim.className = "ex-dim";
      dim.textContent = ` ${node.entry?.type || "generic"}`;
      row.appendChild(dim);
    }

    row.addEventListener("click", () => {
      selectNode(node);
      if (node.kind === "space" && !node.expanded) expandNode(node);
    });
    if (node.kind === "space") {
      twist.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (node.expanded) { node.expanded = false; renderTree(); }
        else expandNode(node);
      });
      row.addEventListener("dblclick", () => {
        ctx.navigation.navigate(addressFor(node.path)).catch(() => {});
      });
    }
    div.appendChild(row);

    if (node.kind === "space" && node.expanded) {
      const kids = document.createElement("div");
      kids.className = "ex-children";
      if (node.loading) {
        kids.innerHTML = `<div class="ex-loading">loading…</div>`;
      } else if (node.error) {
        kids.innerHTML = `<div class="ex-empty">${escapeHtml(node.error)}</div>`;
      } else if (!node.children.length) {
        kids.innerHTML = `<div class="ex-empty">empty</div>`;
      } else {
        for (const child of node.children) kids.appendChild(renderNode(child));
      }
      div.appendChild(kids);
    }
    return div;
  }

  // ── Inspector ───────────────────────────────────────────────────

  function selectNode(node) {
    selectedNode = node;
    renderTree();
    renderInspector(node);
  }

  function renderInspector(node) {
    const el = els.inspector;
    el.innerHTML = "";

    if (node.kind === "space") {
      const desc = node.descriptor;
      el.appendChild(section(`
        <h3 class="exi-title">${escapeHtml(node.name)}</h3>
        <div class="exi-sub">space · ${escapeHtml(node.path)}</div>`));
      const actions = document.createElement("div");
      actions.className = "exi-actions exi-section";
      actions.appendChild(button("open here (all views)", () => {
        ctx.navigation.navigate(addressFor(node.path)).catch(() => {});
      }));
      actions.appendChild(button("refresh", async () => {
        node.loaded = false;
        await expandNode(node);
        renderInspector(node);
      }));
      el.appendChild(actions);
      if (desc) {
        el.appendChild(kvSection("position", {
          spaceId: desc.address?.spaceId || "—",
          branch: `#${desc.address?.branch || "0"}`,
          children: (desc.children || []).length,
          beings: (desc.beings || []).length,
          matter: (desc.matters || []).length,
        }));
        if (desc.qualities && Object.keys(desc.qualities).length) {
          el.appendChild(preSection("qualities", desc.qualities));
        }
      }
      return;
    }

    if (node.kind === "being") {
      const b = node.entry || {};
      el.appendChild(section(`
        <h3 class="exi-title">@${escapeHtml(node.name)}</h3>
        <div class="exi-sub">being · in ${escapeHtml(node.parent?.path || "/")}</div>`));
      el.appendChild(kvSection("identity", {
        beingId: b.beingId || "—",
        role: Array.isArray(b.roles) ? b.roles.join(", ") : (b.role || "—"),
        activity: b.activity ? String(b.activity).slice(0, 200) : "—",
      }));
      // SUMMON from the tree — the right-click-a-being promise, as a
      // visible affordance.
      const summon = document.createElement("div");
      summon.className = "exi-section";
      summon.innerHTML = `<h4>summon</h4>`;
      const rowEl = document.createElement("div");
      rowEl.className = "exi-summon";
      const input = document.createElement("input");
      input.placeholder = `say something to @${node.name}…`;
      const send = button("summon", async () => {
        const content = input.value.trim();
        if (!content) return;
        send.disabled = true;
        try {
          const reply = await summonBeing(node, content);
          input.value = "";
          showReply(summon, reply);
        } catch (err) {
          showReply(summon, `${err?.code || "error"}: ${err?.message || err}`);
        } finally {
          send.disabled = false;
        }
      });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") send.click(); });
      rowEl.append(input, send);
      summon.appendChild(rowEl);
      el.appendChild(summon);
      if (Array.isArray(b.actions) && b.actions.length) {
        el.appendChild(preSection("actions", b.actions.map((a) => `${a.verb} ${a.action} — ${a.label || ""}`)));
      }
      return;
    }

    // matter
    const mt = node.entry || {};
    el.appendChild(section(`
      <h3 class="exi-title">${escapeHtml(node.name)}</h3>
      <div class="exi-sub">matter · ${escapeHtml(mt.type || "generic")} · in ${escapeHtml(node.parent?.path || "/")}</div>`));
    el.appendChild(kvSection("matter", {
      matterId: mt.matterId || "—",
      type: mt.type || "generic",
      content: mt.contentUrl || mt.external?.url || "—",
    }));
    const actions = document.createElement("div");
    actions.className = "exi-actions exi-section";
    actions.appendChild(button("copy id", async () => {
      try { await navigator.clipboard.writeText(String(mt.matterId)); } catch {}
    }));
    const openUrl = mt.external?.url || mt.contentUrl;
    if (openUrl) {
      actions.appendChild(button("open content", () => window.open(openUrl, "_blank", "noopener")));
    }
    el.appendChild(actions);
    if (mt.qualities && Object.keys(mt.qualities).length) {
      el.appendChild(preSection("qualities", mt.qualities));
    }
  }

  async function summonBeing(node, content) {
    const m = ctx.state.get();
    const reality = m.discovery?.reality || "";
    const branch = m.descriptor?.address?.branch || "0";
    const bq = branch === "0" ? "" : `#${branch}`;
    const path = node.parent?.path || "/";
    const stance = `${reality}${bq}${path}@${node.name}`.replace(/\/+@/, "/@");
    const from = m.session?.username
      ? `${reality}${bq}/@${m.session.username}`
      : `${reality}${bq}/@arrival`;
    const correlation = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reply = await ctx.client.summon(stance, { from, content, correlation });
    if (reply?.status === "accepted") {
      return "summon accepted — the reply lands in your inbox / their activity";
    }
    return typeof reply === "string" ? reply : JSON.stringify(reply, null, 2);
  }

  function showReply(container, text) {
    let replyEl = container.querySelector(".exi-reply");
    if (!replyEl) {
      replyEl = document.createElement("div");
      replyEl.className = "exi-reply";
      container.appendChild(replyEl);
    }
    replyEl.textContent = String(text);
  }

  // ── DOM helpers ─────────────────────────────────────────────────

  function section(html) {
    const div = document.createElement("div");
    div.className = "exi-section";
    div.innerHTML = html;
    return div;
  }

  function kvSection(title, obj) {
    const dl = Object.entries(obj)
      .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd></div>`)
      .join("");
    return section(`<h4>${escapeHtml(title)}</h4><dl class="exi-kv">${dl}</dl>`);
  }

  function preSection(title, data) {
    return section(`<h4>${escapeHtml(title)}</h4><pre class="exi-pre">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
  }

  function button(label, onClick) {
    const b = document.createElement("button");
    b.className = "exi-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  return { mount, onDescriptor, onSelection: () => {}, destroy };
}
