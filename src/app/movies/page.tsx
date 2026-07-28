import { redirect } from "next/navigation"

export default function MoviesPage() {
  redirect("/search?type=movie")
}
