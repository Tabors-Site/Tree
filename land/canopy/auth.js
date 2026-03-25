/**
 * Canopy auth strategy.
 * Registers CanopyToken verification as an auth strategy so the kernel's
 * authenticate middleware can verify remote land users without importing
 * from canopy directly.
 */

import log from "../seed/log.js";
import User from "../seed/models/user.js";
import { verifyCanopyToken, getLandIdentity } from "./identity.js";
import { getPeerByDomain } from "./peers.js";

export function registerCanopyAuth(authStrategies) {
  authStrategies.push({
    name: "canopy",
    handler: async (req) => {
      const authHeader = req.headers?.authorization;
      if (!authHeader?.startsWith("CanopyToken ")) return null;

      const canopyToken = authHeader.slice("CanopyToken ".length);

      let unverified;
      try {
        const parts = canopyToken.split(".");
        unverified = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      } catch {
        const err = new Error("Malformed CanopyToken");
        err.status = 401;
        throw err;
      }

      const peer = await getPeerByDomain(unverified.iss);
      if (!peer) {
        const err = new Error("Unknown land: " + unverified.iss);
        err.status = 403;
        throw err;
      }
      if (peer.status === "blocked") {
        const err = new Error("Land " + unverified.iss + " is blocked");
        err.status = 403;
        throw err;
      }

      const { valid, payload, error } = await verifyCanopyToken(canopyToken, peer.publicKey);
      if (!valid) {
        const err = new Error("Invalid CanopyToken: " + error);
        err.status = 401;
        throw err;
      }

      const myDomain = getLandIdentity().domain;
      if (payload.aud && payload.aud !== myDomain) {
        const err = new Error("CanopyToken audience mismatch");
        err.status = 401;
        throw err;
      }

      if (payload.iss && payload.iss !== unverified.iss) {
        const err = new Error("CanopyToken issuer mismatch");
        err.status = 401;
        throw err;
      }

      const ghostUser = await User.findOne({
        _id: payload.sub,
        isRemote: true,
        homeLand: payload.iss,
      });

      if (!ghostUser) {
        const err = new Error("Remote user not registered on this land");
        err.status = 403;
        throw err;
      }

      return {
        userId: ghostUser._id,
        username: ghostUser.username,
        extra: {
          canopy: {
            sourceLandDomain: unverified.iss,
            sourceLandId: payload.landId,
            peer,
          },
        },
      };
    },
  });

  log.verbose("Canopy", "Canopy auth strategy registered");
}
