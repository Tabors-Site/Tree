import router from "./routes.js";
import { apiKeyAuthStrategy } from "./core.js";

export async function init(core) {
  core.auth.registerStrategy("apiKey", apiKeyAuthStrategy);

  return { router };
}
