import router from "./routes.js";
import { apiKeyAuthStrategy } from "./core.js";
import { getExtension } from "../loader.js";

export async function init(core) {
  core.auth.registerStrategy("apiKey", apiKeyAuthStrategy);

  // Register quick link on user profile
  try {
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("user-quick-links", "api-keys", ({ userId, queryString }) =>
      `<li><a href="/api/v1/user/${userId}/api-keys${queryString}">API Keys</a></li>`,
      { priority: 50 }
    );
  } catch {}

  return { router };
}
