// TreeOS Portal 3D — seed planter.
//
// Orchestrates the two-step flow that turns a held seed into living
// substrate: (1) DO create-child at the current position to spawn a
// fresh node — when that position is the place root, the creator is
// stamped as `rootOwner` by the seed — and (2) DO plant-seed at the
// newly-created node id, which runs the seed's scaffold recipe
// (materializing Ruler/Planner/Contractor/Foreman/coder beings for
// `coder:governing-coder`).
//
// Why two DOs and not one: planting INTO an empty position would mean
// the seed scaffolds over the operator's existing tree. Planting AT a
// NEW position lets the operator place many independent rulerships
// across the place. The first DO declares the place; the second declares
// what grows there.

let _modal = null;

/**
 * Open a "name this seedling" prompt. Returns a Promise that resolves
 * with { name } on submit, or rejects on cancel.
 *
 * @param {object} args
 * @param {object} args.item        the hotbar slot (seed metadata)
 * @param {string} args.parentLabel human label of the place we're planting at ("treeos.ai/")
 */
export function promptForName({ item, parentLabel }) {
  return new Promise((resolve, reject) => {
    closePrompt();
    _modal = document.createElement("div");
    _modal.className = "overlay";
    _modal.innerHTML = `
      <div class="overlay-card">
        <h2>plant ${escapeHtml(shortLabel(item))}</h2>
        <div class="sub">at <code>${escapeHtml(parentLabel)}</code></div>
        <div class="planter-desc">${escapeHtml(item.description || "")}</div>
        <div class="field">
          <label for="planter-name">name the new tree</label>
          <input id="planter-name" type="text" autocomplete="off" spellcheck="false" />
        </div>
        <button class="btn" id="planter-submit">plant</button>
        <button class="btn-link" id="planter-cancel">cancel</button>
        <div class="error" id="planter-error" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(_modal);

    const input  = _modal.querySelector("#planter-name");
    const submit = _modal.querySelector("#planter-submit");
    const cancel = _modal.querySelector("#planter-cancel");

    const finish = (val) => { closePrompt(); resolve({ name: val }); };
    const abort  = () => { closePrompt(); reject(new Error("cancelled")); };

    submit.addEventListener("click", () => {
      const v = (input.value || "").trim();
      if (!v) {
        _showError("name is required");
        return;
      }
      finish(v);
    });
    cancel.addEventListener("click", abort);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter")  { e.preventDefault(); submit.click(); }
      if (e.key === "Escape") { e.preventDefault(); abort(); }
    });

    setTimeout(() => input.focus(), 0);
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
 * Plant a seed end-to-end. Two DOs over the IBP socket:
 *
 *   1. place.do(parentAddress, "birth", { kind: "space", spec: { name, type } })
 *      → returns the new node. At the place root this stamps `rootOwner`.
 *   2. place.do(newNodeAddress, "plant", { seed: seedName })
 *      → runs the seed's scaffold; returns plantedSeedId + plantedThings.
 *
 * Resolves with `{ newNodeAddress, plantedSeedId, plantedThings }`.
 *
 * @param {object} args
 * @param {object} args.client          PortalClient
 * @param {string} args.parentAddress   parent position ("treeos.ai/" for place root)
 * @param {string} args.seedName        registered seed name (e.g. "coder:governing-coder")
 * @param {string} args.newNodeName     name for the new node
 * @param {string} [args.newNodeType]   defaults to "branch"
 */
export async function plantSeed({ client, parentAddress, seedName, newNodeName, newNodeType = "branch" }) {
  // Step 1 — create the new node. The seed's birth op returns the
  // created node (full doc). At the place root, isRoot=true and
  // rootOwner gets stamped with the creator's beingId.
  const created = await client.do(parentAddress, "birth", {
    kind: "space",
    spec: {
      name: newNodeName,
      type: newNodeType,
    },
  });

  const newNodeId   = created?._id || created?.id || created?.nodeId;
  const newNodePath = derivePath(parentAddress, newNodeName);
  if (!newNodeId) {
    throw new Error("birth returned no node id");
  }

  // Step 2 — plant the seed at the new node. Address by path (the
  // resolver will place on the same node we just created).
  const planted = await client.do(newNodePath, "plant", {
    seed: seedName,
  });

  return {
    newNodeId,
    newNodeAddress: newNodePath,
    plantedSeedId:  planted?.plantedSeedId || null,
    plantedThings:  planted?.plantedThings || null,
  };
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function shortLabel(item) {
  return item.label || (item.name && item.name.split(":").pop()) || "seed";
}

function derivePath(parentAddress, name) {
  // parentAddress shapes: "<place>", "<place>/", "<place>/foo/bar"
  // We want "<place>/foo/bar/<name>" with single slashes.
  const trimmed = String(parentAddress || "").replace(/\/+$/, "");
  return `${trimmed}/${name}`;
}

function _showError(msg) {
  if (!_modal) return;
  const el = _modal.querySelector("#planter-error");
  el.textContent = msg;
  el.style.display = "block";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
