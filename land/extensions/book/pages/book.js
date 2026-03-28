/* --------------------------------------------------------- */
/* Book pages (renderBookPage, renderSharedBookPage)         */
/* --------------------------------------------------------- */

import mime from "mime-types";
import { getLandUrl } from "../../../canopy/identity.js";
import { page } from "../../html-rendering/html/layout.js";
import { escapeHtml, renderMedia } from "../../html-rendering/html/utils.js";

/* ── Shared helpers ─────────────────────────────── */

function renderBookNode(node, depth, token, version) {
  const level = Math.min(depth, 5);
  const H = `h${level}`;
  const qs = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  let html = `
    <section class="book-section depth-${depth}" id="toc-${node.nodeId}">
      <${H}>${escapeHtml(node.nodeName ?? node.nodeId)}</${H}>
  `;

  for (const note of node.notes) {
    const noteUrl = `/api/v1/node/${node.nodeId}/${note.version}/notes/${note.noteId}${qs}`;

    if (note.type === "text") {
      html += `
        <div class="note-content">
          <a href="${noteUrl}" class="note-link">${escapeHtml(note.content)}</a>
        </div>
      `;
    }

    if (note.type === "file") {
      const fileUrl = `/api/v1/uploads/${note.content}${
        token ? `?token=${encodeURIComponent(token)}` : ""
      }`;
      const mimeType = mime.lookup(note.content) || "";

      html += `
        <div class="file-container">
          <a href="${noteUrl}" class="note-link file-link">${escapeHtml(note.content)}</a>
          ${renderMedia(fileUrl, mimeType)}
        </div>
      `;
    }
  }

  for (const child of node.children) {
    html += renderBookNode(child, depth + 1, token, version);
  }

  html += `</section>`;
  return html;
}

function renderToc(node, maxDepth, depth = 1, isRoot = false) {
  const children = node.children || [];
  const hasChildren = children.length > 0 && (maxDepth === 0 || isRoot || depth < maxDepth);

  const childList = hasChildren
    ? `<ul class="toc-list">${children.map((c) => renderToc(c, maxDepth, isRoot ? 1 : depth + 1, false)).join("")}</ul>`
    : "";

  if (isRoot) return childList;

  const name = escapeHtml(node.nodeName ?? node.nodeId);
  const link = `<a href="javascript:void(0)" onclick="tocScroll('toc-${node.nodeId}')" class="toc-link">${name}</a>`;

  return `<li>${link}${childList}</li>`;
}

function renderTocBlock(book, maxDepth) {
  const inner = renderToc(book, maxDepth, 1, true);
  return `<nav class="book-toc"><div class="toc-title">Table of Contents</div>${inner}</nav>`;
}

function getBookDepth(node, depth = 0) {
  const children = node.children || [];
  if (children.length === 0) return depth;
  return Math.max(...children.map((c) => getBookDepth(c, depth + 1)));
}

const parseBool = (v) => v === "true";

function normalizeStatusFilters(query) {
  const parse = (v) =>
    v === "true" ? true : v === "false" ? false : undefined;

  const filters = {
    active: parse(query.active),
    trimmed: parse(query.trimmed),
    completed: parse(query.completed),
  };

  const hasAny = Object.values(filters).some((v) => v !== undefined);
  return hasAny ? filters : null;
}

/* ── Shared book CSS (used by both pages) ───────── */

