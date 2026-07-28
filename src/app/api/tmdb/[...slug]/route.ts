import { NextRequest, NextResponse } from "next/server"
import { env } from "@/lib/env"

const TMDB_BASE = env("TMDB_API_BASE")
const TMDB_KEY = env("TMDB_API_KEY")
const TIMEOUT = 5_000

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await params
  const path = "/" + slug.join("/")
  const url = new URL(`${TMDB_BASE}${path}`)
  url.searchParams.set("api_key", TMDB_KEY)
  url.searchParams.set("language", "en-US")

  for (const [key, value] of request.nextUrl.searchParams) {
    url.searchParams.set(key, value)
  }

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } finally {
    clearTimeout(id)
  }
}
