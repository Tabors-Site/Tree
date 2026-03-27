// Barrel re-export of all HTML render functions.
// Extensions and core routes use getExtension("html-rendering")?.exports to access these.
//
// Each page file lives in html/pages/ and uses the layout system (html/layout.js)
// for shared document structure and CSS. One file per concern.

// User pages (split from the former 8,612-line user.js)
export { renderUserProfile } from "./html/pages/profile.js";
export { renderUserNotes } from "./html/pages/userNotes.js";
export { renderUserTags } from "./html/pages/userTags.js";
export { renderUserContributions } from "./html/pages/userContributions.js";
export {
  renderResetPasswordExpired,
  renderResetPasswordForm,
  renderResetPasswordMismatch,
  renderResetPasswordInvalid,
  renderResetPasswordSuccess,
} from "./html/pages/passwordReset.js";
export { renderRawIdeasList, renderRawIdeaText, renderRawIdeaFile } from "./html/pages/rawIdeas.js";
export { renderInvites } from "./html/pages/invites.js";
export { renderDeletedBranches } from "./html/pages/deleted.js";
export { renderApiKeyCreated, renderApiKeysList } from "./html/pages/apiKeys.js";
export { renderShareToken } from "./html/pages/shareToken.js";
export { renderEnergy } from "./html/pages/energy.js";
export { renderChats } from "./html/pages/userChats.js";
export { renderNotifications } from "./html/pages/notifications.js";

// Node pages
export { renderNodeDetail } from "./html/pages/nodeDetail.js";
export { renderVersionDetail } from "./html/pages/versionDetail.js";
export { renderNodeChats, renderRootChats } from "./html/pages/nodeChats.js";
export { renderScriptDetail, renderScriptHelp } from "./html/pages/scripts.js";

// Note pages
export { renderEditorPage } from "./html/pages/editor.js";
export { renderBookPage, renderSharedBookPage, parseBool, normalizeStatusFilters, renderBookNode } from "./html/pages/book.js";
export { renderNotesList } from "./html/pages/notesList.js";
export { renderTextNote, renderFileNote } from "./html/pages/noteDetail.js";

// Tree pages
export { renderRootOverview } from "./html/pages/treeOverview.js";
export { renderCalendar } from "./html/pages/calendar.js";
export { renderGateway } from "./html/pages/gateway.js";
export { renderValuesPage } from "./html/pages/values.js";

// Chat
export { renderChat } from "./html/pages/chat.js";

// Query (public read-only interface)
export { renderQueryPage } from "./html/pages/query.js";

// Audit trail
export { renderContributions } from "./html/pages/contributions.js";

// Federation
export { renderCanopyAdmin, renderCanopyInvites, renderCanopyHorizon } from "./html/pages/canopy.js";

// Command center (capability surface)
export { renderCommandCenter } from "./html/pages/commandCenter.js";

// Error pages
export { errorHtml } from "./html/pages/error.js";

// Utilities re-exported for htmlRoutes.js and other consumers
export { escapeHtml, renderMedia } from "./html/utils.js";