const bookContentStyles = `
    /* Layered Glass Sections - Each depth gets more opaque glass */
    .book-section {
      margin-bottom: 40px;
      position: relative;
    }

    .book-section.depth-1 {
      margin-bottom: 48px;
      padding: 24px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    .book-section.depth-2 {
      margin-bottom: 32px;
      margin-left: 8px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }

    .book-section.depth-3 {
      margin-bottom: 24px;
      margin-left: 8px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .book-section.depth-4 {
      margin-bottom: 20px;
      margin-left: 8px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .book-section.depth-5 {
      margin-bottom: 16px;
      margin-left: 8px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    /* Heading Hierarchy */
    h1, h2, h3, h4, h5 {
      font-weight: 600;
      line-height: 1.3;
      margin: 0 0 16px 0;
      color: white;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.5px;
    }

    h1 {
      font-size: 36px;
      margin-top: 48px;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid rgba(255, 255, 255, 0.3);
    }

    .book-section.depth-1:first-child h1 {
      margin-top: 0;
    }

    h2 {
      font-size: 30px;
      margin-top: 40px;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    h3 {
      font-size: 24px;
      margin-top: 32px;
      margin-bottom: 16px;
    }

    h4 {
      font-size: 20px;
      margin-top: 24px;
      margin-bottom: 12px;
    }

    h5 {
      font-size: 18px;
      margin-top: 20px;
      margin-bottom: 10px;
    }

    /* File Containers - Deeper Glass */
    .file-container {
      margin: 24px 0;
      padding: 20px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(18px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 12px;
      transition: all 0.3s;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    }

    .file-container:hover {
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
      background: rgba(255, 255, 255, 0.2);
    }

    .file-container .note-link {
      display: inline-block;
      margin-bottom: 12px;
      color: white;
      font-size: 16px;
      font-weight: 600;
      padding: 4px 8px;
      margin: -4px -8px 8px;
    }

    .file-container .note-link:hover {
      background-color: rgba(255, 255, 255, 0.15);
      text-decoration: underline;
    }

    /* Media Elements */
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin-top: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    video, audio {
      max-width: 100%;
      margin-top: 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    iframe {
      width: 100%;
      height: 600px;
      border: none;
      border-radius: 8px;
      margin-top: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 80px 40px;
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
    }

    .empty-state-text {
      font-size: 24px;
      color: white;
      margin-bottom: 8px;
      font-weight: 600;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .empty-state-subtext {
      font-size: 16px;
      color: rgba(255, 255, 255, 0.8);
    }
`;

const bookNavStyles = `
    /* Top Navigation Bar - Glass */
    .top-nav {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 10px 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border-bottom: 1px solid rgba(255, 255, 255, 0.28);
      position: sticky;
      top: 0;
      z-index: 100;
      animation: fadeInUp 0.5s ease-out;
    }

    .top-nav-content {
      max-width: 900px;
      margin: 0 auto;
    }

    .page-title {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }
`;

const bookFilterStyles = `
    /* Glass Filter Buttons */
    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-button {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      transition: all 0.3s;
      font-family: inherit;
      white-space: nowrap;
      position: relative;
      overflow: hidden;
    }

    .filter-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .filter-button:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-1px);
    }

    .filter-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .filter-button.active {
      background: rgba(255, 255, 255, 0.35);
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }

    .filter-button.active:hover {
      background: rgba(255, 255, 255, 0.45);
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(0, 0, 0, 0.2);
    }

    .toc-select {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      font-family: inherit;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='white' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 30px;
    }

    .toc-select option {
      background: #5a56c4;
      color: white;
    }
`;

const bookTocStyles = `
    html { scroll-behavior: smooth; }

    .book-toc {
      max-width: 900px;
      margin: 20px auto 24px;
      padding: 20px 28px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border: 1px solid rgba(255, 255, 255, 0.28);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .toc-title {
      font-size: 18px;
      font-weight: 700;
      color: white;
      margin-bottom: 10px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .toc-list {
      list-style: none;
      padding-left: 18px;
      margin: 0;
    }

    .book-toc > .toc-list {
      padding-left: 0;
    }

    .book-toc li {
      margin: 2px 0;
    }

    .toc-link {
      display: inline-block;
      color: white;
      text-decoration: none;
      padding: 3px 0;
      font-size: 15px;
      font-weight: 500;
      transition: opacity 0.2s;
    }

    .toc-link:hover {
      opacity: 0.7;
      text-decoration: underline;
    }

    .book-toc > .toc-list > li > .toc-link {
      font-weight: 700;
      font-size: 16px;
    }
`;

