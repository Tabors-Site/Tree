import React, { useState, useEffect } from "react";

/**
 * Address bar.
 *
 * Left chip = the signed-in human being (immutable for now).
 * Right text = the addressed Stance (or full PA).
 *
 * On Enter: emits onNavigate(rawText). The caller resolves + fetches.
 */
export default function AddressBar({ username, currentAddress, onNavigate, invalid }) {
  const [text, setText] = useState(currentAddress || "");

  useEffect(() => {
    setText(currentAddress || "");
  }, [currentAddress]);

  function submit(e) {
    if (e.key === "Enter") {
      onNavigate(text.trim());
    }
  }

  return (
    <>
      <div className="identity-chip" title="Signed-in being (click to switch — coming in a later pass)">
        <span>{username}</span>
        <span className="dim">@&lt;land&gt;</span>
      </div>
      <span className="bridge-arrow">::</span>
      <div className={`address-bar ${invalid ? "invalid" : ""}`}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={submit}
          placeholder="land/path@embodiment"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
    </>
  );
}
