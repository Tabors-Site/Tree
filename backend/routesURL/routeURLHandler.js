import note from "./notes.js";
import node from "./node.js";
import root from "./root.js";

export default function registerURLRoutes(app) {
  app.use("/", root);
  app.use("/", node);
  app.use("/", note);
}
