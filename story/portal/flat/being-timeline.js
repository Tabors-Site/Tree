// being-timeline.js — Timeline section in the being inspector.
//
// Slice A of the timeline-rewind plan (seed/timeline.md). One section
// per being inspector showing the being's recent acts, newest first.
// Click any act → fetch the being's state AS OF that act's post-seal
// seq via SEE-at, render a panel with the historical snapshot
// alongside the live inspector. Visual cues mark the past view;
// write actions are not offered (the substrate refuses them anyway,
// but the UI doesn't even surface them).
//
// "As of" seq is the act's `lastFactSeq` (the highest fact seq sealed
// in that act). That's the post-seal state — what the world looked
// like immediately after the act's deltaF committed. Mid-moment
// state is doctrinally invisible.
//
// "Back to live" refetches the live descriptor — past-view sessions
// can be long enough that the live present has advanced.
//
// Slice B (future): instead of a separate panel, a slider scrubs
// the FULL place descriptor backward — beings, matters, qualities
// all rewound together via the descriptor builder's `until` threading.
// The substrate primitive (foldAt) is the same; the descriptor
// builder grows. Doesn't change this UI's wire shape.

import { flat } from "./host.js";

const MAX_ACTS = 100;

export async function renderTimelineSection(container, being, ctx) {
  const sec = document.createElement("section");
  sec.className = "panel-section";
  const h = document.createElement("h4");
  h.textContent = "Timeline";
  sec.appendChild(h);

  if (!being?.beingId) {
    sec.appendChild(hint("(no beingId surfaced on this entry)"));
    container.appendChild(sec);
    return;
  }

  const status = document.createElement("div");
  status.className = "sub";
  status.textContent = "loading acts…";
  sec.appendChild(status);

  const list = document.createElement("ol");
  list.className = "tl-list";
  sec.appendChild(list);

  // Where the historical state renders when an act is clicked. Lives
  // BELOW the list so clicking subsequent rows just replaces the panel
  // contents — no stack-up of past views.
  const past = document.createElement("div");
  past.className = "tl-past hidden";
  sec.appendChild(past);

  container.appendChild(sec);

  // Fetch the being's acts via the existing .acts/<beingId> surface.
  // describeActChain returns { being:{id,name}, acts:[{...}], count } with
  // facts attached per act and the new `lastFactSeq` we added in the
  // substrate.
  const story = ctx.story || flat.state.discovery?.story;
  const acts = await fetchActs(story, being.beingId).catch((e) => {
    status.textContent = `failed to load acts: ${e?.message || e}`;
    return null;
  });
  if (!acts) return;
  if (!acts.length) {
    status.textContent = "no acts on this being's reel yet.";
    return;
  }
  status.textContent = `${acts.length} act${acts.length === 1 ? "" : "s"} · newest first · click to view state at that point`;

  for (const act of acts) {
    list.appendChild(renderActRow(act, being, past, story));
  }
}

async function fetchActs(story, beingId) {
  if (!story) return [];
  try {
    // Qualify the SEE with the active history so the timeline reads the
    // right reel. Without the qualifier, typed story means main, and
    // a #1 user's flat-app timeline silently displays main's acts.
    const history = flat.state.descriptor?.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    const desc = await flat.state.client.see(`${story}${bq}/.acts/${beingId}`);
    const chain = desc?.actChain;
    return Array.isArray(chain?.acts) ? chain.acts.slice(0, MAX_ACTS) : [];
  } catch {
    return [];
  }
}

// ─── Row ─────────────────────────────────────────────────────────

