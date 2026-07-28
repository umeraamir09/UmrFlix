import { MovieDetail } from "@/components/MovieDetail"

export default function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  return <MovieDetail params={params} />
}
