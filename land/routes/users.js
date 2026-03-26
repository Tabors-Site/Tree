import log from "../seed/log.js";
import { hooks } from "../seed/hooks.js";
import { sendOk, sendError, ERR, ProtocolError } from "../seed/protocol.js";
import { getLandConfigValue } from "../seed/landConfig.js";
import {
  createUser, createFirstUser, verifyPassword, generateToken,
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

function isLocalRequest(req) {
  const host = req.hostname || "";
  return !host || host === "localhost" || host.startsWith("127.") || host.startsWith("192.168.");
}

const register = async (req, res) => {
  try {
    const { username, password } = req.body;

    // First user bootstraps the land as admin.
    // Bypasses beforeRegister hook intentionally: no extensions loaded yet,
    // no email to verify, no invite to check. The land needs an operator.
    const first = await isFirstUser();

    if (first) {
      const user = await createFirstUser(username, password);
      hooks.run("afterRegister", { user, req }).catch(() => {});
      const token = generateToken(user);
      return sendOk(res, {
        firstUser: true, token,
        userId: user._id.toString(), username: user.username, isAdmin: true,
      }, 201);
    }

    // beforeRegister hook: extensions gate registration (email, invite codes, etc.)
    // Note: password is passed so email extensions can validate strength.
    // Extensions must never log or store the raw password.
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
      token, userId: user._id.toString(), username: user.username, isAdmin: false,
    }, 201);
  } catch (error) {
    if (error instanceof ProtocolError) {
      return sendError(res, error.httpStatus, error.errCode, error.message);
    }
    log.error("Auth", `Registration error: ${error.message}`);
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

    // Constant-time rejection: always run bcrypt.compare even if user doesn't exist.
    // Without this, an attacker can distinguish "user not found" (fast, no bcrypt)
    // from "wrong password" (slow, bcrypt runs) by timing the response.
    const DUMMY_HASH = "$2b$12$0000000000000000000000000000000000000000000000000000";
    const isMatch = await verifyPassword(
      user && !user.isRemote ? user : { password: DUMMY_HASH },
      password,
    );
    if (!user || user.isRemote || !isMatch) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid credentials");
    }

    const token = generateToken(user);
    const isLocal = isLocalRequest(req);
    const expiryDays = Math.max(1, Math.min(Number(getLandConfigValue("jwtExpiryDays")) || 30, 365));

    res.cookie("token", token, {
      httpOnly: true,
      secure: !isLocal,
      sameSite: isLocal ? "Lax" : "None",
      domain: cookieDomain(req),
      maxAge: expiryDays * 24 * 60 * 60 * 1000,
      path: "/",
    });

    sendOk(res, {
      token,
      userId: user._id.toString(),
      username: user.username,
      isAdmin: user.isAdmin || false,
    });
  } catch (error) {
    log.error("Auth", `Login error: ${error.message}`);
    sendError(res, 500, ERR.INTERNAL, "Server is down");
  }
};

const logout = async (req, res) => {
  try {
    const isLocal = isLocalRequest(req);

    res.clearCookie("token", {
      httpOnly: true,
      secure: !isLocal,
      sameSite: isLocal ? "Lax" : "None",
      domain: cookieDomain(req),
      path: "/",
    });

    return sendOk(res, { message: "Logged out successfully" });
  } catch (error) {
    log.error("Auth", `Logout error: ${error.message}`);
    return sendError(res, 500, ERR.INTERNAL, "Logout failed");
  }
};

export { register, login, logout };
