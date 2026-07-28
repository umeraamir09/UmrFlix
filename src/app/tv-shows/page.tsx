import { redirect } from "next/navigation"

export default function TvShowsPage() {
  redirect("/search?type=tv")
}
