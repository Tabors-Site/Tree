// TreeOS Portal Shared — status toast.
//
// One DOM element, body-level, z-index above every panel. Both the
// 3D portal's setHud and the flat-renderer's setStatus call through
// here. Always visible regardless of which render mode is up.
//
// Errors render red; info renders dim gray. Classification is a
// quick pattern match — anything that reads like a failure ("fatal",
// "failed", "error", "denied", "forbidden", "blocked", "refused",
// "rejected", "invalid", or a "socket: disconnect/error" status)
// goes red. Everything else is info.
//
// No auto-fade. Status sticks until the next message or an explicit
// clear. Errors are persistent so the user notices.

const TOAST_ID = "portal-status-toast";

const STYLE = `
  position: fixed;
  left: 50%; bottom: 14px;
  transform: translateX(-50%);
  z-index: 9999;
  pointer-events: none;
  padding: 5px 14px;
  min-width: 140px; max-width: 80vw;
  background: rgba(10, 13, 12, 0.92);
  border: 1px solid #2c3a32;
  border-radius: 4px;
  font: 11px ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  color: #9ab0a3;
  text-align: center;
  transition: color 120ms ease, border-color 120ms ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

function ensureEl() {
  let el = document.getElementById(TOAST_ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = TOAST_ID;
  el.style.cssText = STYLE;
  document.body.appendChild(el);
  return el;
}

function classify(text) {
  if (!text) return "empty";
  const lower = String(text).toLowerCase();
  if (/(^|[\s:>(\[])(fatal|failed|error|denied|forbidden|blocked|refused|rejected|invalid)\b/.test(lower)) {
    return "error";
  }
  if (/^socket: (disconnect|error)/.test(lower)) return "error";
  return "info";
}

export function setPortalStatus(text) {
  const el = ensureEl();
  if (text == null || text === "") {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  const kind = classify(text);
  el.textContent = String(text);
  el.style.display = "block";
  if (kind === "error") {
    el.style.color = "#ff6b6b";
    el.style.borderColor = "#7a2a2a";
    el.title = String(text); // long messages still readable on hover
  } else {
    el.style.color = "#9ab0a3";
    el.style.borderColor = "#2c3a32";
    el.title = "";
  }
}

export function clearPortalStatus() {
  setPortalStatus("");
}
