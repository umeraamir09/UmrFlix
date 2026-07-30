import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getUserRequests } from "@/lib/requests-store"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const userRequests = await getUserRequests(session.userId)
    return NextResponse.json(userRequests)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch user requests"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