const bookLazyScript = `
    const lazyObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          const el = entry.target;
          const src = el.dataset.src;

          if (src) {
            el.src = src;
            el.removeAttribute("data-src");
          }

          observer.unobserve(el);
        });
      },
      { rootMargin: "200px" }
    );

    document
      .querySelectorAll(".lazy-media[data-src]")
      .forEach(el => lazyObserver.observe(el));
`;

const bookToggleScript = `
    function toggleFlag(flag) {
      const url = new URL(window.location.href);

      if (url.searchParams.has(flag)) {
        url.searchParams.delete(flag);
      } else {
        url.searchParams.set(flag, "true");
      }

      url.searchParams.set("html", "true");
      window.location.href = url.toString();
    }

    function toggleStatus(flag) {
      const url = new URL(window.location.href);
      const params = url.searchParams;

      const defaults = {
        active: true,
        completed: true,
        trimmed: false,
      };

      const current = params.has(flag)
        ? params.get(flag) === "true"
        : defaults[flag];

      const next = !current;

      if (next === defaults[flag]) {
        params.delete(flag);
      } else {
        params.set(flag, String(next));
      }

      params.set("html", "true");
      window.location.href = url.toString();
    }

    async function generateShare() {
      const params = Object.fromEntries(new URLSearchParams(window.location.search));
      const res = await fetch(window.location.pathname + "/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      const redirect = data.redirect || data.data?.redirect;
      if (redirect) {
        window.location.href = redirect;
      }
    }

    function setTocDepth(val) {
      const url = new URL(window.location.href);
      if (val === "0") {
        url.searchParams.delete("tocDepth");
      } else {
        url.searchParams.set("tocDepth", val);
      }
      url.searchParams.set("html", "true");
      window.location.href = url.toString();
    }
`;

/* ── Exported render functions ──────────────────── */

