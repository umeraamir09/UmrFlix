import { redirect } from "next/navigation"

export default async function TvRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = (await searchParams) || {}
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      search.set(key, value)
    }
  }
  const qs = search.toString()
  redirect(`/tvshows${qs ? `?${qs}` : ""}`)
}
