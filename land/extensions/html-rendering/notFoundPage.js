import { sendError, ERR } from "../../seed/protocol.js";
import { errorHtml } from "./html/notFound.js";

export { errorHtml };

export function notFoundPage(
  req,
  res,
  message = "This page doesn't exist or may have been moved.",
) {
  if (process.env.ENABLE_FRONTEND_HTML !== "true") {
    return sendError(res, 404, ERR.NODE_NOT_FOUND, message);
  }
  return res.status(404).send(errorHtml(404, "Page Not Found", message));
}
