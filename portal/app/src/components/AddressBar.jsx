import React, { useState, useEffect } from "react";

/**
 * Address bar.
 *
 * Left chip = the signed-in being. Compact by default (just the username);
 * click to expand to the full stance `<username>@<land>`.
 *
 * Right text = the addressed Position or Stance. Always shows the full
 * domain prefix (`<land>/<path>`) so the user knows where they are. Typing
 * shorthand (`/`, `~`, `~user`, `/path`) is still allowed; on Enter the
 * server parser fills in the current-land context and the bar updates to
 * the canonical full form on the next descriptor.
 *
 * On Enter: emits onNavigate(rawText). The caller resolves + fetches.
 */
export default function AddressBar({ username, landDomain, currentAddress, onNavigate, invalid }) {
  const [text, setText] = useState(currentAddress || "");
  const [chipExpanded, setChipExpanded] = useState(false);

  useEffect(() => {
    setText(formatRight(currentAddress, landDomain));
  }, [currentAddress, landDomain]);

  function submit(e) {
    if (e.key === "Enter") {
      onNavigate(text.trim());
    }
  }

  const landLabel = landDomain || "<land>";
  const fullLeft = `${username}@${landLabel}`;

  return (
    <>
      <div
        className="identity-chip"
        title="Signed-in being. Click to toggle full form."
        onClick={() => setChipExpanded((v) => !v)}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        {chipExpanded ? (
          <span>{fullLeft}</span>
        ) : (
          <>
            <span>{username}</span>
            <span className="dim">@{landLabel}</span>
          </>
        )}
      </div>
      <span className="bridge-arrow">::</span>
      <div className={`address-bar ${invalid ? "invalid" : ""}`}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={submit}
          placeholder={landDomain ? `${landDomain}/...` : "land/path@embodiment"}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </>
  );
}

/**
 * Render the right-side text with the full domain prefix.
 * The bar shows `<land>/<path>` when both are known; if currentAddress
 * already contains the land (a full PA was typed), it is shown verbatim.
 */
function formatRight(currentAddress, landDomain) {
  const a = currentAddress || "";
  if (!landDomain) return a;
  if (a === "" || a === "/") return `${landDomain}/`;
  // If the user typed something that already includes the land, keep it.
  if (a.startsWith(landDomain)) return a;
  // Otherwise prefix the land. Path forms: /something, ~user, /~user/...
  if (a.startsWith("/")) return `${landDomain}${a}`;
  if (a.startsWith("~")) return `${landDomain}/${a}`;
  return `${landDomain}/${a}`;
}
