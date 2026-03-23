export default {
  name: "email",
  version: "1.0.0",
  description: "Email verification for registration and password reset",

  needs: {
    services: ["auth"],
    models: ["User"],
  },

  optional: {},

  provides: {
    models: {
      TempUser: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    env: [
      { key: "EMAIL_USER", required: true, description: "Email account for sending (e.g. Gmail address)" },
      { key: "EMAIL_PASS", required: true, secret: true, description: "Email account password or app password" },
    ],
    cli: [],
  },
};
