import React from "react";

/**
 * Tree zone renderer.
 *
 * Renders zone === "tree" Position Descriptors — a position inside a tree.
 * This is the richest zone: lineage breadcrumb, children, artifacts, beings
 * invocable at this node. Governance state (plans/contracts/workers/flags)
 * will land in Slice 4b; for now governance is `null` and we just show
 * the surrounding tree shape.
 */
export default function TreeZone({ descriptor, onNavigate }) {
  const beings = descriptor.beings || [];
  const children = descriptor.children || [];
  const artifacts = descriptor.artifacts || [];
  const lineage = descriptor.lineage || [];
  const siblings = descriptor.siblings || [];

  const land = descriptor.address.land;
  const leafName = descriptor.address.leafName;

  return (
    <div className="zone">
      <h2>{leafName}</h2>
      <div className="breadcrumb">
        {lineage.map((l, i) => (
          <React.Fragment key={l.path + i}>
            {i > 0 && <span style={{ color: "var(--fg-faint)" }}> / </span>}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onNavigate(`${land}${l.path}`);
              }}
            >
              {l.name}
            </a>
          </React.Fragment>
        ))}
        <span style={{ color: "var(--fg-faint)" }}> / </span>
        <span>{leafName}</span>
      </div>

      <div className="section">
        <h3>Beings here</h3>
        <div className="beings-row">
          {beings.map((b) => (
            <div
              key={b.embodiment}
              className={`being-pill ${b.available ? "available" : ""}`}
              title={b.description || ""}
            >
              <span>{b.icon || ""}</span>
              <span>@{b.embodiment}</span>
            </div>
          ))}
        </div>
      </div>

      {artifacts.length > 0 && (
        <div className="section">
          <h3>Artifacts ({artifacts.length})</h3>
          {artifacts.map((a) => (
            <div key={a.noteId} className="artifact">
              <div className="meta" style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-dim)" }}>
                {a.kind} · {a.contentType} · {a.previewBytes}B
                {a.byUsername && ` · by ${a.byUsername}`}
              </div>
              {a.preview && <div className="preview">{a.preview}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <h3>Children ({children.length})</h3>
        {children.length === 0 ? (
          <div className="empty">Leaf node — no children.</div>
        ) : (
          <div className="grid">
            {children.map((c) => (
              <div
                key={c.nodeId}
                className="card"
                onClick={() =>
                  onNavigate(`${land}${descriptor.address.pathByNames}/${c.name}`)
                }
              >
                <div className="title">{c.name}</div>
                <div className="meta">
                  {c.type || "node"}
                  {c.lifecycle && c.lifecycle !== "idle" && (
                    <span className={`lifecycle ${c.lifecycle}`}>{c.lifecycle}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {siblings.length > 0 && (
        <div className="section">
          <h3>Siblings ({siblings.length})</h3>
          <div className="beings-row">
            {siblings.map((s) => (
              <div
                key={s.nodeId}
                className="being-pill"
                style={{ cursor: "pointer" }}
                onClick={() => {
                  // Navigate to sibling: replace the leaf segment of pathByNames.
                  const parts = descriptor.address.pathByNames.split("/").filter(Boolean);
                  parts[parts.length - 1] = s.name;
                  onNavigate(`${land}/${parts.join("/")}`);
                }}
              >
                {s.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {descriptor.governance && (
        <div className="section">
          <h3>Governance</h3>
          <pre style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: 12,
            fontSize: 11,
            overflow: "auto",
            color: "var(--fg-dim)",
          }}>
            {JSON.stringify(descriptor.governance, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
