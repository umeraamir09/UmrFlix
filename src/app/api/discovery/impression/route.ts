import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import {
  recordRowImpression,
  recordRowFatigueImpression,
  resetRowFatigue,
} from "@/lib/discovery/store"

export const dynamic = "force-dynamic"

/**
 * Row feedback beacon.
 *   action "view"  — row entered the viewport unclicked: global impression++
 *                    and per-user unclicked fatigue++ (Module 4.2).
 *   action "click" — user interacted with the row: global click++, fatigue
 *                    reset (Module 4.1 UCB1 reward signal).
 */
export async function POST(request: Request) {
  let body: { rowCategoryKey?: string; action?: string; clicked?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  let action = body.action
  if (!action && body.clicked === true) {
    action = "click"
  } else if (!action && body.clicked === false) {
    action = "view"
  }

  const { rowCategoryKey } = body
  if (!rowCategoryKey || typeof rowCategoryKey !== "string" || (action !== "view" && action !== "click")) {
    return NextResponse.json({ error: "rowCategoryKey and action (view|click) are required" }, { status: 400 })
  }

  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ ok: true })
  }
  const userId = session.userId
  // §7.13: profileId plumbing — store is already profile-aware.
  const url = new URL(request.url)
  const profileIdParam = url.searchParams.get("profileId")
  const profileId = profileIdParam && /^[\w-]{1,64}$/.test(profileIdParam) ? profileIdParam : "default"

  if (action === "view") {
    await Promise.all([
      recordRowImpression(rowCategoryKey),
      recordRowFatigueImpression(userId, profileId, rowCategoryKey),
    ])
  } else {
    await Promise.all([
      recordRowImpression(rowCategoryKey, { clicked: true }),
      resetRowFatigue(userId, profileId, rowCategoryKey),
    ])
  }

  return NextResponse.json({ ok: true })
}
