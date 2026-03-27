/* --------------------------------------------------------- */
/* Note detail pages (renderTextNote, renderFileNote)        */
/* --------------------------------------------------------- */

import { getLandUrl } from "../../../../canopy/identity.js";
import { page } from "../layout.js";
import { escapeHtml } from "../utils.js";

export function renderTextNote({
  back,
  backText,
  userLink,
  editorButton,
  note,
}) {
  const css = `
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
      content: '\ud83d\udc64';
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

    .note-time {
      margin-left: auto;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
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
      .editor-btn {
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.editor-btn:hover {
  background: rgba(255, 255, 255, 0.35);
}

  `;

  const body = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">${backText}</a>
      <button id="copyUrlBtn" class="copy-btn" title="Copy URL to share">\ud83d\udd17</button>
    </div>

    <!-- Note Card -->
    <div class="note-card">
      <div class="user-info">
        ${userLink}
        ${note.createdAt ? `<span class="note-time">${new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${new Date(note.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>` : ""}
      </div>
<div class="copy-bar">
  ${editorButton}
  <button id="copyNoteBtn" class="copy-btn" title="Copy note">\ud83d\udccb</button>
</div>


<pre id="noteContent">${escapeHtml(note.content)}</pre>
    </div>
  </div>
  `;

  const js = `
    const copyNoteBtn = document.getElementById("copyNoteBtn");
    const copyUrlBtn = document.getElementById("copyUrlBtn");
    const noteContent = document.getElementById("noteContent");

    copyNoteBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(noteContent.textContent).then(() => {
    copyNoteBtn.textContent = "\\u2714\\ufe0f";
    setTimeout(() => (copyNoteBtn.textContent = "\\ud83d\\udccb"), 900);

    // text glow (already existing)
    noteContent.classList.add("copied");
    setTimeout(() => noteContent.classList.remove("copied"), 800);

    // delayed glass shimmer (0.5s)
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
        copyUrlBtn.textContent = "\\u2714\\ufe0f";
        setTimeout(() => (copyUrlBtn.textContent = "\\ud83d\\udd17"), 900);
      });
    });
  `;

  return page({
    title: `Note by ${escapeHtml(note.userId?.username || "User")} - TreeOS`,
    css,
    body,
    js,
  });
}

export function renderFileNote({
  back,
  backText,
  userLink,
  note,
  fileName,
  fileUrl,
  mediaHtml,
  fileDeleted,
}) {
  const css = `
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
      content: '\ud83d\udc64';
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

    .note-time {
      margin-left: auto;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
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
      content: '\u2b07\ufe0f';
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
      content: '\ud83d\udd17';
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

  `;

  const body = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">${backText}</a>
    </div>

    <!-- File Card -->
    <div class="file-card">
      <div class="user-info">
        ${userLink}
        ${note.createdAt ? `<span class="note-time">${new Date(note.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${new Date(note.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>` : ""}
      </div>

<h1>${escapeHtml(fileName)}</h1>

      ${fileDeleted ? "" : `<div class="action-bar">
        <a class="download" href="${fileUrl}" download>Download</a>
        <button id="copyUrlBtn" class="copy-url-btn">Share</button>
      </div>`}

      <div class="media">
        ${fileDeleted ? `<p style="color:rgba(255,255,255,0.6); padding:40px 0;">File was deleted</p>` : mediaHtml}
      </div>
    </div>
  </div>
  `;

  const js = `
    const copyUrlBtn = document.getElementById("copyUrlBtn");

    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        const originalText = copyUrlBtn.textContent;
        copyUrlBtn.textContent = "\\u2714\\ufe0f Copied!";
        setTimeout(() => (copyUrlBtn.textContent = originalText), 900);
      });
    });
  `;

  return page({
    title: escapeHtml(fileName),
    css,
    body,
    js,
  });
}
