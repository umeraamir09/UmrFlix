import { NextResponse } from "next/server"

/**
 * Watch Party responses must never be cached by browsers or proxies —
 * snapshot polls drive the sync clock and a stale `serverNow` poisons every
 * drift computation. Party routes add this to every response.
 */
export const NO_STORE_HEADERS = { "Cache-Control": "no-store" }

export type ApiErrorPayload = {
  error: string
  code: string
  correlationId: string
  details?: unknown
}

export function apiError(
  message: string,
  status: number = 500,
  code: string = "INTERNAL_ERROR",
  details?: unknown
): NextResponse<ApiErrorPayload> {
  const correlationId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
  return NextResponse.json(
    {
      error: message,
      code,
      correlationId,
      ...(details ? { details } : {}),
    },
    { status }
  )
}
