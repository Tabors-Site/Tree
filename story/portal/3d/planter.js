// TreeOS Portal 3D — clone grafter.
//
// Replaces the retired seed-planter flow. The hotbar holds CLONE
// BUNDLES (registered via extension manifest provides.clones). On
// graft-attempt, this module:
//
//   1. If the clone declares parameters, prompts the user with a form
//      pre-filled with the declared defaults. Submission resolves to
//      a `params` dict the substrate's graft engine substitutes into
//      `"$paramName"` references in the bundle's content fields.
//
//   2. Calls one DO: `plant-template-by-name` at the current position
//      with `{ name, params }`. The substrate looks the bundle up in
//      the clone registry and replays its facts under the operator's
//      identity. The clone's wrapper space (or first new aggregate)
//      becomes the visible root.
//
// One DO, not the old two-step (create + plant). Clone bundles bring
// their own root space; the operator picks WHERE, the bundle picks
// WHAT.

let _modal = null;

/**
 * Prompt for clone parameter values. Returns a Promise that resolves
 * with a params dict (key per declared parameter), or rejects on
 * cancel.
 *
 * @param {object} args
 * @param {object} args.item        the hotbar clone slot
 * @param {string} args.parentLabel where we're grafting
 */
export function promptForName({ item, parentLabel }) {
  return new Promise((resolve, reject) => {
    closePrompt();

    const params = Array.isArray(item.parameters) ? item.parameters : [];
    const fields = params.map((p, i) => `
      <div class="field">
        <label for="grafter-param-${i}">${escapeHtml(p.name)}${p.description ? ` <span class="dim">— ${escapeHtml(p.description)}</span>` : ""}</label>
        <input id="grafter-param-${i}" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(p.default ?? "")}" data-param="${escapeHtml(p.name)}" />
      </div>
    `).join("");

    _modal = document.createElement("div");
    _modal.className = "overlay";
    _modal.innerHTML = `
      <div class="overlay-card">
        <h2>graft ${escapeHtml(shortLabel(item))}</h2>
        <div class="sub">at <code>${escapeHtml(parentLabel)}</code></div>
        <div class="planter-desc">${escapeHtml(item.description || "")}</div>
        ${fields}
        <button class="btn" id="grafter-submit">graft</button>
        <button class="btn-link" id="grafter-cancel">cancel</button>
        <div class="error" id="grafter-error" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(_modal);

    const submit = _modal.querySelector("#grafter-submit");
    const cancel = _modal.querySelector("#grafter-cancel");
    const inputs = Array.from(_modal.querySelectorAll("input[data-param]"));

    const finish = () => {
      const collected = {};
      for (const input of inputs) {
        const k = input.getAttribute("data-param");
        const v = (input.value || "").trim();
        if (v.length === 0) continue;  // empty → fall through to bundle default
        collected[k] = v;
      }
      closePrompt();
      resolve(collected);
    };
    const abort = () => { closePrompt(); reject(new Error("cancelled")); };

    submit.addEventListener("click", finish);
    cancel.addEventListener("click", abort);
    for (const input of inputs) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter")  { e.preventDefault(); finish(); }
        if (e.key === "Escape") { e.preventDefault(); abort(); }
      });
    }

    if (inputs.length > 0) setTimeout(() => inputs[0].focus(), 0);
    else                   setTimeout(() => submit.focus(),   0);
  });
}

export function closePrompt() {
  if (_modal && _modal.parentNode) _modal.parentNode.removeChild(_modal);
  _modal = null;
}

export function isPlanterOpen() {
  return !!_modal;
}

/**
 * Graft a clone bundle at the operator's current position. ONE DO:
 * plant-template-by-name. The substrate looks the bundle up in the
 * registry and replays it; the bundle's wrapper space (or first
 * aggregate) becomes the new root.
 *
 * Resolves with `{ rootSpaceId, newRootAddress, counts }`.
 *
 * @param {object} args
 * @param {object} args.client          PortalClient
 * @param {string} args.parentAddress   parent position
 * @param {string} args.cloneName       registered clone name ("<ext>:<localName>")
 * @param {object} [args.params]        parameter values for the bundle
 */
export async function plantGraft({ client, parentAddress, cloneName, params = {} }) {
  const result = await client.do(parentAddress, "plant-template-by-name", {
    name: cloneName,
    params,
  });
  const rootSpaceId = result?.rootSpaceId || null;
  // Construct an address for navigation: we don't know the wrapper
  // space's user-facing name from here; use the bare-id form if the
  // substrate exposes it, else fall back to the parent (the operator
  // can navigate manually). The bare-id path `/<spaceId>` is a valid
  // IBP address.
  const newRootAddress = rootSpaceId
    ? `${parentAddress.replace(/\/+$/, "")}/${rootSpaceId}`
    : null;
  return {
    rootSpaceId,
    newRootAddress,
    counts: result?.counts || null,
  };
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function shortLabel(item) {
  return item.label || (item.name && item.name.split(":").pop()) || "clone";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
