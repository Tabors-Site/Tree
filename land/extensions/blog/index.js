import BlogPost from "./model.js";
import createRouter from "./routes.js";

export async function init(core) {
  return {
    models: { BlogPost },
    router: createRouter(core),
    exports: {},
  };
}
