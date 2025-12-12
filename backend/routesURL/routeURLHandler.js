import note from "./notes.js";

export default function registerURLRoutes(app) {
  app.use("/", note);
}