function renderActRow(act, being, pastContainer, story) {
  const li = document.createElement("li");
  li.className = "tl-row";

  // Slice B anchor: timestamp. We click an act → pass its stampedAt;
  // the descriptor builder threads the timestamp through every reel's
  // foldAt so each one resolves its own per-reel seq. The previous
  // Slice A anchor (lastFactSeq on the being's own reel) is still
  // computed and surfaced as a "this act touched THIS being's own
  // reel" affordance — but the timestamp is what actually drives
  // the rewind. lastFactSeq:null means the act touched only other
  // reels (do:create-space etc.); we still allow click — the place
  // still rewinds to that moment, just the being's row may show
  // unchanged.
  const asOfSeq    = act.lastFactSeq;
  const stampedAt  = act.stampedAt || act.receivedAt;

  const head = document.createElement("div");
  head.className = "tl-row-head";

  const when = document.createElement("span");
  when.className = "tl-row-when";
  when.textContent = formatTime(act.stampedAt || act.receivedAt);
  head.appendChild(when);

  const role = document.createElement("span");
  role.className = "tl-row-role";
  role.textContent = act.activeRole || "(no role)";
  head.appendChild(role);

  if (asOfSeq != null) {
    const seqLabel = document.createElement("span");
    seqLabel.className = "tl-row-seq";
    seqLabel.textContent = `seq ${asOfSeq}`;
    head.appendChild(seqLabel);
  }

  li.appendChild(head);

  const summary = document.createElement("div");
  summary.className = "tl-row-summary";
  summary.textContent = summarizeAct(act);
  li.appendChild(summary);

  // Slice B: every act with a timestamp is clickable — the descriptor
  // builder folds the WHOLE place at that point, regardless of which
  // reels the act touched. The lastFactSeq check from Slice A is no
  // longer the gate (it was specific to the being's-own-row fold).
  if (!stampedAt) {
    li.classList.add("tl-row-inert");
    summary.title = "no timestamp on this act — cannot anchor a historical fold";
  } else {
    li.classList.add("tl-row-clickable");
    li.onclick = async () => {
      [...li.parentElement.children].forEach((c) => c.classList.remove("tl-row-active"));
      li.classList.add("tl-row-active");
      await openHistoricalView({
        story,
        being,
        whenISO: stampedAt,
        pastContainer,
      });
    };
  }

  return li;
}

// ─── Historical view ─────────────────────────────────────────────

async function openHistoricalView({ story, being, whenISO, pastContainer }) {
  pastContainer.classList.remove("hidden");
  pastContainer.innerHTML = "";

  const banner = document.createElement("div");
  banner.className = "tl-past-banner";
  banner.textContent = `AS OF  ·  ${formatTime(whenISO)}`;
  pastContainer.appendChild(banner);

  const status = document.createElement("div");
  status.className = "sub";
  status.textContent = "folding the place…";
  pastContainer.appendChild(status);

  // Slice B: anchor on TIMESTAMP, not seq. Per the per-reel doctrine
  // (no global "world seq"), each reel resolves the timestamp to its
  // own per-reel seq independently. Clicking an act passes the act's
  // stampedAt; the descriptor builder threads the timestamp through
  // every internal foldAt call so beings, matter, qualities, children,
  // identity — everything — folds to its own state at that point.
  let descriptor;
  try {
    const history = flat.state.descriptor?.address?.history || "0";
    const bq = history === "0" ? "" : `#${history}`;
    descriptor = await flat.state.client.see(`${story}${bq}/@${being.being}`, {
      at: { atTimestamp: whenISO },
    });
  } catch (err) {
    status.textContent = `fold failed: ${err?.code || ""} ${err?.message || err}`;
    return;
  }

  if (!descriptor?.isHistorical) {
    status.textContent = "(server returned a non-historical descriptor)";
    return;
  }
  status.remove();

  // The historical descriptor has live-compatible shape: address,
  // beings[], matters[], children[], qualities. We surface the most
  // useful summary: the inspected being's row state at this moment,
  // who else was here, what matter was at the place. The full
  // descriptor is also stored on the panel for any deeper render.
  const inspectedBeing = (descriptor.beings || []).find(
    (b) => b.being === being.being,
  ) || descriptor.beings?.[0] || null;

  if (inspectedBeing) {
    const head = document.createElement("div");
    head.className = "tl-past-section-head";
    head.textContent = `@${being.being}`;
    pastContainer.appendChild(head);
    const stateBox = document.createElement("div");
    stateBox.className = "tl-past-state";
    renderBeingHistorical(stateBox, inspectedBeing);
    pastContainer.appendChild(stateBox);
  }

  // Other beings at this place at the past time. Self-filtered.
  const others = (descriptor.beings || []).filter(
    (b) => b.being !== being.being,
  );
  if (others.length) {
    const head = document.createElement("div");
    head.className = "tl-past-section-head";
    head.textContent = `also here · ${others.length}`;
    pastContainer.appendChild(head);
    const list = document.createElement("ul");
    list.className = "tl-past-others";
    for (const o of others) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "tl-other-name";
      name.textContent = `@${o.being}`;
      li.appendChild(name);
      if (o.coord) {
        const c = document.createElement("span");
        c.className = "tl-other-coord";
        c.textContent = `(${o.coord.x ?? "?"}, ${o.coord.y ?? "?"})`;
        li.appendChild(c);
      }
      list.appendChild(li);
    }
    pastContainer.appendChild(list);
  }

  // Matter at the place at the past time.
  const matters = descriptor.matters || [];
  if (matters.length) {
    const head = document.createElement("div");
    head.className = "tl-past-section-head";
    head.textContent = `matter · ${matters.length}`;
    pastContainer.appendChild(head);
    const list = document.createElement("ul");
    list.className = "tl-past-others";
    for (const m of matters) {
      const li = document.createElement("li");
      li.textContent = `${m.name || "(unnamed)"} · ${m.origin || "?"}`;
      list.appendChild(li);
    }
    pastContainer.appendChild(list);
  }

  // Space qualities at the past time, if any.
  const qualities = descriptor.qualities || {};
  if (Object.keys(qualities).length) {
    const head = document.createElement("div");
    head.className = "tl-past-section-head";
    head.textContent = "space qualities";
    pastContainer.appendChild(head);
    const pre = document.createElement("pre");
    pre.className = "tl-past-json";
    pre.textContent = JSON.stringify(qualities, null, 2);
    pastContainer.appendChild(pre);
  }

  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn-sm";
  back.textContent = "← Back to live";
  back.onclick = () => {
    pastContainer.classList.add("hidden");
    pastContainer.innerHTML = "";
    // Refetch the live descriptor — past-view sessions can be long
    // enough that the live present has advanced. The portal's
    // navigate() does the refetch and triggers a redraw.
    flat.navigate(flat.state.currentAddress);
  };
  pastContainer.appendChild(back);
}