export function renderBookPage({
  nodeId,
  token,
  title,
  content,
  options,
  tocEnabled,
  tocDepth,
  isStatusActive,
  isStatusCompleted,
  isStatusTrimmed,
  book,
  hasContent,
}) {
  const treeDepth = hasContent ? Math.min(getBookDepth(book), 5) : 0;

  let tocDepthSelect = "";
  if (tocEnabled && hasContent && treeDepth > 1) {
    let opts = `<option value="0" ${tocDepth === 0 ? "selected" : ""}>All Depths</option>`;
    for (let i = 1; i <= treeDepth; i++) {
      opts += `<option value="${i}" ${tocDepth === i ? "selected" : ""}>Depth ${i}${i === 5 ? " (max)" : ""}</option>`;
    }
    tocDepthSelect = `<select class="toc-select" onchange="setTocDepth(this.value)">${opts}</select>`;
  }

  const bookContent = hasContent
    ? renderBookNode(book, 1, token)
    : `
    <div class="empty-state">
      <div class="empty-state-icon">\ud83d\udcd6</div>
      <div class="empty-state-text">No content</div>
      <div class="empty-state-subtext">
        This node has no notes or child notes under the current filters.
      </div>
    </div>
  `;

  const css = `
    /* ── Book page overrides on base ── */
    body { padding: 0; }

${bookNavStyles}

    .nav-buttons {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }

    .nav-left {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Glass Navigation Buttons */
    .nav-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      position: relative;
      overflow: hidden;
      cursor: pointer;
      touch-action: manipulation;
    }

    .nav-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .nav-button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .nav-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

${bookFilterStyles}

    /* Content Container */
    .content-wrapper {
      padding: 24px 20px;
    }

    .content {
      max-width: 900px;
      margin: 0 auto;
      font-family: "Charter", "Georgia", "Iowan Old Style", "Times New Roman", serif;
      line-height: 1.7;
      word-wrap: break-word;
      overflow-wrap: break-word;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

${bookContentStyles}

    /* Note Content - Glowing Text */
    .note-content {
      margin: 16px 0 28px 0;
      padding: 0;
      font-size: 18px;
      line-height: 1.8;
      color: white;
      word-wrap: break-word;
      overflow-wrap: break-word;
      font-weight: 400;
    }

    .note-link {
      color: inherit;
      text-decoration: none;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      display: block;
      padding: 12px 16px;
      margin: -12px -16px;
      border-radius: 8px;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }

    .note-link::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        110deg,
        transparent 40%,
        rgba(255, 255, 255, 0.2),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      pointer-events: none;
    }

    .note-link:hover {
      background-color: rgba(255, 255, 255, 0.1);
      transform: translateX(4px);
    }

    .note-link:hover::before {
      opacity: 1;
      animation: glassShimmer 1s ease forwards;
    }

    @keyframes glassShimmer {
      0% {
        opacity: 0;
        transform: translateX(-120%) skewX(-15deg);
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translateX(120%) skewX(-15deg);
      }
    }

    .note-link:active {
      background-color: rgba(255, 255, 255, 0.15);
    }

    /* Responsive Design */
    @media (max-width: 1024px) {
    }

    @media (max-width: 768px) {
      .top-nav {
        padding: 12px 16px;
      }

      .nav-button {
        padding: 8px 12px;
        font-size: 13px;
      }

      .page-title {
        font-size: 18px;
      }

      .filter-button {
        padding: 6px 12px;
        font-size: 12px;
      }

      .content-wrapper {
        padding: 24px 16px;
      }

      h1 {
        font-size: 30px;
      }

      h2 {
        font-size: 26px;
      }

      h3 {
        font-size: 22px;
      }

      h4 {
        font-size: 19px;
      }

      h5 {
        font-size: 17px;
      }

      .note-content {
        font-size: 17px;
      }

      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 4px;
      }
    }

    @media (max-width: 480px) {
      .nav-buttons {
        flex-direction: column;
        align-items: stretch;
      }

      .nav-left {
        width: 100%;
        flex-direction: column;
      }

      .nav-button {
        justify-content: center;
        width: 100%;
      }

      .book-section.depth-1,
      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 0;
        padding: 12px;
      }
    }

${bookTocStyles}
  `;

  const body = `
  <!-- Top Navigation -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-buttons">
        <div class="nav-left">
          <a href="/api/v1/root/${nodeId}?token=${encodeURIComponent(token ?? "")}&html" class="nav-button">
            \u2190 Back to Tree
          </a>

        </div>
        <button class="nav-button" onclick="generateShare()">
          \ud83d\udd17 Generate Share Link
        </button>
      </div>

<div class="page-title">Book: ${escapeHtml(title)}</div>

      <!-- Filters -->
      <div class="filters">
        <button onclick="toggleFlag('latestVersionOnly')" class="filter-button ${
          options.latestVersionOnly ? "active" : ""
        }">
          Latest Versions Only
        </button>
        <button onclick="toggleFlag('lastNoteOnly')" class="filter-button ${
          options.lastNoteOnly ? "active" : ""
        }">
          Most Recent Note
        </button>
        <button onclick="toggleFlag('leafNotesOnly')" class="filter-button ${
          options.leafNotesOnly ? "active" : ""
        }">
          Leaf Details Only
        </button>
        <button onclick="toggleFlag('filesOnly')" class="filter-button ${
          options.filesOnly ? "active" : ""
        }">
          Files Only
        </button>
        <button onclick="toggleFlag('textOnly')" class="filter-button ${
          options.textOnly ? "active" : ""
        }">
          Text Only
        </button>
        <button onclick="toggleStatus('active')" class="filter-button ${
          isStatusActive ? "active" : ""
        }">
          Active
        </button>
        <button onclick="toggleStatus('completed')" class="filter-button ${
          isStatusCompleted ? "active" : ""
        }">
          Completed
        </button>
        <button onclick="toggleStatus('trimmed')" class="filter-button ${
          isStatusTrimmed ? "active" : ""
        }">
          Trimmed
        </button>
        <button onclick="toggleFlag('toc')" class="filter-button ${
          tocEnabled ? "active" : ""
        }">
          Table of Contents
        </button>
        ${tocDepthSelect}
      </div>
    </div>
  </div>

  <!-- Content -->
  <div class="content-wrapper">
    ${tocEnabled && hasContent ? renderTocBlock(book, tocDepth) : ""}
    <div class="content">
      ${bookContent}
    </div>
  </div>
  `;

  const js = `
    function tocScroll(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var nav = document.querySelector('.top-nav');
      var offset = nav ? nav.offsetHeight + 12 : 12;
      var top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }

${bookLazyScript}

${bookToggleScript}
  `;

  return page({
    title: `Book: ${escapeHtml(title)}`,
    css,
    body,
    js,
  });
}

