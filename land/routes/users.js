import log from "../seed/log.js";
import { hooks } from "../seed/hooks.js";
import { sendOk, sendError, ERR } from "../seed/protocol.js";
import { getLandConfigValue } from "../seed/landConfig.js";
import {
  createUser, verifyPassword, generateToken,
  isFirstUser, findUserByUsername,
} from "../seed/auth.js";

function cookieDomain(req) {
  const host = (req.hostname || req.headers?.host || "").replace(/:\d+$/, "");
  const landDomain = process.env.LAND_DOMAIN || "";
  const configDomain = getLandConfigValue("cookieDomain");
  if (configDomain) return configDomain;
  if (landDomain && host.endsWith(landDomain)) return "." + landDomain;
  return undefined;
}

const register = async (req, res) => {
  try {
    const { username, password } = req.body;

    const first = await isFirstUser();

    if (first) {
      const user = await createUser(username, password, { isAdmin: true });
      hooks.run("afterRegister", { user, req }).catch(() => {});
      const token = generateToken(user);
      return sendOk(res, {
        firstUser: true, token,
        userId: user._id, username: user.username, isAdmin: true,
      }, 201);
    }

    const hookData = { username, password, req, res, handled: false };
    const hookResult = await hooks.run("beforeRegister", hookData);
    if (hookResult.cancelled) {
      const code = hookResult.timedOut ? ERR.HOOK_TIMEOUT : ERR.HOOK_CANCELLED;
      const http = hookResult.timedOut ? 500 : 403;
      return sendError(res, http, code, hookResult.reason || "Registration blocked");
    }
    if (hookData.handled) return;

    const user = await createUser(username, password);
    hooks.run("afterRegister", { user, req }).catch(() => {});
    const token = generateToken(user);

    sendOk(res, {
      token, userId: user._id, username: user.username, isAdmin: false,
    }, 201);
  } catch (error) {
    if (error.message.includes("already taken") || error.message.includes("required") || error.message.includes("must be")) {
      return sendError(res, 400, ERR.INVALID_INPUT, error.message);
    }
    log.error("Auth", "Registration error:", error);
    sendError(res, 500, ERR.INTERNAL, "Internal server error");
  }
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Username and password are required");
    }

    const user = await findUserByUsername(username);
    if (!user) return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid credentials");
    if (user.isRemote) return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid credentials");

    const isMatch = await verifyPassword(user, password);
    if (!isMatch) return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid credentials");

    const token = generateToken(user);

    const isLocal = !req.hostname || req.hostname === "localhost" || req.hostname.startsWith("127.") || req.hostname.startsWith("192.168.");

    res.cookie("token", token, {
      httpOnly: true,
      secure: !isLocal,
      sameSite: isLocal ? "Lax" : "None",
      domain: cookieDomain(req),
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    sendOk(res, {
      token,
      userId: user._id.toString(),
      username: user.username,
      isAdmin: user.isAdmin || false,
    });
  } catch (error) {
    log.error("Auth", "Login error:", error);
    sendError(res, 500, ERR.INTERNAL, "Server is down");
  }
};

const logout = async (req, res) => {
  try {
    const isLocal = !req.hostname || req.hostname === "localhost" || req.hostname.startsWith("127.") || req.hostname.startsWith("192.168.");

    res.clearCookie("token", {
      httpOnly: true,
      secure: !isLocal,
      sameSite: isLocal ? "Lax" : "None",
      domain: cookieDomain(req),
      path: "/",
    });

    return sendOk(res, { message: "Logged out successfully" });
  } catch (error) {
    log.error("Auth", "Logout error:", error);
    return sendError(res, 500, ERR.INTERNAL, "Logout failed");
  }
};

export { register, login, logout };
