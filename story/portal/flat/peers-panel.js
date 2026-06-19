// peers-panel.js . Federation > peers.
//
// The peer realities this story knows (the ./peers registry), and the
// three outbound moves per peer:
//   . graft a being      -> offer-being      (the entity itself, verbatim id + chain)
//   . offer a template   -> offer-template   (a copy of a subtree's shape, fresh ids)
//   . request a template -> request-template (ask a peer for one of theirs)
// Every move is a DO op on the local @federation-manager; the server
// auth-gates each one. This panel steers and reports; it does not decide
// authority. Companion: federation-panel.js (the incoming / in-flight queue).

import { flat } from "./host.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function story() { return (flat.state?.discovery?.story || "").replace(/\/+$/, ""); }
function fedAddress() { const r = story(); return r ? `${r}/@federation-manager` : null; }
function shortTime(t) {
  if (!t) return "";
  const s = String(t);
  return s.length > 19 ? s.slice(0, 19).replace("T", " ") : s;
}

// Beings the operator might graft: the current descriptor's residents /
// beings that carry a pubkey id. The free-text field covers anything else.
function candidateBeings() {
  const d = flat.state?.descriptor || {};
  const out = new Map();
  for (const b of [...(d.beings || []), ...(d.residents || [])]) {
    const id = b.beingId || b.id;
    if (id) out.set(String(id), b.name || b.being || String(id).slice(0, 12));
  }
  return [...out.entries()].map(([id, name]) => ({ id, name }));
}

function normalizePeers(desc) {
  const raw = desc?.peers || desc?.children || desc?.peerList || desc?.list || [];
  return (Array.isArray(raw) ? raw : []).map((p) => ({
    domain:     p.domain || p.name || p.story || p.id || "(unknown)",
    name:       p.name || p.qualities?.peer?.name || null,
    status:     p.status || p.qualities?.peer?.status || null,
    lastSeenAt: p.lastSeenAt || p.lastSeen || null,
  }));
}

