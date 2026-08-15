/**
 * Input validation helpers for API routes and query parameters.
 * Prevents SSRF, path traversal, injection attacks, and malformed inputs.
 */

// Jellyfin item IDs / MediaSource IDs are typically 32-character hex UUIDs or alphanumeric identifiers
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Validates that an item ID or resource identifier is well-formed.
 * Rejects path traversal tokens ('..', '/', '\\'), null bytes, and abnormal lengths.
 */
export function isValidItemId(id: unknown): id is string {
  if (typeof id !== "string" || !id) return false
  return SAFE_ID_RE.test(id)
}

/**
 * Validates catch-all path segments (slugs) for proxy and media routes.
 * Ensures every segment is safe and free from directory traversal patterns.
 */
export function isValidPathSlug(slug: unknown): slug is string[] {
  if (!Array.isArray(slug) || slug.length === 0) return false
  for (const segment of slug) {
    if (typeof segment !== "string" || !segment) return false
    // Reject path traversal and control characters
    if (segment === ".." || segment === "." || segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
      return false
    }
  }
  return true
}

/**
 * Validates non-negative integer indices (stream index, chapter index, etc.)
 */
export function isValidIndex(index: unknown, max = 1000): index is number {
  const num = typeof index === "number" ? index : typeof index === "string" ? Number(index) : NaN
  return Number.isInteger(num) && num >= 0 && num <= max
}
