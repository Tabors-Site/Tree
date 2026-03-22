import createRouter from "./routes.js";

export async function init(core) {
  return {
    router: createRouter(core),
  };
}
