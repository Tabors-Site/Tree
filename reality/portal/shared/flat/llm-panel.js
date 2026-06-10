// llm-panel.js — the Place > LLM (and Reality > LLM) tab.
//
// Surfaces LLM connection management + the 7-step resolution chain
// preview without routing through @llm-manager. Per the chain rebuild
// (philosophy/CROSS-WORLD/auth.jpg), every being can configure their
// own LLM, every space owner can configure their space's defaults,
// and angels can configure the reality root. The substrate side
// (qualities.llm + qualities.llmConnections) is the same whether the
// caller goes through @llm-manager or comes here directly.
//
// Two surfaces share this code:
//
//   "llm"          place tab — your settings + (when owner) this space's
//   "llm-reality"  reality tab — the reality root's defaults (angels only)
//
// The 7-step chain (seed/present/cognition/llm/chain.js):
//   0  receiver being  · role-slot
//   1  receiver being  · default
//   2  receiver space  · role-slot (walks ancestors)
//   3  receiver space  · default   (walks ancestors)
//   4  receiver reality
//   5  actor being     · role-slot + default
//   6  actor space + actor reality
//
// Forced flags shift the chain:
//   forceReceiver=true on ANY container in [0..4] → caps at that container
//   forceActor=true     on ANY container in [0..4] → skip rest of receiver
//                                                    side, jump to step 5

import { flat } from "./host.js";

export async function renderLlmPanel(body, action, opByName, { refreshView, mode } = {}) {
  body.innerHTML = "";
  injectStyles();

  const desc = action.values?.descriptor || flat.state?.descriptor || {};
  const reality = flat.state?.discovery?.reality
    || desc.address?.reality
    || desc.address?.place
    || "";
  const path = desc.address?.pathByNames || "/";
  const positionAddress = `${reality}${path === "/" ? "/" : path}`;
  const positionSpaceId = desc.address?.spaceId
    || desc.position?.spaceId
    || desc.space?._id
    || null;
  const realityRootAddress = `${reality}/`;

  const session = flat.state?.session || {};
  const viewerName = (session.username || session.name || "").trim();
  const viewerBeingId = session.beingId || null;
  const isAnonymous = !viewerName || viewerName === "arrival";

  const isRealityMode = mode === "reality";

  // ── 1. Effective chain (THE answer) ────────────────────────────────
  await renderChainSection(body, { reality, viewerBeingId, viewerName, positionSpaceId, isAnonymous });

  if (isAnonymous) {
    body.appendChild(noteRow("Sign in to manage LLM connections."));
    return;
  }

  // ── 2. Your connections ────────────────────────────────────────────
  const connsBox = section(body, "Your connections");
  const connsBody = document.createElement("div");
  connsBox.appendChild(connsBody);
  await renderConnections(connsBody, { refreshSelf: () => { connsBody.innerHTML = ""; renderConnections(connsBody, { refreshSelf: () => {}, refreshChain: () => refreshChainBlock(body, reality, viewerBeingId, positionSpaceId) }); } });

  // ── 3. Add a connection ────────────────────────────────────────────
  const addBox = collapsibleSection(body, "Add a connection");
  renderAddConnection(addBox.body, {
    onResult: (err) => {
      if (!err) {
        connsBody.innerHTML = "";
        renderConnections(connsBody, { refreshSelf: () => {}, refreshChain: () => refreshChainBlock(body, reality, viewerBeingId, positionSpaceId) });
      }
    },
  });

  // ── 4. Your being's slots ──────────────────────────────────────────
  const beingSlotsBox = collapsibleSection(body, `@${viewerName}'s LLM (your being)`);
  renderSlotsAssigner(beingSlotsBox.body, {
    label: "your being",
    onAssign: async ({ slot, connectionId }) => {
      await flat.doOp(positionAddress, "llm-assigner:assign-slot", { slot, connectionId });
    },
    afterChange: () => refreshChainBlock(body, reality, viewerBeingId, positionSpaceId),
  });

  // ── 5. This space's defaults (owner-only — substrate gates) ────────
  if (!isRealityMode) {
    const spaceBox = collapsibleSection(body, "This space's LLM defaults");
    spaceBox.body.appendChild(noteRow(
      "Owner-gated. Sets qualities.llm on this space — beings standing here pick this up via step 2/3 of the chain."
    ));
    renderSpaceOrRealityForm(spaceBox.body, {
      isReality: false,
      address: positionAddress,
      afterChange: () => refreshChainBlock(body, reality, viewerBeingId, positionSpaceId),
    });
  }

  // ── 6. Reality root's defaults (angel-only) ────────────────────────
  const realityBox = collapsibleSection(body, isRealityMode ? "Reality LLM defaults" : "Reality LLM defaults (angel-only)");
  realityBox.body.appendChild(noteRow(
    "Angel-gated. Sets qualities.llm on the reality root — the floor everyone falls through to at step 4 of the chain."
  ));
  renderSpaceOrRealityForm(realityBox.body, {
    isReality: true,
    address: realityRootAddress,
    afterChange: () => refreshChainBlock(body, reality, viewerBeingId, positionSpaceId),
  });
}

