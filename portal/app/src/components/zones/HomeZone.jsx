import React from "react";

/**
 * Home zone renderer.
 *
 * Renders zone === "home" Position Descriptions. A user's personal space.
 * Shows their tree-roots as a grid plus the beings invocable at home scope.
 */
export default function HomeZone({ descriptor, onNavigate }) {
  const beings = descriptor.beings || [];
  const children = descriptor.children || [];
  const username = descriptor.address.path?.replace(/^\/~/, "") || "?";

  return (
    <div className="zone">
      <h2>~{username}</h2>
      <div className="breadcrumb">
        <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(`${descriptor.address.land}/`); }}>
          {descriptor.address.land}
        </a>
        {" / "}
        <span>~{username} (home)</span>
      </div>

      <div className="section">
        <h3>Beings at home</h3>
        <div className="beings-row">
          {beings.map((b) => (
            <div
              key={b.embodiment}
              className={`being-pill ${b.available ? "available" : ""}`}
              title={b.description || ""}
            >
              <span>@{b.embodiment}</span>
              {b.kind && <span className="dim" style={{ color: "var(--fg-faint)", fontSize: 10 }}>{b.kind}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <h3>Your trees ({children.length})</h3>
        {children.length === 0 ? (
          <div className="empty">No trees yet. Start one by chatting at home.</div>
        ) : (
          <div className="grid">
            {children.map((c) => (
              <div
                key={c.nodeId || c.name}
                className="card"
                onClick={() => onNavigate(`${descriptor.address.land}${c.path}`)}
              >
                <div className="title">{c.name}</div>
                <div className="meta">
                  {c.visibility === "public" ? "public" : "private"}
                  {" · "}
                  {c.type || "tree"}
                  {c.lifecycle && c.lifecycle !== "idle" && (
                    <span className={`lifecycle ${c.lifecycle}`}>{c.lifecycle}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
