import React from "react";

/**
 * Land zone renderer.
 *
 * Renders zone === "land" Position Descriptors. The land root is the
 * discovery surface — shows the operator, available beings, and any
 * public trees ext-allow'd at land scope.
 */
export default function LandZone({ descriptor, onNavigate }) {
  const beings = descriptor.beings || [];
  const children = descriptor.children || [];
  const landMeta = descriptor.land || {};

  return (
    <div className="zone">
      <h2>{landMeta.name || descriptor.address.land}</h2>
      <div className="breadcrumb">
        {descriptor.address.land} <span style={{ color: "var(--fg-faint)" }}>/ (land root)</span>
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

      <div className="section">
        <h3>Public trees ({children.length})</h3>
        {children.length === 0 ? (
          <div className="empty">No public trees on this land yet.</div>
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

      {landMeta.operator && (
        <div className="section">
          <h3>Land metadata</h3>
          <div className="meta" style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-dim)" }}>
            operator: {landMeta.operator}
            <br />
            registration: {landMeta.policies?.registrationOpen ? "open" : "closed"}
          </div>
        </div>
      )}
    </div>
  );
}
