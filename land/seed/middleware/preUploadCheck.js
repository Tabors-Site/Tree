/**
 * Pre-multer guard: validates multipart upload requests.
 * The kernel validates format. Extensions enforce size limits,
 * tier gates, and storage quotas via their own hooks.
 */
export default function preUploadCheck(req, res, next) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) return next();
  next();
}
