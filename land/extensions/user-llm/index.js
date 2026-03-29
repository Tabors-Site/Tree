import router, { resolveHtmlAuth } from "./routes.js";

export async function init(core) {
  resolveHtmlAuth();
  return { router };
}
