import router from "./routes.js";
import { apiKeyAuthStrategy } from "./core.js";

export async function init(core) {
  // Register API key as an auth strategy so the middleware can validate keys
  core.auth.registerStrategy("apiKey", apiKeyAuthStrategy);

  return { router };
}