export async function renderPeersPanel(body, _action, _opByName, { refreshView } = {}) {
  const r = story();
  const addr = fedAddress();
  if (!r || !addr) { body.textContent = "portal not ready (no story)"; return; }
  body.innerHTML = "";

  const intro = document.createElement("div");
  intro.className = "fed-intro dim";
  intro.innerHTML = "peer realities you can transfer with. <b>graft a being</b> moves the entity itself (same key, same chain, now living in two realities); a <b>template</b> sends or asks for a copy of a subtree's shape (fresh ids).";
  body.appendChild(intro);

  const refresh = document.createElement("button");
  refresh.type = "button"; refresh.className = "btn-sm"; refresh.textContent = "reload peers";
  refresh.style.marginBottom = "8px";
  body.appendChild(refresh);

  const list = document.createElement("div");
  list.className = "fed-list";
  body.appendChild(list);

  const out = document.createElement("div");
  out.className = "fed-result-slot";
  body.appendChild(out);

  function report(ok, msg) {
    out.innerHTML = `<div class="action-result ${ok ? "" : "action-err"}">${esc(msg)}</div>`;
  }

  async function runOp(opName, args, okMsg) {
    out.innerHTML = `<div class="action-result dim">running ${esc(opName)}…</div>`;
    try {
      const res = await flat.doOp(addr, opName, args);
      report(true, typeof okMsg === "function" ? okMsg(res) : okMsg);
      if (typeof refreshView === "function") refreshView();
    } catch (e) {
      report(false, `${opName} failed: ${e?.code ? e.code + ": " : ""}${e?.message || e}`);
    }
  }

  function field(labelText, input) {
    const wrap = document.createElement("div");
    wrap.className = "op-field";
    const l = document.createElement("label");
    l.textContent = labelText;
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  function openGraftBeing(slot, peer) {
    slot.innerHTML = "";
    const cands = candidateBeings();
    let select = null;
    if (cands.length) {
      select = document.createElement("select");
      select.className = "op-input";
      for (const c of cands) {
        const o = document.createElement("option");
        o.value = c.id; o.textContent = `${c.name} (${c.id.slice(0, 12)}…)`;
        select.appendChild(o);
      }
      const other = document.createElement("option");
      other.value = ""; other.textContent = "other (type an id below)";
      select.appendChild(other);
      slot.appendChild(field("being (here)", select));
    }
    const idInput = document.createElement("input");
    idInput.className = "op-input";
    idInput.placeholder = "being id (pubkey), if not in the list above";
    slot.appendChild(field("being id", idInput));
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn-sm fed-go";
    btn.textContent = `graft to ${peer.domain}`;
    btn.onclick = () => {
      const beingId = (select && select.value) ? select.value : idInput.value.trim();
      if (!beingId) { report(false, "pick a being or enter a being id"); return; }
      runOp("offer-being", { peer: peer.domain, beingId }, (res) =>
        `delivered being ${String(beingId).slice(0, 12)}… to ${peer.domain} (negotiation ${String(res?.negotiationId || "").slice(0, 8)}). it lands verbatim, auto-accepted.`);
    };
    slot.appendChild(btn);
  }

  function openTemplate(slot, peer, opName) {
    slot.innerHTML = "";
    const pathInput = document.createElement("input");
    pathInput.className = "op-input";
    pathInput.value = flat.state?.descriptor?.address?.pathByNames || "/";
    slot.appendChild(field("subtree path", pathInput));
    const labelInput = document.createElement("input");
    labelInput.className = "op-input";
    labelInput.placeholder = "optional label";
    slot.appendChild(field("label", labelInput));
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn-sm fed-go";
    btn.textContent = opName === "offer-template" ? `offer to ${peer.domain}` : `request from ${peer.domain}`;
    btn.onclick = () => {
      const subtreePath = pathInput.value.trim();
      if (!subtreePath) { report(false, "enter a subtree path"); return; }
      runOp(opName, { peer: peer.domain, subtreePath, label: labelInput.value.trim() || null }, (res) =>
        opName === "offer-template"
          ? `offered template "${subtreePath}" to ${peer.domain} (negotiation ${String(res?.negotiationId || "").slice(0, 8)}); awaiting their accept.`
          : `requested "${subtreePath}" from ${peer.domain}; they decide whether to send it.`);
    };
    slot.appendChild(btn);
  }

  function peerRow(peer) {
    const row = document.createElement("div");
    row.className = "fed-row";
    const dot = ["healthy", "active", "up", "ok"].includes(String(peer.status)) ? "#5fd08a" : (peer.status ? "#e8b762" : "#6b7d72");
    const head = document.createElement("div");
    head.className = "fed-row-head";
    head.innerHTML =
      `<span class="fed-dot" style="background:${dot}"></span>` +
      `<span class="fed-domain">${esc(peer.domain)}</span>` +
      (peer.name ? `<span class="dim"> ${esc(peer.name)}</span>` : "") +
      (peer.status ? `<span class="dim"> · ${esc(peer.status)}</span>` : "") +
      (peer.lastSeenAt ? `<span class="dim"> · seen ${esc(shortTime(peer.lastSeenAt))}</span>` : "");
    row.appendChild(head);

    const slot = document.createElement("div");
    slot.className = "fed-row-form";

    const acts = document.createElement("div");
    acts.className = "fed-row-actions";
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn-sm"; b.textContent = label;
      b.onclick = () => fn(slot, peer);
      acts.appendChild(b);
    };
    mk("graft a being", openGraftBeing);
    mk("offer a template", (s, p) => openTemplate(s, p, "offer-template"));
    mk("request a template", (s, p) => openTemplate(s, p, "request-template"));
    row.appendChild(acts);
    row.appendChild(slot);
    return row;
  }

  async function load() {
    list.innerHTML = `<div class="dim fed-empty">loading peers…</div>`;
    let peers = [], err = null;
    try { peers = normalizePeers(await flat.see(`${r}/./peers`)); }
    catch (e) { err = e?.code ? `${e.code}: ${e.message || ""}` : (e?.message || String(e)); }
    list.innerHTML = "";
    if (err) { list.innerHTML = `<div class="action-result action-err">peers SEE failed: ${esc(err)}</div>`; return; }
    if (!peers.length) { list.innerHTML = `<div class="dim fed-empty">no peers registered yet. add one through the peer directory and it appears here.</div>`; return; }
    for (const p of peers) list.appendChild(peerRow(p));
  }

  refresh.onclick = load;
  await load();
}
