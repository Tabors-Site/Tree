import { getLandUrl } from "../canopy/identity.js";

export default function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  const creatorDomain = process.env.CREATOR_DOMAIN || process.env.ROOT_FRONTEND_DOMAIN;
  const creatorHost = creatorDomain ? new URL(creatorDomain).hostname : "tabors.site";
  res.setHeader(
    "Content-Security-Policy",
    `frame-ancestors 'self' ${getLandUrl()} https://*.${creatorHost}`,
  );
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  next();
}