// ──────────────────────────────────────────────────────────────────
// Chain section — visualizes the 7 steps for "you summon a being here"
// ──────────────────────────────────────────────────────────────────

async function renderChainSection(parent, { reality, viewerBeingId, viewerName, positionSpaceId, isAnonymous }) {
  const sec = section(parent, "What LLM will be used");
  sec.id = "llm-chain-section";

  if (isAnonymous) {
    sec.appendChild(noteRow("Anonymous visitors get no LLM resolution (no acting identity to chain back from)."));
    return;
  }

  // For the chain preview, we show the chain that resolves when YOU (the
  // viewer) summon a being standing AT THIS POSITION. The receiver is
  // any being at the position; without one in particular, we use the
  // viewer's own being-id as both actor + receiver (self-chain).
  const receiverBeingId = viewerBeingId;
  const chainHolder = document.createElement("div");
  sec.appendChild(chainHolder);
  await paintChain(chainHolder, { reality, receiverBeingId, actorBeingId: viewerBeingId, positionSpaceId });
}

async function refreshChainBlock(panelBody, reality, viewerBeingId, positionSpaceId) {
  const sec = panelBody.querySelector("#llm-chain-section");
  if (!sec) return;
  // Wipe everything except the title.
  const title = sec.querySelector(".rp-title");
  sec.innerHTML = "";
  if (title) sec.appendChild(title);
  const holder = document.createElement("div");
  sec.appendChild(holder);
  await paintChain(holder, { reality, receiverBeingId: viewerBeingId, actorBeingId: viewerBeingId, positionSpaceId });
}

async function paintChain(holder, { reality, receiverBeingId, actorBeingId, positionSpaceId }) {
  void reality;
  holder.appendChild(noteRow("Loading chain…"));
  let result;
  try {
    result = await flat.client.see("llm-chain", {
      args: {
        receiverBeingId,
        actorBeingId,
        receiverSpaceId: positionSpaceId,
        role: "main",
      },
    });
  } catch (err) {
    holder.innerHTML = "";
    holder.appendChild(errorRow(`chain fetch failed: ${err?.message || err}`));
    return;
  }
  holder.innerHTML = "";

  const chosen = result?.chosen || null;
  if (chosen) {
    const top = document.createElement("div");
    top.className = "llm-chosen";
    top.innerHTML = `<strong>${escapeHtml(chosen.model || chosen.name || chosen.connectionId.slice(0, 12))}</strong>` +
      ` <span class="dim">via step ${chosen.step} · ${chosen.source}</span>`;
    holder.appendChild(top);
  } else {
    const empty = document.createElement("div");
    empty.className = "llm-chosen dim";
    empty.textContent = `(no LLM resolves — ${result?.reason || "no connections found"})`;
    holder.appendChild(empty);
  }

  const chain = Array.isArray(result?.chain) ? result.chain : [];
  if (chain.length > 0) {
    const list = document.createElement("ul");
    list.className = "llm-chain-list";
    for (const entry of chain) {
      const li = document.createElement("li");
      const isChosen = chosen && entry.connectionId === chosen.connectionId
        && entry.step === chosen.step && entry.source === chosen.source;
      li.innerHTML =
        `<span class="dim">step ${entry.step}</span> ` +
        `<span class="llm-source">${escapeHtml(entry.source)}</span> ` +
        `<span>${escapeHtml(entry.model || entry.name || entry.connectionId.slice(0, 10))}</span>`;
      if (isChosen) li.classList.add("llm-chosen-row");
      list.appendChild(li);
    }
    holder.appendChild(list);
  }
}

