// TreeOS Portal — the Name Hierarchy Panel (text view).
//
// YOUR being-tree on the history you stand on (the IBPA left stance), and the
// surface for handing another Name authority over part of it.
//
// What it shows: every being your Name owns on THIS history, nested by
// parentBeingId (a being whose parent your Name doesn't own — e.g. parented
// under @cherub — sits at the top, tagged "under @cherub"). Each node lists the
// inheritation POINTS granted there (the Names you've given downward authority
// over that subtree) with a ✕ to revoke, and a "+ grant a name" form to add one.
//
// History-scoped on purpose: switch history (the branch bar) to see and grant on
// another timeline. A grant lands on the history shown here, so the tree you see
// is exactly the access you give. Reading the tree is bodiless (the name
// channel); GRANTING/REVOKING are world acts, so they need you to be DRIVING a
// being (the embodiment rule) — when you're at the arrival floor with no being,
// the actions are disabled with a hint.

let _panel = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Remove the Name Hierarchy panel if it is up. */
export function hideNameTree() {
  if (_panel) { _panel.remove(); _panel = null; }
}

/** Is the Name Hierarchy panel currently open? */
export function isNameTreeOpen() {
  return !!_panel;
}

const short = (s) => (s ? String(s).slice(0, 10) + "…" : "?");

/**
 * Show the Name Hierarchy panel (non-blocking, docked).
 *
 * @param {object}   opts
 * @param {object}   opts.client    PortalClient (nameTree / nameSee / do)
 * @param {string}   opts.story   story domain (for addresses + header)
 * @param {string}   opts.nameId    the signed-in name (its own tree)
 * @param {string}   opts.history   the history you stand on (left stance)
 * @param {boolean}  opts.canAct    are you driving a being? (grant/revoke need it)
 * @param {Function} [opts.reopen]  (history) => re-show for the current history (refresh)
 */
