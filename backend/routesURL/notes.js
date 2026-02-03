import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import mime from "mime-types";
import Book from "../db/models/book.js";

import {
  createNote as coreCreateNote,
  getNotes as coreGetNotes,
  deleteNoteAndFile as coreDeleteNoteAndFile,
  getBook as coreGetBook,
  generateBook as coreGenerateBook,
} from "../core/notes.js";

import urlAuth from "../middleware/urlAuth.js";
import getNodeName from "./helpers/getNameById.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

const uploadsFolder = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsFolder),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2);
    cb(null, name + ext);
  },
});

const upload = multer({ storage });

function renderMedia(fileUrl, mimeType) {
  // ---------- IMAGES ----------
  if (mimeType.startsWith("image/")) {
    return `
      <img
        data-src="${fileUrl}"
        loading="lazy"
        style="max-width:100%;"
        class="lazy-media"
        alt=""
      />
    `;
  }

  // ---------- VIDEO ----------
  if (mimeType.startsWith("video/")) {
    return `
      <video
        controls
        preload="none"
        data-src="${fileUrl}"
        class="lazy-media"
        style="max-width:100%;"
      ></video>
    `;
  }

  // ---------- AUDIO ----------
  if (mimeType.startsWith("audio/")) {
    return `
      <audio
        controls
        preload="none"
        data-src="${fileUrl}"
        class="lazy-media"
      ></audio>
    `;
  }

  // ---------- PDF ----------
  if (mimeType === "application/pdf") {
    return `
      <iframe
        data-src="${fileUrl}"
        loading="lazy"
        class="lazy-media"
        style="width:100%; height:90vh; border:none;"
      ></iframe>
    `;
  }

  return ``;
}
function renderMediaImmediate(fileUrl, mimeType) {
  if (mimeType.startsWith("image/")) {
    return `<img src="${fileUrl}" style="max-width:100%;" />`;
  }

  if (mimeType.startsWith("video/")) {
    return `<video src="${fileUrl}" controls style="max-width:100%;"></video>`;
  }

  if (mimeType.startsWith("audio/")) {
    return `<audio src="${fileUrl}" controls></audio>`;
  }

  if (mimeType === "application/pdf") {
    return `
      <iframe src="${fileUrl}" style="width:100%; height:90vh; border:none;"></iframe>
    `;
  }

  return ``;
}
function renderBookNode(node, depth, req, version) {
  const level = Math.min(depth, 5);
  const H = `h${level}`;
  const token = req.query.token ?? "";

  let html = `
    <section class="book-section depth-${depth}">
      <${H}>${node.nodeName ?? node.nodeId}</${H}>
  `;

  for (const note of node.notes) {
    const noteUrl = `/api/${node.nodeId}/${note.version}/notes/${note.noteId}?token=${token}&html`;

    if (note.type === "text") {
      html += `
        <div class="note-content">
          <a href="${noteUrl}" class="note-link">${note.content}</a>
        </div>
      `;
    }

    if (note.type === "file") {
      const fileUrl = `/api/uploads/${note.content}${
        token ? `?token=${token}` : ""
      }`;
      const mimeType = mime.lookup(note.content) || "";

      html += `
        <div class="file-container">
          <a href="${noteUrl}" class="note-link file-link">${note.content}</a>
          ${renderMedia(fileUrl, mimeType)}
        </div>
      `;
    }
  }

  for (const child of node.children) {
    html += renderBookNode(child, depth + 1, req, version);
  }

  html += `</section>`;
  return html;
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

  // 👇 THIS IS KEY
  return hasAny ? filters : null;
}