export function renderSharedBookPage({
  nodeId,
  title,
  content,
  shareTocEnabled,
  shareTocDepth,
  book,
  hasContent,
}) {
  const css = `
    /* ── Shared book page overrides on base ── */
    body { padding: 0; }

${bookNavStyles}

    .nav-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: nowrap;
    }

    /* Glass Navigation Buttons */
    .nav-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 10px;
      flex: 1;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.3);
      position: relative;
      overflow: hidden;
      cursor: pointer;
      touch-action: manipulation;
    }

    .nav-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .nav-button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .nav-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

${bookFilterStyles}

    /* Content Container */
    .content-wrapper {
      padding: 24px 20px;
    }

    .content {
      max-width: 900px;
      margin: 0 auto;
      font-family: "Charter", "Georgia", "Iowan Old Style", "Times New Roman", serif;
      line-height: 1.7;
      word-wrap: break-word;
      overflow-wrap: break-word;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

${bookContentStyles}

    /* Note Content - Glowing Text */
    .note-content {
      margin: 16px 0 28px 0;
      padding: 0;
      font-size: 18px;
      line-height: 1.8;
      color: #F5F5DC;
      word-wrap: break-word;
      overflow-wrap: break-word;
      font-weight: 400;
    }

    .note-link {
      color: inherit;
      text-decoration: none;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      display: block;
      padding: 12px 16px;
      margin: -12px -16px;
      border-radius: 8px;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }

    .note-link::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        110deg,
        transparent 40%,
        rgba(255, 255, 255, 0.2),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      pointer-events: none;
    }

    .note-link:hover {
      background-color: rgba(255, 255, 255, 0.1);
      transform: translateX(4px);
    }

    .note-link:hover::before {
      opacity: 1;
      animation: glassShimmer 1s ease forwards;
    }

    @keyframes glassShimmer {
      0% {
        opacity: 0;
        transform: translateX(-120%) skewX(-15deg);
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translateX(120%) skewX(-15deg);
      }
    }

    .note-link:active {
      background-color: rgba(255, 255, 255, 0.15);
    }

    /* Responsive Design */
    @media (max-width: 1024px) {
    }

    @media (max-width: 768px) {
      .top-nav {
        padding: 12px 16px;
      }

      .nav-button {
        padding: 8px 12px;
        font-size: 13px;
      }

      .page-title {
        font-size: 18px;
      }

      .filter-button {
        padding: 6px 12px;
        font-size: 12px;
      }

      .content-wrapper {
        padding: 24px 16px;
      }

      h1 {
        font-size: 30px;
      }

      h2 {
        font-size: 26px;
      }

      h3 {
        font-size: 22px;
      }

      h4 {
        font-size: 19px;
      }

      h5 {
        font-size: 17px;
      }

      .note-content {
        font-size: 17px;
      }

      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 4px;
      }
    }

    @media (max-width: 480px) {
      .nav-button {
        padding: 8px 6px;
        font-size: 11px;
        gap: 2px;
      }

      .book-section.depth-1,
      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 0;
        padding: 12px;
      }
    }

${bookTocStyles}

    .share-book-title {
      max-width: 900px;
      margin: 24px auto 0;
      font-size: 28px;
      font-weight: 700;
      color: white;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
      text-align: center;
    }

    /* Title toggle active state */
    .nav-button.active {
      background: rgba(255, 255, 255, 0.4);
      border-color: rgba(255, 255, 255, 0.5);
    }

    /* Hide titles mode */
    #bookContent.hide-titles h1,
    #bookContent.hide-titles h2,
    #bookContent.hide-titles h3,
    #bookContent.hide-titles h4,
    #bookContent.hide-titles h5 {
      display: none;
    }

    /* TOC scroll-to-top circle */
    .toc-top-btn {
      position: fixed;
      top: 60px;
      right: 16px;
      z-index: 200;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(var(--glass-water-rgb), 0.5);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      color: white;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s, transform 0.3s;
      touch-action: manipulation;
    }

    .toc-top-btn.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .toc-top-btn:hover {
      background: rgba(var(--glass-water-rgb), 0.7);
      transform: scale(1.1);
    }
  `;

  const body = `
  <!-- Share Nav -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-buttons">
        <a href="/" class="nav-button" onclick="event.preventDefault();window.top.location.href='/';">Home</a>
        <button class="nav-button" id="copyUrlBtn">Copy URL</button>
        <button class="nav-button" id="copyTextBtn">Copy Text</button>
        <button class="nav-button" id="toggleTitlesBtn" onclick="toggleTitles()" title="Toggle Titles">Aa</button>
      </div>
    </div>
  </div>

  ${shareTocEnabled && hasContent ? `<button class="toc-top-btn" id="tocTopBtn" onclick="window.scrollTo({top:0,behavior:'smooth'})">&#9650;</button>` : ""}

  <!-- Content -->
  <div class="content-wrapper">
    ${shareTocEnabled && hasContent ? `<div class="share-book-title">${escapeHtml(title)}</div>${renderTocBlock(book, shareTocDepth)}` : ""}
    <div class="content" id="bookContent">
      ${content}
    </div>
  </div>
  `;

  const js = `
    function tocScroll(id) {
      var el = document.getElementById(id);
      if (!el) return;
      var nav = document.querySelector('.top-nav');
      var offset = nav ? nav.offsetHeight + 12 : 12;
      var top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: top, behavior: 'smooth' });
    }

    function toggleTitles() {
      var bc = document.getElementById('bookContent');
      var btn = document.getElementById('toggleTitlesBtn');
      bc.classList.toggle('hide-titles');
      if (bc.classList.contains('hide-titles')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }

    ${shareTocEnabled && hasContent ? `
    (function() {
      var tocBtn = document.getElementById('tocTopBtn');
      if (!tocBtn) return;
      window.addEventListener('scroll', function() {
        if (window.scrollY > 200) {
          tocBtn.classList.add('visible');
        } else {
          tocBtn.classList.remove('visible');
        }
      }, { passive: true });
    })();
    ` : ""}

    document.getElementById("copyUrlBtn").addEventListener("click", function() {
      var url = new URL(window.location.href);
      url.searchParams.delete("token");
      if (!url.searchParams.has("html")) url.searchParams.set("html", "");
      navigator.clipboard.writeText(url.toString()).then(function() {
        this.textContent = "Copied";
        setTimeout(function() { document.getElementById("copyUrlBtn").textContent = "Copy URL"; }, 900);
      }.bind(this));
    });

    document.getElementById("copyTextBtn").addEventListener("click", function() {
      var text = document.getElementById("bookContent").innerText;
      navigator.clipboard.writeText(text).then(function() {
        document.getElementById("copyTextBtn").textContent = "Copied";
        setTimeout(function() { document.getElementById("copyTextBtn").textContent = "Copy Text"; }, 900);
      });
    });

${bookLazyScript}

${bookToggleScript}
  `;

  return page({
    title: `Book: ${escapeHtml(title)} - TreeOS`,
    css,
    body,
    js,
  });
}

export { parseBool, normalizeStatusFilters, renderBookNode };
