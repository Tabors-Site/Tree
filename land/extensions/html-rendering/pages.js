// Re-export from the existing core/login.js render functions.
// These are the HTML page renderers (login, register, forgot-password).
// The file core/login.js stays where it is since it's this extension's code,
// not core protocol logic. It could be moved here in a future cleanup.

export {
  renderLoginPage,
  renderRegisterPage,
  renderForgotPasswordPage,
} from "../../core/login.js";
