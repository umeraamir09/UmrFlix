import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getJellyfinUsers } from "@/lib/jellyfin"
import { apiError } from "@/lib/api-response"

export const dynamic = "force-dynamic"

// GET /api/party/users -> Fetch users list for invite picker (minus current user)
export async function GET() {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  try {
    const rawUsers = await getJellyfinUsers()

    // Filter out current user and map to simplified picker items
    const users = rawUsers
      .filter((u) => u.Id !== session.userId && u.Name !== session.username)
      .map((u) => ({
        id: u.Id,
        username: u.Name,
        avatarUrl: u.PrimaryImageTag
          ? `/api/jellyfin/image/${u.Id}?type=Primary`
          : undefined,
      }))

    return NextResponse.json({ users })
  } catch (err) {
    console.error("[Party API] Error fetching users:", err)
    return apiError("Failed to fetch user list", 500, "FETCH_USERS_FAILED", String(err))
  }
}