// ──────────────────────────────────────────────────────────────────
// Connections list
// ──────────────────────────────────────────────────────────────────

async function renderConnections(body, { refreshSelf, refreshChain } = {}) {
  body.appendChild(noteRow("Loading connections…"));
  let result;
  try {
    result = await flat.client.see("llm-connections");
  } catch (err) {
    body.innerHTML = "";
    body.appendChild(errorRow(`connections fetch failed: ${err?.message || err}`));
    return;
  }
  body.innerHTML = "";
  const conns = Array.isArray(result?.connections) ? result.connections : [];
  if (conns.length === 0) {
    body.appendChild(noteRow("(no connections — add one below)"));
    return;
  }
  const slots = result?.slots || {};
  for (const c of conns) {
    const card = document.createElement("div");
    card.className = "llm-conn-card";
    const head = document.createElement("div");
    head.className = "llm-conn-head";
    head.innerHTML = `<strong>${escapeHtml(c.model || c.name)}</strong>` +
      ` <span class="dim">${escapeHtml(c.name || "")}</span>`;
    card.appendChild(head);
    const meta = document.createElement("div");
    meta.className = "llm-conn-meta dim";
    meta.textContent = `${c.baseUrl || "(no base url)"} · id: ${c.connectionId.slice(0, 10)}…`;
    card.appendChild(meta);

    // Show which slots it's bound to (on this being).
    const boundSlots = Object.entries(slots)
      .filter(([, id]) => String(id) === String(c.connectionId))
      .map(([k]) => k);
    if (boundSlots.length > 0) {
      const slotRow = document.createElement("div");
      slotRow.className = "llm-conn-slots";
      slotRow.textContent = `bound to slot: ${boundSlots.join(", ")}`;
      card.appendChild(slotRow);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-warn btn-compact";
    del.textContent = "delete";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete connection "${c.model || c.name}"?`)) return;
      del.disabled = true;
      try {
        await flat.doOp(flat.state?.discovery?.reality + "/", "llm-assigner:delete-llm", {
          connectionId: c.connectionId,
        });
        refreshSelf?.();
        refreshChain?.();
      } catch (err) {
        del.textContent = `failed: ${err?.message || err}`.slice(0, 60);
        del.disabled = false;
      }
    });
    card.appendChild(del);
    body.appendChild(card);
  }
}

// ──────────────────────────────────────────────────────────────────
// Add-connection form
// ──────────────────────────────────────────────────────────────────

function renderAddConnection(body, { onResult }) {
  const form = document.createElement("div");
  form.className = "compact-form";
  const nameF = textInput("name", "Name (optional, e.g. 'my-claude')");
  const urlF  = textInput("baseUrl", "Base URL (e.g. https://api.anthropic.com)");
  const modelF = textInput("model",  "Model (e.g. claude-3-5-sonnet-20241022)");
  const keyF  = textInput("apiKey",  "API key (stored encrypted on your being)");
  keyF.input.type = "password";
  for (const f of [nameF, urlF, modelF, keyF]) form.appendChild(f.wrapper);

  const result = document.createElement("div");
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn-primary";
  submit.textContent = "Add connection";
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    result.textContent = "";
    const baseUrl = urlF.input.value.trim();
    const model = modelF.input.value.trim();
    if (!baseUrl || !model) {
      result.className = "action-result action-err";
      result.textContent = "baseUrl and model are required.";
      submit.disabled = false;
      return;
    }
    try {
      await flat.doOp(flat.state?.discovery?.reality + "/", "llm-assigner:add-llm", {
        name: nameF.input.value.trim() || null,
        baseUrl, model,
        apiKey: keyF.input.value || null,
      });
      result.className = "action-result action-ok";
      result.textContent = "Added.";
      // Clear sensitive field
      keyF.input.value = "";
      onResult?.(null);
    } catch (err) {
      result.className = "action-result action-err";
      result.textContent = err?.message || String(err);
      submit.disabled = false;
      onResult?.(err);
    }
  });
  form.appendChild(submit);
  form.appendChild(result);
  body.appendChild(form);
}

// ──────────────────────────────────────────────────────────────────
// Slot assigner — bind a connection to a slot on your being
// ──────────────────────────────────────────────────────────────────

async function renderSlotsAssigner(body, { onAssign, afterChange }) {
  let conns = [];
  try {
    const r = await flat.client.see("llm-connections");
    conns = Array.isArray(r?.connections) ? r.connections : [];
  } catch { /* fall through with empty list */ }

  if (conns.length === 0) {
    body.appendChild(noteRow("Add a connection first, then come back here to assign it to a slot."));
    return;
  }

  const form = document.createElement("div");
  form.className = "compact-form";
  const slotF = textInput("slot", "Slot name (default, main, coder, writer, …)");
  slotF.input.value = "main";

  const connF = document.createElement("div");
  connF.className = "field-row";
  const label = document.createElement("label");
  label.textContent = "Connection";
  const select = document.createElement("select");
  select.className = "op-input";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "(unset slot — clears it)";
  select.appendChild(noneOpt);
  for (const c of conns) {
    const opt = document.createElement("option");
    opt.value = c.connectionId;
    opt.textContent = `${c.model || c.name || c.connectionId.slice(0, 10)} (${c.connectionId.slice(0, 8)})`;
    select.appendChild(opt);
  }
  connF.appendChild(label);
  connF.appendChild(select);
  form.appendChild(slotF.wrapper);
  form.appendChild(connF);

  const result = document.createElement("div");
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn-primary";
  submit.textContent = "Assign slot";
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    result.textContent = "";
    const slot = slotF.input.value.trim();
    const connectionId = select.value || null;
    if (!slot) {
      result.className = "action-result action-err";
      result.textContent = "Slot name is required.";
      submit.disabled = false;
      return;
    }
    try {
      await onAssign({ slot, connectionId });
      result.className = "action-result action-ok";
      result.textContent = connectionId ? `Assigned ${slot}.` : `Cleared ${slot}.`;
      submit.disabled = false;
      afterChange?.();
    } catch (err) {
      result.className = "action-result action-err";
      result.textContent = err?.message || String(err);
      submit.disabled = false;
    }
  });
  form.appendChild(submit);
  form.appendChild(result);
  body.appendChild(form);
}

// ──────────────────────────────────────────────────────────────────
// Space / reality LLM form (for owners + angels)
// ──────────────────────────────────────────────────────────────────

function renderSpaceOrRealityForm(body, { isReality, address, afterChange }) {
  const form = document.createElement("div");
  form.className = "compact-form";

  const defaultF  = textInput("default", "Default fallback connectionIds (comma-separated)");
  const slotsF    = textInput("slots", "Per-role slots as JSON: {\"coder\":[\"<id1>\",\"<id2>\"]}");
  const preferOwnF = checkbox("preferOwn", "preferOwn (this container's connections jump to front within its step)");
  const forceActorF = checkbox("forceActor", "forceActor (chain skips remaining receiver-side, jumps to actor side)");
  const forceReceiverF = checkbox("forceReceiver", "forceReceiver (chain caps at this container's step; actor side never runs)");

  form.appendChild(defaultF.wrapper);
  form.appendChild(slotsF.wrapper);
  form.appendChild(preferOwnF.wrapper);
  form.appendChild(forceActorF.wrapper);
  form.appendChild(forceReceiverF.wrapper);

  const result = document.createElement("div");
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn-primary";
  submit.textContent = isReality ? "Save reality defaults" : "Save space defaults";
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    result.textContent = "";
    const defList = defaultF.input.value.split(",").map(s => s.trim()).filter(Boolean);
    let slots = null;
    const slotsRaw = slotsF.input.value.trim();
    if (slotsRaw) {
      try { slots = JSON.parse(slotsRaw); }
      catch {
        result.className = "action-result action-err";
        result.textContent = "Slots must be valid JSON: {\"role\":[\"id\",…]}";
        submit.disabled = false;
        return;
      }
    }
    if (forceActorF.input.checked && forceReceiverF.input.checked) {
      result.className = "action-result action-err";
      result.textContent = "forceActor and forceReceiver are mutually exclusive.";
      submit.disabled = false;
      return;
    }
    const params = {};
    if (defList.length > 0) params.default = defList;
    if (slots) params.slots = slots;
    if (preferOwnF.input.checked) params.preferOwn = true;
    if (forceActorF.input.checked) params.forceActor = true;
    if (forceReceiverF.input.checked) params.forceReceiver = true;
    try {
      const op = isReality ? "llm-assigner:set-reality-llm" : "llm-assigner:set-space-llm";
      await flat.doOp(address, op, params);
      result.className = "action-result action-ok";
      result.textContent = "Saved.";
      submit.disabled = false;
      afterChange?.();
    } catch (err) {
      result.className = "action-result action-err";
      result.textContent = err?.message || String(err);
      submit.disabled = false;
    }
  });
  form.appendChild(submit);
  form.appendChild(result);
  body.appendChild(form);
}

// ──────────────────────────────────────────────────────────────────
// Render primitives (matched style with roles-panel)
// ──────────────────────────────────────────────────────────────────

function section(parent, title) {
  const sec = document.createElement("section");
  sec.className = "rp-section";
  const h = document.createElement("h3");
  h.className = "rp-title";
  h.textContent = title;
  sec.appendChild(h);
  parent.appendChild(sec);
  return sec;
}

function collapsibleSection(parent, title) {
  const sec = document.createElement("section");
  sec.className = "rp-section rp-collapsible";
  const head = document.createElement("h3");
  head.className = "rp-title rp-clickable";
  head.textContent = `▸ ${title}`;
  sec.appendChild(head);
  const body = document.createElement("div");
  body.className = "rp-body";
  body.style.display = "none";
  sec.appendChild(body);
  let open = false;
  head.addEventListener("click", () => {
    open = !open;
    head.textContent = (open ? "▾ " : "▸ ") + title;
    body.style.display = open ? "" : "none";
  });
  parent.appendChild(sec);
  return { sec, body };
}

function noteRow(text) {
  const d = document.createElement("div");
  d.className = "rp-note dim";
  d.textContent = text;
  return d;
}

function errorRow(text) {
  const d = document.createElement("div");
  d.className = "rp-note action-err";
  d.textContent = text;
  return d;
}

function textInput(name, label) {
  const wrapper = document.createElement("div");
  wrapper.className = "field-row";
  const l = document.createElement("label");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.name = name;
  input.className = "op-input";
  wrapper.appendChild(l);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function checkbox(name, label) {
  const wrapper = document.createElement("div");
  wrapper.className = "field-row check-row";
  const l = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = name;
  l.appendChild(input);
  const span = document.createElement("span");
  span.textContent = " " + label;
  l.appendChild(span);
  wrapper.appendChild(l);
  return { wrapper, input };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectStyles() {
  if (document.getElementById("llm-panel-styles")) return;
  const s = document.createElement("style");
  s.id = "llm-panel-styles";
  s.textContent = `
    .llm-chosen { font-size: 13px; margin-top: 4px; }
    .llm-chain-list { list-style: none; padding: 0; margin: 6px 0 0; font-size: 11px; font-family: ui-monospace, monospace; }
    .llm-chain-list li { padding: 2px 4px; border-left: 2px solid #333; margin: 1px 0; }
    .llm-chain-list li.llm-chosen-row { border-left-color: #4c8; color: #cdf; background: #0a1a14; }
    .llm-source { color: #8ab; }
    .llm-conn-card { border-left: 3px solid #2a4; padding: 4px 8px; margin: 4px 0; background: #1118; border-radius: 2px; }
    .llm-conn-head { font-size: 12px; }
    .llm-conn-meta { font-size: 11px; margin-top: 1px; }
    .llm-conn-slots { font-size: 11px; color: #8ab; margin-top: 2px; }
    .check-row label { display: flex; align-items: center; cursor: pointer; user-select: none; font-size: 12px; }
    .check-row input { margin-right: 4px; }
  `;
  document.head.appendChild(s);
}
