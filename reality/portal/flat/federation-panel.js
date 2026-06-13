// federation-panel.js . Federation > activity.
//
// The operator's federation inbox: incoming offers and requests awaiting a
// decision, outbound transfers in flight, and the completed log. Reads the
// federation-status SEE op (read-only) and acts through four DO ops:
//   incoming offer   -> accept-template  / reject-template
//   incoming request -> fulfill-request  / refuse-request
// Companion: peers-panel.js (the outbound moves: offer-being / offer-template).

import { flat } from "./host.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function reality() { return (flat.state?.discovery?.reality || "").replace(/\/+$/, ""); }
function fedAddress() { const r = reality(); return r ? `${r}/@federation-manager` : null; }
function short(s, n = 8) { return String(s == null ? "" : s).slice(0, n); }

export async function renderFederationPanel(body, _action, _opByName, { refreshView } = {}) {
  const addr = fedAddress();
  if (!addr) { body.textContent = "portal not ready (no reality)"; return; }
  body.innerHTML = "";

  const intro = document.createElement("div");
  intro.className = "fed-intro dim";
  intro.textContent = "your federation queue. decide on incoming offers and requests, and watch outbound transfers complete.";
  body.appendChild(intro);

  const refresh = document.createElement("button");
  refresh.type = "button"; refresh.className = "btn-sm"; refresh.textContent = "reload";
  refresh.style.marginBottom = "8px";
  body.appendChild(refresh);

  const sections = document.createElement("div");
  body.appendChild(sections);

  const out = document.createElement("div");
  out.className = "fed-result-slot";
  body.appendChild(out);

  function report(ok, msg) {
    out.innerHTML = `<div class="action-result ${ok ? "" : "action-err"}">${esc(msg)}</div>`;
  }

  async function decide(opName, negotiationId, okMsg) {
    out.innerHTML = `<div class="action-result dim">${esc(opName)}…</div>`;
    try {
      await flat.doOp(addr, opName, { negotiationId });
      report(true, okMsg);
      await load();
      if (typeof refreshView === "function") refreshView();
    } catch (e) {
      report(false, `${opName} failed: ${e?.code ? e.code + ": " : ""}${e?.message || e}`);
    }
  }

  function section(title, count) {
    const s = document.createElement("div");
    s.className = "fed-section";
    const h = document.createElement("div");
    h.className = "fed-section-head";
    h.innerHTML = `${esc(title)} <span class="dim">${count}</span>`;
    s.appendChild(h);
    return s;
  }

  function kv(parent, k, v) {
    const row = document.createElement("div");
    row.className = "fed-kv";
    row.innerHTML = `<span class="dim">${esc(k)}</span> <span>${esc(v)}</span>`;
    parent.appendChild(row);
  }

  function actBtn(label, danger, fn) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-sm" + (danger ? " task-action-danger" : "");
    b.textContent = label;
    b.onclick = fn;
    return b;
  }

  function emptyLine(t) {
    const d = document.createElement("div");
    d.className = "dim fed-empty";
    d.textContent = t;
    return d;
  }

  async function load() {
    sections.innerHTML = `<div class="dim fed-empty">loading…</div>`;
    let st = null, err = null;
    try { st = await flat.see("federation-status"); }
    catch (e) { err = e?.code ? `${e.code}: ${e.message || ""}` : (e?.message || String(e)); }
    sections.innerHTML = "";
    if (err) { sections.innerHTML = `<div class="action-result action-err">federation-status failed: ${esc(err)}</div>`; return; }

    const offers = st.pendingIncomingOffers || [];
    const reqs   = st.pendingIncomingRequests || [];
    const outb   = st.pendingOutbound || [];
    const done   = st.completed || [];

    // Incoming offers (a peer wants to plant a template here).
    const sOff = section("incoming offers", offers.length);
    if (!offers.length) sOff.appendChild(emptyLine("no offers awaiting you"));
    for (const o of offers) {
      const card = document.createElement("div"); card.className = "fed-card";
      kv(card, "negotiation", short(o.id));
      kv(card, "from", o.sender?.reality || o.sender?.beingId || "(unknown)");
      if (o.label) kv(card, "label", o.label);
      if (o.sourceSubtreePath) kv(card, "subtree", o.sourceSubtreePath);
      const a = document.createElement("div"); a.className = "fed-card-actions";
      a.appendChild(actBtn("accept", false, () => decide("accept-template", o.id, `accepted ${short(o.id)}; the sender will deliver the template.`)));
      a.appendChild(actBtn("reject", true, () => decide("reject-template", o.id, `rejected ${short(o.id)}.`)));
      card.appendChild(a);
      sOff.appendChild(card);
    }
    sections.appendChild(sOff);

    // Incoming requests (a peer asks us to send them a template).
    const sReq = section("incoming requests", reqs.length);
    if (!reqs.length) sReq.appendChild(emptyLine("no requests awaiting you"));
    for (const q of reqs) {
      const card = document.createElement("div"); card.className = "fed-card";
      kv(card, "negotiation", short(q.id));
      kv(card, "from", q.puller?.reality || q.puller?.beingId || "(unknown)");
      if (q.subtreePath) kv(card, "wants", q.subtreePath);
      const a = document.createElement("div"); a.className = "fed-card-actions";
      a.appendChild(actBtn("fulfill (send it)", false, () => decide("fulfill-request", q.id, `fulfilling ${short(q.id)}; pushing the template back.`)));
      a.appendChild(actBtn("refuse", true, () => decide("refuse-request", q.id, `refused ${short(q.id)}.`)));
      card.appendChild(a);
      sReq.appendChild(card);
    }
    sections.appendChild(sReq);

    // Outbound in flight (our pushes/pulls awaiting the peer).
    const sOut = section("outbound in flight", outb.length);
    if (!outb.length) sOut.appendChild(emptyLine("nothing in flight"));
    for (const ob of outb) {
      const card = document.createElement("div"); card.className = "fed-card";
      kv(card, "negotiation", short(ob.id));
      kv(card, "direction", ob.direction || "?");
      kv(card, "peer", ob.peer || "?");
      if (ob.subtreePath) kv(card, "subtree", ob.subtreePath);
      kv(card, "step", ob.lastStep || "?");
      sOut.appendChild(card);
    }
    sections.appendChild(sOut);

    // Completed log (most recent last; show the tail).
    const sDone = section("completed", done.length);
    if (!done.length) sDone.appendChild(emptyLine("nothing completed yet"));
    for (const c of done.slice(-12).reverse()) {
      const card = document.createElement("div"); card.className = "fed-card fed-card-done";
      kv(card, "negotiation", short(c.id));
      kv(card, "direction", c.direction || "?");
      if (c.peer) kv(card, "peer", c.peer);
      kv(card, "outcome", c.success ? "success" : `failed${c.reason ? ": " + c.reason : ""}`);
      sDone.appendChild(card);
    }
    sections.appendChild(sDone);
  }

  refresh.onclick = load;
  await load();
}
