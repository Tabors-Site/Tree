import { page } from "../../html-rendering/html/layout.js";
import { esc, escapeHtml } from "../../html-rendering/html/utils.js";

export async function renderUserTags({ userId, user, notes, getNodeName, token }) {
  const tokenQS = token ? `?token=${encodeURIComponent(token)}&html` : `?html`;

  const css = `
.header-subtitle {
  margin-bottom: 0;
}


.note-author {
  font-weight: 600;
  color: white;
  font-size: 15px;
  margin-bottom: 8px;
  display: block;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.note-author a {
  color: white;
  text-decoration: none;
  transition: all 0.2s;
}

.note-author a:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.note-link {
  color: white;
  text-decoration: none;
  font-size: 15px;
  line-height: 1.6;
  display: block;
  word-wrap: break-word;
  transition: all 0.2s;
  font-weight: 400;
}

.note-link:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.file-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Responsive Design */`;

  const notesHtml = notes.length > 0
    ? `
    <ul class="notes-list">
      ${await Promise.all(
        notes.map(async (n) => {
          const nodeName = await getNodeName(n.nodeId);
          const preview =
            n.contentType === "text"
              ? n.content.length > 120
                ? n.content.substring(0, 120) + "\u2026"
                : n.content
              : n.content.split("/").pop();

          const author = n.userId.username || n.userId._id;

          return `
          <li class="note-card">
            <div class="note-content">
              <div class="note-author">
                <a href="/api/v1/user/${n.userId._id}${tokenQS}">
                  ${escapeHtml(author)}
                </a>
              </div>
              <a href="/api/v1/node/${n.nodeId}/${n.version}/notes/${
                n._id
              }${tokenQS}" class="note-link">
                ${
                  n.contentType === "file"
                    ? `<span class="file-badge">FILE</span>`
                    : ""
                }${escapeHtml(preview)}
              </a>
            </div>

            <div class="note-meta">
              ${new Date(n.createdAt).toLocaleString()}
              <span class="meta-separator">\u2022</span>
              <a href="/api/v1/node/${n.nodeId}/${n.version}${tokenQS}">
                ${escapeHtml(nodeName)} v${n.version}
              </a>
              <span class="meta-separator">\u2022</span>
              <a href="/api/v1/node/${n.nodeId}/${n.version}/notes${tokenQS}">
                View Notes
              </a>
            </div>
          </li>
        `;
        }),
      ).then((results) => results.join(""))}
    </ul>
    `
    : `
    <div class="empty-state">
      <div class="empty-state-icon">\uD83D\uDCEC</div>
      <div class="empty-state-text">No messages yet</div>
      <div class="empty-state-subtext">
        Notes where you're mentioned will appear here
      </div>
    </div>
    `;

  const body = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">
        \u2190 Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Mail for
        <a href="/api/v1/user/${userId}${tokenQS}">@${escapeHtml(user.username)}</a>
        ${
          notes.length > 0
            ? `<span class="message-count">${notes.length}</span>`
            : ""
        }
      </h1>
      <div class="header-subtitle">Notes where others have mentioned you</div>
    </div>

    <!-- Notes List -->
    ${notesHtml}
  </div>`;

  return page({
    title: `${escapeHtml(user.username)} \u2014 Mail`,
    css,
    body,
  });
}
