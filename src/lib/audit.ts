export type AuditEvent =
  | "session_created"
  | "session_revoked"
  | "logout"
  | "login_ok"
  | "login_failed"
  | "reauth_ok"
  | "reauth_rejected"
  | "csrf_rejected"

type AuditPayload = {
  ip?: string
  userId?: string
  sessionId?: string
  username?: string
  reason?: string
  [key: string]: unknown
}

const auditLogBuckets = new Map<string, { count: number; resetAt: number }>()

/**
 * Extracts client IP based on configured TRUSTED_PROXY or CLIENT_IP_HEADER rules.
 */
export function getClientIp(req: Request): string {
  const customHeader = process.env.CLIENT_IP_HEADER
  if (customHeader) {
    const val = req.headers.get(customHeader.toLowerCase())
    if (val) return val.trim()
  }

  const trustedProxy = process.env.TRUSTED_PROXY ?? "1"
  if (trustedProxy === "1") {
    const xff = req.headers.get("x-forwarded-for")
    if (xff) {
      const parts = xff.split(",").map((p) => p.trim())
      // Rightmost entry added by reverse proxy is verified
      const rightmost = parts[parts.length - 1]
      if (rightmost) return rightmost
    }
  }

  return "unknown"
}

/**
 * Logs structured JSON audit events to stdout with rate-capping (10 logs/min/IP).
 */
export function logAuditEvent(event: AuditEvent, payload: AuditPayload = {}): void {
  const ip = payload.ip || "unknown"
  const now = Date.now()

  // Rate capping per IP
  const bucket = auditLogBuckets.get(ip)
  if (!bucket || now > bucket.resetAt) {
    auditLogBuckets.set(ip, { count: 1, resetAt: now + 60_000 })
  } else {
    bucket.count++
    if (bucket.count > 10) {
      // Suppress excessive logs to prevent DoS amplification
      return
    }
  }

  const record = {
    ts: new Date().toISOString(),
    event,
    ...payload,
  }

  console.log(`[AUDIT] ${JSON.stringify(record)}`)
}
