import note from "./notes.js";
import node from "./node.js";
import root from "./root.js";
import user from "./user.js";

export default function registerURLRoutes(app) {
  app.use("/", user);
  app.use("/", root);

  app.use("/", note);

  app.use("/", node);
}
