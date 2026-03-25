import { getLandConfigValue } from "../landConfig.js";

export default function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  const landUrl = getLandConfigValue("landUrl") || null;
  const allowedFrameDomains = getLandConfigValue("allowedFrameDomains") || [];

  const ancestors = ["'self'"];
  if (landUrl) ancestors.push(landUrl);
  for (const domain of allowedFrameDomains) ancestors.push(domain);

  res.setHeader(
    "Content-Security-Policy",
    `frame-ancestors ${ancestors.join(" ")}`,
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
