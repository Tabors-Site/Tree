import { useState, useEffect } from "react";
import "./ExtensionsAbout.css";

const ExtensionFormat = () => {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("https://raw.githubusercontent.com/taborgreat/TreeOS/main/land/extensions/EXTENSION_FORMAT.md")
      .then(r => r.text())
      .then(text => {
        setContent(text);
        setLoading(false);
      })
      .catch(() => {
        setContent("Failed to load. View on GitHub: https://github.com/taborgreat/TreeOS/blob/main/land/extensions/EXTENSION_FORMAT.md");
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="ext-docs"><div className="ext-docs-card" style={{textAlign: "center", padding: 60, color: "#888"}}>Loading extension format spec...</div></div>;

  // Simple markdown to HTML (handles headers, code blocks, tables, lists, bold, inline code)
  const lines = content.split("\n");
  const html = [];
  let inCode = false;
  let codeBlock = [];
  let inTable = false;
  let tableRows = [];

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function formatInline(line) {
    return line
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre class="ext-code-block"><code>${codeBlock.join("\n")}</code></pre>`);
        codeBlock = [];
        inCode = false;
      } else {
        // Flush table if open
        if (inTable) {
          html.push(`<table class="ext-table"><tbody>${tableRows.join("")}</tbody></table>`);
          tableRows = [];
          inTable = false;
        }
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBlock.push(escapeHtml(line));
      continue;
    }

    // Tables
    if (line.includes("|") && line.trim().startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue; // separator row
      const tag = !inTable ? "th" : "td";
      if (!inTable) inTable = true;
      tableRows.push(`<tr>${cells.map(c => `<${tag}>${formatInline(c)}</${tag}>`).join("")}</tr>`);
      continue;
    }

    // End table
    if (inTable && !line.includes("|")) {
      html.push(`<table class="ext-table"><tbody>${tableRows.join("")}</tbody></table>`);
      tableRows = [];
      inTable = false;
    }

    // Headers
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      html.push(`<h1 class="ext-title">${escapeHtml(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      html.push(`<h2 class="ext-section-title" style="margin-top:32px"><span class="ext-section-icon">.</span> ${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      html.push(`<h3 style="color:#e5e5e5;font-size:15px;font-weight:700;margin:20px 0 8px">${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }

    // List items
    if (line.match(/^- /)) {
      html.push(`<div class="ext-file-item">${formatInline(escapeHtml(line.slice(2)))}</div>`);
      continue;
    }
    if (line.match(/^\d+\. /)) {
      html.push(`<div class="ext-file-item">${formatInline(escapeHtml(line.replace(/^\d+\. /, "")))}</div>`);
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      continue;
    }

    // Regular paragraph
    html.push(`<div class="ext-section-text">${formatInline(escapeHtml(line))}</div>`);
  }

  // Flush remaining
  if (inTable) {
    html.push(`<table class="ext-table"><tbody>${tableRows.join("")}</tbody></table>`);
  }

  return (
    <div className="ext-docs">
      <div className="ext-docs-card">
        <div className="al-page-back">
          <a className="al-back-link" href="/about">←</a>
        </div>
        <style>{`
          .ext-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
          .ext-table th, .ext-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
          .ext-table th { color: rgba(255,255,255,0.5); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
          .ext-code-block { background: rgba(0,0,0,0.3); border-radius: 10px; padding: 14px 18px; overflow-x: auto; margin: 10px 0; font-size: 12.5px; line-height: 1.6; }
          .ext-code-block code { color: rgba(255,255,255,0.7); white-space: pre; }
        `}</style>
        <div dangerouslySetInnerHTML={{ __html: html.join("\n") }} />
        <div className="ext-section" style={{marginTop: 32}}>
          <div className="ext-links">
            <a href="/about/extensions">Extensions Overview</a>
            {" | "}
            <a href="/about/api">API Reference</a>
            {" | "}
            <a href="/about/cli">CLI Guide</a>
            {" | "}
            <a href="https://github.com/taborgreat/TreeOS/blob/main/land/extensions/EXTENSION_FORMAT.md">View on GitHub</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExtensionFormat;