router.get("/root/:nodeId/book", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const options = {
      latestVersionOnly: parseBool(req.query.latestVersionOnly),
      lastNoteOnly: parseBool(req.query.lastNoteOnly),
      leafNotesOnly: parseBool(req.query.leafNotesOnly),
      filesOnly: parseBool(req.query.filesOnly),
      textOnly: parseBool(req.query.textOnly),
      statusFilters: normalizeStatusFilters(req.query),
    };

    const wantHtml = req.query.html !== undefined;

    const { book } = await coreGetBook({ nodeId, options });

    const hasContent =
      !!book && (book.notes?.length > 0 || book.children?.length > 0);
    const q = req.query;

    // default ON if missing
    const isStatusActive = q.active === undefined ? true : q.active === "true";

    const isStatusCompleted =
      q.completed === undefined ? true : q.completed === "true";

    // default OFF
    const isStatusTrimmed = q.trimmed === "true";
    // ---------- HTML MODE ----------

    if (wantHtml) {
      const title = book?.nodeName ?? book?.nodeId ?? `Node ${nodeId}`;
      const content = hasContent
        ? renderBookNode(book, 1, req)
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📖</div>
      <div class="empty-state-text">No content</div>
      <div class="empty-state-subtext">
        This node has no notes or child notes under the current filters.
      </div>
    </div>
  `;

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Book: ${title}</title>
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
      touch-action: manipulation;
    }

    /* Animated background */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }

    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }
 html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }
    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Top Navigation Bar - Glass */
    .top-nav {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 16px 20px;
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

    .nav-buttons {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .nav-left {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* Glass Navigation Buttons */
    .nav-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
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

    .page-title {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

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

    /* Content Container */
    .content-wrapper {
      padding: 32px 20px;
    }

    .content {
      max-width: 900px;
      margin: 0 auto;
      background: rgba(var(--glass-water-rgb), 0.25);
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 48px 64px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      font-family: "Charter", "Georgia", "Iowan Old Style", "Times New Roman", serif;
      line-height: 1.7;
      word-wrap: break-word;
      overflow-wrap: break-word;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* Layered Glass Sections - Each depth gets more opaque glass */
    .book-section {
      margin-bottom: 40px;
      position: relative;
    }

    .book-section.depth-1 {
      margin-bottom: 56px;
      margin-left: 0;
      padding: 24px;
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    .book-section.depth-2 {
      margin-bottom: 40px;
      margin-left: 16px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(14px);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 3px 16px rgba(0, 0, 0, 0.06);
    }

    .book-section.depth-3 {
      margin-bottom: 32px;
      margin-left: 32px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(16px);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
    }

    .book-section.depth-4 {
      margin-bottom: 24px;
      margin-left: 48px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(18px);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .book-section.depth-5 {
      margin-bottom: 20px;
      margin-left: 64px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.24);
      backdrop-filter: blur(20px);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.35);
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

    /* Responsive Design */
    @media (max-width: 1024px) {
      .content {
        padding: 40px 48px;
      }
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

      .content {
        padding: 32px 24px;
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

      .book-section.depth-2 {
        margin-left: 8px;
      }

      .book-section.depth-3 {
        margin-left: 16px;
      }

      .book-section.depth-4 {
        margin-left: 24px;
      }

      .book-section.depth-5 {
        margin-left: 32px;
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

      .content {
        padding: 24px 16px;
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
  </style>
</head>
<body>
  <!-- Top Navigation -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-buttons">
        <div class="nav-left">
          <a href="/api/root/${nodeId}?token=${
            req.query.token ?? ""
          }&html" class="nav-button">
            ← Back to Tree
          </a>
         
        </div>
        <button class="nav-button" onclick="generateShare()">
          🔗 Generate Share Link
        </button>
      </div>

      <div class="page-title">Book: ${title}</div>

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
      </div>
    </div>
  </div>

  <!-- Content -->
  <div class="content-wrapper">
    <div class="content">
      ${content}
    </div>
  </div>

  <!-- Lazy Media Loader -->
  <script>
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
  </script>

  <script>
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
      const res = await fetch(
        window.location.pathname + "/generate" + window.location.search,
        { method: "POST" }
      );

      const data = await res.json();
      if (data.redirect) {
        window.location.href = data.redirect;
      }
    }
  </script>

</body>
</html>
  `);
    }

    return res.json({
      success: true,
      book,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});
