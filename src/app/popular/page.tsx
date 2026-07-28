import { redirect } from "next/navigation"

export default function PopularPage() {
  redirect("/search?filter=popular")
}