// Render the historical state of the inspected being. Picks the
// fields that matter for a snapshot (identity, role, position,
// qualities) from the enriched descriptor entry.
function renderBeingHistorical(container, beingEntry) {
  const dl = document.createElement("div");
  dl.className = "tl-state-grid";

  const rows = [
    ["beingId",    beingEntry.beingId],
    ["coord",      beingEntry.coord],
    ["permissions", beingEntry.permissions],
    ["respondMode", beingEntry.respondMode],
  ];
  for (const [k, v] of rows) {
    if (v == null) continue;
    dl.appendChild(stateRow(k, v));
  }
  if (beingEntry.qualities && Object.keys(beingEntry.qualities).length) {
    dl.appendChild(stateRow("qualities", beingEntry.qualities));
  }
  container.appendChild(dl);
}

// ─── State rendering ────────────────────────────────────────────

function stateRow(key, value) {
  const row = document.createElement("div");
  row.className = "tl-state-row";
  const k = document.createElement("span");
  k.className = "tl-state-key";
  k.textContent = key;
  const v = document.createElement("span");
  v.className = "tl-state-value";
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    v.textContent = value == null ? "(none)" : String(value);
  } else {
    v.textContent = JSON.stringify(value, null, 2);
  }
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

// ─── Summary + formatters ────────────────────────────────────────

function summarizeAct(act) {
  // Prefer endMessage (the act's prose), fall back to first fact's
  // verb:action, fall back to "(see)".
  if (act.endMessage?.content) {
    const c = String(act.endMessage.content);
    return c.length > 160 ? c.slice(0, 157) + "…" : c;
  }
  if (Array.isArray(act.facts) && act.facts.length) {
    const summaries = act.facts
      .slice(0, 3)
      .map((f) => `${f.verb}:${f.act}`)
      .filter(Boolean);
    if (summaries.length) {
      const more = act.facts.length > summaries.length ? ` (+${act.facts.length - summaries.length})` : "";
      return summaries.join(", ") + more;
    }
  }
  return "(see — no acted change)";
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function hint(text) {
  const div = document.createElement("div");
  div.className = "sub";
  div.textContent = text;
  return div;
}