router.post("/root/:nodeId/book/generate", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;

    // 🔁 SAME parsing logic as GET
    const settings = {
      latestVersionOnly: parseBool(req.query.latestVersionOnly),
      lastNoteOnly: parseBool(req.query.lastNoteOnly),
      leafNotesOnly: parseBool(req.query.leafNotesOnly),
      filesOnly: parseBool(req.query.filesOnly),
      textOnly: parseBool(req.query.textOnly),

      active:
        req.query.active === undefined ? true : req.query.active === "true",

      completed:
        req.query.completed === undefined
          ? true
          : req.query.completed === "true",

      true: parseBool(req.query.true),
    };

    const { shareId } = await coreGenerateBook({
      nodeId,
      settings,
      userId: req.user?._id,
    });

    // ✅ Redirect to shared URL (same base format)
    return res.json({
      success: true,
      redirect: `/api/root/${nodeId}/book/share/${shareId}?html`,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

router.get("/root/:nodeId/book/share/:shareId", async (req, res) => {
  try {
    const { nodeId, shareId } = req.params;
    const wantHtml = req.query.html !== undefined;

    // 1. Load book from DB
    const bookRecord = await Book.findOne({ shareId }).lean();
    if (!bookRecord) {
      return res.status(404).send("Book not found");
    }

    // Optional safety check
    if (bookRecord.nodeId !== nodeId) {
      return res.status(400).send("Invalid book link");
    }

    // 2. Build options FROM DB SETTINGS (NOT QUERY)
    const options = {
      latestVersionOnly: bookRecord.settings.latestVersionOnly,
      lastNoteOnly: bookRecord.settings.lastNoteOnly,
      leafNotesOnly: bookRecord.settings.leafNotesOnly,
      filesOnly: bookRecord.settings.filesOnly,
      textOnly: bookRecord.settings.textOnly,

      statusFilters: bookRecord.settings,
    };

    const { book } = await coreGetBook({ nodeId, options });

    const hasContent =
      !!book && (book.notes?.length > 0 || book.children?.length > 0);
    const q = req.query;

    if (wantHtml) {
      const title = book?.nodeName ?? book?.nodeId ?? `Node ${nodeId}`;
      const content = hasContent
        ? renderBookNode(book, 1, req)
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📖</div>
      <div class="empty-state-text">No content</div>
      <div class="empty-state-subtext">
        This node has no notes or child notes under the current filters.
      </div>
    </div>
  `;

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Book: ${title}</title>
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
      touch-action: manipulation;
    }

    /* Animated background */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }
       html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }

    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Top Navigation Bar - Glass */
    .top-nav {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      padding: 16px 20px;
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

    .nav-buttons {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .nav-left {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* Glass Navigation Buttons */
    .nav-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
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

    .page-title {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 12px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

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

    /* Content Container */
    .content-wrapper {
      padding: 32px 20px;
    }

    .content {
      max-width: 900px;
      margin: 0 auto;
      background: rgba(var(--glass-water-rgb), 0.25);
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 48px 64px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      font-family: "Charter", "Georgia", "Iowan Old Style", "Times New Roman", serif;
      line-height: 1.7;
      word-wrap: break-word;
      overflow-wrap: break-word;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* Layered Glass Sections - Each depth gets more opaque glass */
    .book-section {
      margin-bottom: 40px;
      position: relative;
    }

    .book-section.depth-1 {
      margin-bottom: 56px;
      margin-left: 0;
      padding: 24px;
      background: rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(12px);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    .book-section.depth-2 {
      margin-bottom: 40px;
      margin-left: 16px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(14px);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: 0 3px 16px rgba(0, 0, 0, 0.06);
    }

    .book-section.depth-3 {
      margin-bottom: 32px;
      margin-left: 32px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.16);
      backdrop-filter: blur(16px);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
    }

    .book-section.depth-4 {
      margin-bottom: 24px;
      margin-left: 48px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(18px);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .book-section.depth-5 {
      margin-bottom: 20px;
      margin-left: 64px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.24);
      backdrop-filter: blur(20px);
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.35);
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

    /* Responsive Design */
    @media (max-width: 1024px) {
      .content {
        padding: 40px 48px;
      }
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

      .content {
        padding: 32px 24px;
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

      .book-section.depth-2 {
        margin-left: 8px;
      }

      .book-section.depth-3 {
        margin-left: 16px;
      }

      .book-section.depth-4 {
        margin-left: 24px;
      }

      .book-section.depth-5 {
        margin-left: 32px;
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

      .content {
        padding: 24px 16px;
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
  </style>
</head>
<body>



      

  <!-- Content -->
  <div class="content-wrapper">
    <div class="content">
      ${content}
    </div>
  </div>

  <!-- Lazy Media Loader -->
  <script>
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
  </script>

  <script>
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
      const res = await fetch(
        window.location.pathname + "/generate" + window.location.search,
        { method: "POST" }
      );

      const data = await res.json();
      if (data.redirect) {
        window.location.href = data.redirect;
      }
    }
  </script>

</body>
</html>
  `);
    }

    return res.json({
      success: true,
      book,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

/* ------------------------------------------------------------------
   GET /:nodeId/:version/notes 
   - JSON (default)
   - HTML (when ?html is used)
------------------------------------------------------------------- */
router.get("/:nodeId/:version/notes", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const rawLimit = req.query.limit;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const result = await coreGetNotes({
      nodeId,
      version: Number(version),
      limit,
      startDate,
      endDate,
    });

    const notes = [...result.notes].reverse().map((n) => ({
      ...n,
      content:
        n.contentType === "file" ? `/api/uploads/${n.content}` : n.content,
    }));

    // ---------- OPTIONAL HTML MODE ----------
    if (req.query.html !== undefined) {
      const base = `/api/${nodeId}/${version}`;

      const nodeName = await getNodeName(nodeId);

      // Check if we have the current user's ID (from cookie/session)
      const currentUserId = req.userId ? req.userId.toString() : null;

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${nodeName} — Notes</title>
  <style>
    /* Replace the <style> content in your /:nodeId/:version/notes route with this */

:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  color: #1a1a1a;
  overflow: hidden;
  position: relative;
  touch-action: manipulation;
}

/* Animated background */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

/* Glass Top Navigation */
.top-nav {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 16px 20px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border-bottom: 1px solid rgba(255, 255, 255, 0.28);
  flex-shrink: 0;
}

.top-nav-content {
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.nav-left {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

/* Glass Navigation Buttons */
.nav-button,
.book-button {
  position: relative;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 980px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.2px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  cursor: pointer;
  transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
  white-space: nowrap;
}

.nav-button::before,
.book-button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.nav-button:hover,
.book-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.nav-button:hover::before,
.book-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

.book-button {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

.page-title {
  width: 100%;
  margin-top: 12px;
  font-size: 18px;
  font-weight: 600;
  color: white;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.page-title a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.page-title a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}

/* Notes Container */
.notes-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  position: relative;
  z-index: 1;
}

.notes-wrapper {
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}

.notes-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Glass Note Messages */
.note-item {
  display: flex;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.note-item.self {
  flex-direction: row-reverse;
}

.note-bubble {
  position: relative;
  max-width: 70%;
  padding: 14px 18px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  color: white;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Self messages - slightly more opaque */
.note-item.self .note-bubble {
  background: rgba(255, 255, 255, 0.2);
}

/* Reflection messages - golden tint */
.note-item.reflection .note-bubble {
  background: rgba(255, 215, 79, 0.25);
  border-color: rgba(255, 215, 79, 0.4);
  box-shadow: 0 4px 16px rgba(255, 193, 7, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.file-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.note-author {
  font-weight: 600;
  margin-bottom: 6px;
  font-size: 13px;
  opacity: 0.85;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  letter-spacing: -0.2px;
}

.note-author a {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
}

.note-author a:hover {
  border-bottom-color: white;
}

.note-item.self .note-author {
  display: none;
}

.note-content {
  font-size: 15px;
  line-height: 1.5;
  margin-bottom: 6px;
  font-weight: 400;
}

.note-content a {
  color: inherit;
  text-decoration: none;
}

.note-content a:hover {
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
}

.note-meta {
  font-size: 11px;
  opacity: 0.7;
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.delete-button {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  opacity: 0.7;
  transition: all 0.2s;
  font-size: 12px;
  color: white;
}

.delete-button:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
  transform: scale(1.1);
}

/* Glass Input Bar */
.input-bar {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  padding: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  flex-shrink: 0;
}

.input-form {
  max-width: 900px;
  margin: 0 auto;
}

textarea {
  width: 100%;
  padding: 14px 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
  resize: none;
  transition: all 0.3s;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  color: white;
  font-weight: 500;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  height: 56px;
  max-height: 120px;
  overflow-y: hidden;
}

textarea::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

textarea:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.15),
    0 8px 30px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
}

.input-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.input-options {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

input[type="file"] {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
}

input[type="file"]::file-selector-button {
  padding: 8px 16px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.2s;
  margin-right: 10px;
}

input[type="file"]::file-selector-button:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

/* Glass Send Button */
.send-button {
  position: relative;
  overflow: hidden;
  padding: 12px 28px;
  border-radius: 980px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
  transition: all 0.3s;
}

.send-button::before {
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

.send-button:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.send-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.send-button.loading .send-label {
  opacity: 0;
}

/* Progress bar */
.send-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 0%;
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.25),
    rgba(255,255,255,0.6),
    rgba(255,255,255,0.25)
  );
  transition: width 0.2s ease;
  pointer-events: none;
}

/* Loading state */
.send-button.loading {
  cursor: default;
  animation: none;
  transform: none;
}

/* Responsive Design */
@media (max-width: 768px) {
  .top-nav {
    padding: 12px 16px;
  }

  .nav-button,
  .book-button {
    padding: 8px 16px;
    font-size: 14px;
  }

  .page-title {
    font-size: 16px;
  }

  .notes-container {
    padding: 16px 12px;
  }

  .note-bubble {
    max-width: 85%;
    padding: 12px 16px;
  }

  .input-bar {
    padding: 16px;
  }

  .input-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .input-options {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .send-button {
    width: 100%;
  }

  textarea {
    font-size: 16px;
    height: 60px;
  }
}

@media (max-width: 480px) {
  .nav-left {
    width: 100%;
    flex-direction: column;
  }

  .nav-button,
  .book-button {
    width: 100%;
    justify-content: center;
  }
}
     html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }
  </style>
</head>
<body>
  <!-- Top Navigation -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-left">
        <a href="/api/root/${nodeId}?token=${
          req.query.token ?? ""
        }&html" class="nav-button">
          ← Back to Tree
        </a>
        <a href="${base}?token=${
          req.query.token ?? ""
        }&html" class="nav-button">
          Back to Version
        </a>
      </div>

      <div class="page-title">
        Notes for <a href="${base}?token=${
          req.query.token ?? ""
        }&html">${nodeName} v${version}</a>
      </div>
    </div>
  </div>

  <!-- Notes Container -->
  <div class="notes-container">
    <div class="notes-wrapper">
      <ul class="notes-list">
      ${notes
        .map((n) => {
          const isSelf =
            currentUserId && n.userId && n.userId.toString() === currentUserId;
          const preview =
            n.contentType === "text"
              ? n.content.length > 169
                ? n.content.substring(0, 500) + "..."
                : n.content
              : n.content.split("/").pop();

          const userLabel = n.userId
            ? `<a href="/api/user/${n.userId}?token=${
                req.query.token ?? ""
              }&html">${n.username ?? n.userId}</a>`
            : (n.username ?? "Unknown user");

          return `
          <li
            class="note-item ${isSelf ? "self" : "other"} ${
              n.isReflection ? "reflection" : ""
            }"
            data-note-id="${n._id}"
            data-node-id="${n.nodeId}"
            data-version="${n.version}"
          >
            <div class="note-bubble">
              ${
                n.contentType === "file"
                  ? '<div class="file-badge">📎 File</div>'
                  : ""
              }
              ${!isSelf ? `<div class="note-author">${userLabel}</div>` : ""}
              <div class="note-content">
                <a href="${base}/notes/${n._id}?token=${
                  req.query.token ?? ""
                }&html">
                  ${preview}
                </a>
              </div>
              <div class="note-meta">
                <span>${new Date(n.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}</span>
                <button class="delete-button" title="Delete note">✕</button>
              </div>
            </div>
          </li>
        `;
        })
        .join("")}
    </ul>
    </div>
  </div>

  <!-- Input Bar -->
  <div class="input-bar">
    <form
      method="POST"
      action="/api/${nodeId}/${version}/notes?token=${
        req.query.token ?? ""
      }&html"
      enctype="multipart/form-data"
      class="input-form"
    >
      <textarea
        name="content"
        rows="1"
        placeholder="Write a note..."
        id="noteTextarea"
      ></textarea>

      <div class="input-controls">
        <div class="input-options">
         
          <input type="file" name="file" />
        </div>
<button type="submit" class="send-button" id="sendBtn">
  <span class="send-label">Send</span>
  <span class="send-progress"></span>
</button>      </div>
    </form>
  </div>


  <script>
    // Auto-scroll to bottom on load
    const container = document.querySelector('.notes-container');
    container.scrollTop = container.scrollHeight;

    // Auto-resize textarea with smooth overflow handling
    const textarea = document.getElementById('noteTextarea');
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      const newHeight = Math.min(this.scrollHeight, 120);
      this.style.height = newHeight + 'px';
      
      // Show scrollbar only when content exceeds max height
      if (this.scrollHeight > 120) {
        this.style.overflowY = 'auto';
      } else {
        this.style.overflowY = 'hidden';
      }
    });

    

    // Delete note functionality
    document.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('delete-button')) return;

      const noteItem = e.target.closest('.note-item');
      const noteId = noteItem.dataset.noteId;
      const nodeId = noteItem.dataset.nodeId;
      const version = noteItem.dataset.version;

      if (!confirm('Delete this note? This cannot be undone.')) return;

      const token = new URLSearchParams(window.location.search).get('token') || '';
      const qs = token ? '?token=' + encodeURIComponent(token) : '';

      try {
        const res = await fetch(
          \`/api/\${nodeId}/\${version}/notes/\${noteId}\${qs}\`,
          { method: 'DELETE' }
        );

        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Delete failed');

        // Fade out animation
        noteItem.style.opacity = '0';
        noteItem.style.transform = 'translateY(-10px)';
        setTimeout(() => noteItem.remove(), 300);
      } catch (err) {
        alert('Failed to delete: ' + (err.message || 'Unknown error'));
      }
    });
  </script>

  <script>
  const form = document.querySelector('.input-form');
  const sendBtn = document.getElementById('sendBtn');
  const progressBar = sendBtn.querySelector('.send-progress');

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    // Lock UI
    sendBtn.classList.add('loading');
    sendBtn.disabled = true;

    const formData = new FormData(form);
    const xhr = new XMLHttpRequest();

    xhr.open('POST', form.action, true);

    // Upload progress (files + text)
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const percent = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = percent + '%';
    };

    xhr.onload = () => {
      // Let server redirect / reload naturally
      document.location.reload();
    };

    xhr.onerror = () => {
      alert('Send failed');
      sendBtn.classList.remove('loading');
      sendBtn.disabled = false;
      progressBar.style.width = '0%';
    };

    xhr.send(formData);
  });

textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});


</script>
</body>
</html>
`);
    }

    // ---------- NORMAL OLD JSON MODE ----------
    return res.json({ success: true, notes });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------------------------
   POST /:nodeId/:version/notes
------------------------------------------------------------------- */
router.post(
  "/:nodeId/:version/notes",
  authenticate,
  upload.single("file"),

  async (req, res) => {
    try {
      const { nodeId, version } = req.params;

      const contentType = req.file ? "file" : "text";
      const isReflection = req.body.isReflection === "true";

      const result = await coreCreateNote({
        contentType,
        content: contentType === "file" ? req.file.filename : req.body.content,
        userId: req.userId,
        nodeId,
        version: Number(version),
        isReflection,
        file: req.file,
      });

      const wantHtml = "html" in req.query;

      if (wantHtml) {
        return res.redirect(
          `/api/${nodeId}/${version}/notes?token=${req.query.token ?? ""}&html`,
        );
      }

      // otherwise JSON (for API clients)
      return res.json({ success: true, note: result.Note });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);
const allowedParams = ["token", "html", "error"];

function filterQuery(req) {
  return Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
    .join("&");
}
/* ------------------------------------------------------------------
   GET /:nodeId/:version/notes/:noteId
   - JSON (old behavior)
   - raw file download (old behavior)
   - HTML viewer (optional)
------------------------------------------------------------------- */
router.get("/:nodeId/:version/notes/:noteId", async (req, res) => {
  try {
    const { nodeId, version, noteId } = req.params;

    const queryString = filterQuery(req);
    const qs = queryString ? `?${queryString}` : "";

    // Check if token exists in query
    const hasToken = req.query.token !== undefined;

    const Note = (await import("../db/models/notes.js")).default;
    const note = await Note.findById(noteId)
      .populate("userId", "username")
      .lean();

    if (!note) return res.status(404).send("Note not found");

    const back = hasToken
      ? `/api/${nodeId}/${version}/notes${qs}`
      : "https://tree.tabors.site";
    const backText = hasToken ? "← Back to Notes" : "← Back to Home";
    const nodeUrl = `/api/${nodeId}${qs}`;

    const userLink = note.userId
      ? `<a href="/api/user/${note.userId._id}${qs}">
       ${note.userId.username ?? "Unknown user"}
     </a>`
      : (note.username ?? "Unknown user");

    if (req.query.html !== undefined) {
      if (note.contentType === "text") {
        return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Note by ${note.userId?.username || "User"}</title>
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
    }

    /* Animated background */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }
 html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }
    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      animation: fadeInUp 0.5s ease-out;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
    }

    .back-link::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .back-link:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
    }

    .back-link:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Note Card */
    .note-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-info::before {
      content: '👤';
      font-size: 18px;
    }

    .user-info a {
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .user-info a:hover {
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
      transform: translateX(2px);
    }

    /* Copy Button Bar */
    .copy-bar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 16px;
    }

    .copy-btn {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      font-size: 20px;
      padding: 8px 12px;
      border-radius: 980px;
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
    }

    .copy-btn::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .copy-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .copy-btn:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .copy-btn:active {
      transform: translateY(0);
    }

    #copyUrlBtn {
      background: rgba(255, 255, 255, 0.25);
    }

    /* Note Content */
    pre {
      background: rgba(255, 255, 255, 0.3);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      padding: 20px;
      border-radius: 12px;
      font-size: 16px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-wrap: break-word;
      border: 1px solid rgba(255, 255, 255, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      color: #3d2f8f;
      font-weight: 600;
      text-shadow: 
        0 0 10px rgba(102, 126, 234, 0.4),
        0 1px 3px rgba(255, 255, 255, 1);
      box-shadow: 
        0 4px 20px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    pre::before {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(
        110deg,
        transparent 40%,
        rgba(255, 255, 255, 0.4),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      pointer-events: none;
    }

    pre:hover {
      border-color: rgba(255, 255, 255, 0.5);
      box-shadow: 
        0 8px 32px rgba(102, 126, 234, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
    }
/* Programmatic shimmer trigger */
pre.flash::before {
  opacity: 1;
  animation: glassShimmer 1.2s ease forwards;
}

    pre:hover::before {
      opacity: 1;
      animation: glassShimmer 1.2s ease forwards;
    }

    pre.copied {
      animation: textGlow 0.8s ease-out;
    }

    @keyframes textGlow {
      0% {
        box-shadow: 
          0 4px 20px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
      50% {
        box-shadow: 
          0 0 40px rgba(102, 126, 234, 0.6),
          0 0 60px rgba(102, 126, 234, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.8);
        text-shadow: 
          0 0 20px rgba(102, 126, 234, 0.8),
          0 0 30px rgba(102, 126, 234, 0.6),
          0 1px 3px rgba(255, 255, 255, 1);
      }
      100% {
        box-shadow: 
          0 4px 20px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.4);
      }
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

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .note-card {
        padding: 24px 20px;
      }

      pre {
        font-size: 17px;
        padding: 16px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">${backText}</a>
      <button id="copyUrlBtn" class="copy-btn" title="Copy URL to share">🔗</button>
    </div>

    <!-- Note Card -->
    <div class="note-card">
      <div class="user-info">
        ${userLink}
      </div>

      <div class="copy-bar">
        <button id="copyNoteBtn" class="copy-btn" title="Copy note">📋</button>
      </div>

      <pre id="noteContent">${note.content}</pre>
    </div>
  </div>

  <script>
    const copyNoteBtn = document.getElementById("copyNoteBtn");
    const copyUrlBtn = document.getElementById("copyUrlBtn");
    const noteContent = document.getElementById("noteContent");

    copyNoteBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(noteContent.textContent).then(() => {
    copyNoteBtn.textContent = "✔️";
    setTimeout(() => (copyNoteBtn.textContent = "📋"), 900);

    // text glow (already existing)
    noteContent.classList.add("copied");
    setTimeout(() => noteContent.classList.remove("copied"), 800);

    // 🔥 delayed glass shimmer (0.5s)
    setTimeout(() => {
      noteContent.classList.remove("flash"); // reset if still present
      void noteContent.offsetWidth;          // force reflow so animation restarts
      noteContent.classList.add("flash");

      setTimeout(() => {
        noteContent.classList.remove("flash");
      }, 1300); // slightly longer than animation
    }, 600);
  });
});


    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        copyUrlBtn.textContent = "✔️";
        setTimeout(() => (copyUrlBtn.textContent = "🔗"), 900);
      });
    });
  </script>
</body>
</html>
`);
      }

      const fileUrl = `/api/uploads/${note.content}`;
      const filePath = path.join(uploadsFolder, note.content);
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      const mediaHtml = renderMediaImmediate(fileUrl, mimeType);
      const fileName = path.basename(note.content);

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${fileName}</title>
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
    }

    /* Animated background */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }
 html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }
    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      animation: fadeInUp 0.5s ease-out;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
    }

    .back-link::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .back-link:hover {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
    }

    .back-link:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* File Card */
    .file-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out 0.1s both;
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-info::before {
      content: '👤';
      font-size: 18px;
    }

    .user-info a {
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .user-info a:hover {
      text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
      transform: translateX(2px);
    }

    /* File Header */
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: white;
      margin-bottom: 20px;
      word-break: break-word;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    /* Action Buttons */
    .action-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

    .download {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(10px);
      color: white;
      text-decoration: none;
      border-radius: 980px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .download::after {
      content: '⬇️';
      font-size: 16px;
      margin-left: 4px;
    }

    .download::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .download:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    }

    .download:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .copy-url-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 980px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.3s;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .copy-url-btn::after {
      content: '🔗';
      font-size: 16px;
      margin-left: 4px;
    }

    .copy-url-btn::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .copy-url-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .copy-url-btn:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Media Container */
    .media {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .media img,
    .media video,
    .media audio {
      max-width: 100%;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .file-card {
        padding: 24px 20px;
      }

      h1 {
        font-size: 22px;
      }

      .action-bar {
        flex-direction: column;
      }

      .download,
      .copy-url-btn {
        padding: 12px 18px;
        font-size: 16px;
        width: 100%;
        justify-content: center;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
      @media (max-width: 768px) {
  .send-progress {
    animation: shimmer 1.2s infinite linear;
  }
}

@keyframes shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: 200px 0; }
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">${backText}</a>
    </div>

    <!-- File Card -->
    <div class="file-card">
      <div class="user-info">
        ${userLink}
      </div>

      <h1>${fileName}</h1>

      <div class="action-bar">
        <a class="download" href="${fileUrl}" download>
          Download
        </a>
        <button id="copyUrlBtn" class="copy-url-btn">
          Share
        </button>
      </div>

      <div class="media">
        ${mediaHtml}
      </div>
    </div>
  </div>

  <script>
    const copyUrlBtn = document.getElementById("copyUrlBtn");

    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        const originalText = copyUrlBtn.textContent;
        copyUrlBtn.textContent = "✔️ Copied!";
        setTimeout(() => (copyUrlBtn.textContent = originalText), 900);
      });
    });
  </script>
</body>
</html>
`);
    }

    // ---------- DATA BEHAVIOR (NO HTML) ----------
    if (note.contentType === "text") {
      return res.json({ text: note.content });
    }

    if (note.contentType === "file") {
      const filePath = path.join(uploadsFolder, note.content);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.sendFile(filePath);
    }

    res.status(400).json({ error: "Unknown note type" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
router.delete(
  "/:nodeId/:version/notes/:noteId",
  authenticate,
  async (req, res) => {
    try {
      const { noteId } = req.params;

      const result = await coreDeleteNoteAndFile({
        noteId,
        userId: req.userId,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

export default router;
