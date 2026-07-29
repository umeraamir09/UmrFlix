import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { isAdminUser } from "@/lib/rbac"
import { getAllRequests, approveRequest, denyRequest } from "@/lib/requests-store"

export async function GET() {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden. Admin privileges required." }, { status: 403 })
    }

    const requests = await getAllRequests()
    return NextResponse.json(requests)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch admin requests"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden. Admin privileges required." }, { status: 403 })
    }

    const body = await request.json()
    const { requestId, action, reason } = body

    if (!requestId || !action) {
      return NextResponse.json({ error: "Missing requestId or action" }, { status: 400 })
    }

    let updated
    if (action === "approve") {
      updated = await approveRequest(requestId, session!.username)
    } else if (action === "deny") {
      updated = await denyRequest(requestId, session!.username, reason)
    } else {
      return NextResponse.json({ error: "Invalid action. Must be approve or deny." }, { status: 400 })
    }

    return NextResponse.json(updated)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update request"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
