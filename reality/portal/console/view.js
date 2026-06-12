// TreeOS Portal — the console view.
//
// A stance-anchored verb prompt (PORTAL.md: "the user EMITS into the
// structure, verbing at it directly"). The language IS the old CLI:
// the navigation words are the Linux ones (cd, ls, pwd) because
// spaces ARE the directories — the ONLY new words are the four verbs.
// That's why it's easy to learn: everything you know carries over;
// what's new is exactly what TreeOS adds.
//
//   cd <space|..|~|/|address>          move (spaces are the directories)
//   ls                                 what's here (children/beings/matter)
//   pwd                                where am I (the full address)
//   see [address] [--live]            observe (defaults to here)
//   do [address] <action> [{json}]    act
//   summon <@being> <text>            engage another being
//   be <op> [address] [{json}]        identity ops (connect/release/...)
//   help / clear
//
// Unlike the backtick IBP console (a raw wire inspector inside the 3D
// view), this is a first-class view: address-aware, readable output,
// history, live address chip.

import "../styles/console-view.css";

const HELP_LINES = [
  ["cd <space>", "move into a child space — also: cd .. (parent), cd ~ (home), cd / (root), cd <full address>"],
  ["ls", "list what's at the current position (spaces, beings, matter)"],
  ["pwd", "print the full current address"],
  ["see [address] [--live]", "observe a position (defaults to here)"],
  ["do [address] <action> [{json args}]", "act at a position (address defaults to here)"],
  ["summon <@being> <message>", "engage a being's cognition"],
  ["be <op> [address] [{json}]", "identity: connect / release / switch ..."],
  ["clear", "wipe the scrollback"],
  ["TAB", "complete the current word — child spaces, beings, verbs, ops"],
];

const COMMANDS = ["cd", "ls", "pwd", "see", "do", "summon", "be", "help", "clear"];
const BE_OPS = ["connect", "release", "birth", "switch", "death"];

