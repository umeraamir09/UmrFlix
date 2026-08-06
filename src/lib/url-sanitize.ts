/**
 * Sanitizes a redirect URL to prevent open-redirect vulnerabilities.
 * Ensures the target is strictly a relative path on the same origin (e.g. "/library", "/watch?party=123").
 * Rejects external URLs (http://, https://), protocol-relative URLs (//evil.com),
 * backslash tricks (/\evil.com), or schemes (javascript:, data:).
 */
export function sanitizeRedirectUrl(url: string | null | undefined, fallback = "/"): string {
  if (!url || typeof url !== "string") return fallback
  const trimmed = url.trim()
  if (!trimmed.startsWith("/")) return fallback

  // Reject protocol-relative or backslash-prefixed paths
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\") || trimmed.startsWith("/%5C")) {
    return fallback
  }

  // Reject URLs containing schemes like http:, https:, javascript:, data: before query/hash
  const pathWithoutQuery = trimmed.split("?")[0].split("#")[0]
  if (pathWithoutQuery.includes(":")) {
    return fallback
  }

  return trimmed
}
