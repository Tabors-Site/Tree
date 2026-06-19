// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed-shipped inbox renderers. Imported as a side effect from
// seed/services.js so the renderers register at boot before the first
// my-inbox SEE call.
//
// One renderer per well-known seed intent. Extensions can register
// their own through `story.registerInboxRenderer` exposed via the
// services facade.

import { registerInboxRenderer } from "../inboxRenderers.js";
import { roleRequestRenderer } from "./roleRequest.js";

registerInboxRenderer("role-request", roleRequestRenderer, { ownerExtension: "seed" });
