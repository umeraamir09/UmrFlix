import { NextResponse } from "next/server"

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
