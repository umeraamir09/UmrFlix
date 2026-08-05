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
  let body: { rowCategoryKey?: string; action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { rowCategoryKey, action } = body
  if (!rowCategoryKey || (action !== "view" && action !== "click")) {
    return NextResponse.json({ error: "rowCategoryKey and action (view|click) are required" }, { status: 400 })
  }

  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ ok: true })
  }
  const userId = session.userId

  if (action === "view") {
    await Promise.all([
      recordRowImpression(rowCategoryKey),
      recordRowFatigueImpression(userId, "default", rowCategoryKey),
    ])
  } else {
    await Promise.all([
      recordRowImpression(rowCategoryKey, { clicked: true }),
      resetRowFatigue(userId, "default", rowCategoryKey),
    ])
  }

  return NextResponse.json({ ok: true })
}
