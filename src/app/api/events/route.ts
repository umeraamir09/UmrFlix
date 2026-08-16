import { eventBus, AppServerEvent } from "@/lib/event-bus"
import { getSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return new Response("Unauthorized", { status: 401 })
  }

  const encoder = new TextEncoder()
  let unbind: (() => void) | undefined
  let heartbeatInterval: NodeJS.Timeout | undefined

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection handshake
      const initialMessage = `event: connected\ndata: ${JSON.stringify({
        status: "connected",
        timestamp: new Date().toISOString(),
      })}\n\n`
      controller.enqueue(encoder.encode(initialMessage))

      // Event listener for AppServerEvent
      unbind = eventBus.onEvent((event: AppServerEvent) => {
        try {
          const payload = event.payload as { audience?: string[] } | undefined
          if (payload?.audience && Array.isArray(payload.audience)) {
            if (!payload.audience.includes(session.userId)) {
              return // Skip event for user outside of target audience
            }
          }
          const sseChunk = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`
          controller.enqueue(encoder.encode(sseChunk))
        } catch {
          /* Stream closed by client */
        }
      })

      // Send periodic heartbeat & SSE keepalive comment every 20 seconds to prevent proxy connection timeouts
      heartbeatInterval = setInterval(() => {
        try {
          // 8.1 — SSE comment (: keepalive\n\n) prevents proxy timeouts (nginx/Cloudflare/ALB)
          controller.enqueue(
            encoder.encode(`: keepalive\n\nevent: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`)
          )
        } catch {
          clearInterval(heartbeatInterval)
        }
      }, 20_000)
    },
    cancel() {
      if (unbind) unbind()
      if (heartbeatInterval) clearInterval(heartbeatInterval)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
