export default {
  name: "notifications",
  version: "1.0.0",
  description: "Notification system. Owns the Notification model and query functions. Extensions create notifications by importing from this extension.",

  needs: {
    models: ["Node"],
  },

  provides: {
    models: {
      Notification: "./model.js",
    },
    routes: "./routes.js",
  },
};
