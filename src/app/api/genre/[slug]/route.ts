import { NextRequest, NextResponse } from "next/server"
import { getGenreBySlug } from "@/lib/genres"
import { getGenrePageData } from "@/lib/genre-catalog"
import { getSession } from "@/lib/auth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const genre = getGenreBySlug(slug)
    if (!genre) {
      return NextResponse.json({ error: "Genre not found" }, { status: 404 })
    }

    const session = await getSession()
    const userId = session?.userId ?? "default"

    const data = await getGenrePageData(slug, userId)
    if (!data) {
      return NextResponse.json({ error: "Failed to load genre data" }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("Genre API error:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
