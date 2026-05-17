import createRouter from "./routes.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  // Register quick link on user profile
  try {
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("user-quick-links", "deleted-revive", ({ beingId, queryString }) =>
      `<li><a href="/api/v1/user/${beingId}/deleted${queryString}">Deleted</a></li>`,
      { priority: 45 }
    );
  } catch {}

  return {
    router: createRouter(core),
  };
}