export async function showNameTree({ client, story = "", nameId, history, canAct = false, reopen = null }) {
  hideNameTree();
  injectStyles();

  const br = history || "0";
  const bq = br && br !== "0" ? `#${br}` : "";
  const addrOf = (beingName) => `${story}${bq}/@${beingName}`;

  const panel = el("div", "nt-dock");
  const card = el("div", "nt-card");
  panel.appendChild(card);

  const head = el("div", "nt-head");
  const titles = el("div", "nt-titles");
  titles.appendChild(el("div", "nt-ibpa", `${story || "this story"} · #${br === "0" ? "main" : br}`));
  titles.appendChild(el("h1", "nt-title", "Your hierarchy"));
  head.appendChild(titles);
  const tools = el("div", "nt-tools");
  if (reopen) {
    const refresh = el("button", "nt-x", "⟳");
    refresh.title = "refresh for the history you stand on now";
    refresh.onclick = () => reopen();
    tools.appendChild(refresh);
  }
  const close = el("button", "nt-x", "×");
  close.title = "close";
  close.onclick = () => hideNameTree();
  tools.appendChild(close);
  head.appendChild(tools);
  card.appendChild(head);

  card.appendChild(el("p", "nt-sub",
    canAct
      ? "The beings you own on this history. Grant a Name a point on any node to hand it authority over that being and everything under it. Switch history to grant on another timeline."
      : "The beings you own on this history. Drive one of your beings to grant or revoke (a grant is a world act, so it needs a being to act through)."));

  const status = el("div", "nt-status");
  const list = el("div", "nt-list");
  card.appendChild(list);
  card.appendChild(status);

  document.body.appendChild(panel);
  _panel = panel;

  list.appendChild(el("div", "nt-loading", "loading your hierarchy…"));
  let tree = null;
  try {
    tree = await client.nameTree(br);
  } catch (err) {
    list.innerHTML = "";
    list.appendChild(el("div", "nt-empty", `Couldn't load your hierarchy: ${err?.message || err}`));
    return panel;
  }
  list.innerHTML = "";

  const roots = Array.isArray(tree?.roots) ? tree.roots : [];
  if (roots.length === 0) {
    list.appendChild(el("div", "nt-empty", "No beings on this history yet. Birth one (drive @cherub / the being menu), or switch to the history where your beings live."));
    return panel;
  }

  // Best-effort: resolve granted-name pubkeys to real-names for the chips.
  const nameCache = new Map();
  async function displayName(id) {
    if (nameCache.has(id)) return nameCache.get(id);
    let label = short(id);
    try { const d = await client.nameSee(id); if (d?.name) label = d.name; } catch { /* keep short id */ }
    nameCache.set(id, label);
    return label;
  }

  const reload = () => { if (reopen) reopen(); };

  async function renderNode(node, depth) {
    const row = el("div", "nt-node");
    row.style.marginLeft = `${depth * 14}px`;

    const main = el("div", "nt-main");
    const nm = el("span", "nt-name", `@${node.name || "(unnamed)"}`);
    main.appendChild(nm);
    if (node.parentName && depth === 0) main.appendChild(el("span", "nt-under", `under @${node.parentName}`));
    if (node.homeHistory && node.homeHistory !== br) main.appendChild(el("span", "nt-tag", `#${node.homeHistory}`));
    row.appendChild(main);

    // Points granted here (the Names with downward authority over this subtree).
    const pts = Array.isArray(node.points) ? node.points : [];
    if (pts.length) {
      const chips = el("div", "nt-chips");
      for (const pid of pts) {
        const chip = el("span", "nt-chip");
        chip.appendChild(el("span", "nt-chip-name", await displayName(pid)));
        chip.title = pid;
        if (canAct) {
          const x = el("button", "nt-chip-x", "×");
          x.title = `revoke ${short(pid)}'s access here`;
          x.onclick = async () => {
            x.disabled = true; status.textContent = `Revoking access at @${node.name}…`; status.className = "nt-status";
            try { await client.do(addrOf(node.name), "revoke-inheritation", { name: pid }); status.textContent = "Revoked."; status.className = "nt-status nt-ok"; reload(); }
            catch (err) { status.textContent = `Revoke failed: ${err?.message || err}`; status.className = "nt-status nt-err"; x.disabled = false; }
          };
          chip.appendChild(x);
        }
        chips.appendChild(chip);
      }
      row.appendChild(chips);
    }

    // Grant a name here.
    if (canAct) {
      const gr = el("div", "nt-grant");
      const input = el("input", "nt-input");
      input.placeholder = "grant a name (real-name or key)";
      const go = el("button", "nt-btn", "+ grant");
      go.onclick = async () => {
        const token = input.value.trim();
        if (!token) return;
        go.disabled = true; status.textContent = `Granting ${token} at @${node.name}…`; status.className = "nt-status";
        try {
          const seen = await client.nameSee(token);
          if (!seen?.nameId) throw new Error(`no such name: ${token}`);
          await client.do(addrOf(node.name), "grant-inheritation", { name: seen.nameId });
          status.textContent = `Granted ${seen.name || short(seen.nameId)} at @${node.name}.`; status.className = "nt-status nt-ok";
          reload();
        } catch (err) {
          status.textContent = `Grant failed: ${err?.message || err}`; status.className = "nt-status nt-err"; go.disabled = false;
        }
      };
      gr.appendChild(input); gr.appendChild(go);
      row.appendChild(gr);
    }

    list.appendChild(row);
    for (const child of (node.children || [])) await renderNode(child, depth + 1);
  }

  for (const root of roots) await renderNode(root, 0);
  return panel;
}

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
.nt-dock{position:fixed;top:0;right:0;bottom:0;z-index:8000;display:flex;align-items:stretch;
  justify-content:flex-end;pointer-events:none;font-family:system-ui,sans-serif;color:#e7eaf0;}
.nt-card{pointer-events:auto;width:min(420px,94vw);margin:14px;align-self:flex-start;max-height:calc(100vh - 28px);
  overflow:auto;background:#11151cf2;border:1px solid #232a36;border-radius:14px;padding:18px 18px 14px;
  box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(8px);}
.nt-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.nt-titles{min-width:0;}
.nt-ibpa{font-family:ui-monospace,monospace;font-size:11px;color:#7d8aa0;letter-spacing:.04em;}
.nt-title{margin:4px 0 0;font-size:22px;font-weight:700;}
.nt-tools{display:flex;gap:6px;flex:0 0 auto;}
.nt-x{background:transparent;border:1px solid #2a3240;color:#9aa6ba;border-radius:7px;
  width:28px;height:28px;font-size:15px;line-height:1;cursor:pointer;}
.nt-sub{margin:8px 0 14px;font-size:12.5px;color:#9aa6ba;line-height:1.45;}
.nt-list{display:flex;flex-direction:column;gap:7px;}
.nt-node{padding:8px 10px;background:#0c1118;border:1px solid #232a36;border-radius:9px;}
.nt-main{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.nt-name{font-weight:600;font-size:14px;}
.nt-under{font-family:ui-monospace,monospace;font-size:10.5px;color:#7d8aa0;}
.nt-tag{font-family:ui-monospace,monospace;font-size:10.5px;color:#caa15f;}
.nt-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;}
.nt-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 4px 3px 9px;background:#16203a;
  border:1px solid #294070;border-radius:20px;font-size:11.5px;color:#bcd0ff;}
.nt-chip-name{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.nt-chip-x{background:transparent;border:none;color:#8fa6d8;cursor:pointer;font-size:14px;line-height:1;padding:0 3px;}
.nt-grant{display:flex;gap:6px;margin-top:8px;}
.nt-input{flex:1;min-width:0;padding:7px 9px;border:1px solid #2a3240;background:#0b0f15;color:#e7eaf0;
  border-radius:7px;font-size:12.5px;outline:none;}
.nt-input:focus{border-color:#4a6cf7;}
.nt-btn{padding:7px 11px;border:1px solid #2a3240;background:#1b2433;color:#e7eaf0;border-radius:7px;
  font-size:12.5px;cursor:pointer;white-space:nowrap;}
.nt-btn[disabled]{opacity:.6;cursor:default;}
.nt-status{margin-top:10px;font-size:12px;min-height:15px;color:#9aa6ba;}
.nt-ok{color:#5fd08a;} .nt-err{color:#f0795f;}
.nt-loading,.nt-empty{padding:12px;color:#9aa6ba;font-size:12.5px;line-height:1.5;}
`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