export function createView() {
  let ctx = null;
  let root = null;
  let els = null;
  const history = [];
  let historyIndex = -1;
  const teardowns = [];
  // id ↔ name, learned from every descriptor we pass through. Lets the
  // user paste a raw spaceId where a name is expected (it resolves to
  // the name behind the scenes) and lets output render names for ids.
  const nameById = new Map();

  // ── Mount ───────────────────────────────────────────────────────

  function mount(rootEl, portalCtx) {
    ctx = portalCtx;
    root = rootEl;
    const wrap = document.createElement("div");
    wrap.id = "console-view";
    wrap.innerHTML = `
      <div id="console-scroll"></div>
      <div id="console-prompt">
        <span class="cv-stance" data-el="stance"></span>
        <span class="cv-caret">&gt;</span>
        <input id="console-input" data-el="input" autocomplete="off" spellcheck="false"
               placeholder="cd · ls · pwd · see · do · summon · be — try “help”" />
      </div>`;
    root.appendChild(wrap);
    els = {
      scroll: wrap.querySelector("#console-scroll"),
      stance: wrap.querySelector("[data-el=stance]"),
      input:  wrap.querySelector("[data-el=input]"),
    };

    els.input.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (ev) => {
      // Click-to-navigate on emitted links.
      const link = ev.target.closest?.(".cv-link");
      if (link?.dataset.address) {
        run(`cd ${link.dataset.address}`);
        return;
      }
      // Click on a being: select it portal-wide (IBPA right stance
      // gains @<being>) and pre-fill a summon at the prompt.
      if (link?.dataset.being) {
        ctx.navigation.selectBeing(link.dataset.beingId || link.dataset.being, link.dataset.being);
        els.input.value = `summon @${link.dataset.being} `;
        els.input.focus();
        return;
      }
      // Clicking anywhere non-interactive focuses the prompt.
      if (!ev.target.closest("a, details, summary, input")) els.input.focus();
    });

    paintStance();
    block(`<div class="cv-help">TreeOS console — four verbs against the current address. Type <span class="cv-verb">help</span> for the language.</div>`);
    els.input.focus();
  }

  function onDescriptor(desc) {
    learnNames(desc || ctx.state.get("descriptor"));
    paintStance();
  }

  // Remember the ids ↔ names visible at this position so a later
  // command can translate either way without a round-trip.
  function learnNames(desc) {
    if (!desc) return;
    for (const c of desc.children || []) {
      if (c.spaceId && c.name) nameById.set(c.spaceId, c.name);
    }
    for (const b of desc.beings || []) {
      const n = b.being || b.name;
      if (b.beingId && n) nameById.set(b.beingId, n);
    }
    for (const mt of desc.matters || []) {
      if (mt.matterId && mt.name) nameById.set(mt.matterId, mt.name);
    }
    const here = desc.address;
    if (here?.spaceId && here?.pathByNames) {
      const leaf = here.pathByNames.split("/").filter(Boolean).pop();
      if (leaf) nameById.set(here.spaceId, leaf);
    }
  }

  function destroy() {
    for (const fn of teardowns.splice(0)) { try { fn(); } catch {} }
    els = null;
    if (root) root.innerHTML = "";
    root = null;
  }

  // ── Prompt ──────────────────────────────────────────────────────

  function paintStance() {
    if (!els) return;
    const m = ctx.state.get();
    const who = m.session?.username || "arrival";
    const branch = m.descriptor?.address?.branch || "0";
    const path = m.descriptor?.address?.pathByNames || "/";
    const reality = m.discovery?.reality || "";
    els.stance.textContent = `${reality}#${branch}${path}@${who}`;
    els.stance.title = "your stance — verbs act from here";
  }

  function onKey(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      completeInput();
      return;
    }
    if (e.key === "Enter") {
      const raw = els.input.value.trim();
      els.input.value = "";
      if (!raw) return;
      history.push(raw);
      historyIndex = history.length;
      run(raw);
      return;
    }
    if (e.key === "ArrowUp") {
      if (historyIndex > 0) {
        historyIndex--;
        els.input.value = history[historyIndex] || "";
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      if (historyIndex < history.length) {
        historyIndex++;
        els.input.value = history[historyIndex] || "";
        e.preventDefault();
      }
    }
  }

  // ── Tab completion ──────────────────────────────────────────────
  //
  // Complete the word under the caret against what's actually here:
  // child space names for `cd`, beings for `summon`/`@`, the verbs
  // themselves at the head, BE ops after `be`. One match fills in and
  // adds a space; several share a prefix as far as it goes, then list.

  function childNames() {
    return (ctx.state.get("descriptor")?.children || [])
      .map((c) => c.name).filter(Boolean);
  }

  function beingTokens() {
    return (ctx.state.get("descriptor")?.beings || [])
      .map((b) => `@${b.being || b.name || ""}`).filter((t) => t.length > 1);
  }

  // Candidates for the token at `idx` (0 = the verb itself).
  function completionCandidates(tokens, idx, partial) {
    if (partial.startsWith("@")) return beingTokens();
    if (idx === 0) return COMMANDS;
    const verb = (tokens[0] || "").toLowerCase();
    switch (verb) {
      case "cd":
        return idx === 1 ? [...childNames(), "..", "~", "/"] : [];
      case "see":
        return idx === 1 ? [...childNames(), ...beingTokens(), "--live"] : ["--live"];
      case "do":
        return idx === 1 ? [...childNames(), ...beingTokens()] : [];
      case "summon":
        return idx === 1 ? beingTokens() : [];
      case "be":
        if (idx === 1) return BE_OPS;
        if (idx === 2) return [...childNames(), ...beingTokens()];
        return [];
      default:
        return [];
    }
  }

  function completeInput() {
    if (!els) return;
    const line = els.input.value;
    // Only complete at the end of the line — mid-line edits stay put.
    if (els.input.selectionStart !== line.length) return;
    const endsWithSpace = line.length > 0 && /\s$/.test(line);
    const tokens = line.split(/\s+/).filter(Boolean);
    const idx = endsWithSpace ? tokens.length : Math.max(0, tokens.length - 1);
    const partial = endsWithSpace ? "" : (tokens[tokens.length - 1] || "");

    const candidates = [...new Set(completionCandidates(tokens, idx, partial))];
    if (!candidates.length) return;
    const lp = partial.toLowerCase();
    const matches = candidates.filter((c) => c.toLowerCase().startsWith(lp));
    if (!matches.length) return;

    if (matches.length === 1) {
      applyCompletion(line, partial, endsWithSpace, matches[0], true);
      return;
    }
    const common = commonPrefix(matches);
    if (common.length > partial.length) {
      applyCompletion(line, partial, endsWithSpace, common, false);
    } else {
      const items = matches
        .map((m) => `<span class="cv-complete-item">${escapeHtml(m)}</span>`)
        .join("");
      block(`<div class="cv-result"><div class="cv-complete">${items}</div></div>`);
    }
  }

  function applyCompletion(line, partial, endsWithSpace, replacement, addSpace) {
    const base = endsWithSpace ? line : line.slice(0, line.length - partial.length);
    els.input.value = base + replacement + (addSpace ? " " : "");
    els.input.focus();
  }

  function commonPrefix(strings) {
    if (!strings.length) return "";
    let p = strings[0];
    for (const s of strings.slice(1)) {
      let i = 0;
      while (i < p.length && i < s.length && p[i].toLowerCase() === s[i].toLowerCase()) i++;
      p = p.slice(0, i);
      if (!p) break;
    }
    return p;
  }

  // ── Output blocks ───────────────────────────────────────────────

  function block(html, { echo = null } = {}) {
    if (!els) return null;
    const div = document.createElement("div");
    div.className = "cv-block";
    div.innerHTML = `${echo ? `<div class="cv-input-echo"><span class="cv-stance">${escapeHtml(shortStance())}</span> &gt; ${escapeHtml(echo)}</div>` : ""}${html}`;
    els.scroll.appendChild(div);
    els.scroll.scrollTop = els.scroll.scrollHeight;
    return div;
  }

  function shortStance() {
    const m = ctx.state.get();
    const branch = m.descriptor?.address?.branch || "0";
    const path = m.descriptor?.address?.pathByNames || "/";
    return `#${branch}${path}`;
  }

  function resultBlock(echo, summaryHtml, data, { error = false } = {}) {
    const raw = data === undefined ? "" :
      `<details><summary>raw</summary><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></details>`;
    block(
      `<div class="cv-result${error ? " err" : ""}"><span class="cv-summary">${summaryHtml}</span>${raw}</div>`,
      { echo },
    );
  }

  // ── The language ────────────────────────────────────────────────

  async function run(raw) {
    const [head, ...rest] = tokenize(raw);
    const verb = (head || "").toLowerCase();
    try {
      switch (verb) {
        case "help":   return showHelp(raw);
        case "clear":  els.scroll.innerHTML = ""; return;
        case "ls":     return runLs(raw);
        case "pwd":    return runPwd(raw);
        case "cd":     return runCd(raw, rest.join(" "));
        case "see":    return runSee(raw, rest);
        case "do":     return runDo(raw, rest);
        case "summon": return runSummon(raw, rest);
        case "be":     return runBe(raw, rest);
        default:
          // A bare address still walks (muscle memory from the stance
          // bar); everything else is unknown.
          if (/[/#@~]/.test(raw)) return runCd(raw, raw);
          resultBlock(raw, `unknown command "${escapeHtml(verb)}" — try help`, undefined, { error: true });
          return;
      }
    } catch (err) {
      resultBlock(raw, escapeHtml(`${err?.code || "error"}: ${err?.message || err}`), err?.detail, { error: true });
    }
  }

  function showHelp(raw) {
    const rows = HELP_LINES
      .map(([cmd, what]) => `<li><span class="cv-verb">${escapeHtml(cmd)}</span> — ${escapeHtml(what)}</li>`)
      .join("");
    block(`<div class="cv-result"><div class="cv-help"><ul class="cv-list">${rows}</ul></div></div>`, { echo: raw });
  }

  // cd — spaces are the directories. Bare names are children of the
  // current space; "..", "~", "/", "." behave exactly like the shell
  // you already know; full addresses (reality#branch/path@being) work
  // too. Plain `cd` goes home, like Linux.
  function resolveCdTarget(input) {
    const target = (input || "").trim();
    const path = ctx.state.get("descriptor")?.address?.pathByNames || "/";
    if (!target || target === "~") return ctx.navigation.resolveAddressInput("/~");
    if (target === ".") return ctx.state.get("currentAddress");
    if (target === "..") {
      const parent = path === "/" ? "/" : (path.replace(/\/[^/]+\/?$/, "") || "/");
      return ctx.navigation.resolveAddressInput(parent);
    }
    // Full or rooted forms pass to the shared resolver.
    if (/^[/~@]/.test(target) || target.includes("#") ||
        target.startsWith(ctx.state.get("discovery")?.reality || " ")) {
      return ctx.navigation.resolveAddressInput(target);
    }
    // Bare name → child of the current space. A raw spaceId pasted
    // here resolves to its name first (ids translate to names behind
    // the scenes), so the walk stays a name-path the server resolves.
    const child = (ctx.state.get("descriptor")?.children || [])
      .find((c) => c.spaceId === target);
    const leaf = child?.name || nameById.get(target) || target;
    const childPath = `${path === "/" ? "" : path}/${leaf}`;
    return ctx.navigation.resolveAddressInput(childPath);
  }

  async function runCd(raw, addressInput) {
    const address = resolveCdTarget(addressInput);
    if (!address) { resultBlock(raw, "cd where?", undefined, { error: true }); return; }
    const desc = await ctx.navigation.navigate(address);
    if (desc) {
      resultBlock(raw, `now at ${escapeHtml(desc.address?.pathByNames || address)}${describeCounts(desc)}`);
    }
  }

  function runPwd(raw) {
    const m = ctx.state.get();
    const reality = m.discovery?.reality || m.descriptor?.address?.place || "";
    const branch = m.descriptor?.address?.branch || "0";
    const path = m.descriptor?.address?.pathByNames || "/";
    resultBlock(raw, escapeHtml(`${reality}#${branch}${path}`));
  }

  async function runLs(raw) {
    const desc = ctx.state.get("descriptor");
    if (!desc) { resultBlock(raw, "nowhere yet — go somewhere first", undefined, { error: true }); return; }
    block(`<div class="cv-result">${renderListing(desc)}</div>`, { echo: raw });
  }

  async function runSee(raw, rest) {
    const live = rest.includes("--live");
    const args = rest.filter((t) => t !== "--live");
    const target = args[0]
      ? ctx.navigation.resolveAddressInput(args[0])
      : ctx.state.get("currentAddress");
    const desc = await ctx.client.see(target, { live });
    const isPosition = !!desc?.address;
    resultBlock(
      raw,
      isPosition
        ? `${escapeHtml(desc.address?.pathByNames || target)}${describeCounts(desc)}`
        : `SEE ${escapeHtml(String(target))} ok`,
      desc,
    );
    if (isPosition) block(`<div class="cv-result">${renderListing(desc)}</div>`);
  }

  async function runDo(raw, rest) {
    if (!rest.length) { resultBlock(raw, "do what? — do [address] &lt;action&gt; [{json}]", undefined, { error: true }); return; }
    // Address is optional: if the first token parses as an action-ish
    // bare word AND a second non-JSON token follows, treat token one
    // as the address. Heuristic: addresses contain / # @ ~ or are ".".
    let i = 0;
    let address = ctx.state.get("currentAddress");
    if (rest.length > 1 && /[/#@~]/.test(rest[0]) && !rest[0].startsWith("{")) {
      address = ctx.navigation.resolveAddressInput(rest[i++]);
    }
    const action = rest[i++];
    if (!action) { resultBlock(raw, "do needs an action", undefined, { error: true }); return; }
    const jsonRaw = rest.slice(i).join(" ");
    const args = jsonRaw ? JSON.parse(jsonRaw) : {};
    const result = await ctx.client.do(address, action, args);
    resultBlock(raw, `${escapeHtml(action)} ok`, result);
  }

  async function runSummon(raw, rest) {
    if (!rest.length) { resultBlock(raw, "summon whom? — summon &lt;@being&gt; &lt;message&gt;", undefined, { error: true }); return; }
    const stance = ctx.navigation.resolveAddressInput(rest[0]);
    // Summoning IS interacting: reflect the target into the IBPA.
    if (rest[0].startsWith("@")) {
      const bn = rest[0].slice(1);
      const entry = (ctx.state.get("descriptor")?.beings || []).find((b) => (b.being || b.name) === bn);
      ctx.navigation.selectBeing(entry?.beingId || bn, bn);
    }
    const content = rest.slice(1).join(" ");
    if (!content) { resultBlock(raw, "say something — summon &lt;@being&gt; &lt;message&gt;", undefined, { error: true }); return; }
    const m = ctx.state.get();
    const reality = m.discovery?.reality || "";
    const branch = m.descriptor?.address?.branch || "0";
    const bq = branch === "0" ? "" : `#${branch}`;
    const from = m.session?.username
      ? `${reality}${bq}/@${m.session.username}`
      : `${reality}${bq}/@arrival`;
    const correlation = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reply = await ctx.client.summon(stance, { from, content, correlation });
    if (reply?.status === "accepted") {
      resultBlock(raw, `summon accepted — the reply lands in your inbox / their activity`, reply);
    } else {
      resultBlock(raw, `replied`, reply);
    }
  }

  async function runBe(raw, rest) {
    if (!rest.length) { resultBlock(raw, "be what? — be &lt;op&gt; [address] [{json}]", undefined, { error: true }); return; }
    const op = rest[0];
    let i = 1;
    let address = ctx.state.get("discovery")?.reality || "";
    if (rest[i] && !rest[i].startsWith("{")) {
      address = ctx.navigation.resolveAddressInput(rest[i++]);
    }
    const jsonRaw = rest.slice(i).join(" ");
    const credentials = jsonRaw ? JSON.parse(jsonRaw) : {};
    if (op === "connect" || op === "birth") {
      // Identity swap rides the context so the session, socket, and
      // every view follow.
      const result = await ctx.client.be(op, address, credentials);
      if (result?.identityToken) {
        await ctx.adoptSession(result, credentials.name);
        resultBlock(raw, `you are now @${escapeHtml(result.name || credentials.name || "?")}`);
        paintStance();
        return;
      }
      resultBlock(raw, `${escapeHtml(op)} ok`, result);
      return;
    }
    if (op === "release") {
      await ctx.signOut();
      resultBlock(raw, "released — you are arrival again");
      paintStance();
      return;
    }
    const result = await ctx.client.be(op, address, credentials);
    resultBlock(raw, `${escapeHtml(op)} ok`, result);
  }

  // ── Rendering helpers ───────────────────────────────────────────

  function describeCounts(desc) {
    const c = (desc.children || []).length;
    const b = (desc.beings || []).length;
    const mt = (desc.matters || []).length;
    return ` — ${c} child${c === 1 ? "" : "ren"}, ${b} being${b === 1 ? "" : "s"}, ${mt} matter`;
  }

  function renderListing(desc) {
    const rows = [];
    const branch = desc.address?.branch || "0";
    const bq = branch === "0" ? "" : `#${branch}`;
    const reality = ctx.state.get("discovery")?.reality || desc.address?.place || "";
    for (const ch of desc.children || []) {
      const addr = ch.path ? `${reality}${bq}${ch.path}` : (ch.address || ch.name);
      rows.push(`<li><span class="cv-kind">space</span><span class="cv-link" data-address="${escapeHtml(String(addr))}">${escapeHtml(ch.name || addr)}</span></li>`);
    }
    for (const b of desc.beings || []) {
      const bn = b.being || b.name || "?";
      // Clicking a being SELECTS it: the IBPA's right stance gains
      // @<being> and the prompt pre-fills a summon at it.
      rows.push(`<li><span class="cv-kind">being</span><span class="cv-link" data-being="${escapeHtml(bn)}" data-being-id="${escapeHtml(String(b.beingId || ""))}">@${escapeHtml(bn)}</span>${b.role ? ` <span class="cv-dim">${escapeHtml(String(b.role))}</span>` : ""}${b.activity ? ` <span class="cv-dim">· ${escapeHtml(String(b.activity).slice(0, 80))}</span>` : ""}</li>`);
    }
    for (const mt of desc.matters || []) {
      const label = mt.name || nameById.get(mt.matterId) || mt.matterId?.slice(0, 8) || "?";
      rows.push(`<li><span class="cv-kind">matter</span><span class="cv-name">${escapeHtml(label)}</span> <span class="cv-dim">${escapeHtml(mt.type || "generic")}</span></li>`);
    }
    if (!rows.length) return `<span class="cv-summary">empty — nothing here yet</span>`;
    return `<ul class="cv-list">${rows.join("")}</ul>`;
  }

  // Tokenizer: whitespace-split, but a `{...}` JSON tail stays one
  // token so `do set-being {"field":"x y"}` survives.
  function tokenize(raw) {
    const braceAt = raw.indexOf("{");
    if (braceAt < 0) return raw.split(/\s+/).filter(Boolean);
    const head = raw.slice(0, braceAt).split(/\s+/).filter(Boolean);
    return [...head, raw.slice(braceAt).trim()];
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
